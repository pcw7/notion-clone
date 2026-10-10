/**
 * DB automation — 정의 · 실행 주체 · 화면이 읽는 것 (자동화 5b-1 · 5b-3a · F-08-09 · F-08-10, DB 필요)
 *
 * 이 파일이 지키는 것(정본 §3.10 [보강] DB automation ① ~ ④ · 화면 ① ⓐ ⓓ).
 *
 *   ① 문 — 그 데이터베이스의 전체 권한만(고치기만 받았으면 403 · 못 보면 404) · 읽기도 같다
 *   ② 정의 검사 — 트리거(없음 · 너무 많음 · 아직 받지 않는 종류 · 그 표의 셀 속성이 아님 · 조건이 그 속성의 필터가 아님) · 액션(버튼과 같은 검사)
 *   ③ 만들기 · 고치기 · 켜고 끄기 · 지우기 — 실행 주체는 처음 만든 사람으로 남는다 · 켜면 꺼진 까닭이 지워진다
 *   ④ 표마다 50개
 *   ⑤ 위임 발급자 — 만든 사람으로 · `automation` · 세션 자리에 automation id · 떠났거나 지워졌으면 `creator_left` · 남의 워크스페이스는 `not_found`
 *   ⑥ 위임 컨텍스트의 권한은 그 사람의 **지금** 권한이다 — 그 사람의 접근을 거두면 위임도 못 쓴다
 *   ⑦ 화면 — ⚡ 의 배지는 전체 권한에만(켜진 수 · 꺼진 까닭이 있는 수) · 실행 기록은 새것부터 상한만큼 · 트리거된 행의 제목은 보는 사람의
 *      권한으로(볼 수 없음 null · 지워짐은 키 없음) · 웹훅 단계의 배달 상태(5c-3b — 그 실행들의 것만) · 문은 정의와 같다
 *
 * 반사실(HANDOFF §3.3): 문을 고치기로 낮추면 ①, 조건 검사를 빼면 ②, 실행 주체를 고친 사람으로 바꾸면 ③, 멤버십을 보지 않으면 ⑤ 가 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { resolveDelegatedContext } from '../auth/session-context.ts'
import { asWorkspaceId } from '../ids.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty } from '../database/property.ts'
import { createRow, trashRow, updateCellsIn } from '../database/row.ts'
import { AUTOMATION_RUN_CAP } from '../notification/retention.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import {
  createDbAutomation,
  dbAutomationBadge,
  deleteDbAutomation,
  listDbAutomationRuns,
  listDbAutomations,
  MAX_DB_AUTOMATIONS,
  updateDbAutomation,
} from './db-automation.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let admin: Actor // 전체 권한을 받은 다른 사람
let editor: Actor // 고치기(edit)만
let outsider: Actor // 못 본다

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  admin = await joinAs(fx.workspaceId, await createUser('함께 관리하는 사람'), 'member')
  editor = await joinAs(fx.workspaceId, await createUser('고치기만 하는 사람'), 'member')
  outsider = await joinAs(fx.workspaceId, await createUser('못 보는 사람'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${JSON.stringify(r)}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

type Table = { databaseId: string; ds: string; qty: string; done: string; button: string; row: string }

/** 표 하나 — 수량(숫자) · 완료(체크) · 버튼 · 행 하나. 소유자 · 관리하는 사람은 전체 권한 · 고치는 사람은 edit · 못 보는 사람은 없다. */
async function table(name: string): Promise<Table> {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = db.dataSourceId
  const idOf = (props: readonly { id: string; name: string }[], n: string) => props.find((p) => p.name === n)!.id
  const qty = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '수량', type: 'number' })).properties, '수량')
  const done = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '완료', type: 'checkbox' })).properties, '완료')
  const button = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '버튼', type: 'button' })).properties, '버튼')
  const row = unwrap(await createRow(fx.owner.ctx, ds)).id
  assert.equal((await stopInheriting(fx.owner.ctx, db.id)).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
  await revokeAccess(fx.owner.ctx, db.id, { type: 'workspace_everyone' })
  assert.equal((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: admin.userId }, 'full_access')).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: editor.userId }, 'edit')).ok, true)
  return { databaseId: db.id, ds, qty, done, button, row }
}

const definition = (t: Table, name = '완료 처리') => ({
  name,
  triggers: [{ type: 'property_edited', propertyId: t.qty, condition: { property_id: t.qty, operator: 'greater_than', value: 5 } }, { type: 'page_added' }],
  actions: [{ type: 'edit_property', config: { v: 1, cells: [{ propertyId: t.done, value: { type: 'checkbox', checkbox: true } }] } }],
})

describe('① 문', () => {
  test('★ 전체 권한만 만들고 읽는다 — 고치기만 받았으면 403 · 못 보면 404', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('문 표')
    assert.deepEqual(await createDbAutomation(editor.ctx, tb.ds, definition(tb)), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await listDbAutomations(editor.ctx, tb.ds), { ok: false, reason: 'forbidden' }, '읽기도 전체 권한')
    assert.deepEqual(await createDbAutomation(outsider.ctx, tb.ds, definition(tb)), { ok: false, reason: 'not_found' })
    assert.deepEqual(await listDbAutomations(outsider.ctx, tb.ds), { ok: false, reason: 'not_found' })
    assert.deepEqual(await listDbAutomations(fx.owner.ctx, randomUUID()), { ok: false, reason: 'not_found' })
    const made = unwrap(await createDbAutomation(admin.ctx, tb.ds, definition(tb)))
    assert.equal(made.createdBy.id, admin.userId)
    assert.deepEqual(unwrap(await listDbAutomations(fx.owner.ctx, tb.ds)).map((a) => a.id), [made.id])
  })
})

describe('② 정의 검사', () => {
  test('★ 트리거 — 없음 · 너무 많음 · 아직 받지 않는 종류 · 그 표의 셀 속성이 아님 · 조건이 그 속성의 필터가 아님', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('트리거 표')
    const other = await table('다른 트리거 표')
    const edited = (propertyId: string, condition: unknown = null) => ({ type: 'property_edited', propertyId, condition })
    const cases: [unknown, string, number | undefined][] = [
      [[], 'no_triggers', undefined],
      [Array.from({ length: 6 }, () => ({ type: 'page_added' })), 'too_many_triggers', undefined],
      [[{ type: 'schedule' }], 'unsupported_trigger', 0],
      [[{ type: 'page_added' }, edited(other.qty)], 'unknown_property', 1],
      [[edited(tb.button)], 'unknown_property', 0],
      [[edited(tb.qty, { property_id: tb.done, operator: 'equals', value: true })], 'invalid_condition', 0],
      [[edited(tb.qty, { property_id: tb.qty, operator: '닮았다', value: 1 })], 'invalid_condition', 0],
      [[edited(tb.qty, { property_id: tb.qty, operator: 'greater_than', value: '많이' })], 'invalid_condition', 0],
    ]
    for (const [triggers, problem, index] of cases) {
      const r = await createDbAutomation(fx.owner.ctx, tb.ds, { ...definition(tb), triggers })
      assert.deepEqual(r, { ok: false, reason: 'invalid_trigger', problem, ...(index === undefined ? {} : { index }) }, problem)
    }
    // 액션 — 버튼과 같은 검사
    const badAction = await createDbAutomation(fx.owner.ctx, tb.ds, {
      ...definition(tb),
      actions: [{ type: 'edit_property', config: { v: 1, cells: [{ propertyId: other.qty, value: { type: 'number', number: 1 } }] } }],
    })
    assert.deepEqual(badAction, { ok: false, reason: 'invalid_action', problem: 'unknown_property', index: 0 })
    assert.deepEqual(await createDbAutomation(fx.owner.ctx, tb.ds, { ...definition(tb), name: '  ' }), { ok: false, reason: 'invalid_name' })
    assert.deepEqual(unwrap(await listDbAutomations(fx.owner.ctx, tb.ds)), [], '하나도 저장되지 않았다')
  })
})

describe('③ 만들기 · 고치기 · 켜고 끄기 · 지우기', () => {
  test('★ 실행 주체는 처음 만든 사람으로 남는다 · 켜면 꺼진 까닭이 지워진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('고치기 표')
    const made = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, definition(tb)))
    assert.deepEqual(
      made.triggers.map((x) => x.type).sort(),
      ['page_added', 'property_edited'],
    )
    const renamed = unwrap(await updateDbAutomation(admin.ctx, tb.ds, made.id, { name: '새 이름', triggers: [{ type: 'page_added' }] }))
    assert.deepEqual([renamed.name, renamed.createdBy.id, renamed.triggers], ['새 이름', fx.owner.userId, [{ type: 'page_added' }]], '고친 사람이 바뀌어도 실행 주체는 그대로')
    assert.equal(renamed.actions.length, 1, '주지 않은 액션은 그대로')

    await query(`UPDATE automation SET enabled = false, disabled_reason = 'creator_left' WHERE id = $1`, [made.id])
    const off = unwrap(await updateDbAutomation(fx.owner.ctx, tb.ds, made.id, { enabled: false }))
    assert.deepEqual([off.enabled, off.disabledReason], [false, null], '사람이 끄면 까닭이 없다')
    await query(`UPDATE automation SET disabled_reason = 'failures' WHERE id = $1`, [made.id])
    const on = unwrap(await updateDbAutomation(fx.owner.ctx, tb.ds, made.id, { enabled: true }))
    assert.deepEqual([on.enabled, on.disabledReason], [true, null], '켜면 꺼진 까닭이 지워진다')

    assert.deepEqual(await updateDbAutomation(fx.owner.ctx, tb.ds, made.id, { enabled: '네' }), { ok: false, reason: 'invalid_body' })
    const other = await table('남의 표')
    assert.deepEqual(await deleteDbAutomation(fx.owner.ctx, other.ds, made.id), { ok: false, reason: 'not_found' }, '다른 표의 id 로는 닿지 않는다')
    assert.deepEqual(await deleteDbAutomation(fx.owner.ctx, tb.ds, made.id), { ok: true, value: null })
    assert.deepEqual(unwrap(await listDbAutomations(fx.owner.ctx, tb.ds)), [])
  })
})

describe('④ 상한', () => {
  test('★ 표마다 50개', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('많은 표')
    await query(
      `INSERT INTO automation (id, workspace_id, kind, host_data_source_id, name, created_by)
       SELECT gen_random_uuid(), $1, 'db_automation', $2, 'a' || g, $3 FROM generate_series(1, $4::int) g`,
      [fx.workspaceId, tb.ds, fx.owner.userId, MAX_DB_AUTOMATIONS],
    )
    assert.deepEqual(await createDbAutomation(fx.owner.ctx, tb.ds, definition(tb)), { ok: false, reason: 'too_many' })
  })
})

describe('⑤ 위임 발급자', () => {
  test('★ 만든 사람으로 · 세션 자리에 automation id · 떠났거나 지워졌으면 creator_left · 남의 워크스페이스는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('위임 표')
    const made = unwrap(await createDbAutomation(admin.ctx, tb.ds, definition(tb)))
    const ws = asWorkspaceId(fx.workspaceId)
    const delegated = await resolveDelegatedContext(ws, made.id)
    assert.ok(delegated.ok)
    assert.deepEqual(
      [delegated.context.userId, delegated.context.authMethod, delegated.context.sessionId, delegated.context.delegation, delegated.context.mfaSatisfied],
      [admin.userId, 'automation', made.id, { automationId: made.id }, false],
    )
    const elsewhere = await makeFixture()
    assert.deepEqual(await resolveDelegatedContext(asWorkspaceId(elsewhere.workspaceId), made.id), { ok: false, reason: 'not_found' })
    assert.deepEqual(await resolveDelegatedContext(ws, randomUUID()), { ok: false, reason: 'not_found' })

    await query(`UPDATE workspace_member SET status = 'removed' WHERE user_id = $1 AND workspace_id = $2`, [admin.userId, fx.workspaceId])
    assert.deepEqual(await resolveDelegatedContext(ws, made.id), { ok: false, reason: 'creator_left' }, '워크스페이스를 떠났다')
    await query(`UPDATE workspace_member SET status = 'active' WHERE user_id = $1 AND workspace_id = $2`, [admin.userId, fx.workspaceId])
    await query(`UPDATE "user" SET deleted_at = now() WHERE id = $1`, [admin.userId])
    assert.deepEqual(await resolveDelegatedContext(ws, made.id), { ok: false, reason: 'creator_left' }, '계정이 지워졌다')
    await query(`UPDATE "user" SET deleted_at = NULL WHERE id = $1`, [admin.userId])
  })

  test('★ 위임 컨텍스트의 권한은 그 사람의 지금 권한이다 — 접근을 거두면 위임도 못 쓴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('지금 권한 표')
    const made = unwrap(await createDbAutomation(admin.ctx, tb.ds, definition(tb)))
    const write = async () => {
      const delegated = await resolveDelegatedContext(asWorkspaceId(fx.workspaceId), made.id)
      assert.ok(delegated.ok)
      return withTransaction((tx) => updateCellsIn(tx, delegated.context, tb.row, { cells: [{ propertyId: tb.qty, value: { type: 'number', number: 3 } }] }))
    }
    assert.equal((await write()).ok, true, '만든 사람이 고칠 수 있으면 위임도 고친다')
    assert.equal((await revokeAccess(fx.owner.ctx, tb.databaseId, { type: 'user', id: admin.userId })).ok, true)
    const after = await write()
    assert.deepEqual(after.ok ? null : after.reason, 'not_found', '거둔 뒤에는 위임도 그 표를 못 본다')
  })
})

describe('⑦ 화면 — 배지 · 실행 기록', () => {
  test('★ 배지는 전체 권한에만 — 켜진 수 · 꺼진 까닭이 있는 수', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('배지 표')
    assert.deepEqual(await dbAutomationBadge(fx.owner.ctx, tb.ds), { enabled: 0, attention: 0 })
    unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, definition(tb, '켜진 것')))
    const tired = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, definition(tb, '지친 것')))
    const off = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, definition(tb, '사람이 끈 것')))
    await query(`UPDATE automation SET enabled = false, disabled_reason = 'failures' WHERE id = $1`, [tired.id])
    unwrap(await updateDbAutomation(fx.owner.ctx, tb.ds, off.id, { enabled: false }))
    assert.deepEqual(await dbAutomationBadge(admin.ctx, tb.ds), { enabled: 1, attention: 1 })
    assert.equal(await dbAutomationBadge(editor.ctx, tb.ds), null, '고치기만 받았으면 ⚡ 가 서지 않는다')
    assert.equal(await dbAutomationBadge(outsider.ctx, tb.ds), null)
  })

  test('★ 실행 기록 — 새것부터 상한만큼 · 트리거된 행의 제목은 보는 사람의 권한으로(볼 수 없음 · 지워짐)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('기록 표')
    const auto = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, definition(tb)))
    const other = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, definition(tb, '다른 것')))
    // 관리하는 사람이 볼 수 없는 행 — 그 행만 상속을 끊고 그 사람을 뺀다
    const hidden = unwrap(await createRow(fx.owner.ctx, tb.ds)).id
    assert.equal((await stopInheriting(fx.owner.ctx, hidden)).ok, true)
    await revokeAccess(fx.owner.ctx, hidden, { type: 'user', id: admin.userId })
    const trashed = unwrap(await createRow(fx.owner.ctx, tb.ds)).id
    unwrap(await trashRow(fx.owner.ctx, trashed))
    const put = (automationId: string, page: string | null, minutesAgo: number, status = 'success') =>
      query(
        `INSERT INTO automation_run (id, automation_id, workspace_id, trigger_page_id, actor_id, origin, depth, status, steps, started_at, finished_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'automation', 1, $5, $6::jsonb, now() - make_interval(mins => $7), now() - make_interval(mins => $7))`,
        [automationId, fx.workspaceId, page, fx.owner.userId, status, JSON.stringify([{ index: 0, type: 'edit_property', status: 'done' }]), minutesAgo],
      )
    for (let i = 0; i < AUTOMATION_RUN_CAP; i += 1) await put(auto.id, tb.row, 100 + i) // 오래된 것
    await put(auto.id, hidden, 3, 'partial')
    await put(auto.id, trashed, 2)
    await put(auto.id, null, 1, 'failed') // 행이 물리 삭제됐다(SET NULL)
    await put(other.id, tb.row, 0)

    // 웹훅 단계의 배달 — 이 automation 의 가장 새 실행 하나 · 다른 automation 의 실행 하나
    const deliver = async (automationId: string, status: string, lastStatus: number | null) => {
      const [run] = await query<{ id: string }>(`SELECT id FROM automation_run WHERE automation_id = $1 ORDER BY started_at DESC LIMIT 1`, [automationId])
      const id = randomUUID()
      await query(
        `INSERT INTO automation_delivery (id, run_id, automation_id, workspace_id, url_sealed, url_hint, payload, status, last_status, finished_at)
         VALUES ($1, $2, $3, $4, '\\x01'::bytea, 'hooks.example.com', '{}'::jsonb, $5, $6, now())`,
        [id, run.id, automationId, fx.workspaceId, status, lastStatus],
      )
      return id
    }
    const mine = await deliver(auto.id, 'failed', 500)
    const theirs = await deliver(other.id, 'sent', 200)

    const seen = unwrap(await listDbAutomationRuns(admin.ctx, tb.ds, auto.id))
    assert.deepEqual(seen.deliveries, { [mine]: { status: 'failed', lastStatus: 500 } }, '그 실행들의 배달만 — 상태와 마지막 HTTP 상태')
    assert.equal(theirs in seen.deliveries, false)
    assert.equal(seen.runs.length, AUTOMATION_RUN_CAP, '보관 상한만큼')
    assert.deepEqual(
      seen.runs.slice(0, 3).map((r) => [r.status, r.triggerPageId]),
      [['failed', null], ['success', trashed], ['partial', hidden]],
      '새것부터 · 다른 automation 의 기록은 없다',
    )
    assert.deepEqual(seen.runs[0].steps, [{ index: 0, type: 'edit_property', status: 'done' }])
    assert.equal(seen.titles[tb.row], '', '볼 수 있는 행 — 제목(빈 글이면 화면이 "제목 없음")')
    assert.equal(seen.titles[hidden], null, '★ 볼 수 없는 행의 제목은 주지 않는다')
    assert.equal(trashed in seen.titles, false, '지워진 행은 키가 없다')
    const ownerSees = unwrap(await listDbAutomationRuns(fx.owner.ctx, tb.ds, auto.id))
    assert.equal(ownerSees.titles[hidden], '', '그 행을 볼 수 있는 사람에게는 준다')

    assert.deepEqual(await listDbAutomationRuns(editor.ctx, tb.ds, auto.id), { ok: false, reason: 'forbidden' }, '문은 정의와 같다')
    assert.deepEqual(await listDbAutomationRuns(outsider.ctx, tb.ds, auto.id), { ok: false, reason: 'not_found' })
    const elsewhere = await table('다른 기록 표')
    assert.deepEqual(await listDbAutomationRuns(fx.owner.ctx, elsewhere.ds, auto.id), { ok: false, reason: 'not_found' }, '다른 표의 automation')
    assert.deepEqual(await listDbAutomationRuns(fx.owner.ctx, tb.ds, 'nope'), { ok: false, reason: 'not_found' })
  })
})
