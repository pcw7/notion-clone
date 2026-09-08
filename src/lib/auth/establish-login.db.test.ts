/**
 * 가입 · 세션 발급 통합 테스트 — F-14-01 / §3.2
 *
 * 코드 검증 이후의 절반을 본다: 계정이 없으면 만들고, 세션을 발급하고,
 * 그 세션으로 실제 신원 조회가 되는지까지.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'
process.env.MAIL_TRANSPORT ??= 'console'
process.env.DATABASE_URL ??= 'postgresql://notion:notion_dev_only@localhost:5432/notion'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let available = false
let skipReason = ''
let pool: typeof import('../db/pool.ts')
let establish: typeof import('./establish-login.ts')
let sessionCtx: typeof import('./session-context.ts')

const freshEmail = () => `est-${randomUUID().slice(0, 8)}@example.com`

before(async () => {
  try {
    pool = await import('../db/pool.ts')
    establish = await import('./establish-login.ts')
    sessionCtx = await import('./session-context.ts')
    await pool.query('SELECT 1')
    available = true
  } catch (e) {
    skipReason = `DB 사용 불가: ${(e as Error).message.split('\n')[0]}`
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (available) await pool.closePool().catch(() => {})
})

const input = (email: string, existingUserId: string | null = null) =>
  ({
    email,
    existingUserId,
    authMethod: 'login_code' as const,
    ip: '198.51.100.1',
    userAgent: 'node-test',
  })

describe('establishLogin — 신규 가입 (F-14-01)', () => {
  test('계정과 primary 이메일이 한 트랜잭션에서 만들어진다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    const result = await establish.establishLogin(input(email))

    assert.equal(result.created, true)
    assert.ok(result.userId)
    assert.ok(result.session.token)

    const [row] = await pool.query<{
      name: string
      primary_email_id: string | null
      email: string
      verified_at: Date | null
      is_primary: boolean
    }>(
      `SELECT u.name, u.primary_email_id, ue.email::text AS email, ue.verified_at, ue.is_primary
         FROM "user" u JOIN user_email ue ON ue.user_id = u.id
        WHERE u.id = $1`,
      [result.userId],
    )

    assert.ok(row.primary_email_id, 'primary_email_id 가 채워져야 한다 (순환 FK)')
    assert.equal(row.email, email)
    assert.equal(row.is_primary, true)
    assert.ok(row.verified_at, '코드 경로는 verified_at 을 즉시 채운다')
  })

  test('credential 을 하나도 만들지 않는 것이 정상이다 (R-1)', async (t) => {
    if (!available) return t.skip(skipReason)

    const result = await establish.establishLogin(input(freshEmail()))
    const creds = await pool.query(`SELECT id FROM credential WHERE user_id = $1`, [result.userId])
    assert.equal(creds.length, 0, '이메일 코드 경로는 비밀번호도 passkey 도 만들지 않는다')
  })

  test('워크스페이스가 0개인 계정이 정상적으로 존재한다', async (t) => {
    if (!available) return t.skip(skipReason)

    const result = await establish.establishLogin(input(freshEmail()))
    const members = await pool.query(
      `SELECT workspace_id FROM workspace_member WHERE user_id = $1`, [result.userId],
    )
    assert.equal(members.length, 0)
  })

  test('같은 이메일로 두 계정을 만들 수 없다 — UNIQUE 가 유일한 방어선', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    await establish.establishLogin(input(email))

    await assert.rejects(
      () => establish.establishLogin(input(email)),
      /duplicate key|unique/i,
      'user_email.email 전역 UNIQUE 가 없으면 계정이 갈라진다',
    )
  })

  test('동시에 같은 이메일로 가입하면 하나만 성공한다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    const results = await Promise.allSettled([
      establish.establishLogin(input(email)),
      establish.establishLogin(input(email)),
      establish.establishLogin(input(email)),
    ])
    const ok = results.filter((r) => r.status === 'fulfilled').length
    assert.equal(ok, 1, `${ok}개가 성공했다 — 트랜잭션 격리만으로는 부족하다는 명세 그대로다`)

    const users = await pool.query(
      `SELECT user_id FROM user_email WHERE email = $1`, [email],
    )
    assert.equal(users.length, 1)
  })
})

describe('establishLogin — 기존 계정 로그인', () => {
  test('계정을 새로 만들지 않고 세션만 발급한다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    const first = await establish.establishLogin(input(email))
    const second = await establish.establishLogin(input(email, first.userId))

    assert.equal(second.created, false)
    assert.equal(second.userId, first.userId)
    assert.notEqual(second.session.sessionId, first.session.sessionId)

    const sessions = await pool.query(
      `SELECT id FROM user_session WHERE user_id = $1`, [first.userId],
    )
    assert.equal(sessions.length, 2, '로그인할 때마다 세션이 하나씩 늘어난다')
  })
})

describe('세션 저장 방식', () => {
  test('토큰 원문은 DB 에 남지 않는다', async (t) => {
    if (!available) return t.skip(skipReason)

    const result = await establish.establishLogin(input(freshEmail()))
    const rows = await pool.query<{ token_hash: string }>(
      `SELECT token_hash FROM user_session WHERE id = $1`, [result.session.sessionId],
    )
    assert.notEqual(rows[0].token_hash, result.session.token)
    assert.equal(
      rows[0].token_hash,
      sessionCtx.hashSessionToken(result.session.token),
      '저장값은 원문의 해시여야 한다',
    )
  })

  test('mfaSatisfied 는 false 로 시작한다', async (t) => {
    if (!available) return t.skip(skipReason)

    // true 로 두면 나중에 MFA(F-14-05)가 붙었을 때 이미 발급된 세션들이
    // MFA 를 통과한 것으로 취급된다.
    const result = await establish.establishLogin(input(freshEmail()))
    const rows = await pool.query<{ mfa_satisfied: boolean }>(
      `SELECT mfa_satisfied FROM user_session WHERE id = $1`, [result.session.sessionId],
    )
    assert.equal(rows[0].mfa_satisfied, false)
  })

  test('만료 시각이 90일 뒤로 설정된다', async (t) => {
    if (!available) return t.skip(skipReason)

    const result = await establish.establishLogin(input(freshEmail()))
    const days = (result.session.expiresAt.getTime() - Date.now()) / 86_400_000
    assert.ok(days > 89 && days < 91, `${days.toFixed(1)}일 — 90일이어야 한다`)
  })
})

describe('auth_event — 가입과 로그인을 구분해 기록한다', () => {
  test('신규는 account_created, 재로그인은 login_succeeded', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    const first = await establish.establishLogin(input(email))
    await establish.establishLogin(input(email, first.userId))

    const rows = await pool.query<{ kind: string }>(
      `SELECT kind FROM auth_event WHERE email = $1 ORDER BY at`, [email],
    )
    const kinds = rows.map((r) => r.kind)
    assert.ok(kinds.includes('account_created'))
    assert.ok(kinds.includes('login_succeeded'))
  })
})
