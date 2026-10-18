/**
 * 요청 메모 — 화면 요청 하나 안에서 권한의 읽기를 한 번만 (플랫폼 잔여 10l-1 · F-12-07)
 *
 * 지키는 것 넷.
 *   ① 메모가 꺼진 ctx(API · 협업 서버 · 명령의 길)는 읽기 트랜잭션마다 다시 읽는다 — 그룹을 더하면 다음 읽기가 본다(지금까지의 동작).
 *   ② 메모를 켠 ctx 는 요청 안에서 처음 읽은 것을 다시 쓴다 — 그 뒤 더한 그룹은 보이지 않는다(받아들이는 낡음 · 요청 하나의 길이).
 *   ③ 켜도 **쓰기 트랜잭션**은 메모를 지나지 않는다 — 명령의 판정은 자기 스냅샷(§3.3-183).
 *   ④ 스코프 판정의 묶음 질의(`chainInputsMany`)는 사슬마다 따로 읽던 것과 같은 답이다 — 다른 스코프의 행이 섞여 들지 않는다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Fixture, type Actor } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { createGroup, addGroupMember } from '../workspace/group.ts'
import { grantAccess, revokeAccess } from './acl.ts'
import { effectiveCaps, principalsFor, readableScopes } from './effective.ts'
import { can } from './levels.ts'
import { enableRequestMemo, requestMemoStats } from './request-memo.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import { resolveSessionContext } from '../auth/session-context.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let member: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  member = await joinAs(fx.workspaceId, await createUser('메모 멤버'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

/** 같은 사람의 **새** 세션 컨텍스트 — 요청 하나를 흉내 낸다(메모는 ctx 객체에 매인다). */
const freshCtx = async (actor: Actor) => {
  const resolved = await resolveSessionContext(actor.token, fx.workspaceId)
  assert.ok(resolved.ok, '세션을 해석하지 못했다')
  return resolved.context
}

const groupIdsOf = (principals: readonly { type: string; id: string | null }[]) =>
  principals.filter((p) => p.type === 'group').map((p) => p.id)

describe('① 메모가 꺼진 ctx — 읽기 트랜잭션마다 다시 읽는다', () => {
  test('그룹을 더하면 다음 읽기 트랜잭션이 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = await freshCtx(member)
    const group = await createGroup(fx.owner.ctx, '꺼진 메모의 그룹')
    assert.ok(group.ok)
    const before = await withReadTransaction((tx) => principalsFor(tx, ctx))
    assert.ok(!groupIdsOf(before).includes(group.value.id))
    const added = await addGroupMember(fx.owner.ctx, group.value.id, member.userId)
    assert.ok(added.ok)
    const afterwards = await withReadTransaction((tx) => principalsFor(tx, ctx))
    assert.ok(groupIdsOf(afterwards).includes(group.value.id), '꺼진 ctx 가 옛 그룹을 돌려줬다')
    assert.equal(requestMemoStats(ctx), null)
  })
})

describe('★ ② 메모를 켠 ctx — 요청 안에서 처음 읽은 것을 다시 쓴다', () => {
  test('★ 둘째 읽기 트랜잭션은 질의하지 않고 첫 답을 준다 — 그 사이에 더한 그룹은 보이지 않는다(요청 하나의 낡음)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = await freshCtx(member)
    enableRequestMemo(ctx)
    const group = await createGroup(fx.owner.ctx, '켠 메모의 그룹')
    assert.ok(group.ok)
    const first = await withReadTransaction((tx) => principalsFor(tx, ctx))
    assert.ok(!groupIdsOf(first).includes(group.value.id))
    const added = await addGroupMember(fx.owner.ctx, group.value.id, member.userId)
    assert.ok(added.ok)
    const second = await withReadTransaction((tx) => principalsFor(tx, ctx))
    assert.deepEqual(second, first, '요청 안에서 다시 읽었다')
    assert.deepEqual(requestMemoStats(ctx), { hits: 1, misses: 1 })
    // 새 요청(새 ctx)은 본다
    const next = await freshCtx(member)
    const fresh = await withReadTransaction((tx) => principalsFor(tx, next))
    assert.ok(groupIdsOf(fresh).includes(group.value.id))
  })

  test('★ 노드 판정도 노드마다 한 번 — 요청 안에서 ACL 을 바꿔도 첫 답 · 다른 노드는 따로 읽는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = await freshCtx(member)
    enableRequestMemo(ctx)
    const page = (await createPage(fx.owner.ctx, { title: titleFromPlainText('노드 메모') })).id
    const other = (await createPage(fx.owner.ctx, { title: titleFromPlainText('다른 노드') })).id
    const canViewBefore = can(await withReadTransaction((tx) => effectiveCaps(tx, ctx, page)), 'view')
    assert.ok(canViewBefore, '전제 — 루트 페이지는 모두 본다')
    // 상속을 끊고(루트의 부여 — 소유자 · 모든 멤버 — 가 복사된다 · P1) 모든 멤버 행을 거둔다 → 멤버는 못 본다. 새 요청이면 false, 같은 요청이면 첫 답(true)
    // 루트의 유일한 행은 ('workspace_everyone', full_access) — 그것만 거두면 고아(would_orphan)라 소유자에게 먼저 직접 준다
    assert.ok((await grantAccess(fx.owner.ctx, page, { type: 'user', id: fx.owner.userId }, 'full_access')).ok)
    const revoked = await revokeAccess(fx.owner.ctx, page, { type: 'workspace_everyone' })
    assert.ok(revoked.ok, JSON.stringify(revoked))
    const fresh = await freshCtx(member)
    assert.ok(!can(await withReadTransaction((tx) => effectiveCaps(tx, fresh, page)), 'view'), '전제 — 새 요청은 못 본다')
    assert.ok(can(await withReadTransaction((tx) => effectiveCaps(tx, ctx, page)), 'view'), '같은 요청은 첫 답을 다시 쓴다')
    assert.ok(can(await withReadTransaction((tx) => effectiveCaps(tx, ctx, other)), 'view'), '다른 노드는 따로 읽는다')
    const stats = requestMemoStats(ctx)
    assert.ok(stats !== null && stats.hits >= 1 && stats.misses >= 2, JSON.stringify(stats))
  })

  test('★ ③ 켜도 쓰기 트랜잭션은 메모를 지나지 않는다 — 명령의 판정은 자기 스냅샷', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = await freshCtx(member)
    enableRequestMemo(ctx)
    const group = await createGroup(fx.owner.ctx, '쓰기 트랜잭션의 그룹')
    assert.ok(group.ok)
    await withReadTransaction((tx) => principalsFor(tx, ctx))
    assert.ok((await addGroupMember(fx.owner.ctx, group.value.id, member.userId)).ok)
    const inWrite = await withTransaction((tx) => principalsFor(tx, ctx))
    assert.ok(groupIdsOf(inWrite).includes(group.value.id), '쓰기 트랜잭션이 메모의 옛 답을 받았다')
    const inRead = await withReadTransaction((tx) => principalsFor(tx, ctx))
    assert.ok(!groupIdsOf(inRead).includes(group.value.id), '읽기 트랜잭션은 요청 안의 첫 답')
  })
})

describe('★ ④ 스코프 판정의 묶음 질의 — 사슬마다 따로 읽던 것과 같은 답', () => {
  test('★ 다른 스코프의 행이 섞여 들지 않는다 — 한 사람에게만 준 두 스코프는 저마다 그 사람에게만 보인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const a = await joinAs(fx.workspaceId, await createUser('스코프 가'), 'member')
    const b = await joinAs(fx.workspaceId, await createUser('스코프 나'), 'member')
    const pageA = (await createPage(fx.owner.ctx, { title: titleFromPlainText('가만 보는 페이지') })).id
    const pageB = (await createPage(fx.owner.ctx, { title: titleFromPlainText('나만 보는 페이지') })).id
    for (const [page, who] of [[pageA, a], [pageB, b]] as const) {
      // 루트의 유일한 행(모든 멤버)을 거두기 전에 소유자 · 그 사람에게 직접 준다(would_orphan 을 피한다)
      assert.ok((await grantAccess(fx.owner.ctx, page, { type: 'user', id: fx.owner.userId }, 'full_access')).ok)
      assert.ok((await grantAccess(fx.owner.ctx, page, { type: 'user', id: who.userId }, 'view')).ok)
      const revoked = await revokeAccess(fx.owner.ctx, page, { type: 'workspace_everyone' })
      assert.ok(revoked.ok, JSON.stringify(revoked))
    }
    const scopesA = await withReadTransaction((tx) => readableScopes(tx, a.ctx))
    const scopesB = await withReadTransaction((tx) => readableScopes(tx, b.ctx))
    assert.ok(scopesA.includes(pageA) && !scopesA.includes(pageB), JSON.stringify({ scopesA, pageA, pageB }))
    assert.ok(scopesB.includes(pageB) && !scopesB.includes(pageA), JSON.stringify({ scopesB, pageA, pageB }))
    // 소유자는 둘 다(자기 user 행이 남았다) · 다른 멤버는 둘 다 못 본다
    const owner = await withReadTransaction((tx) => readableScopes(tx, fx.owner.ctx))
    assert.ok(owner.includes(pageA) && owner.includes(pageB))
    const stranger = await withReadTransaction((tx) => readableScopes(tx, member.ctx))
    assert.ok(!stranger.includes(pageA) && !stranger.includes(pageB))
  })
})
