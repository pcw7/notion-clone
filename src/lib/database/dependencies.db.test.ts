/**
 * 종속 관계 — 켜기 · 연결 · 순환 · 끄기 (DB 심화 2b-3조각 · F-03-18, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 종속 관계
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 켜면 같은 표의 relation 짝 — "선행 작업" · "후행 작업"(서로가 짝 · 개수 제한 없음). 두 번 켜도 짝은 하나다
 *   ② ★ 막는 행이 여럿일 수 있다 — 거울상이 후행 작업 칸에 선다 · role 은 선행 작업 엣지에만(DB 가 매긴다)
 *   ③ ★ 순환을 거부한다 — 자기 자신 · 사슬 끝이 처음을 막는 것. 두 칸 모두 · 이유를 말한다 · 아무것도 바뀌지 않는다 · 다이아몬드는 된다
 *   ④ 짝의 한쪽을 따로 지울 수 없다(`managed_property`)
 *   ⑤ ★ 끄면 일반 relation 으로 남는다 — 연결은 그대로 · role 은 지워진다 · 다시 켜면 새 짝(비어 있는 이름)
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { withReadTransaction } from '../db/tx.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { deleteProperty, getSchema } from './property.ts'
import { readRelationConfig } from './property-types.ts'
import { createRow } from './row.ts'
import { linkRows } from './relation.ts'
import { DEPENDENCY_NAMES, disableDependencies, enableDependencies } from './dependencies.ts'

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
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

async function table(name: string) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = created.dataSourceId
  const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  const pair = unwrap(await enableDependencies(fx.owner.ctx, ds))
  const row = async (title: string) =>
    unwrap(await createRow(fx.owner.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] })).id
  return { ds, ...pair, row }
}

async function edges(blockedByPropertyId: string, blockingPropertyId: string) {
  const rows = await withReadTransaction((tx) =>
    tx.query<{ property_id: string; from_page_id: string; to_page_id: string; role: string | null }>(
      `SELECT property_id, from_page_id, to_page_id, role FROM relation_edge WHERE property_id = ANY($1::text[])`,
      [[blockedByPropertyId, blockingPropertyId]],
    ),
  )
  const blockersOf = (id: string) =>
    rows.filter((r) => r.property_id === blockedByPropertyId && r.from_page_id === id).map((r) => r.to_page_id).sort()
  const blockingOf = (id: string) =>
    rows.filter((r) => r.property_id === blockingPropertyId && r.from_page_id === id).map((r) => r.to_page_id).sort()
  return { rows, blockersOf, blockingOf }
}

describe('① 켜기', () => {
  test('★ 같은 표의 relation 짝 — 서로가 짝 · 개수 제한 없음 · 두 번 켜도 하나', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, blockedByPropertyId, blockingPropertyId } = await table('켜기')
    const schema = unwrap(await getSchema(fx.owner.ctx, ds))
    const blockedBy = schema.properties.find((p) => p.id === blockedByPropertyId)!
    const blocking = schema.properties.find((p) => p.id === blockingPropertyId)!
    assert.deepEqual([blockedBy.name, blocking.name], [DEPENDENCY_NAMES.blockedBy, DEPENDENCY_NAMES.blocking])
    assert.deepEqual(readRelationConfig(blockedBy.config), { target_data_source_id: ds, synced_property_id: blockingPropertyId, dependencies: 'blocked_by' })
    assert.deepEqual(readRelationConfig(blocking.config), { target_data_source_id: ds, synced_property_id: blockedByPropertyId, dependencies: 'blocking' })
    const again = unwrap(await enableDependencies(fx.owner.ctx, ds))
    assert.equal(again.blockedByPropertyId, blockedByPropertyId)
    assert.equal(again.schema.properties.filter((p) => p.type === 'relation').length, 2)
  })
})

describe('② 막는 행이 여럿', () => {
  test('★ 거울상이 후행 작업 칸에 선다 — role 은 선행 작업 엣지에만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { blockedByPropertyId, blockingPropertyId, row } = await table('여럿')
    const [a, b, c] = [await row('가'), await row('나'), await row('다')]
    unwrap(await linkRows(fx.owner.ctx, a, blockedByPropertyId, { add: [b, c] }))
    const e = await edges(blockedByPropertyId, blockingPropertyId)
    assert.deepEqual(e.blockersOf(a), [b, c].sort())
    assert.deepEqual(e.blockingOf(b), [a])
    assert.deepEqual(e.blockingOf(c), [a])
    assert.ok(e.rows.every((r) => (r.property_id === blockedByPropertyId ? r.role === 'dependency' : r.role === null)), JSON.stringify(e.rows))
  })
})

describe('③ 순환', () => {
  test('★ 자기 자신 · 사슬 끝이 처음을 막는 것 — 두 칸 모두 거부 · 아무것도 바뀌지 않는다 · 다이아몬드는 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { blockedByPropertyId, blockingPropertyId, row } = await table('순환')
    const [a, b, c, d] = [await row('가'), await row('나'), await row('다'), await row('라')]
    // 다이아몬드: a 는 b · c 에 막히고, b · c 는 d 에 막힌다.
    unwrap(await linkRows(fx.owner.ctx, a, blockedByPropertyId, { add: [b, c] }))
    unwrap(await linkRows(fx.owner.ctx, b, blockedByPropertyId, { add: [d] }))
    unwrap(await linkRows(fx.owner.ctx, c, blockedByPropertyId, { add: [d] }))
    const before = (await edges(blockedByPropertyId, blockingPropertyId)).rows.length

    const cases = [
      ['자기 자신', () => linkRows(fx.owner.ctx, a, blockedByPropertyId, { add: [a] })],
      ['사슬 끝이 처음에게 막힌다(선행 작업 칸)', () => linkRows(fx.owner.ctx, d, blockedByPropertyId, { add: [a] })],
      ['처음이 사슬 끝을 막는다(후행 작업 칸)', () => linkRows(fx.owner.ctx, a, blockingPropertyId, { add: [d] })],
    ] as const
    for (const [label, run] of cases) {
      const result = await run()
      assert.equal(!result.ok && result.reason, 'invalid_value', label)
      assert.match(JSON.stringify(!result.ok && result.issues), /순환/, label)
    }
    assert.equal((await edges(blockedByPropertyId, blockingPropertyId)).rows.length, before)
  })
})

describe('④ 짝을 따로 지울 수 없다', () => {
  test('managed_property', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, blockedByPropertyId, blockingPropertyId } = await table('지우기')
    for (const id of [blockedByPropertyId, blockingPropertyId]) {
      const removed = await deleteProperty(fx.owner.ctx, ds, id)
      assert.equal(!removed.ok && removed.reason, 'managed_property')
    }
  })
})

describe('⑤ 끄기', () => {
  test('★ 일반 relation 으로 남는다 — 연결 그대로 · role 지움 · 다시 켜면 새 짝(비어 있는 이름)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, blockedByPropertyId, blockingPropertyId, row } = await table('끄기')
    const [a, b] = [await row('가'), await row('나')]
    unwrap(await linkRows(fx.owner.ctx, a, blockedByPropertyId, { add: [b] }))
    const schema = unwrap(await disableDependencies(fx.owner.ctx, ds))
    for (const id of [blockedByPropertyId, blockingPropertyId]) {
      assert.equal(readRelationConfig(schema.properties.find((p) => p.id === id)!.config)?.dependencies, undefined)
    }
    const e = await edges(blockedByPropertyId, blockingPropertyId)
    assert.deepEqual(e.blockersOf(a), [b])
    assert.deepEqual(e.rows.map((r) => r.role), [null, null])
    const again = unwrap(await enableDependencies(fx.owner.ctx, ds))
    assert.equal(again.schema.properties.find((p) => p.id === again.blockedByPropertyId)?.name, `${DEPENDENCY_NAMES.blockedBy} 2`)
  })
})
