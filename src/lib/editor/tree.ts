/**
 * 화면에 보이는 블록의 평탄화 인덱스 — F-01-19
 *
 * 정본: 01-block-editor.md F-01-19 엣지 케이스 두 개가 이 파일을 요구한다.
 *
 *   "대용량 — 5000블록 페이지에서 방향키 연타 | 블록 경계 이동마다 DOM 조회를
 *    하면 프레임 드랍. **평탄화된 블록 인덱스 배열을 별도로 유지해 O(1) 이웃 조회**"
 *
 *   "중첩 — 접힌 토글 뒤에서 Backspace | 토글 subtree 전체와 병합되는 것처럼
 *    보이면 안 된다. **접힌 토글 제목과 병합**하되 자식은 그대로 토글에 남긴다"
 *
 * 두 요구가 같은 자료구조를 가리킨다. 두 번째가 더 중요하다: **병합 대상은
 * 트리 순서상의 이전 블록이 아니라 화면에 보이는 이전 블록**이다. 트리를 그대로
 * 전위 순회하면 접힌 토글의 마지막 자손 — 사용자에게 보이지도 않는 블록 — 과
 * 합쳐진다. 그게 "토글 subtree 전체와 병합되는 것처럼 보인다"는 증상이다.
 *
 * 그래서 접힌 노드에서는 **자손을 순회하지 않는다.** 그 한 줄이 이 파일의 요점이다.
 */

/** 평탄화에 필요한 최소 모양. `block` 행이든 ProseMirror 노드든 이 모양으로 맞춘다. */
export type TreeNodeLike = {
  readonly id: string
  /** 접혀 있으면 자손이 화면에 없다. 없으면 펼쳐진 것으로 본다. */
  readonly collapsed?: boolean
  readonly children?: readonly TreeNodeLike[]
}

export type VisibleEntry<T extends TreeNodeLike> = {
  readonly node: T
  /** 루트가 0. */
  readonly depth: number
  readonly parentId: string | null
}

export type VisibleIndex<T extends TreeNodeLike> = {
  /** 화면 순서(전위 순회, 접힌 노드의 자손 제외). */
  readonly order: readonly VisibleEntry<T>[]
  /** 없으면 -1. */
  positionOf(id: string): number
  previous(id: string): VisibleEntry<T> | null
  next(id: string): VisibleEntry<T> | null
  entry(id: string): VisibleEntry<T> | null
}

/**
 * 화면 순서로 평탄화하고 O(1) 이웃 조회를 붙인다.
 *
 * 순회는 재귀가 아니라 명시적 스택이다. `MAX_TREE_DEPTH` 가 100 이라 재귀로도
 * 안전하지만, 이 함수는 신뢰할 수 없는 입력(클라이언트가 보낸 문서)에도 돌 수
 * 있어야 한다 — 깊이 검증보다 스택이 싸다.
 *
 * 같은 id 가 두 번 나오면 던진다. 순환이나 중복이 들어오면 `positionOf` 가
 * 조용히 한쪽만 가리키게 되고, 그때부터 이웃 조회가 엉뚱한 블록을 준다.
 */
export function flattenVisible<T extends TreeNodeLike>(roots: readonly T[]): VisibleIndex<T> {
  const order: VisibleEntry<T>[] = []
  const positions = new Map<string, number>()

  type Frame = { node: T; depth: number; parentId: string | null }
  // 전위 순회를 스택으로 하려면 자식을 역순으로 넣어야 순서가 유지된다.
  const stack: Frame[] = []
  for (let i = roots.length - 1; i >= 0; i -= 1) {
    stack.push({ node: roots[i], depth: 0, parentId: null })
  }

  while (stack.length > 0) {
    const frame = stack.pop() as Frame
    if (positions.has(frame.node.id)) {
      throw new Error(`블록 id 가 문서에 두 번 나타났습니다: ${frame.node.id}`)
    }
    positions.set(frame.node.id, order.length)
    order.push({ node: frame.node, depth: frame.depth, parentId: frame.parentId })

    // ★ 접혀 있으면 자손을 순회하지 않는다. 이 줄이 병합 대상을 결정한다.
    if (frame.node.collapsed === true) continue

    const children = (frame.node.children ?? []) as readonly T[]
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push({ node: children[i], depth: frame.depth + 1, parentId: frame.node.id })
    }
  }

  const positionOf = (id: string): number => positions.get(id) ?? -1
  const at = (i: number): VisibleEntry<T> | null =>
    i >= 0 && i < order.length ? order[i] : null

  return {
    order,
    positionOf,
    entry: (id) => at(positionOf(id)),
    previous: (id) => {
      const i = positionOf(id)
      return i <= 0 ? null : order[i - 1]
    },
    next: (id) => {
      const i = positionOf(id)
      return i < 0 ? null : at(i + 1)
    },
  }
}
