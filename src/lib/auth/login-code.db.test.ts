/**
 * 로그인 코드 통합 테스트 — F-14-02 / F-14-16
 *
 * 순수 로직이 아니라 **DB 와 함께** 검증한다. 이 기능의 위험은 계산이 아니라
 * 쿼리에 있다(purpose 누락, 비원자적 소비, 계정 열거).
 *
 * DB 가 없으면 건너뛴다. CI 는 REQUIRE_DB=1 로 돌려 건너뛰지 못하게 한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'
process.env.MAIL_TRANSPORT ??= 'console'
process.env.DATABASE_URL ??= 'postgresql://notion:notion_dev_only@localhost:5432/notion'
process.env.REDIS_URL ??= 'redis://localhost:6379'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let available = false
let skipReason = ''

let pool: typeof import('../db/pool.ts')
let loginCode: typeof import('./login-code.ts')
let rateLimit: typeof import('../rate-limit.ts')
let valkey: typeof import('../valkey.ts')

/** 매 테스트마다 새 이메일을 써서 레이트리밋·이전 challenge 간섭을 없앤다. */
function freshEmail(): string {
  return `otp-${randomUUID().slice(0, 8)}@example.com`
}

let ipCounter = 0

/**
 * 테스트마다 고유한 IP 를 쓴다.
 *
 * IP 레이트리밋은 15분에 10회다. 모든 테스트가 같은 IP 를 쓰면 뒤쪽 테스트가
 * 앞쪽 테스트 때문에 차단된다 — 실제로 그렇게 13개가 전부 실패했다.
 * 주소는 문서화된 테스트용 대역(RFC 5737 TEST-NET-3)에서 뽑는다.
 */
function freshCtx(): { ip: string; userAgent: string } {
  ipCounter += 1
  const a = Math.floor(ipCounter / 250) % 250
  const b = ipCounter % 250
  return { ip: `203.0.${a}.${b}`, userAgent: 'node-test' }
}

async function createVerifiedUser(email: string): Promise<string> {
  const userId = randomUUID()
  const emailId = randomUUID()
  const { withTransaction } = await import('../db/tx.ts')
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO "user" (id, name, primary_email_id, created_at) VALUES ($1,'테스트',$2, now())`,
      [userId, emailId],
    )
    await tx.query(
      `INSERT INTO user_email (id, user_id, email, verified_at, is_primary, added_at)
       VALUES ($1,$2,$3, now(), true, now())`,
      [emailId, userId, email],
    )
  })
  return userId
}

before(async () => {
  try {
    pool = await import('../db/pool.ts')
    loginCode = await import('./login-code.ts')
    rateLimit = await import('../rate-limit.ts')
    valkey = await import('../valkey.ts')
    await pool.query('SELECT 1')
    // Valkey 도 있어야 레이트리밋 테스트가 의미 있다
    await valkey.getValkey().ping()
    available = true
  } catch (e) {
    skipReason = `DB/Valkey 사용 불가: ${(e as Error).message.split('\n')[0]}`
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (available) {
    await pool.closePool().catch(() => {})
    await valkey.closeValkey().catch(() => {})
  }
})


describe('requestLoginCode — 계정 열거 방지 (F-14-02)', () => {
  test('가입되지 않은 이메일에도 코드를 보낸다 — 가입 경로 [정정 판결]', async (t) => {
    if (!available) return t.skip(skipReason)

    // 원안(F-14-02 엣지 케이스)은 "메일을 보내지 않는다"였으나 그대로 하면
    // 신규 사용자가 영원히 가입할 수 없다. F-14-01 시나리오 2번이 이긴다.
    const unknown = freshEmail()
    const result = await loginCode.requestLoginCode(unknown, freshCtx())

    assert.equal(result.rateLimited, false)
    assert.ok(result.devCode, '계정이 없어도 코드가 발급되어야 가입이 가능하다')

    // challenge 도 만들어진다 — 계정 유무로 DB 상태가 갈리면 그 자체가 열거 신호다
    const rows = await pool.query(
      `SELECT user_id FROM otp_challenge WHERE email = $1`, [unknown],
    )
    assert.equal(rows.length, 1)
    assert.equal(
      (rows[0] as { user_id: string | null }).user_id,
      null,
      '아직 계정이 없으므로 user_id 는 NULL 이다',
    )
  })

  test('계정 유무에 따라 응답이 구분되지 않는다', async (t) => {
    if (!available) return t.skip(skipReason)

    const known = freshEmail()
    await createVerifiedUser(known)
    const unknown = freshEmail()

    const a = await loginCode.requestLoginCode(known, freshCtx())
    const b = await loginCode.requestLoginCode(unknown, freshCtx())

    // 응답의 관측 가능한 형태가 같아야 한다 (devCode 는 개발 전용 채널)
    assert.equal(a.rateLimited, b.rateLimited)
    assert.equal(a.retryAfterSeconds, b.retryAfterSeconds)
    assert.equal(typeof a.devCode, typeof b.devCode)
  })

  test('가입된 이메일은 challenge 가 생기지만 응답 형태는 같다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    await createVerifiedUser(email)
    const result = await loginCode.requestLoginCode(email, freshCtx())

    assert.equal(result.rateLimited, false)
    assert.ok(result.devCode, '개발 transport 에서는 코드가 나와야 한다')

    const rows = await pool.query(`SELECT id FROM otp_challenge WHERE email = $1`, [email])
    assert.equal(rows.length, 1)
  })

  test('미인증 이메일은 코드를 받지 못한다 — 이미 UNIQUE 슬롯을 차지하고 있다', async (t) => {
    if (!available) return t.skip(skipReason)

    // user_email.email 은 전역 UNIQUE 다. 미인증 별칭도 그 슬롯을 이미 차지하고
    // 있으므로, 신규 가입으로 오인해 코드를 보내면 검증 시점에 제약 위반으로
    // 터진다. F-14-01 엣지 케이스: "이미 다른 계정의 secondary → 가입 거부".
    const email = freshEmail()
    const userId = randomUUID()
    await pool.query(
      `INSERT INTO "user" (id, name, created_at) VALUES ($1,'미인증', now())`, [userId],
    )
    await pool.query(
      `INSERT INTO user_email (id, user_id, email, added_at) VALUES ($1,$2,$3, now())`,
      [randomUUID(), userId, email],
    )

    const result = await loginCode.requestLoginCode(email, freshCtx())
    assert.equal(result.devCode, undefined, 'verified_at 이 NULL 이면 로그인도 가입도 불가여야 한다')
    assert.equal(result.rateLimited, false, '거부 사유가 응답으로 드러나면 안 된다')

    const rows = await pool.query(`SELECT id FROM otp_challenge WHERE email = $1`, [email])
    assert.equal(rows.length, 0)
  })

  test('정지된 계정은 코드를 받지 못한다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    const userId = await createVerifiedUser(email)
    await pool.query(`UPDATE "user" SET status = 'suspended' WHERE id = $1`, [userId])

    const result = await loginCode.requestLoginCode(email, freshCtx())
    assert.equal(result.devCode, undefined)
    assert.equal(result.rateLimited, false)
  })
})

describe('requestLoginCode — 재요청 시 이전 코드 무효화', () => {
  test('새 코드를 받으면 이전 코드는 즉시 무효가 된다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    await createVerifiedUser(email)

    const first = await loginCode.requestLoginCode(email, freshCtx())
    const second = await loginCode.requestLoginCode(email, freshCtx())
    assert.ok(first.devCode && second.devCode)

    // 이전 코드로는 로그인할 수 없다
    const old = await loginCode.verifyLoginCode(email, first.devCode!, freshCtx())
    assert.equal(old.ok, false, '이전 코드가 살아있으면 재사용 창이 넓어진다')

    // 새 코드는 동작한다
    const fresh = await loginCode.verifyLoginCode(email, second.devCode!, freshCtx())
    assert.equal(fresh.ok, true)
  })
})

describe('verifyLoginCode — 신규 가입 경로', () => {
  test('계정이 없는 이메일의 코드가 검증된다 (userId=null)', async (t) => {
    if (!available) return t.skip(skipReason)

    // 이 케이스가 없어서 실제 버그를 놓쳤다. consumed.user_id 가 NULL 인 것을
    // 실패로 판정해 가입이 전부 거부되고 있었는데, 테스트가 전부 기존 계정만
    // 검증하고 있어서 13개가 통과했다.
    const email = freshEmail()
    const { devCode } = await loginCode.requestLoginCode(email, freshCtx())
    const result = await loginCode.verifyLoginCode(email, devCode!, freshCtx())

    assert.equal(result.ok, true, '신규 가입 코드가 거부되면 아무도 가입할 수 없다')
    assert.equal((result as { userId: string | null }).userId, null)
    assert.equal((result as { email: string }).email, email)
  })

  test('한 번 틀린 뒤 올바른 코드로 성공한다 — 오타는 흔하다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    await createVerifiedUser(email)
    const { devCode } = await loginCode.requestLoginCode(email, freshCtx())
    const wrong = devCode === '000000' ? '111111' : '000000'

    const bad = await loginCode.verifyLoginCode(email, wrong, freshCtx())
    assert.equal(bad.ok, false)

    const good = await loginCode.verifyLoginCode(email, devCode!, freshCtx())
    assert.equal(good.ok, true, '오타 한 번에 로그인이 막히면 안 된다')
  })
})

describe('verifyLoginCode — 소비는 원자적이다', () => {
  test('같은 코드로 두 번 로그인할 수 없다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    await createVerifiedUser(email)
    const { devCode } = await loginCode.requestLoginCode(email, freshCtx())

    const a = await loginCode.verifyLoginCode(email, devCode!, freshCtx())
    const b = await loginCode.verifyLoginCode(email, devCode!, freshCtx())

    assert.equal(a.ok, true)
    assert.equal(b.ok, false, '같은 코드로 두 세션이 만들어지면 안 된다')
  })

  test('동시에 검증해도 하나만 성공한다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    await createVerifiedUser(email)
    const { devCode } = await loginCode.requestLoginCode(email, freshCtx())

    const results = await Promise.all([
      loginCode.verifyLoginCode(email, devCode!, freshCtx()),
      loginCode.verifyLoginCode(email, devCode!, freshCtx()),
      loginCode.verifyLoginCode(email, devCode!, freshCtx()),
    ])
    const succeeded = results.filter((r) => r.ok).length
    assert.equal(succeeded, 1, `${succeeded}개가 성공했다 — UPDATE ... WHERE consumed_at IS NULL 이 원자적이지 않다`)
  })
})

describe('verifyLoginCode — 시도 횟수 (F-14-16)', () => {
  test('5회 실패하면 challenge 가 폐기된다. 계정은 잠기지 않는다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    await createVerifiedUser(email)
    const { devCode } = await loginCode.requestLoginCode(email, freshCtx())
    const wrong = devCode === '000000' ? '111111' : '000000'

    const outcomes = []
    for (let i = 0; i < 5; i++) {
      outcomes.push(await loginCode.verifyLoginCode(email, wrong, freshCtx()))
    }
    assert.equal(outcomes.at(-1)!.ok, false)

    // 폐기됐으므로 이제 올바른 코드도 통하지 않는다
    const correct = await loginCode.verifyLoginCode(email, devCode!, freshCtx())
    assert.equal(correct.ok, false, '5회 실패 후에는 올바른 코드도 거부되어야 한다')

    // 그러나 계정은 멀쩡하다 — 새 코드를 받아 로그인할 수 있다
    const again = await loginCode.requestLoginCode(email, freshCtx())
    assert.ok(again.devCode, '계정이 잠기면 타인이 남의 계정을 막는 DoS 가 된다')
    const ok = await loginCode.verifyLoginCode(email, again.devCode!, freshCtx())
    assert.equal(ok.ok, true)
  })

  test('만료와 오입력은 다른 사유를 돌려준다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    await createVerifiedUser(email)
    const { devCode } = await loginCode.requestLoginCode(email, freshCtx())

    const wrong = devCode === '000000' ? '111111' : '000000'
    const mismatch = await loginCode.verifyLoginCode(email, wrong, freshCtx())
    assert.equal(mismatch.ok, false)
    assert.equal((mismatch as { reason: string }).reason, 'invalid')

    // 강제로 만료시킨다
    await pool.query(
      `UPDATE otp_challenge SET expires_at = now() - interval '1 second'
        WHERE email = $1 AND consumed_at IS NULL`,
      [email],
    )
    const expired = await loginCode.verifyLoginCode(email, devCode!, freshCtx())
    assert.equal((expired as { reason: string }).reason, 'expired',
      '"만료됨"과 "틀림"이 같으면 사용자가 무한 재시도한다')
  })
})

describe('verifyLoginCode — purpose 교차 사용 차단 (전형적 취약점)', () => {
  test('password_reset 코드로 로그인할 수 없다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    const userId = await createVerifiedUser(email)

    // 로그인 코드를 하나 받아 해시 형식을 그대로 쓰되 purpose 만 바꿔 심는다.
    const { devCode } = await loginCode.requestLoginCode(email, freshCtx())
    const [row] = await pool.query<{ id: string; code_hash: string }>(
      `SELECT id, code_hash FROM otp_challenge WHERE email = $1 AND purpose = 'login'`,
      [email],
    )
    // 원래 login challenge 는 지우고, 같은 해시를 password_reset 으로 심는다
    await pool.query(`DELETE FROM otp_challenge WHERE email = $1`, [email])
    await pool.query(
      `INSERT INTO otp_challenge (id, purpose, email, user_id, code_hash, expires_at, created_at)
       VALUES ($1,'password_reset',$2,$3,$4, now() + interval '10 minutes', now())`,
      [row.id, email, userId, row.code_hash],
    )

    const result = await loginCode.verifyLoginCode(email, devCode!, freshCtx())
    assert.equal(result.ok, false,
      'purpose 를 WHERE 절에 넣지 않으면 재설정 코드로 로그인이 된다')
  })
})

describe('requestLoginCode — 레이트리밋 (F-14-16)', () => {
  test('이메일당 3회를 넘으면 차단된다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    await createVerifiedUser(email)
    await rateLimit.reset('code_req_email', email.toLowerCase())

    const outcomes = []
    for (let i = 0; i < 4; i++) {
      outcomes.push(await loginCode.requestLoginCode(email, { ip: null, userAgent: null }))
    }

    assert.deepEqual(
      outcomes.map((o) => o.rateLimited),
      [false, false, false, true],
      '이메일당 상한이 이메일 폭탄을 막는 1차 방어다',
    )
    assert.ok(outcomes[3].retryAfterSeconds > 0, '재시도 가능 시각을 알려줘야 한다')
  })

  test('차단돼도 계정 존재 여부는 드러나지 않는다', async (t) => {
    if (!available) return t.skip(skipReason)

    const unknown = freshEmail()
    await rateLimit.reset('code_req_email', unknown.toLowerCase())

    const outcomes = []
    for (let i = 0; i < 4; i++) {
      outcomes.push(await loginCode.requestLoginCode(unknown, { ip: null, userAgent: null }))
    }
    // 가입 여부와 무관하게 같은 형태로 차단된다
    assert.equal(outcomes[3].rateLimited, true)
    assert.equal(outcomes[3].devCode, undefined)
  })
})

describe('auth_event — 세션 없이도 기록된다 (불변식 A10)', () => {
  test('코드 요청·실패·성공이 전부 남는다', async (t) => {
    if (!available) return t.skip(skipReason)

    const email = freshEmail()
    await createVerifiedUser(email)
    const { devCode } = await loginCode.requestLoginCode(email, freshCtx())
    const wrong = devCode === '000000' ? '111111' : '000000'
    await loginCode.verifyLoginCode(email, wrong, freshCtx())
    await loginCode.verifyLoginCode(email, devCode!, freshCtx())

    const rows = await pool.query<{ kind: string }>(
      `SELECT kind FROM auth_event WHERE email = $1 ORDER BY at`, [email],
    )
    const kinds = rows.map((r) => r.kind)
    assert.ok(kinds.includes('code_requested'))
    assert.ok(kinds.includes('code_failed'))
    assert.ok(kinds.includes('code_verified'))
  })

  test('없는 계정의 요청도 기록된다 — 열거 시도를 감사할 수 있어야 한다', async (t) => {
    if (!available) return t.skip(skipReason)

    const unknown = freshEmail()
    await loginCode.requestLoginCode(unknown, freshCtx())

    const rows = await pool.query<{ kind: string; user_id: string | null }>(
      `SELECT kind, user_id FROM auth_event WHERE email = $1`, [unknown],
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].kind, 'code_requested')
    assert.equal(rows[0].user_id, null, 'user_id NOT NULL 이면 이 이벤트를 남길 수 없다')
  })
})
