/**
 * 행 단위 접근 규칙 — 게시 · 공유 6f-2a조각 (F-06-10 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.3 끝 [보강] 행 단위 접근 규칙).
 *
 *   ① ★ "만든 사람" 규칙 — 데이터베이스를 못 보는 사람이 **자기가 만든 행만** 보고 고친다 · 남의 행 · 데이터베이스는 못 본다 ·
 *      레벨을 바꾸면 바뀌고 지우면 곧바로 잃는다 · 여러 사람 판정(`viewersOf`)도 같은 답
 *   ② ★ 노드 로컬(P4) — 그 행을 끊어도 규칙 부여는 남고 복사되지 않는다 · 행 아래 페이지는 상속으로 받고, 끊으면 그 순간의 것이
 *      복사된다(P1)
 *   ③ 템플릿 행은 받지 않는다(R1)
 *   ④ 게이트 — 관리(manage_perm)만 둔다 · 보는 사람은 목록만 · 못 보면 not_found · 모르는 원천은 unsupported_source · 페이지 레벨
 *      넷만 · 다른 데이터베이스의 data source 는 not_found
 *   ⑤ 감사 로그 — 바뀌었을 때만(같은 레벨 · 없는 규칙 지우기는 남기지 않는다)
 *   ⑥ ★ 사람 속성 규칙(6g-3a · ③) — 칸에 든 사람이 그 행을 열고, 칸에서 빼면 곧바로 잃는다 · 칸의 사람마다 · 다른 행은 못 연다 ·
 *      여러 사람 판정도 같은 답 · 만든 사람 규칙과 합친다 · 원천 속성을 휴지통에 넣으면 빠지고 되살리면 돌아온다 · 템플릿 행은 받지
 *      않는다
 *   ⑦ 사람 속성 규칙의 게이트 — 원천은 그 data source 의 살아 있는 사람 속성(아니면 invalid_property) · 만든 사람 규칙에 속성을 주면
 *      invalid_property · 속성마다 하나(둘이 함께 있고 하나를 지워도 다른 것은 남는다) · 휴지통의 속성의 규칙도 지운다 · 감사 로그에
 *      속성
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { createDatabase } from '../database/database.ts'
import { createRow, updateCells } from '../database/row.ts'
import { addProperty, deleteProperty, getSchema, restoreProperty } from '../database/property.ts'
import type { CellValue } from '../database/property-types.ts'
import { createTemplate } from '../database/template.ts'
import { query } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import type { BlockId } from '../ids.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { grantAccess, revokeAccess, stopInheriting } from './acl.ts'
import { listAccessRules, removeAccessRule, setAccessRule } from './access-rule.ts'
import { effectiveCaps, viewersOf } from './effective.ts'
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

/**
 * 소유자의 개인 표 · 그 표에서 행 하나씩 만든 동료(잠시 편집으로 들였다가 거둔다 — 이제 표를 못 본다) · 소유자의 행.
 */
async function tableWithRows() {
  const ws = await createBareWorkspace('행 규칙')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  const made = await createDatabase(boss.ctx, { name: unique('제출함'), privateTop: true })
  assert.ok(made.ok, JSON.stringify(made))
  const db = made.value
  assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: mate.userId }, 'edit')).ok)
  const mine = await createRow(mate.ctx, db.dataSourceId)
  const theirs = await createRow(boss.ctx, db.dataSourceId)
  assert.ok(mine.ok && theirs.ok)
  assert.ok((await revokeAccess(boss.ctx, db.id, { type: 'user', id: mate.userId })).ok)
  return { ws, boss, mate, db, mine: mine.value.id, theirs: theirs.value.id }
}

const capsOf = (who: Actor, node: string) => withReadTransaction((tx) => effectiveCaps(tx, who.ctx, node))
const rule = (dataSourceId: string, level: string, source = 'created_by') => ({ dataSourceId, source, level })
const auditCount = async (workspaceId: string) =>
  (
    await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_event
        WHERE workspace_id = $1 AND event_type = 'page.permission_changed' AND metadata->>'change' LIKE 'rule_%'`,
      [workspaceId],
    )
  )[0].n

// ── ① 만든 사람 ───────────────────────────────────────────────────────

describe('① ★ "만든 사람" 규칙', () => {
  test('데이터베이스를 못 보는 사람이 자기가 만든 행만 보고 고친다 · 레벨을 바꾸면 바뀌고 지우면 잃는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, db, mine, theirs } = await tableWithRows()
    assert.equal(can(await capsOf(mate, mine), 'view'), false, '규칙 전 — 자기 행도 못 본다')

    const set = await setAccessRule(boss.ctx, db.id, rule(db.dataSourceId, 'edit'))
    assert.ok(set.ok, JSON.stringify(set))
    const own = await capsOf(mate, mine)
    assert.ok(can(own, 'view') && can(own, 'edit_content'), '자기 행을 보고 고친다')
    assert.equal(can(own, 'manage_perm'), false, '편집은 공유를 품지 않는다')
    assert.equal(can(await capsOf(mate, theirs), 'view'), false, '남의 행은 못 본다')
    assert.equal(can(await capsOf(mate, db.id), 'view'), false, '데이터베이스는 못 본다')
    assert.ok(can(await capsOf(boss, theirs), 'manage_perm'), '소유자는 그대로')

    // 여러 사람 판정도 같은 답 — 합성한 행은 판정하는 주체와 무관하다
    const viewers = await withReadTransaction((tx) => viewersOf(tx, boss.ctx.workspaceId, [mine, theirs]))
    assert.ok(viewers.get(mine)?.has(mate.userId))
    assert.equal(viewers.get(theirs)?.has(mate.userId), false)

    assert.ok((await setAccessRule(boss.ctx, db.id, rule(db.dataSourceId, 'view'))).ok)
    const viewOnly = await capsOf(mate, mine)
    assert.ok(can(viewOnly, 'view') && !can(viewOnly, 'edit_content'), '레벨을 바꾸면 바뀐다(규칙은 하나 — 레벨만)')
    assert.equal((await listAccessRules(boss.ctx, db.id)).ok && (await listAccessRules(boss.ctx, db.id)).value.length, 1)

    assert.ok((await removeAccessRule(boss.ctx, db.id, { dataSourceId: db.dataSourceId, source: 'created_by' })).ok)
    assert.equal(can(await capsOf(mate, mine), 'view'), false, '지우면 곧바로 잃는다')
  })
})

// ── ② 노드 로컬 ───────────────────────────────────────────────────────

describe('② ★ 노드 로컬(P4) · 행 아래는 상속(P1)', () => {
  test('행을 끊어도 규칙 부여는 남고 복사되지 않는다 · 행 아래 페이지를 끊으면 그 순간의 것이 복사된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, db, mine } = await tableWithRows()
    assert.ok((await setAccessRule(boss.ctx, db.id, rule(db.dataSourceId, 'edit'))).ok)
    const sub = await createPage(boss.ctx, { title: titleFromPlainText(unique('붙임')), parentPageId: mine as BlockId })
    assert.ok(can(await capsOf(mate, sub.id), 'edit_content'), '행 아래 페이지는 상속으로 받는다')

    assert.ok((await stopInheriting(boss.ctx, mine)).ok)
    assert.ok(can(await capsOf(mate, mine), 'edit_content'), '끊어도 규칙 부여는 남는다(자기 노드의 것)')
    const copied = await query<{ principal_id: string }>(
      `SELECT principal_id FROM acl_entry WHERE node_id = $1 AND principal_type = 'user'`,
      [mine],
    )
    assert.ok(!copied.some((r) => r.principal_id === mate.userId), '행을 끊을 때 자기 규칙 부여는 복사하지 않는다 — 동적으로 남는다')

    assert.ok((await stopInheriting(boss.ctx, sub.id)).ok)
    const subCopied = await query<{ level: string }>(
      `SELECT level FROM acl_entry WHERE node_id = $1 AND principal_type = 'user' AND principal_id = $2`,
      [sub.id, mate.userId],
    )
    assert.deepEqual(subCopied.map((r) => r.level), ['edit'], '행 아래를 끊으면 그 순간의 규칙 부여가 복사된다(P1)')
    assert.ok((await removeAccessRule(boss.ctx, db.id, { dataSourceId: db.dataSourceId, source: 'created_by' })).ok)
    assert.equal(can(await capsOf(mate, mine), 'view'), false)
    assert.ok(can(await capsOf(mate, sub.id), 'edit_content'), '복사된 것은 규칙과 무관하게 남는다(P2)')
  })
})

// ── ③ 템플릿 ──────────────────────────────────────────────────────────

describe('③ 템플릿 행은 받지 않는다', () => {
  test('자기가 만든 템플릿이라도 규칙으로는 열리지 않는다(R1 — 템플릿은 항목이 아니다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ws = await createBareWorkspace('행 규칙 템플릿')
    const boss = await joinAs(ws, await createUser('대표'), 'owner')
    const mate = await joinAs(ws, await createUser('동료'), 'member')
    const made = await createDatabase(boss.ctx, { name: unique('양식'), privateTop: true })
    assert.ok(made.ok)
    const db = made.value
    assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: mate.userId }, 'edit')).ok)
    const template = await createTemplate(mate.ctx, db.dataSourceId, { title: '동료의 양식' })
    assert.ok(template.ok)
    assert.ok((await revokeAccess(boss.ctx, db.id, { type: 'user', id: mate.userId })).ok)
    assert.ok((await setAccessRule(boss.ctx, db.id, rule(db.dataSourceId, 'edit'))).ok)
    assert.equal(can(await capsOf(mate, template.value.id), 'view'), false)
  })
})

// ── ④ 게이트 ──────────────────────────────────────────────────────────

describe('④ 게이트', () => {
  test('관리만 둔다 · 보는 사람은 목록만 · 못 보면 not_found · 사람 속성 · 레벨 · 남의 data source', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate, db } = await tableWithRows()
    const viewer = await joinAs(ws, await createUser('보는 사람'), 'member')
    assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: viewer.userId }, 'edit')).ok)

    assert.deepEqual(await setAccessRule(viewer.ctx, db.id, rule(db.dataSourceId, 'edit')), { ok: false, reason: 'forbidden' }, '편집은 공유가 아니다')
    assert.deepEqual(await setAccessRule(mate.ctx, db.id, rule(db.dataSourceId, 'edit')), { ok: false, reason: 'not_found' })
    assert.deepEqual(await listAccessRules(mate.ctx, db.id), { ok: false, reason: 'not_found' })
    assert.deepEqual(await listAccessRules(viewer.ctx, db.id), { ok: true, value: [] })

    assert.deepEqual(await setAccessRule(boss.ctx, db.id, rule(db.dataSourceId, 'edit', 'assignee')), { ok: false, reason: 'unsupported_source' })
    for (const level of ['edit_content', 'create', 'owner']) {
      assert.deepEqual(await setAccessRule(boss.ctx, db.id, rule(db.dataSourceId, level)), { ok: false, reason: 'invalid_level' }, level)
    }
    const other = await createDatabase(boss.ctx, { name: unique('다른 표'), privateTop: true })
    assert.ok(other.ok)
    assert.deepEqual(await setAccessRule(boss.ctx, db.id, rule(other.value.dataSourceId, 'edit')), { ok: false, reason: 'not_found' })
    const page = await createPage(boss.ctx, { title: titleFromPlainText(unique('문서')) })
    assert.deepEqual(await setAccessRule(boss.ctx, page.id, rule(db.dataSourceId, 'edit')), { ok: false, reason: 'not_found' }, '페이지는 데이터베이스가 아니다')
    assert.deepEqual(await listAccessRules(boss.ctx, db.id), { ok: true, value: [] }, '거부는 아무것도 남기지 않는다')
  })
})

// ── ⑤ 감사 ────────────────────────────────────────────────────────────

describe('⑤ 감사 로그 — 바뀌었을 때만', () => {
  test('두기 · 같은 레벨 · 바꾸기 · 지우기 · 없는 것 지우기', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, db } = await tableWithRows()
    const off = { dataSourceId: db.dataSourceId, source: 'created_by' }
    assert.ok((await setAccessRule(boss.ctx, db.id, rule(db.dataSourceId, 'edit'))).ok)
    assert.ok((await setAccessRule(boss.ctx, db.id, rule(db.dataSourceId, 'edit'))).ok)
    assert.equal(await auditCount(ws), '1', '같은 레벨은 남기지 않는다')
    assert.ok((await setAccessRule(boss.ctx, db.id, rule(db.dataSourceId, 'comment'))).ok)
    assert.ok((await removeAccessRule(boss.ctx, db.id, off)).ok)
    assert.ok((await removeAccessRule(boss.ctx, db.id, off)).ok, '없는 규칙을 지워도 성공')
    assert.equal(await auditCount(ws), '3')
    const rows = await query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_event WHERE workspace_id = $1 AND event_type = 'page.permission_changed' AND metadata->>'change' LIKE 'rule_%'
        ORDER BY occurred_at, id`,
      [ws],
    )
    assert.deepEqual(rows.map((r) => r.metadata), [
      { change: 'rule_set', source: 'created_by', level: 'edit' },
      { change: 'rule_set', source: 'created_by', level: 'comment' },
      { change: 'rule_removed', source: 'created_by' },
    ])
  })
})

// ── ⑥ 사람 속성 규칙 ──────────────────────────────────────────────────

const people = (...ids: string[]): CellValue => ({ type: 'people', people: ids.map((id) => ({ id })) })

/** 담당(사람) · 검토(사람) · 점수(숫자) 속성이 있는 `tableWithRows`. */
async function tableWithPeople() {
  const base = await tableWithRows()
  const { boss, db } = base
  for (const [name, type] of [['담당', 'people'], ['검토', 'people'], ['점수', 'number']] as const) {
    assert.ok((await addProperty(boss.ctx, db.dataSourceId, { name, type })).ok)
  }
  const schema = await getSchema(boss.ctx, db.dataSourceId)
  assert.ok(schema.ok)
  const id = (name: string) => schema.value.properties.find((p) => p.name === name)!.id
  return { ...base, owner: id('담당'), reviewer: id('검토'), score: id('점수') }
}

const personRule = (dataSourceId: string, propertyId: string, level: string) => ({ dataSourceId, source: 'person_property', propertyId, level })
const setCell = async (who: Actor, row: string, propertyId: string, value: CellValue) =>
  assert.ok((await updateCells(who.ctx, row, { cells: [{ propertyId, value }] })).ok)

describe('⑥ ★ 사람 속성 규칙', () => {
  test('칸에 든 사람이 연다 · 칸에서 빼면 잃는다 · 칸의 사람마다 · 다른 행은 못 연다 · 여러 사람 판정도 같은 답', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate, db, mine, theirs, owner } = await tableWithPeople()
    const third = await joinAs(ws, await createUser('셋째'), 'member')
    await setCell(boss, theirs, owner, people(mate.userId, third.userId))
    assert.equal(can(await capsOf(mate, theirs), 'view'), false, '규칙 전 — 칸에 들어도 못 본다')

    const set = await setAccessRule(boss.ctx, db.id, personRule(db.dataSourceId, owner, 'edit'))
    assert.ok(set.ok, JSON.stringify(set))
    assert.equal(set.value.propertyId, owner)
    for (const who of [mate, third]) {
      const caps = await capsOf(who, theirs)
      assert.ok(can(caps, 'view') && can(caps, 'edit_content'), '칸의 사람마다 연다')
      assert.equal(can(caps, 'manage_perm'), false)
    }
    assert.equal(can(await capsOf(mate, mine), 'view'), false, '칸이 빈 행은 못 연다(자기가 만든 행이라도 — 만든 사람 규칙이 없다)')
    assert.equal(can(await capsOf(mate, db.id), 'view'), false, '데이터베이스는 못 본다')
    const viewers = await withReadTransaction((tx) => viewersOf(tx, boss.ctx.workspaceId, [mine, theirs]))
    assert.ok(viewers.get(theirs)?.has(mate.userId) && viewers.get(theirs)?.has(third.userId))
    assert.equal(viewers.get(mine)?.has(mate.userId), false)

    await setCell(boss, theirs, owner, people(third.userId))
    assert.equal(can(await capsOf(mate, theirs), 'view'), false, '칸에서 빼면 곧바로 잃는다(06 엣지 "이전 담당자의 접근 즉시 소멸")')
    assert.ok(can(await capsOf(third, theirs), 'edit_content'), '남은 사람은 그대로')

    // 06 엣지 "권한 상승 경로" — 편집을 받은 사람은 칸을 고칠 수 있다. 자기를 빼면 잃고, 남을 넣으면 공유 권한 없이 그 사람에게 연다
    // (규칙의 뜻 — 정본 ③). 주는 레벨은 규칙의 레벨이다
    await setCell(third, theirs, owner, people(mate.userId))
    assert.equal(can(await capsOf(third, theirs), 'view'), false, '자기를 빼면 잃는다')
    assert.ok(can(await capsOf(mate, theirs), 'edit_content'))
  })

  test('만든 사람 규칙과 합친다 · 원천 속성을 휴지통에 넣으면 빠지고 되살리면 돌아온다 · 다른 사람 속성은 원천이 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, db, mine, owner, reviewer } = await tableWithPeople()
    await setCell(boss, mine, owner, people(mate.userId))
    assert.ok((await setAccessRule(boss.ctx, db.id, rule(db.dataSourceId, 'view'))).ok)
    assert.ok((await setAccessRule(boss.ctx, db.id, personRule(db.dataSourceId, owner, 'edit'))).ok)
    assert.ok(can(await capsOf(mate, mine), 'edit_content'), '만든 사람(보기) + 담당(편집) — 합친다')

    assert.ok((await deleteProperty(boss.ctx, db.dataSourceId, owner)).ok)
    const trashed = await capsOf(mate, mine)
    assert.ok(can(trashed, 'view') && !can(trashed, 'edit_content'), '원천 속성이 휴지통 — 사람 규칙은 빠지고 만든 사람 규칙만 남는다')
    assert.ok((await restoreProperty(boss.ctx, db.dataSourceId, owner)).ok)
    assert.ok(can(await capsOf(mate, mine), 'edit_content'), '되살리면 돌아온다')

    await setCell(boss, mine, owner, people())
    await setCell(boss, mine, reviewer, people(mate.userId))
    const other = await capsOf(mate, mine)
    assert.ok(can(other, 'view') && !can(other, 'edit_content'), '규칙이 없는 사람 속성(검토)의 칸은 아무것도 주지 않는다')
  })

  test('템플릿 행은 칸에 들어도 받지 않는다(R1)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, db, owner } = await tableWithPeople()
    const template = await createTemplate(boss.ctx, db.dataSourceId, { title: '담당 양식' })
    assert.ok(template.ok)
    await setCell(boss, template.value.id, owner, people(mate.userId))
    assert.ok((await setAccessRule(boss.ctx, db.id, personRule(db.dataSourceId, owner, 'edit'))).ok)
    assert.equal(can(await capsOf(mate, template.value.id), 'view'), false)
  })
})

// ── ⑦ 사람 속성 규칙의 게이트 ─────────────────────────────────────────

describe('⑦ 사람 속성 규칙의 게이트', () => {
  test('원천 · 속성마다 하나 · 휴지통의 속성의 규칙 지우기 · 감사 로그', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, db, owner, reviewer, score } = await tableWithPeople()
    const ds = db.dataSourceId
    const bad = { ok: false, reason: 'invalid_property' }
    assert.deepEqual(await setAccessRule(boss.ctx, db.id, rule(ds, 'edit', 'person_property')), bad, '속성이 없다')
    assert.deepEqual(await setAccessRule(boss.ctx, db.id, personRule(ds, score, 'edit')), bad, '사람 속성이 아니다')
    assert.deepEqual(await setAccessRule(boss.ctx, db.id, personRule(ds, 'p00000000000000000000', 'edit')), bad, '없는 속성')
    assert.deepEqual(await setAccessRule(boss.ctx, db.id, { ...rule(ds, 'edit'), propertyId: owner }), bad, '만든 사람 규칙에 속성')
    const other = await createDatabase(boss.ctx, { name: unique('다른 표'), privateTop: true })
    assert.ok(other.ok)
    assert.ok((await addProperty(boss.ctx, other.value.dataSourceId, { name: '담당', type: 'people' })).ok)
    const otherSchema = await getSchema(boss.ctx, other.value.dataSourceId)
    assert.ok(otherSchema.ok)
    const otherOwner = otherSchema.value.properties.find((p) => p.name === '담당')!.id
    assert.deepEqual(await setAccessRule(boss.ctx, db.id, personRule(ds, otherOwner, 'edit')), bad, '다른 표의 사람 속성')
    assert.deepEqual(await setAccessRule(boss.ctx, db.id, personRule(ds, owner, 'create')), { ok: false, reason: 'invalid_level' })
    assert.deepEqual(await listAccessRules(boss.ctx, db.id), { ok: true, value: [] }, '거부는 아무것도 남기지 않는다')

    assert.ok((await setAccessRule(boss.ctx, db.id, personRule(ds, owner, 'edit'))).ok)
    assert.ok((await setAccessRule(boss.ctx, db.id, personRule(ds, reviewer, 'comment'))).ok)
    assert.ok((await setAccessRule(boss.ctx, db.id, personRule(ds, owner, 'view'))).ok, '같은 속성 — 레벨만 바꾼다')
    const listed = await listAccessRules(boss.ctx, db.id)
    assert.ok(listed.ok)
    assert.deepEqual(
      listed.value.map((r) => [r.source, r.propertyId, r.level]).sort(),
      [['person_property', owner, 'view'], ['person_property', reviewer, 'comment']].sort(),
      '속성마다 하나',
    )

    assert.ok((await deleteProperty(boss.ctx, ds, owner)).ok)
    assert.deepEqual(await setAccessRule(boss.ctx, db.id, personRule(ds, owner, 'edit')), bad, '휴지통의 속성으로는 두지 못한다')
    assert.ok((await removeAccessRule(boss.ctx, db.id, { dataSourceId: ds, source: 'person_property', propertyId: owner })).ok, '휴지통의 속성의 규칙도 지운다')
    assert.deepEqual(await removeAccessRule(boss.ctx, db.id, { dataSourceId: ds, source: 'person_property' }), bad, '지울 때도 속성이 있어야 한다')
    const left = await listAccessRules(boss.ctx, db.id)
    assert.ok(left.ok)
    assert.deepEqual(left.value.map((r) => r.propertyId), [reviewer], '다른 속성의 규칙은 남는다')

    const rows = await query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_event WHERE workspace_id = $1 AND event_type = 'page.permission_changed' AND metadata->>'change' LIKE 'rule_%'
        ORDER BY occurred_at, id`,
      [ws],
    )
    assert.deepEqual(rows.map((r) => r.metadata), [
      { change: 'rule_set', source: 'person_property', propertyId: owner, level: 'edit' },
      { change: 'rule_set', source: 'person_property', propertyId: reviewer, level: 'comment' },
      { change: 'rule_set', source: 'person_property', propertyId: owner, level: 'view' },
      { change: 'rule_removed', source: 'person_property', propertyId: owner },
    ])
  })
})
