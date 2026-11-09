/**
 * 검증 배지 — 검색 결과 · 페이지 멘션의 이름 맵 (VF-4 · F-03-23 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.5 [보강 VF-1] ⑥ ⑦).
 *
 *   ① ★ 검색 결과의 `verification` — 검증됨 · 만료(지금과 견준다) · 검증 안 된 행 · 행이 아닌 페이지는 null
 *   ② ★ 볼 수 없는 데이터베이스의 행은 검색에 없다(기존 권한 필터 그대로)
 *   ③ ★ 멘션 이름 맵 — 검증된 페이지만 `pageVerified` 에 선다(만료 · 검증 안 됨 · 행이 아닌 페이지는 없다) · 볼 수 없는 페이지의 상태는 새지 않는다
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { loadMentionLabels } from '../block/mention-candidates.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { textRun } from '../contracts/rich-text.ts'
import { searchPages } from '../search/search.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import { createRow } from './row.ts'
import { verifyRow } from './verification.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''
let fx: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  await setWorkspacePlan(fx.workspaceId, 'business')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

const DAY = 24 * 60 * 60 * 1000
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString()

/** 데이터베이스 하나 + 행 넷(검증됨 · 만료 · 검증 안 됨) + 행이 아닌 페이지 — 제목은 `stamp` 로 겹치지 않게. */
async function setup(stamp: string) {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name: `위키 ${stamp}` }))
  const schema = unwrap(await getSchema(fx.owner.ctx, db.dataSourceId))
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const added = unwrap(await addProperty(fx.owner.ctx, db.dataSourceId, { name: '검증', type: 'verification' }))
  const prop = added.properties.find((p) => p.type === 'verification')!.id
  const row = async (name: string) =>
    unwrap(await createRow(fx.owner.ctx, db.dataSourceId, { cells: [{ propertyId: titleId, value: { type: 'title' as const, title: [textRun(`${name}${stamp}`)] } }] })).id
  const rows = { ok: await row('배지통과'), gone: await row('배지만료'), none: await row('배지없음') }
  unwrap(await verifyRow(fx.owner.ctx, rows.ok, prop, inDays(30)))
  unwrap(await verifyRow(fx.owner.ctx, rows.gone, prop, inDays(2)))
  // 지난 만료는 명령이 거부한다 — 직접 적는다
  await query(`UPDATE page_property_value SET value = value || $3::jsonb WHERE page_id = $1 AND property_id = $2`, [
    rows.gone,
    prop,
    JSON.stringify({ verified_at: inDays(-10), expires_at: inDays(-1) }),
  ])
  const plain = (await createPage(fx.owner.ctx, { parentPageId: null, title: titleFromPlainText(`배지일반${stamp}`) })).id
  return { db, rows, plain }
}

const verificationOf = async (ctx: Fixture['owner']['ctx'], q: string) => {
  const out = await searchPages(ctx, { query: q })
  assert.equal(out.ok, true)
  return out.ok ? new Map(out.results.results.map((h) => [h.pageId, h.verification])) : new Map()
}

test('① ★ 검색 결과의 verification — 검증됨 · 만료 · 검증 안 됨 · 행이 아닌 페이지는 null', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const stamp = Date.now().toString(36)
  const { rows, plain } = await setup(stamp)
  assert.equal((await verificationOf(fx.owner.ctx, `배지통과${stamp}`)).get(rows.ok), 'verified')
  assert.equal((await verificationOf(fx.owner.ctx, `배지만료${stamp}`)).get(rows.gone), 'expired')
  assert.equal((await verificationOf(fx.owner.ctx, `배지없음${stamp}`)).get(rows.none), null)
  assert.equal((await verificationOf(fx.owner.ctx, `배지일반${stamp}`)).get(plain), null)
})

test('② ★ 볼 수 없는 데이터베이스의 행은 검색에 없다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const stamp = `${Date.now().toString(36)}b`
  const { db, rows } = await setup(stamp)
  const other = await joinAs(fx.workspaceId, await createUser('다른 멤버'), 'member')
  assert.equal((await verificationOf(other.ctx, `배지통과${stamp}`)).get(rows.ok), 'verified', '열려 있을 때는 보인다')
  assert.ok((await stopInheriting(fx.owner.ctx, db.id)).ok)
  assert.ok((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok)
  assert.ok((await revokeAccess(fx.owner.ctx, db.id, { type: 'workspace_everyone', id: null })).ok)
  assert.equal((await verificationOf(other.ctx, `배지통과${stamp}`)).has(rows.ok), false, '막은 뒤에는 결과에 없다')
  assert.equal((await verificationOf(fx.owner.ctx, `배지통과${stamp}`)).get(rows.ok), 'verified', '소유자는 그대로')
})

test('③ ★ 멘션 이름 맵 — 검증된 것만 서고 볼 수 없는 페이지의 상태는 새지 않는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const stamp = `${Date.now().toString(36)}c`
  const { db, rows, plain } = await setup(stamp)
  const other = await joinAs(fx.workspaceId, await createUser('멘션 멤버'), 'member')
  const ids = [rows.ok, rows.gone, rows.none, plain]
  const asOwner = await loadMentionLabels(fx.owner.ctx, { userIds: [], pageIds: ids })
  assert.deepEqual(asOwner.pageVerified, { [rows.ok]: true }, '검증됨만 — 만료 · 안 됨 · 일반 페이지는 없다')
  assert.deepEqual((await loadMentionLabels(other.ctx, { userIds: [], pageIds: ids })).pageVerified, { [rows.ok]: true })

  assert.ok((await stopInheriting(fx.owner.ctx, db.id)).ok)
  assert.ok((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok)
  assert.ok((await revokeAccess(fx.owner.ctx, db.id, { type: 'workspace_everyone', id: null })).ok)
  const hidden = await loadMentionLabels(other.ctx, { userIds: [], pageIds: ids })
  assert.deepEqual(hidden.pageVerified, {}, '볼 수 없는 행의 상태는 없다')
  assert.equal(hidden.pages[rows.ok], null)
})
