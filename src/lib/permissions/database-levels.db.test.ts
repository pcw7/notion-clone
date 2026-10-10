/**
 * 데이터베이스의 레벨 — 게시 · 공유 6f-1조각 (F-06-10 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.3 [보강] 데이터베이스의 레벨).
 *
 *   ① ★ 데이터베이스에 준 "내용 편집"(`edit_content`) — 행을 만들고 셀을 고친다 · 구조(속성 · 템플릿 · 이름)는 못 고친다(forbidden) ·
 *      행(페이지)이 그 능력을 물려받는다(초판은 이 레벨을 조용히 무시했다)
 *   ② ★ 행에서 상속을 끊어도 "내용 편집" 을 잃지 않는다 — 복사된 그 레벨을 같은 뜻으로 읽는다(P1)
 *   ③ 부여는 노드의 종류가 정한다 — 페이지에 데이터베이스 전용 레벨은 invalid_level · 데이터베이스에는 여섯 모두 · "만들기만" 은
 *      create_child 하나(보지 못한다)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase, renameDatabase } from '../database/database.ts'
import { addProperty } from '../database/property.ts'
import { createRow, updateCells } from '../database/row.ts'
import { createTemplate } from '../database/template.ts'
import { queryOne } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { grantAccess, revokeAccess, stopInheriting } from './acl.ts'
import { effectiveCaps } from './effective.ts'
import { can } from './levels.ts'

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

// ── 도우미 ────────────────────────────────────────────────────────────

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)}`

/** 소유자의 개인 표 하나와, 그 표에만 레벨을 받은 멤버. */
async function tableWith(level: 'view' | 'edit_content' | 'edit' | 'create') {
  const ws = await createBareWorkspace('표 레벨')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  const db = await createDatabase(boss.ctx, { name: unique('업무'), privateTop: true })
  assert.ok(db.ok, JSON.stringify(db))
  const granted = await grantAccess(boss.ctx, db.value.id, { type: 'user', id: mate.userId }, level)
  assert.ok(granted.ok, JSON.stringify(granted))
  const titleId = (await queryOne<{ id: string }>(`SELECT id FROM property WHERE data_source_id = $1 AND type = 'title'`, [db.value.dataSourceId])).id
  return { ws, boss, mate, db: db.value, titleId }
}

const capsOf = (who: Actor, node: string) => withReadTransaction((tx) => effectiveCaps(tx, who.ctx, node))
const titleCell = (titleId: string, text: string) => ({ propertyId: titleId, value: { type: 'title' as const, title: [textRun(text)] } })

// ── ① 내용 편집 ───────────────────────────────────────────────────────

describe('① ★ 데이터베이스의 "내용 편집"', () => {
  test('행을 만들고 셀을 고친다 · 구조(속성 · 템플릿 · 이름)는 forbidden · 행이 그 능력을 물려받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate, db, titleId } = await tableWith('edit_content')

    const caps = await capsOf(mate, db.id)
    assert.ok(can(caps, 'view') && can(caps, 'edit_content') && can(caps, 'create_child'))
    assert.equal(can(caps, 'edit_structure'), false)

    const row = await createRow(mate.ctx, db.dataSourceId, { cells: [titleCell(titleId, '내가 만든 행')] })
    assert.ok(row.ok, JSON.stringify(row))
    const edited = await updateCells(mate.ctx, row.value.id, { cells: [titleCell(titleId, '고친 제목')] })
    assert.ok(edited.ok, JSON.stringify(edited))
    const rowCaps = await capsOf(mate, row.value.id)
    assert.ok(can(rowCaps, 'edit_content'), '행이 "내용 편집" 을 물려받는다')

    assert.deepEqual(await addProperty(mate.ctx, db.dataSourceId, { name: '마감', type: 'date' }), { ok: false, reason: 'forbidden' })
    const template = await createTemplate(mate.ctx, db.dataSourceId, { title: '템플릿' })
    assert.equal(template.ok, false, '템플릿 만들기는 구조다')
    assert.equal((await renameDatabase(mate.ctx, db.id, '바꾼 이름')).ok, false, '이름은 구조다')
  })
})

// ── ② 절단 ────────────────────────────────────────────────────────────

describe('② ★ 행에서 상속을 끊어도 잃지 않는다', () => {
  test('복사된 "내용 편집" 을 같은 뜻으로 읽는다 — 끊은 뒤에도 고친다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, db, titleId } = await tableWith('edit_content')
    const row = await createRow(boss.ctx, db.dataSourceId, { cells: [titleCell(titleId, '끊을 행')] })
    assert.ok(row.ok)

    assert.ok((await stopInheriting(boss.ctx, row.value.id)).ok)
    const copied = await queryOne<{ level: string }>(
      `SELECT level FROM acl_entry WHERE node_id = $1 AND principal_type = 'user' AND principal_id = $2`,
      [row.value.id, mate.userId],
    )
    assert.equal(copied.level, 'edit_content', '상속분이 그 레벨 그대로 복사된다')
    const caps = await capsOf(mate, row.value.id)
    assert.ok(can(caps, 'view') && can(caps, 'edit_content'), '끊은 뒤에도 보고 고친다(초판은 잃었다)')
    assert.ok((await updateCells(mate.ctx, row.value.id, { cells: [titleCell(titleId, '끊은 뒤 고침')] })).ok)

    // 데이터베이스의 부여를 거둬도 행은 따로 남는다(절단은 이후 조상 변경을 받지 않는다 — P2)
    assert.ok((await revokeAccess(boss.ctx, db.id, { type: 'user', id: mate.userId })).ok)
    assert.ok(can(await capsOf(mate, row.value.id), 'edit_content'))
  })
})

// ── ③ 부여의 검사 ─────────────────────────────────────────────────────

describe('③ 부여는 노드의 종류가 정한다', () => {
  test('페이지에 데이터베이스 전용 레벨은 invalid_level · 데이터베이스에는 여섯 · "만들기만" 은 만들기만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, db } = await tableWith('create')
    const createCaps = await capsOf(mate, db.id)
    assert.ok(can(createCaps, 'create_child'))
    assert.equal(can(createCaps, 'view'), false, '만들기만 — 보지 못한다')

    const page = await createPage(boss.ctx, { privateTop: true, title: titleFromPlainText(unique('문서')) })
    for (const level of ['edit_content', 'create'] as const) {
      assert.deepEqual(await grantAccess(boss.ctx, page.id, { type: 'user', id: mate.userId }, level), { ok: false, reason: 'invalid_level' })
    }
    for (const level of ['view', 'comment', 'edit_content', 'create', 'edit', 'full_access'] as const) {
      assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: mate.userId }, level)).ok, level)
    }
  })
})
