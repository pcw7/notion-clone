/**
 * 감사 로그 — 게시 · 공유 6d-1조각 (F-11-12 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.8 끝 [보강] 감사 로그).
 *
 *   ① 11종이 그 명령에서 쌓인다 — 로그인(계정 범위 · IP) · 계정 보안 · 초대 · 합류 · 게스트 빼기 · 승격 · 설정(앞뒤 값 · 바뀌었을 때만 ·
 *      워크스페이스 설정만) · 내보내기 · 권한(주기 · 회수 · 끊기 · 잇기) · 게시(켜고 끄고 설정 — 바뀌었을 때만) · 영구 삭제
 *   ② ★ 거부된 명령은 기록되지 않는다
 *   ③ ★ 쌓기만 한다 — 고치기 · 최근 행 지우기를 DB 가 거부한다 · 365일이 지난 행은 지울 수 있다
 *   ④ 내용을 싣지 않는다(제목 · 토큰) · 행위자가 이름을 바꿔도 그때의 이름이 남는다
 *   ⑤ 읽기 — owner 만 · 최근 것부터 · 종류로 거르기 · 앞으로 넘기기 · 계정 범위는 워크스페이스 목록에 없다
 *   ⑥ 데이터 수명 — 365일이 지난 것만 지운다 · 잡의 시각이 앞서 있어도 깨지지 않는다
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { establishLogin } from '../auth/establish-login.ts'
import { setPassword } from '../auth/password.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { purgePage, trashPage } from '../block/trash.ts'
import { query, queryOne } from '../db/pool.ts'
import { recordExport } from '../export/download.ts'
import type { BlockId } from '../ids.ts'
import { runDataRetention } from '../notification/retention.ts'
import { grantAccess, resumeInheriting, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { publishPage, unpublishPage, updatePublicLink } from '../publish/public-link.ts'
import { updateSetting } from '../settings/settings.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { inviteGuestToPage, promoteGuest, removeGuest } from '../workspace/guest.ts'
import { acceptInvite, createEmailInvite } from '../workspace/invite.ts'
import { listWorkspaceAudit, recordAuditIn } from './audit.ts'

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
const unique = (name: string): string => `${name} ${(seq += 1)} ${Date.now()}`

async function office() {
  const ws = await createBareWorkspace('감사')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const person = async (name: string, role: Parameters<typeof joinAs>[2] = 'member') => joinAs(ws, await createUser(name), role)
  return { ws, boss, person }
}

const topOf = async (by: Actor, title = unique('문서')): Promise<BlockId> =>
  (await createPage(by.ctx, { privateTop: true, title: titleFromPlainText(title) })).id

type Row = { event_type: string; actor_user_id: string | null; actor_name: string | null; target_type: string | null; target_id: string | null; metadata: Record<string, unknown>; setting_key: string | null; value_before: unknown; value_after: unknown; scope: string; ip: string | null }

const eventsIn = (ws: string, type?: string): Promise<Row[]> =>
  query<Row>(
    `SELECT event_type, actor_user_id, actor_name, target_type, target_id, metadata, setting_key, value_before, value_after, scope, host(ip) AS ip
       FROM audit_event WHERE workspace_id = $1 AND ($2::text IS NULL OR event_type = $2) ORDER BY occurred_at, id`,
    [ws, type ?? null],
  )

// ── ① 11종 ────────────────────────────────────────────────────────────

describe('① 11종이 그 명령에서 쌓인다', () => {
  test('로그인 — 계정 범위 · 그 세션의 IP · 새 계정인가', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const email = `${unique('login').replace(/\s+/g, '-')}@example.com`
    const login = await establishLogin({ email, existingUserId: null, authMethod: 'login_code', ip: '203.0.113.9', userAgent: 'node:test' })
    const row = await queryOne<Row>(
      `SELECT event_type, scope, actor_user_id, actor_name, metadata, host(ip) AS ip, target_type, target_id, setting_key, value_before, value_after
         FROM audit_event WHERE actor_user_id = $1 AND event_type = 'account.login'`,
      [login.userId],
    )
    assert.equal(row.scope, 'account')
    assert.equal(row.ip, '203.0.113.9')
    assert.deepEqual(row.metadata, { authMethod: 'login_code', newAccount: true })
  })

  test('계정 보안 — 비밀번호를 정하면 account.security_changed', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    assert.ok((await setPassword(boss.ctx, { newPassword: 'correct horse battery staple 9' })).ok)
    const row = await queryOne<{ metadata: Record<string, unknown>; scope: string }>(
      `SELECT metadata, scope FROM audit_event WHERE actor_user_id = $1 AND event_type = 'account.security_changed'`,
      [boss.userId],
    )
    assert.deepEqual(row, { metadata: { change: 'password_set' }, scope: 'account' })
  })

  test('초대 · 합류 — 받는 주소 · 다시 보낸 초대 · 들어온 사람이 행위자', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const newcomer = await createUser('새 사람')
    const email = (await queryOne<{ email: string }>(`SELECT email FROM user_email WHERE user_id = $1`, [newcomer.userId])).email
    const first = await createEmailInvite({ workspaceId: ws, inviterUserId: boss.userId, inviterRole: 'owner', email, role: 'member' })
    const again = await createEmailInvite({ workspaceId: ws, inviterUserId: boss.userId, inviterRole: 'owner', email, role: 'member' })
    assert.ok(first.ok && again.ok)
    const invited = await eventsIn(ws, 'workspace.member_invited')
    assert.deepEqual(invited.map((r) => [r.actor_user_id, r.metadata.email, r.metadata.renewed]), [[boss.userId, email, false], [boss.userId, email, true]])

    assert.ok((await acceptInvite(again.token, newcomer.userId)).ok)
    const joined = await eventsIn(ws, 'workspace.member_joined')
    assert.deepEqual(joined.map((r) => [r.actor_user_id, r.target_id, r.metadata.role]), [[newcomer.userId, newcomer.userId, 'member']])
  })

  test('게스트 — 들이기(합류 + 권한) · 승격 · 빼기', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const doc = await topOf(boss)
    const outsider = await createUser('손님')
    const email = (await queryOne<{ email: string }>(`SELECT email FROM user_email WHERE user_id = $1`, [outsider.userId])).email
    const invited = await inviteGuestToPage(boss.ctx, doc, email, 'view')
    assert.ok(invited.ok, JSON.stringify(invited))
    assert.equal((await eventsIn(ws, 'workspace.member_joined')).length, 1)
    assert.equal((await eventsIn(ws, 'page.permission_changed')).length, 1)

    assert.ok((await promoteGuest(boss.ctx, outsider.userId)).ok)
    const promoted = await eventsIn(ws, 'workspace.member_role_changed')
    assert.deepEqual(promoted.map((r) => r.metadata), [{ from: 'guest', to: 'member' }])

    const other = await createUser('다른 손님')
    const otherEmail = (await queryOne<{ email: string }>(`SELECT email FROM user_email WHERE user_id = $1`, [other.userId])).email
    assert.ok((await inviteGuestToPage(boss.ctx, doc, otherEmail, 'view')).ok)
    assert.ok((await removeGuest(boss.ctx, other.userId)).ok)
    const removed = await eventsIn(ws, 'workspace.member_removed')
    assert.deepEqual(removed.map((r) => [r.target_id, r.metadata.role]), [[other.userId, 'guest']])
  })

  test('설정 — 앞뒤 값 · 같은 값이면 쌓지 않는다 · 내 계정의 설정은 쌓지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    assert.ok((await updateSetting(boss.ctx, 'workspace.allow_publish_sites_and_forms', false)).ok)
    assert.ok((await updateSetting(boss.ctx, 'workspace.allow_publish_sites_and_forms', false)).ok)
    assert.ok((await updateSetting(boss.ctx, 'account.name', '새 이름')).ok)
    const rows = await eventsIn(ws, 'workspace.setting_changed')
    assert.deepEqual(rows.map((r) => [r.setting_key, r.value_before, r.value_after]), [['workspace.allow_publish_sites_and_forms', true, false]])
  })

  test('내보내기 · 권한(주기 · 회수 · 끊기 · 잇기) · 영구 삭제', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const mate = await person('동료')
    const doc = await topOf(boss)
    await recordExport(boss.ctx, { kind: 'workspace' })
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: mate.userId }, 'view')).ok)
    assert.ok((await revokeAccess(boss.ctx, doc, { type: 'user', id: mate.userId })).ok)
    const sub = (await createPage(boss.ctx, { parentPageId: doc, title: titleFromPlainText('하위') })).id
    assert.ok((await stopInheriting(boss.ctx, sub)).ok)
    assert.ok((await resumeInheriting(boss.ctx, sub)).ok)
    await trashPage(boss.ctx, sub)
    await purgePage(boss.ctx, sub)

    assert.deepEqual((await eventsIn(ws, 'workspace.exported')).map((r) => [r.target_type, r.metadata.scope]), [['workspace', 'workspace']])
    assert.deepEqual(
      (await eventsIn(ws, 'page.permission_changed')).map((r) => [r.target_id, r.metadata.change]),
      [[doc, 'grant'], [doc, 'revoke'], [sub, 'stop_inheriting'], [sub, 'resume_inheriting']],
    )
    assert.deepEqual((await eventsIn(ws, 'page.permanently_deleted')).map((r) => r.target_id), [sub])
  })

  test('게시 — 켜고 끄고 설정 · 바뀌지 않은 게시 · 해제는 쌓지 않는다 · 토큰은 싣지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const doc = await topOf(boss)
    const first = await publishPage(boss.ctx, doc)
    assert.ok(first.ok)
    assert.ok((await publishPage(boss.ctx, doc)).ok)
    assert.ok((await updatePublicLink(boss.ctx, doc, { rotateToken: true })).ok)
    assert.ok((await unpublishPage(boss.ctx, doc)).ok)
    assert.ok((await unpublishPage(boss.ctx, doc)).ok)
    const rows = await eventsIn(ws, 'page.publish_changed')
    assert.deepEqual(rows.map((r) => r.metadata.change), ['publish', 'settings', 'unpublish'])
    assert.ok(!JSON.stringify(rows).includes(first.value.token!), '토큰을 싣지 않는다')
  })
})

// ── ② 거부 ────────────────────────────────────────────────────────────

describe('② ★ 거부된 명령은 기록되지 않는다', () => {
  test('볼 수만 있는 사람의 공유 · 정책이 막은 게시 · 권한 없는 설정', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const viewer = await person('보는 사람')
    const doc = await topOf(boss)
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: viewer.userId }, 'view')).ok)
    const before = (await eventsIn(ws)).length

    assert.equal((await grantAccess(viewer.ctx, doc, { type: 'user', id: boss.userId }, 'view')).ok, false)
    assert.ok((await updateSetting(boss.ctx, 'workspace.allow_publish_sites_and_forms', false)).ok)
    assert.equal((await publishPage(boss.ctx, doc)).ok, false)
    assert.equal((await updateSetting(viewer.ctx, 'workspace.name', '몰래')).ok, false)
    assert.equal((await eventsIn(ws)).length, before + 1, '설정 한 줄만 늘었다')
  })
})

// ── ③ 쌓기만 ──────────────────────────────────────────────────────────

describe('③ ★ 쌓기만 한다', () => {
  test('고치기 · 최근 행 지우기는 거부 · 365일이 지난 행은 지운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    await recordExport(boss.ctx, { kind: 'workspace' })
    const [row] = await query<{ id: string }>(`SELECT id FROM audit_event WHERE workspace_id = $1`, [ws])
    await assert.rejects(query(`UPDATE audit_event SET metadata = '{}' WHERE id = $1`, [row!.id]), /append-only/)
    await assert.rejects(query(`DELETE FROM audit_event WHERE id = $1`, [row!.id]), /append-only/)

    const old = crypto.randomUUID()
    await query(
      `INSERT INTO audit_event (id, scope, workspace_id, event_type, metadata, occurred_at) VALUES ($1, 'workspace', $2, 'workspace.exported', '{}', now() - interval '400 days')`,
      [old, ws],
    )
    const gone = await query<{ id: string }>(`DELETE FROM audit_event WHERE id = $1 RETURNING id`, [old])
    assert.equal(gone.length, 1)
  })
})

// ── ④ 내용 · 행위자 ───────────────────────────────────────────────────

describe('④ 내용을 싣지 않는다 · 그때의 이름이 남는다', () => {
  test('페이지 제목은 어디에도 없다 · 이름을 바꿔도 그때의 이름', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const mate = await person('동료')
    const doc = await topOf(boss, '아주 비밀스러운 제목')
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: mate.userId }, 'comment')).ok)
    await query(`UPDATE "user" SET name = '바뀐 이름' WHERE id = $1`, [boss.userId])
    const rows = await eventsIn(ws, 'page.permission_changed')
    assert.ok(!JSON.stringify(rows).includes('비밀스러운'))
    assert.equal(rows[0]!.actor_name, '대표')
  })
})

// ── ⑤ 읽기 ────────────────────────────────────────────────────────────

describe('⑤ 읽기 — owner 만', () => {
  test('최근 것부터 · 종류로 거르기 · 앞으로 넘기기 · 멤버는 forbidden · 계정 범위는 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const mate = await person('동료')
    const doc = await topOf(boss)
    for (const level of ['view', 'comment', 'edit'] as const) {
      assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: mate.userId }, level)).ok)
    }
    await recordExport(boss.ctx, { kind: 'workspace' })
    // 계정 범위의 기록 — 워크스페이스 목록에 서지 않는다
    const { withTransaction } = await import('../db/tx.ts')
    await withTransaction((tx) => recordAuditIn(tx, { type: 'account.login', workspaceId: null, actorUserId: boss.userId }))

    const all = await listWorkspaceAudit(boss.ctx)
    assert.ok(all.ok)
    assert.deepEqual(all.value.map((r) => r.type), ['workspace.exported', 'page.permission_changed', 'page.permission_changed', 'page.permission_changed'])
    assert.ok(all.value.every((r) => r.type !== 'account.login'))
    const grants = await listWorkspaceAudit(boss.ctx, { type: 'page.permission_changed', limit: 2 })
    assert.ok(grants.ok)
    assert.deepEqual(grants.value.map((r) => r.metadata.level), ['edit', 'comment'])
    const older = await listWorkspaceAudit(boss.ctx, { type: 'page.permission_changed', before: grants.value[1]!.occurredAt })
    assert.ok(older.ok)
    assert.deepEqual(older.value.map((r) => r.metadata.level), ['view'])
    assert.deepEqual(await listWorkspaceAudit(mate.ctx), { ok: false, reason: 'forbidden' })
    void ws
  })
})

// ── ⑥ 데이터 수명 ─────────────────────────────────────────────────────

describe('⑥ 데이터 수명', () => {
  test('365일이 지난 것만 지운다 · 잡의 시각이 앞서 있어도 깨지지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    await recordExport(boss.ctx, { kind: 'workspace' })
    await query(
      `INSERT INTO audit_event (id, scope, workspace_id, event_type, metadata, occurred_at) VALUES ($1, 'workspace', $2, 'workspace.exported', '{}', now() - interval '400 days')`,
      [crypto.randomUUID(), ws],
    )
    const future = new Date(Date.now() + 500 * 86_400_000)
    const result = await runDataRetention(future, { workspaces: [ws], partitions: false })
    assert.equal(result.auditEvents, 1, '잡의 시각이 앞서 있어도 DB 시각으로 365일이 지난 것만')
    const left = await eventsIn(ws)
    assert.equal(left.length, 1)
  })
})
