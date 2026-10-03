/**
 * 페이지 버전 — 목록 · 미리보기 (잔여 묶음 8d-1 · F-11-01 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.7 [보강] 버전 기록 ④⑤ · 11-history-notifications.md F-11-01
 *
 * **누가** — 그 페이지를 고칠 수 있는 사람(`edit_content` · F-11-01 *"`Can edit` 이상"*). 볼 수만 있으면 `forbidden`, 볼 수 없으면
 * `not_found`(존재를 알리지 않는다). 잠긴 페이지도 기록은 본다 — 읽기다(복원이 잠금을 묻는다 · 8d-3).
 *
 * **목록**은 열 때 버전 판정을 한 번 한다(`openBodyDoc` 의 `versionIntent: 'list'` — 마지막 편집 뒤에 아무도 쓰지 않아도 끝난 세션이 선다 ·
 * `record.ts` 머리말). 보관 기간이 지난 버전은 서지 않는다. 버전의 바이트(`state_ref`)는 읽지 않는다 — 0007 의 목록 인덱스가 그 까닭이다.
 *
 * **미리보기**는 그 버전의 바이트를 읽어 본문으로 정규화해 준다(`readBodyYDoc`). 하위 페이지 · 멘션의 이름과 아이콘은 **지금의 권한으로
 * 거른 맵**이다(본문과 같은 규칙 — 옛 버전이 지금 볼 수 없는 페이지를 가리킬 수 있다 · §3.2-22). 지난 버전은 `expired`.
 */

import * as Y from 'yjs'

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { isLocked } from '../permissions/lock.ts'
import { openBodyDoc } from '../collab/doc-store.ts'
import { readBodyYDoc } from '../collab/ydoc.ts'
import { loadMentionLabels, mentionIdsOf, type MentionLabels } from '../block/mention-candidates.ts'
import { PAGE_TYPE } from '../block/types.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { isUuid } from '../ids.ts'
import { fileStorage } from '../file/storage.ts'

/** 목록의 상한 — 그보다 오래된 버전은 아직 볼 길이 없다(§7). */
export const MAX_VERSION_LIST = 200

export type VersionReason = 'interval' | 'idle' | 'pre_restore' | 'manual' | 'external_sync'

export type VersionSummary = {
  readonly id: string
  /** 담은 내용의 시각 — 마지막 편집 때(정본 ③). */
  readonly createdAt: string
  readonly reason: VersionReason
  /** 이 버전의 구간에서 고친 사람(이름순). 옮긴 내용 · 시스템만 있으면 비어 있다. */
  readonly editors: readonly { readonly id: string; readonly name: string }[]
  /** 복원으로 만든 버전이면 그 대상(8d-3). */
  readonly restoredFrom: string | null
}

export type VersionFailure = 'not_found' | 'forbidden' | 'expired'

export type VersionList = {
  readonly versions: readonly VersionSummary[]
  /** 이 사람이 지금 되돌릴 수 있는가 — 고칠 수 있고 잠기지 않았다(8d-3 · 표시 전용 · 복원이 다시 묻는다). */
  readonly canRestore: boolean
}

export type VersionResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: VersionFailure }

export type VersionPreview = {
  readonly version: VersionSummary
  readonly doc: EditorDoc
  /** 본문의 하위 페이지 · 멘션이 그릴 이름과 아이콘 — 지금의 권한으로 거른 것(본문의 `loadMentionLabels` 와 같은 모양). */
  readonly labels: MentionLabels
}

type VersionRow = {
  id: string
  created_at: Date
  reason: VersionReason
  editor_ids: string[]
  restored_from: string | null
}

/** 볼 수 없으면 not_found · 고칠 수 없으면 forbidden · 아니면 null. 살아 있는 페이지만. */
async function gate(tx: Tx, ctx: SessionContext, pageId: string): Promise<'not_found' | 'forbidden' | null> {
  if (!isUuid(pageId)) return 'not_found'
  const page = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = $3 AND lifecycle = 'live'`,
    [pageId, ctx.workspaceId, PAGE_TYPE],
  )
  if (page === null) return 'not_found'
  const caps = await effectiveCaps(tx, ctx, pageId)
  if (!can(caps, 'view')) return 'not_found'
  if (!can(caps, 'edit_content')) return 'forbidden'
  return null
}

async function summaries(tx: Tx, rows: readonly VersionRow[]): Promise<VersionSummary[]> {
  const ids = [...new Set(rows.flatMap((r) => r.editor_ids))]
  const names = new Map<string, string>()
  if (ids.length > 0) {
    for (const u of await tx.query<{ id: string; name: string }>(`SELECT id, name FROM "user" WHERE id = ANY($1::uuid[])`, [ids])) {
      names.set(u.id, u.name)
    }
  }
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at.toISOString(),
    reason: r.reason,
    editors: r.editor_ids
      .map((id) => ({ id, name: names.get(id) ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id)),
    restoredFrom: r.restored_from,
  }))
}

/** 이 사람이 이 페이지의 기록을 볼 수 있는가 — 화면이 "기록" 단추를 세울지 정한다(표시 전용 · 라우트가 다시 묻는다). */
export async function canViewPageHistory(ctx: SessionContext, pageId: string): Promise<boolean> {
  return withReadTransaction(async (tx) => (await gate(tx, ctx, pageId)) === null)
}

/** 이 페이지의 버전 — 최신순 · 보관 기간 안의 것만. 열 때 버전 판정을 한 번 한다(머리말). */
export async function listVersions(ctx: SessionContext, pageId: string): Promise<VersionResult<VersionList>> {
  return withTransaction(async (tx) => {
    const refused = await gate(tx, ctx, pageId)
    if (refused !== null) return { ok: false, reason: refused } as const
    // 세션을 열면 그 페이지를 잠그고 판정한다 — 쌓지 않는다(바꾼 것이 없다).
    await openBodyDoc(tx, ctx, pageId, { versionIntent: 'list' })
    const rows = await tx.query<VersionRow>(
      `SELECT id, created_at, reason, editor_ids, restored_from FROM page_version
        WHERE page_id = $1 AND expires_at > now()
        ORDER BY through_seq DESC
        LIMIT $2`,
      [pageId, MAX_VERSION_LIST],
    )
    // 기록은 잠긴 페이지도 보지만(머리말) 되돌리기는 잠금을 묻는다(`restore.ts`).
    return { ok: true, value: { versions: await summaries(tx, rows), canRestore: !(await isLocked(tx, pageId)) } } as const
  })
}

/** 버전 하나를 본문으로 — 읽기 전용 미리보기. */
export async function readVersion(ctx: SessionContext, pageId: string, versionId: string): Promise<VersionResult<VersionPreview>> {
  const found = await withReadTransaction(async (tx) => {
    const refused = await gate(tx, ctx, pageId)
    if (refused !== null) return { ok: false, reason: refused } as const
    if (!isUuid(versionId)) return { ok: false, reason: 'not_found' } as const
    const row = await tx.queryMaybe<VersionRow & { state_ref: string; expired: boolean }>(
      `SELECT id, created_at, reason, editor_ids, restored_from, state_ref, expires_at <= now() AS expired
         FROM page_version WHERE id = $1 AND page_id = $2`,
      [versionId, pageId],
    )
    if (row === null) return { ok: false, reason: 'not_found' } as const
    if (row.expired) return { ok: false, reason: 'expired' } as const
    const [summary] = await summaries(tx, [row])
    return { ok: true, value: { summary, stateRef: row.state_ref } } as const
  })
  if (!found.ok) return found

  const bytes = await fileStorage().read(found.value.stateRef)
  // 행은 있는데 바이트가 없다 — 저장 폴더를 지웠거나 쓰다 끊긴 흔적이다. 빈 본문을 보여주면 "그때는 비어 있었다"로 읽힌다.
  if (bytes === null) return { ok: false, reason: 'not_found' }
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, bytes)
  const doc = readBodyYDoc(ydoc, pageId).doc
  ydoc.destroy()

  const ids = mentionIdsOf(doc)
  const labels = await loadMentionLabels(ctx, { userIds: ids.userIds, pageIds: [...ids.pageIds, ...pageRefIdsOf(doc.blocks)] })
  return { ok: true, value: { version: found.value.summary, doc, labels } }
}

/** 본문의 하위 페이지 참조 id — 그 블록의 id 가 곧 그 페이지다. */
function pageRefIdsOf(blocks: readonly EditorBlock[]): string[] {
  const out: string[] = []
  for (const block of blocks) {
    if (block.type === PAGE_TYPE) out.push(block.id)
    if (block.children !== undefined) out.push(...pageRefIdsOf(block.children))
  }
  return out
}
