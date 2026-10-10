/**
 * 웹 게시 — 지금 상태 · 게시 · 게시 해제 (게시 · 공유 6a-1 · F-06-08 · F-06-07 웹 링크)
 *
 * 정본: 00-canonical-data-model.md §3.3 `public_link` · §3.3 끝 [정정] 웹 게시 ②④⑤⑥⑨
 *
 * ──────────────────────────────────────────────────────────────────────
 * 공개는 판정의 항이 아니다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 게시는 `acl_entry` 를 쓰지 않는다 — `public_link` 한 줄을 켜고 끈다. `effective()` 는 이 표를 읽지 않으므로 게시해도 워크스페이스
 * 안의 누구의 사이드바 · 검색 · 멘션 후보도 바뀌지 않는다(공개 링크는 **링크를 아는 사람**에게 주는 것이다). 공개 경로의 판정은
 * `public-access.ts` 가 따로 한다.
 *
 * 게시 해제는 `enabled := false` 다 — 행과 토큰이 남아 다시 게시하면 같은 주소다(정본 ⑤).
 */

import { randomBytes } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { readSecurityPolicyIn } from '../workspace/security-policy.ts'

/** 토큰의 바이트 수 — base64url 로 22자(0084 `ck_public_link_token`). */
const TOKEN_BYTES = 16

/** 공개 주소의 토큰 — 무작위 128비트 · base64url 22자. */
export function newPublicToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** 토큰의 모양 — 0084 의 CHECK 과 같다. 공개 경로가 DB 에 묻기 전에 거른다. */
export const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

export type RobotsDirective = 'index' | 'noindex'
export type AiCrawler = 'allow' | 'deny'

export type PublishState = {
  /** 웹에 게시되어 있는가(이 페이지 자신의 행 — 위 페이지의 게시로 공개된 것은 아니다). */
  readonly published: boolean
  /** 공개 주소의 토큰 — 게시를 바꿀 수 있는 사람에게만(정본 ④). 게시한 적이 없으면 null. */
  readonly token: string | null
  /** 지금은 `view` 하나다(정본 ⑥). */
  readonly level: 'view'
  readonly robots: RobotsDirective
  readonly aiCrawler: AiCrawler
  readonly expiresAt: string | null
  /** 워크스페이스 정책이 게시를 허용하는가 — 끄면 게시된 주소도 열리지 않는다(정본 ③ ⑨). */
  readonly policyAllows: boolean
  /** 게시하고 해제할 수 있는가(`manage_perm`). */
  readonly canManage: boolean
}

export type PublishFailure =
  /** 볼 수 없거나 없는 페이지다(없는 것과 같다). */
  | 'not_found'
  /** 볼 수는 있지만 게시할 수 없다(`manage_perm` 이 없다). */
  | 'forbidden'
  /** 페이지가 아니다 — 데이터베이스의 게시는 공개 렌더러가 표를 그릴 때(정본 ④). */
  | 'not_page'
  /** 휴지통의 페이지다. */
  | 'trashed'
  /** 워크스페이스 정책이 게시를 막았다(`allow_publish_sites_and_forms`). */
  | 'policy_disabled'

export type PublishResult =
  | { readonly ok: true; readonly value: PublishState }
  | { readonly ok: false; readonly reason: PublishFailure }

/** 실패를 HTTP 상태로. */
export function publishFailureStatus(reason: PublishFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'not_page':
    case 'trashed':
      return 400
    case 'policy_disabled':
      return 409
  }
}

type NodeRow = { id: string; type: string; lifecycle: string }
type LinkRow = { enabled: boolean; token: string | null; robots_directive: RobotsDirective; ai_crawler: AiCrawler; expires_at: Date | null }

/** 이 워크스페이스의 페이지 · 데이터베이스 노드. `lock` 이면 행을 잡는다 — 휴지통 · 이동과 줄을 세운다. */
async function loadNode(tx: Tx, ctx: SessionContext, nodeId: string, lock: boolean): Promise<NodeRow | null> {
  if (!isUuid(nodeId)) return null
  return tx.queryMaybe<NodeRow>(
    `SELECT id, type, lifecycle FROM block
      WHERE id = $1 AND workspace_id = $2 AND type IN ('page', 'database')${lock ? ' FOR UPDATE' : ''}`,
    [nodeId, ctx.workspaceId],
  )
}

async function loadLink(tx: Tx, nodeId: string): Promise<LinkRow | null> {
  return tx.queryMaybe<LinkRow>(
    `SELECT enabled, token, robots_directive, ai_crawler, expires_at FROM public_link WHERE node_id = $1`,
    [nodeId],
  )
}

function stateOf(link: LinkRow | null, policyAllows: boolean, canManage: boolean): PublishState {
  return {
    published: link?.enabled ?? false,
    token: canManage ? (link?.token ?? null) : null,
    level: 'view',
    robots: link?.robots_directive ?? 'noindex',
    aiCrawler: link?.ai_crawler ?? 'deny',
    expiresAt: link?.expires_at ? link.expires_at.toISOString() : null,
    policyAllows,
    canManage,
  }
}

/** 공유 패널의 게시 상태 — 볼 수 있으면. 토큰은 게시를 바꿀 수 있는 사람에게만 준다. */
export async function readPublishState(ctx: SessionContext, pageId: string): Promise<PublishResult> {
  return withReadTransaction(async (tx) => {
    const node = await loadNode(tx, ctx, pageId, false)
    if (node === null) return { ok: false, reason: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, pageId)
    if (!can(caps, 'view')) return { ok: false, reason: 'not_found' } as const
    const policy = await readSecurityPolicyIn(tx, ctx.workspaceId)
    return { ok: true, value: stateOf(await loadLink(tx, pageId), policy.allowPublish, can(caps, 'manage_perm')) } as const
  })
}

/**
 * 웹에 게시한다 — 이미 게시되어 있으면 그대로 돌려준다. 처음이면 토큰을 만들고, 해제했던 것이면 **같은 토큰**으로 다시 켠다.
 *
 * 누가: 그 페이지에 `manage_perm` 이 있는 사람(정본 ④). 페이지만 · 휴지통이 아닌 것만 · 정책이 허용할 때만.
 */
export async function publishPage(ctx: SessionContext, pageId: string): Promise<PublishResult> {
  return withCommandTransaction(async (tx) => {
    const node = await loadNode(tx, ctx, pageId, true)
    if (node === null) return { ok: false, reason: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, pageId)
    if (!can(caps, 'view')) return { ok: false, reason: 'not_found' } as const
    if (!can(caps, 'manage_perm')) return { ok: false, reason: 'forbidden' } as const
    if (node.type !== 'page') return { ok: false, reason: 'not_page' } as const
    if (node.lifecycle !== 'live') return { ok: false, reason: 'trashed' } as const
    const policy = await readSecurityPolicyIn(tx, ctx.workspaceId)
    if (!policy.allowPublish) return { ok: false, reason: 'policy_disabled' } as const

    const link = await tx.queryOne<LinkRow>(
      `INSERT INTO public_link (node_id, enabled, token, created_by, updated_by)
       VALUES ($1, true, $2, $3, $3)
       ON CONFLICT (node_id) DO UPDATE
         SET enabled = true,
             token = coalesce(public_link.token, EXCLUDED.token),
             updated_by = CASE WHEN public_link.enabled THEN public_link.updated_by ELSE EXCLUDED.updated_by END,
             updated_at = CASE WHEN public_link.enabled THEN public_link.updated_at ELSE now() END
       RETURNING enabled, token, robots_directive, ai_crawler, expires_at`,
      [pageId, newPublicToken(), ctx.userId],
    )
    return { ok: true, value: stateOf(link, true, true) } as const
  })
}

/**
 * 게시를 해제한다 — `enabled := false`(행과 토큰은 남는다 · 정본 ⑤). 게시되어 있지 않으면 그대로 돌려준다.
 *
 * 누가: 게시하는 사람과 같다. **정책 · 휴지통과 무관하게** 된다 — 끄는 것은 언제나 된다.
 */
export async function unpublishPage(ctx: SessionContext, pageId: string): Promise<PublishResult> {
  return withCommandTransaction(async (tx) => {
    const node = await loadNode(tx, ctx, pageId, true)
    if (node === null) return { ok: false, reason: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, pageId)
    if (!can(caps, 'view')) return { ok: false, reason: 'not_found' } as const
    if (!can(caps, 'manage_perm')) return { ok: false, reason: 'forbidden' } as const

    await tx.query(
      `UPDATE public_link SET enabled = false, updated_by = $2, updated_at = now() WHERE node_id = $1 AND enabled`,
      [pageId, ctx.userId],
    )
    const policy = await readSecurityPolicyIn(tx, ctx.workspaceId)
    return { ok: true, value: stateOf(await loadLink(tx, pageId), policy.allowPublish, true) } as const
  })
}
