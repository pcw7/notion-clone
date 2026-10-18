/**
 * 옵션 고치기 · 지우기 — 10n-6 (F-03-04 · F-03-05 · 정본 §3.5 [보강] 옵션 고치기 · 지우기)
 *
 * 지키는 것.
 *   ① ★ 이름 · 색 바꾸기 — 셀은 id 라 따라온다 · 이름이 겹치면(대소문자 무시) duplicate_name · 대소문자만 바꾸는 것은 된다 · 그대로면
 *      버전을 올리지 않는다 · 팔레트 밖의 색은 invalid_color
 *   ② ★ 지우기는 그 옵션의 셀을 비운다 — 살아 있는 행 · 템플릿 · 휴지통의 행 모두 · 다른 옵션의 셀은 그대로 · 쓰는 행 수는 살아 있는
 *      행만 · 그 옵션의 필터는 0건 · "비어 있음" 에 든다 · 지운 뒤 그 id 로 쓰면 invalid_value
 *   ③ ★ status 의 기본 옵션을 지우면 남은 첫 옵션으로 옮긴다 — 새 행이 그것을 받는다 · 남은 것이 없으면 null 이고 새 행은 값이 없다
 *   ④ 보드의 그 열의 수동 순서(row_position.group_key = 옵션 id)를 지운다
 *   ⑤ ★ 경주 — 옵션을 쥔(FOR SHARE) 쓰기가 끝나기를 지우기가 기다리고, 그 쓰기가 넣은 셀까지 비운다
 *   ⑥ ★ 셀 쓰기의 옵션 확인은 옵션 행을 쥔다 — 다른 연결이 그 행을 배타로 잡지 못한다
 *   ⑦ 권한 · 없는 것 — 값만 고칠 수 있는 사람(edit_content)은 forbidden · 다른 속성의 옵션은 not_found · 옵션 타입이 아니면
 *      unsupported_type
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import type { CellValue } from './property-types.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, countOptionUsage, deleteSelectOption, getSchema, updateSelectOption } from './property.ts'
import { optionIssuesIn } from './options.ts'
import { queryRows } from './query.ts'
import { createRow, trashRow, updateCells } from './row.ts'
import { createTemplate } from './template.ts'
import { grantAccess } from '../permissions/acl.ts'
import { getPool, query } from '../db/pool.ts'
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

/** 표 하나 — 단계(select · 가 · 나) · 진행(status · 만들 때 옵션 셋) · 메모(글). */
async function board() {
  const ws = await createBareWorkspace('옵션 고치기')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const mate: Actor = await joinAs(ws, await createUser('동료'), 'member')
  const db = unwrap(await createDatabase(boss.ctx, { name: `옵션 고치기 ${Date.now()}`, privateTop: true }))
  const ds = db.dataSourceId
  unwrap(await addProperty(boss.ctx, ds, { name: '단계', type: 'select' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '진행', type: 'status' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '메모', type: 'rich_text' }))
  const schema = unwrap(await getSchema(boss.ctx, ds))
  const prop = (name: string) => schema.properties.find((p) => p.name === name)!
  const stage = prop('단계').id
  const a = unwrap(await addSelectOption(boss.ctx, ds, stage, { name: '가' })).option.id
  const b = unwrap(await addSelectOption(boss.ctx, ds, stage, { name: '나' })).option.id
  return { ws, boss, mate, db, ds, stage, progress: prop('진행'), memo: prop('메모').id, a, b }
}

const cellOf = async (rowId: string, propertyId: string) =>
  (await query<{ value: unknown; text_value: string | null }>(
    `SELECT value, text_value FROM page_property_value WHERE page_id = $1 AND property_id = $2`,
    [rowId, propertyId],
  ))[0] ?? null

const schemaVersionOf = async (ds: string) => (await query<{ v: string }>(`SELECT schema_version::text AS v FROM data_source WHERE id = $1`, [ds]))[0].v

describe('① ★ 이름 · 색 바꾸기', () => {
  test('셀은 따라온다 · 겹치면 거부 · 대소문자만은 된다 · 그대로면 버전 그대로 · 팔레트 밖은 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, ds, stage, a, b } = await board()
    const row = unwrap(await createRow(boss.ctx, ds, { cells: [{ propertyId: stage, value: sel(a) }] })).id

    const renamed = unwrap(await updateSelectOption(boss.ctx, ds, stage, a, { name: '시작 전', color: 'blue' }))
    assert.deepEqual([renamed.option.name, renamed.option.color], ['시작 전', 'blue'])
    const options = unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.id === stage)!.options!
    assert.deepEqual(options.find((o) => o.id === a), { id: a, name: '시작 전', color: 'blue' })
    assert.deepEqual((await cellOf(row, stage))?.value, sel(a), '셀은 id 그대로 — 이름은 스키마에서 읽는다')

    const dup = await updateSelectOption(boss.ctx, ds, stage, b, { name: '시작 전' })
    assert.ok(!dup.ok && dup.reason === 'duplicate_name', JSON.stringify(dup))
    const latin = unwrap(await updateSelectOption(boss.ctx, ds, stage, b, { name: 'Todo' }))
    assert.equal(latin.option.name, 'Todo')
    const dupCase = await updateSelectOption(boss.ctx, ds, stage, a, { name: 'TODO' })
    assert.ok(!dupCase.ok && dupCase.reason === 'duplicate_name', '대소문자 무시로 겹친다')
    assert.equal(unwrap(await updateSelectOption(boss.ctx, ds, stage, b, { name: 'TODO' })).option.name, 'TODO', '자기 이름의 대소문자만 바꾸는 것은 된다')

    const before = await schemaVersionOf(ds)
    const same = unwrap(await updateSelectOption(boss.ctx, ds, stage, b, { name: 'TODO' }))
    assert.equal(same.schemaVersion, before, '바뀐 것이 없으면 버전을 올리지 않는다')
    assert.equal(await schemaVersionOf(ds), before)

    const badColor = await updateSelectOption(boss.ctx, ds, stage, b, { color: 'chartreuse' })
    assert.ok(!badColor.ok && badColor.reason === 'invalid_color')
    const empty = await updateSelectOption(boss.ctx, ds, stage, b, { name: '   ' })
    assert.ok(!empty.ok && empty.reason === 'invalid_name')
  })
})

describe('② ★ 지우기는 그 옵션의 셀을 비운다', () => {
  test('살아 있는 행 · 템플릿 · 휴지통 모두 · 다른 옵션은 그대로 · 행 수는 살아 있는 것만 · 필터 0건 · 지운 뒤 쓰기는 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, ds, stage, a, b } = await board()
    const live1 = unwrap(await createRow(boss.ctx, ds, { cells: [{ propertyId: stage, value: sel(a) }] })).id
    const live2 = unwrap(await createRow(boss.ctx, ds, { cells: [{ propertyId: stage, value: sel(a) }] })).id
    const keep = unwrap(await createRow(boss.ctx, ds, { cells: [{ propertyId: stage, value: sel(b) }] })).id
    const trashed = unwrap(await createRow(boss.ctx, ds, { cells: [{ propertyId: stage, value: sel(a) }] })).id
    unwrap(await trashRow(boss.ctx, trashed))
    const template = unwrap(await createTemplate(boss.ctx, ds, { title: '틀' })).id
    unwrap(await updateCells(boss.ctx, template, { cells: [{ propertyId: stage, value: sel(a) }] }))

    assert.equal(unwrap(await countOptionUsage(boss.ctx, ds, stage, a)).rows, 2, '쓰는 행 수는 살아 있는 행만')
    const before = await schemaVersionOf(ds)
    const deleted = unwrap(await deleteSelectOption(boss.ctx, ds, stage, a))
    assert.equal(deleted.clearedCells, 4, '살아 있는 둘 · 휴지통 하나 · 템플릿 하나')
    assert.notEqual(deleted.schemaVersion, before)
    for (const row of [live1, live2, trashed, template]) {
      assert.deepEqual(await cellOf(row, stage), { value: sel(null), text_value: null }, `비워지지 않았다: ${row}`)
    }
    assert.deepEqual(await cellOf(keep, stage), { value: sel(b), text_value: b }, '다른 옵션의 셀은 그대로')
    assert.equal(unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.id === stage)!.options!.some((o) => o.id === a), false)

    const ids = async (filter: unknown) => new Set(unwrap(await queryRows(boss.ctx, ds, { filter: filter as never })).rows.map((r) => r.id))
    assert.deepEqual(await ids({ property_id: stage, operator: 'equals', value: a }), new Set(), '지운 옵션의 필터는 0건')
    assert.deepEqual(await ids({ property_id: stage, operator: 'is_empty' }), new Set([live1, live2]), '비운 셀은 "비어 있음" 에 든다')

    const late = await updateCells(boss.ctx, keep, { cells: [{ propertyId: stage, value: sel(a) }] })
    assert.ok(!late.ok && late.reason === 'invalid_value', '지운 옵션으로는 쓰지 못한다')
    const again = await deleteSelectOption(boss.ctx, ds, stage, a)
    assert.ok(!again.ok && again.reason === 'not_found')
  })
})

describe('③ ★ status 의 기본 옵션', () => {
  test('지우면 남은 첫 옵션으로 옮긴다 · 새 행이 그것을 받는다 · 다 지우면 null 이고 새 행은 값이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, ds, progress } = await board()
    const options = progress.options!
    const config = async () => (await query<{ config: { default_option_id: string | null } }>(`SELECT config FROM property WHERE id = $1`, [progress.id]))[0].config
    const first = (await config()).default_option_id
    assert.equal(first, options[0].id, '전제: 처음 만들 때 첫 옵션이 기본')

    const deleted = unwrap(await deleteSelectOption(boss.ctx, ds, progress.id, first!))
    assert.equal(deleted.defaultOptionId, options[1].id, '남은 첫 옵션으로')
    assert.equal((await config()).default_option_id, options[1].id)
    const row = unwrap(await createRow(boss.ctx, ds))
    assert.deepEqual(row.properties[progress.id], { type: 'status', status: { id: options[1].id } }, '새 행이 새 기본을 받는다')

    for (const option of options.slice(1)) unwrap(await deleteSelectOption(boss.ctx, ds, progress.id, option.id))
    assert.equal((await config()).default_option_id, null, '남은 것이 없으면 null')
    const bare = await createRow(boss.ctx, ds)
    assert.ok(bare.ok, `기본이 지운 옵션을 가리키면 새 행이 옵션 확인에 걸린다: ${JSON.stringify(bare)}`)
  })
})

describe('④ 보드의 수동 순서', () => {
  test('그 열의 row_position 을 지운다 — 다른 열은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, db, ds, stage, a, b } = await board()
    const row = unwrap(await createRow(boss.ctx, ds, { cells: [{ propertyId: stage, value: sel(a) }] })).id
    await query(`INSERT INTO row_position (view_id, group_key, row_id, order_idx) VALUES ($1, $2, $3, 'a0'), ($1, $4, $3, 'a0')`, [
      db.defaultViewId,
      a,
      row,
      b,
    ])
    unwrap(await deleteSelectOption(boss.ctx, ds, stage, a))
    const keys = (await query<{ group_key: string }>(`SELECT group_key FROM row_position WHERE view_id = $1 AND row_id = $2`, [db.defaultViewId, row])).map((r) => r.group_key)
    assert.deepEqual(keys, [b])
  })
})

describe('⑤ ★ 경주 — 옵션을 쥔 쓰기', () => {
  test('지우기는 그 쓰기가 끝나기를 기다리고, 그 쓰기가 넣은 셀까지 비운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, ds, stage, a } = await board()
    const row = unwrap(await createRow(boss.ctx, ds)).id

    // 셀 쓰기가 하는 일 — 옵션을 쥐고(확인) 셀을 새로 넣는다. 커밋 전에 지우기를 보낸다.
    const writer = await getPool().connect()
    try {
      await writer.query('BEGIN')
      await writer.query('SELECT id FROM select_option WHERE id = $1 FOR SHARE', [a])
      await writer.query(
        `INSERT INTO page_property_value (page_id, property_id, value, text_value) VALUES ($1, $2, $3::jsonb, $4)`,
        [row, stage, JSON.stringify(sel(a)), a],
      )
      const deleting = deleteSelectOption(boss.ctx, ds, stage, a)
      let waited = false
      for (let i = 0; i < 100 && !waited; i += 1) {
        waited = Number((await query<{ n: string }>(
          `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        ))[0].n) >= 1
        if (!waited) await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.ok(waited, '전제: 지우기가 쓰기를 기다린다')
      await writer.query('COMMIT')
      unwrap(await deleting)
    } finally {
      writer.release()
    }
    assert.deepEqual(await cellOf(row, stage), { value: sel(null), text_value: null }, '기다린 뒤의 비우기가 그 쓰기까지 봤다')
  })

  test('쓰기가 확인과 넣기 사이에 있을 때 지우기가 와도 교착이 없다 — 넣기가 끝나면 지우기가 그 셀까지 비운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, ds, stage, a } = await board()
    const row = unwrap(await createRow(boss.ctx, ds)).id

    // 확인만 하고(옵션을 쥐고) 아직 넣지 않았다 — 그 사이에 지우기가 온다. 넣기는 외래 키로 속성 행을 FOR KEY SHARE 로 건다:
    // 지우기가 속성 행을 배타로 쥐고 있으면 넣기는 지우기를, 지우기는 옵션의 공유 잠금을 기다리는 교착이 된다.
    const writer = await getPool().connect()
    try {
      await writer.query('BEGIN')
      await writer.query('SELECT id FROM select_option WHERE id = $1 FOR SHARE', [a])
      const deleting = deleteSelectOption(boss.ctx, ds, stage, a)
      let waited = false
      for (let i = 0; i < 100 && !waited; i += 1) {
        waited = Number((await query<{ n: string }>(
          `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        ))[0].n) >= 1
        if (!waited) await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.ok(waited, '전제: 지우기가 쓰기를 기다린다')
      await writer.query(
        `INSERT INTO page_property_value (page_id, property_id, value, text_value) VALUES ($1, $2, $3::jsonb, $4)`,
        [row, stage, JSON.stringify(sel(a)), a],
      )
      await writer.query('COMMIT')
      unwrap(await deleting)
    } finally {
      writer.release()
    }
    assert.deepEqual(await cellOf(row, stage), { value: sel(null), text_value: null })
  })
})

describe('⑥ ★ 셀 쓰기의 옵션 확인은 옵션 행을 쥔다', () => {
  test('확인한 트랜잭션이 열린 동안 다른 연결이 그 행을 배타로 잡지 못한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, stage, a } = await board()
    void ds
    let blocked: string | null = null
    await withTransaction(async (tx) => {
      assert.deepEqual(await optionIssuesIn(tx, [{ propertyId: stage, value: sel(a) }]), [])
      const other = await getPool().connect()
      try {
        await other.query('BEGIN')
        await other.query('SELECT id FROM select_option WHERE id = $1 FOR UPDATE NOWAIT', [a]).catch((e: { code?: string }) => {
          blocked = e.code ?? 'error'
        })
        await other.query('ROLLBACK')
      } finally {
        other.release()
      }
    })
    assert.equal(blocked, '55P03', '확인이 옵션 행을 쥐지 않았다 — 지우기와 줄을 서지 않는다')
  })
})

describe('⑦ 권한 · 없는 것', () => {
  test('값만 고칠 수 있는 사람은 forbidden · 다른 속성의 옵션은 not_found · 옵션 타입이 아니면 unsupported_type', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, db, ds, stage, memo, progress, a } = await board()
    assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: mate.userId }, 'edit_content')).ok)
    for (const r of [
      await updateSelectOption(mate.ctx, ds, stage, a, { name: '다' }),
      await deleteSelectOption(mate.ctx, ds, stage, a),
      await countOptionUsage(mate.ctx, ds, stage, a),
    ]) {
      assert.ok(!r.ok && r.reason === 'forbidden', JSON.stringify(r))
    }
    const otherProperty = await deleteSelectOption(boss.ctx, ds, progress.id, a)
    assert.ok(!otherProperty.ok && otherProperty.reason === 'not_found', '다른 속성의 옵션')
    const notOption = await updateSelectOption(boss.ctx, ds, memo, a, { name: '다' })
    assert.ok(!notOption.ok && notOption.reason === 'unsupported_type')
    assert.equal((await query(`SELECT 1 FROM select_option WHERE id = $1`, [a])).length, 1, '아무것도 지우지 않았다')
  })
})
