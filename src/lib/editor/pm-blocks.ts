/**
 * ProseMirror 문서에서 "블록"을 찾고 읽는 유틸.
 *
 * `commands.ts` 와 플러그인들이 공유한다. 여기서 하는 일은 두 가지뿐이다.
 *
 *   ① `blockContainer` 를 위치·id 로 찾아 그 구성요소(내용 노드 / 자식 그룹)를
 *      한 객체로 정리한다
 *   ② PM 노드를 `block-rules.ts` 가 받는 `RuleBlock` 으로 옮긴다
 *
 * ②가 이 파일의 요점이다. 규칙은 ProseMirror 를 모르고, ProseMirror 는 규칙을
 * 모른다. 둘을 잇는 자리를 한 곳으로 모아두면 규칙을 바꿀 때 커맨드를 건드리지
 * 않고, 커맨드를 바꿀 때 규칙을 건드리지 않는다.
 */

import type { Node as PmNode, ResolvedPos } from '@tiptap/pm/model'

import { isKnownBlockType, specOf, PAGE_TYPE, type BlockFormat, type BlockType } from '../block/types.ts'
import type { RuleBlock } from './block-rules.ts'
import { inlineToRuns } from './pm-adapter.ts'
import { PAGE_REF_NODE } from './schema.ts'
import { flattenVisible, type TreeNodeLike } from './tree.ts'

export type ContainerInfo = {
  readonly id: string
  /** 컨테이너 노드 **앞**의 위치. */
  readonly pos: number
  readonly node: PmNode
  /** 내용 노드(paragraph·heading·divider…) 앞의 위치. */
  readonly contentPos: number
  readonly contentNode: PmNode
  /** 자식 그룹. 없으면 null. */
  readonly groupPos: number | null
  readonly groupNode: PmNode | null
}

export function describeContainer(node: PmNode, pos: number): ContainerInfo {
  const contentNode = node.child(0)
  const contentPos = pos + 1
  const hasGroup = node.childCount > 1
  return {
    id: String(node.attrs.blockId ?? ''),
    pos,
    node,
    contentPos,
    contentNode,
    groupPos: hasGroup ? contentPos + contentNode.nodeSize : null,
    groupNode: hasGroup ? node.child(1) : null,
  }
}

/** 이 위치를 담고 있는 가장 가까운 `blockContainer`. */
export function containerAt($pos: ResolvedPos): ContainerInfo | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name === 'blockContainer') {
      return describeContainer(node, $pos.before(depth))
    }
  }
  return null
}

/**
 * id 로 컨테이너를 찾는다.
 *
 * 커맨드는 구조를 고친 **뒤에** 대상을 다시 찾는 방식으로 짜여 있다.
 * 수동으로 위치를 매핑하는 것보다 이쪽이 틀릴 여지가 적다 — 위치 매핑 실수는
 * "블록이 엉뚱한 데로 갔다"로 나타나고 재현이 어렵다.
 */
export function findContainerById(doc: PmNode, id: string): ContainerInfo | null {
  let found: ContainerInfo | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === 'blockContainer' && String(node.attrs.blockId ?? '') === id) {
      found = describeContainer(node, pos)
      return false
    }
    return true
  })
  return found
}

/** 내용 노드의 타입 이름을 우리 블록 타입으로. */
export function blockTypeOf(contentNode: PmNode): BlockType {
  const name = contentNode.type.name
  if (name === PAGE_REF_NODE) return PAGE_TYPE
  return isKnownBlockType(name) ? name : 'unsupported'
}

/**
 * 규칙 함수의 입력으로 옮긴다.
 *
 * `collapsed` 는 문서에 없다 — F-01-13 이 접힘을 뷰어별 상태로 두라고 했기
 * 때문이다(`document.ts` 머리말). 그래서 밖에서 받는다.
 */
export function toRuleBlock(info: ContainerInfo, isCollapsed: (id: string) => boolean): RuleBlock {
  const type = blockTypeOf(info.contentNode)
  return {
    type,
    title: specOf(type).hasRichText ? inlineToRuns(info.contentNode.content) : [],
    properties: (info.contentNode.attrs.props ?? {}) as Record<string, unknown>,
    format: (info.contentNode.attrs.format ?? {}) as BlockFormat,
    hasChildren: info.groupNode !== null && info.groupNode.childCount > 0,
    collapsed: isCollapsed(info.id),
  }
}

// ── 화면 순서 ─────────────────────────────────────────────────────────

type PmTreeNode = TreeNodeLike & {
  readonly id: string
  readonly collapsed: boolean
  readonly children: PmTreeNode[]
}

function treeFromGroup(group: PmNode, isCollapsed: (id: string) => boolean): PmTreeNode[] {
  const out: PmTreeNode[] = []
  group.forEach((container) => {
    const info = describeContainer(container, 0) // 위치는 여기서 쓰지 않는다
    out.push({
      id: info.id,
      collapsed: isCollapsed(info.id),
      children: info.groupNode ? treeFromGroup(info.groupNode, isCollapsed) : [],
    })
  })
  return out
}

/**
 * 화면에 보이는 이전 / 다음 블록.
 *
 * **트리 순서가 아니라 화면 순서다.** F-01-19: "접힌 토글 뒤에서 Backspace →
 * 토글 subtree 전체와 병합되는 것처럼 보이면 안 된다. 접힌 토글 **제목**과
 * 병합하되 자식은 그대로 토글에 남긴다." 트리 순서로 계산하면 접힌 토글의
 * 마지막 자손(화면에 없는 블록)과 합쳐진다.
 *
 * 접힘을 걸러내는 일은 `tree.ts` 의 `flattenVisible()` 이 이미 하고 테스트도
 * 거기 있다. 여기서는 PM 문서를 그 모양으로 옮기기만 한다.
 */
export function visibleNeighbors(
  doc: PmNode,
  blockId: string,
  isCollapsed: (id: string) => boolean,
): { previous: string | null; next: string | null } {
  if (doc.childCount === 0) return { previous: null, next: null }
  const index = flattenVisible(treeFromGroup(doc.child(0), isCollapsed))
  return {
    previous: index.previous(blockId)?.node.id ?? null,
    next: index.next(blockId)?.node.id ?? null,
  }
}
