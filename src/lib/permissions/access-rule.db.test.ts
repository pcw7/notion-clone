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
 *   ④ 게이트 — 관리(manage_perm)만 둔다 · 보는 사람은 목록만 · 못 보면 not_found · 사람 속성은 unsupported_source · 페이지 레벨
 *      넷만 · 다른 데이터베이스의 data source 는 not_found
 *   ⑤ 감사 로그 — 바뀌었을 때만(같은 레벨 · 없는 규칙 지우기는 남기지 않는다)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { createDatabase } from '../database/database.ts'
import { createRow } from '../database/row.ts'
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

    assert.deepEqual(await setAccessRule(boss.ctx, db.id, rule(db.dataSourceId, 'edit', 'person_property')), { ok: false, reason: 'unsupported_source' })
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
