/**
 * 즐겨찾기 순서 바꾸기 — §7 정리 10n-57 (F-07-16)
 *
 * 정본: 00-canonical-data-model.md 즐겨찾기 절 [보강 10n-57]
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ `before` 앞으로 · null 이면 맨 뒤 — 목록이 그 차례로 · 옮긴 행 하나만 다시 쓴다
 *   ② 제자리면 쓰지 않는다(자기 앞 · 이미 그 이웃 사이)
 *   ③ 자기 즐겨찾기만 — 남의 사람 · 즐겨찾기가 아닌 `before` 는 not_found
 *   ④ ★ 볼 수 없게 된 행도 차례에 남는다 — 다시 보이면 제자리
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { query } from '../db/pool.ts'
import type { BlockId } from '../ids.ts'
import { addFavorite, listFavorites, moveFavorite } from './recent.ts'

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

/** 멤버 하나가 페이지 셋을 차례로 즐겨찾기에 넣는다(가 · 나 · 다). 페이지는 대표가 만들고 모두에게 열려 있다. */
async function world() {
  const ws = await createBareWorkspace('즐겨찾기 순서')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const me: Actor = await joinAs(ws, await createUser('나'), 'member')
  const other: Actor = await joinAs(ws, await createUser('남'), 'member')
  const page = async (title: string): Promise<BlockId> => (await createPage(boss.ctx, { title: titleFromPlainText(title) })).id
  const [ga, na, da] = [await page('가'), await page('나'), await page('다')]
  for (const id of [ga, na, da]) await addFavorite(me.ctx, id)
  const listed = async () => (await listFavorites(me.ctx)).map((f) => f.id)
  const keyOf = async (id: string) =>
    (await query<{ order_key: string }>(`SELECT order_key FROM favorite WHERE user_id = $1 AND block_id = $2`, [me.userId, id]))[0]!.order_key
  // 행을 다시 썼는가 — 같은 값으로 써도 바뀐다(이웃 사이의 키는 다시 내도 같은 값이 나올 수 있어 값으로는 못 본다)
  const versionOf = async (id: string) =>
    (await query<{ v: string }>(`SELECT xmin::text AS v FROM favorite WHERE user_id = $1 AND block_id = $2`, [me.userId, id]))[0]!.v
  return { boss, me, other, ga, na, da, listed, keyOf, versionOf }
}

describe('즐겨찾기 순서 바꾸기 (10n-57)', () => {
  test('★ ① before 앞으로 · null 이면 맨 뒤 — 목록이 그 차례 · 옮긴 행만 다시 쓴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.deepEqual(await w.listed(), [w.ga, w.na, w.da], '전제 — 넣은 차례')
    const [naKey, daKey] = [await w.keyOf(w.na), await w.keyOf(w.da)]
    assert.deepEqual(await moveFavorite(w.me.ctx, w.da, w.ga), { ok: true, value: [w.da, w.ga, w.na] })
    assert.deepEqual(await w.listed(), [w.da, w.ga, w.na])
    assert.equal(await w.keyOf(w.na), naKey, '다른 행은 다시 쓰지 않는다')
    assert.notEqual(await w.keyOf(w.da), daKey)
    assert.deepEqual(await moveFavorite(w.me.ctx, w.da, null), { ok: true, value: [w.ga, w.na, w.da] })
    assert.deepEqual(await w.listed(), [w.ga, w.na, w.da])
  })

  test('② 제자리면 쓰지 않는다 — 자기 앞 · 이미 그 이웃 사이', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const version = await w.versionOf(w.na)
    for (const target of [w.na, w.da]) {
      assert.deepEqual(await moveFavorite(w.me.ctx, w.na, target), { ok: true, value: [w.ga, w.na, w.da] }, String(target))
    }
    assert.equal(await w.versionOf(w.na), version, '행을 다시 쓰지 않았다')
  })

  test('③ 자기 즐겨찾기만 — 남의 사람 · 즐겨찾기가 아닌 before 는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.deepEqual(await moveFavorite(w.other.ctx, w.na, null), { ok: false, reason: 'not_found' })
    const loose = (await createPage(w.boss.ctx, { title: titleFromPlainText('즐겨찾기 아님') })).id
    assert.deepEqual(await moveFavorite(w.me.ctx, w.na, loose), { ok: false, reason: 'not_found' })
    assert.deepEqual(await moveFavorite(w.me.ctx, loose, null), { ok: false, reason: 'not_found' })
    assert.deepEqual(await w.listed(), [w.ga, w.na, w.da], '아무것도 바뀌지 않았다')
  })

  test('★ ④ 볼 수 없게 된 행도 차례에 남는다 — 다시 보이면 제자리', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    // 나를 나에게서 가린다 — 대표만의 페이지로
    assert.ok((await stopInheriting(w.boss.ctx, w.na)).ok)
    assert.ok((await grantAccess(w.boss.ctx, w.na, { type: 'user', id: w.boss.userId }, 'full_access')).ok)
    assert.ok((await revokeAccess(w.boss.ctx, w.na, { type: 'workspace_everyone', id: null })).ok)
    assert.deepEqual(await w.listed(), [w.ga, w.da], '목록은 거른다')
    assert.deepEqual(await moveFavorite(w.me.ctx, w.da, w.ga), { ok: true, value: [w.da, w.ga, w.na] }, '차례에는 남아 있다')
    assert.ok((await grantAccess(w.boss.ctx, w.na, { type: 'workspace_everyone', id: null }, 'edit')).ok)
    assert.deepEqual(await w.listed(), [w.da, w.ga, w.na], '다시 보이면 제자리')
  })
})
