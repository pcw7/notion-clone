/**
 * 하위 항목 — 켜기 · 연결 · 순환 · 옮기기 · 끄기 (DB 심화 2b-1조각 · F-03-18, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 하위 항목
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 켜면 같은 표의 relation 짝 — "상위 항목"(하나만) · "하위 항목"(서로가 짝). 두 번 켜도 짝은 하나다
 *   ② ★ 부모를 두면 거울상이 자식 칸에 선다 — role 은 자식 → 부모 엣지에만(DB 가 매긴다)
 *   ③ ★ 순환을 거부한다 — 자기 자신 · 자기 자손을 부모로 둘 수 없다. 상위 항목 칸에서도 하위 항목 칸에서도 · 이유를 말한다 ·
 *        아무것도 바뀌지 않는다
 *   ④ ★ 부모는 하나다 — 하위 항목 칸에 다른 부모의 행을 더하면 **옮겨 온다**(옛 부모의 칸에서 빠진다). 상위 항목 칸에서 바꿔도 같다
 *   ⑤ 짝의 한쪽을 따로 지울 수 없다(`managed_property`)
 *   ⑥ ★ 끄면 일반 relation 으로 남는다 — 연결은 그대로 · role 은 지워진다 · 다시 켜면 새 짝(이름은 비어 있는 것)
 *   ⑦ ★ 트리 질의(2b-2) — 최상위만 · 이 행의 자식만. 부모가 휴지통이면 자식이 최상위로 보인다(엣지는 남는다) · 필터와 함께 걸린다
 *   ⑧ ★ 하위 항목 `+`(2b-2b) — 부모 밑에 바로 만든다. 연결이 거부되면 행도 남지 않는다(한 트랜잭션) · 꺼진 표면 거부
 *   ⑨ ★ 보드는 부모만(2b-2b) — 카드 · 열의 개수 모두
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
import { createRow, trashRow } from './row.ts'
import { queryRows } from './query.ts'
import { linkRows } from './relation.ts'
import { disableSubItems, enableSubItems, SUB_ITEM_NAMES } from './sub-items.ts'
import { createSubItem } from './sub-item-rows.ts'
import { addProperty } from './property.ts'
import { createView } from './view.ts'
import { queryGroups } from './group.ts'

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

async function tree(name: string) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = created.dataSourceId
  const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  const pair = unwrap(await enableSubItems(fx.owner.ctx, ds))
  const row = async (title: string) =>
    unwrap(await createRow(fx.owner.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] })).id
  return { ds, ...pair, row }
}

/** 행 → 부모 · 자식(엣지에서 바로 — 캐시가 아니다). */
async function edges(parentPropertyId: string, childrenPropertyId: string) {
  const rows = await withReadTransaction((tx) =>
    tx.query<{ property_id: string; from_page_id: string; to_page_id: string; role: string | null }>(
      `SELECT property_id, from_page_id, to_page_id, role FROM relation_edge WHERE property_id = ANY($1::text[])`,
      [[parentPropertyId, childrenPropertyId]],
    ),
  )
  const parentOf = new Map(rows.filter((r) => r.property_id === parentPropertyId).map((r) => [r.from_page_id, r.to_page_id]))
  const childrenOf = (id: string) =>
    rows.filter((r) => r.property_id === childrenPropertyId && r.from_page_id === id).map((r) => r.to_page_id).sort()
  return { rows, parentOf, childrenOf }
}

describe('① 켜기', () => {
  test('★ 같은 표의 relation 짝 — 상위 항목은 하나만 · 서로가 짝 · 두 번 켜도 하나', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, parentPropertyId, childrenPropertyId } = await tree('켜기')
    const schema = unwrap(await getSchema(fx.owner.ctx, ds))
    const parent = schema.properties.find((p) => p.id === parentPropertyId)!
    const children = schema.properties.find((p) => p.id === childrenPropertyId)!
    assert.equal(parent.name, SUB_ITEM_NAMES.parent)
    assert.equal(children.name, SUB_ITEM_NAMES.children)
    assert.deepEqual(readRelationConfig(parent.config), {
      target_data_source_id: ds,
      synced_property_id: childrenPropertyId,
      limit: 'one',
      sub_items: 'parent',
    })
    assert.deepEqual(readRelationConfig(children.config), { target_data_source_id: ds, synced_property_id: parentPropertyId, sub_items: 'children' })

    const again = unwrap(await enableSubItems(fx.owner.ctx, ds))
    assert.deepEqual([again.parentPropertyId, again.childrenPropertyId], [parentPropertyId, childrenPropertyId])
    assert.equal(again.schema.properties.filter((p) => p.type === 'relation').length, 2)
  })
})

describe('② 부모 두기', () => {
  test('★ 거울상이 자식 칸에 선다 — role 은 자식 → 부모 엣지에만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { parentPropertyId, childrenPropertyId, row } = await tree('부모 두기')
    const [a, b] = [await row('가'), await row('나')]
    unwrap(await linkRows(fx.owner.ctx, a, parentPropertyId, { add: [b] }))
    const e = await edges(parentPropertyId, childrenPropertyId)
    assert.equal(e.parentOf.get(a), b)
    assert.deepEqual(e.childrenOf(b), [a])
    assert.deepEqual(
      e.rows.map((r) => [r.property_id === parentPropertyId ? 'parent' : 'children', r.role]).sort(),
      [['children', null], ['parent', 'sub_item']],
    )
  })
})

describe('③ 순환', () => {
  test('★ 자기 자신 · 자기 자손을 부모로 둘 수 없다 — 두 칸 모두 · 아무것도 바뀌지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { parentPropertyId, childrenPropertyId, row } = await tree('순환')
    const [a, b, c] = [await row('가'), await row('나'), await row('다')]
    // c → b → a (c 의 부모는 b, b 의 부모는 a)
    unwrap(await linkRows(fx.owner.ctx, b, parentPropertyId, { add: [a] }))
    unwrap(await linkRows(fx.owner.ctx, c, parentPropertyId, { add: [b] }))
    const before = (await edges(parentPropertyId, childrenPropertyId)).rows.length

    const cases = [
      ['자기 자신', () => linkRows(fx.owner.ctx, a, parentPropertyId, { add: [a] })],
      ['손자를 부모로(상위 항목 칸)', () => linkRows(fx.owner.ctx, a, parentPropertyId, { add: [c] })],
      ['조상을 자식으로(하위 항목 칸)', () => linkRows(fx.owner.ctx, c, childrenPropertyId, { add: [a] })],
    ] as const
    for (const [label, run] of cases) {
      const result = await run()
      assert.equal(result.ok, false, label)
      assert.equal(!result.ok && result.reason, 'invalid_value', label)
      assert.match(JSON.stringify(!result.ok && result.issues), /상위 항목으로 둘 수 없습니다/, label)
    }
    assert.equal((await edges(parentPropertyId, childrenPropertyId)).rows.length, before)
  })
})

describe('④ 부모는 하나', () => {
  test('★ 하위 항목 칸에 다른 부모의 행을 더하면 옮겨 온다 — 옛 부모의 칸에서 빠진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { parentPropertyId, childrenPropertyId, row } = await tree('옮기기')
    const [a, b, c] = [await row('가'), await row('나'), await row('다')]
    unwrap(await linkRows(fx.owner.ctx, b, childrenPropertyId, { add: [a] }))
    unwrap(await linkRows(fx.owner.ctx, c, childrenPropertyId, { add: [a] }))
    const e = await edges(parentPropertyId, childrenPropertyId)
    assert.equal(e.parentOf.get(a), c)
    assert.deepEqual(e.childrenOf(b), [])
    assert.deepEqual(e.childrenOf(c), [a])
  })

  test('상위 항목 칸에서 바꿔도 같다 — 하나만이라 바뀐다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { parentPropertyId, childrenPropertyId, row } = await tree('바꾸기')
    const [a, b, c] = [await row('가'), await row('나'), await row('다')]
    unwrap(await linkRows(fx.owner.ctx, a, parentPropertyId, { add: [b] }))
    unwrap(await linkRows(fx.owner.ctx, a, parentPropertyId, { add: [c] }))
    const e = await edges(parentPropertyId, childrenPropertyId)
    assert.equal(e.parentOf.get(a), c)
    assert.deepEqual(e.childrenOf(b), [])
  })
})

describe('⑤ 짝을 따로 지울 수 없다', () => {
  test('managed_property — 끄기가 그 길이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, parentPropertyId, childrenPropertyId } = await tree('지우기')
    for (const id of [parentPropertyId, childrenPropertyId]) {
      const removed = await deleteProperty(fx.owner.ctx, ds, id)
      assert.equal(!removed.ok && removed.reason, 'managed_property')
    }
  })
})

describe('⑥ 끄기', () => {
  test('★ 일반 relation 으로 남는다 — 연결은 그대로 · role 은 지워진다 · 다시 켜면 새 짝(비어 있는 이름)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, parentPropertyId, childrenPropertyId, row } = await tree('끄기')
    const [a, b] = [await row('가'), await row('나')]
    unwrap(await linkRows(fx.owner.ctx, a, parentPropertyId, { add: [b] }))

    const schema = unwrap(await disableSubItems(fx.owner.ctx, ds))
    for (const id of [parentPropertyId, childrenPropertyId]) {
      const property = schema.properties.find((p) => p.id === id)!
      assert.equal(property.type, 'relation')
      assert.equal(readRelationConfig(property.config)?.sub_items, undefined)
    }
    const e = await edges(parentPropertyId, childrenPropertyId)
    assert.equal(e.parentOf.get(a), b)
    assert.deepEqual(e.rows.map((r) => r.role), [null, null])
    // 이제 일반 relation 이라 지울 수 있다 — 끄기 전에는 managed_property 였다(⑤).
    assert.equal((await deleteProperty(fx.owner.ctx, ds, childrenPropertyId)).ok, true)

    const again = unwrap(await enableSubItems(fx.owner.ctx, ds))
    assert.notEqual(again.parentPropertyId, parentPropertyId)
    assert.equal(again.schema.properties.find((p) => p.id === again.parentPropertyId)?.name, `${SUB_ITEM_NAMES.parent} 2`)
    assert.equal(again.schema.properties.find((p) => p.id === again.childrenPropertyId)?.name, SUB_ITEM_NAMES.children)
  })
})

describe('⑦ 트리 질의 (2b-2)', () => {
  test('★ 최상위만 · 이 행의 자식만 — 부모가 휴지통이면 자식이 최상위로 보인다 · 필터와 함께', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, parentPropertyId, childrenPropertyId, row } = await tree('트리 질의')
    const [a, b, c, d] = [await row('가'), await row('나'), await row('다'), await row('라')]
    // b, c 는 a 의 자식 · d 는 b 의 자식
    unwrap(await linkRows(fx.owner.ctx, b, parentPropertyId, { add: [a] }))
    unwrap(await linkRows(fx.owner.ctx, c, parentPropertyId, { add: [a] }))
    unwrap(await linkRows(fx.owner.ctx, d, parentPropertyId, { add: [b] }))
    const titles = async (under: string | null, filter?: Parameters<typeof queryRows>[2]['filter']) =>
      unwrap(await queryRows(fx.owner.ctx, ds, { tree: { parentPropertyId, under }, ...(filter ? { filter } : {}) })).rows.map((r) => r.title)

    assert.deepEqual(await titles(null), ['가'])
    assert.deepEqual(await titles(a), ['나', '다'])
    assert.deepEqual(await titles(b), ['라'])
    assert.deepEqual(await titles(d), [])

    const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
    assert.deepEqual(await titles(a, { property_id: titleId, operator: 'equals', value: '다' }), ['다'])

    unwrap(await trashRow(fx.owner.ctx, a))
    assert.deepEqual(await titles(null), ['나', '다'], '부모가 휴지통이면 자식이 최상위로 보인다')
    const kept = await edges(parentPropertyId, childrenPropertyId)
    assert.equal(kept.parentOf.get(b), a, '엣지는 남는다 — 복원하면 돌아온다')
  })
})

async function pageCount(ds: string): Promise<number> {
  const row = await withReadTransaction((tx) => tx.queryOne<{ n: string }>(`SELECT count(*) AS n FROM page WHERE data_source_id = $1`, [ds]))
  return Number(row.n)
}

describe('⑧ 하위 항목 + (2b-2b)', () => {
  test('★ 부모 밑에 바로 만든다 — 연결이 거부되면 행도 남지 않는다 · 꺼진 표면 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, parentPropertyId, childrenPropertyId, row } = await tree('하위 항목 +')
    const a = await row('가')
    const child = unwrap(await createSubItem(fx.owner.ctx, ds, a))
    const e = await edges(parentPropertyId, childrenPropertyId)
    assert.equal(e.parentOf.get(child.id), a)
    assert.deepEqual(e.childrenOf(a), [child.id])

    const before = await pageCount(ds)
    const stranger = (await tree('다른 표')).ds
    const otherRow = unwrap(await createRow(fx.owner.ctx, stranger, {})).id
    const refused = await createSubItem(fx.owner.ctx, ds, otherRow)
    assert.equal(!refused.ok && refused.reason, 'invalid_value', '다른 표의 행은 부모가 될 수 없다')
    assert.equal(await pageCount(ds), before, '거부되면 만든 행도 되돌린다')

    unwrap(await disableSubItems(fx.owner.ctx, ds))
    const off = await createSubItem(fx.owner.ctx, ds, a)
    assert.equal(!off.ok && off.reason, 'invalid_value')
    assert.equal(await pageCount(ds), before)
  })
})

describe('⑨ 보드는 부모만 (2b-2b)', () => {
  test('★ 하위 항목이 켜진 표의 보드는 최상위 행만 — 카드도 개수도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const created = unwrap(await createDatabase(fx.owner.ctx, { name: '보드 부모만' }))
    const ds = created.dataSourceId
    unwrap(await addProperty(fx.owner.ctx, ds, { name: '상태', type: 'select' }))
    const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
    const row = async (title: string) =>
      unwrap(await createRow(fx.owner.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] })).id
    const [a, b] = [await row('부모'), await row('둘째 부모')]
    const board = unwrap(await createView(fx.owner.ctx, created.id, { type: 'board' }))
    const cards = async () => {
      const page = unwrap(await queryGroups(fx.owner.ctx, board.id))
      return { titles: page.groups.flatMap((g) => g.rows.map((r) => r.title)).sort(), count: page.groups.reduce((n, g) => n + g.count, 0) }
    }
    assert.deepEqual(await cards(), { titles: ['둘째 부모', '부모'], count: 2 })

    const { parentPropertyId } = unwrap(await enableSubItems(fx.owner.ctx, ds))
    const c = unwrap(await createSubItem(fx.owner.ctx, ds, a)).id
    assert.ok(c)
    unwrap(await linkRows(fx.owner.ctx, b, parentPropertyId, { add: [a] }))
    assert.deepEqual(await cards(), { titles: ['부모'], count: 1 })
  })
})
