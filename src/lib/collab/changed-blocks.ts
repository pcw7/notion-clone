/**
 * Y 트랜잭션이 바꾼 블록의 id — 웹훅 `page.content_updated` 의 `updated_blocks` (API-9 · F-09-09)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑬ · 본문 모양은 `ydoc.ts`(`blockGroup > blockContainer(blockId) > 내용 노드`)
 *
 * 블록은 `blockId` 속성을 가진 요소(`blockContainer`)다. 글자 · 속성이 바뀐 타입은 가장 가까운 블록으로 올라가고, 새로 넣었거나 지운
 * 요소도 그 블록(또는 가장 가까운 블록)이다. 지운 요소의 속성은 GC 전이라 아직 읽힌다(`afterTransaction` 은 GC 앞이다 — `doc-store.ts`
 * `touchesElement` 와 같은 자리). 상한까지만 모은다 — 웹훅의 목록도 그만큼이다.
 */

import * as Y from 'yjs'

import { AGGREGATE_LIST_MAX } from '../api/webhook-aggregate.ts'

const BLOCK_ID_ATTR = 'blockId'

/** 이 요소의 `blockId` — 지운 요소도 읽는다(GC 전). 블록이 아니면 null. */
function blockIdOf(type: unknown): string | null {
  if (!(type instanceof Y.XmlElement)) return null
  const item = type._map.get(BLOCK_ID_ATTR)
  if (item === undefined) return null
  const content = item.content.getContent()
  const value = content[content.length - 1]
  return typeof value === 'string' && value !== '' ? value : null
}

/** 가장 가까운 블록(자기 포함). */
function nearestBlockId(type: unknown): string | null {
  let at: unknown = type
  for (let depth = 0; at instanceof Y.AbstractType && depth < 200; depth += 1) {
    const id = blockIdOf(at)
    if (id !== null) return id
    const parent: unknown = at._item?.parent ?? null
    at = parent
  }
  return null
}

/** 이 트랜잭션이 바꾼 블록을 `into` 에 더한다(상한까지). */
export function collectChangedBlocks(transaction: Y.Transaction, into: Set<string>, max: number = AGGREGATE_LIST_MAX): void {
  const add = (id: string | null): void => {
    if (id !== null && into.size < max) into.add(id)
  }
  for (const type of transaction.changed.keys()) {
    if (into.size >= max) return
    add(nearestBlockId(type))
  }
  // 넣은 요소 — 이 트랜잭션이 더한 구조체(clock 순서 · 뒤쪽)
  for (const [client, after] of transaction.afterState) {
    const before = transaction.beforeState.get(client) ?? 0
    if (after <= before) continue
    const structs = transaction.doc.store.clients.get(client) ?? []
    for (let i = structs.length - 1; i >= 0 && structs[i].id.clock + structs[i].length > before; i -= 1) {
      if (into.size >= max) return
      const struct = structs[i]
      if (struct.id.clock < after && struct instanceof Y.Item && struct.content instanceof Y.ContentType) add(nearestBlockId(struct.content.type))
    }
  }
  // 지운 요소
  Y.iterateDeletedStructs(transaction, transaction.deleteSet, (struct) => {
    if (into.size < max && struct instanceof Y.Item && struct.content instanceof Y.ContentType) add(nearestBlockId(struct.content.type))
  })
}
