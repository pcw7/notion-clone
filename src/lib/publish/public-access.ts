/**
 * 공개 경로의 판정 — 토큰으로 여는 페이지 (게시 · 공유 6a-1 · F-06-08 · F-06-07 웹 링크 · F-17-09 · F-06-11)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [정정] 웹 게시 ②③
 *       마스터 §5.3 *"공개 렌더러는 앱 렌더러와 분리된 읽기 전용 SSR. 내부 조회 함수 재사용 금지"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * `SessionContext` 를 만들지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 공개 방문자는 워크스페이스에 들어온 사람이 아니다 — 발급자는 여전히 둘이다(`resolveSessionContext` · `resolveDelegatedContext`).
 * 이 파일은 `effective()` 를 부르지 않고, 앱의 조회 함수도 부르지 않는다. 묻는 것은 정본 ③ 의 조건뿐이다:
 *
 *   토큰 → 게시 루트(`enabled`) · 워크스페이스가 지워지지 않음 · 정책이 허용(런타임 게이트 — 행은 남는다)
 *   → 그 페이지가 루트이거나, 루트에서 그 페이지까지 **상속이 끊기지 않은** 하위 페이지
 *   → 그 페이지의 조상 사슬 전체(루트 위 포함)가 `live` · `restricted` / `taken_down` 이 없음
 *   → 만료 전
 *
 * 어긴 이유는 **만료만** 구별해 돌려준다(06 엣지 *"만료된 링크 → 만료 안내 화면"*). 나머지는 모두 없는 페이지다 — 정책 · 테이크다운 ·
 * 휴지통을 익명에게 구별해 주면 그 주소가 무엇이었는지를 알려 준다.
 */

import { withReadTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { PUBLIC_TOKEN_PATTERN, type AiCrawler, type RobotsDirective } from './public-link.ts'

/** 공개로 열 수 있는 페이지 하나. */
export type PublicTarget = {
  readonly workspaceId: string
  /** 게시 루트 — 토큰이 가리키는 페이지. */
  readonly rootId: string
  /** 열 페이지 — 루트이거나 루트 아래의 공개 하위 페이지. */
  readonly pageId: string
  /** 루트에서 이 페이지까지(양끝 포함) — 공개 화면의 breadcrumb 이 이 안에서만 선다. */
  readonly chain: readonly string[]
  readonly robots: RobotsDirective
  readonly aiCrawler: AiCrawler
}

export type PublicAccessFailure = 'not_found' | 'expired'

export type PublicAccess =
  | { readonly ok: true; readonly value: PublicTarget }
  | { readonly ok: false; readonly reason: PublicAccessFailure }

/** 공개 경로에서 막는 모더레이션 상태(17 — 테이크다운은 서브트리를 덮는다). `reported` 는 아직 열린다(신고만으로 내리지 않는다). */
const BLOCKING_MODERATION: ReadonlySet<string> = new Set(['restricted', 'taken_down'])

type RootRow = {
  node_id: string
  enabled: boolean
  expired: boolean
  robots_directive: RobotsDirective
  ai_crawler: AiCrawler
  workspace_id: string
  workspace_live: boolean
  policy_allows: boolean
}

type ChainRow = { id: string; type: string; lifecycle: string; moderation_state: string; inherits: boolean }

const NOT_FOUND = { ok: false, reason: 'not_found' } as const

/**
 * 토큰과(하위 페이지면) 그 페이지 id 로 공개 페이지를 연다. `pageId` 가 없으면 루트다.
 *
 * 한 스냅샷에서 읽는다 — 정책 · 게시 · 사슬이 같은 시점의 사실이다.
 */
export async function resolvePublicPage(token: string, pageId?: string): Promise<PublicAccess> {
  if (!PUBLIC_TOKEN_PATTERN.test(token) || (pageId !== undefined && !isUuid(pageId))) return NOT_FOUND
  return withReadTransaction((tx) => resolvePublicPageIn(tx, token, pageId))
}

/** `resolvePublicPage` 의 트랜잭션 안쪽 — 공개 화면이 판정과 같은 스냅샷에서 본문을 읽으려고 부른다(`public-read.ts`). */
export async function resolvePublicPageIn(tx: Tx, token: string, pageId?: string): Promise<PublicAccess> {
  if (!PUBLIC_TOKEN_PATTERN.test(token) || (pageId !== undefined && !isUuid(pageId))) return NOT_FOUND
  const root = await tx.queryMaybe<RootRow>(
    `SELECT pl.node_id, pl.enabled,
            (pl.expires_at IS NOT NULL AND pl.expires_at <= now()) AS expired,
            pl.robots_directive, pl.ai_crawler,
            b.workspace_id, (w.deleted_at IS NULL) AS workspace_live,
            coalesce(sp.allow_publish_sites_and_forms, true) AS policy_allows
       FROM public_link pl
       JOIN block b ON b.id = pl.node_id
       JOIN workspace w ON w.id = b.workspace_id
       LEFT JOIN security_policy sp ON sp.workspace_id = b.workspace_id
      WHERE pl.token = $1`,
    [token],
  )
  if (root === null || !root.enabled || !root.workspace_live || !root.policy_allows) return NOT_FOUND

  const targetId = pageId ?? root.node_id
  const chains = await openableChainsIn(tx, root.workspace_id, root.node_id, [targetId])
  const chain = chains.get(targetId)
  if (chain === undefined) return NOT_FOUND

  if (root.expired) return { ok: false, reason: 'expired' } as const
  return {
    ok: true,
    value: {
      workspaceId: root.workspace_id,
      rootId: root.node_id,
      pageId: targetId,
      chain,
      robots: root.robots_directive,
      aiCrawler: root.ai_crawler,
    },
  } as const
}

/**
 * 이 루트의 토큰으로 열 수 있는 페이지 — 하위 페이지 참조 · 페이지 멘션을 링크로 둘지 공개 화면이 묻는다. 루트 자신도 열 수 있다.
 *
 * 조건은 `resolvePublicPage` 의 사슬 조건 그대로다(정본 [정정] 웹 게시 ③ — 루트 아래 · 상속이 끊기지 않음 · 사슬 전체가 `live` ·
 * 제한 · 테이크다운 없음 · 페이지). 게시 · 정책 · 만료는 부르는 쪽이 루트에서 이미 봤다.
 */
export async function openablePagesIn(tx: Tx, workspaceId: string, rootId: string, ids: readonly string[]): Promise<ReadonlySet<string>> {
  return new Set((await openableChainsIn(tx, workspaceId, rootId, ids)).keys())
}

/** 열 수 있는 페이지마다 루트에서 그 페이지까지의 사슬(양끝 포함). 열 수 없는 것은 없다. */
async function openableChainsIn(
  tx: Tx,
  workspaceId: string,
  rootId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const wanted = [...new Set(ids.filter(isUuid))]
  if (wanted.length === 0) return new Map()
  const targets = await tx.query<{ id: string; ancestor_path: string[] }>(
    `SELECT id, ancestor_path FROM block WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
    [wanted, workspaceId],
  )
  const paths = new Map<string, string[]>()
  for (const target of targets) {
    const path = [...target.ancestor_path, target.id]
    if (path.includes(rootId)) paths.set(target.id, path)
  }
  if (paths.size === 0) return new Map()

  const rows = await tx.query<ChainRow>(
    `SELECT b.id, b.type, b.lifecycle, b.moderation_state, coalesce(m.inherits_from_parent, true) AS inherits
       FROM block b LEFT JOIN block_acl_meta m ON m.node_id = b.id
      WHERE b.id = ANY($1::uuid[])`,
    [[...new Set([...paths.values()].flat())]],
  )
  const byId = new Map(rows.map((row) => [row.id, row]))
  const open = new Map<string, readonly string[]>()
  for (const [id, path] of paths) {
    if (chainOpens(path, path.indexOf(rootId), byId)) open.set(id, path.slice(path.indexOf(rootId)))
  }
  return open
}

/** 사슬이 열리는가 — 루트와 끝이 페이지 · 사슬 전체가 `live` · 막는 모더레이션 없음 · 루트 아래에서 상속이 끊기지 않음. */
function chainOpens(path: readonly string[], rootAt: number, byId: ReadonlyMap<string, ChainRow>): boolean {
  for (let at = 0; at < path.length; at += 1) {
    const row = byId.get(path[at]!)
    if (row === undefined) return false
    // 사슬 전체(루트 위 포함) — 휴지통 · 테이크다운은 서브트리를 덮는다
    if (row.lifecycle !== 'live' || BLOCKING_MODERATION.has(row.moderation_state)) return false
    // 루트 아래 — 상속을 끊은 노드부터는 공개가 아니다(06 *"하위에서 상속을 끊어 공개 대상에서 제외"*)
    if (at > rootAt && !row.inherits) return false
  }
  return byId.get(path[rootAt]!)?.type === 'page' && byId.get(path[path.length - 1]!)?.type === 'page'
}
