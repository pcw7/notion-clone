/**
 * 위키 데이터베이스 템플릿 — VF-5 (F-02-23 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 VF-1] ⑧ · [VF-5] 템플릿의 모양
 *
 *   ① ★ Business — 속성 넷(제목 · 소유자 · 태그 · 검증) · 소유자 사람 속성은 하나(검증이 그것에 이어진다) · 뷰 셋과 필터
 *   ② ★ 낮은 플랜 — 검증 속성도 "검증 필요" 뷰도 없다(위키 자체는 플랜을 가리지 않는다)
 *   ③ ★ 권한 — 그 페이지에 만들 수 없는 사람은 만들지 못한다(아무것도 쓰지 않는다)
 *   ④ 템플릿 없이 만들면 전처럼 — 속성은 제목 하나 · 뷰는 하나
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { createInlineDatabase } from './database.ts'

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

async function setup(plan: 'free' | 'business') {
  const ws = await createBareWorkspace('위키 템플릿')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  await setWorkspacePlan(ws, plan)
  const host = (await createPage(boss.ctx, { title: titleFromPlainText('호스트') })).id as string
  return { ws, boss, host }
}

const propsOf = (ds: string) =>
  query<{ id: string; name: string; type: string; config: { owner_property_id?: string } }>(
    `SELECT id, name, type, config FROM property WHERE data_source_id = $1 AND deleted_at IS NULL ORDER BY order_idx`,
    [ds],
  )

const viewsOf = (databaseId: string) =>
  query<{ id: string; name: string; type: string; filter: unknown }>(
    `SELECT id, name, type, filter FROM view WHERE database_id = $1 AND owner_kind = 'database_view' ORDER BY order_idx`,
    [databaseId],
  )

test('① ★ Business — 속성 넷 · 소유자 하나에 검증이 이어진다 · 뷰 셋과 필터', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, host } = await setup('business')
  const r = await createInlineDatabase(boss.ctx, { parentPageId: host, template: 'wiki' })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.value.name, '위키')

  const props = await propsOf(r.value.dataSourceId)
  assert.deepEqual(props.map((p) => [p.name, p.type]), [['이름', 'title'], ['소유자', 'people'], ['태그', 'select'], ['검증', 'verification']])
  assert.equal(props.filter((p) => p.type === 'people').length, 1, '소유자 사람 속성은 하나')
  const owner = props.find((p) => p.name === '소유자')!
  const verify = props.find((p) => p.type === 'verification')!
  assert.equal(verify.config.owner_property_id, owner.id)

  const views = await viewsOf(r.value.id)
  assert.deepEqual(views.map((v) => [v.name, v.type]), [['모든 페이지', 'table'], ['내가 소유한 페이지', 'table'], ['검증 필요', 'table']])
  assert.equal(views[0]!.filter, null)
  assert.deepEqual(views[1]!.filter, { op: 'and', children: [{ property_id: owner.id, operator: 'contains', value: { $context: 'me' } }] })
  assert.deepEqual(views[2]!.filter, { op: 'and', children: [{ property_id: verify.id, operator: 'is_not', value: 'verified' }] })

  // 모든 뷰가 모든 속성을 보이는 컬럼으로 가진다
  for (const v of views) {
    const cols = await query<{ n: string }>(`SELECT count(*) AS n FROM view_property WHERE view_id = $1 AND visible`, [v.id])
    assert.equal(Number(cols[0]!.n), 4, `${v.name} 의 컬럼`)
  }
})

test('② ★ 낮은 플랜 — 검증 속성도 "검증 필요" 뷰도 없다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, host } = await setup('free')
  const r = await createInlineDatabase(boss.ctx, { parentPageId: host, template: 'wiki' })
  assert.equal(r.ok, true)
  if (!r.ok) return
  const props = await propsOf(r.value.dataSourceId)
  assert.deepEqual(props.map((p) => p.name), ['이름', '소유자', '태그'])
  const views = await viewsOf(r.value.id)
  assert.deepEqual(views.map((v) => v.name), ['모든 페이지', '내가 소유한 페이지'])
})

test('③ ★ 권한 — 볼 수만 있는 사람은 만들지 못하고 아무것도 남지 않는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { ws, boss, host } = await setup('business')
  const viewer = await joinAs(ws, await createUser('보는 사람'), 'member')
  assert.equal((await grantAccess(boss.ctx, host, { type: 'user', id: boss.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(boss.ctx, host, { type: 'workspace_everyone', id: null })).ok, true)
  assert.equal((await grantAccess(boss.ctx, host, { type: 'user', id: viewer.userId }, 'view')).ok, true)

  const r = await createInlineDatabase(viewer.ctx, { parentPageId: host, template: 'wiki' })
  assert.equal(r.ok, false)
  const left = await query<{ n: string }>(`SELECT count(*) AS n FROM block WHERE workspace_id = $1 AND type = 'database'`, [ws])
  assert.equal(Number(left[0]!.n), 0)
})

test('④ 템플릿 없이 만들면 전처럼 — 제목 하나 · 뷰 하나', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, host } = await setup('business')
  const r = await createInlineDatabase(boss.ctx, { parentPageId: host })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal((await propsOf(r.value.dataSourceId)).length, 1)
  assert.equal((await viewsOf(r.value.id)).length, 1)
})
