/**
 * 검색 오타 대체 — 플랫폼 잔여 10p-3 (F-07-02)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] 검색 오타 대체
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 맞는 결과가 0건이면 제목의 낱말 유사도로 찾는다 — 한국어 · 라틴 · 대체라는 표시 · 제목이 걸렸다는 거짓
 *   ② ★ 맞는 결과가 하나라도 있으면 대체하지 않는다(비슷한 것을 섞지 않는다)
 *   ③ ★ 권한 · 휴지통 — 볼 수 없는 페이지 · 버린 페이지는 대체에도 없다
 *   ④ ★ 대안 · 제외가 있거나 찾는 말이 3자 미만이면 대체하지 않는다
 *   ⑤ 필터는 그대로 — 만든 사람 필터가 대체에도 걸린다
 *   ⑥ 유사도 높은 순 · 한 쪽만(다음 쪽이 없다)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { type Actor, type Fixture, createUser, joinAs, makeFixture, probeDatabase } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { trashPage } from '../block/trash.ts'
import { query } from '../db/pool.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { FUZZY_WORD_SIMILARITY, searchPages } from './search.ts'

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

const page = async (title: string, who: Actor = fx.owner): Promise<string> =>
  (await createPage(who.ctx, { title: titleFromPlainText(title) })).id

type Search = Parameters<typeof searchPages>[1]
/** 검색 — 거부되면 실패. (id 들 · 대체인가 · 제목이 걸렸나 · 다음 쪽) */
const search = async (actor: Actor, input: Search) => {
  const out = await searchPages(actor.ctx, input)
  assert.equal(out.ok, true, `검색이 거부됐다: ${out.ok === false ? out.reason : ''}`)
  if (!out.ok) throw new Error('unreachable')
  return {
    ids: out.results.results.map((h) => h.pageId),
    fuzzy: out.fuzzy,
    titleHits: out.results.results.map((h) => h.titleHit),
    hasMore: out.results.has_more,
    next: out.results.next_cursor,
  }
}

/** 노드를 소유자만 보게 한다(search.db.test.ts 의 `makePrivate` 와 같다 — 순서가 중요하다). */
const makePrivate = async (nodeId: string): Promise<void> => {
  const cut = await stopInheriting(fx.owner.ctx, nodeId)
  assert.equal(cut.ok, true, `stopInheriting 실패: ${cut.ok === false ? cut.reason : ''}`)
  const granted = await grantAccess(fx.owner.ctx, nodeId, { type: 'user', id: fx.owner.userId }, 'full_access')
  assert.equal(granted.ok, true, `grantAccess 실패: ${granted.ok === false ? granted.reason : ''}`)
  const revoked = await revokeAccess(fx.owner.ctx, nodeId, { type: 'workspace_everyone', id: null })
  assert.equal(revoked.ok, true, `revokeAccess 실패: ${revoked.ok === false ? revoked.reason : ''}`)
}

describe('검색 오타 대체 (10p-3)', () => {
  test('★ ① 맞는 결과가 0건이면 제목의 낱말 유사도로 찾는다 — 한국어 · 라틴 · 대체라는 표시', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const korean = await page('2026 분기보고서 최종')
    const latin = await page('Q3 product roadmap draft')

    const k = await search(fx.owner, { query: '분기보고사' })
    assert.deepEqual(k.ids, [korean], '한국어 오타')
    assert.equal(k.fuzzy, true, '대체라는 표시')
    assert.deepEqual(k.titleHits, [false], '제목이 걸린 것이 아니다')

    const l = await search(fx.owner, { query: 'raodmap' })
    assert.deepEqual(l.ids, [latin], '라틴 오타')
    assert.equal(l.fuzzy, true)

    const none = await search(fx.owner, { query: '전혀없는말' })
    assert.deepEqual([none.ids, none.fuzzy], [[], false], '비슷한 것도 없으면 대체가 아닌 0건')
  })

  test('★ ② 맞는 결과가 하나라도 있으면 대체하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const exact = await page('주간회의록 정리')
    const similar = await page('주간회의룩 자료')
    const r = await search(fx.owner, { query: '주간회의록' })
    assert.deepEqual(r.ids, [exact], '맞는 것만 — 비슷한 것을 섞지 않는다')
    assert.equal(r.fuzzy, false)
    const typo = await search(fx.owner, { query: '주간회의략' })
    assert.equal(typo.fuzzy, true, '맞는 것이 없으면 둘 다 비슷하다')
    assert.deepEqual([...typo.ids].sort(), [exact, similar].sort())
  })

  test('★ ③ 권한 · 휴지통 — 볼 수 없는 페이지 · 버린 페이지는 대체에도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const secret = await page('인사평가 결과 공유')
    await makePrivate(secret)
    assert.deepEqual((await search(fx.owner, { query: '인사평과' })).ids, [secret], '소유자는 대체로 찾는다')
    const theirs = await search(other, { query: '인사평과' })
    assert.deepEqual([theirs.ids, theirs.fuzzy], [[], false], '볼 수 없는 페이지는 대체에도 없다')

    const gone = await page('연봉협상 기록')
    assert.deepEqual((await search(fx.owner, { query: '연봉협싱' })).ids, [gone], '버리기 전에는 찾는다(전제)')
    const trashed = await trashPage(fx.owner.ctx, gone)
    assert.equal(trashed.pageId, gone, '버렸다')
    assert.deepEqual((await search(fx.owner, { query: '연봉협싱' })).ids, [], '버린 페이지는 대체에도 없다')
  })

  test('★ ④ 대안 · 제외가 있거나 찾는 말이 3자 미만이면 대체하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const plan = await page('기획안 초안 정리')
    const short = await page('xyz def')
    assert.deepEqual((await search(fx.owner, { query: '기획앙' })).ids, [plan], '대조 — 대안 · 제외가 없으면 찾는다')
    for (const q of ['기획앙 OR 없는말', '기획앙 -정리', '"기획앙" -초안']) {
      const r = await search(fx.owner, { query: q })
      assert.deepEqual([r.ids, r.fuzzy], [[], false], `${q} — 대안 · 제외가 있으면 대체하지 않는다`)
    }
    // 두 글자는 무엇과도 비슷하다 — 낱말 유사도가 하한을 넘어도 돌지 않는다
    const sim = await query<{ s: number }>(`SELECT word_similarity('xy', 'xyz def') AS s`)
    assert.ok(Number(sim[0]!.s) >= FUZZY_WORD_SIMILARITY, '전제 — 두 글자의 낱말 유사도가 하한을 넘는다')
    const r = await search(fx.owner, { query: 'xy' })
    assert.deepEqual([r.ids.includes(short), r.fuzzy], [false, false], '세 글자 미만은 대체하지 않는다')
  })

  test('⑤ 필터는 그대로 — 만든 사람 필터가 대체에도 걸린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mine = await page('출장비 정산표')
    assert.deepEqual((await search(fx.owner, { query: '출장비 정산퓨', filters: { createdBy: 'me' } })).ids, [mine])
    const byOther = await search(fx.owner, { query: '출장비 정산퓨', filters: { createdBy: other.userId } })
    assert.deepEqual([byOther.ids, byOther.fuzzy], [[], false], '다른 사람이 만든 것만 — 대체에도 없다')
  })

  test('⑥ 유사도 높은 순 · 한 쪽만(다음 쪽이 없다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ids = [await page('Kanban'), await page('Kanban board notes'), await page('Kanban board planning for the next quarter')]
    const r = await search(fx.owner, { query: 'Kanbna', limit: 2 })
    assert.equal(r.fuzzy, true)
    assert.equal(r.ids.length, 2, '상한까지')
    assert.deepEqual([r.hasMore, r.next], [false, null], '다음 쪽이 없다')
    // 기대 차례 — 같은 함수로 잰 유사도 높은 순(같으면 최근 편집 순)
    const expected = await query<{ id: string }>(
      `SELECT doc_id AS id FROM search_document WHERE doc_id = ANY($1::uuid[])
        ORDER BY word_similarity('Kanbna', title_text) DESC, coalesce(last_edited_at, created_at) DESC, doc_id LIMIT 2`,
      [ids],
    )
    assert.deepEqual(r.ids, expected.map((e) => e.id))
  })
})
