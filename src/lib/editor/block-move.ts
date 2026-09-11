/**
 * 블록 상하 이동 — F-01-08 (P0 "단순 상하 이동")
 *
 * 정본: 01-block-editor.md F-01-08, 12-platform-ux.md F-12-13
 *
 * ⚠ `src/lib/block/move-page.ts` 와 다른 것이다. 저쪽은 **페이지를 다른 페이지
 * 밑으로** 옮기는 DB 트랜잭션(`ancestor_path` · `perm_scope_id` 재작성)이고,
 * 이것은 **한 문서 안에서 블록의 자리**를 바꾸는 편집 조작이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 키보드가 먼저인가
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-12-13: *"드래그 앤 드롭에는 **키보드 대체 경로가 반드시 있어야 한다**
 * (WCAG 2.1 SC 2.1.1). `cmd/ctrl + shift + arrow` 블록 이동이 그 역할을 한다."*
 *
 * 드래그(`block-handle.ts`)는 이 파일의 계획을 쓰지 않는다. 처음엔 쓸 생각이었지만
 * 드래그는 **떨어진 선택**도 한곳으로 모아야 해서, 목적지가 소스들 사이에 올 수
 * 있다 — "뒤쪽 연산 먼저"가 성립하지 않는다. 그래서 드래그는 목적지를 id 로 들고
 * 가서 지운 뒤 다시 찾는다. 두 경로가 공유하는 것은 **들어내는 규칙**
 * (`blockDeletionRanges`, 빈 그룹 처리)이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 판결: 이동은 깊이를 바꾸지 않는다. 경계를 넘을 때만 한 단 얕아진다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본은 "단순 상하 이동"이라고만 하고 중첩에서의 의미를 정하지 않았다.
 * 후보가 셋이었고 다음을 골랐다.
 *
 *   ① **형제 순서 교환.** 다음 형제가 있으면 그 **뒤**로 간다 — 그 형제가
 *      자식을 가질 수 있어도 **안으로 들어가지 않는다.** 안으로 넣는 것은
 *      `Tab`(들여쓰기)의 일이고, 두 조작을 섞으면 둘 다 예측할 수 없어진다.
 *      한 번 눌렀는데 남의 자식이 되어 있으면 되돌리는 방법도 불분명해진다.
 *   ② **경계에서는 한 단 나간다.** 마지막 형제에서 아래로 누르면 부모 밖
 *      (부모의 다음 자리)으로 간다. 여기서 멈춰 버리면 리스트 안 블록을
 *      키보드로는 리스트 밖으로 뺄 수 없는데, 드래그로는 되는 이동이다.
 *      **키보드 대체 경로가 드래그보다 약하면** WCAG 취지에 어긋난다.
 *
 * ⚠ **왕복은 형제 사이에서만 제자리다.** 경계를 넘은 뒤 반대 키를 누르면
 * 원래 자리로 돌아오지 않는다. 피할 수 없는 성질이다 — 마지막 자식이 부모
 * 밖으로 나가면 **화면 순서는 그대로이고 깊이만** 바뀌는데, 되돌아올 때는
 * 그 깊이를 복원할 방법이 "이전 형제 안으로 들어가기"뿐이고 그것이 ① 이 금지한
 * 것이다. 순서와 깊이 두 축을 한 키로 완전 대칭 왕복시킬 수는 없다.
 * 깊이를 되돌리는 것은 `Tab`/`Shift+Tab` 의 일이고, 실수는 `Cmd+Z` 가 받는다.
 *
 * 이 규칙에는 공짜 성질이 둘 있다.
 *
 *   - **접힘을 몰라도 된다.** 안으로 들어가지 않으므로 "접힌 토글 안으로
 *     들어가 블록이 화면에서 사라지는" 경우가 성립하지 않는다. 이 파일에
 *     `isCollapsed` 가 없는 이유다.
 *   - **`canHaveChildren` 을 볼 필요가 없다.** 깊이가 깊어지는 방향이 없으니
 *     자식을 못 갖는 타입(heading) 밑으로 들어갈 수 없다. 나가는 방향의 목적지
 *     그룹은 이미 자식을 갖고 있는 컨테이너의 것이거나 루트 그룹이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 하위 페이지는 옮겨도 된다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 삭제(F-01-09)와 달리 이동은 거부하지 않는다. 블록이 문서에서 **사라지지
 * 않으므로** `page_ref_missing` 이 나지 않고, 부모가 바뀌는 경우는
 * `save-page-body.ts` 가 이미 `relocateSubtree` 를 불러 서브트리의
 * `ancestor_path` · `perm_scope_id` 를 다시 쓴다 [X-7 / §3.11 ④].
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { TextSelection, type Command, type Transaction } from '@tiptap/pm/state'

import { blockDeletionRanges, BlockSelection, isBlockSelection } from './block-selection.ts'
import type { CommandDeps } from './commands.ts'
import { containerAt, findContainerById } from './pm-blocks.ts'

/** 서로 떨어진 블록을 함께 옮기려 할 때 보여줄 이유. */
export const MOVE_NOT_SIBLINGS_REFUSAL =
  '같은 단계에 나란히 있는 블록만 함께 옮길 수 있습니다.'

export type MovePlan =
  | {
      readonly kind: 'move'
      /** 옮길 컨테이너들의 위치. 문서 순서이며 연속 형제다. */
      readonly sources: readonly number[]
      /** 삽입 위치. 목적지 `blockGroup` 안의 자리다. */
      readonly insertAt: number
      /** 한 단 밖으로 나가는 이동인가. */
      readonly outdents: boolean
    }
  /** 더 갈 곳이 없다 — 문서의 처음/끝. 조용히 아무 것도 하지 않는다. */
  | { readonly kind: 'at_boundary' }
  /** 연속 형제가 아니다 — 무엇을 "한 덩어리로" 옮길지 정의되지 않는다. */
  | { readonly kind: 'not_siblings' }
  | { readonly kind: 'no_blocks' }

/** 그룹 안에서 이 컨테이너가 몇 번째인가. */
function indexIn(doc: PmNode, pos: number): number {
  return doc.resolve(pos).index()
}

/** 이 컨테이너가 속한 `blockGroup` 노드 앞의 위치. */
function groupPosOf(doc: PmNode, pos: number): number {
  const $pos = doc.resolve(pos)
  return $pos.before($pos.depth)
}

/**
 * 이 그룹을 담고 있는 부모 `blockContainer` 앞의 위치. 루트 그룹이면 null.
 *
 * 깊이: doc(0) > blockGroup(1) > blockContainer(2) > blockGroup(3) > …
 * 그래서 그룹의 깊이가 1 이면 루트 그룹이고 나갈 곳이 없다.
 */
function parentContainerPos(doc: PmNode, pos: number): number | null {
  const $pos = doc.resolve(pos)
  if ($pos.depth <= 1) return null
  return $pos.before($pos.depth - 1)
}

/**
 * 어디로 갈지 계산한다. 문서를 고치지 않는다.
 *
 * `sources` 는 **연속 형제여야 한다.** 서로 다른 그룹이나 떨어진 형제를 한
 * 덩어리로 옮기는 것은 "상대 순서를 유지한 채 이동"(F-01-08)이 무엇을 뜻하는지
 * 정의되지 않는다 — 중간에 낀 블록은 따라가야 하는가? 거부하고 이유를 말한다.
 */
export function planBlockMove(
  doc: PmNode,
  roots: readonly number[],
  direction: 1 | -1,
): MovePlan {
  if (roots.length === 0) return { kind: 'no_blocks' }

  const sources = [...roots].sort((a, b) => a - b)
  const groupPos = groupPosOf(doc, sources[0])

  // 같은 그룹의 연속 형제인가.
  let expected = indexIn(doc, sources[0])
  for (const pos of sources) {
    if (groupPosOf(doc, pos) !== groupPos) return { kind: 'not_siblings' }
    if (indexIn(doc, pos) !== expected) return { kind: 'not_siblings' }
    expected += 1
  }

  const group = doc.nodeAt(groupPos)
  if (!group) return { kind: 'no_blocks' }

  const firstIndex = indexIn(doc, sources[0])
  const lastIndex = indexIn(doc, sources[sources.length - 1])

  if (direction === 1) {
    if (lastIndex + 1 < group.childCount) {
      // 다음 형제 **뒤**로. 그 형제가 자식을 가질 수 있어도 안으로 들어가지 않는다.
      const lastPos = sources[sources.length - 1]
      const lastNode = doc.nodeAt(lastPos)
      if (!lastNode) return { kind: 'no_blocks' }
      const nextPos = lastPos + lastNode.nodeSize
      const nextNode = doc.nodeAt(nextPos)
      if (!nextNode) return { kind: 'no_blocks' }
      return { kind: 'move', sources, insertAt: nextPos + nextNode.nodeSize, outdents: false }
    }

    // 마지막 형제다 → 부모 밖으로.
    const parentPos = parentContainerPos(doc, sources[0])
    if (parentPos === null) return { kind: 'at_boundary' }
    const parentNode = doc.nodeAt(parentPos)
    if (!parentNode) return { kind: 'no_blocks' }
    return { kind: 'move', sources, insertAt: parentPos + parentNode.nodeSize, outdents: true }
  }

  if (firstIndex > 0) {
    // 이전 형제 **앞**으로.
    const $first = doc.resolve(sources[0])
    const prevNode = group.child(firstIndex - 1)
    return { kind: 'move', sources, insertAt: $first.pos - prevNode.nodeSize, outdents: false }
  }

  const parentPos = parentContainerPos(doc, sources[0])
  if (parentPos === null) return { kind: 'at_boundary' }
  return { kind: 'move', sources, insertAt: parentPos, outdents: true }
}

/**
 * 계획을 문서에 적용한다.
 *
 * **문서 뒤쪽 연산을 먼저 한다.** 삽입 위치가 원본보다 뒤면(아래로 이동) 삽입
 * 먼저, 앞이면(위로 이동) 삭제 먼저다. 그러면 나중 연산의 위치가 밀리지 않아
 * 매핑이 필요 없다 — `replaceBlockSelection` 이 역순으로 지우는 것과 같은 이유다.
 *
 * 삭제 범위는 `blockDeletionRanges()` 가 준다. 그 함수가 **자식이 전부 빠져나가
 * 비게 되는 `blockGroup` 을 그룹째** 처리한다. 빈 그룹은 `blockContainer+` 를
 * 어겨서 `tr.delete()` 가 그 자리에서 던진다 — 이동에서도 똑같이 만나는 지뢰다.
 */
export function applyBlockMove(tr: Transaction, plan: Extract<MovePlan, { kind: 'move' }>): boolean {
  const moving: PmNode[] = []
  for (const pos of plan.sources) {
    const node = tr.doc.nodeAt(pos)
    if (!node) return false
    moving.push(node)
  }

  const { ranges } = blockDeletionRanges(tr.doc, plan.sources)
  if (ranges.length === 0) return false

  const remove = (): void => {
    for (let i = ranges.length - 1; i >= 0; i -= 1) tr.delete(ranges[i].from, ranges[i].to)
  }

  if (plan.insertAt > ranges[ranges.length - 1].to) {
    tr.insert(plan.insertAt, moving)
    remove()
  } else {
    remove()
    tr.insert(plan.insertAt, moving)
  }
  return true
}

/**
 * `Mod+Shift+↑↓` — 블록을 한 자리 위/아래로 (F-12-01 시나리오 4).
 *
 * 블록 선택 모드면 선택된 최상위 블록 전부를, 편집 모드면 캐럿이 있는 블록
 * 하나를 옮긴다. 어느 쪽이든 옮긴 뒤 **원래 상태로 돌아온다** — 선택은 선택으로,
 * 캐럿은 같은 오프셋으로. 연속으로 눌러 여러 칸 옮길 수 있어야 하기 때문이다.
 */
export function moveBlocksCommand(direction: 1 | -1, deps: CommandDeps): Command {
  return (state, dispatch) => {
    const sel = state.selection
    const blockMode = isBlockSelection(sel)

    let roots: readonly number[]
    let caretOffset = 0
    if (blockMode) {
      roots = sel.rootPositions
    } else {
      const info = containerAt(sel.$from)
      if (!info || info.id === '') return false
      roots = [info.pos]
      caretOffset = sel.$from.parent.isTextblock ? sel.$from.parentOffset : 0
    }

    const doc = state.doc
    const blockIds = roots.map((pos) => String(doc.nodeAt(pos)?.attrs.blockId ?? ''))
    const plan = planBlockMove(doc, roots, direction)

    if (plan.kind === 'not_siblings') {
      deps.onRefused?.(MOVE_NOT_SIBLINGS_REFUSAL)
      return true
    }
    // 문서 끝이다. `true` 를 돌려 편집 모드 커맨드로 흘려보내지 않는다 —
    // 블록 선택 상태에서 흘러가면 캐럿이 생겨 모드가 풀린다.
    if (plan.kind !== 'move') return blockMode

    const tr = state.tr
    if (!applyBlockMove(tr, plan)) return false

    // 옮긴 뒤 id 로 다시 찾는다. 위치를 손으로 매핑하지 않는다.
    const first = findContainerById(tr.doc, blockIds[0])
    const last = findContainerById(tr.doc, blockIds[blockIds.length - 1])
    if (first && last) {
      if (blockMode) {
        tr.setSelection(BlockSelection.create(tr.doc, first.pos, last.pos))
      } else if (first.contentNode.isTextblock) {
        const max = first.contentNode.content.size
        const at = first.contentPos + 1 + Math.max(0, Math.min(caretOffset, max))
        tr.setSelection(TextSelection.create(tr.doc, at))
      }
    }

    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
}
