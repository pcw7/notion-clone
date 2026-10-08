/**
 * 고유 ID — 번호를 언제 · 어떻게 주는가 (DB 심화 2a-1조각 · F-03-09, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 고유 ID
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 더하면 채운다 — 있던 행에 **만든 순서대로** 1 부터, **휴지통의 행도**, 템플릿은 빼고. 카운터는 그 개수만큼 오른다
 *   ② ★ 그 뒤로 만든 행은 다음 번호를 받는다 — 템플릿은 받지 않는다(U2). 템플릿으로 만든 행은 받는다
 *   ③ ★ 번호는 바뀌지 않고 다시 쓰이지 않는다 — 휴지통에 보내도 남고, ID 프로퍼티를 지웠다 **다시 더하면 옛 번호가 그대로**,
 *        그 사이에 만든 행만 새 번호를 받는다. 지운 것을 되살려도 같다
 *   ④ ID 프로퍼티는 하나뿐이다(U1) — 둘째는 `unique_id_exists`, 새것이 있는 동안 옛것을 되살릴 수도 없다
 *   ⑤ 접두사 — 더할 때 · 고칠 때 받아 대문자로, 틀리면 `invalid_config` 이고 아무것도 남지 않는다. 다른 프로퍼티에는 못 준다
 *   ⑥ 읽기 — 행 요약 · 목록 · 질의가 번호를, 뷰의 컬럼이 접두사를 싣는다. 셀로는 쓸 수 없다
 *   ⑦ ★ 필터 · 정렬 — 번호로 거르고 정렬하고, 커서로 이어 읽어도 빠지거나 겹치는 행이 없다
 *   ⑧ ★ 행 만들기와 ID 프로퍼티 더하기가 엇갈려도 번호 없는 행 · 겹치는 번호가 없다
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { withReadTransaction } from '../db/tx.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, deleteProperty, getSchema, restoreProperty, updateProperty } from './property.ts'
import { createRow, listRows, trashRow, updateCells } from './row.ts'
import { createRowFromTemplate, createTemplate } from './template.ts'
import { getView } from './view.ts'
import { queryRows } from './query.ts'
import { isCellColumn } from './view-columns.ts'

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

async function newTable(name: string) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const schema = unwrap(await getSchema(fx.owner.ctx, created.dataSourceId))
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const ds = created.dataSourceId
  return {
    ds,
    viewId: created.defaultViewId,
    titleId,
    row: async (title: string) =>
      unwrap(
        await createRow(fx.owner.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] }),
      ).id,
    addId: async (input: { name?: string; prefix?: unknown } = {}) =>
      addProperty(fx.owner.ctx, ds, { name: input.name ?? 'ID', type: 'unique_id', ...(input.prefix !== undefined ? { prefix: input.prefix } : {}) }),
    idProperty: async () => unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'unique_id'),
  }
}

/** 행 id → 번호(템플릿 포함 · 휴지통 포함). */
async function seqs(ds: string): Promise<Map<string, number | null>> {
  const rows = await withReadTransaction((tx) =>
    tx.query<{ id: string; unique_seq: string | null }>(`SELECT id, unique_seq FROM page WHERE data_source_id = $1`, [ds]),
  )
  return new Map(rows.map((r) => [r.id, r.unique_seq === null ? null : Number(r.unique_seq)]))
}

async function counter(ds: string): Promise<number> {
  const row = await withReadTransaction((tx) =>
    tx.queryOne<{ unique_id_counter: string }>(`SELECT unique_id_counter FROM data_source WHERE id = $1`, [ds]),
  )
  return Number(row.unique_id_counter)
}

describe('① 더하면 채운다', () => {
  test('★ 만든 순서대로 1 부터 — 휴지통의 행도, 템플릿은 빼고. 카운터는 그 개수만큼', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('채우기')
    const a = await table.row('가')
    const b = await table.row('나')
    const c = await table.row('다')
    unwrap(await trashRow(fx.owner.ctx, b))
    const template = unwrap(await createTemplate(fx.owner.ctx, table.ds, { title: '틀' })).id

    // 더하기 전에는 아무도 번호가 없다 — 번호는 ID 프로퍼티가 있을 때만 준다(정본 ②).
    assert.deepEqual([...(await seqs(table.ds)).values()], [null, null, null, null])
    assert.equal(await counter(table.ds), 0)

    unwrap(await table.addId())
    const got = await seqs(table.ds)
    assert.deepEqual([got.get(a), got.get(b), got.get(c), got.get(template)], [1, 2, 3, null])
    assert.equal(await counter(table.ds), 3)
  })

  test('행이 없는 표에 더해도 카운터는 그대로다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('빈 표')
    unwrap(await table.addId())
    assert.equal(await counter(table.ds), 0)
    const first = await table.row('첫 행')
    assert.equal((await seqs(table.ds)).get(first), 1)
  })
})

describe('② 그 뒤로 만든 행', () => {
  test('★ 다음 번호를 받는다 — 템플릿은 받지 않고, 템플릿으로 만든 행은 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('발급')
    await table.row('가')
    unwrap(await table.addId())
    const b = await table.row('나')
    const template = unwrap(await createTemplate(fx.owner.ctx, table.ds, { title: '틀' })).id
    const fromTemplate = unwrap(await createRowFromTemplate(fx.owner.ctx, table.ds, template)).row.id
    const got = await seqs(table.ds)
    assert.equal(got.get(b), 2)
    assert.equal(got.get(template), null)
    assert.equal(got.get(fromTemplate), 3)
    assert.equal(await counter(table.ds), 3)
  })
})

describe('③ 바뀌지 않고 다시 쓰이지 않는다', () => {
  test('휴지통에 보내도 번호가 남고, 그 번호는 다시 나오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('구멍')
    unwrap(await table.addId())
    await table.row('가')
    const b = await table.row('나')
    unwrap(await trashRow(fx.owner.ctx, b))
    const c = await table.row('다')
    const got = await seqs(table.ds)
    assert.equal(got.get(b), 2)
    assert.equal(got.get(c), 3)
  })

  test('★ 지웠다 다시 더하면 옛 번호가 그대로 — 그 사이에 만든 행만 새 번호', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('다시 더하기')
    const a = await table.row('가')
    const b = await table.row('나')
    unwrap(await table.addId({ prefix: 'old' }))
    const first = (await table.idProperty())!.id
    unwrap(await deleteProperty(fx.owner.ctx, table.ds, first))

    const c = await table.row('다') // ID 프로퍼티가 없는 동안 — 번호가 없다
    assert.equal((await seqs(table.ds)).get(c), null)

    unwrap(await table.addId({ name: '새 ID' }))
    const got = await seqs(table.ds)
    assert.deepEqual([got.get(a), got.get(b), got.get(c)], [1, 2, 3])
    // 접두사를 안 보냈으면 옛 접두사가 그대로다(번호와 같은 규칙).
    assert.equal((await table.idProperty())!.prefix, 'OLD')
  })

  test('★ 지운 것을 되살려도 같다 — 그 사이에 만든 행을 채운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('되살리기')
    const a = await table.row('가')
    unwrap(await table.addId())
    const id = (await table.idProperty())!.id
    unwrap(await deleteProperty(fx.owner.ctx, table.ds, id))
    const b = await table.row('나')
    unwrap(await restoreProperty(fx.owner.ctx, table.ds, id))
    const got = await seqs(table.ds)
    assert.deepEqual([got.get(a), got.get(b)], [1, 2])
    const c = await table.row('다')
    assert.equal((await seqs(table.ds)).get(c), 3)
  })
})

describe('④ 하나뿐이다', () => {
  test('둘째는 unique_id_exists — 아무것도 남지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('하나')
    unwrap(await table.addId())
    const before = unwrap(await getSchema(fx.owner.ctx, table.ds))
    const second = await table.addId({ name: '둘째 ID' })
    assert.equal(second.ok, false)
    assert.equal(!second.ok && second.reason, 'unique_id_exists')
    const after = unwrap(await getSchema(fx.owner.ctx, table.ds))
    assert.equal(after.schemaVersion, before.schemaVersion)
    assert.equal(after.properties.filter((p) => p.type === 'unique_id').length, 1)
  })

  test('새것이 있는 동안 옛것을 되살릴 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('되살릴 수 없다')
    unwrap(await table.addId())
    const old = (await table.idProperty())!.id
    unwrap(await deleteProperty(fx.owner.ctx, table.ds, old))
    unwrap(await table.addId({ name: '새 ID' }))
    const restored = await restoreProperty(fx.owner.ctx, table.ds, old)
    assert.equal(!restored.ok && restored.reason, 'unique_id_exists')
  })
})

describe('⑤ 접두사', () => {
  test('더할 때 받아 대문자로 — 틀리면 invalid_config 이고 프로퍼티도 생기지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('접두사')
    const bad = await table.addId({ prefix: 'TA-SK' })
    assert.equal(!bad.ok && bad.reason, 'invalid_config')
    assert.equal(await table.idProperty(), undefined)

    unwrap(await table.addId({ prefix: ' task ' }))
    assert.equal((await table.idProperty())!.prefix, 'TASK')
  })

  test('고칠 때 — 바꾸기 · 지우기 · 틀린 값 · ID 가 아닌 프로퍼티', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('접두사 고치기')
    unwrap(await table.addId())
    const id = (await table.idProperty())!
    assert.equal(id.prefix, null)

    const set = unwrap(await updateProperty(fx.owner.ctx, table.ds, id.id, { prefix: 'bug' }))
    assert.equal(set.properties.find((p) => p.id === id.id)!.prefix, 'BUG')

    const wrong = await updateProperty(fx.owner.ctx, table.ds, id.id, { prefix: 'TOOLONGX' })
    assert.equal(!wrong.ok && wrong.reason, 'invalid_config')
    assert.equal((await table.idProperty())!.prefix, 'BUG')

    const onTitle = await updateProperty(fx.owner.ctx, table.ds, table.titleId, { prefix: 'ABC' })
    assert.equal(!onTitle.ok && onTitle.reason, 'invalid_config')
    assert.equal((await table.idProperty())!.prefix, 'BUG')

    const cleared = unwrap(await updateProperty(fx.owner.ctx, table.ds, id.id, { prefix: null }))
    assert.equal(cleared.properties.find((p) => p.id === id.id)!.prefix, null)
  })

  test('다른 타입에 접두사 · ID 에 config 를 주면 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('설정 모양')
    const onNumber = await addProperty(fx.owner.ctx, table.ds, { name: '숫자', type: 'number', prefix: 'ABC' })
    assert.equal(!onNumber.ok && onNumber.reason, 'invalid_config')
    const withConfig = await addProperty(fx.owner.ctx, table.ds, { name: 'ID', type: 'unique_id', config: { prefix: 'ABC' } })
    assert.equal(!withConfig.ok && withConfig.reason, 'invalid_config')
  })
})

describe('⑥ 읽기', () => {
  test('행 요약 · 목록 · 질의가 번호를, 뷰의 컬럼이 접두사를 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('읽기')
    unwrap(await table.addId({ prefix: 'RD' }))
    const made = unwrap(
      await createRow(fx.owner.ctx, table.ds, { cells: [{ propertyId: table.titleId, value: { type: 'title', title: [textRun('가')] } }] }),
    )
    assert.equal(made.uniqueSeq, 1)
    assert.deepEqual(unwrap(await listRows(fx.owner.ctx, table.ds)).rows.map((r) => r.uniqueSeq), [1])
    assert.deepEqual(unwrap(await queryRows(fx.owner.ctx, table.ds)).rows.map((r) => r.uniqueSeq), [1])

    const view = unwrap(await getView(fx.owner.ctx, table.viewId))
    const column = view.columns.find((c) => c.type === 'unique_id')
    assert.ok(column !== undefined, '뷰에 ID 컬럼이 선다')
    assert.equal(isCellColumn(column), false)
    assert.deepEqual(column.type === 'unique_id' && column.uniqueId, { prefix: 'RD' })
  })

  test('셀로는 쓸 수 없다 — 값은 행에 있다(C1)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('쓰기 거부')
    const row = await table.row('가')
    unwrap(await table.addId())
    const id = (await table.idProperty())!.id
    const written = await updateCells(fx.owner.ctx, row, {
      cells: [{ propertyId: id, value: { type: 'number', number: 99 } as never }],
    })
    assert.equal(written.ok, false)
    assert.equal((await seqs(table.ds)).get(row), 1)
  })
})

describe('⑦ 필터 · 정렬', () => {
  test('★ 번호로 거르고 정렬한다 — 커서로 이어 읽어도 빠지거나 겹치지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('거르기')
    unwrap(await table.addId())
    for (const name of ['가', '나', '다', '라', '마']) await table.row(name)
    const id = (await table.idProperty())!.id

    const titles = async (input: Parameters<typeof queryRows>[2]) =>
      unwrap(await queryRows(fx.owner.ctx, table.ds, input)).rows.map((r) => r.title)

    assert.deepEqual(await titles({ filter: { property_id: id, operator: 'greater_than', value: 3 } }), ['라', '마'])
    assert.deepEqual(await titles({ filter: { property_id: id, operator: 'equals', value: '2' } }), ['나'])
    assert.deepEqual(await titles({ filter: { property_id: id, operator: 'does_not_equal', value: 1 } }), ['나', '다', '라', '마'])
    // 숫자가 아닌 값이어도 질의가 죽지 않는다 — 걸리는 행이 없을 뿐이다.
    assert.deepEqual(await titles({ filter: { property_id: id, operator: 'equals', value: 'abc' } }), [])

    const sorts = [{ property_id: id, direction: 'desc' as const }]
    assert.deepEqual(await titles({ sorts }), ['마', '라', '다', '나', '가'])

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page = unwrap(await queryRows(fx.owner.ctx, table.ds, { sorts, limit: 2, cursor }))
      seen.push(...page.rows.map((r) => r.title))
      cursor = page.nextCursor
    } while (cursor !== null)
    assert.deepEqual(seen, ['마', '라', '다', '나', '가'])
  })
})

describe('⑧ 엇갈려도', () => {
  // 행 여럿을 동시에 만들 수 있게 된 뒤(형제 순서 키의 잠금 · HANDOFF §3.3-301) 행 둘 + 더하기로 넓혔다. 순서는 매번 달라지므로
  // 여러 번 돌린다.
  test('★ 행 만들기와 ID 프로퍼티 더하기를 동시에 — 번호 없는 행 · 겹치는 번호가 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    for (let round = 0; round < 8; round += 1) {
      const table = await newTable(`동시 ${round}`)
      await table.row('먼저')
      const [made, added, also] = await Promise.all([table.row('가'), table.addId(), table.row('나')])
      assert.equal(typeof made, 'string')
      assert.equal(typeof also, 'string')
      assert.equal(added.ok, true)
      const got = [...(await seqs(table.ds)).values()]
      assert.equal(got.length, 3)
      assert.ok(got.every((n) => n !== null), `번호 없는 행이 있다: ${JSON.stringify(got)}`)
      assert.deepEqual([...got].sort((x, y) => x! - y!), [1, 2, 3])
      assert.equal(await counter(table.ds), 3)
    }
  })
})
