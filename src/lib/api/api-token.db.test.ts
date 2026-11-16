/**
 * 공개 API 의 개인 토큰 — 명령 · 게이트 · 세션에 매인 명령 (API-1 · F-09-02 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ① ② · 마이그레이션 0145
 *
 *   ① ★ 명령 — 만들기(값은 한 번 · 저장은 해시만 · 기본 1년) · 게스트는 forbidden · 살아 있는 것 20개(limit_reached) · 목록 · 폐기(자기 것만) · 감사
 *   ② ★ 게이트 — `resolveSessionContext({ apiToken })` 가 워크스페이스를 토큰 행에서 얻고 세션과 같은 0단계 게이트를 지난다. 폐기 · 만료 ·
 *        내보낸 멤버 · 멈춘 멤버십 · 멈춘 사람 · 지운 계정 · 지운 워크스페이스 · 게스트로 내림 · SSO 강제는 곧바로 막힌다(따로 도는 잡 없이)
 *   ③ ★ `last_used_at` 은 1분에 한 번만 쓴다
 *   ④ ★ 세션에 매인 명령 — API 토큰의 컨텍스트(소유자의 것이라도)를 거부한다: 비밀번호 · 2단계 인증 · 토큰 관리 · 멤버 · 초대 · 게스트 ·
 *        그룹 · 워크스페이스 삭제 · 감사 로그
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { canReadAudit, listWorkspaceAudit } from '../audit/audit.ts'
import { deleteAccount } from '../auth/account-deletion.ts'
import {
  confirmTotpEnrollment,
  regenerateBackupCodes,
  removeMfaMethod,
  renameMfaMethod,
  startTotpEnrollment,
} from '../auth/mfa.ts'
import { removePassword, setPassword } from '../auth/password.ts'
import { hashSessionToken, isLoginSession, loginSessionIdOf, resolveSessionContext, type SessionContext } from '../auth/session-context.ts'
import { query, queryOne } from '../db/pool.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { canDeleteWorkspace, deleteWorkspace } from '../workspace/delete.ts'
import { addGroupMember, createGroup, deleteGroup, removeGroupMember, renameGroup } from '../workspace/group.ts'
import { inviteGuestToPage, promoteGuest, removeGuest } from '../workspace/guest.ts'
import { revokeInvite } from '../workspace/invite.ts'
import { changeMemberRole, leaveWorkspace, removeMember } from '../workspace/member.ts'
import { canCreateApiToken, createApiToken, listApiTokens, revokeApiToken } from './api-token.ts'
import { API_TOKEN_MAX_LIVE, isApiTokenShape } from './token-format.ts'

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

async function team(name: string) {
  const ws = await createBareWorkspace(name)
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  return { ws, boss, mate }
}

/** 토큰을 만들고 값을 돌려준다 — 실패하면 던진다. */
async function mint(who: Actor, name = '스크립트', expiresInDays?: unknown): Promise<{ token: string; id: string }> {
  const made = await createApiToken(who.ctx, expiresInDays === undefined ? { name } : { name, expiresInDays })
  if (!made.ok) throw new Error(`토큰을 만들지 못했다: ${made.reason}`)
  return { token: made.value.token, id: made.value.summary.id }
}

/** 토큰의 컨텍스트 — 실패하면 던진다. */
async function asToken(token: string): Promise<SessionContext> {
  const r = await resolveSessionContext({ apiToken: token })
  if (!r.ok) throw new Error(`토큰이 컨텍스트를 얻지 못했다: ${r.reason}`)
  return r.context
}

const denial = async (token: string) => {
  const r = await resolveSessionContext({ apiToken: token })
  return r.ok ? 'ok' : r.reason
}

describe('① 명령', () => {
  test('★ 만들기 — 값은 이 한 번만 · 저장은 해시만 · 기본 1년 · 목록에는 값이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('토큰 만들기')
    const made = await createApiToken(mate.ctx, { name: '  배포   스크립트 ' })
    assert.ok(made.ok)
    const { token, summary } = made.value
    assert.ok(isApiTokenShape(token))
    assert.equal(summary.name, '배포 스크립트')
    assert.equal(summary.last4, token.slice(-4))
    assert.equal(summary.lastUsedAt, null)
    assert.equal(summary.expired, false)
    const days = (Date.parse(summary.expiresAt!) - Date.parse(summary.createdAt)) / 86_400_000
    assert.ok(Math.abs(days - 365) < 0.01, `기본 만료 1년 — ${days}`)

    const row = await queryOne<Record<string, unknown>>(`SELECT * FROM api_token WHERE id = $1`, [summary.id])
    assert.equal(row.token_hash, hashSessionToken(token))
    assert.ok(!Object.values(row).some((v) => typeof v === 'string' && v.includes(token.slice(4, 20))), '평문을 어느 칸에도 두지 않는다')

    const listed = await listApiTokens(mate.ctx)
    assert.ok(listed.ok)
    assert.deepEqual(listed.value.map((s) => s.id), [summary.id])
    assert.ok(!JSON.stringify(listed.value).includes(token.slice(4)), '목록에 값이 없다')

    const forever = await createApiToken(mate.ctx, { name: '만료 없음', expiresInDays: null })
    assert.ok(forever.ok && forever.value.summary.expiresAt === null)
    assert.deepEqual(await createApiToken(mate.ctx, { name: '   ' }), { ok: false, reason: 'invalid_name' })
    assert.deepEqual(await createApiToken(mate.ctx, { name: '가'.repeat(101) }), { ok: false, reason: 'invalid_name' })
    assert.deepEqual(await createApiToken(mate.ctx, { name: 'x', expiresInDays: 12 }), { ok: false, reason: 'invalid_expiry' })
  })

  test('★ 게스트는 만들지 못한다 — 버튼(canCreateApiToken)과 명령이 같은 답', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws } = await team('게스트 토큰')
    const guest = await joinAs(ws, await createUser('손님'), 'guest')
    assert.equal(canCreateApiToken(guest.ctx), false)
    assert.deepEqual(await createApiToken(guest.ctx, { name: '손님 스크립트' }), { ok: false, reason: 'forbidden' })
    const listed = await listApiTokens(guest.ctx)
    assert.ok(listed.ok && listed.value.length === 0, '목록은 본다(비어 있다)')
    const n = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM api_token WHERE user_id = $1`, [guest.userId])
    assert.equal(n.n, 0)
  })

  test('★ 살아 있는 것 20개 — 21번째는 limit_reached · 폐기 · 만료한 것은 세지 않는다 · 다른 워크스페이스는 따로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, mate } = await team('토큰 상한')
    const ids: string[] = []
    for (let i = 0; i < API_TOKEN_MAX_LIVE; i += 1) ids.push((await mint(mate, `토큰 ${i}`)).id)
    assert.deepEqual(await createApiToken(mate.ctx, { name: '스물한 번째' }), { ok: false, reason: 'limit_reached' })

    assert.ok((await revokeApiToken(mate.ctx, ids[0]!)).ok)
    const again = await mint(mate, '폐기한 자리')
    assert.deepEqual(await createApiToken(mate.ctx, { name: '다시 스물한 번째' }), { ok: false, reason: 'limit_reached' })

    // 만료한 것은 죽은 토큰이다 — 자리를 차지하지 않는다
    await query(`UPDATE api_token SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1`, [again.id])
    assert.ok((await createApiToken(mate.ctx, { name: '만료한 자리' })).ok)

    // 같은 사람의 다른 워크스페이스는 따로 센다
    const other = await createBareWorkspace('다른 곳')
    const there = await joinAs(other, { userId: mate.userId }, 'member')
    assert.ok((await createApiToken(there.ctx, { name: '다른 곳의 첫 토큰' })).ok)
    void ws
  })

  test('★ 폐기 — 자기 것만 · 두 번째는 not_found · 감사에 만들기 · 폐기가 이 워크스페이스의 범위로 남는다(값 없이)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('토큰 폐기')
    const { token, id } = await mint(mate, '지울 토큰')
    assert.deepEqual(await revokeApiToken(boss.ctx, id), { ok: false, reason: 'not_found' }, '소유자라도 남의 토큰은 폐기하지 못한다(자기 것만)')
    assert.deepEqual(await revokeApiToken(mate.ctx, 'not-a-uuid'), { ok: false, reason: 'not_found' })
    assert.deepEqual(await revokeApiToken(mate.ctx, id), { ok: true, value: null })
    assert.deepEqual(await revokeApiToken(mate.ctx, id), { ok: false, reason: 'not_found' })
    const listed = await listApiTokens(mate.ctx)
    assert.ok(listed.ok && listed.value.length === 0)

    const audit = await query<{ scope: string; workspace_id: string; metadata: Record<string, unknown>; ip: string | null }>(
      `SELECT scope, workspace_id, metadata, host(ip) AS ip FROM audit_event
        WHERE actor_user_id = $1 AND event_type = 'account.security_changed' ORDER BY occurred_at, metadata->>'change'`,
      [mate.userId],
    )
    assert.deepEqual(audit.map((a) => [a.scope, a.workspace_id, a.metadata.change, a.metadata.tokenId, a.metadata.name]), [
      ['workspace', ws, 'api_token_created', id, '지울 토큰'],
      ['workspace', ws, 'api_token_revoked', id, '지울 토큰'],
    ])
    assert.ok(!JSON.stringify(audit).includes(token.slice(4)), '감사에 값이 없다')
  })
})

describe('② 게이트', () => {
  test('★ 토큰의 컨텍스트 — 워크스페이스는 토큰 행에서 · 표시(apiToken)가 붙고 로그인 세션이 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, mate } = await team('토큰 게이트')
    const { token, id } = await mint(mate)
    const ctx = await asToken(token)
    assert.equal(ctx.workspaceId, ws)
    assert.equal(ctx.userId, mate.userId)
    assert.equal(ctx.role, 'member')
    assert.equal(ctx.authMethod, 'api_token')
    assert.deepEqual(ctx.apiToken, { tokenId: id })
    assert.equal(ctx.sessionId, id)
    assert.equal(ctx.delegation, undefined)
    assert.equal(isLoginSession(ctx), false)
    assert.equal(loginSessionIdOf(ctx), null)
    assert.equal(isLoginSession(mate.ctx), true)
    assert.equal(loginSessionIdOf(mate.ctx), mate.ctx.sessionId)

    assert.equal(await denial(`ntn_${'Z'.repeat(46)}`), 'no_session', '모르는 토큰')
    assert.equal(await denial(''), 'no_session')
    // 세션 토큰은 API 토큰이 아니다(표가 다르다) — 거꾸로도
    assert.equal(await denial(mate.token), 'no_session')
    assert.equal((await resolveSessionContext(token, ws)).ok, false, 'API 토큰을 세션 쿠키로 내면 세션이 아니다')
  })

  test('★ 폐기는 곧바로 · 만료가 지나면 expired', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('폐기 · 만료')
    const a = await mint(mate, '폐기할 것')
    await asToken(a.token)
    assert.ok((await revokeApiToken(mate.ctx, a.id)).ok)
    assert.equal(await denial(a.token), 'revoked')

    const b = await mint(mate, '만료될 것', 7)
    await asToken(b.token)
    await query(`UPDATE api_token SET created_at = now() - interval '8 days', expires_at = now() - interval '1 second' WHERE id = $1`, [b.id])
    assert.equal(await denial(b.token), 'expired')
  })

  test('★ 멤버십 · 사람 · 워크스페이스가 끊기면 그 토큰은 곧바로 막힌다 — 세션이 막히는 같은 게이트(따로 도는 잡 없이)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('끊기는 토큰')

    // 내보낸 멤버
    const removed = await mint(mate, '내보낼 사람의 것')
    assert.ok((await removeMember(boss.ctx, mate.userId)).ok)
    assert.equal(await denial(removed.token), 'member_inactive')
    assert.equal((await resolveSessionContext(mate.token, ws)).ok, false, '세션도 같은 까닭으로 막힌다')

    // 멈춘 멤버십
    const paused = await joinAs(ws, await createUser('멈출 사람'), 'member')
    const pausedTok = await mint(paused)
    await query(`UPDATE workspace_member SET status = 'suspended' WHERE workspace_id = $1 AND user_id = $2`, [ws, paused.userId])
    assert.equal(await denial(pausedTok.token), 'member_inactive')

    // 멈춘 사람(계정 비활성)
    const frozen = await joinAs(ws, await createUser('비활성'), 'member')
    const frozenTok = await mint(frozen)
    await asToken(frozenTok.token)
    await query(`UPDATE "user" SET status = 'suspended' WHERE id = $1`, [frozen.userId])
    assert.equal(await denial(frozenTok.token), 'no_session')

    // 지운 계정
    const leaver = await joinAs(ws, await createUser('지울 계정'), 'member')
    const leaverTok = await mint(leaver)
    await asToken(leaverTok.token)
    const gone = await deleteAccount(leaver.userId, { confirmEmail: leaver.email })
    assert.ok(gone.ok, JSON.stringify(gone))
    assert.notEqual(await denial(leaverTok.token), 'ok')

    // 게스트로 내림 — 토큰은 멤버 이상의 것(만들 때와 같은 판정)
    const demoted = await joinAs(ws, await createUser('내려갈 사람'), 'member')
    const demotedTok = await mint(demoted)
    await query(`UPDATE workspace_member SET role = 'guest' WHERE workspace_id = $1 AND user_id = $2`, [ws, demoted.userId])
    assert.equal(await denial(demotedTok.token), 'not_a_member')

    // SSO 강제 — 토큰은 SAML 로그인이 아니다: 멤버의 것은 막히고 owner 의 것은 지난다(같은 canEnterWorkspace)
    const member2 = await joinAs(ws, await createUser('SSO 멤버'), 'member')
    const memberTok = await mint(member2)
    const bossTok = await mint(boss, '소유자의 것')
    await query(`INSERT INTO sso_config (workspace_id, enforced) VALUES ($1, true)`, [ws])
    assert.equal(await denial(memberTok.token), 'sso_required')
    assert.equal(await denial(bossTok.token), 'ok')
    await query(`DELETE FROM sso_config WHERE workspace_id = $1`, [ws])

    // 지운 워크스페이스 — 소유자의 토큰도
    const name = (await queryOne<{ name: string }>(`SELECT name FROM workspace WHERE id = $1`, [ws])).name
    assert.ok((await deleteWorkspace(boss.ctx, { confirmName: name })).ok)
    assert.equal(await denial(bossTok.token), 'workspace_deleted')
  })
})

describe('③ 마지막 사용', () => {
  test('★ last_used_at — 처음 쓰면 적고 · 1분 안에는 다시 쓰지 않고 · 1분이 지나면 다시 적는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('마지막 사용')
    const { token, id } = await mint(mate)
    const usedAt = async () => (await queryOne<{ at: Date | null }>(`SELECT last_used_at AS at FROM api_token WHERE id = $1`, [id])).at
    assert.equal(await usedAt(), null)
    await asToken(token)
    const first = await usedAt()
    assert.ok(first instanceof Date)
    for (let i = 0; i < 3; i += 1) await asToken(token)
    assert.equal((await usedAt())!.getTime(), first.getTime(), '1분 안의 요청은 쓰지 않는다')

    await query(`UPDATE api_token SET created_at = created_at - interval '2 minutes', last_used_at = now() - interval '61 seconds' WHERE id = $1`, [id])
    const stale = await usedAt()
    await asToken(token)
    assert.ok((await usedAt())!.getTime() > stale!.getTime(), '1분이 지나면 다시 적는다')
    const listed = await listApiTokens(mate.ctx)
    assert.ok(listed.ok && listed.value[0]!.lastUsedAt !== null, '목록이 마지막 사용을 보인다')
  })
})

describe('④ 세션에 매인 명령', () => {
  test('★ API 토큰의 컨텍스트는 소유자의 것이라도 거부된다 — 비밀번호 · 2단계 인증 · 토큰 · 멤버 · 초대 · 게스트 · 그룹 · 삭제 · 감사', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('세션에 매인 명령')
    const api = await asToken((await mint(boss, '소유자의 토큰')).token)
    assert.equal(api.role, 'owner', '역할로 막히는 것이 아니다')
    const any = randomUUID()
    const strong = `correct horse battery ${Date.now()}`

    const refused: Array<[string, Promise<{ ok: boolean; reason?: string }>, string]> = [
      ['setPassword', setPassword(api, { newPassword: strong }), 'session_required'],
      ['removePassword', removePassword(api, {}), 'session_required'],
      ['startTotpEnrollment', startTotpEnrollment(api, { label: '휴대폰' }), 'session_required'],
      ['confirmTotpEnrollment', confirmTotpEnrollment(api, any, '000000'), 'session_required'],
      ['removeMfaMethod', removeMfaMethod(api, any, '000000'), 'session_required'],
      ['renameMfaMethod', renameMfaMethod(api, any, '새 이름'), 'session_required'],
      ['regenerateBackupCodes', regenerateBackupCodes(api, '000000'), 'session_required'],
      ['createApiToken', createApiToken(api, { name: '토큰이 만든 토큰' }), 'forbidden'],
      ['listApiTokens', listApiTokens(api), 'forbidden'],
      ['revokeApiToken', revokeApiToken(api, api.sessionId), 'forbidden'],
      ['changeMemberRole', changeMemberRole(api, mate.userId, 'restricted_member'), 'forbidden'],
      ['removeMember', removeMember(api, mate.userId), 'forbidden'],
      ['leaveWorkspace', leaveWorkspace(api), 'forbidden'],
      ['revokeInvite', revokeInvite(api, any), 'forbidden'],
      ['inviteGuestToPage', inviteGuestToPage(api, any, 'guest@example.com', 'view'), 'forbidden'],
      ['promoteGuest', promoteGuest(api, mate.userId), 'forbidden'],
      ['removeGuest', removeGuest(api, mate.userId), 'forbidden'],
      ['createGroup', createGroup(api, '토큰 그룹'), 'forbidden'],
      ['renameGroup', renameGroup(api, any, '새 이름'), 'forbidden'],
      ['deleteGroup', deleteGroup(api, any), 'forbidden'],
      ['addGroupMember', addGroupMember(api, any, mate.userId), 'forbidden'],
      ['removeGroupMember', removeGroupMember(api, any, mate.userId), 'forbidden'],
      ['deleteWorkspace', deleteWorkspace(api, { confirmName: '세션에 매인 명령' }), 'forbidden'],
      ['listWorkspaceAudit', listWorkspaceAudit(api), 'forbidden'],
    ]
    for (const [name, pending, reason] of refused) {
      const r = await pending
      assert.ok(!r.ok && r.reason === reason, `${name} 가 API 토큰의 컨텍스트를 받았다 — ${JSON.stringify(r)}`)
    }
    assert.equal(canDeleteWorkspace(api), false)
    assert.equal(canReadAudit(api), false)
    assert.equal(canCreateApiToken(api), false)

    // 아무것도 바뀌지 않았다 — 같은 명령이 로그인 세션으로는 지난다
    const roles = await query<{ user_id: string; role: string; status: string }>(
      `SELECT user_id, role, status FROM workspace_member WHERE workspace_id = $1 ORDER BY role`,
      [ws],
    )
    assert.deepEqual(roles.map((r) => [r.role, r.status]), [['member', 'active'], ['owner', 'active']])
    assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM credential WHERE user_id = $1`, [boss.userId])).n, 0)
    assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM api_token WHERE user_id = $1`, [boss.userId])).n, 1)
    assert.ok((await changeMemberRole(boss.ctx, mate.userId, 'restricted_member')).ok, '로그인 세션으로는 지난다')
    assert.ok((await setPassword(boss.ctx, { newPassword: strong })).ok, '로그인 세션으로는 지난다')
  })
})
