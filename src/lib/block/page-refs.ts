/**
 * 본문 문서의 하위 페이지 참조 노드 — 서버 명령이 부모 본문에 넣고 빼는 변경 (F-02-13 · F-11-05 · F-02-08 · CRDT 4b조각)
 *
 * 정본: 판결 X-1(본문 순서의 정본은 Y.Doc) · X-3("부모 Y.Doc 에서는 참조 노드만 제거" · "휴지통 복원 → 부모 Y.Doc 에
 *       참조 노드 재삽입")
 *
 * 하위 페이지의 자리는 부모 페이지 본문의 참조 노드(`page_ref` 를 담은 컨테이너, blockId = 그 페이지 id)다. 행의
 * `parent_id` · `order_key` 는 그 자리의 투영이다. 그래서 하위 페이지를 만들고 · 버리고 · 되살리고 · 옮기는 명령은
 * 행만이 아니라 부모 본문의 참조 노드를 함께 바꾼다(`body-write.ts`).
 *
 * 전부 `EditorChange` 다 — 본문 세션의 `change` 에 넘긴다. 입력이 스키마에 맞으면 결과도 맞는다(검사가 `doc.check()` 로 본다).
 *
 *   - **빈 본문은 대체한다.** 빈 페이지의 본문은 빈 문단 하나다(`collab/ydoc.ts`). 그 뒤에 참조를 붙이면 문서가 "빈 문단 +
 *     참조"가 되어 투영이 빈 문단 행을 새로 만든다 — 하위 페이지를 만들었을 뿐인데 본문에 빈 줄이 생긴다
 *   - **마지막 참조를 빼면 빈 문단으로 되돌린다.** 루트 그룹은 비어 있을 수 없다
 *   - **이미 있는 참조는 넣지 않는다.** 같은 blockId 가 둘이면 정규화가 뒤의 것에 새 id 를 주고, 투영이 그 id 로 페이지가
 *     아닌… 새 참조 행을 만들려 한다. 넣기는 한 번만 일어나야 한다
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

import type { EditorChange } from '../collab/body-edit.ts'
import { emptyParagraphContainer, pmToDoc } from '../editor/pm-adapter.ts'
import { findContainerById, isBlankLeaf } from '../editor/pm-blocks.ts'
import { blockSchema, PAGE_REF_NODE } from '../editor/schema.ts'

const { blockContainer: CONTAINER, blockGroup: GROUP } = blockSchema.nodes

/** 하위 페이지 참조 노드. 제목을 싣지 않는다 — 그 페이지의 것이고 볼 권한이 있어야 한다(`editor/schema.ts`). */
export function pageRefNode(pageId: string): PmNode {
  return CONTAINER.create({ blockId: pageId }, [blockSchema.nodes[PAGE_REF_NODE].create({ props: {}, format: {} })])
}

/** 본문이 비었는가 — 저장 가능한 문서로 읽으면 블록이 없다(빈 문단 하나). */
function isEmptyBody(tr: Transaction): boolean {
  return pmToDoc(tr.doc).blocks.length === 0
}

function replaceBodyWith(tr: Transaction, ref: PmNode): void {
  tr.replaceWith(0, tr.doc.content.size, GROUP.create(null, [ref]))
}

/**
 * `parentBlockId`(null 이면 본문 최상위)의 자식 **맨 뒤**에 참조를 넣는다 — 하위 페이지 생성 · 이동.
 *
 * @throws 부모 컨테이너가 본문에 없으면 — 행과 Y.Doc 이 어긋나 있다는 뜻이다
 */
export function appendPageRef(parentBlockId: string | null, pageId: string): EditorChange {
  return (tr) => {
    if (findContainerById(tr.doc, pageId) !== null) return
    const ref = pageRefNode(pageId)
    if (parentBlockId === null) {
      if (isEmptyBody(tr)) replaceBodyWith(tr, ref)
      else tr.insert(tr.doc.content.size - 1, ref) // 마지막 루트 그룹의 끝
      return
    }
    const parent = findContainerById(tr.doc, parentBlockId)
    if (parent === null) throw new Error(`참조를 넣을 부모 블록이 본문에 없다: ${parentBlockId}`)
    if (parent.groupPos !== null && parent.groupNode !== null) {
      tr.insert(parent.groupPos + 1 + parent.groupNode.content.size, ref)
    } else {
      tr.insert(parent.contentPos + parent.contentNode.nodeSize, GROUP.create(null, [ref]))
    }
  }
}

/**
 * `afterBlockId` 바로 뒤에 참조를 넣는다. 그 블록이 없으면(null · 본문에 없음) `parentBlockId` 의 자식 **맨 앞**이다 — 휴지통 복원.
 *
 * @throws 앞 형제가 없는데 부모 컨테이너도 본문에 없으면
 */
export function insertPageRefAfter(
  pageId: string,
  parentBlockId: string | null,
  afterBlockId: string | null,
): EditorChange {
  return (tr) => {
    if (findContainerById(tr.doc, pageId) !== null) return
    const ref = pageRefNode(pageId)
    const after = afterBlockId === null ? null : findContainerById(tr.doc, afterBlockId)
    if (after !== null) {
      tr.insert(after.pos + after.node.nodeSize, ref)
      return
    }
    if (parentBlockId === null) {
      if (isEmptyBody(tr)) replaceBodyWith(tr, ref)
      else tr.insert(1, ref) // 첫 루트 그룹의 맨 앞
      return
    }
    const parent = findContainerById(tr.doc, parentBlockId)
    if (parent === null) throw new Error(`참조를 넣을 부모 블록이 본문에 없다: ${parentBlockId}`)
    if (parent.groupPos !== null) tr.insert(parent.groupPos + 1, ref)
    else tr.insert(parent.contentPos + parent.contentNode.nodeSize, GROUP.create(null, [ref]))
  }
}

/**
 * `atBlockId` 자리에 참조를 넣는다 — 편집기에서 하위 페이지를 만들 때 캐럿이 있던 블록(F-02-13 · CRDT 6b조각).
 *
 * 그 블록이 비었으면(`isBlankLeaf`) **대체하고**, 아니면 **바로 뒤 형제**로 넣는다 — 편집기의 `insertSubpageRef` 와 같은 자리다.
 * 협업 편집기는 참조를 로컬에 넣지 않고 이 자리를 서버에 넘긴다: 로컬에도 넣으면 같은 참조가 둘이 되어 문서 순서의 첫째만 남는다
 * (§3.2-24) — 사용자가 고른 자리가 아닐 수 있다.
 *
 * 그 블록이 본문에 없으면(그 사이 지워졌다 · 다른 본문의 블록이다 · 아직 서버에 닿지 않았다) 본문 **맨 뒤**다 — 거부하지 않는다.
 * 페이지는 이미 만들었고 자리만 흔들린다.
 */
export function placePageRefAt(pageId: string, atBlockId: string): EditorChange {
  return (tr, doc) => {
    if (findContainerById(tr.doc, pageId) !== null) return
    const at = findContainerById(tr.doc, atBlockId)
    if (at === null) {
      appendPageRef(null, pageId)(tr, doc)
      return
    }
    const ref = pageRefNode(pageId)
    if (isBlankLeaf(at)) tr.replaceWith(at.pos, at.pos + at.node.nodeSize, ref)
    else tr.insert(at.pos + at.node.nodeSize, ref)
  }
}

/** 참조를 뺀다 — 휴지통 · 이동. 본문에 없으면 아무것도 하지 않는다. */
export function removePageRef(pageId: string): EditorChange {
  return (tr) => {
    const found = findContainerById(tr.doc, pageId)
    if (found === null) return
    const $pos = tr.doc.resolve(found.pos)
    const group = $pos.parent
    if (group.childCount > 1) {
      tr.delete(found.pos, found.pos + found.node.nodeSize)
    } else if ($pos.depth === 1) {
      // 루트 그룹의 마지막 블록 — 그룹은 비어 있을 수 없으므로 빈 문단으로 되돌린다.
      tr.replaceWith(found.pos, found.pos + found.node.nodeSize, emptyParagraphContainer())
    } else {
      // 컨테이너의 마지막 자식 — 빈 그룹을 남기지 않고 그룹째 뺀다(`blockGroup: blockContainer+`).
      const groupPos = $pos.before($pos.depth)
      tr.delete(groupPos, groupPos + group.nodeSize)
    }
  }
}
