/**
 * status 의 기본 옵션을 화면에서 바꾸기 — §7 정리 10n-21 (F-03-05)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 옵션 고치기 · 지우기 ⑨
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 뷰의 status 열이 기본 옵션을 싣는다 — 바꾸면 열이 따라오고 새 행이 그 값으로 시작한다 · 이미 있는 행은 그대로
 *   ② ★ 거부 — status 가 아닌 속성 · 다른 속성의 옵션 · uuid 아님 · config 와 함께 → `invalid_config`(기본은 그대로)
 *   ③ null 은 받는다(API 의 몫) — 열이 null 을 싣고 새 행은 빈 값으로 시작한다
 *   ④ 기본 옵션을 지우면 열이 남은 첫 옵션을 싣는다(정본 ④ 를 열로 읽는다)
 *   ⑤ select 열에는 기본 옵션이 없다(키 자체가 없다)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, deleteSelectOption, getSchema, updateProperty } from './property.ts'
import { queryRows } from './query.ts'
import { createRow } from './row.ts'
import { getView } from './view.ts'

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

/** 표 하나 — 진행(status · 시작 전 · 진행 중 · 완료 · 기본은 시작 전) · 단계(select · 가) · 다른 진행(status). */
async function table() {
  const ws = await createBareWorkspace('기본 옵션')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const db = unwrap(await createDatabase(boss.ctx, { name: `기본 옵션 ${Date.now()}` }))
  const ds = db.dataSourceId
  unwrap(await addProperty(boss.ctx, ds, { name: '진행', type: 'status' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '단계', type: 'select' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '검토', type: 'status' }))
  const props = unwrap(await getSchema(boss.ctx, ds)).properties
  const progress = props.find((p) => p.name === '진행')!
  const stage = props.find((p) => p.name === '단계')!.id
  const review = props.find((p) => p.name === '검토')!
  const optionId = (name: string) => progress.options!.find((o) => o.name === name)!.id
  const column = async (propertyId: string) => unwrap(await getView(boss.ctx, db.defaultViewId)).columns.find((c) => c.propertyId === propertyId)!
  const statusOf = (row: { properties: Readonly<Record<string, unknown>> }) =>
    ((row.properties[progress.id] as { status?: { id?: string } | null } | undefined)?.status?.id ?? null)
  // select 의 자기 옵션 — 다른 속성의 옵션을 주면 status 검사가 없어도 옵션 확인에서 걸린다
  const plain = unwrap(await addSelectOption(boss.ctx, ds, stage, { name: '가' })).option.id
  return { boss, ds, progress: progress.id, stage, plain, review, optionId, column, statusOf }
}

describe('status 의 기본 옵션 (10n-21)', () => {
  test('★ ① 열이 기본 옵션을 싣는다 — 바꾸면 따라오고 새 행이 그 값으로 시작한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    assert.equal((await tb.column(tb.progress)).defaultOptionId, tb.optionId('시작 전'), '처음은 첫 옵션')
    const before = unwrap(await createRow(tb.boss.ctx, tb.ds, {}))
    assert.equal(tb.statusOf(before), tb.optionId('시작 전'))

    unwrap(await updateProperty(tb.boss.ctx, tb.ds, tb.progress, { defaultOptionId: tb.optionId('진행 중') }))
    assert.equal((await tb.column(tb.progress)).defaultOptionId, tb.optionId('진행 중'), '열이 따라온다')
    const after = unwrap(await createRow(tb.boss.ctx, tb.ds, {}))
    assert.equal(tb.statusOf(after), tb.optionId('진행 중'), '새 행은 새 기본으로')
    const rows = unwrap(await queryRows(tb.boss.ctx, tb.ds, {})).rows
    assert.equal(tb.statusOf(rows.find((r) => r.id === before.id)!), tb.optionId('시작 전'), '이미 있는 행은 그대로')
  })

  test('★ ② 거부 — status 가 아닌 속성 · 다른 속성의 옵션 · uuid 아님 · config 와 함께', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    const ctx = tb.boss.ctx
    assert.equal(reasonOf(await updateProperty(ctx, tb.ds, tb.stage, { defaultOptionId: tb.plain })), 'invalid_config', 'select 속성(자기 옵션이어도)')
    assert.equal(reasonOf(await updateProperty(ctx, tb.ds, tb.progress, { defaultOptionId: tb.review.options![0]!.id })), 'invalid_config', '다른 속성의 옵션')
    assert.equal(reasonOf(await updateProperty(ctx, tb.ds, tb.progress, { defaultOptionId: '완료' })), 'invalid_config', 'uuid 아님')
    assert.equal(reasonOf(await updateProperty(ctx, tb.ds, tb.progress, { defaultOptionId: 7 })), 'invalid_config', '글자 아님')
    assert.equal(
      reasonOf(await updateProperty(ctx, tb.ds, tb.progress, { defaultOptionId: tb.optionId('완료'), config: { default_option_id: tb.optionId('완료') } })),
      'invalid_config',
      'config 와 함께',
    )
    assert.equal((await tb.column(tb.progress)).defaultOptionId, tb.optionId('시작 전'), '기본은 그대로')
  })

  test('③ null 은 받는다 — 열이 null · 새 행은 빈 값', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    unwrap(await updateProperty(tb.boss.ctx, tb.ds, tb.progress, { defaultOptionId: null }))
    assert.equal((await tb.column(tb.progress)).defaultOptionId, null)
    assert.equal(tb.statusOf(unwrap(await createRow(tb.boss.ctx, tb.ds, {}))), null)
  })

  test('④ 기본 옵션을 지우면 열이 남은 첫 옵션을 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    unwrap(await updateProperty(tb.boss.ctx, tb.ds, tb.progress, { defaultOptionId: tb.optionId('진행 중') }))
    const removed = unwrap(await deleteSelectOption(tb.boss.ctx, tb.ds, tb.progress, tb.optionId('진행 중')))
    assert.equal(removed.defaultOptionId, tb.optionId('시작 전'), '응답이 옮긴 기본을 싣는다')
    assert.equal((await tb.column(tb.progress)).defaultOptionId, tb.optionId('시작 전'))
  })

  test('⑤ select 열에는 기본 옵션이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    assert.ok(!('defaultOptionId' in (await tb.column(tb.stage))), 'select 열에는 키가 없다')
  })
})
