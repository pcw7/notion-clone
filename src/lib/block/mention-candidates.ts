/**
 * `@` 자동완성의 후보와, 멘션 노드가 그릴 이름 — 둘 다 **권한으로 거른다** (F-07-08 · 코멘트 5b조각)
 *
 * 정본: 07-search-navigation.md F-07-08 — *"권한 없는 페이지 → 자동완성 후보에서 제외 (대표적 권한 누출 지점)"*,
 *       *"자동완성 전용 경량 엔드포인트 … 제목 인덱스만 조회"*, *"후보 조회는 반드시 상한(예: 20건)"*
 *       05-collaboration-sync.md F-05-09 — *"멘션된 페이지에 내가 접근 불가 → 제목 노출은 정보 누출 → 마스킹"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 후보 — 제목 색인에서, 검색과 같은 권한 규칙으로
 * ──────────────────────────────────────────────────────────────────────
 *
 * 페이지 후보는 `search_document.title_text` 에서 찾는다(본문은 보지 않는다 — 07: *"검색 대상은 페이지 제목"*).
 * 권한은 검색 · 사이드바와 같은 규칙으로 **쿼리 안에서** 거른다(`perm_scope_id = ANY(readableScopes)` · §3.3-32) —
 * 후처리로 거르면 상한 20건이 권한으로 빠진 만큼 줄고, 무엇보다 한 곳만 잊으면 제목이 샌다.
 *
 * 사람 후보는 워크스페이스 멤버 목록이다(`listMembers` — 나간 사람은 빠진다). 이름 · 이메일 부분 일치.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이름 맵 — 노드에는 id 뿐이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 멘션 노드는 표시 텍스트를 싣지 않는다(정본 §3.9 `link_edge` 절). 그리는 쪽이 이 맵에서 읽는다 — 하위 페이지 참조의
 * 제목(`pageRefTitles`)과 같은 규칙, 같은 이유(§3.2-22).
 *
 *   · 사람: 이 워크스페이스의 멤버였던 사람이면 이름(나간 사람도 — 05: *"칩 유지, 비활성 사용자로 표시"*). 아니면 null
 *   · 페이지: 볼 수 있는 살아 있는 페이지면 제목. **볼 수 없거나 없거나 휴지통이면 전부 null** — 셋을 가르면 볼 수 없는
 *     페이지가 "있다"는 것을 알려주게 된다. 07 의 "삭제된 페이지" 표시는 그래서 하지 않는다
 */

import type { SessionContext } from '../auth/session-context.ts'
import { mentionTarget } from '../contracts/rich-text.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { isUuid } from '../ids.ts'
import { readableScopes } from '../permissions/effective.ts'
import { listMembers } from '../workspace/list.ts'
import { plainTitleOf } from './page.ts'

/** 07 F-07-08: "후보 조회는 반드시 상한(예: 20건)". */
export const MENTION_CANDIDATE_LIMIT = 20
/** 한 번에 물을 수 있는 id 수 — 본문 하나의 멘션이 이보다 많으면 나머지는 다음 요청이다. */
export const MENTION_LABEL_LIMIT = 200

export type MentionCandidate = {
  readonly kind: 'user' | 'page'
  readonly id: string
  readonly label: string
}

/** `%` · `_` · `\` 를 이스케이프한 부분 일치 패턴. 사용자 입력이 패턴 문법으로 읽히지 않게 한다. */
function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/**
 * `@` 뒤의 쿼리로 후보를 찾는다. 빈 쿼리면 사람 전부(상한까지)와 최근 고친 페이지다 — 07: *"최근 항목이 기본 노출"*.
 */
export async function searchMentionCandidates(
  ctx: SessionContext,
  rawQuery: string,
  limit = MENTION_CANDIDATE_LIMIT,
): Promise<MentionCandidate[]> {
  const query = rawQuery.trim().toLowerCase()
  const cap = Math.min(Math.max(limit, 1), MENTION_CANDIDATE_LIMIT)

  const members = (await listMembers(ctx.workspaceId))
    .filter((m) => query === '' || m.name.toLowerCase().includes(query) || (m.email ?? '').toLowerCase().includes(query))
    .slice(0, cap)
    .map((m): MentionCandidate => ({ kind: 'user', id: m.userId, label: m.name }))

  const pages = await withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return []
    const rows = await tx.query<{ doc_id: string; title_text: string | null }>(
      `SELECT s.doc_id, s.title_text
         FROM search_document s
        WHERE s.workspace_id = $1
          AND s.perm_scope_id = ANY($2::uuid[])   -- ★ 권한. 후처리가 아니다
          AND s.in_trash = false
          AND ($3 = '' OR s.title_text ILIKE $4)
        ORDER BY coalesce(s.last_edited_at, s.created_at, 'epoch'::timestamptz) DESC, s.doc_id
        LIMIT $5`,
      [ctx.workspaceId, scopes, query, containsPattern(query), cap],
    )
    return rows.map((r): MentionCandidate => ({ kind: 'page', id: r.doc_id, label: r.title_text ?? '' }))
  })

  // 07: `@` 는 사람 우선이다("사람, 페이지, 날짜 … `@`는 사람 우선").
  return [...members, ...pages].slice(0, cap)
}

export type MentionLabels = {
  /** 사용자 id → 이름. 멤버였던 적이 없으면 null. */
  readonly users: Readonly<Record<string, string | null>>
  /** 페이지 id → 제목. 볼 수 없거나 없거나 휴지통이면 null(가르지 않는다). */
  readonly pages: Readonly<Record<string, string | null>>
}

/** 본문에 나오는 사람 · 페이지 멘션의 id — 그릴 이름을 물을 때 쓴다. */
export function mentionIdsOf(doc: EditorDoc): { userIds: string[]; pageIds: string[] } {
  const users = new Set<string>()
  const pages = new Set<string>()
  const walk = (blocks: readonly EditorBlock[]): void => {
    for (const block of blocks) {
      for (const run of block.title) {
        const target = mentionTarget(run)
        if (target === null) continue
        ;(target.kind === 'user' ? users : pages).add(target.id)
      }
      if (block.children !== undefined) walk(block.children)
    }
  }
  walk(doc.blocks)
  return { userIds: [...users], pageIds: [...pages] }
}

export async function loadMentionLabels(
  ctx: SessionContext,
  ids: { readonly userIds: readonly string[]; readonly pageIds: readonly string[] },
): Promise<MentionLabels> {
  const userIds = [...new Set(ids.userIds.filter(isUuid))].slice(0, MENTION_LABEL_LIMIT)
  const pageIds = [...new Set(ids.pageIds.filter(isUuid))].slice(0, MENTION_LABEL_LIMIT)
  return withReadTransaction(async (tx) => ({
    users: await userLabels(tx, ctx, userIds),
    pages: await pageLabels(tx, ctx, pageIds),
  }))
}

async function userLabels(tx: Tx, ctx: SessionContext, ids: readonly string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = Object.fromEntries(ids.map((id) => [id, null]))
  if (ids.length === 0) return out
  // 나간 사람(status = removed)도 이름을 준다 — 칩은 남고 "비활성"으로 그린다(05 F-05-09). 멤버였던 적이 없으면 null.
  const rows = await tx.query<{ user_id: string; name: string }>(
    `SELECT m.user_id, u.name FROM workspace_member m JOIN "user" u ON u.id = m.user_id
      WHERE m.workspace_id = $1 AND m.user_id = ANY($2::uuid[])`,
    [ctx.workspaceId, ids],
  )
  for (const r of rows) out[r.user_id] = r.name
  return out
}

async function pageLabels(tx: Tx, ctx: SessionContext, ids: readonly string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = Object.fromEntries(ids.map((id) => [id, null]))
  if (ids.length === 0) return out
  const scopes = await readableScopes(tx, ctx)
  if (scopes.length === 0) return out
  const rows = await tx.query<{ id: string; properties: { title?: unknown } }>(
    `SELECT id, properties FROM block
      WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND type IN ('page', 'database')
        AND lifecycle = 'live' AND perm_scope_id = ANY($3::uuid[])`,
    [ids, ctx.workspaceId, scopes],
  )
  for (const r of rows) out[r.id] = plainTitleOf(r.properties)
  return out
}
