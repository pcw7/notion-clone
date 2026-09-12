/**
 * 검색 질의 — W7 (F-07-01 · F-07-07)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **권한.** 볼 수 없는 페이지는 결과에도, 건수에도, 제목 미리보기에도
 *      나타나지 않는다. F-07-07 은 이것을 "기능 결함이 아니라 보안 사고"라고 했다
 *   ② **한국어가 조사를 넘어 검색된다.** `'검색'` 으로 `'검색이'` 를 찾는다 —
 *      tsvector 단일 축이면 여기서 죽는다
 *   ③ **페이지네이션이 권한 때문에 깨지지 않는다.** 필터가 쿼리 안에 있으므로
 *      "25건 요청 → 3건 반환"이 일어나지 않는다
 *   ④ **짧은 쿼리와 0건을 구분한다.** 화면이 다르다
 *   ⑤ 휴지통 · 제목 우선 정렬 · breadcrumb
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import {
  probeDatabase,
  makeFixture,
  createUser,
  joinAs,
  type Actor,
  type Fixture,
} from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { trashPage } from '../block/trash.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { searchPages, DEFAULT_SEARCH_LIMIT, normalizeQuery } from './search.ts'
import type { BlockId } from '../ids.ts'
import type { EditorDoc } from '../editor/document.ts'
import { textRun } from '../contracts/rich-text.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let other: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  other = await joinAs(fx.workspaceId, await createUser('다른 멤버'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const docOf = (...texts: string[]): EditorDoc => ({
  blocks: texts.map((t) => ({
    id: randomUUID(),
    type: 'paragraph' as const,
    title: t === '' ? [] : [textRun(t)],
  })),
})

/** 제목 + 본문을 가진 페이지. 색인은 저장 시점에 동기로 들어간다. */
const pageWith = async (
  title: string,
  body: string[] = [],
  parentPageId?: BlockId,
): Promise<BlockId> => {
  const page = (
    await createPage(fx.owner.ctx, {
      title: titleFromPlainText(title),
      ...(parentPageId ? { parentPageId } : {}),
    })
  ).id
  if (body.length > 0) {
    const saved = await savePageBody(fx.owner.ctx, page, docOf(...body))
    assert.equal(saved.ok, true, '본문 저장이 실패했다')
  }
  return page
}

/**
 * 이 페이지를 소유자만 볼 수 있게 만든다.
 *
 * **순서가 중요하고, 결과를 반드시 단언한다.** `revokeAccess` 는 그 페이지를
 * 아무도 관리할 수 없게 되는 회수를 `would_orphan` 으로 **거부한다.** 그래서
 * 소유자에게 먼저 직접 부여하고 그다음 `workspace_everyone` 을 회수해야 한다.
 *
 * 처음 이 테스트를 쓸 때 순서를 뒤집었고, 거부된 결과를 단언하지 않아서
 * **"볼 수 없는 페이지가 검색에 샌다"는 거짓 실패**를 봤다. 권한은 멀쩡했고
 * 테스트가 틀렸다. 조용한 거부가 보안 테스트를 통과시키는 일이 없도록, 여기서
 * 세 단계 모두를 단언한다.
 */
const makePrivate = async (page: BlockId): Promise<void> => {
  const cut = await stopInheriting(fx.owner.ctx, page)
  assert.equal(cut.ok, true, `stopInheriting 실패: ${cut.ok === false ? cut.reason : ''}`)

  const granted = await grantAccess(
    fx.owner.ctx,
    page,
    { type: 'user', id: fx.owner.userId },
    'full_access',
  )
  assert.equal(granted.ok, true, `grantAccess 실패: ${granted.ok === false ? granted.reason : ''}`)

  const revoked = await revokeAccess(fx.owner.ctx, page, {
    type: 'workspace_everyone',
    id: null,
  })
  assert.equal(revoked.ok, true, `revokeAccess 실패: ${revoked.ok === false ? revoked.reason : ''}`)
}

/** 결과의 pageId 목록. */
const idsOf = async (actor: Actor, query: string, limit?: number): Promise<string[]> => {
  const out = await searchPages(actor.ctx, { query, ...(limit ? { limit } : {}) })
  assert.equal(out.ok, true, `검색이 거부됐다: ${out.ok === false ? out.reason : ''}`)
  return out.ok ? out.results.results.map((r) => r.pageId) : []
}

describe('기본 검색', () => {
  test('제목으로 찾는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    // 토큰을 고유하게 만든다 — 같은 워크스페이스를 모든 테스트가 공유하므로
    // 흔한 말로 찾으면 다른 테스트가 만든 페이지가 섞인다.
    const token = `고유토큰${randomUUID().slice(0, 8)}`
    const target = await pageWith(token)

    assert.deepEqual(await idsOf(fx.owner, token), [target])
  })

  test('본문으로 찾는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `본문토큰${randomUUID().slice(0, 8)}`
    const target = await pageWith('평범한 제목', [`문단 안에 ${token} 이 있다`])

    assert.deepEqual(await idsOf(fx.owner, token), [target])
  })

  test('★ 한국어가 조사를 넘어 검색된다 — tsvector 단일 축이면 여기서 죽는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `조사시험${randomUUID().slice(0, 6)}`
    const target = await pageWith('조사 시험', [`${token}이 빠르다`])

    // `'…'` 로 찾으면 `'…이'` 가 걸려야 한다. simple analyzer 로는 안 된다
    // (마이그레이션 0012 머리말의 실측) — pg_bigm 축이 하는 일이다.
    assert.deepEqual(await idsOf(fx.owner, token), [target])
  })

  test('★ 영문도 찾는다 (라틴 축 — tsvector)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `quarterly${randomUUID().slice(0, 6).replace(/[^a-z]/g, 'x')}`
    const target = await pageWith('Report', [`the ${token} numbers are in`])

    assert.deepEqual(await idsOf(fx.owner, token), [target])
  })

  test('영문 대소문자를 구분하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `MixedCase${randomUUID().slice(0, 6).replace(/[^a-zA-Z]/g, 'x')}`
    const target = await pageWith('대소문자', [token])

    assert.deepEqual(await idsOf(fx.owner, token.toLowerCase()), [target])
  })

  test('없는 말은 0건 — 던지지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    assert.deepEqual(await idsOf(fx.owner, `없는말${randomUUID()}`), [])
  })

  test('★ LIKE 메타문자가 와일드카드로 해석되지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await pageWith('퍼센트', ['할인율은 50% 이다'])
    // `%` 가 와일드카드로 새면 아무 페이지나 걸린다.
    const hits = await idsOf(fx.owner, '50%')
    assert.deepEqual(hits, [target])

    // `_` 도 마찬가지다 — 한 글자 와일드카드로 새면 '50%' 페이지가 걸린다.
    assert.deepEqual(await idsOf(fx.owner, '5_%'), [])
  })
})

describe('짧은 쿼리 — 0건과 구분한다 (F-07-01 빈 상태)', () => {
  test('★ 빈 쿼리는 질의하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const out = await searchPages(fx.owner.ctx, { query: '' })
    assert.equal(out.ok, false)
    if (!out.ok) assert.equal(out.reason, 'query_too_short')
  })

  test('공백만 입력도 마찬가지다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const out = await searchPages(fx.owner.ctx, { query: '   ' })
    assert.equal(out.ok, false)
  })

  test('★ 한국어 한 글자는 유효하다 — 영문 기준으로 막으면 한국어 검색이 죽는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const out = await searchPages(fx.owner.ctx, { query: '책' })
    assert.equal(out.ok, true, '한국어 1자가 거부됐다')
  })

  test('영문 한 글자는 막는다 (워크스페이스 전체가 걸린다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const out = await searchPages(fx.owner.ctx, { query: 'a' })
    assert.equal(out.ok, false)
    if (!out.ok) {
      assert.equal(out.minLength, 2)
      assert.equal(out.script, 'latin')
    }
  })
})

describe('★ 권한 — 보안 경계 (F-07-07)', () => {
  test('★ 볼 수 없는 페이지는 결과에 나타나지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `비밀토큰${randomUUID().slice(0, 8)}`
    const secret = await pageWith('비밀 페이지', [`${token} 이 적혀 있다`])

    // 소유자는 찾는다.
    assert.deepEqual(await idsOf(fx.owner, token), [secret])

    // 상속을 끊고 workspace_everyone 의 권한을 회수하면 다른 멤버는 못 본다.
    await makePrivate(secret)

    assert.deepEqual(await idsOf(other, token), [], '볼 수 없는 페이지가 검색에 새고 있다')
    // 소유자는 여전히 찾는다 — 회수가 과하게 걸리지 않았다.
    assert.deepEqual(await idsOf(fx.owner, token), [secret])
  })

  test('★ 제목만으로도 새지 않는다 — 존재 사실조차 노출 금지', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `제목만비밀${randomUUID().slice(0, 8)}`
    const secret = await pageWith(token)

    await makePrivate(secret)

    const out = await searchPages(other.ctx, { query: token })
    assert.equal(out.ok, true)
    if (out.ok) {
      assert.equal(out.results.results.length, 0)
      // 건수도 0이어야 한다 — F-07-07: "결과 건수 노출: 필터 적용 후 집계."
      assert.equal(out.results.has_more, false)
    }
  })

  test('★ 권한을 다시 주면 다시 보인다 — 색인을 지우는 설계가 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `되돌리기${randomUUID().slice(0, 8)}`
    const page = await pageWith('되돌릴 페이지', [token])

    await makePrivate(page)
    assert.deepEqual(await idsOf(other, token), [])

    const back = await grantAccess(
      fx.owner.ctx,
      page,
      { type: 'user', id: other.userId },
      'full_access',
    )
    assert.equal(back.ok, true)
    assert.deepEqual(await idsOf(other, token), [page], '권한을 돌려줬는데 안 보인다')
  })

  test('★ 하위 페이지도 상속을 따라 걸러진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `자손토큰${randomUUID().slice(0, 8)}`
    const parent = await pageWith('막을 부모')
    const child = await pageWith('자식', [token], parent)

    assert.deepEqual(await idsOf(other, token), [child])

    // 부모에서 끊고 회수하면 자식도 같은 스코프라 함께 사라진다.
    await makePrivate(parent)

    assert.deepEqual(await idsOf(other, token), [], '부모를 막았는데 자식이 검색된다')
  })
})

describe('휴지통', () => {
  test('★ 휴지통에 간 페이지는 검색되지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `버릴토큰${randomUUID().slice(0, 8)}`
    const page = await pageWith('버릴 페이지', [token])
    assert.deepEqual(await idsOf(fx.owner, token), [page])

    await trashPage(fx.owner.ctx, page)
    assert.deepEqual(await idsOf(fx.owner, token), [], '휴지통 페이지가 검색된다')
  })
})

describe('랭킹 — 제목 우선, 그다음 최근 수정순', () => {
  test('★ 제목이 걸린 페이지가 본문만 걸린 페이지보다 앞에 온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `순서토큰${randomUUID().slice(0, 8)}`
    // 본문 매칭을 **먼저** 만든다. 최근 수정순만이면 이쪽이 앞에 와야 하므로,
    // 제목 우선이 실제로 이기는지 보인다.
    const bodyOnly = await pageWith('본문만 걸리는 페이지', [`${token} 이 본문에 있다`])
    const titleHit = await pageWith(`${token} 제목이다`)

    const hits = await idsOf(fx.owner, token)
    assert.equal(hits.length, 2)
    assert.equal(hits[0], titleHit, '제목 일치가 1위가 아니다')
    assert.equal(hits[1], bodyOnly)
  })

  test('제목 일치끼리는 최근 수정순이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `최신순${randomUUID().slice(0, 8)}`
    const older = await pageWith(`${token} 먼저`)
    const newer = await pageWith(`${token} 나중`)

    const hits = await idsOf(fx.owner, token)
    assert.deepEqual(hits, [newer, older])
  })

  test('titleHit 플래그가 결과에 실린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `플래그${randomUUID().slice(0, 8)}`
    await pageWith(`${token} 제목`)
    await pageWith('다른 제목', [token])

    const out = await searchPages(fx.owner.ctx, { query: token })
    assert.equal(out.ok, true)
    if (out.ok) {
      assert.deepEqual(
        out.results.results.map((r) => r.titleHit),
        [true, false],
      )
    }
  })
})

describe('스니펫 · breadcrumb', () => {
  test('스니펫은 일치 지점 주변을 보여준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `스니펫${randomUUID().slice(0, 8)}`
    await pageWith('스니펫 시험', [`${'머리말 '.repeat(40)}${token} 그리고 뒤에 오는 말`])

    const out = await searchPages(fx.owner.ctx, { query: token })
    assert.equal(out.ok, true)
    if (out.ok) {
      const snip = out.results.results[0]?.snippet ?? ''
      assert.ok(snip.includes(token), `스니펫에 일치 지점이 없다: ${snip}`)
      // 본문 앞부분을 그대로 준 것이 아니어야 한다.
      assert.ok(!snip.startsWith('머리말 머리말 머리말 머리말 머리말 머리말 머리말 머리말 머리말 머리말 머리말'))
    }
  })

  test('제목만 걸린 페이지의 스니펫은 본문 앞부분이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `제목만${randomUUID().slice(0, 8)}`
    await pageWith(`${token} 제목`, ['본문의 첫 문장이다'])

    const out = await searchPages(fx.owner.ctx, { query: token })
    assert.equal(out.ok, true)
    if (out.ok) assert.equal(out.results.results[0]?.snippet, '본문의 첫 문장이다')
  })

  test('★ breadcrumb 은 조인으로 만든다 — 조상 제목을 바꾸면 따라온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `경로토큰${randomUUID().slice(0, 8)}`
    const root = await pageWith('조상 제목')
    const mid = await pageWith('중간', [], root)
    await pageWith(`${token} 손자`, [], mid)

    const out = await searchPages(fx.owner.ctx, { query: token })
    assert.equal(out.ok, true)
    if (out.ok) {
      const trail = out.results.results[0]?.breadcrumb ?? []
      // 루트 → 부모 순이다.
      assert.deepEqual(
        trail.map((b) => b.title),
        ['조상 제목', '중간'],
      )
    }

    const { renamePage } = await import('../block/page.ts')
    await renamePage(fx.owner.ctx, root, titleFromPlainText('바뀐 조상'))

    const again = await searchPages(fx.owner.ctx, { query: token })
    assert.equal(again.ok, true)
    if (again.ok) {
      assert.equal(again.results.results[0]?.breadcrumb[0]?.title, '바뀐 조상')
    }
  })

  test('루트 페이지의 breadcrumb 은 빈 배열이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `루트토큰${randomUUID().slice(0, 8)}`
    await pageWith(`${token} 루트`)

    const out = await searchPages(fx.owner.ctx, { query: token })
    assert.equal(out.ok, true)
    if (out.ok) assert.deepEqual(out.results.results[0]?.breadcrumb, [])
  })
})

describe('★ 페이지네이션 — 권한 때문에 깨지지 않는다 (F-07-07)', () => {
  test('★ 요청한 수만큼 채워 돌려준다 — post-filter 면 이게 모자란다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `페이징${randomUUID().slice(0, 8)}`
    const mine: string[] = []
    // 볼 수 있는 것 5개와 볼 수 없는 것 5개를 섞는다. post-filter 라면
    // "5건 요청 → 2~3건 반환"이 된다.
    for (let i = 0; i < 5; i += 1) mine.push(await pageWith(`${token} 보임 ${i}`))
    for (let i = 0; i < 5; i += 1) {
      await makePrivate(await pageWith(`${token} 숨김 ${i}`))
    }

    const out = await searchPages(other.ctx, { query: token, limit: 5 })
    assert.equal(out.ok, true)
    if (out.ok) {
      assert.equal(out.results.results.length, 5, '권한 필터가 페이지를 비웠다')
      for (const hit of out.results.results) {
        assert.ok(mine.includes(hit.pageId), '숨긴 페이지가 결과에 있다')
      }
    }
  })

  test('★ 커서로 끝까지 읽으면 중복·누락이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `커서${randomUUID().slice(0, 8)}`
    const made = new Set<string>()
    for (let i = 0; i < 7; i += 1) made.add(await pageWith(`${token} ${i}`))

    const seen: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 10; guard += 1) {
      const out = await searchPages(fx.owner.ctx, { query: token, limit: 3, cursor })
      assert.equal(out.ok, true)
      if (!out.ok) break
      seen.push(...out.results.results.map((r) => r.pageId))
      cursor = out.results.next_cursor
      if (cursor === null) break
    }

    assert.equal(seen.length, 7, `7건이어야 하는데 ${seen.length}건을 읽었다`)
    assert.equal(new Set(seen).size, 7, '중복이 있다')
    assert.deepEqual(new Set(seen), made)
  })

  test('마지막 페이지의 next_cursor 는 null 이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `마지막${randomUUID().slice(0, 8)}`
    await pageWith(`${token} 하나`)

    const out = await searchPages(fx.owner.ctx, { query: token, limit: 10 })
    assert.equal(out.ok, true)
    if (out.ok) {
      assert.equal(out.results.next_cursor, null)
      assert.equal(out.results.has_more, false)
    }
  })

  test('손상된 커서는 처음부터 읽는다 — 던지지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const token = `손상커서${randomUUID().slice(0, 8)}`
    const page = await pageWith(`${token} 하나`)

    const out = await searchPages(fx.owner.ctx, { query: token, cursor: 'not-a-cursor!!' })
    assert.equal(out.ok, true)
    if (out.ok) assert.deepEqual(out.results.results.map((r) => r.pageId), [page])
  })

  test('limit 은 상한을 넘지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const out = await searchPages(fx.owner.ctx, { query: '검색', limit: 9999 })
    assert.equal(out.ok, true)
    // 상한 자체는 단위 테스트로 보고, 여기서는 거부되지 않는 것만 본다.
  })
})

describe('normalizeQuery', () => {
  test('공백을 접고 다듬는다', () => {
    assert.equal(normalizeQuery('  여러   공백  '), '여러 공백')
  })

  test('문자열이 아니면 빈 문자열', () => {
    assert.equal(normalizeQuery(null), '')
    assert.equal(normalizeQuery(42), '')
  })

  test('기본 결과 수가 상식적인 범위다', () => {
    assert.ok(DEFAULT_SEARCH_LIMIT > 0 && DEFAULT_SEARCH_LIMIT <= 50)
  })
})
