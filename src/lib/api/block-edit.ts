/**
 * 공개 API 의 본문 편집 — 붙이기 · 고치기 · 지우기를 ProseMirror 변경으로 (API-3 · F-09-01 · 순수 · DB 없음)
 *
 * 정본: 판결 X-1(본문의 정본은 Y.Doc) · V-5(서버 명령 경로 ② — 본문 세션 안의 변경 하나) · §3.4 컬럼 · 심플 테이블
 *
 * 이 함수들은 `PageBodyWrite.change` 에 넘기는 변경(`EditorChange`)의 몸이다 — Y.Doc 을 비춘 ProseMirror 문서에서 **바꾸는 자리만** 고친다.
 * 문서를 통째로 갈아 끼우지 않는 까닭: 읽기(`readBodyYDoc`)는 원문이라 제안 마크 · 모르는 노드가 빠져 있다. 그것으로 갈아 끼우면 남의
 * 제안을 지운다. 그래서
 *   · 붙이기 — 부모의 자식 그룹(없으면 새로)에 컨테이너를 넣는다(빈 페이지의 빈 문단 하나는 갈아 끼운다 — 읽기가 "빈 문서" 로 보는 줄이다)
 *   · 고치기 — 내용 노드의 attr 만 바꾸고, 글을 바꿀 때만 그 노드의 글을 갈아 끼운다(글을 주지 않은 고치기는 제안 마크를 지킨다)
 *   · 지우기 — 그 컨테이너만 뺀다. 그룹의 마지막이면 그룹째(맨 위의 마지막이면 빈 문단 하나를 남긴다 — 스키마가 `blockContainer+` 다)
 * 컬럼을 비우거나 하나만 남긴 구조는 쌓을 때의 수선이 고친다(`collab/normalize.ts` — 편집기의 다른 참여자와 같은 길).
 *
 * 표의 행은 컨테이너가 아니라 표의 내용 노드 안의 행 노드다(`rowId` · 정본 §3.4 심플 테이블) — 따로 다룬다.
 */

import type { Fragment, Node as PmNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

import { sanitizeBlockAttrs } from '../block/props.ts'
import { TABLE_ROW_TYPE, TABLE_TYPE } from '../block/table.ts'
import { normalizeFormat, specOf } from '../block/types.ts'
import type { EditorBlock } from '../editor/document.ts'
import { containerFor, emptyParagraphContainer, inlineForType } from '../editor/pm-adapter.ts'
import { findContainerById } from '../editor/pm-blocks.ts'
import { blockSchema, TABLE_NODE, TABLE_ROW_NODE } from '../editor/schema.ts'

/** 붙일 자리 — 끝(기본) · 처음 · 형제 뒤. */
export type AppendPlace = { readonly kind: 'end' } | { readonly kind: 'start' } | { readonly kind: 'after'; readonly id: string }

export type EditOutcome = 'ok' | 'parent_not_found' | 'after_not_found' | 'not_found' | 'last_row'

/** 읽기가 빈 문서로 보는 줄 — 루트 그룹 하나 · 빈 문단 하나(`pmToDoc`). 아니면 null. */
function soleEmptyParagraph(doc: PmNode): { pos: number; node: PmNode } | null {
  if (doc.childCount !== 1) return null
  const group = doc.child(0)
  if (group.childCount !== 1) return null
  const container = group.child(0)
  const content = container.child(0)
  const props = (content.attrs.props ?? {}) as Record<string, unknown>
  const empty = container.childCount === 1 && content.type.name === 'paragraph' && content.content.size === 0 && Object.keys(props).length === 0
  return empty ? { pos: 1, node: container } : null
}

/** 표 행 블록들 → 행 노드 — 편집기의 표 노드를 짓는 같은 함수(`containerFor`)로 지어 행만 꺼낸다. */
function rowNodes(rows: readonly EditorBlock[]): Fragment {
  const table = containerFor({ id: rows[0]?.id ?? '', type: TABLE_TYPE, title: [], properties: {}, format: {}, children: rows })
  return table.child(0).content
}

/** id 로 표의 행 노드를 찾는다 — 위치 · 노드 · 그 표. */
function findRow(doc: PmNode, id: string): { pos: number; node: PmNode; table: PmNode } | null {
  let found: { pos: number; node: PmNode; table: PmNode } | null = null
  doc.descendants((node, pos, parent) => {
    if (found !== null) return false
    if (node.type.name === TABLE_ROW_NODE && String(node.attrs.rowId ?? '') === id && parent !== null) {
      found = { pos, node, table: parent }
      return false
    }
    return true
  })
  return found
}

/**
 * 블록들을 붙인다. `parentId` 가 null 이면 페이지 본문의 맨 위, 아니면 그 블록의 자식으로(표면 행으로). 형제 뒤(`after`)는 그 부모의
 * 직속 자식이어야 한다.
 */
export function appendBlocksIn(tr: Transaction, doc: PmNode, parentId: string | null, place: AppendPlace, blocks: readonly EditorBlock[]): EditOutcome {
  if (blocks.length === 0) return 'ok'
  if (parentId === null) {
    const nodes = blocks.map(containerFor)
    const empty = soleEmptyParagraph(doc)
    if (empty !== null) {
      if (place.kind === 'after') return 'after_not_found'
      tr.replaceWith(empty.pos, empty.pos + empty.node.nodeSize, nodes)
      return 'ok'
    }
    if (place.kind === 'start') tr.insert(1, nodes)
    else if (place.kind === 'end') tr.insert(doc.content.size - 1, nodes)
    else {
      const after = findContainerById(doc, place.id)
      if (after === null || doc.resolve(after.pos).depth !== 1) return 'after_not_found'
      tr.insert(after.pos + after.node.nodeSize, nodes)
    }
    return 'ok'
  }

  const host = findContainerById(doc, parentId)
  if (host === null) return 'parent_not_found'

  // 표 — 행 노드를 표의 내용 노드 안에
  if (host.contentNode.type.name === TABLE_NODE) {
    const rows = rowNodes(blocks.filter((b) => b.type === TABLE_ROW_TYPE))
    const table = host.contentNode
    if (place.kind === 'start') tr.insert(host.contentPos + 1, rows)
    else if (place.kind === 'end') tr.insert(host.contentPos + table.nodeSize - 1, rows)
    else {
      let at: number | null = null
      table.forEach((row, offset) => {
        if (at === null && String(row.attrs.rowId ?? '') === place.id) at = host.contentPos + 1 + offset + row.nodeSize
      })
      if (at === null) return 'after_not_found'
      tr.insert(at, rows)
    }
    return 'ok'
  }

  const nodes = blocks.map(containerFor)
  if (host.groupNode === null || host.groupPos === null) {
    if (place.kind === 'after') return 'after_not_found'
    tr.insert(host.contentPos + host.contentNode.nodeSize, blockSchema.nodes.blockGroup.create(null, nodes))
    return 'ok'
  }
  if (place.kind === 'start') tr.insert(host.groupPos + 1, nodes)
  else if (place.kind === 'end') tr.insert(host.groupPos + host.groupNode.nodeSize - 1, nodes)
  else {
    const after = findContainerById(doc, place.id)
    if (after === null) return 'after_not_found'
    const $after = doc.resolve(after.pos)
    if ($after.before($after.depth) !== host.groupPos) return 'after_not_found'
    tr.insert(after.pos + after.node.nodeSize, nodes)
  }
  return 'ok'
}

/**
 * 블록 하나를 고친다 — `next` 의 속성 · 모습을 내용 노드에, 글은 `textChanged` 일 때만. 표의 행은 셀을 바꿀 때 행 노드를 새로 짓는다
 * (같은 `rowId` · 셀 밖의 행 속성은 그대로).
 */
export function updateBlockIn(tr: Transaction, doc: PmNode, next: EditorBlock, changes: { readonly textChanged: boolean; readonly cellsChanged: boolean }): EditOutcome {
  if (next.type === TABLE_ROW_TYPE) {
    const row = findRow(doc, next.id)
    if (row === null) return 'not_found'
    if (changes.cellsChanged) {
      const rowProps = (row.node.attrs.props ?? {}) as Record<string, unknown>
      const rebuilt = rowNodes([{ ...next, properties: { ...rowProps, ...next.properties } }])
      tr.replaceWith(row.pos, row.pos + row.node.nodeSize, rebuilt)
    }
    return 'ok'
  }
  const host = findContainerById(doc, next.id)
  if (host === null) return 'not_found'
  const content = host.contentNode
  // 편집기 · 투영이 쓰는 정규형으로(`contentNodeFor` 와 같다) — 읽기의 정화가 다시 고쳐 쓰지 않게
  // 표의 속성은 머리 플래그뿐이다 — 행(내용 노드의 자식)은 그대로 남는다
  const { props, format } = sanitizeBlockAttrs(next.type, { ...(next.properties ?? {}) }, normalizeFormat(next.type, next.format))
  tr.setNodeMarkup(host.contentPos, undefined, { ...content.attrs, props, format }, content.marks)
  if (changes.textChanged && specOf(next.type).hasRichText) {
    const from = host.contentPos + 1
    tr.replaceWith(from, from + content.content.size, inlineForType(next.type, next.title))
  }
  return 'ok'
}

/** 블록 하나를 지운다(자식째). 표의 마지막 행은 지우지 않는다 — 행 없는 표는 없다(표를 지운다). */
export function deleteBlockIn(tr: Transaction, doc: PmNode, id: string): EditOutcome {
  const container = findContainerById(doc, id)
  if (container === null) {
    const row = findRow(doc, id)
    if (row === null) return 'not_found'
    if (row.table.childCount <= 1) return 'last_row'
    tr.delete(row.pos, row.pos + row.node.nodeSize)
    return 'ok'
  }
  const $at = doc.resolve(container.pos)
  const group = $at.parent
  if (group.childCount > 1) {
    tr.delete(container.pos, container.pos + container.node.nodeSize)
  } else if ($at.depth === 1 && doc.childCount === 1) {
    // 본문의 마지막 블록 — 빈 문단 하나를 남긴다(읽기는 빈 문서로 본다)
    tr.replaceWith(container.pos, container.pos + container.node.nodeSize, emptyParagraphContainer())
  } else {
    // 그룹의 하나뿐인 자식 — 그룹째 뺀다(빈 그룹은 스키마에 없다)
    tr.delete($at.before($at.depth), $at.after($at.depth))
  }
  return 'ok'
}
