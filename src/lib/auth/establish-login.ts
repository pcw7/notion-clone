/**
 * 코드 검증 이후 — 계정 생성(필요 시)과 세션 발급을 한 트랜잭션으로 묶는다.
 *
 * 정본: F-14-01(계정 생성), F-14-02(코드 검증), §3.2(user_session)
 *
 * **왜 한 트랜잭션인가**
 * 계정만 만들어지고 세션이 실패하면 사용자는 "가입은 됐는데 로그인이 안 되는"
 * 상태에 빠진다. 반대로 세션만 만들어지면 dangling FK 다. 둘은 같은 단위다.
 *
 * `user` 와 `user_email` 은 순환 FK(DEFERRABLE)로 묶여 있어 어차피 같은
 * 트랜잭션이 강제된다.
 */

import { withTransaction } from '../db/tx.ts'
import { createSession, type IssuedSession } from './session.ts'
import type { AuthMethod } from './session-context.ts'

export type EstablishLoginInput = {
  readonly email: string
  /** verifyLoginCode 가 돌려준 값. null 이면 신규 가입이다. */
  readonly existingUserId: string | null
  readonly authMethod: AuthMethod
  readonly ip: string | null
  readonly userAgent: string | null
}

export type EstablishLoginResult = {
  readonly userId: string
  readonly session: IssuedSession
  /** 이번 요청에서 계정이 새로 만들어졌는가. 온보딩 분기에 쓴다. */
  readonly created: boolean
}

/** 이메일 로컬파트에서 기본 표시 이름을 만든다. 온보딩에서 바꾼다. */
function defaultNameFrom(email: string): string {
  const local = email.split('@')[0] ?? 'user'
  const cleaned = local.replace(/[._-]+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned.slice(0, 60) : 'user'
}

export async function establishLogin(input: EstablishLoginInput): Promise<EstablishLoginResult> {
  return withTransaction(async (tx) => {
    let userId = input.existingUserId
    let created = false

    if (userId === null) {
      // 신규 가입 (F-14-01).
      //
      // 동시에 같은 이메일로 두 요청이 오면 user_email.email 의 전역 UNIQUE 가
      // 유일한 방어선이다 — 명세가 "트랜잭션 격리만으로는 부족하고 DB 제약이
      // 필수"라고 명시한 지점이다. 충돌하면 예외가 나고 트랜잭션이 통째로
      // 롤백되므로 반쪽짜리 계정이 남지 않는다.
      const userRow = await tx.queryOne<{ id: string }>(
        `INSERT INTO "user" (id, name, created_at) VALUES (gen_random_uuid(), $1, now())
         RETURNING id`,
        [defaultNameFrom(input.email)],
      )
      userId = userRow.id

      // 코드 검증 경로이므로 verified_at 을 즉시 채운다 — 이메일 수신함에
      // 접근할 수 있음을 방금 증명했다. (F-14-01 동작 상세)
      const emailRow = await tx.queryOne<{ id: string }>(
        `INSERT INTO user_email (id, user_id, email, verified_at, is_primary, added_at)
         VALUES (gen_random_uuid(), $1, $2, now(), true, now())
         RETURNING id`,
        [userId, input.email],
      )

      await tx.query(`UPDATE "user" SET primary_email_id = $2 WHERE id = $1`, [
        userId,
        emailRow.id,
      ])

      // 코드 경로는 credential 을 하나도 만들지 않는다. 그것이 정상이다 (R-1).
      created = true
    }

    const session = await createSession(tx, {
      userId,
      authMethod: input.authMethod,
      // 2FA 는 F-14-05. 아직 없으므로 false 로 둔다 — true 로 두면 나중에
      // MFA 가 붙었을 때 이미 발급된 세션들이 MFA 를 통과한 것으로 취급된다.
      mfaSatisfied: false,
      ip: input.ip,
      userAgent: input.userAgent,
    })

    await tx.query(
      `INSERT INTO auth_event (at, email, user_id, kind, ip, user_agent, meta)
       VALUES (now(), $1, $2, $3, $4, $5, $6)`,
      [
        input.email,
        userId,
        created ? 'account_created' : 'login_succeeded',
        input.ip,
        input.userAgent,
        JSON.stringify({ auth_method: input.authMethod, session_id: session.sessionId }),
      ],
    )

    return { userId, session, created }
  })
}
