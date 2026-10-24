/**
 * select · status 로 정렬 — 옵션의 순서 — §7 정리 10n-46 (F-04-10)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] select · status 로 정렬 — 옵션의 순서
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ select — 옵션의 순서(만든 차례)로 · 빈 칸은 오름 · 내림 모두 맨 뒤
 *   ② ★ status — 범주(할 일 → 진행 중 → 완료)가 먼저 · 그 안에서 옵션의 순서 — 뒤에 더한 할 일 옵션도 할 일 자리에
 *   ③ 지운 옵션을 가리키던 칸은 빈 칸처럼 맨 뒤
 *   ④ ★ keyset 커서 — 한 행씩 넘겨도 한 번에 읽은 차례와 같다(키가 글자 하나라 커서가 그대로 잇는다)
 *   ⑤ ★ 범주를 옮긴 옵션은 곧바로 새 범주의 자리로 — 값을 다시 쓰지 않는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, deleteSelectOption, getSchema, updateSelectOption } from './property.ts'
import { queryRows } from './query.ts'
import { createRow } from './row.ts'
import type { SortKey } from './filter.ts'
import type { CellValue } from './property-types.ts'

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

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

/**
 * 표 하나 — 단계(select · 높음 · 중간 · 낮음 차례로 만든다) · 진행(status · 범주마다 기본 옵션 하나 + 뒤에 더한 할 일 옵션 "검토 대기").
 * 행은 이름(제목)으로 부른다.
 */
async function table() {
  const ws = await createBareWorkspace('옵션 정렬')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const db = unwrap(await createDatabase(boss.ctx, { name: `옵션 정렬 ${Date.now()}` }))
  const ds = db.dataSourceId
  unwrap(await addProperty(boss.ctx, ds, { name: '진행', type: 'status' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '단계', type: 'select' }))
  const props = unwrap(await getSchema(boss.ctx, ds)).properties
  const title = props.find((p) => p.type === 'title')!.id
  const progress = props.find((p) => p.name === '진행')!.id
  const stage = props.find((p) => p.name === '단계')!.id
  const option = async (name: string) => unwrap(await addSelectOption(boss.ctx, ds, stage, { name })).option.id
  const [high, mid, low] = [await option('높음'), await option('중간'), await option('낮음')]
  const review = unwrap(await addSelectOption(boss.ctx, ds, progress, { name: '검토 대기', group: 'todo' })).option.id
  const statusOptions = unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.id === progress)!.options ?? []
  const firstOf = (group: string) => statusOptions.find((o) => o.group === group && o.id !== review)!.id
  const [todo, doing, done] = [firstOf('todo'), firstOf('in_progress'), firstOf('complete')]

  const ids = new Map<string, string>()
  const row = async (name: string, cells: { propertyId: string; value: CellValue }[]) => {
    const id = unwrap(await createRow(boss.ctx, ds, { cells: [{ propertyId: title, value: { type: 'title', title: [textRun(name)] } }, ...cells] })).id
    ids.set(id, name)
  }
  const select = (id: string): { propertyId: string; value: CellValue } => ({ propertyId: stage, value: { type: 'select', select: { id } } })
  const status = (id: string): { propertyId: string; value: CellValue } => ({ propertyId: progress, value: { type: 'status', status: { id } } })
  /** 정렬한 차례의 이름들 — `limit` 을 주면 그 크기로 커서를 따라 끝까지 넘긴다. */
  const names = async (sorts: SortKey[], limit = 50) => {
    const out: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 20; page += 1) {
      const got = unwrap(await queryRows(boss.ctx, ds, { sorts, limit, cursor }))
      out.push(...got.rows.map((r) => ids.get(r.id)!))
      if (!got.hasMore || got.nextCursor === null) break
      cursor = got.nextCursor
    }
    return out
  }
  return { boss, ds, stage, progress, high, mid, low, review, todo, doing, done, row, select, status, names }
}

describe('select · status 로 정렬 — 옵션의 순서 (10n-46)', () => {
  test('★ ① select — 옵션의 순서로 · 빈 칸은 오름 · 내림 모두 맨 뒤', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    await tb.row('ㄱ낮음', [tb.select(tb.low)])
    await tb.row('ㄴ높음', [tb.select(tb.high)])
    await tb.row('ㄷ빈', [])
    await tb.row('ㄹ중간', [tb.select(tb.mid)])
    assert.deepEqual(await tb.names([{ property_id: tb.stage, direction: 'asc' }]), ['ㄴ높음', 'ㄹ중간', 'ㄱ낮음', 'ㄷ빈'])
    assert.deepEqual(await tb.names([{ property_id: tb.stage, direction: 'desc' }]), ['ㄱ낮음', 'ㄹ중간', 'ㄴ높음', 'ㄷ빈'])
  })

  test('★ ② status — 범주가 먼저 · 뒤에 더한 할 일 옵션도 할 일 자리에', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    await tb.row('완료', [tb.status(tb.done)])
    await tb.row('검토', [tb.status(tb.review)])
    await tb.row('진행', [tb.status(tb.doing)])
    await tb.row('시작', [tb.status(tb.todo)])
    assert.deepEqual(await tb.names([{ property_id: tb.progress, direction: 'asc' }]), ['시작', '검토', '진행', '완료'])
    assert.deepEqual(await tb.names([{ property_id: tb.progress, direction: 'desc' }]), ['완료', '진행', '검토', '시작'])
  })

  test('③ 지운 옵션을 가리키던 칸은 빈 칸처럼 맨 뒤', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    await tb.row('ㄱ낮음', [tb.select(tb.low)])
    await tb.row('ㄴ빈', [])
    await tb.row('ㄷ중간', [tb.select(tb.mid)])
    await tb.row('ㄹ높음', [tb.select(tb.high)])
    unwrap(await deleteSelectOption(tb.boss.ctx, tb.ds, tb.stage, tb.mid))
    assert.deepEqual(await tb.names([{ property_id: tb.stage, direction: 'asc' }]), ['ㄹ높음', 'ㄱ낮음', 'ㄴ빈', 'ㄷ중간'])
  })

  test('★ ④ keyset 커서 — 한 행씩 넘겨도 한 번에 읽은 차례와 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    await tb.row('완료', [tb.status(tb.done), tb.select(tb.high)])
    await tb.row('검토', [tb.status(tb.review), tb.select(tb.low)])
    await tb.row('진행', [tb.status(tb.doing)])
    await tb.row('시작', [tb.status(tb.todo), tb.select(tb.low)])
    await tb.row('시작2', [tb.status(tb.todo), tb.select(tb.high)])
    for (const sorts of [
      [{ property_id: tb.progress, direction: 'asc' }],
      [{ property_id: tb.progress, direction: 'desc' }],
      [{ property_id: tb.stage, direction: 'asc' }, { property_id: tb.progress, direction: 'desc' }],
    ] as SortKey[][]) {
      assert.deepEqual(await tb.names(sorts, 1), await tb.names(sorts), JSON.stringify(sorts))
    }
    assert.deepEqual(await tb.names([{ property_id: tb.progress, direction: 'asc' }], 1), ['시작', '시작2', '검토', '진행', '완료'])
  })

  test('★ ⑤ 범주를 옮긴 옵션은 곧바로 새 범주의 자리로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    await tb.row('완료', [tb.status(tb.done)])
    await tb.row('검토', [tb.status(tb.review)])
    await tb.row('진행', [tb.status(tb.doing)])
    unwrap(await updateSelectOption(tb.boss.ctx, tb.ds, tb.progress, tb.review, { group: 'complete' }))
    assert.deepEqual(await tb.names([{ property_id: tb.progress, direction: 'asc' }]), ['진행', '완료', '검토'])
  })
})
