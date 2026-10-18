/**
 * 옵션 칸은 그 속성의 옵션만 — 셀 쓰기의 옵션 확인 (F-03-04 · F-03-05 · HANDOFF §7 의 구멍)
 *
 * 모양 검사는 id 의 꼴만 봤다 — 다른 속성의 옵션 · 아무 uuid 를 API 로 넣을 수 있었다(읽기에서 빈 값으로 접혔다). 지키는 것.
 *   ① ★ select · status 칸에 그 속성의 옵션이 아닌 id(다른 속성의 옵션 · 없는 uuid)는 invalid_value — 행 만들기 · 셀 고치기 모두 ·
 *      쓰지 않는다(값이 그대로다). 그 속성의 옵션 · 비우기(null)는 된다
 *   ② ★ 템플릿에 든 "없는 옵션" 값은 무시한다 — 그 템플릿으로 행을 만들 수 있다(지운 프로퍼티의 값과 같다 · 08)
 *   ③ 폼의 익명 응답도 같은 확인을 지난다(createAnonymousRowIn)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import type { CellValue } from './property-types.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import { queryRows } from './query.ts'
import { createAnonymousRowIn, createRow, updateCells } from './row.ts'
import { createRowFromTemplate, createTemplate } from './template.ts'
import { query } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'

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

const sel = (id: string | null): CellValue => ({ type: 'select', select: id === null ? null : { id } })
const stat = (id: string | null): CellValue => ({ type: 'status', status: id === null ? null : { id } })

/** 표 하나 — 단계(select · 옵션 둘) · 분류(select · 옵션 하나) · 진행(status — 만들 때 옵션 셋). */
async function board() {
  const ws = await createBareWorkspace('옵션 칸')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const db = unwrap(await createDatabase(boss.ctx, { name: `옵션 칸 ${Date.now()}`, privateTop: true }))
  const ds = db.dataSourceId
  unwrap(await addProperty(boss.ctx, ds, { name: '단계', type: 'select' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '분류', type: 'select' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '진행', type: 'status' }))
  const schema = unwrap(await getSchema(boss.ctx, ds))
  const prop = (name: string) => schema.properties.find((p) => p.name === name)!
  const stage = prop('단계').id
  const kind = prop('분류').id
  const progress = prop('진행')
  const a = unwrap(await addSelectOption(boss.ctx, ds, stage, { name: '가' })).option.id
  const b = unwrap(await addSelectOption(boss.ctx, ds, stage, { name: '나' })).option.id
  const other = unwrap(await addSelectOption(boss.ctx, ds, kind, { name: '남의 옵션' })).option.id
  const done = progress.options!.find((o) => o.name === '완료')?.id ?? progress.options![progress.options!.length - 1].id
  return { ws, boss, db, ds, stage, kind, progress: progress.id, a, b, other, done }
}

const stageOf = async (who: Actor, ds: string, rowId: string, stage: string) => {
  const r = await queryRows(who.ctx, ds)
  return r.ok ? r.value.rows.find((row) => row.id === rowId)?.properties[stage] : r.reason
}

describe('① ★ 그 속성의 옵션이 아닌 id 는 invalid_value', () => {
  test('★ 셀 고치기 — 다른 속성의 옵션 · 없는 uuid 는 거부 · 값은 그대로 · 그 속성의 옵션 · 비우기는 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, ds, stage, a, b, other } = await board()
    const row = unwrap(await createRow(boss.ctx, ds, { cells: [{ propertyId: stage, value: sel(a) }] }))

    const foreign = await updateCells(boss.ctx, row.id, { cells: [{ propertyId: stage, value: sel(other) }] })
    assert.equal(foreign.ok, false)
    assert.equal(!foreign.ok && foreign.reason, 'invalid_value')
    assert.deepEqual(!foreign.ok && 'issues' in foreign ? foreign.issues : null, [{ path: `cells.${stage}.select.id`, message: '이 속성의 옵션이 아닙니다' }])
    const random = await updateCells(boss.ctx, row.id, { cells: [{ propertyId: stage, value: sel('00000000-0000-4000-8000-000000000000') }] })
    assert.equal(!random.ok && random.reason, 'invalid_value')
    assert.deepEqual(await stageOf(boss, ds, row.id, stage), sel(a), '거부된 쓰기는 값을 바꾸지 않는다')

    assert.ok((await updateCells(boss.ctx, row.id, { cells: [{ propertyId: stage, value: sel(b) }] })).ok, '그 속성의 옵션')
    assert.ok((await updateCells(boss.ctx, row.id, { cells: [{ propertyId: stage, value: sel(null) }] })).ok, '비우기')
  })

  test('행 만들기 · status 도 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, ds, stage, progress, a, other, done } = await board()
    const made = await createRow(boss.ctx, ds, { cells: [{ propertyId: stage, value: sel(other) }] })
    assert.equal(!made.ok && made.reason, 'invalid_value')
    const wrongStatus = await createRow(boss.ctx, ds, { cells: [{ propertyId: progress, value: stat(a) }] })
    assert.equal(!wrongStatus.ok && wrongStatus.reason, 'invalid_value', 'select 의 옵션을 status 칸에')
    assert.ok((await createRow(boss.ctx, ds, { cells: [{ propertyId: progress, value: stat(done) }] })).ok)
  })
})

describe('② ★ 템플릿의 "없는 옵션" 값은 무시한다', () => {
  test('그 템플릿으로 행을 만든다 — 그 칸만 빠진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, ds, stage, kind, a, other } = await board()
    const template = unwrap(await createTemplate(boss.ctx, ds, { title: '양식' }))
    assert.ok((await updateCells(boss.ctx, template.id, { cells: [{ propertyId: stage, value: sel(a) }, { propertyId: kind, value: sel(other) }] })).ok)
    // 이 확인 전에 API 로 쓰였던 값을 흉내 낸다 — 템플릿의 "분류" 칸이 그 속성에 없는 옵션을 가리키게(옵션을 지우는 길은 아직 없다)
    await query(`UPDATE page_property_value SET value = $3::jsonb WHERE page_id = $1 AND property_id = $2`, [
      template.id, kind, JSON.stringify(sel('00000000-0000-4000-8000-000000000001')),
    ])
    const made = await createRowFromTemplate(boss.ctx, ds, template.id)
    assert.ok(made.ok, JSON.stringify(made))
    assert.deepEqual(await stageOf(boss, ds, made.value.row.id, stage), sel(a), '살아 있는 옵션은 옮겨 온다')
    const dropped = await stageOf(boss, ds, made.value.row.id, kind)
    assert.ok(dropped === undefined || JSON.stringify(dropped) === JSON.stringify(sel(null)), `없는 옵션의 칸은 빠진다: ${JSON.stringify(dropped)}`)
  })
})

describe('③ 폼의 익명 응답도 같은 확인을 지난다', () => {
  test('다른 속성의 옵션은 invalid_value', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, ds, stage, other, a } = await board()
    const bad = await withTransaction((tx) => createAnonymousRowIn(tx, ws, ds, [{ propertyId: stage, value: sel(other) }]))
    assert.equal(!bad.ok && bad.reason, 'invalid_value')
    const good = await withTransaction((tx) => createAnonymousRowIn(tx, ws, ds, [{ propertyId: stage, value: sel(a) }]))
    assert.ok(good.ok, JSON.stringify(good))
  })
})
