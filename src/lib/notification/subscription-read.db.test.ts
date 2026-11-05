/**
 * 알림 받기의 읽기 — 볼 수 있는 사람에게만 답한다 (NM-1 · F-05-17 · DB 필요)
 *
 * 정본 [보강 NM-1] ③: 행이 없으면 기본값(`source` null) · 고르면 `explicit` · 못 보는 페이지는 `not_found`(고르기도 같다) ·
 * 읽기 전용(`view`) 참여자도 고를 수 있다.
 *
 * 반사실: 읽기에서 `view` 검사를 빼면 ③ 이 실패한다(존재를 알려 준다).
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { DEFAULT_LEVEL, readSubscription, setSubscription } from './subscription.ts'

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

test('★ 행이 없으면 기본값 · 고르면 explicit · 읽기 전용 참여자도 고른다 · 못 보는 페이지는 not_found', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const workspaceId = await createBareWorkspace('알림 받기')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const reader = await joinAs(workspaceId, await createUser('읽기만'), 'member')
  const page = await createPage(owner.ctx, { parentPageId: null, title: titleFromPlainText('읽기') })

  // 읽는 사람 쪽은 행이 없다 → 기본값
  const fresh = await readSubscription(reader.ctx, page.id)
  assert.deepEqual(fresh, { ok: true, level: DEFAULT_LEVEL, source: null })

  // 만든 사람은 자동 구독(all_comments)
  const mine = await readSubscription(owner.ctx, page.id)
  assert.deepEqual(mine, { ok: true, level: 'all_comments', source: 'auto_created' })

  // 읽기 전용으로 좁힌다 — 그래도 고른다(view)
  assert.equal((await stopInheriting(owner.ctx, page.id)).ok, true)
  assert.equal((await grantAccess(owner.ctx, page.id, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
  assert.equal((await grantAccess(owner.ctx, page.id, { type: 'user', id: reader.userId }, 'view')).ok, true)
  assert.equal((await revokeAccess(owner.ctx, page.id, { type: 'workspace_everyone' })).ok, true)
  assert.equal((await setSubscription(reader.ctx, page.id, 'none')).ok, true)
  assert.deepEqual(await readSubscription(reader.ctx, page.id), { ok: true, level: 'none', source: 'explicit' })

  // 접근을 거두면 읽기도 고르기도 not_found
  assert.equal((await revokeAccess(owner.ctx, page.id, { type: 'user', id: reader.userId })).ok, true)
  assert.deepEqual(await readSubscription(reader.ctx, page.id), { ok: false, reason: 'not_found' })
  assert.deepEqual(await setSubscription(reader.ctx, page.id, 'all_comments'), { ok: false, reason: 'not_found' })

  // 없는 페이지 · 모양이 틀린 id
  assert.deepEqual(await readSubscription(owner.ctx, randomUUID()), { ok: false, reason: 'not_found' })
  assert.deepEqual(await readSubscription(owner.ctx, 'nope'), { ok: false, reason: 'not_found' })
})
