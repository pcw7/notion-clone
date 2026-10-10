/**
 * 웹 게시 — 게시 · 해제 · 공개 경로의 판정 — 게시 · 공유 6a-1조각 (F-06-08 · F-06-07 웹 링크 · F-17-11 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.3 끝 [정정] 웹 게시).
 *
 *   ① 게시 · 해제 · 다시 게시는 같은 주소 · 기본값은 `noindex` · AI 크롤러 거부(①) · 토큰은 게시를 바꿀 수 있는 사람에게만
 *   ② 누가 — `manage_perm` 만(편집 · 보기는 forbidden · 못 보면 not_found) · 페이지만 · 휴지통은 안 된다 · 정책이 막으면
 *      `policy_disabled` 이지만 해제는 된다
 *   ③ ★ 공개는 판정 밖이다(②) — 게시해도 공유받지 않은 멤버는 앱 안에서 보지 못하고(effective · 읽을 수 있는 스코프 그대로)
 *      `acl_entry` 의 `'public'` 행은 DB 가 거부한다
 *   ④ ★ 공개 경로(③) — 루트 · 상속이 이어진 하위 페이지는 열고, 상속을 끊은 하위 · 루트 밖 · 휴지통 · 테이크다운(위에서도) ·
 *      정책 끔 · 해제는 없는 페이지 · 만료만 따로 말한다 · 모양이 틀린 토큰 · id 는 DB 에 묻지 않고 없는 페이지
 *   ⑤ 물리 삭제는 공개 링크를 함께 지운다(CASCADE)
 *   ⑥ [6a-3] 게시된 링크의 설정 — 검색 엔진 노출 · ★ 주소 바꾸기(옛 주소는 곧바로 닫힌다) · 게시되지 않았으면 not_published · 틀린 몸체 ·
 *      누가(manage_perm)
 *   ⑦ [6a-3] ★ 위 페이지의 게시로 공개되었는가(`coveredBy`) — 가장 가까운 것 · 볼 수 없는 위 페이지는 id · 제목 없이 · 상속을 끊었거나
 *      정책이 막았거나 해제했으면 덮지 않는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { restorePage, trashPage } from '../block/trash.ts'
import { createDatabase } from '../database/database.ts'
import { query, queryOne } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import type { BlockId } from '../ids.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { grantAccess, stopInheriting } from '../permissions/acl.ts'
import { effectiveCaps, readableScopes } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { updateSetting } from '../settings/settings.ts'
import { resolvePublicPage } from './public-access.ts'
import { publishPage, readPublishState, unpublishPage, updatePublicLink } from './public-link.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

// ── 도우미 ────────────────────────────────────────────────────────────

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)}`

async function office() {
  const ws = await createBareWorkspace('게시')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const person = async (name: string, role: Parameters<typeof joinAs>[2] = 'member') => joinAs(ws, await createUser(name), role)
  return { ws, boss, person }
}

/** 개인 최상위 페이지 — 만든 사람만 전체 권한이다. */
const topOf = async (by: Actor): Promise<BlockId> =>
  (await createPage(by.ctx, { privateTop: true, title: titleFromPlainText(unique('문서')) })).id

const childOf = async (by: Actor, parent: BlockId): Promise<BlockId> =>
  (await createPage(by.ctx, { parentPageId: parent, title: titleFromPlainText(unique('하위')) })).id

function published(result: Awaited<ReturnType<typeof publishPage>>) {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

const opens = async (token: string, pageId?: string) => {
  const access = await resolvePublicPage(token, pageId)
  return access.ok ? 'open' : access.reason
}

// ── ① 게시 · 해제 ─────────────────────────────────────────────────────

describe('① 게시 · 해제 · 다시 게시', () => {
  test('★ 게시하면 토큰이 생기고 기본값은 noindex · AI 크롤러 거부다 · 해제해도 다시 게시하면 같은 주소', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await topOf(boss)

    const before = await readPublishState(boss.ctx, doc)
    assert.ok(before.ok)
    assert.equal(before.value.published, false)
    assert.equal(before.value.token, null)

    const first = published(await publishPage(boss.ctx, doc))
    assert.equal(first.published, true)
    assert.match(first.token ?? '', /^[A-Za-z0-9_-]{22}$/)
    assert.equal(first.robots, 'noindex')
    assert.equal(first.aiCrawler, 'deny')
    assert.equal(first.level, 'view')

    // 같은 것을 다시 게시해도 주소는 그대로다
    assert.equal(published(await publishPage(boss.ctx, doc)).token, first.token)

    const off = await unpublishPage(boss.ctx, doc)
    assert.ok(off.ok)
    assert.equal(off.value.published, false)
    assert.equal(off.value.token, first.token, '행과 토큰이 남는다')

    assert.equal(published(await publishPage(boss.ctx, doc)).token, first.token, '다시 게시하면 같은 주소')

    // 행의 기본값이 정본 ① 그대로다(명령이 쓰지 않은 칸)
    const row = await queryOne<{ robots_directive: string; ai_crawler: string; level: string; created_by: string }>(
      `SELECT robots_directive, ai_crawler, level, created_by FROM public_link WHERE node_id = $1`,
      [doc],
    )
    assert.deepEqual(row, { robots_directive: 'noindex', ai_crawler: 'deny', level: 'view', created_by: boss.userId })
  })

  test('토큰은 게시를 바꿀 수 있는 사람에게만 — 보기만 하는 사람은 게시 여부만 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const viewer = await person('보는 사람')
    const doc = await topOf(boss)
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: viewer.userId }, 'view')).ok)
    published(await publishPage(boss.ctx, doc))

    const seen = await readPublishState(viewer.ctx, doc)
    assert.ok(seen.ok)
    assert.equal(seen.value.published, true)
    assert.equal(seen.value.token, null)
    assert.equal(seen.value.canManage, false)
  })
})

// ── ② 누가 ────────────────────────────────────────────────────────────

describe('② 누가 · 무엇을', () => {
  test('manage_perm 만 — 편집 · 보기는 forbidden · 못 보면 not_found(게시 · 해제 · 상태 모두)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const editor = await person('편집자')
    const viewer = await person('보는 사람')
    const stranger = await person('모르는 사람')
    const doc = await topOf(boss)
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: editor.userId }, 'edit')).ok)
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: viewer.userId }, 'view')).ok)

    for (const who of [editor, viewer]) {
      assert.deepEqual(await publishPage(who.ctx, doc), { ok: false, reason: 'forbidden' })
      assert.deepEqual(await unpublishPage(who.ctx, doc), { ok: false, reason: 'forbidden' })
    }
    assert.deepEqual(await publishPage(stranger.ctx, doc), { ok: false, reason: 'not_found' })
    assert.deepEqual(await unpublishPage(stranger.ctx, doc), { ok: false, reason: 'not_found' })
    assert.deepEqual(await readPublishState(stranger.ctx, doc), { ok: false, reason: 'not_found' })

    const count = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM public_link WHERE node_id = $1`, [doc])
    assert.equal(count.n, 0, '거부된 게시는 행을 남기지 않는다')

    // 전체 권한을 받으면 된다
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: editor.userId }, 'full_access')).ok)
    published(await publishPage(editor.ctx, doc))
  })

  test('페이지만 — 데이터베이스는 not_page · 휴지통은 trashed · 없는 id 는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const db = await createDatabase(boss.ctx, { name: unique('표') })
    assert.ok(db.ok)
    assert.deepEqual(await publishPage(boss.ctx, db.value.id), { ok: false, reason: 'not_page' })

    const doc = await topOf(boss)
    await trashPage(boss.ctx, doc)
    assert.deepEqual(await publishPage(boss.ctx, doc), { ok: false, reason: 'trashed' })
    assert.deepEqual(await publishPage(boss.ctx, crypto.randomUUID()), { ok: false, reason: 'not_found' })
  })

  test('정책이 막으면 policy_disabled — 해제는 정책과 무관하게 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await topOf(boss)
    published(await publishPage(boss.ctx, doc))

    await withPolicy(boss, false)
    const other = await topOf(boss)
    assert.deepEqual(await publishPage(boss.ctx, other), { ok: false, reason: 'policy_disabled' })
    const state = await readPublishState(boss.ctx, doc)
    assert.ok(state.ok)
    assert.equal(state.value.policyAllows, false)

    const off = await unpublishPage(boss.ctx, doc)
    assert.ok(off.ok, '끄는 것은 언제나 된다')
    assert.equal(off.value.published, false)
  })
})

/** 정책을 설정의 길로 바꾼다(소유자 — 정본 ⑨). */
async function withPolicy(owner: Actor, allow: boolean): Promise<void> {
  assert.deepEqual(await updateSetting(owner.ctx, 'workspace.allow_publish_sites_and_forms', allow), { ok: true, value: allow })
}

// ── ③ 공개는 판정 밖이다 ─────────────────────────────────────────────

describe('③ ★ 공개는 effective() 의 항이 아니다', () => {
  test('게시해도 공유받지 않은 멤버 · 게스트는 앱 안에서 보지 못한다 — 읽을 수 있는 스코프도 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const member = await person('멤버')
    const guest = await person('손님', 'guest')
    const doc = await topOf(boss)
    const sub = await childOf(boss, doc)

    const scopesBefore = await withReadTransaction((tx) => readableScopes(tx, member.ctx))
    published(await publishPage(boss.ctx, doc))

    for (const who of [member, guest]) {
      for (const node of [doc, sub]) {
        const caps = await withReadTransaction((tx) => effectiveCaps(tx, who.ctx, node))
        assert.equal(can(caps, 'view'), false, `${who === member ? '멤버' : '게스트'}가 게시된 페이지를 앱에서 본다`)
      }
    }
    const scopesAfter = await withReadTransaction((tx) => readableScopes(tx, member.ctx))
    assert.deepEqual([...scopesAfter].sort(), [...scopesBefore].sort())

    // 스코프 경계도 바뀌지 않는다(재계산 트리거 ⑤ 는 없다)
    const scope = await queryOne<{ perm_scope_id: string }>(`SELECT perm_scope_id FROM block WHERE id = $1`, [sub])
    const rootScope = await queryOne<{ perm_scope_id: string }>(`SELECT perm_scope_id FROM block WHERE id = $1`, [doc])
    assert.equal(scope.perm_scope_id, rootScope.perm_scope_id)
  })

  test("acl_entry 의 'public' 행은 DB 가 거부한다(ck_acl_no_public)", async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await topOf(boss)
    await assert.rejects(
      query(
        `INSERT INTO acl_entry (id, node_kind, node_id, principal_type, principal_id, level)
         VALUES ($1, 'block', $2, 'public', NULL, 'view')`,
        [crypto.randomUUID(), doc],
      ),
      /ck_acl_no_public/,
    )
  })
})

// ── ④ 공개 경로 ───────────────────────────────────────────────────────

describe('④ ★ 공개 경로의 판정', () => {
  test('루트와 상속이 이어진 하위는 연다 — 상속을 끊은 하위 · 그 아래 · 루트 밖은 없는 페이지', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await topOf(boss)
    const sub = await childOf(boss, doc)
    const deep = await childOf(boss, sub)
    const cut = await childOf(boss, doc)
    const underCut = await childOf(boss, cut)
    const elsewhere = await topOf(boss)
    const token = published(await publishPage(boss.ctx, doc)).token!

    const root = await resolvePublicPage(token)
    assert.ok(root.ok)
    assert.equal(root.value.pageId, doc)
    assert.equal(root.value.rootId, doc)
    assert.deepEqual(root.value.chain, [doc])
    assert.equal(root.value.robots, 'noindex')
    assert.equal(root.value.aiCrawler, 'deny')

    const nested = await resolvePublicPage(token, deep)
    assert.ok(nested.ok)
    assert.deepEqual(nested.value.chain, [doc, sub, deep])

    assert.ok((await stopInheriting(boss.ctx, cut)).ok)
    assert.equal(await opens(token, cut), 'not_found')
    assert.equal(await opens(token, underCut), 'not_found', '끊은 노드 아래도 공개가 아니다')
    assert.equal(await opens(token, elsewhere), 'not_found', '루트 밖')

    // 하위 페이지를 게시해도 그 위는 열리지 않는다 — 토큰은 자기 루트 아래만 연다
    const subToken = published(await publishPage(boss.ctx, sub)).token!
    assert.equal(await opens(subToken, doc), 'not_found')
    assert.equal(await opens(subToken, deep), 'open')
  })

  test('휴지통 — 루트든 하위든 없는 페이지 · 복원하면 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await topOf(boss)
    const sub = await childOf(boss, doc)
    const token = published(await publishPage(boss.ctx, doc)).token!

    await trashPage(boss.ctx, sub)
    assert.equal(await opens(token, sub), 'not_found')
    assert.equal(await opens(token), 'open')
    await restorePage(boss.ctx, sub)
    assert.equal(await opens(token, sub), 'open')

    await trashPage(boss.ctx, doc)
    assert.equal(await opens(token), 'not_found')
    assert.equal(await opens(token, sub), 'not_found')
    await restorePage(boss.ctx, doc)
    assert.equal(await opens(token), 'open')
  })

  test('★ 테이크다운은 서브트리를 덮는다 — 루트 위에 걸려도 · 신고만으로는 내리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const top = await topOf(boss)
    const doc = await childOf(boss, top)
    const sub = await childOf(boss, doc)
    const token = published(await publishPage(boss.ctx, doc)).token!
    const moderate = (id: string, state: string) =>
      query(`UPDATE block SET moderation_state = $2::moderation_state WHERE id = $1`, [id, state])

    await moderate(sub, 'reported')
    assert.equal(await opens(token, sub), 'open', '신고만으로는 내리지 않는다')
    await moderate(sub, 'taken_down')
    assert.equal(await opens(token, sub), 'not_found')
    assert.equal(await opens(token), 'open')

    await moderate(sub, 'none')
    await moderate(top, 'restricted')
    assert.equal(await opens(token), 'not_found', '루트 위의 제한도 덮는다')
    assert.equal(await opens(token, sub), 'not_found')
    await moderate(top, 'reinstated')
    assert.equal(await opens(token, sub), 'open')
  })

  test('★ 정책을 끄면 곧바로 닫히고 다시 켜면 돌아온다 · 해제하면 닫히고 다시 게시하면 같은 주소로 열린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await topOf(boss)
    const token = published(await publishPage(boss.ctx, doc)).token!

    await withPolicy(boss, false)
    assert.equal(await opens(token), 'not_found')
    await withPolicy(boss, true)
    assert.equal(await opens(token), 'open')

    assert.ok((await unpublishPage(boss.ctx, doc)).ok)
    assert.equal(await opens(token), 'not_found')
    published(await publishPage(boss.ctx, doc))
    assert.equal(await opens(token), 'open')
  })

  test('만료만 따로 말한다 — 만료되어도 다른 이유가 있으면 없는 페이지', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await topOf(boss)
    const sub = await childOf(boss, doc)
    const token = published(await publishPage(boss.ctx, doc)).token!

    await query(`UPDATE public_link SET expires_at = now() - interval '1 minute' WHERE node_id = $1`, [doc])
    assert.equal(await opens(token), 'expired')
    assert.equal(await opens(token, sub), 'expired')
    await trashPage(boss.ctx, sub)
    assert.equal(await opens(token, sub), 'not_found', '휴지통이 먼저다')

    await query(`UPDATE public_link SET expires_at = now() + interval '1 hour' WHERE node_id = $1`, [doc])
    assert.equal(await opens(token), 'open')
  })

  test('모양이 틀린 토큰 · id · 없는 토큰은 없는 페이지', async () => {
    if (skipReason) return
    assert.equal(await opens('짧다'), 'not_found')
    assert.equal(await opens("' OR 1=1 --xxxxxxxxxxxx"), 'not_found')
    assert.equal(await opens('A'.repeat(22)), 'not_found')
    assert.equal(await opens('A'.repeat(22), 'not-a-uuid'), 'not_found')
  })
})

// ── ⑤ 물리 삭제 ───────────────────────────────────────────────────────

describe('⑤ 물리 삭제', () => {
  test('블록이 지워지면 공개 링크도 함께 간다(CASCADE)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await topOf(boss)
    const token = published(await publishPage(boss.ctx, doc)).token!
    await query(`DELETE FROM block WHERE id = $1`, [doc])
    const left = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM public_link WHERE token = $1`, [token])
    assert.equal(left.n, 0)
  })
})

// ── ⑥ 설정 ────────────────────────────────────────────────────────────

describe('⑥ [6a-3] 게시된 링크의 설정', () => {
  test('검색 엔진 노출을 켜면 공개 경로가 따른다 · ★ 주소를 바꾸면 옛 주소는 곧바로 닫힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await topOf(boss)
    const first = published(await publishPage(boss.ctx, doc)).token!

    const indexed = await updatePublicLink(boss.ctx, doc, { robots: 'index' })
    assert.ok(indexed.ok, JSON.stringify(indexed))
    assert.equal(indexed.value.robots, 'index')
    assert.equal(indexed.value.token, first, '설정만 바꾸면 주소는 그대로')
    const open = await resolvePublicPage(first)
    assert.ok(open.ok)
    assert.equal(open.value.robots, 'index')

    const rotated = await updatePublicLink(boss.ctx, doc, { rotateToken: true })
    assert.ok(rotated.ok)
    const second = rotated.value.token!
    assert.notEqual(second, first)
    assert.equal(await opens(first), 'not_found', '옛 주소는 곧바로 닫힌다')
    assert.equal(await opens(second), 'open')
    assert.equal(rotated.value.robots, 'index', '주소를 바꿔도 설정은 그대로')
  })

  test('게시되어 있지 않으면 not_published · 틀린 몸체는 invalid_input · 편집자는 forbidden · 못 보면 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const editor = await person('편집자')
    const stranger = await person('모르는 사람')
    const doc = await topOf(boss)
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: editor.userId }, 'edit')).ok)

    assert.deepEqual(await updatePublicLink(boss.ctx, doc, { robots: 'index' }), { ok: false, reason: 'not_published' })
    published(await publishPage(boss.ctx, doc))
    assert.ok((await unpublishPage(boss.ctx, doc)).ok)
    assert.deepEqual(await updatePublicLink(boss.ctx, doc, { rotateToken: true }), { ok: false, reason: 'not_published' })
    published(await publishPage(boss.ctx, doc))

    for (const bad of [{}, null, [], { robots: 'all' }, { rotateToken: false }, { robots: 'index', extra: 1 }, { aiCrawler: 'allow' }]) {
      assert.deepEqual(await updatePublicLink(boss.ctx, doc, bad), { ok: false, reason: 'invalid_input' }, JSON.stringify(bad))
    }
    assert.deepEqual(await updatePublicLink(editor.ctx, doc, { robots: 'index' }), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await updatePublicLink(stranger.ctx, doc, { robots: 'index' }), { ok: false, reason: 'not_found' })
  })
})

// ── ⑦ 위 페이지의 게시 ────────────────────────────────────────────────

describe('⑦ [6a-3] ★ 위 페이지의 게시로 공개되었는가', () => {
  test('가장 가까운 게시된 위 페이지 — id · 제목 · 상속을 끊으면 · 해제하면 · 정책이 막으면 덮지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const top = await topOf(boss)
    const doc = await childOf(boss, top)
    const sub = await childOf(boss, doc)
    const cut = await childOf(boss, doc)
    published(await publishPage(boss.ctx, top))
    published(await publishPage(boss.ctx, doc))
    assert.ok((await stopInheriting(boss.ctx, cut)).ok)

    const covered = async (id: string) => {
      const state = await readPublishState(boss.ctx, id)
      assert.ok(state.ok)
      return state.value.coveredBy
    }
    const nearest = await covered(sub)
    assert.equal(nearest?.pageId, doc, '가장 가까운 것')
    assert.match(nearest?.title ?? '', /^하위/)
    assert.equal(await covered(cut), null, '상속을 끊은 하위는 덮이지 않는다')
    assert.equal(await covered(top), null, '자기 게시는 덮임이 아니다')

    assert.ok((await unpublishPage(boss.ctx, doc)).ok)
    assert.equal((await covered(sub))?.pageId, top, '가까운 것을 해제하면 그 위')
    await withPolicy(boss, false)
    assert.equal(await covered(sub), null, '정책이 막으면 아무것도 덮지 않는다')
  })

  test('볼 수 없는 위 페이지는 id · 제목 없이 — 공개되어 있다는 사실만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const viewer = await person('하위만 보는 사람')
    const doc = await topOf(boss)
    const sub = await childOf(boss, doc)
    assert.ok((await grantAccess(boss.ctx, sub, { type: 'user', id: viewer.userId }, 'view')).ok)
    published(await publishPage(boss.ctx, doc))

    const state = await readPublishState(viewer.ctx, sub)
    assert.ok(state.ok, JSON.stringify(state))
    assert.deepEqual(state.value.coveredBy, { pageId: null, title: null })
  })
})
