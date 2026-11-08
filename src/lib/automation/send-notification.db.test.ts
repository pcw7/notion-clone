/**
 * send_notification — 저장 검사 · 받는 사람 · 알림 (AN-1 · F-08-07, DB 필요)
 *
 * 이 파일이 지키는 것(정본 §3.10 [보강 AN-1] ① ② ③).
 *
 *   ① 저장 검사 — 멤버 20명까지 · 활동 멤버만(게스트 · 멤버 아님은 unknown_recipient) · 둘 다 비면 invalid_input · 사람 칸은 그 표의 살아 있는
 *      사람 속성 · 메시지 슬롯의 속성은 그 표의 셀 속성
 *   ② 받는 사람 — 고른 멤버 ∪ 그 행의 사람 칸 → 중복 없이 → 지금 활성 멤버이고 그 페이지를 볼 수 있는 사람만(볼 수 없으면 조용히 뺀다)
 *   ③ 알림 — 종류 automation · 그 페이지로 가는 줄 · 메시지(슬롯은 그때의 값으로) · 보낸 사람(버튼은 누른 사람 · DB 자동화는 만든 사람) ·
 *      실행마다 따로(묶지 않는다) · 인박스가 메시지를 보여 준다 · 실행 기록에는 알린 수만
 *
 * 반사실(HANDOFF §3.3): 볼 수 있는지 묻지 않으면 ② 의 "못 보는 사람", 활동 멤버를 다시 보지 않으면 "나간 사람", 사람 칸을 읽지 않으면
 * "사람 칸", 행위자를 세션이 아니라 다른 사람으로 두면 ③ 이 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty } from '../database/property.ts'
import { createRow, updateCells } from '../database/row.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { listInbox } from '../notification/inbox.ts'
import { pressButton, setButtonActions } from './button-property.ts'
import { createDbAutomation } from './db-automation.ts'
import { runAutomationDispatch } from './dispatch.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

let skipReason = ''
let fx: Fixture
const mates: Actor[] = []

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  for (let i = 0; i < 6; i += 1) mates.push(await joinAs(fx.workspaceId, await createUser(`동료 ${i}`), 'member'))
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

type Table = { ds: string; note: string; who: string; qty: string; button: string }

async function table(name: string): Promise<Table> {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = db.dataSourceId
  const idOf = (props: readonly { id: string; name: string }[], n: string) => props.find((p) => p.name === n)!.id
  const note = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '메모', type: 'rich_text' })).properties, '메모')
  const who = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '담당', type: 'people' })).properties, '담당')
  const qty = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '수량', type: 'number' })).properties, '수량')
  const button = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '알리기', type: 'button' })).properties, '알리기')
  return { ds, note, who, qty, button }
}

const textRunOf = (content: string) => ({
  type: 'text',
  plain_text: content,
  href: null,
  text: { content, link: null },
  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
})
const notify = (users: string[], people: string[], message = '') => ({
  type: 'send_notification',
  config: { v: 1, to: { users, people_property_ids: people }, message: message === '' ? [] : [textRunOf(message)] },
})
const people = (propertyId: string, ids: string[]) => ({ propertyId, value: { type: 'people', people: ids.map((id) => ({ id })) } })

type Note = { recipient_id: string; page_id: string; kind: string; group_key: string; actor_id: string | null; payload: Record<string, string>; read_at: Date | null }
const notificationsOn = (pageId: string) =>
  query<Note>(
    `SELECT n.recipient_id, n.page_id, n.kind, n.group_key, e.actor_id, e.payload, n.read_at
       FROM notification n JOIN activity_event e ON e.id = n.event_ids[1]
      WHERE n.page_id = $1 AND n.kind = 'automation' ORDER BY n.recipient_id`,
    [pageId],
  )
const sorted = (ids: readonly string[]) => [...ids].sort()

describe('① 저장 검사', () => {
  test('★ 멤버 20명 · 활동 멤버만 · 둘 다 비면 invalid_input · 사람 칸/슬롯의 속성', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('저장 검사 표')
    const save = (actions: unknown[]) => setButtonActions(fx.owner.ctx, tb.ds, tb.button, actions)
    const refused = (problem: string) => ({ ok: false, reason: 'invalid_action', problem, index: 0 })

    assert.equal((await save([notify([mates[0].userId], [tb.who], '끝: {{row:' + tb.note + '}}')])).ok, true)
    assert.deepEqual(await save([notify([], [])]), refused('invalid_input'))
    assert.deepEqual(await save([notify(Array.from({ length: 21 }, () => randomUUID()), [])]), refused('too_many_recipients'))
    // 멤버가 아닌 사람 · 게스트 · 나간 멤버
    const outsider = await createUser('남')
    assert.deepEqual(await save([notify([outsider.userId], [])]), refused('unknown_recipient'))
    const guest = await joinAs(fx.workspaceId, await createUser('게스트'), 'guest')
    assert.deepEqual(await save([notify([guest.userId], [])]), refused('unknown_recipient'))
    const gone = await joinAs(fx.workspaceId, await createUser('나간 사람'), 'member')
    await query(`UPDATE workspace_member SET status = 'removed' WHERE user_id = $1 AND workspace_id = $2`, [gone.userId, fx.workspaceId])
    assert.deepEqual(await save([notify([gone.userId], [])]), refused('unknown_recipient'))
    // 사람 칸이 아닌 속성 · 없는 속성 · 슬롯의 없는 속성
    assert.deepEqual(await save([notify([], [tb.qty])]), refused('unknown_property'))
    assert.deepEqual(await save([notify([], ['nope'])]), refused('unknown_property'))
    assert.deepEqual(await save([notify([mates[0].userId], [], '{{row:nope}}')]), refused('unknown_property'))
    assert.deepEqual(await save([notify([mates[0].userId], [], '{{row:' + tb.who + '}}')]), refused('unknown_property'), '사람 칸은 슬롯으로 못 쓴다')
  })
})

describe('② 받는 사람 · ③ 알림 — DB 자동화', () => {
  test('★ 행이 추가되면 고른 멤버와 사람 칸의 사람이 받는다 — 보는 사람만 · 나간 사람 제외 · 메시지는 그때의 값 · 만든 사람이 보낸 이', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('자동화 표')
    const [fixed, assigned, blind, gone, both] = mates
    const auto = unwrap(
      await createDbAutomation(fx.owner.ctx, tb.ds, {
        name: '새 행 알림',
        triggers: [{ type: 'page_added' }],
        actions: [notify([fixed.userId, blind.userId, gone.userId, both.userId], [tb.who], '새 행: {{row:' + tb.note + '}}')],
      }),
    )
    const row = unwrap(
      await createRow(fx.owner.ctx, tb.ds, {
        cells: [
          { propertyId: tb.note, value: { type: 'rich_text', rich_text: [textRunOf('견적서')] } },
          people(tb.who, [assigned.userId, both.userId, blind.userId, gone.userId]),
        ],
      }),
    ).id
    // 그 행만 가린다 — blind 는 못 본다
    assert.equal((await stopInheriting(fx.owner.ctx, row)).ok, true)
    for (const u of [fx.owner, fixed, assigned, both]) assert.equal((await grantAccess(fx.owner.ctx, row, { type: 'user', id: u.userId }, 'full_access')).ok, true)
    await revokeAccess(fx.owner.ctx, row, { type: 'workspace_everyone' })
    await query(`UPDATE workspace_member SET status = 'removed' WHERE user_id = $1 AND workspace_id = $2`, [gone.userId, fx.workspaceId])

    await runAutomationDispatch(new Date(Date.now() + 10_000), { workspaces: [fx.workspaceId] })
    const got = await notificationsOn(row)
    assert.deepEqual(sorted(got.map((n) => n.recipient_id)), sorted([fixed.userId, assigned.userId, both.userId]), '고른 멤버 ∪ 사람 칸 · 중복 없이 · 못 보는 사람과 나간 사람은 없다')
    for (const n of got) {
      assert.equal(n.payload.message, '새 행: 견적서')
      assert.equal(n.payload.via, 'automation')
      assert.equal(n.actor_id, fx.owner.userId, '만든 사람이 보낸 이')
      assert.equal(n.page_id, row)
    }
    assert.equal(new Set(got.map((n) => n.group_key)).size, 1, '한 실행의 알림은 같은 열쇠')
    const [run] = await query<{ steps: { type: string; status: string; notified?: number }[] }>(
      `SELECT steps FROM automation_run WHERE automation_id = $1 AND status = 'success'`,
      [auto.id],
    )
    assert.deepEqual(run.steps, [{ index: 0, type: 'send_notification', status: 'done', notified: 3 }], '기록에는 알린 수만')

    // 인박스가 메시지와 페이지를 보여 준다 — 못 보는 사람의 인박스에는 없다
    const inbox = await listInbox(fixed.ctx)
    const item = inbox.find((i) => i.pageId === row)
    assert.equal(item?.kind, 'automation')
    assert.deepEqual(item?.automation, { via: 'automation', message: '새 행: 견적서' })
    assert.equal(item?.actorId, fx.owner.userId)
    assert.equal((await listInbox(blind.ctx)).some((i) => i.pageId === row), false)
  })

  test('실행마다 따로 — 두 번째 행은 새 알림 · 열쇠도 다르다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('따로 표')
    unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, { name: '알림', triggers: [{ type: 'page_added' }], actions: [notify([mates[0].userId], [])] }))
    const a = unwrap(await createRow(fx.owner.ctx, tb.ds)).id
    const b = unwrap(await createRow(fx.owner.ctx, tb.ds)).id
    await runAutomationDispatch(new Date(Date.now() + 10_000), { workspaces: [fx.workspaceId] })
    const [na] = await notificationsOn(a)
    const [nb] = await notificationsOn(b)
    assert.ok(na && nb)
    assert.notEqual(na.group_key, nb.group_key)
    assert.equal(na.payload.message, '', '메시지가 비면 빈 글자(인박스가 "알림" 만 말한다)')
  })
})

describe('③ 알림 — 버튼', () => {
  test('★ 버튼을 누르면 고른 멤버가 받는다 — 누른 사람이 보낸 이 · 사람 칸도 · 같은 키로 다시 눌러도 한 번', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('버튼 표')
    const [chosen, assignee, presser] = mates
    unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [notify([chosen.userId, presser.userId], [tb.who], '눌렀어요')]))
    const row = unwrap(await createRow(fx.owner.ctx, tb.ds, { cells: [people(tb.who, [assignee.userId])] })).id
    const key = randomUUID()
    const run = unwrap(await pressButton(presser.ctx, row, tb.button, key))
    assert.equal(run.status, 'success')
    assert.deepEqual(run.steps, [{ index: 0, type: 'send_notification', status: 'done', notified: 3 }])
    const got = await notificationsOn(row)
    assert.deepEqual(sorted(got.map((n) => n.recipient_id)), sorted([chosen.userId, assignee.userId, presser.userId]), '누른 사람 자신도 골랐으면 받는다')
    for (const n of got) {
      assert.equal(n.actor_id, presser.userId, '누른 사람이 보낸 이')
      assert.equal(n.payload.via, 'button')
      assert.equal(n.payload.message, '눌렀어요')
    }
    unwrap(await pressButton(presser.ctx, row, tb.button, key))
    assert.equal((await notificationsOn(row)).length, 3, '같은 키로 다시 눌러도 늘지 않는다')
    // 다른 키로 누르면 새 실행 — 새 알림
    unwrap(await pressButton(presser.ctx, row, tb.button, randomUUID()))
    assert.equal((await notificationsOn(row)).length, 6)
  })

  test('아무도 볼 수 없으면 알린 수 0 — 실패가 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('빈 표')
    const row = unwrap(await createRow(fx.owner.ctx, tb.ds)).id
    unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [notify([mates[5].userId], [])]))
    assert.equal((await stopInheriting(fx.owner.ctx, row)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, row, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    await revokeAccess(fx.owner.ctx, row, { type: 'workspace_everyone' })
    const run = unwrap(await pressButton(fx.owner.ctx, row, tb.button, randomUUID()))
    assert.equal(run.status, 'success')
    assert.deepEqual(run.steps, [{ index: 0, type: 'send_notification', status: 'done', notified: 0 }])
    assert.deepEqual(await notificationsOn(row), [])
  })

  test('사람 칸의 값은 그때의 값 — 칸이 바뀌면 바뀐 사람이 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('칸 바뀜 표')
    unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [notify([], [tb.who])]))
    const row = unwrap(await createRow(fx.owner.ctx, tb.ds, { cells: [people(tb.who, [mates[0].userId])] })).id
    unwrap(await updateCells(fx.owner.ctx, row, { cells: [people(tb.who, [mates[1].userId])] }))
    unwrap(await pressButton(fx.owner.ctx, row, tb.button, randomUUID()))
    assert.deepEqual((await notificationsOn(row)).map((n) => n.recipient_id), [mates[1].userId])
  })
})
