/**
 * DB automation — 받기 · 실행 (자동화 5b-2 · F-08-09 · F-08-10, DB 필요)
 *
 * 이 파일이 지키는 것(정본 §3.10 [보강] DB automation — 받기 · 실행 ⓐ ~ ⓕ).
 *
 *   ① 셀을 바꾸면 창(3초)이 끝난 뒤 실행된다 — 조건에 맞으면 · 만든 사람으로(origin automation · depth 1)
 *   ② 순변화 — 창 안에서 되돌리면 · 조건에 맞지 않으면 실행하지 않는다 · 빈 값과 셀 없음은 같다
 *   ③ 자동화가 쓴 것은 다른 automation 을 깨우지 않는다 · 버튼이 쓴 것은 깨운다
 *   ④ 행 추가 — page_added · 템플릿 행은 받지 않는다
 *   ⑤ 끈다 — 만든 사람이 떠나면(creator_left) · 트리거의 속성이 지워지면(trigger_broken) · 잠긴 데이터베이스는 실행하지 않는다
 *   ⑥ 실패가 세 번 이어지면 끈다(failures)
 *
 * 반사실(HANDOFF §3.3): 순변화를 보지 않으면 ②, origin 을 보지 않으면 ③, 위임 거절에 끄지 않으면 ⑤, 실패 셈을 빼면 ⑥ 이 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty, deleteProperty } from '../database/property.ts'
import { createRow, updateCells } from '../database/row.ts'
import { createTemplate } from '../database/template.ts'
import { setDatabaseLock } from '../permissions/lock.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDbAutomation } from './db-automation.ts'
import { pressButton, setButtonActions } from './button-property.ts'
import { runAutomationDispatch } from './dispatch.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let mate: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  mate = await joinAs(fx.workspaceId, await createUser('함께 만드는 사람'), 'member')
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

type Table = { databaseId: string; ds: string; qty: string; done: string; note: string; button: string; row: string }

/** 표 하나 — 수량(숫자) · 완료(체크) · 메모(글) · 버튼 · 행 하나. 워크스페이스 모두가 전체 권한(최상위 표). */
async function table(name: string): Promise<Table> {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = db.dataSourceId
  const idOf = (props: readonly { id: string; name: string }[], n: string) => props.find((p) => p.name === n)!.id
  const qty = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '수량', type: 'number' })).properties, '수량')
  const done = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '완료', type: 'checkbox' })).properties, '완료')
  const note = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '메모', type: 'rich_text' })).properties, '메모')
  const button = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '버튼', type: 'button' })).properties, '버튼')
  const row = unwrap(await createRow(fx.owner.ctx, ds)).id
  return { databaseId: db.id, ds, qty, done, note, button, row }
}

const num = (propertyId: string, n: number | null) => ({ propertyId, value: { type: 'number' as const, number: n } })
const check = (propertyId: string) => ({ propertyId, value: { type: 'checkbox' as const, checkbox: true } })
const editAction = (cells: unknown[]) => ({ type: 'edit_property', config: { v: 1, cells } })
const onEdited = (propertyId: string, condition: unknown = null) => ({ type: 'property_edited', propertyId, condition })
const setCells = async (who: Actor, row: string, cells: ReturnType<typeof num>[]) => unwrap(await updateCells(who.ctx, row, { cells }))
/** 창이 끝난 뒤의 판 — 이 워크스페이스의 묶음만. */
const dispatch = (afterSeconds = 10) =>
  runAutomationDispatch(new Date(Date.now() + afterSeconds * 1000), { workspaces: [fx.workspaceId] })
const cellOf = async (row: string, property: string) =>
  (await query<{ value: Record<string, unknown> }>(`SELECT value FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [row, property]))[0]?.value ?? null
const runsOf = (automationId: string) =>
  query<{ status: string; origin: string; depth: number; actor_id: string }>(
    `SELECT status, origin, depth, actor_id FROM automation_run WHERE automation_id = $1 ORDER BY started_at, id`,
    [automationId],
  )
const automationOf = async (id: string) =>
  (await query<{ enabled: boolean; disabled_reason: string | null }>(`SELECT enabled, disabled_reason FROM automation WHERE id = $1`, [id]))[0]

describe('① 셀을 바꾸면', () => {
  test('★ 창이 끝난 뒤 실행된다 — 조건에 맞으면 · 만든 사람으로(origin automation · depth 1)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('실행 표')
    const auto = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, {
      name: '많으면 완료',
      triggers: [onEdited(tb.qty, { property_id: tb.qty, operator: 'greater_than', value: 5 })],
      actions: [editAction([check(tb.done)])],
    }))
    await setCells(fx.owner, tb.row, [num(tb.qty, 7)])
    await runAutomationDispatch(new Date(), { workspaces: [fx.workspaceId] })
    assert.equal(await cellOf(tb.row, tb.done), null, '창이 끝나기 전에는 실행하지 않는다')
    await dispatch()
    assert.deepEqual(await cellOf(tb.row, tb.done), { type: 'checkbox', checkbox: true })
    assert.deepEqual(await runsOf(auto.id), [{ status: 'success', origin: 'automation', depth: 1, actor_id: fx.owner.userId }])
    const [left] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM automation_event WHERE automation_id = $1`, [auto.id])
    assert.equal(left.n, 0, '끝난 묶음은 지운다')
  })
})

describe('② 순변화', () => {
  test('★ 창 안에서 되돌리면 · 조건에 맞지 않으면 실행하지 않는다 — 빈 값과 셀 없음은 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('순변화 표')
    const auto = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, {
      name: '많으면 완료',
      triggers: [onEdited(tb.qty, { property_id: tb.qty, operator: 'greater_than', value: 5 })],
      actions: [editAction([check(tb.done)])],
    }))
    // 조건 없이 바뀌기만 하면 — 순변화만 이것을 막는다(조건이 가려 주지 않는다)
    const any = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, {
      name: '바뀌면 메모',
      triggers: [onEdited(tb.qty)],
      actions: [editAction([{ propertyId: tb.note, value: { type: 'rich_text', rich_text: [textRun('바뀜')] } }])],
    }))
    await setCells(fx.owner, tb.row, [num(tb.qty, 7)])
    await setCells(fx.owner, tb.row, [num(tb.qty, null)]) // 창 안에서 되돌림 — 셀은 남았지만 비었다(셀 없음과 같다)
    await dispatch()
    assert.equal(await cellOf(tb.row, tb.done), null, '되돌렸으면 실행하지 않는다')
    assert.equal(await cellOf(tb.row, tb.note), null, '되돌렸으면 조건이 없어도 실행하지 않는다')
    await setCells(fx.owner, tb.row, [num(tb.qty, 3)])
    await dispatch()
    assert.equal(await cellOf(tb.row, tb.done), null, '조건(> 5)에 맞지 않는다')
    assert.deepEqual(await runsOf(auto.id), [])
    assert.equal((await runsOf(any.id)).length, 1, '되돌리지 않은 변화는 조건 없는 쪽이 받는다')
  })
})

describe('③ 깨우기', () => {
  test('★ 자동화가 쓴 것은 다른 automation 을 깨우지 않는다 · 버튼이 쓴 것은 깨운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('연쇄 표')
    const first = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, {
      name: '수량이 바뀌면 완료',
      triggers: [onEdited(tb.qty)],
      actions: [editAction([check(tb.done)])],
    }))
    const second = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, {
      name: '완료되면 메모',
      triggers: [onEdited(tb.done)],
      actions: [editAction([{ propertyId: tb.note, value: { type: 'rich_text', rich_text: [textRun('끝')] } }])],
    }))
    await setCells(fx.owner, tb.row, [num(tb.qty, 1)])
    await dispatch()
    assert.deepEqual(await cellOf(tb.row, tb.done), { type: 'checkbox', checkbox: true }, '첫째가 돌았다')
    await dispatch()
    assert.equal(await cellOf(tb.row, tb.note), null, '첫째가 쓴 완료는 둘째를 깨우지 않는다')
    assert.equal((await runsOf(first.id)).length, 1)
    assert.equal((await runsOf(second.id)).length, 0)

    // 버튼이 쓴 것은 깨운다
    const other = unwrap(await createRow(fx.owner.ctx, tb.ds)).id
    unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [editAction([check(tb.done)])]))
    unwrap(await pressButton(fx.owner.ctx, other, tb.button, randomUUID()))
    await dispatch()
    assert.equal((await cellOf(other, tb.note))?.type, 'rich_text', '버튼이 체크한 완료가 둘째를 깨웠다')
  })
})

describe('④ 행 추가', () => {
  test('★ 행이 생기면 page_added — 템플릿 행은 받지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('행 추가 표')
    const auto = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, {
      name: '새 행은 수량 1',
      triggers: [{ type: 'page_added' }],
      actions: [editAction([num(tb.qty, 1)])],
    }))
    const watcher = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, {
      name: '수량을 보면 완료',
      triggers: [onEdited(tb.qty)],
      actions: [editAction([check(tb.done)])],
    }))
    const row = unwrap(await createRow(fx.owner.ctx, tb.ds)).id
    const template = unwrap(await createTemplate(fx.owner.ctx, tb.ds, { title: '틀' })).id
    await setCells(fx.owner, template, [num(tb.qty, 9)]) // 템플릿의 셀을 고쳐도 받지 않는다
    // 받는 자리에서 막는다 — 실행 쪽 다시 보기(템플릿이면 버린다)는 그 뒤의 겹이다
    const [queued] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM automation_event WHERE page_id = $1`, [template])
    assert.equal(queued.n, 0, '템플릿 행의 묶음은 쌓이지 않는다')
    // 그래도 쌓였다면 실행 쪽이 다시 보고 버린다
    await query(
      `INSERT INTO automation_event (id, automation_id, page_id, before, window_end, status)
       VALUES (gen_random_uuid(), $1, $2, $3::jsonb, now(), 'collecting')`,
      [watcher.id, template, JSON.stringify({ [tb.qty]: null })],
    )
    await dispatch()
    assert.deepEqual(await cellOf(row, tb.qty), { type: 'number', number: 1 })
    assert.equal(await cellOf(template, tb.done), null, '템플릿 행은 받지 않는다')
    assert.equal((await runsOf(auto.id)).length, 1, '행 추가는 새 행 하나만')
    assert.equal((await runsOf(watcher.id)).length, 0, '템플릿 셀 편집 · 자동화가 쓴 수량은 깨우지 않는다')
  })
})

describe('⑤ 끈다 · 잠금', () => {
  test('★ 만든 사람이 떠나면 creator_left · 트리거의 속성이 지워지면 trigger_broken · 잠긴 데이터베이스는 실행하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('끄기 표')
    const left = unwrap(await createDbAutomation(mate.ctx, tb.ds, { name: '떠날 사람의 것', triggers: [onEdited(tb.qty)], actions: [editAction([check(tb.done)])] }))
    await query(`UPDATE workspace_member SET status = 'removed' WHERE user_id = $1 AND workspace_id = $2`, [mate.userId, fx.workspaceId])
    try {
      await setCells(fx.owner, tb.row, [num(tb.qty, 2)])
      await dispatch()
    } finally {
      await query(`UPDATE workspace_member SET status = 'active' WHERE user_id = $1 AND workspace_id = $2`, [mate.userId, fx.workspaceId])
    }
    assert.deepEqual(await automationOf(left.id), { enabled: false, disabled_reason: 'creator_left' })
    assert.equal(await cellOf(tb.row, tb.done), null)

    const tb2 = await table('속성 지우기 표')
    const watched = unwrap(await addProperty(fx.owner.ctx, tb2.ds, { name: '지울 칸', type: 'number' })).properties.find((p) => p.name === '지울 칸')!.id
    const broken = unwrap(await createDbAutomation(fx.owner.ctx, tb2.ds, { name: '깨질 것', triggers: [onEdited(watched)], actions: [editAction([check(tb2.done)])] }))
    await setCells(fx.owner, tb2.row, [num(watched, 1)])
    unwrap(await deleteProperty(fx.owner.ctx, tb2.ds, watched))
    await dispatch()
    assert.deepEqual(await automationOf(broken.id), { enabled: false, disabled_reason: 'trigger_broken' })

    const tb3 = await table('잠긴 표')
    const quiet = unwrap(await createDbAutomation(fx.owner.ctx, tb3.ds, { name: '잠기면 쉰다', triggers: [onEdited(tb3.qty)], actions: [editAction([check(tb3.done)])] }))
    unwrap(await setDatabaseLock(fx.owner.ctx, tb3.databaseId, true))
    await setCells(fx.owner, tb3.row, [num(tb3.qty, 2)]) // 데이터베이스 잠금은 셀을 막지 않는다
    await dispatch()
    assert.equal(await cellOf(tb3.row, tb3.done), null, '잠긴 데이터베이스는 실행하지 않는다')
    assert.deepEqual(await automationOf(quiet.id), { enabled: true, disabled_reason: null }, '끄지는 않는다')
  })
})

describe('⑥ 실패가 이어지면', () => {
  test('★ 최근 실행 셋이 모두 실패면 끈다(failures) — 그 전에는 켜져 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('실패 표')
    const doomed = unwrap(await addProperty(fx.owner.ctx, tb.ds, { name: '사라질 칸', type: 'checkbox' })).properties.find((p) => p.name === '사라질 칸')!.id
    const auto = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, { name: '늘 실패', triggers: [onEdited(tb.qty)], actions: [editAction([check(doomed)])] }))
    unwrap(await deleteProperty(fx.owner.ctx, tb.ds, doomed)) // 액션의 속성이 사라졌다 — 실행은 실패(트리거는 멀쩡하다)
    for (const [i, n] of [1, 2, 3].entries()) {
      await setCells(fx.owner, tb.row, [num(tb.qty, n)])
      await dispatch()
      assert.equal((await automationOf(auto.id))?.enabled, i < 2, `${i + 1}번째 실패 뒤`)
    }
    assert.deepEqual((await runsOf(auto.id)).map((r) => r.status), ['failed', 'failed', 'failed'])
    assert.deepEqual(await automationOf(auto.id), { enabled: false, disabled_reason: 'failures' })
  })
})

describe('⑦ 임대', () => {
  test('★ 임대가 지난 묶음은 다시 잡는다 — 같은 묶음은 두 번 실행하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('임대 표')
    const auto = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, { name: '바뀌면 완료', triggers: [onEdited(tb.qty)], actions: [editAction([check(tb.done)])] }))
    await setCells(fx.owner, tb.row, [num(tb.qty, 1)])
    // 워커가 잡고 죽었다 — 임대가 지났다
    const [event] = await query<{ id: string; before: unknown }>(
      `UPDATE automation_event SET status = 'dispatching', locked_until = now() - interval '1 second'
        WHERE automation_id = $1 RETURNING id, before`,
      [auto.id],
    )
    await dispatch(0)
    assert.equal((await runsOf(auto.id)).length, 1, '지난 임대는 다시 잡아 실행한다')
    // 실행하고 지우기 전에 죽었다 — 같은 묶음이 다시 잡혀도 실행 기록은 하나다(멱등 키 event:{묶음})
    await query(
      `INSERT INTO automation_event (id, automation_id, page_id, before, window_end, status, locked_until)
       VALUES ($1, $2, $3, $4::jsonb, now(), 'dispatching', now() - interval '1 second')`,
      [event.id, auto.id, tb.row, JSON.stringify({ [tb.qty]: null })],
    )
    await dispatch(0)
    assert.equal((await runsOf(auto.id)).length, 1, '같은 묶음은 두 번 실행하지 않는다')
    const [left] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM automation_event WHERE automation_id = $1`, [auto.id])
    assert.equal(left.n, 0)
  })
})
