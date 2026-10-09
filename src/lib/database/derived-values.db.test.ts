/**
 * 수식 값의 캐시 · 수식으로 거르기 · 정렬 — 2j-2조각 (F-03-13 · 정본 D1, DB 필요)
 *
 *   ① 거르기 — 결과 타입의 칸 연산자로(수 · 글 · 참거짓 · 날짜) · 부정은 값이 없는 행도 건다(칸과 같은 `NOT EXISTS`)
 *   ② 정렬 — 수식 값으로 · 빈 값은 맨 뒤 · 커서로 이어 읽어도 빠지거나 겹치지 않는다
 *   ③ 무효화 — 칸을 고치면 · 식을 고치면 · 읽던 속성을 지우면/되살리면 · 옵션 이름이 바뀌면 다음 거르기가 맞다(트리거 → 채우기)
 *   ④ 지금을 읽는 수식(거쳐서라도)은 거를 때마다 다시 계산한다 · 그렇지 않은 수식은 다시 계산하지 않는다
 *   ⑤ 채우는 범위 — 템플릿 · 휴지통의 행은 채우지 않는다 · 거르지 않으면 채우지 않는다
 *   ⑥ 같은 규칙이 보드 · 캘린더 · 열 집계 · 개인 필터에도 선다
 *   ⑦ 쓰는 길의 검증 — 결과 타입에 없는 연산자는 거부한다
 *
 * 반사실(HANDOFF §3.3): 칸의 무효화 트리거가 없으면 ③ 이, 지금을 읽는 수식을 늘 다시 계산하지 않으면 ④ 가, 보드가 채우지 않으면 ⑥ 이 실패한다.
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, deleteProperty, getSchema, restoreProperty } from './property.ts'
import type { CellValue, MvpPropertyType } from './property-types.ts'
import { createRow, trashRow, updateCells } from './row.ts'
import { queryRows } from './query.ts'
import { createView, setPersonalView, updateView } from './view.ts'
import { queryGroups } from './group.ts'
import { queryCalendar } from './calendar-query.ts'
import { computeCalculations } from './calculate.ts'
import { addFormulaProperty, updateFormulaExpression } from './formula-property.ts'
import { createTemplate } from './template.ts'
import type { FilterNode, SortKey } from './filter.ts'

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string; issues?: readonly unknown[] }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? `${r.reason} ${JSON.stringify(r.issues ?? '')}` : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

const num = (n: number | null): CellValue => ({ type: 'number', number: n })
const day = (start: string): CellValue => ({ type: 'date', date: { start } })
const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

async function table(name: string) {
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
  /** 이 필터 · 정렬로 읽은 행의 제목. */
  const titles = async (filter: FilterNode | null, sorts: SortKey[] = [], limit?: number) =>
    unwrap(await queryRows(fx.owner.ctx, ds, { filter, sorts, ...(limit === undefined ? {} : { limit }) })).rows.map((r) => r.title)
  return { databaseId: created.id, viewId: created.defaultViewId, ds, titleId, prop, formula, row, titles }
}

const leaf = (property_id: string, operator: string, value?: unknown): FilterNode =>
  (value === undefined ? { property_id, operator } : { property_id, operator, value }) as FilterNode

const cached = (propertyId: string) =>
  withReadTransaction((tx) =>
    tx.query<{ page_id: string; stale: boolean; computed_at: Date | null; num_value: string | null }>(
      `SELECT page_id, stale, computed_at, num_value FROM derived_value WHERE property_id = $1 ORDER BY page_id`,
      [propertyId],
    ),
  )

describe('① 거르기', () => {
  test('★ 결과 타입의 칸 연산자로 — 수 · 글 · 참거짓 · 날짜', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table('거르기')
    const qty = await t.prop('수량', 'number')
    const due = await t.prop('마감', 'date')
    await t.row('가', { [qty]: num(3), [due]: day('2026-10-20') })
    await t.row('나', { [qty]: num(30), [due]: day('2026-11-05') })
    await t.row('다') // 빈 칸
    const amount = await t.formula('금액', 'prop("수량") * 10')
    const label = await t.formula('표시', 'prop("이름") + "!"')
    const big = await t.formula('큰가', 'prop("수량") > 10')
    const later = await t.formula('하루 뒤', 'dateAdd(prop("마감"), 1, "days")')

    assert.deepEqual(await t.titles(leaf(amount, 'greater_than', 100)), ['나'])
    assert.deepEqual(await t.titles(leaf(amount, 'is_empty')), ['다'], '빈 값은 비어 있다(0 이 아니다)')
    assert.deepEqual(await t.titles(leaf(label, 'contains', '나!')), ['나'])
    assert.deepEqual(await t.titles(leaf(big, 'equals', true)), ['나'])
    // 부정은 값이 없는 행도 건다 — 칸과 같은 `NOT EXISTS`
    assert.deepEqual((await t.titles(leaf(amount, 'does_not_equal', 30))).sort(), ['나', '다'])
    assert.deepEqual(await t.titles(leaf(later, 'before', '2026-10-25')), ['가'], '2026-10-21 < 10-25')
  })
})

describe('② 정렬', () => {
  test('★ 수식 값으로 · 빈 값은 맨 뒤 · 커서로 이어 읽어도 빠지거나 겹치지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table('정렬')
    const qty = await t.prop('수량', 'number')
    for (const [title, n] of [['가', 5], ['나', 1], ['다', null], ['라', 3], ['마', 4]] as const) await t.row(title, { [qty]: num(n) })
    const neg = await t.formula('음수', '0 - prop("수량")')

    assert.deepEqual(await t.titles(null, [{ property_id: neg, direction: 'asc' }]), ['가', '마', '라', '나', '다'])
    assert.deepEqual(await t.titles(null, [{ property_id: neg, direction: 'desc' }]), ['나', '라', '마', '가', '다'], '빈 값은 내림차순에서도 맨 뒤')

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page = unwrap(await queryRows(fx.owner.ctx, t.ds, { sorts: [{ property_id: neg, direction: 'asc' }], limit: 2, cursor }))
      seen.push(...page.rows.map((r) => r.title))
      cursor = page.nextCursor
    } while (cursor !== null)
    assert.deepEqual(seen, ['가', '마', '라', '나', '다'])
  })
})

describe('③ 무효화', () => {
  test('★ 칸을 고치면 · 식을 고치면 · 읽던 속성을 지우면/되살리면 다음 거르기가 맞다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table('무효화')
    const qty = await t.prop('수량', 'number')
    const a = await t.row('가', { [qty]: num(3) })
    await t.row('나', { [qty]: num(30) })
    const amount = await t.formula('금액', 'prop("수량") * 10')
    const over = leaf(amount, 'greater_than', 100)
    assert.deepEqual(await t.titles(over), ['나'])
    assert.ok((await cached(amount)).every((r) => !r.stale), '채운 뒤에는 낡지 않았다')

    unwrap(await updateCells(fx.owner.ctx, a, { cells: [{ propertyId: qty, value: num(50) }] }))
    assert.deepEqual((await cached(amount)).filter((r) => r.page_id === a).map((r) => r.stale), [true], '칸을 고치면 그 행이 낡는다')
    assert.deepEqual((await t.titles(over)).sort(), ['가', '나'])

    unwrap(await updateFormulaExpression(fx.owner.ctx, t.ds, amount, { expression: 'prop("수량") * 1' }))
    assert.ok((await cached(amount)).every((r) => r.stale), '식을 고치면 표의 수식 값이 전부 낡는다')
    assert.deepEqual(await t.titles(leaf(amount, 'greater_than', 40)), ['가'])

    unwrap(await deleteProperty(fx.owner.ctx, t.ds, qty))
    assert.deepEqual(await t.titles(leaf(amount, 'is_not_empty')), [], '읽던 속성이 지워지면 값이 없다')
    unwrap(await restoreProperty(fx.owner.ctx, t.ds, qty))
    assert.deepEqual((await t.titles(leaf(amount, 'is_not_empty'))).sort(), ['가', '나'])
  })

  test('옵션 이름이 바뀌면 그 표의 수식 값이 낡는다(트리거)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table('옵션')
    const stage = await t.prop('단계', 'select')
    const option = unwrap(await addSelectOption(fx.owner.ctx, t.ds, stage, { name: '검토' })).option
    await t.row('가', { [stage]: { type: 'select', select: { id: option.id } } })
    const label = await t.formula('단계 이름', 'prop("단계")')
    assert.deepEqual(await t.titles(leaf(label, 'equals', '검토')), ['가'])
    // 옵션 이름을 바꾸는 명령은 아직 없다 — 트리거가 잡는지 SQL 로 본다
    await withTransaction((tx) => tx.query(`UPDATE select_option SET name = '완료' WHERE id = $1`, [option.id]))
    assert.deepEqual(await t.titles(leaf(label, 'equals', '완료')), ['가'])
  })
})

describe('④ 지금을 읽는 수식', () => {
  test('★ 거를 때마다 다시 계산한다(거쳐서 읽어도) — 그렇지 않은 수식은 다시 계산하지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table('지금')
    const due = await t.prop('마감', 'date')
    await t.row('곧', { [due]: day(isoDay(2)) })
    await t.row('나중', { [due]: day(isoDay(30)) })
    const left = await t.formula('남은 날', 'dateBetween(prop("마감"), today(), "days")')
    const soon = await t.formula('곧인가', 'prop("남은 날") <= 7') // 지금을 거쳐서 읽는다
    const plain = await t.formula('그냥', 'prop("마감")')

    assert.deepEqual(await t.titles(leaf(soon, 'equals', true)), ['곧'])
    const first = await cached(left)
    const firstPlain = await cached(plain)
    await new Promise((r) => setTimeout(r, 20))
    assert.deepEqual(await t.titles(leaf(soon, 'equals', true)), ['곧'])
    const second = await cached(left)
    assert.ok(second.every((r, i) => r.computed_at!.getTime() > first[i]!.computed_at!.getTime()), '지금을 읽는 수식은 다시 계산했다')
    assert.ok(
      (await cached(plain)).every((r, i) => r.computed_at!.getTime() > firstPlain[i]!.computed_at!.getTime()),
      '행을 다시 계산하면 그 행의 다른 수식도 같이 쓴다',
    )

    // 지금을 읽지 않는 수식으로만 거르면 다시 쓰지 않는다
    const before = await cached(plain)
    await new Promise((r) => setTimeout(r, 20))
    await t.titles(leaf(plain, 'is_not_empty'))
    assert.deepEqual(await cached(plain), before)
  })
})

describe('⑤ 채우는 범위', () => {
  test('템플릿 · 휴지통의 행은 채우지 않는다 · 거르지 않으면 채우지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table('범위')
    const qty = await t.prop('수량', 'number')
    const kept = await t.row('남는 것', { [qty]: num(1) })
    const gone = await t.row('버릴 것', { [qty]: num(2) })
    unwrap(await createTemplate(fx.owner.ctx, t.ds, { name: '틀' }))
    const amount = await t.formula('금액', 'prop("수량") * 10')
    unwrap(await trashRow(fx.owner.ctx, gone))

    await t.titles(null)
    assert.deepEqual(await cached(amount), [], '거르지 않으면 채우지 않는다')
    await t.titles(leaf(amount, 'is_not_empty'))
    assert.deepEqual((await cached(amount)).map((r) => r.page_id), [kept])
  })
})

describe('⑥ 보드 · 캘린더 · 열 집계 · 개인 필터', () => {
  test('★ 같은 규칙이 선다 — 뷰를 안에서 여는 길도 이 사람의 실제 필터로 채운다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table('다른 길')
    const qty = await t.prop('수량', 'number')
    const done = await t.prop('완료', 'checkbox')
    const due = await t.prop('마감', 'date')
    await t.row('가', { [qty]: num(3), [due]: day('2026-10-05') })
    await t.row('나', { [qty]: num(30), [due]: day('2026-10-06') })
    const amount = await t.formula('금액', 'prop("수량") * 10')
    const over = leaf(amount, 'greater_than', 100)

    // 보드 — 뷰의 공유 필터
    const board = unwrap(await createView(fx.owner.ctx, t.databaseId, { type: 'board', groupBy: { property_id: done } }))
    unwrap(await updateView(fx.owner.ctx, board.id, { filter: over }))
    const cards = (await queryGroups(fx.owner.ctx, board.id)) as { ok: true; value: { groups: { rows: { title: string }[] }[] } }
    assert.deepEqual(unwrap(cards).groups.flatMap((g) => g.rows.map((r) => r.title)), ['나'])

    // 캘린더 — 개인 필터(2h-1)로
    const cal = unwrap(await createView(fx.owner.ctx, t.databaseId, { type: 'calendar' }))
    unwrap(await setPersonalView(fx.owner.ctx, cal.id, { filter: leaf(amount, 'less_than', 100) }))
    const month = unwrap(await queryCalendar(fx.owner.ctx, cal.id, { from: '2026-10-01', to: '2026-10-31' }))
    assert.deepEqual(month.rows.map((r) => r.title), ['가'])

    // 열 집계 — 거른 행만 센다
    const counted = await computeCalculations(fx.owner.ctx, t.ds, over, [{ propertyId: t.titleId, type: 'title', calculation: 'count_all' }])
    assert.deepEqual(counted[t.titleId], { kind: 'count', value: 1 })

    // 정렬도 보드에서 산다
    unwrap(await updateView(fx.owner.ctx, board.id, { filter: null, sorts: [{ property_id: amount, direction: 'desc' }] }))
    const sorted = unwrap((await queryGroups(fx.owner.ctx, board.id)) as { ok: true; value: { manualOrder: boolean; groups: { rows: { title: string }[] }[] } })
    assert.equal(sorted.manualOrder, false, '수식 정렬이 살아 있다(손으로 둔 순서가 아니다)')
    assert.deepEqual(sorted.groups.flatMap((g) => g.rows.map((r) => r.title)), ['나', '가'])
  })
})

describe('⑦ 쓰는 길의 검증', () => {
  test('결과 타입에 없는 연산자는 거부 · 있는 것은 받는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table('검증')
    await t.prop('수량', 'number')
    const amount = await t.formula('금액', 'prop("수량") * 10')
    const bad = await updateView(fx.owner.ctx, t.viewId, { filter: leaf(amount, 'contains', '1') })
    assert.equal(bad.ok === false && bad.reason, 'invalid_filter', '수에는 contains 가 없다')
    unwrap(await updateView(fx.owner.ctx, t.viewId, { filter: leaf(amount, 'greater_than', 1), sorts: [{ property_id: amount, direction: 'asc' }] }))
  })
})
