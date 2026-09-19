/**
 * 멘션의 역인덱스 — `link_edge` 를 투영한다 (F-07-08 · F-07-09 · F-05-09 · 코멘트 5a조각)
 *
 * 정본: 00-canonical-data-model.md §3.9 `[추가] link_edge`(불변식 L1~L3) · 판결 X-1
 *
 * ──────────────────────────────────────────────────────────────────────
 * 프로젝터가 쓴다 — 편집기가 아니다 (L1)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 마스터 문서 §5.2 는 *"에디터가 mention 노드를 만들 때 역인덱스를 함께 기록한다"* 고 했지만, 정본 X-1 이 이긴다.
 * 본문의 정본은 Y.Doc 이고 행은 그 투영이다. 에디터가 따로 기록하면 진실이 둘이 된다 — 동시 편집으로 멘션이
 * 지워졌는데 행이 남거나, 오프라인에서 넣은 멘션은 행이 없다. 그래서 `block` 행 · `search_document` 와 **같은 자리**
 * (`save-page-body.ts` `projectRows`)에서 같은 트랜잭션으로 쓴다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 차분으로 쓴다 — 새로 생긴 사람 멘션이 곧 알림 대상이다 (L3)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 페이지의 edge 를 통째로 지우고 다시 넣으면 "새로 생긴 멘션"을 가려낼 수 없어 투영마다 같은 사람에게 알림이 간다.
 * 지금 edge 와 문서의 멘션을 비교해 넣을 것과 지울 것만 쓴다.
 *
 * 알림은 **(페이지, 사람) 이 이 투영에서 처음 생길 때** 한 번이다. 이미 다른 블록에서 멘션돼 있던 사람을 한 블록 더
 * 멘션해도 다시 알리지 않는다 — 05 F-05-09 의 dedupe("한 문단에 같은 사람 5번 멘션 → 알림 1건")를 페이지 단위로 넓혔다.
 * 그 사람의 멘션이 전부 지워졌다가 다시 생기면 그때는 다시 알린다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { mentionTarget, type MentionTarget } from '../contracts/rich-text.ts'
import type { Tx } from '../db/tx.ts'
import { readableScopes } from '../permissions/effective.ts'
import { plainTitleOf, readTitle } from './page.ts'

export type LinkEdgeDelta = {
  readonly inserted: number
  readonly deleted: number
  /** 이 투영에서 이 페이지에 **처음** 멘션된 사람들 — 알림 대상. */
  readonly newUserIds: readonly string[]
  /** 그 멘션이 든 블록 중 하나 — 알림이 미리보기로 쓴다. */
  readonly firstBlockId: string | null
}

type EdgeRow = { source_block_id: string; target_kind: string; target_id: string }

const keyOf = (blockId: string, target: MentionTarget): string => `${blockId}|${target.kind}|${target.id}`

/** 투영된 블록들의 멘션 — (블록, 대상) 쌍. 제목 런을 관대하게 읽는다(`readTitle`). */
export function mentionsOf(
  blocks: readonly { readonly id: string; readonly properties: Record<string, unknown> | null }[],
): { blockId: string; target: MentionTarget }[] {
  const out: { blockId: string; target: MentionTarget }[] = []
  const seen = new Set<string>()
  for (const block of blocks) {
    for (const run of readTitle(block.properties as { title?: unknown } | null)) {
      const target = mentionTarget(run)
      if (target === null) continue
      const key = keyOf(block.id, target)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ blockId: block.id, target })
    }
  }
  return out
}

/**
 * 이 페이지의 `link_edge` 를 문서에 맞춘다. 호출자의 트랜잭션 안에서 — 행 투영과 함께 커밋된다.
 *
 * @param blocks 방금 투영한 블록들(`projection.blocks`) — 문서 순서. DB 를 다시 읽지 않는다(색인과 같은 이유).
 */
export async function projectLinkEdges(
  tx: Tx,
  pageId: string,
  blocks: readonly { readonly id: string; readonly properties: Record<string, unknown> | null }[],
): Promise<LinkEdgeDelta> {
  const current = await tx.query<EdgeRow>(
    `SELECT source_block_id, target_kind, target_id FROM link_edge WHERE source_page_id = $1`,
    [pageId],
  )
  const have = new Map<string, EdgeRow>()
  const usersBefore = new Set<string>()
  for (const row of current) {
    have.set(`${row.source_block_id}|${row.target_kind}|${row.target_id}`, row)
    if (row.target_kind === 'user') usersBefore.add(row.target_id)
  }

  const wanted = mentionsOf(blocks)
  const wantedKeys = new Set(wanted.map((m) => keyOf(m.blockId, m.target)))

  const toInsert = wanted.filter((m) => !have.has(keyOf(m.blockId, m.target)))
  const toDelete = current.filter((row) => !wantedKeys.has(`${row.source_block_id}|${row.target_kind}|${row.target_id}`))

  for (const row of toDelete) {
    await tx.query(
      `DELETE FROM link_edge WHERE source_block_id = $1 AND target_kind = $2 AND target_id = $3`,
      [row.source_block_id, row.target_kind, row.target_id],
    )
  }
  for (const m of toInsert) {
    await tx.query(
      `INSERT INTO link_edge (source_page_id, source_block_id, target_kind, target_id, created_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (source_block_id, target_kind, target_id) DO NOTHING`,
      [pageId, m.blockId, m.target.kind, m.target.id],
    )
  }

  const newUserIds: string[] = []
  let firstBlockId: string | null = null
  for (const m of toInsert) {
    if (m.target.kind !== 'user' || usersBefore.has(m.target.id) || newUserIds.includes(m.target.id)) continue
    newUserIds.push(m.target.id)
    firstBlockId ??= m.blockId
  }
  return { inserted: toInsert.length, deleted: toDelete.length, newUserIds, firstBlockId }
}

export type Backlink = { readonly pageId: string; readonly title: string }

/**
 * 이 페이지를 멘션한 페이지들(F-07-09) — **볼 수 있는 것만**, 제목은 지금 것.
 *
 * 권한은 사이드바 · 검색과 같은 규칙으로 쿼리 안에서 거른다(`perm_scope_id = ANY(readableScopes)` · §3.3-32). 볼 수 없는
 * 페이지는 개수에도 들어가지 않는다 — 07 F-07-09 의 "`Private` 로 라벨링" 은 존재를 알리는 것이라 하지 않는다(§3.2-22 와
 * 같은 이유). 자기 자신은 뺀다(같은 문서의 엣지 표). 한 페이지가 여러 번 멘션해도 한 줄이다.
 */
export async function listBacklinks(tx: Tx, ctx: SessionContext, pageId: string): Promise<Backlink[]> {
  const scopes = await readableScopes(tx, ctx)
  if (scopes.length === 0) return []
  const rows = await tx.query<{ id: string; properties: { title?: unknown } }>(
    `SELECT DISTINCT b.id, b.properties, b.last_edited_at
       FROM link_edge e
       JOIN block b ON b.id = e.source_page_id
      WHERE e.target_kind = 'page' AND e.target_id = $1 AND e.source_page_id <> $1
        AND b.workspace_id = $2 AND b.type = 'page' AND b.lifecycle = 'live'
        AND b.perm_scope_id = ANY($3::uuid[])
      ORDER BY b.last_edited_at DESC, b.id`,
    [pageId, ctx.workspaceId, scopes],
  )
  return rows.map((r) => ({ pageId: r.id, title: plainTitleOf(r.properties) }))
}
