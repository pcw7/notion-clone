/**
 * AI 가 읽는 페이지의 동기화 블록 사본을 편다 (SB-5 · F-01-11 · 정본 [보강 SB-0] ⑲ [SB-5 고침] ⓒ · DB)
 *
 * 사본은 그 페이지에 내용이 없다(원자). 요청자가 원본 페이지 A 를 볼 수 있으면(`can(effectiveCaps(A),'view')` · A 가 살아 있다 — **요청자의
 * `SessionContext` 로**) A 의 원문(`readBodyIn(A)` — 제안 마크 밖)에서 원본 X 의 자식을 사본의 자식으로 단다. 아니면 사본을 뺀다(SY10 — B 를 볼
 * 수 있다고 A 를 내주지 않는다 · 자리 글도 남기지 않는다). 원본 페이지는 문서 차례로 `SYNCED_EXPAND_PAGES` 개까지 · 넘는 것은 뺀다.
 *
 * 묻기 · 채팅 · 이어 쓰기(`readAskPage`)와 AI 블록이 쓴다. AI 블록의 원문 **해시**는 펴기 전의 문서로 짓는다(편집기가 같은 값을 짓는다).
 */

import { readBodyIn } from '../api/block-body.ts'
import type { SessionContext } from '../auth/session-context.ts'
import { isSyncedCopyProps, SYNCED_BLOCK_TYPE, SYNCED_EXPAND_PAGES, syncedFromOf } from '../block/synced-block.ts'
import { syncedOriginalPagesIn } from '../block/synced-block-resolve.ts'
import type { Tx } from '../db/tx.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { findBlockIn } from './block-source.ts'

export async function expandSyncedForReader(tx: Tx, ctx: SessionContext, doc: EditorDoc): Promise<EditorDoc> {
  const wanted: string[] = []
  const collect = (blocks: readonly EditorBlock[]): void => {
    for (const block of blocks) {
      const from = block.type === SYNCED_BLOCK_TYPE ? syncedFromOf(block.properties, block.id) : null
      if (from !== null) wanted.push(from)
      else collect(block.children ?? [])
    }
  }
  collect(doc.blocks)
  if (wanted.length === 0) return doc

  const originals = await syncedOriginalPagesIn(tx, ctx.workspaceId, wanted)
  const pages = [...new Set(wanted.flatMap((x) => {
    const page = originals.get(x)
    return page?.live === true ? [page.pageId] : []
  }))].slice(0, SYNCED_EXPAND_PAGES)
  const bodies = new Map<string, EditorDoc>()
  for (const page of pages) {
    if (can(await effectiveCaps(tx, ctx, page), 'view')) bodies.set(page, await readBodyIn(tx, ctx, page))
  }
  const contentOf = (x: string): readonly EditorBlock[] | null => {
    const page = originals.get(x)
    const body = page === undefined ? undefined : bodies.get(page.pageId)
    const found = body === undefined ? null : findBlockIn(body.blocks, x)
    return found !== null && found.type === SYNCED_BLOCK_TYPE && !isSyncedCopyProps(found.properties) ? (found.children ?? []) : null
  }

  const walk = (blocks: readonly EditorBlock[]): EditorBlock[] =>
    blocks.flatMap((block) => {
      if (block.type !== SYNCED_BLOCK_TYPE || !isSyncedCopyProps(block.properties)) {
        return [block.children && block.children.length > 0 ? { ...block, children: walk(block.children) } : block]
      }
      const from = syncedFromOf(block.properties, block.id)
      const content = from === null ? null : contentOf(from)
      return content === null ? [] : [{ ...block, children: content }]
    })
  return { blocks: walk(doc.blocks) }
}
