/**
 * 수식 속성 — 서버 2i-2조각 (F-03-12, DB 필요)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 만들기 — 식은 원문 그대로에 속성 자리만 `⟦id⟧` 로, 결과 타입과 함께 저장된다. 읽는 속성마다 의존 간선 한 줄. 값은 어디에도 없다.
 *      틀린 식(문법 · 없는 속성 · 타입)은 **자리와 이유를 든 채** 거부되고 아무것도 남기지 않는다. 다른 길(일반 속성 추가 · config 덮어쓰기
 *      · 셀 쓰기)로는 수식을 만들거나 고칠 수 없다
 *   ② 그래프 — 순환은 거부(자기 자신 · 둘 사이), 깊이는 15 까지. **표의 수식 전부**로 다시 센다(가운데를 고치면 위가 깊어진다).
 *      지운 수식을 되살려 고리가 생기면 되살리지 않는다
 *   ③ 계산 — 같은 행의 칸을 읽는다(선택은 옵션 이름 · 체크박스 · 날짜 · 수식이 수식을 읽는다). 빈 값은 흐른다. 지금은 바깥에서 받는다
 *   ④ 읽던 속성이 지워지거나 타입이 바뀌면 그 컬럼은 **이유를 든 채** 빈 값 — 되살리면 돌아온다
 *   ⑤ 권한 — 볼 수 없으면 계산도 빈 답이다(존재를 알리지 않는다). 구조를 못 고치면 만들 수 없다
 *   ⑥ 컬럼 — 뷰의 컬럼에 사람이 읽는 식(지금 이름으로)과 결과 타입이 선다
 *
 * 반사실(HANDOFF §3.3): 그래프를 안 보면 ② 가, 되살리기에서 안 보면 ② 의 되살리기가, 읽을 때 다시 읽지 않으면(저장된 결과 타입을 믿으면)
 * ④ 가, 권한을 안 보면 ⑤ 가 실패한다.
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { withReadTransaction } from '../db/tx.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, deleteProperty, getSchema, restoreProperty, updateProperty } from './property.ts'
import { convertProperty } from './property-convert.ts'
import type { CellValue, MvpPropertyType } from './property-types.ts'
import { createRow, listRows, updateCells } from './row.ts'
import { readRecordColumns } from './view.ts'
import { addFormulaProperty, computeFormulaValues, updateFormulaExpression, MAX_FORMULA_DEPTH } from './formula-property.ts'
import { PROP_OPEN, PROP_CLOSE } from '../formula/lexer.ts'

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string; issues?: readonly unknown[] }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? `${r.reason} ${JSON.stringify(r.issues ?? '')}` : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

const num = (n: number | null): CellValue => ({ type: 'number', number: n })
const box = (b: boolean): CellValue => ({ type: 'checkbox', checkbox: b })
const day = (start: string): CellValue => ({ type: 'date', date: { start } })

/** 계산의 기준 시각 — 오늘은 2026-10-10(UTC). */
const NOW = new Date('2026-10-10T09:00:00Z')

async function newTable(name: string) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = created.dataSourceId
  const schema = unwrap(await getSchema(fx.owner.ctx, ds))
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const prop = async (propName: string, type: MvpPropertyType) =>
    unwrap(await addProperty(fx.owner.ctx, ds, { name: propName, type })).properties.find((p) => p.name === propName)!.id
  const formula = async (propName: string, expression: string) => unwrap(await addFormulaProperty(fx.owner.ctx, ds, { name: propName, expression })).propertyId
  const row = async (title: string, cells: Record<string, CellValue> = {}) =>
    unwrap(
      await createRow(fx.owner.ctx, ds, {
        cells: [
          { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
          ...Object.entries(cells).map(([propertyId, value]) => ({ propertyId, value })),
        ],
      }),
    ).id
  /** 이 표의 행 전부의 수식 값(이 사람이 보는 대로). */
  const compute = async (actor: Actor = fx.owner) => {
    const rows = unwrap(await listRows(fx.owner.ctx, ds)).rows
    return computeFormulaValues(actor.ctx, ds, rows, NOW)
  }
  const config = (propertyId: string) =>
    withReadTransaction((tx) => tx.queryOne<{ config: Record<string, unknown> }>(`SELECT config FROM property WHERE id = $1`, [propertyId])).then((r) => r.config)
  const deps = (propertyId: string) =>
    withReadTransaction((tx) =>
      tx.query<{ source: string }>(`SELECT source_property_id AS source FROM property_dependency WHERE dependent_property_id = $1`, [propertyId]),
    ).then((rs) => rs.map((r) => r.source).sort()) // DB 의 정렬(ICU)과 JS 의 정렬이 다르다 — JS 쪽으로 맞춘다
  const version = async () => unwrap(await getSchema(fx.owner.ctx, ds)).schemaVersion
  return { databaseId: created.id, ds, titleId, prop, formula, row, compute, config, deps, version }
}

const slot = (id: string) => `${PROP_OPEN}${id}${PROP_CLOSE}`

const makePrivate = async (databaseId: string, level?: 'view' | 'edit') => {
  assert.equal((await stopInheriting(fx.owner.ctx, databaseId)).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(fx.owner.ctx, databaseId, { type: 'workspace_everyone', id: null })).ok, true)
  if (level !== undefined) {
    assert.equal((await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: other.userId }, level)).ok, true)
  }
}

describe('① 만들기', () => {
  test('★ 식은 `⟦id⟧` 자리로 · 결과 타입과 함께 저장되고 의존 간선이 생긴다 — 값은 어디에도 없다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable('수식 만들기')
    const hours = await t.prop('시간', 'number')
    const rate = await t.prop('단가', 'number')
    const r = await t.row('A', { [hours]: num(3), [rate]: num(50) })

    const before = await t.version()
    const amount = await t.formula('금액', 'prop("시간") * prop("단가") /* 원 */')
    assert.deepEqual(await t.config(amount), { expression: `${slot(hours)} * ${slot(rate)} /* 원 */`, result_type: 'number' }, '원문 그대로(주석까지) · 속성 자리만 id')
    assert.deepEqual(await t.deps(amount), [hours, rate].sort())
    assert.notEqual(await t.version(), before, '스키마 버전이 오른다')

    const schema = unwrap(await getSchema(fx.owner.ctx, t.ds))
    assert.equal(schema.properties.find((p) => p.id === amount)?.type, 'formula')

    const stored = await withReadTransaction(async (tx) => ({
      cells: await tx.query(`SELECT 1 FROM page_property_value WHERE property_id = $1`, [amount]),
      cache: await tx.queryOne<{ cache: Record<string, unknown> }>(`SELECT properties_cache AS cache FROM page WHERE id = $1`, [r]),
    }))
    assert.equal(stored.cells.length, 0)
    assert.equal(amount in stored.cache.cache, false)

    // 결과 타입은 식이 정한다
    const flag = await t.formula('비싼가', 'prop("금액") > 100')
    assert.equal((await t.config(flag)).result_type, 'boolean')
    assert.deepEqual(await t.deps(flag), [amount], '수식이 수식을 읽는다')
  })

  test('★ 틀린 식은 자리와 이유를 든 채 거부되고 아무것도 남기지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable('틀린 식')
    await t.prop('시간', 'number')
    const before = unwrap(await getSchema(fx.owner.ctx, t.ds))

    const cases: [string, number, number][] = [
      ['prop("시간") +', 12, 12], // 식이 끝났다(끝자리)
      ['prop("없는 속성") * 2', 0, 13], // 없는 속성(prop(…) 전체)
      ['prop("시간") + "시간"', 0, 17], // 수 + 글(더하기 전체)
      ['sum(1, ', 7, 7],
    ]
    for (const [expression, start, end] of cases) {
      const r = await addFormulaProperty(fx.owner.ctx, t.ds, { name: '틀림', expression })
      assert.equal(r.ok === false && r.reason, 'invalid_formula', expression)
      if (r.ok) continue
      assert.ok(r.formulaError !== undefined && r.formulaError.message.length > 0, `${expression} — 이유가 있다`)
      assert.deepEqual([r.formulaError.start, r.formulaError.end], [start, end], `${expression} — 자리`)
    }
    const notText = await addFormulaProperty(fx.owner.ctx, t.ds, { name: '틀림', expression: 42 })
    assert.equal(notText.ok === false && notText.reason, 'invalid_formula')
    const noName = await addFormulaProperty(fx.owner.ctx, t.ds, { name: '  ', expression: '1' })
    assert.equal(noName.ok === false && noName.reason, 'invalid_name')
    const dup = await addFormulaProperty(fx.owner.ctx, t.ds, { name: '시간', expression: '1' })
    assert.equal(dup.ok === false && dup.reason, 'duplicate_name')

    const after = unwrap(await getSchema(fx.owner.ctx, t.ds))
    assert.equal(after.schemaVersion, before.schemaVersion, '거부된 명령은 아무것도 바꾸지 않는다')
    assert.deepEqual(after.properties.map((p) => p.name), before.properties.map((p) => p.name))
    const edges = await withReadTransaction((tx) =>
      tx.query(`SELECT 1 FROM property_dependency pd JOIN property p ON p.id = pd.dependent_property_id WHERE p.data_source_id = $1`, [t.ds]),
    )
    assert.equal(edges.length, 0)
  })

  test('다른 길로는 만들거나 고칠 수 없다 — 일반 추가 · config 덮어쓰기 · 셀 쓰기 · 타입 바꾸기', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable('다른 길')
    const hours = await t.prop('시간', 'number')
    const r = await t.row('A', { [hours]: num(1) })
    const f = await t.formula('두 배', 'prop("시간") * 2')

    const viaAdd = await addProperty(fx.owner.ctx, t.ds, { name: '몰래', type: 'formula' as MvpPropertyType, config: { expression: '1', result_type: 'number' } })
    assert.equal(viaAdd.ok === false && viaAdd.reason, 'unsupported_type')
    const viaConfig = await updateProperty(fx.owner.ctx, t.ds, f, { config: { expression: 'prop("두 배")', result_type: 'number' } })
    assert.equal(viaConfig.ok === false && viaConfig.reason, 'invalid_config', 'config 덮어쓰기는 검사를 건너뛴다 — 막는다')
    const viaCell = await updateCells(fx.owner.ctx, r, { cells: [{ propertyId: f, value: num(9) }] })
    assert.equal(viaCell.ok === false && viaCell.reason, 'unknown_property')
    const viaConvert = await convertProperty(fx.owner.ctx, t.ds, f, { type: 'number' })
    assert.equal(viaConvert.ok === false && viaConvert.reason, 'unsupported_type')
    // 수식이 아닌 속성의 식은 고칠 수 없다
    const notFormula = await updateFormulaExpression(fx.owner.ctx, t.ds, hours, { expression: '1' })
    assert.equal(notFormula.ok === false && notFormula.reason, 'unsupported_type')
    const missing = await updateFormulaExpression(fx.owner.ctx, t.ds, 'no-such-property', { expression: '1' })
    assert.equal(missing.ok === false && missing.reason, 'not_found')

    assert.deepEqual(await t.config(f), { expression: `${slot(hours)} * 2`, result_type: 'number' })
  })

  test('★ 식 고치기 — 간선이 새 것으로 바뀌고 결과 타입이 다시 정해진다 · 이름을 바꿔도 식은 그대로다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable('식 고치기')
    const hours = await t.prop('시간', 'number')
    const note = await t.prop('메모', 'rich_text')
    const f = await t.formula('계산', 'prop("시간") + 1')

    const before = await t.version()
    unwrap(await updateFormulaExpression(fx.owner.ctx, t.ds, f, { expression: 'prop("메모") + "!"' }))
    assert.deepEqual(await t.config(f), { expression: `${slot(note)} + "!"`, result_type: 'text' })
    assert.deepEqual(await t.deps(f), [note], '옛 간선(시간)은 지워진다')
    assert.notEqual(await t.version(), before)

    const bad = await updateFormulaExpression(fx.owner.ctx, t.ds, f, { expression: 'prop("메모" ' })
    assert.equal(bad.ok === false && bad.reason, 'invalid_formula')
    assert.deepEqual(await t.deps(f), [note], '거부되면 간선도 그대로')

    // 이름을 바꿔도 저장된 식은 id 라 깨지지 않는다
    unwrap(await updateProperty(fx.owner.ctx, t.ds, note, { name: '비고' }))
    assert.deepEqual(await t.config(f), { expression: `${slot(note)} + "!"`, result_type: 'text' })
    void hours
  })
})

describe('② 그래프 — 순환 · 깊이', () => {
  test('★ 순환은 거부한다 — 자기 자신 · 둘 사이. 거부하면 식도 간선도 그대로다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable('순환')
    const hours = await t.prop('시간', 'number')
    const a = await t.formula('A', 'prop("시간") + 1')
    const b = await t.formula('B', 'prop("A") + 1')

    const self = await updateFormulaExpression(fx.owner.ctx, t.ds, a, { expression: 'prop("A") + 1' })
    assert.equal(self.ok === false && self.reason, 'formula_cycle')
    const loop = await updateFormulaExpression(fx.owner.ctx, t.ds, a, { expression: 'prop("B") + 1' })
    assert.equal(loop.ok === false && loop.reason, 'formula_cycle')

    assert.deepEqual(await t.config(a), { expression: `${slot(hours)} + 1`, result_type: 'number' })
    assert.deepEqual(await t.deps(a), [hours])
    assert.deepEqual(await t.deps(b), [a])
  })

  test(`★ 깊이는 ${MAX_FORMULA_DEPTH} 까지 — 넘는 수식은 만들 수 없고 · 가운데를 고쳐 위가 깊어져도 거부한다`, async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable('깊이')
    await t.prop('시간', 'number')
    let prev = '시간'
    for (let i = 1; i <= MAX_FORMULA_DEPTH; i++) {
      await t.formula(`f${i}`, `prop("${prev}") + 1`)
      prev = `f${i}`
    }
    const tooDeep = await addFormulaProperty(fx.owner.ctx, t.ds, { name: `f${MAX_FORMULA_DEPTH + 1}`, expression: `prop("${prev}") + 1` })
    assert.equal(tooDeep.ok === false && tooDeep.reason, 'formula_too_deep')

    // 맨 아래(f1)가 수식 하나를 더 거치게 고치면 f15 가 16 이 된다 — 표 전체로 다시 센다
    await t.formula('g', 'prop("시간") * 2')
    const schema = unwrap(await getSchema(fx.owner.ctx, t.ds))
    const f1 = schema.properties.find((p) => p.name === 'f1')!.id
    const deeper = await updateFormulaExpression(fx.owner.ctx, t.ds, f1, { expression: 'prop("g") + 1' })
    assert.equal(deeper.ok === false && deeper.reason, 'formula_too_deep')
    // 깊이가 그대로인 고침은 된다
    unwrap(await updateFormulaExpression(fx.owner.ctx, t.ds, f1, { expression: 'prop("시간") + 2' }))
  })

  test('★ 지운 수식을 되살려 고리가 생기면 되살리지 않는다(지운 동안 만든 길)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable('되살리기 고리')
    await t.prop('시간', 'number')
    const a = await t.formula('A', 'prop("시간") + 1')
    const b = await t.formula('B', 'prop("A") + 1')
    await t.formula('C', 'prop("B") + 1')
    unwrap(await deleteProperty(fx.owner.ctx, t.ds, b))
    // B 가 없는 동안 A → C 는 고리가 아니다(C → B 의 B 는 지금 잎이다)
    unwrap(await updateFormulaExpression(fx.owner.ctx, t.ds, a, { expression: 'prop("C") + 1' }))

    const restored = await restoreProperty(fx.owner.ctx, t.ds, b)
    assert.equal(restored.ok === false && restored.reason, 'formula_cycle')
    const schema = unwrap(await getSchema(fx.owner.ctx, t.ds))
    assert.equal(schema.properties.some((p) => p.id === b), false, '되살아나지 않았다')

    // 고리를 풀면 되살릴 수 있다
    unwrap(await updateFormulaExpression(fx.owner.ctx, t.ds, a, { expression: 'prop("시간") + 1' }))
    unwrap(await restoreProperty(fx.owner.ctx, t.ds, b))
  })
})

describe('③ 계산', () => {
  test('★ 같은 행의 칸을 읽는다 — 수 · 선택(옵션 이름) · 체크박스 · 날짜 · 수식이 수식을 · 빈 값은 흐른다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable('계산')
    const hours = await t.prop('시간', 'number')
    const rate = await t.prop('단가', 'number')
    const done = await t.prop('완료', 'checkbox')
    const due = await t.prop('마감', 'date')
    const stage = await t.prop('단계', 'select')
    const review = unwrap(await addSelectOption(fx.owner.ctx, t.ds, stage, { name: '검토' })).option

    const full = await t.row('다 찬 행', { [hours]: num(3), [rate]: num(50), [done]: box(true), [due]: day('2026-10-20'), [stage]: { type: 'select', select: { id: review.id } } })
    const empty = await t.row('빈 행', { [rate]: num(10) })

    const amount = await t.formula('금액', 'prop("시간") * prop("단가")')
    const pricey = await t.formula('비싼가', 'prop("금액") > 100')
    const label = await t.formula('표시', 'prop("단계") + "!"')
    const left = await t.formula('남은 날', 'dateBetween(prop("마감"), today(), "days")')
    const status = await t.formula('상태', 'prop("완료") ? "끝" : "진행"')

    const page = await t.compute()
    for (const id of [amount, pricey, label, left, status]) assert.deepEqual(page.columns[id], { error: null })
    assert.deepEqual(page.values[full], {
      [amount]: { type: 'number', value: 150 },
      [pricey]: { type: 'boolean', value: true },
      [label]: { type: 'text', value: '검토!' },
      [left]: { type: 'number', value: 10 },
      [status]: { type: 'text', value: '끝' },
    })
    assert.deepEqual(page.values[empty], {
      [amount]: null, // 빈 값 × 수 = 빈 값
      [pricey]: { type: 'boolean', value: false }, // 빈 값과의 크기 비교는 거짓
      [label]: null,
      [left]: null,
      [status]: { type: 'text', value: '진행' }, // 체크박스에는 빈 값이 없다
    })
  })

  test('★ 읽던 속성이 지워지면 그 컬럼은 이유를 든 채 빈 값 — 되살리면 돌아온다. 타입이 바뀌어도 이유를 든다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable('끊긴 수식')
    const hours = await t.prop('시간', 'number')
    const rate = await t.prop('단가', 'number')
    const r = await t.row('A', { [hours]: num(3), [rate]: num(50) })
    const amount = await t.formula('금액', 'prop("시간") * prop("단가")')
    const pricey = await t.formula('비싼가', 'prop("금액") > 100')

    unwrap(await deleteProperty(fx.owner.ctx, t.ds, rate))
    let page = await t.compute()
    assert.equal(typeof page.columns[amount]?.error, 'string', '지운 속성을 읽는 수식은 이유가 있다')
    assert.equal(page.values[r]?.[amount], null)
    assert.deepEqual(page.columns[pricey], { error: null }, '그것을 읽는 수식은 읽힌다 — 값만 빈 값을 받는다')
    assert.deepEqual(page.values[r]?.[pricey], { type: 'boolean', value: false })
    assert.deepEqual(await t.deps(amount), [hours, rate].sort(), '간선은 남는다(저장된 의존이 정본)')

    unwrap(await restoreProperty(fx.owner.ctx, t.ds, rate))
    page = await t.compute()
    assert.deepEqual(page.columns[amount], { error: null })
    assert.deepEqual(page.values[r]?.[amount], { type: 'number', value: 150 })

    // 타입이 바뀌면(수 → 글) 저장된 결과 타입을 믿지 않고 다시 읽는다 — 글 × 수는 읽히지 않는다
    unwrap(await convertProperty(fx.owner.ctx, t.ds, hours, { type: 'rich_text' }))
    page = await t.compute()
    assert.match(page.columns[amount]?.error ?? '', /수끼리/)
    assert.equal(page.values[r]?.[amount], null)
  })
})

describe('⑤ 권한', () => {
  test('★ 볼 수 없으면 계산도 빈 답이다 · 볼 수만 있으면 값은 보이고 만들 수는 없다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable('기밀 수식')
    const hours = await t.prop('시간', 'number')
    const r = await t.row('A', { [hours]: num(987654) })
    const f = await t.formula('두 배', 'prop("시간") * 2')

    await makePrivate(t.databaseId)
    assert.deepEqual(await t.compute(other), { columns: {}, values: {} }, '못 보는 사람에게는 아무것도 없다')
    const add = await addFormulaProperty(other.ctx, t.ds, { name: 'x', expression: '1' })
    assert.equal(add.ok === false && add.reason, 'not_found', '못 보면 없는 것과 같은 답')

    assert.equal((await grantAccess(fx.owner.ctx, t.databaseId, { type: 'user', id: other.userId }, 'view')).ok, true)
    const seen = await t.compute(other)
    assert.deepEqual(seen.values[r]?.[f], { type: 'number', value: 1975308 })
    const viewerAdd = await addFormulaProperty(other.ctx, t.ds, { name: 'x', expression: '1' })
    assert.equal(viewerAdd.ok === false && viewerAdd.reason, 'forbidden')
    const viewerEdit = await updateFormulaExpression(other.ctx, t.ds, f, { expression: '1' })
    assert.equal(viewerEdit.ok === false && viewerEdit.reason, 'forbidden')
  })
})

describe('⑥ 컬럼', () => {
  test('★ 컬럼에 사람이 읽는 식(지금 이름으로)과 결과 타입이 선다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable('수식 컬럼')
    const hours = await t.prop('시간', 'number')
    const f = await t.formula('두 배', 'prop("시간") * 2 // 두 배')
    const column = async () => {
      const columns = await withReadTransaction((tx) => readRecordColumns(tx, t.ds))
      return columns.find((c) => c.propertyId === f)
    }
    let c = await column()
    assert.equal(c?.type, 'formula')
    if (c?.type !== 'formula') throw new Error('unreachable')
    assert.deepEqual(c.formula, { expression: 'prop("시간") * 2 // 두 배', resultType: 'number' })

    unwrap(await updateProperty(fx.owner.ctx, t.ds, hours, { name: '작업 "시간"' }))
    c = await column()
    if (c?.type !== 'formula') throw new Error('unreachable')
    assert.equal(c.formula.expression, 'prop("작업 \\"시간\\"") * 2 // 두 배', '새 이름으로 · 따옴표는 탈출해서')
  })
})
