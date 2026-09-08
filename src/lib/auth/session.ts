/**
 * 세션 발급 · 폐기 — F-14-08 의 일부
 *
 * **쿠키는 여기 없다.** next/headers 는 Next.js 요청 컨텍스트 밖에서 로드되지
 * 않아 이 모듈을 node --test 로 돌릴 수 없게 만든다. 쿠키는 session-cookie.ts.
 *
 * 정본: 00-canonical-data-model.md §3.2 user_session
 *
 * 세션 토큰은 DB 에 **해시로만** 저장한다. 쿠키에 들어가는 원문은 서버에
 * 남지 않으므로, DB 가 유출돼도 세션을 탈취할 수 없다.
 */

import { randomBytes } from 'node:crypto'

import { queryMaybe } from '../db/pool.ts'
import type { Tx } from '../db/tx.ts'
import { SESSION_MAX_LIFETIME_DAYS } from './constants.ts'
import { hashSessionToken, type AuthMethod } from './session-context.ts'

export type NewSessionInput = {
  readonly userId: string
  readonly authMethod: AuthMethod
  readonly mfaSatisfied: boolean
  readonly ip: string | null
  readonly userAgent: string | null
  readonly deviceKind?: 'web' | 'desktop' | 'mobile'
}

export type IssuedSession = {
  readonly sessionId: string
  /** 쿠키에 넣을 원문. 저장하지 않는다. */
  readonly token: string
  readonly expiresAt: Date
}

/**
 * 세션 행을 만든다. 트랜잭션 안에서 호출한다 — 계정 생성과 같은 단위여야
 * "계정은 생겼는데 로그인이 안 된" 상태가 생기지 않는다.
 */
export async function createSession(tx: Tx, input: NewSessionInput): Promise<IssuedSession> {
  // 256비트. base64url 이라 쿠키에 그대로 넣을 수 있다.
  const token = randomBytes(32).toString('base64url')

  // user_session 에는 user_agent 컬럼이 없다. 정본(§3.2)은 device_label 을 쓴다 —
  // 기기 목록 화면에 "Chrome on Windows" 처럼 보여주기 위한 축이다.
  const row = await tx.queryOne<{ id: string; expires_at: Date }>(
    `INSERT INTO user_session
       (id, user_id, token_hash, auth_method, mfa_satisfied,
        device_kind, device_label, ip, created_at, last_seen_at, expires_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now(), now(),
             now() + ($8 || ' days')::interval)
     RETURNING id, expires_at`,
    [
      input.userId,
      hashSessionToken(token),
      input.authMethod,
      input.mfaSatisfied,
      input.deviceKind ?? 'web',
      input.userAgent?.slice(0, 256) ?? null,
      input.ip,
      String(SESSION_MAX_LIFETIME_DAYS),
    ],
  )

  return { sessionId: row.id, token, expiresAt: row.expires_at }
}

/**
 * 세션을 폐기한다. 행을 지우지 않고 revoked_at 을 채운다 —
 * "언제 누가 로그아웃했는가"가 감사에 필요하다.
 */
export async function revokeSession(token: string, reason = 'user_logout'): Promise<void> {
  await queryMaybe(
    `UPDATE user_session
        SET revoked_at = now(), revoked_reason = $2
      WHERE token_hash = $1 AND revoked_at IS NULL
      RETURNING id`,
    [hashSessionToken(token), reason],
  )
}
