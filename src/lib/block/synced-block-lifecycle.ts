/**
 * 동기화 블록의 "모두 해제" — 서버 명령 (SB-4 · F-01-11 · 정본 [보강 SB-0] ⑫ⓑ [SB-4 고침] · SY1 · SY7)
 *
 * 원본 X(페이지 A)의 사본들을 끊는다. 한 트랜잭션 — 복제 · 이동처럼 본문 세션 여럿을 잡는다(`body-write.ts` 머리말의 순서).
 *
 *   ① X 를 가리키는 사본이 든 살아 있는 페이지(역인덱스 · A 밖이 200곳을 넘으면 거부)
 *   ② A 와 그 페이지들을 **한 문장에서 id 순으로** 잠근다(고칠 수 없는 페이지도 — 판정은 잠근 뒤에 한다 · 교착을 피하는 한 방향)
 *   ③ A 의 `edit_content` · 잠기지 않음. X 는 행이 아니라 **A 의 Y.Doc 에서** 찾는다(X-1 — 투영 전의 편집까지 · 내용도 거기서 읽는다)
 *   ④ 사본 페이지마다 — 살아 있고 행위자가 `edit_content` 를 가졌고 잠기지 않았으면 그 문서의 X 사본을 모두 X 의 내용(사본마다 새 id ·
 *      페이지 멘션 그대로)으로 편다. **아니면 손대지 않는다** — 거기에 쓰면 그 페이지에서 A 를 볼 수 없던 사람에게 X 가 샌다(⑫ⓑ 판결). 그
 *      사본은 X 가 껍데기를 벗으면 "원본이 삭제되었다" 자리(⑬)가 된다
 *   ⑤ A — 같은 페이지의 사본을 편 뒤 X 의 껍데기를 벗긴다(자식은 제자리 · id 그대로)
 *
 * 사본이 없으면(살아 있는 사본 페이지도 A 의 문서의 사본도 없다) 아무것도 쓰지 않고 `no_copies` — 편집기가 껍데기를 벗긴다(⑫ⓒ · 되돌릴 수
 * 있다). 서버 명령은 되돌리기에 들지 않는다. 권한은 `SessionContext` 와 능력 비트로만 묻는다(레벨을 견주지 않는다).
 */

import { randomUUID } from 'node:crypto'

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

import type { SessionContext } from '../auth/session-context.ts'
import { withTransaction, type Tx } from '../db/tx.ts'
import type { EditorBlock } from '../editor/document.ts'
import { containerFor } from '../editor/pm-adapter.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { isLocked } from '../permissions/lock.ts'
import { openPageBody } from './body-write.ts'
import { remapBody } from './duplicate-remap.ts'
import { isSyncedCopyProps, SYNCED_BLOCK_TYPE, syncedFromOf } from './synced-block.ts'
import { syncedCopyPagesIn } from './synced-block-resolve.ts'

/** 한 번에 끊을 수 있는 사본 페이지 수(A 밖) — 넘으면 거부한다(사본을 먼저 줄인다 · ⑫ⓑ). */
export const MAX_UNSYNC_PAGES = 200

export type UnsyncAllResult =
  | { readonly ok: true; readonly value: { readonly state: 'no_copies' } | { readonly state: 'done'; readonly expanded: number; readonly left: number } }
  | { readonly ok: false; readonly reason: 'not_found' | 'forbidden' | 'too_many' }

const fail = (reason: 'not_found' | 'forbidden' | 'too_many'): UnsyncAllResult => ({ ok: false, reason })

/** 이 페이지의 본문을 지금 고칠 수 있는가 — 협업 서버의 `edit` 과 같은 조건(`edit_content` · 잠기지 않음). */
async function canEditBody(tx: Tx, ctx: SessionContext, pageId: string): Promise<boolean> {
  return can(await effectiveCaps(tx, ctx, pageId), 'edit_content') && !(await isLocked(tx, pageId))
}

/** 본문(블록 목록)에서 id 의 블록 — 깊이 상관없이. */
function findBlock(blocks: readonly EditorBlock[], id: string): EditorBlock | null {
  for (const block of blocks) {
    if (block.id.toLowerCase() === id) return block
    const inner = findBlock(block.children ?? [], id)
    if (inner !== null) return inner
  }
  return null
}

/** 본문의 X 사본 수. */
function countCopies(blocks: readonly EditorBlock[], x: string): number {
  return blocks.reduce(
    (n, b) => n + (b.type === SYNCED_BLOCK_TYPE && syncedFromOf(b.properties, b.id) === x ? 1 : countCopies(b.children ?? [], x)),
    0,
  )
}

/**
 * 문서의 X 사본을 모두 X 의 내용(사본마다 새 id)으로 펴고, `unwrap` 이면 X 의 껍데기도 벗긴다 — 뒤에서 앞으로(앞의 위치가 밀리지 않는다).
 * 동기화 블록 안에는 동기화 블록이 없으므로(SY5) 겹치지 않는다. 편 사본 수.
 */
function expandIn(tr: Transaction, x: string, content: readonly EditorBlock[], unwrap: boolean): number {
  const targets: { pos: number; node: PmNode; copy: boolean }[] = []
  tr.doc.descendants((node, pos) => {
    if (node.type.name !== 'blockContainer') return !node.isTextblock && !node.isAtom
    const head = node.firstChild
    if (head?.type.name !== SYNCED_BLOCK_TYPE) return true
    const id = String(node.attrs.blockId ?? '').toLowerCase()
    const copy = isSyncedCopyProps(head.attrs.props)
    if (copy ? syncedFromOf(head.attrs.props, id) === x : id === x) targets.push({ pos, node, copy })
    return false
  })
  let expanded = 0
  for (const t of targets.reverse()) {
    const end = t.pos + t.node.nodeSize
    if (t.copy) {
      tr.replaceWith(t.pos, end, remapBody({ blocks: content }, new Map(), randomUUID).blocks.map(containerFor))
      expanded += 1
    } else if (unwrap && t.node.childCount > 1) {
      tr.replaceWith(t.pos, end, t.node.child(1).content)
    }
  }
  return expanded
}

/**
 * 모두 해제(머리말). `pageId` 는 X 가 든 페이지 A — 화면이 안다(X 의 행은 투영 전일 수 있다).
 *
 * @param maxPages 사본 페이지 상한 — 검사가 작게 준다(201곳을 만들지 않고 상한의 갈래를 본다).
 */
export async function unsyncAllSyncedCopies(ctx: SessionContext, pageId: string, originalId: string, maxPages = MAX_UNSYNC_PAGES): Promise<UnsyncAllResult> {
  if (!isUuid(pageId) || !isUuid(originalId)) return fail('not_found')
  const page = pageId.toLowerCase()
  const x = originalId.toLowerCase()
  return withTransaction(async (tx): Promise<UnsyncAllResult> => {
    // 볼 수 없으면 없는 것과 같다 — 사본 수(200 상한)도 말하지 않는다
    const seen = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
      [page, ctx.workspaceId],
    )
    if (seen === null || !can(await effectiveCaps(tx, ctx, page), 'view')) return fail('not_found')

    // ① · ②
    const copyPages = (await syncedCopyPagesIn(tx, ctx.workspaceId, x)).map((p) => p.pageId).filter((id) => id !== page)
    if (copyPages.length > maxPages) return fail('too_many')
    const all = [page, ...copyPages]
    await tx.query(`SELECT id FROM block WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [all])
    const live = new Set(
      (
        await tx.query<{ id: string }>(
          `SELECT id FROM block WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
          [all, ctx.workspaceId],
        )
      ).map((r) => r.id),
    )

    // ③
    if (!live.has(page)) return fail('not_found')
    if (!(await canEditBody(tx, ctx, page))) return fail('forbidden')
    const bodyA = await openPageBody(tx, ctx, page)
    const docA = bodyA.read()
    const original = findBlock(docA.blocks, x)
    if (original === null || original.type !== SYNCED_BLOCK_TYPE || isSyncedCopyProps(original.properties)) return fail('not_found')
    if (copyPages.length === 0 && countCopies(docA.blocks, x) === 0) return { ok: true, value: { state: 'no_copies' } }
    const content = original.children ?? []

    // ④ — id 순(잠근 순서 그대로)
    let expanded = 0
    let left = 0
    for (const id of [...copyPages].sort()) {
      if (!live.has(id) || !(await canEditBody(tx, ctx, id))) {
        left += 1
        continue
      }
      const body = await openPageBody(tx, ctx, id)
      let n = 0
      body.change((tr) => {
        n = expandIn(tr, x, content, false)
      })
      // 행은 있다고 했는데 문서에 없다(지웠고 아직 투영 전) — 쓸 것이 없다
      if (n === 0) continue
      // 멘션 알림은 A 에서 이미 보냈다
      const result = await body.finish({ quietMentions: true })
      if (!result.ok) throw new Error(`사본 페이지의 투영이 모두 해제를 거부했다(${result.reason}): ${id}`)
      expanded += 1
    }

    // ⑤
    let inA = 0
    bodyA.change((tr) => {
      inA = expandIn(tr, x, content, true)
    })
    const result = await bodyA.finish({ quietMentions: true })
    if (!result.ok) throw new Error(`원본 페이지의 투영이 모두 해제를 거부했다(${result.reason}): ${page}`)
    if (inA > 0) expanded += 1
    return { ok: true, value: { state: 'done', expanded, left } }
  })
}
