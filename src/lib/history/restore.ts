/**
 * 버전 복원 — 앞으로 쓰는 되돌리기 (잔여 묶음 8d-3 · F-11-02 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.7 불변식 S4 · [보강] 복원 ①~⑦
 *       11-history-notifications.md F-11-02 *"복원은 파괴적 rollback 이 아니라 forward write 다"*
 *
 * 한 트랜잭션 — 본문 저장과 같은 잠금(페이지 행 → 스냅샷)으로 줄을 선다:
 *
 *   ① 그 페이지 행을 잠그고 권한 · 잠금 · 버전을 본다
 *   ② 본문 세션을 `origin='restore'` 로 연다 — 여는 순간의 버전 판정(쉼 · 주기)이 먼저 돈다(`record.ts`)
 *   ③ 대상 버전의 본문을 **하위 페이지 규칙으로 고쳐**(정본 ③) 갈아 끼운다. 바뀐 것이 없으면 여기서 끝난다(아무것도 쓰지 않는다)
 *   ④ 지금 상태를 담은 버전이 없으면 `pre_restore` 로 남긴다 — 있으면(②가 방금 쉼 버전을 남겼다) 그것이 되돌리기 전의 상태다
 *   ⑤ 갈아 끼운 본문을 투영하고 쌓는다 — 행위자는 되돌린 사람 · **멘션 알림은 없다**(정본 ⑤)
 *   ⑥ 그 상태를 `restore` 버전(`restored_from` = 대상)으로 남긴다
 *
 * 열린 편집기들은 협업 서버가 쌓인 update 를 퍼뜨려 따라온다(커밋 신호 · CRDT 5c) — 복원은 그 페이지의 다른 쓰기와 같은 한 update 다
 * (F-11-02 엣지 *"서버에서 계산 후 단일 update 로 브로드캐스트"*).
 */

import * as Y from 'yjs'

import type { SessionContext } from '../auth/session-context.ts'
import { withTransaction } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { isLocked } from '../permissions/lock.ts'
import { openPageBody } from '../block/body-write.ts'
import { readBodyScope } from '../block/save-page-body.ts'
import { PAGE_TYPE } from '../block/types.ts'
import { readBodyYDoc } from '../collab/ydoc.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import { wrapUnknownTypes, type EditorBlock, type EditorDoc } from '../editor/document.ts'
import { fileStorage } from '../file/storage.ts'
import { isUuid } from '../ids.ts'
import { recordVersion } from './record.ts'

export type RestoreFailure =
  | 'not_found'
  | 'forbidden'
  /** 잠긴 페이지 — 풀어야 되돌린다(F-11-02 *"잠금 해제 전 복원 차단"*). */
  | 'locked'
  /** 보관 기간이 지난 버전. */
  | 'expired'
  /** 고친 본문을 투영이 받지 않았다 — 하위 페이지 참조가 깊이 상한을 넘는 자리에 있다(§3.2-23). */
  | 'conflict'

export type RestoreOutcome = {
  /** 지금 본문과 같았다 — 아무것도 쓰지 않았다(새 버전도 없다). */
  readonly noop: boolean
  /** 되돌리기 전의 상태를 담은 버전 — 되돌리기 취소는 이것을 다시 되돌린다(정본 ⑦). */
  readonly beforeVersionId: string | null
  /** 되돌린 뒤의 상태(`restore` 버전). */
  readonly restoredVersionId: string | null
}

export type RestoreResult = { readonly ok: true; readonly value: RestoreOutcome } | { readonly ok: false; readonly reason: RestoreFailure }

const NOOP: RestoreOutcome = { noop: true, beforeVersionId: null, restoredVersionId: null }

export async function restoreVersion(ctx: SessionContext, pageId: string, versionId: string): Promise<RestoreResult> {
  if (!isUuid(pageId) || !isUuid(versionId)) return { ok: false, reason: 'not_found' }

  return withTransaction(async (tx) => {
    // ① 본문 저장과 같은 잠금 — 그 페이지의 다른 쓰기와 줄을 선다.
    const page = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = $3 AND lifecycle = 'live' FOR UPDATE`,
      [pageId, ctx.workspaceId, PAGE_TYPE],
    )
    if (page === null) return { ok: false, reason: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, pageId)
    if (!can(caps, 'view')) return { ok: false, reason: 'not_found' } as const
    if (!can(caps, 'edit_content')) return { ok: false, reason: 'forbidden' } as const
    if (await isLocked(tx, pageId)) return { ok: false, reason: 'locked' } as const

    const version = await tx.queryMaybe<{ state_ref: string; expired: boolean }>(
      `SELECT state_ref, expires_at <= now() AS expired FROM page_version WHERE id = $1 AND page_id = $2`,
      [versionId, pageId],
    )
    if (version === null) return { ok: false, reason: 'not_found' } as const
    if (version.expired) return { ok: false, reason: 'expired' } as const
    const bytes = await fileStorage().read(version.state_ref)
    // 바이트가 없으면 되돌릴 내용을 모른다 — 빈 본문으로 되돌리지 않는다.
    if (bytes === null) return { ok: false, reason: 'not_found' } as const
    const old = new Y.Doc()
    Y.applyUpdate(old, bytes)
    const target = readBodyYDoc(old, pageId).doc
    old.destroy()

    // ② 여는 순간의 버전 판정이 먼저 돈다.
    const body = await openPageBody(tx, ctx, pageId, 'restore')
    const scope = await readBodyScope(tx, ctx, pageId)
    const children = new Set(scope.filter((r) => r.type === PAGE_TYPE && r.lifecycle === 'live').map((r) => r.id))

    // ③ 하위 페이지 규칙으로 고친 본문으로 갈아 끼운다. 되돌리기 전의 상태는 그 전에 떠 둔다(④ 에서 남길지 모른다).
    const before = Y.encodeStateAsUpdate(body.ydoc)
    const beforeSeq = body.seq
    const next = keepCurrentChildren(target, body.read(), children)
    body.change((tr) => {
      tr.replaceWith(0, tr.doc.content.size, docToPm(wrapUnknownTypes(next)).content)
    })
    if (!body.changed) return { ok: true, value: NOOP } as const

    // ④ 되돌리기 전의 상태 — 그 위치를 담은 버전이 있으면 그것이다(한 위치에 하나).
    const covering = await tx.queryMaybe<{ id: string }>(`SELECT id FROM page_version WHERE page_id = $1 AND through_seq = $2`, [
      pageId,
      beforeSeq,
    ])
    let beforeVersionId = covering?.id ?? null
    if (beforeVersionId === null) {
      const prior = new Y.Doc()
      Y.applyUpdate(prior, before)
      beforeVersionId = (
        await recordVersion(tx, { workspaceId: ctx.workspaceId, pageId, ydoc: prior, seq: beforeSeq, reason: 'pre_restore', restoredFrom: null })
      ).id
      prior.destroy()
    }

    // ⑤ 투영하고 쌓는다 — 멘션 알림 없이.
    const written = await body.finish({ quietMentions: true })
    if (!written.ok) return { ok: false, reason: 'conflict' } as const

    // ⑥ 되돌린 뒤의 상태.
    const restored = await recordVersion(tx, {
      workspaceId: ctx.workspaceId,
      pageId,
      ydoc: body.ydoc,
      seq: written.commit.seq,
      reason: 'restore',
      restoredFrom: versionId,
    })
    return { ok: true, value: { noop: false, beforeVersionId, restoredVersionId: restored.id } } as const
  })
}

/**
 * 하위 페이지는 복원 대상이 아니다(정본 [보강] 복원 ③) — 대상 버전의 하위 페이지 참조 중 지금 이 본문의 살아 있는 자식이 아닌 것은 빼고,
 * 지금의 자식인데 그 버전에 없는 참조는 끝에 붙인다(지금 본문에 있던 그 블록 그대로 — 복원이 자식을 휴지통으로 보내지 않는다).
 */
export function keepCurrentChildren(target: EditorDoc, current: EditorDoc, children: ReadonlySet<string>): EditorDoc {
  const kept = new Set<string>()
  const prune = (blocks: readonly EditorBlock[]): EditorBlock[] =>
    blocks.flatMap((block) => {
      if (block.type === PAGE_TYPE) {
        if (!children.has(block.id) || kept.has(block.id)) return []
        kept.add(block.id)
        return [block]
      }
      return [{ ...block, children: block.children === undefined ? block.children : prune(block.children) }]
    })
  const blocks = prune(target.blocks)

  const missing: EditorBlock[] = []
  const collect = (list: readonly EditorBlock[]): void => {
    for (const block of list) {
      if (block.type === PAGE_TYPE && children.has(block.id) && !kept.has(block.id)) {
        kept.add(block.id)
        missing.push(block)
      }
      if (block.children !== undefined) collect(block.children)
    }
  }
  collect(current.blocks)
  return { ...target, blocks: [...blocks, ...missing] }
}
