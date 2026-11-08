/**
 * 워크스페이스 삭제 — AD-1 (F-14-13 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 AD-1] ① ~ ⑥ · 마이그레이션 0129
 *
 *   ① ★ 명령 — owner 만(멤버는 forbidden) · 이름이 그대로여야(name_mismatch) · 표시만(행은 남는다) · 감사 · 두 번째는 not_found
 *   ② ★ 문 — 지운 뒤 두 발급자(`resolveSessionContext` · `resolveDelegatedContext`)와 밖의 사람의 신원이 멤버에게도 내주지 않는다
 *   ③ ★ 문 밖의 길 — 공개 게시 · 사이트 주소 · 폼 · 초대 · 목록 · 리마인더 · 자동화 묶음
 *   ④ ★ 되살리기 — 운영자 명령이 표시를 지우면 모든 문이 다시 열린다 · 지운 상태가 아니면 not_deleted
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { resolveOutsiderContext } from '../auth/outsider-context.ts'
import { resolveDelegatedContext, resolveSessionContext } from '../auth/session-context.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { createDbAutomation } from '../automation/db-automation.ts'
import { runAutomationDispatch } from '../automation/dispatch.ts'
import { createDatabase } from '../database/database.ts'
import { createFormView, setFormQuestions, updateFormSettings } from '../database/form.ts'
import { readPublicForm } from '../database/form-submit.ts'
import { setDateReminder } from '../database/reminder.ts'
import { addProperty, getSchema } from '../database/property.ts'
import { createRow, updateCells } from '../database/row.ts'
import { query, queryOne } from '../db/pool.ts'
import { asWorkspaceId } from '../ids.ts'
import { runReminderFire } from '../notification/reminder-fire.ts'
import { readPublicPage, readSitePage } from '../publish/public-read.ts'
import { publishPage, updatePublicLink } from '../publish/public-link.ts'
import { setSiteDomain } from '../publish/site.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, visitAsOutsider } from '../testing/db-fixtures.ts'
import { canDeleteWorkspace, deleteWorkspace, restoreWorkspace } from './delete.ts'
import { acceptInvite, createEmailInvite, previewInvite } from './invite.ts'
import { listWorkspacesForUser, nextWorkspaceHref, switcherOf } from './list.ts'

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
    const { closeValkey } = await import('../valkey.ts')
    await closeValkey()
  }
})

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

let seq = 0
const uniqueName = (base: string): string => `${base}-${Date.now().toString(36)}-${(seq += 1)}`

async function team(name: string) {
  const ws = await createBareWorkspace(name)
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  return { ws, boss, mate }
}

const deletedAt = async (ws: string) => (await queryOne<{ d: Date | null }>(`SELECT deleted_at AS d FROM workspace WHERE id = $1`, [ws])).d

describe('① 명령', () => {
  test('★ owner 만 · 이름 그대로 · 표시만 남기고 행은 그대로 · 감사 · 두 번째는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('지울 워크스페이스')
    const page = await createPage(boss.ctx, { title: titleFromPlainText('남을 페이지') })

    assert.equal(canDeleteWorkspace(boss.ctx), true)
    assert.equal(canDeleteWorkspace(mate.ctx), false)
    assert.deepEqual(await deleteWorkspace(mate.ctx, { confirmName: '지울 워크스페이스' }), { ok: false, reason: 'forbidden' }, '멤버는 지우지 못한다')
    for (const bad of ['지울 워크스페이스 ', '지울 워크스페이스x', '', '다른 이름', 42, null]) {
      assert.deepEqual(await deleteWorkspace(boss.ctx, { confirmName: bad }), { ok: false, reason: 'name_mismatch' }, String(bad))
    }
    assert.equal(await deletedAt(ws), null, '거부된 명령은 아무것도 바꾸지 않는다')

    assert.deepEqual(await deleteWorkspace(boss.ctx, { confirmName: '지울 워크스페이스' }), { ok: true })
    const row = await queryOne<{ deleted_by: string | null }>(`SELECT deleted_by FROM workspace WHERE id = $1`, [ws])
    assert.ok((await deletedAt(ws)) !== null)
    assert.equal(row.deleted_by, boss.userId, '누가 지웠는지')
    const blocks = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM block WHERE id = $1`, [page.id])
    assert.equal(blocks.n, 1, '행은 지우지 않는다')
    const audit = await query<{ actor_user_id: string; target_id: string }>(
      `SELECT actor_user_id, target_id FROM audit_event WHERE workspace_id = $1 AND event_type = 'workspace.deleted'`,
      [ws],
    )
    assert.deepEqual(audit, [{ actor_user_id: boss.userId, target_id: ws }])
    assert.deepEqual(await deleteWorkspace(boss.ctx, { confirmName: '지울 워크스페이스' }), { ok: false, reason: 'not_found' }, '두 번째')
  })
})

describe('② 문', () => {
  test('★ 지운 뒤 두 발급자가 멤버에게도 내주지 않는다 · 위임은 자동화를 끄지 않는다 · 되살리면 다시 열린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('문 닫기')
    const db = unwrap(await createDatabase(boss.ctx, { name: '표' }))
    const auto = unwrap(await createDbAutomation(boss.ctx, db.dataSourceId, { name: '자동화', triggers: [{ type: 'page_added' }], actions: [] }))
    assert.ok((await resolveSessionContext(mate.token, ws)).ok)
    assert.ok((await resolveDelegatedContext(ws, auto.id)).ok)

    assert.deepEqual(await deleteWorkspace(boss.ctx, { confirmName: '문 닫기' }), { ok: true })
    for (const who of [boss, mate]) {
      assert.deepEqual(await resolveSessionContext(who.token, ws), { ok: false, reason: 'workspace_deleted' })
    }
    assert.deepEqual(await resolveDelegatedContext(ws, auto.id), { ok: false, reason: 'workspace_deleted' })
    const a = await queryOne<{ enabled: boolean }>(`SELECT enabled FROM automation WHERE id = $1`, [auto.id])
    assert.equal(a.enabled, true, '자동화는 꺼지지 않았다 — 되살리면 그대로 돈다')
    assert.deepEqual(await resolveSessionContext(null, ws), { ok: false, reason: 'no_session' }, '로그인 전의 답은 그대로')

    unwrap(await restoreWorkspace(ws))
    assert.ok((await resolveSessionContext(mate.token, ws)).ok, '되살리면 다시 열린다')
    assert.ok((await resolveDelegatedContext(ws, auto.id)).ok)
  })

  test('★ 밖의 사람(접근 요청)도 지운 워크스페이스에는 신원이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await team('밖의 사람')
    const visitor = await visitAsOutsider(ws, await createUser('지나가는 사람'))
    assert.ok((await resolveOutsiderContext(visitor.token, ws)) !== null)
    await deleteWorkspace(boss.ctx, { confirmName: '밖의 사람' })
    assert.equal(await resolveOutsiderContext(visitor.token, ws), null)
  })
})

describe('③ 문 밖의 길', () => {
  test('★ 공개 게시 · 사이트 주소 — 지우면 닫히고 되살리면 열린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await team('공개 사이트')
    const page = await createPage(boss.ctx, { title: titleFromPlainText('소개'), privateTop: true })
    const token = unwrap(await publishPage(boss.ctx, page.id as never)).token!
    const domain = uniqueName('gone')
    unwrap(await setSiteDomain(boss.ctx, domain))
    unwrap(await updatePublicLink(boss.ctx, page.id as never, { slug: 'about' }))
    assert.ok((await readPublicPage(token)).ok)
    assert.ok((await readSitePage(domain, 'about')).ok)

    await deleteWorkspace(boss.ctx, { confirmName: '공개 사이트' })
    assert.deepEqual(await readPublicPage(token), { ok: false, reason: 'not_found' })
    assert.deepEqual(await readSitePage(domain, 'about'), { ok: false, reason: 'not_found' })

    unwrap(await restoreWorkspace(ws))
    assert.ok((await readPublicPage(token)).ok, '되살리면 같은 주소가 열린다')
    assert.ok((await readSitePage(domain, 'about')).ok)
  })

  test('★ 폼 공개 링크', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await team('공개 폼')
    const db = unwrap(await createDatabase(boss.ctx, { name: '신청', privateTop: true }))
    const schema = unwrap(await getSchema(boss.ctx, db.dataSourceId))
    const title = schema.properties.find((p) => p.type === 'title')!.id
    const form = unwrap(await createFormView(boss.ctx, db.id, { name: '신청서' }))
    unwrap(await setFormQuestions(boss.ctx, form.viewId, [{ propertyId: title, required: true, label: '이름' }]))
    const token = unwrap(await updateFormSettings(boss.ctx, form.viewId, { access: 'public' })).settings.token!
    assert.ok((await readPublicForm(token)) !== null)
    await deleteWorkspace(boss.ctx, { confirmName: '공개 폼' })
    assert.equal(await readPublicForm(token), null, '지우면 닫힌다')
    unwrap(await restoreWorkspace(ws))
    assert.ok((await readPublicForm(token)) !== null, '되살리면 열린다')
  })

  test('★ 초대 미리보기 · 수락 · 목록 · 다음 곳', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('목록')
    const keep = await createBareWorkspace('남는 곳')
    await joinAs(keep, { userId: mate.userId }, 'member')
    const invitee = await createUser('초대받은 사람')
    const invite = await createEmailInvite({ workspaceId: ws, inviterUserId: boss.userId, inviterRole: 'owner', email: invitee.email, role: 'member' })
    assert.ok(invite.ok)
    const inviteToken = invite.ok ? invite.token : ''
    assert.ok((await previewInvite(inviteToken)) !== null)
    assert.deepEqual((await listWorkspacesForUser(mate.userId)).map((w) => w.workspaceId).sort(), [ws, keep].sort())
    assert.equal((await switcherOf(mate.ctx)).workspaces.length, 2)

    await deleteWorkspace(boss.ctx, { confirmName: '목록' })
    assert.equal(await previewInvite(inviteToken), null, '지운 워크스페이스의 초대는 없는 초대와 같다')
    assert.deepEqual(await acceptInvite(inviteToken, invitee.userId), { ok: false, reason: 'invalid' })
    assert.deepEqual((await listWorkspacesForUser(mate.userId)).map((w) => w.workspaceId), [keep], '목록에서 빠진다')
    assert.equal(await nextWorkspaceHref(mate.userId), `/w/${keep}`, '다른 워크스페이스로')
    assert.equal(await nextWorkspaceHref(boss.userId), '/', '없으면 새로 만들기(루트)')
  })

  test('★ 리마인더 · 자동화 묶음 — 지운 워크스페이스의 일은 건너뛰고 되살리면 한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await team('일 건너뛰기')
    const db = unwrap(await createDatabase(boss.ctx, { name: '표' }))
    const due = unwrap(await addProperty(boss.ctx, db.dataSourceId, { name: '마감', type: 'date' })).properties.find((p) => p.name === '마감')!.id
    const row = unwrap(await createRow(boss.ctx, db.dataSourceId)).id
    unwrap(await updateCells(boss.ctx, row, { cells: [{ propertyId: due, value: { type: 'date', date: { start: '2030-05-01' } } }] }))
    unwrap(await setDateReminder(boss.ctx, row, due, { leadMinutes: 0, timeZone: 'UTC' }))
    const at = new Date('2030-05-01T09:01:00Z')

    await deleteWorkspace(boss.ctx, { confirmName: '일 건너뛰기' })
    const skipped = await runReminderFire(at, { workspaces: [ws] })
    assert.deepEqual([skipped.fired, skipped.suppressed], [0, 0], '지운 워크스페이스의 리마인더는 고르지 않는다')
    const pending = await queryOne<{ fired_at: Date | null }>(`SELECT fired_at FROM reminder WHERE page_id = $1`, [row])
    assert.equal(pending.fired_at, null)

    unwrap(await restoreWorkspace(ws))
    assert.equal((await runReminderFire(at, { workspaces: [ws] })).fired, 1, '되살리면 울린다')

    const auto = unwrap(await createDbAutomation(boss.ctx, db.dataSourceId, { name: '행 추가', triggers: [{ type: 'page_added' }], actions: [] }))
    await query(
      `INSERT INTO automation_event (id, automation_id, page_id, page_added, window_end, status) VALUES (gen_random_uuid(), $1, $2, true, now(), 'collecting')`,
      [auto.id, row],
    )
    await deleteWorkspace(boss.ctx, { confirmName: '일 건너뛰기' })
    const later = new Date(Date.now() + 10_000)
    const none = await runAutomationDispatch(later, { workspaces: [ws] })
    assert.deepEqual([none.ran, none.skipped, none.dropped], [0, 0, 0], '지운 워크스페이스의 묶음은 고르지 않는다')
    const left = await queryOne<{ status: string }>(`SELECT status FROM automation_event WHERE automation_id = $1`, [auto.id])
    assert.equal(left.status, 'collecting', '묶음은 그대로 남는다')
    unwrap(await restoreWorkspace(ws))
    await runAutomationDispatch(later, { workspaces: [ws] })
    const rest = await query(`SELECT 1 FROM automation_event WHERE automation_id = $1`, [auto.id])
    assert.equal(rest.length, 0, '되살리면 처리한다')
  })
})

describe('④ 되살리기', () => {
  test('★ 운영자 명령 — 표시를 지우고 감사를 쌓는다 · 지운 상태가 아니면 not_deleted · 없으면 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('되살릴 곳')
    assert.deepEqual(await restoreWorkspace(ws), { ok: false, reason: 'not_deleted' })
    await deleteWorkspace(boss.ctx, { confirmName: '되살릴 곳' })
    assert.deepEqual(await restoreWorkspace(ws), { ok: true, name: '되살릴 곳' })
    const row = await queryOne<{ deleted_at: Date | null; deleted_by: string | null }>(`SELECT deleted_at, deleted_by FROM workspace WHERE id = $1`, [ws])
    assert.deepEqual([row.deleted_at, row.deleted_by], [null, null])
    const audits = await query<{ event_type: string }>(
      `SELECT event_type FROM audit_event WHERE workspace_id = $1 AND event_type IN ('workspace.deleted', 'workspace.restored') ORDER BY occurred_at, id`,
      [ws],
    )
    assert.deepEqual(audits.map((a) => a.event_type), ['workspace.deleted', 'workspace.restored'])
    assert.ok((await resolveSessionContext(mate.token, ws)).ok)
    assert.deepEqual(await restoreWorkspace(asWorkspaceId('00000000-0000-4000-8000-000000000000')), { ok: false, reason: 'not_found' })
  })
})
