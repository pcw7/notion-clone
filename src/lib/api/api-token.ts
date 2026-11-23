/**
 * 공개 API 의 개인 토큰 — 만들기 · 목록 · 폐기 (API-1 · F-09-02)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ① ② · 마이그레이션 0145
 *
 *   · 만들기는 **멤버 이상**(게스트는 아니다) · 사람마다 워크스페이스마다 살아 있는 것 20개(`limit_reached`) — 그 사람의 멤버십 행을
 *     잠그고 센다(두 탭이 동시에 만들어도 21개가 되지 않는다). 역할도 그 행에서 다시 읽는다 — 세션의 역할은 낡았을 수 있다.
 *   · 값은 만들 때 **한 번만** 평문으로 돌려준다. 저장은 해시만(`hashSessionToken` — 세션 토큰과 같은 규약) · 끝 4자는 알아보는 데만.
 *   · 목록 · 폐기는 **자기 것만**(이 워크스페이스의). 폐기는 곧바로 듣는다 — 게이트가 매 요청 `revoked_at` 을 읽는다. 그 토큰의 웹훅
 *     구독(API-8)도 같은 트랜잭션에서 끈다(`token_revoked`).
 *   · 셋 다 **세션에 매인 명령**이다 — 위임 · API 토큰의 컨텍스트로는 `forbidden`(토큰이 토큰을 만들지 못한다 · `isLoginSession`).
 *   · 만들기 · 폐기는 감사 로그에 남는다(`account.security_changed` · 이 워크스페이스의 범위 — 소유자가 감사 로그에서 본다).
 */

import { randomUUID } from 'node:crypto'

import { recordForContextIn } from '../audit/audit.ts'
import { hashSessionToken, isLoginSession, type SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { API_TOKEN_MAX_LIVE, apiTokenLast4, newApiToken, normalizeTokenName, parseExpiryDays } from './token-format.ts'
import { skipPendingApiWebhookEventsIn } from './webhooks.ts'

export type ApiTokenFailure =
  /** 게스트 · 로그인 세션이 아닌 컨텍스트(위임 · API 토큰). */
  | 'forbidden'
  /** 이름이 비었거나 100자를 넘는다. */
  | 'invalid_name'
  /** 고를 수 있는 만료(7 · 30 · 90 · 180 · 365일 · 없음)가 아니다. */
  | 'invalid_expiry'
  /** 살아 있는 토큰이 이미 20개다. */
  | 'limit_reached'
  /** 이 사람의 (살아 있는) 토큰이 아니다. */
  | 'not_found'

export type ApiTokenResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: ApiTokenFailure }

/** 목록의 한 줄 — 값은 없다(다시 볼 수 없다). 시각은 ISO 문자열. */
export type ApiTokenSummary = {
  readonly id: string
  readonly name: string
  readonly last4: string
  readonly createdAt: string
  readonly lastUsedAt: string | null
  readonly expiresAt: string | null
  /** 만료가 지났다 — 폐기하기 전까지 목록에 남는다(쓰지는 못한다). */
  readonly expired: boolean
}

const fail = (reason: ApiTokenFailure) => ({ ok: false, reason }) as const

/** 만들 수 있는가 — 로그인 세션의 멤버 이상. 설정의 "만들기" 버튼이 설지 정한다. 판정은 `createApiToken` 이 다시 한다. */
export function canCreateApiToken(ctx: SessionContext): boolean {
  return isLoginSession(ctx) && ctx.role !== 'guest'
}

type TokenRow = {
  id: string
  name: string
  last4: string
  created_at: Date
  last_used_at: Date | null
  expires_at: Date | null
  expired: boolean
}

const SUMMARY_COLUMNS = `id, name, last4, created_at, last_used_at, expires_at, (expires_at IS NOT NULL AND expires_at <= now()) AS expired`

const summaryOf = (r: TokenRow): ApiTokenSummary => ({
  id: r.id,
  name: r.name,
  last4: r.last4,
  createdAt: r.created_at.toISOString(),
  lastUsedAt: r.last_used_at?.toISOString() ?? null,
  expiresAt: r.expires_at?.toISOString() ?? null,
  expired: r.expired,
})

/**
 * 토큰을 만든다 — `token` 은 이 한 번만 평문이다. `expiresInDays` 가 빠지면 1년(노션의 기본) · `null` 이면 만료 없음.
 */
export async function createApiToken(
  ctx: SessionContext,
  input: { readonly name: unknown; readonly expiresInDays?: unknown },
): Promise<ApiTokenResult<{ readonly token: string; readonly summary: ApiTokenSummary }>> {
  if (!canCreateApiToken(ctx)) return fail('forbidden')
  const name = normalizeTokenName(input.name)
  if (name === null) return fail('invalid_name')
  const days = parseExpiryDays(input.expiresInDays)
  if (days === 'invalid') return fail('invalid_expiry')

  return withCommandTransaction(async (tx) => {
    // 그 사람의 멤버십 행 — 잠가서 세기를 줄 세우고, 역할을 지금 것으로 다시 본다
    const member = await tx.queryMaybe<{ role: string; status: string }>(
      `SELECT role, status FROM workspace_member WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
      [ctx.workspaceId, ctx.userId],
    )
    if (member === null || member.status !== 'active' || member.role === 'guest') return fail('forbidden')
    const live = await tx.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM api_token
        WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
      [ctx.workspaceId, ctx.userId],
    )
    if (live.n >= API_TOKEN_MAX_LIVE) return fail('limit_reached')

    const token = newApiToken()
    const row = await tx.queryOne<TokenRow>(
      `INSERT INTO api_token (id, user_id, workspace_id, name, token_hash, last4, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now(), CASE WHEN $7::int IS NULL THEN NULL ELSE now() + make_interval(days => $7::int) END)
       RETURNING ${SUMMARY_COLUMNS}`,
      [randomUUID(), ctx.userId, ctx.workspaceId, name, hashSessionToken(token), apiTokenLast4(token), days],
    )
    await recordForContextIn(tx, ctx, 'account.security_changed', { metadata: { change: 'api_token_created', tokenId: row.id, name } })
    return { ok: true, value: { token, summary: summaryOf(row) } } as const
  })
}

/** 이 워크스페이스의 내 토큰 — 폐기하지 않은 것 · 최근 것부터. */
export async function listApiTokens(ctx: SessionContext): Promise<ApiTokenResult<ApiTokenSummary[]>> {
  if (!isLoginSession(ctx)) return fail('forbidden')
  const rows = await withReadTransaction((tx) =>
    tx.query<TokenRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM api_token
        WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL
        ORDER BY created_at DESC, id`,
      [ctx.workspaceId, ctx.userId],
    ),
  )
  return { ok: true, value: rows.map(summaryOf) }
}

/** 내 토큰을 폐기한다 — 곧바로 듣는다. 남의 것 · 이미 폐기한 것 · 모르는 id 는 `not_found`(있는지 말하지 않는다). */
export async function revokeApiToken(ctx: SessionContext, tokenId: string): Promise<ApiTokenResult<null>> {
  if (!isLoginSession(ctx)) return fail('forbidden')
  if (!isUuid(tokenId)) return fail('not_found')
  return withCommandTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ name: string }>(
      `UPDATE api_token SET revoked_at = now()
        WHERE id = $1 AND workspace_id = $2 AND user_id = $3 AND revoked_at IS NULL
        RETURNING name`,
      [tokenId, ctx.workspaceId, ctx.userId],
    )
    if (row === null) return fail('not_found')
    // 그 토큰의 웹훅 구독도 곧바로 선다(API-8 · 정본 ⑫) — 꺼짐(`token_revoked`) · 기다리던 이벤트는 건너뛴다
    const hooks = await tx.query<{ id: string }>(
      `UPDATE api_webhook_subscription SET status = 'disabled', disabled_reason = 'token_revoked', updated_at = now()
        WHERE api_token_id = $1 RETURNING id`,
      [tokenId],
    )
    await skipPendingApiWebhookEventsIn(tx, hooks.map((h) => h.id), 'token_revoked')
    await recordForContextIn(tx, ctx, 'account.security_changed', { metadata: { change: 'api_token_revoked', tokenId, name: row.name } })
    return { ok: true, value: null } as const
  })
}
