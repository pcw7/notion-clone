/**
 * status 옵션의 그룹 바꾸기 — §7 정리 10n-20 (F-03-05 시나리오 4)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 옵션 고치기 · 지우기 ⑧
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 그룹을 바꾸면 새 그룹의 맨 뒤에 선다 — 옵션 목록(그룹 → 순서 키)이 그 자리로 읽는다 · 스키마 판이 오른다
 *   ② 셀 · 필터는 그대로 — 옵션 id 라 따라온다
 *   ③ ★ 거부 — select 옵션에 그룹 · 모르는 그룹
 *   ④ 이미 그 그룹이면 쓰지 않는다(스키마 판 그대로)
 *   ⑤ 그룹이 비어도 된다 · 기본 옵션이어도 옮긴다(기본은 그대로)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema, updateSelectOption } from './property.ts'
import { queryRows } from './query.ts'
import { createRow } from './row.ts'

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
const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? 'ok' : r.reason)

/** 표 하나 — 진행(status · 만들 때 그룹마다 옵션 하나)에 할 일 옵션 하나를 더 · 단계(select · 가). */
async function table() {
  const ws = await createBareWorkspace('옵션 그룹')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const db = unwrap(await createDatabase(boss.ctx, { name: `옵션 그룹 ${Date.now()}` }))
  const ds = db.dataSourceId
  unwrap(await addProperty(boss.ctx, ds, { name: '진행', type: 'status' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '단계', type: 'select' }))
  const props = unwrap(await getSchema(boss.ctx, ds)).properties
  const progress = props.find((p) => p.name === '진행')!.id
  const stage = props.find((p) => p.name === '단계')!.id
  const extra = unwrap(await addSelectOption(boss.ctx, ds, progress, { name: '검토 대기', group: 'todo' })).option.id
  const plain = unwrap(await addSelectOption(boss.ctx, ds, stage, { name: '가' })).option.id
  /** 진행 옵션들 — (이름 · 그룹) 차례대로. */
  const options = async () =>
    (unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.id === progress)!.options ?? []).map((o) => `${o.name}:${o.group}`)
  const idOf = async (name: string) =>
    (unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.id === progress)!.options ?? []).find((o) => o.name === name)!.id
  const schemaVersion = async () => (await query<{ v: string }>(`SELECT schema_version::text AS v FROM data_source WHERE id = $1`, [ds]))[0]!.v
  return { boss, db, ds, progress, stage, extra, plain, options, idOf, schemaVersion }
}

describe('status 옵션의 그룹 바꾸기 (10n-20)', () => {
  test('★ ① 그룹을 바꾸면 새 그룹의 맨 뒤에 선다 · 스키마 판이 오른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    const before = await tb.options()
    assert.equal(before.length, 4, `전제 — 옵션 넷: ${before.join(' · ')}`)
    const version = await tb.schemaVersion()

    const moved = unwrap(await updateSelectOption(tb.boss.ctx, tb.ds, tb.progress, tb.extra, { group: 'complete' }))
    assert.equal(moved.option.group, 'complete')
    const after = await tb.options()
    assert.equal(after.at(-1), '검토 대기:complete', `완료 그룹의 맨 뒤: ${after.join(' · ')}`)
    assert.ok(!after.slice(0, -1).some((o) => o.startsWith('검토 대기')), '한 번만 선다')
    assert.notEqual(await tb.schemaVersion(), version, '스키마 판이 오른다')

    // 진행 중으로 — 완료 그룹 앞(진행 중 그룹의 끝)
    unwrap(await updateSelectOption(tb.boss.ctx, tb.ds, tb.progress, tb.extra, { group: 'in_progress' }))
    const again = await tb.options()
    const at = again.indexOf('검토 대기:in_progress')
    assert.ok(at >= 0 && again[at + 1]?.endsWith(':complete'), `진행 중 그룹의 끝 — 다음은 완료 그룹: ${again.join(' · ')}`)

    // 순서 키가 가장 앞인 옵션(할 일 그룹의 첫 옵션)을 완료로 — 순서 키를 옮기지 않으면 완료 그룹의 앞에 섰을 것이다
    const first = again[0]!.split(':')[0]!
    unwrap(await updateSelectOption(tb.boss.ctx, tb.ds, tb.progress, await tb.idOf(first), { group: 'complete' }))
    const last = await tb.options()
    assert.equal(last.at(-1), `${first}:complete`, `순서 키가 앞이던 옵션도 새 그룹의 맨 뒤: ${last.join(' · ')}`)
  })

  test('② 셀 · 필터는 그대로 — 옵션 id 라 따라온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    const row = unwrap(await createRow(tb.boss.ctx, tb.ds, { cells: [{ propertyId: tb.progress, value: { type: 'status', status: { id: tb.extra } } }] })).id
    unwrap(await updateSelectOption(tb.boss.ctx, tb.ds, tb.progress, tb.extra, { group: 'complete' }))
    const found = unwrap(await queryRows(tb.boss.ctx, tb.ds, { filter: { property_id: tb.progress, operator: 'equals', value: tb.extra } as never }))
    assert.deepEqual(found.rows.map((r) => r.id), [row], '그 옵션으로 거른 행이 그대로')
  })

  test('★ ③ 거부 — select 옵션에 그룹 · 모르는 그룹', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    assert.equal(reasonOf(await updateSelectOption(tb.boss.ctx, tb.ds, tb.stage, tb.plain, { group: 'todo' })), 'invalid_group')
    assert.equal(reasonOf(await updateSelectOption(tb.boss.ctx, tb.ds, tb.progress, tb.extra, { group: 'done' })), 'invalid_group')
  })

  test('④ 이미 그 그룹이면 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    const version = await tb.schemaVersion()
    const same = unwrap(await updateSelectOption(tb.boss.ctx, tb.ds, tb.progress, tb.extra, { group: 'todo' }))
    assert.equal(same.option.group, 'todo')
    assert.equal(await tb.schemaVersion(), version, '스키마 판 그대로')
  })

  test('⑤ 그룹이 비어도 된다 · 기본 옵션이어도 옮긴다(기본은 그대로)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    const config = async () =>
      (await query<{ config: { default_option_id?: string | null } | null }>(`SELECT config FROM property WHERE id = $1`, [tb.progress]))[0]!.config
    const defaultId = (await config())?.default_option_id ?? null
    assert.ok(defaultId !== null, '전제 — 기본 옵션이 있다')
    // 완료 그룹의 유일한 옵션을 진행 중으로 — 완료 그룹이 빈다
    const options = (unwrap(await getSchema(tb.boss.ctx, tb.ds)).properties.find((p) => p.id === tb.progress)!.options ?? [])
    const onlyComplete = options.filter((o) => o.group === 'complete')
    assert.equal(onlyComplete.length, 1, '전제 — 완료 그룹에 하나')
    unwrap(await updateSelectOption(tb.boss.ctx, tb.ds, tb.progress, onlyComplete[0]!.id, { group: 'in_progress' }))
    assert.ok(!(await tb.options()).some((o) => o.endsWith(':complete')), '완료 그룹이 비었다')

    unwrap(await updateSelectOption(tb.boss.ctx, tb.ds, tb.progress, defaultId!, { group: 'complete' }))
    assert.equal((await config())?.default_option_id, defaultId, '기본 옵션은 그대로')
  })
})
