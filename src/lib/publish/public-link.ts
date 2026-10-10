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
 *
 * 6a-3 — 공유 패널이 쓰는 둘을 더했다: 검색 엔진 노출(`robots_directive`)과 주소 바꾸기(토큰을 새로 — 옛 주소는 곧바로 닫힌다). AI 크롤러
 * 칸은 열지 않는다(정본 [보강] 공개 화면 ⑥ — robots.txt 가 링크마다 열 수 없다). 게시 상태는 **위 페이지의 게시로 공개되었는가**도
 * 말한다(`coveredBy` — 하위 페이지는 함께 공개된다는 것을 그 페이지의 공유 패널에서도 보여야 한다).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { plainTitleOf } from '../block/page.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { readSecurityPolicyIn } from '../workspace/security-policy.ts'
import { openablePagesIn } from './public-access.ts'
import { isRobotsDirective, newPublicToken, type AiCrawler, type RobotsDirective } from './public-token.ts'

export { newPublicToken, PUBLIC_TOKEN_PATTERN, type AiCrawler, type RobotsDirective } from './public-token.ts'

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
  /**
   * 위 페이지의 게시로 이 페이지도 공개되어 있으면 그 페이지(가장 가까운 것) — 그 페이지를 볼 수 있는 사람에게만 id · 제목(볼 수 없으면
   * 둘 다 null — 공개되어 있다는 사실만). 아니면 null. 정책이 막았거나 만료된 게시는 덮지 않는다.
   */
  readonly coveredBy: { readonly pageId: string | null; readonly title: string | null } | null
  /**
   * 운영자가 이 페이지(또는 위 페이지)의 공개를 내렸는가(6b-2 — 정본 [보강] 모더레이션 조치 ⑤). 내려졌으면 게시해도 열리지 않고 다시
   * 게시는 거부된다(`moderated`). 신고만 된 것(`reported`)은 말하지 않는다 — 신고는 소유자에게 알리지 않는다(신고자 보호).
   */
  readonly moderation: 'taken_down' | 'restricted' | null
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
  /** 게시되어 있지 않다 — 설정 · 주소 바꾸기는 게시된 링크에만(6a-3). */
  | 'not_published'
  /** 바꿀 것이 없거나 값이 틀렸다(6a-3 — `{ robots?: 'index' | 'noindex', rotateToken?: true }`). */
  | 'invalid_input'
  /** 운영자가 이 페이지(또는 위 페이지)의 공개를 내렸다(6b-2) — 다시 게시해 우회할 수 없다. */
  | 'moderated'

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
    case 'invalid_input':
      return 400
    case 'policy_disabled':
    case 'not_published':
    case 'moderated':
      return 409
  }
}

type NodeRow = { id: string; type: string; lifecycle: string; ancestor_path: string[] }
type LinkRow = { enabled: boolean; token: string | null; robots_directive: RobotsDirective; ai_crawler: AiCrawler; expires_at: Date | null }

/** 이 워크스페이스의 페이지 · 데이터베이스 노드. `lock` 이면 행을 잡는다 — 휴지통 · 이동과 줄을 세운다. */
async function loadNode(tx: Tx, ctx: SessionContext, nodeId: string, lock: boolean): Promise<NodeRow | null> {
  if (!isUuid(nodeId)) return null
  return tx.queryMaybe<NodeRow>(
    `SELECT id, type, lifecycle, ancestor_path FROM block
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

/**
 * 이 페이지를 덮는 위 페이지의 게시 — 가장 가까운 것부터. 판정은 공개 경로와 같은 함수다(`openablePagesIn` — 상속 절단 · 휴지통 ·
 * 테이크다운). 정책이 막았으면 아무것도 덮지 않는다.
 */
async function coveredByIn(
  tx: Tx,
  ctx: SessionContext,
  node: NodeRow,
  policyAllows: boolean,
): Promise<PublishState['coveredBy']> {
  if (!policyAllows || node.ancestor_path.length === 0) return null
  const roots = await tx.query<{ node_id: string }>(
    `SELECT node_id FROM public_link
      WHERE node_id = ANY($1::uuid[]) AND enabled AND (expires_at IS NULL OR expires_at > now())`,
    [node.ancestor_path],
  )
  const published = new Set(roots.map((r) => r.node_id))
  for (let at = node.ancestor_path.length - 1; at >= 0; at -= 1) {
    const rootId = node.ancestor_path[at]!
    if (!published.has(rootId)) continue
    if (!(await openablePagesIn(tx, ctx.workspaceId, rootId, [node.id])).has(node.id)) continue
    if (!can(await effectiveCaps(tx, ctx, rootId), 'view')) return { pageId: null, title: null }
    const row = await tx.queryOne<{ properties: Record<string, unknown> | null }>(`SELECT properties FROM block WHERE id = $1`, [rootId])
    return { pageId: rootId, title: plainTitleOf(row.properties) }
  }
  return null
}

/** 이 페이지와 위 페이지들 중 운영자가 내린 것 — 공개 경로의 사슬과 같다(테이크다운은 서브트리를 덮는다). `taken_down` 이 먼저다. */
async function moderationIn(tx: Tx, node: NodeRow): Promise<PublishState['moderation']> {
  const rows = await tx.query<{ moderation_state: string }>(
    `SELECT moderation_state FROM block WHERE id = ANY($1::uuid[]) AND moderation_state IN ('taken_down', 'restricted')`,
    [[...node.ancestor_path, node.id]],
  )
  if (rows.some((r) => r.moderation_state === 'taken_down')) return 'taken_down'
  return rows.length > 0 ? 'restricted' : null
}

async function stateIn(
  tx: Tx,
  ctx: SessionContext,
  node: NodeRow,
  link: LinkRow | null,
  policyAllows: boolean,
  canManage: boolean,
): Promise<PublishState> {
  return {
    ...stateOf(link, policyAllows, canManage),
    coveredBy: await coveredByIn(tx, ctx, node, policyAllows),
    moderation: await moderationIn(tx, node),
  }
}

function stateOf(link: LinkRow | null, policyAllows: boolean, canManage: boolean): Omit<PublishState, 'coveredBy' | 'moderation'> {
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
    return { ok: true, value: await stateIn(tx, ctx, node, await loadLink(tx, pageId), policy.allowPublish, can(caps, 'manage_perm')) } as const
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
    // 운영자가 내린 페이지 — 해제 · 다시 게시로 우회하지 못한다(상태는 블록에 있다 · 정본 [보강] 모더레이션 조치 ⑤)
    if ((await moderationIn(tx, node)) !== null) return { ok: false, reason: 'moderated' } as const

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
    return { ok: true, value: await stateIn(tx, ctx, node, link, true, true) } as const
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
    return { ok: true, value: await stateIn(tx, ctx, node, await loadLink(tx, pageId), policy.allowPublish, true) } as const
  })
}

/**
 * 게시된 링크의 설정을 바꾼다(6a-3) — `{ robots?: 'index' | 'noindex', rotateToken?: true }`.
 *
 *   · `robots` — 검색 엔진 노출(정본 [정정] 웹 게시 ① — 기본 `noindex`). 공개 화면의 meta · 파일의 `X-Robots-Tag` 가 따른다
 *   · `rotateToken` — 주소를 새로 만든다. **옛 주소는 곧바로 닫힌다**(정본 ⑤ — 해제와 다시 게시는 같은 주소다. 주소를 버리는 것은 이것)
 *
 * 누가: 게시하는 사람과 같다(`manage_perm`). 게시된 링크에만 — 아니면 `not_published`. 정책 · 휴지통과 무관하다(끄고 좁히는 쪽이다).
 */
export async function updatePublicLink(ctx: SessionContext, pageId: string, patch: unknown): Promise<PublishResult> {
  const input = parsePatch(patch)
  if (input === null) return { ok: false, reason: 'invalid_input' }
  return withCommandTransaction(async (tx) => {
    const node = await loadNode(tx, ctx, pageId, true)
    if (node === null) return { ok: false, reason: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, pageId)
    if (!can(caps, 'view')) return { ok: false, reason: 'not_found' } as const
    if (!can(caps, 'manage_perm')) return { ok: false, reason: 'forbidden' } as const

    const link = await tx.queryMaybe<LinkRow>(
      `UPDATE public_link
          SET robots_directive = coalesce($2, robots_directive),
              token = CASE WHEN $3 THEN $4 ELSE token END,
              updated_by = $5, updated_at = now()
        WHERE node_id = $1 AND enabled
        RETURNING enabled, token, robots_directive, ai_crawler, expires_at`,
      [pageId, input.robots ?? null, input.rotateToken, newPublicToken(), ctx.userId],
    )
    if (link === null) return { ok: false, reason: 'not_published' } as const
    const policy = await readSecurityPolicyIn(tx, ctx.workspaceId)
    return { ok: true, value: await stateIn(tx, ctx, node, link, policy.allowPublish, true) } as const
  })
}

function parsePatch(raw: unknown): { robots?: RobotsDirective; rotateToken: boolean } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { robots, rotateToken, ...rest } = raw as { robots?: unknown; rotateToken?: unknown }
  if (Object.keys(rest).length > 0) return null
  if (robots !== undefined && !isRobotsDirective(robots)) return null
  if (rotateToken !== undefined && rotateToken !== true) return null
  if (robots === undefined && rotateToken === undefined) return null
  return { ...(robots === undefined ? {} : { robots }), rotateToken: rotateToken === true }
}
