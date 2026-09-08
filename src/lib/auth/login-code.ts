/**
 * 이메일 로그인 코드(OTP) 발급 · 검증 — F-14-02
 *
 * 정본: docs/research/14-auth-accounts.md F-14-02, F-14-16
 *
 * 이 모듈이 지켜야 하는 것들:
 *
 * - 코드는 **해시로만** 저장한다. 원문은 메일에만 존재한다.
 * - 재요청하면 **이전 코드를 즉시 무효화**한다(재사용 창을 좁힌다).
 * - 검증 시 `purpose` 를 반드시 WHERE 절에 넣는다. 로그인 코드로 비밀번호를
 *   재설정할 수 있게 되는 것이 이 종류의 전형적인 취약점이다.
 * - `consumed_at` 은 **원자적으로** 채운다. 같은 코드로 두 세션이 만들어지면 안 된다.
 * - 존재하지 않는 이메일에도 **똑같이 코드를 보낸다.** 로그인과 가입이 같은
 *   입구를 쓰기 때문이다(F-14-01 시나리오 2). 계정 열거는 응답·메일 문구·
 *   응답 시간을 동일하게 유지해서 막는다. 판결 근거는 14-auth-accounts.md
 *   F-14-02 의 [정정].
 * - `auth_event` 는 세션이 없어도 기록한다(불변식 A10). 로그인 실패를 감사에
 *   남기지 못하면 감사가 무의미해진다.
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

import { query, queryMaybe } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import {
  CODE_REQUEST_PER_EMAIL,
  CODE_REQUEST_PER_IP,
  LOGIN_CODE_LENGTH,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_SECONDS,
} from './constants.ts'
import { consume } from '../rate-limit.ts'
import { sendLoginCode } from './mailer.ts'

/** otp_challenge.purpose — 교차 사용을 막기 위해 항상 명시한다. */
export type OtpPurpose = 'login' | 'email_verify' | 'password_reset' | 'mfa_sms'

export type RequestContext = {
  readonly ip: string | null
  readonly userAgent: string | null
}

/**
 * 코드 해시.
 *
 * 단순 sha256 을 쓰지 않는 이유: 코드는 6자리(경우의 수 100만)라 DB 가 유출되면
 * 전수 대입으로 즉시 역산된다. AUTH_SECRET 을 키로 한 HMAC 이면 DB 만으로는
 * 역산할 수 없다. 명세의 "해시로만 저장한다"를 만족하면서 더 안전하다.
 */
function hashCode(code: string, challengeSalt: string): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error('AUTH_SECRET 이 설정되지 않았습니다. .env.example 참조.')
  }
  return createHmac('sha256', secret).update(`${challengeSalt}:${code}`).digest('hex')
}

function codeMatches(code: string, salt: string, storedHash: string): boolean {
  const a = Buffer.from(hashCode(code, salt), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** 숫자 6자리. randomInt 는 모듈로 편향이 없다. */
function generateCode(): string {
  let out = ''
  for (let i = 0; i < LOGIN_CODE_LENGTH; i++) out += String(randomInt(0, 10))
  return out
}

/** 세션 없이도 기록한다 — 불변식 A10. 실패해도 본 흐름을 막지 않는다. */
async function recordAuthEvent(
  kind: string,
  input: { email?: string | null; userId?: string | null; ctx: RequestContext; meta?: unknown },
): Promise<void> {
  try {
    await query(
      `INSERT INTO auth_event (at, email, user_id, kind, ip, user_agent, meta)
       VALUES (now(), $1, $2, $3, $4, $5, $6)`,
      [
        input.email ?? null,
        input.userId ?? null,
        kind,
        input.ctx.ip,
        input.ctx.userAgent,
        input.meta === undefined ? null : JSON.stringify(input.meta),
      ],
    )
  } catch (e) {
    // 감사 기록 실패로 로그인을 막지는 않는다. 다만 조용히 넘어가지도 않는다.
    console.error('[auth] auth_event 기록 실패:', (e as Error).message)
  }
}

// ── 발급 ──────────────────────────────────────────────────────────────

export type RequestCodeResult = {
  /**
   * 호출자에게 돌려줄 응답은 **항상 같다.** 계정 존재 여부가 드러나면 안 된다.
   * 아래 필드는 서버 내부 판단·테스트용이며 HTTP 응답에 넣지 마라.
   */
  readonly rateLimited: boolean
  readonly retryAfterSeconds: number
  /** 개발 환경에서만 채워진다. 메일 대신 코드를 확인하는 용도. */
  readonly devCode?: string
}

/**
 * 로그인 코드를 발급하고 메일로 보낸다.
 *
 * 계정이 있든 없든 동일하게 challenge 를 만들고 코드를 보낸다.
 * 계정이 없으면 검증 시점에 만들어진다(F-14-01).
 * 예외는 정지·삭제된 계정 하나뿐이고, 그때도 응답은 같다.
 */
export async function requestLoginCode(
  email: string,
  ctx: RequestContext,
): Promise<RequestCodeResult> {
  const normalized = email.trim()

  // 이메일당 상한이 1차 방어다. 회사 NAT 뒤에서는 IP 상한만으로 정상 사용자가
  // 차단되고, 이메일 폭탄은 이메일당 상한으로만 막힌다. (F-14-16)
  const byEmail = await consume('code_req_email', normalized.toLowerCase(), CODE_REQUEST_PER_EMAIL)
  if (!byEmail.allowed) {
    await recordAuthEvent('code_request_rate_limited', {
      email: normalized,
      ctx,
      meta: { scope: 'email' },
    })
    return { rateLimited: true, retryAfterSeconds: byEmail.resetSeconds }
  }

  if (ctx.ip) {
    const byIp = await consume('code_req_ip', ctx.ip, CODE_REQUEST_PER_IP)
    if (!byIp.allowed) {
      await recordAuthEvent('code_request_rate_limited', {
        email: normalized,
        ctx,
        meta: { scope: 'ip' },
      })
      return { rateLimited: true, retryAfterSeconds: byIp.resetSeconds }
    }
  }

  // verified_at 여부와 무관하게 이메일 자체를 찾는다.
  //
  // user_email.email 은 **전역 UNIQUE** 다. 미인증 이메일도 그 슬롯을 이미
  // 차지하고 있으므로, 그 주소로 신규 가입을 시도하면 제약 위반으로 터진다.
  // "verified 인 것만" 찾으면 이 경우를 신규 가입으로 오인한다.
  const existing = await queryMaybe<{
    user_id: string
    is_verified: boolean
    is_active: boolean
  }>(
    `SELECT ue.user_id,
            (ue.verified_at IS NOT NULL) AS is_verified,
            (u.status = 'active')        AS is_active
       FROM user_email ue
       JOIN "user" u ON u.id = ue.user_id
      WHERE ue.email = $1`,
    [normalized],
  )

  const canLogIn = existing !== null && existing.is_verified && existing.is_active
  const account = canLogIn ? existing : null

  await recordAuthEvent('code_requested', {
    email: normalized,
    userId: existing?.user_id ?? null,
    ctx,
    // 계정 존재 여부는 감사 로그에는 남긴다. 응답에만 안 드러나면 된다.
    meta: {
      account_exists: existing !== null,
      verified: existing?.is_verified ?? null,
      active: existing?.is_active ?? null,
    },
  })

  // 이메일이 이미 누군가에게 묶여 있는데 로그인에 쓸 수 없는 경우
  // (미인증 별칭이거나 정지·삭제된 계정) 코드를 보내지 않는다.
  //
  // F-14-01 엣지 케이스: "이메일이 이미 다른 계정의 secondary 로 등록됨 → 가입 거부."
  // 보내봐야 검증 시점에 UNIQUE 제약으로 실패할 뿐이다.
  // 응답은 여전히 동일하다.
  if (existing !== null && !canLogIn) {
    return { rateLimited: false, retryAfterSeconds: 0 }
  }

  // 계정이 없어도 코드를 보낸다. 로그인과 가입이 같은 입구를 쓰기 때문이다.
  //
  // 원래 F-14-02 엣지 케이스는 "메일을 보내지 않는다"였으나, 그대로 하면
  // 신규 사용자가 영원히 가입할 수 없다. F-14-01 시나리오 2번이 이긴다.
  // 판결 근거는 docs/research/14-auth-accounts.md F-14-02 의 [정정] 참조.
  //
  // 계정 열거는 여전히 막힌다 — 응답도 메일 문구도 같고, challenge 는
  // 양쪽 다 만들어지므로 DB 관찰로도 구분되지 않는다.
  const code = generateCode()

  const challengeId = await withTransaction(async (tx) => {
    // 이전 login 코드를 즉시 무효화한다. purpose 를 반드시 조건에 넣는다 —
    // 여기서 빠뜨리면 로그인 요청이 비밀번호 재설정 코드를 죽인다.
    await tx.query(
      `UPDATE otp_challenge
          SET consumed_at = now()
        WHERE purpose = 'login'
          AND email = $1
          AND consumed_at IS NULL
          AND expires_at > now()`,
      [normalized],
    )

    const row = await tx.queryOne<{ id: string }>(
      `INSERT INTO otp_challenge
         (id, purpose, email, user_id, code_hash, expires_at, request_ip, request_ua, created_at)
       VALUES (gen_random_uuid(), 'login', $1, $2, '', now() + ($3 || ' seconds')::interval, $4, $5, now())
       RETURNING id`,
      [normalized, account?.user_id ?? null, String(LOGIN_CODE_TTL_SECONDS), ctx.ip, ctx.userAgent],
    )

    // challenge id 를 salt 로 쓰므로 id 가 정해진 뒤에 해시한다.
    // 같은 코드라도 challenge 마다 해시가 달라져 rainbow table 이 무의미해진다.
    await tx.query(`UPDATE otp_challenge SET code_hash = $2 WHERE id = $1`, [
      row.id,
      hashCode(code, row.id),
    ])

    return row.id
  })

  const devCode = await sendLoginCode({ to: normalized, code, challengeId })

  return { rateLimited: false, retryAfterSeconds: 0, ...(devCode ? { devCode } : {}) }
}

// ── 검증 ──────────────────────────────────────────────────────────────

export type VerifyCodeOutcome =
  | {
      readonly ok: true
      /** null 이면 아직 계정이 없다 — 신규 가입 경로다 (F-14-01) */
      readonly userId: string | null
      readonly email: string
      readonly challengeId: string
    }
  | { readonly ok: false; readonly reason: 'invalid' | 'expired' | 'too_many_attempts' }

/**
 * 코드를 검증한다.
 *
 * 실패 사유를 호출자에게는 구분해 돌려주되(만료와 오입력은 사용자에게 다른
 * 안내가 필요하다 — F-14-02), **계정 존재 여부는 절대 드러나지 않는다.**
 *
 * 성공 시 userId 가 null 이면 아직 계정이 없다는 뜻이다. 계정 생성은
 * 호출자(establishLogin)가 같은 트랜잭션에서 처리한다.
 */
export async function verifyLoginCode(
  email: string,
  code: string,
  ctx: RequestContext,
): Promise<VerifyCodeOutcome> {
  const normalized = email.trim()

  // purpose 를 WHERE 에 넣는다. 이것이 이 함수에서 가장 중요한 한 줄이다.
  const challenge = await queryMaybe<{
    id: string
    user_id: string | null
    code_hash: string
    attempts: number
    is_expired: boolean
  }>(
    `SELECT id, user_id, code_hash, attempts, (expires_at <= now()) AS is_expired
       FROM otp_challenge
      WHERE purpose = 'login'
        AND email = $1
        AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalized],
  )

  if (!challenge) {
    await recordAuthEvent('code_failed', { email: normalized, ctx, meta: { reason: 'no_challenge' } })
    return { ok: false, reason: 'invalid' }
  }

  if (challenge.is_expired) {
    await recordAuthEvent('code_failed', { email: normalized, ctx, meta: { reason: 'expired' } })
    return { ok: false, reason: 'expired' }
  }

  if (challenge.attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
    // 계정을 잠그지 않는다. challenge 만 폐기한다 — 타인이 남의 계정을 잠그는
    // DoS 를 만들지 않기 위해서다. (F-14-16)
    await query(`UPDATE otp_challenge SET consumed_at = now() WHERE id = $1`, [challenge.id])
    await recordAuthEvent('code_failed', {
      email: normalized,
      userId: challenge.user_id,
      ctx,
      meta: { reason: 'too_many_attempts' },
    })
    return { ok: false, reason: 'too_many_attempts' }
  }

  if (!codeMatches(code, challenge.id, challenge.code_hash)) {
    const after = await queryMaybe<{ attempts: number }>(
      `UPDATE otp_challenge SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
      [challenge.id],
    )
    const attempts = after?.attempts ?? challenge.attempts + 1

    if (attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
      await query(`UPDATE otp_challenge SET consumed_at = now() WHERE id = $1`, [challenge.id])
    }

    await recordAuthEvent('code_failed', {
      email: normalized,
      userId: challenge.user_id,
      ctx,
      meta: { reason: 'mismatch', attempts },
    })
    return { ok: false, reason: attempts >= LOGIN_CODE_MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid' }
  }

  // 원자적 소비. 같은 코드로 두 세션이 만들어지면 안 된다.
  // 동시에 두 요청이 오면 하나만 1행을 받는다.
  const consumed = await queryMaybe<{ id: string; user_id: string | null }>(
    `UPDATE otp_challenge
        SET consumed_at = now()
      WHERE id = $1 AND consumed_at IS NULL
      RETURNING id, user_id`,
    [challenge.id],
  )

  // user_id 가 NULL 인 것은 실패가 아니다 — 신규 가입 경로다.
  // 여기서 `!consumed.user_id` 로 막으면 가입이 전부 거부된다.
  if (!consumed) {
    // 다른 요청이 먼저 소비했다. 같은 코드로 두 세션이 생기는 것을 막은 결과다.
    await recordAuthEvent('code_failed', {
      email: normalized,
      ctx,
      meta: { reason: 'already_consumed' },
    })
    return { ok: false, reason: 'invalid' }
  }

  await recordAuthEvent('code_verified', {
    email: normalized,
    userId: consumed.user_id,
    ctx,
  })

  // user_id 가 null 이면 신규 가입이다. 계정 생성은 호출자(establishLogin)가 한다.
  return { ok: true, userId: consumed.user_id, email: normalized, challengeId: consumed.id }
}
