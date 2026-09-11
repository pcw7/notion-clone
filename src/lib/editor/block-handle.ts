/**
 * 블록 핸들의 규칙 — F-01-08 (드래그 · `+` 버튼 · 클릭 선택)
 *
 * 정본: 01-block-editor.md F-01-08
 *
 * 화면(`block-gutter.tsx`)은 포인터 좌표와 블록 사각형만 읽고, **무엇을 할지는
 * 전부 여기서** 정한다. 좌표 → 드롭 판정(`resolveDrop`)은 사각형 배열을 받는
 * 순수 함수라 DOM 없이 테스트된다. 화면 쪽에 규칙을 쓰기 시작하면 그 순간부터
 * 테스트할 수 없는 코드가 된다(`body-editor.tsx` 머리말과 같은 원칙).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 드롭 존 — 정본의 3종 중 2종
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본: *"드롭 존 3종: **형제 삽입(위/아래)**, **자식 삽입(들여쓴 위치)**,
 * **컬럼 생성(좌/우 측면)**."* 컬럼 생성은 F-01-12 이고 정본이 P1 으로 잘랐다.
 *
 * 한 줄을 위아래 절반으로 나눈다.
 *   - 위 절반 → 그 블록 **앞**
 *   - 아래 절반 → 그 블록 **뒤**. 단 둘 중 하나면 **첫 자식 자리**다:
 *       ⓐ 그 블록에 **보이는 자식**이 있다 — 화면에서 바로 아랫줄이 첫 자식이므로
 *          "뒤"(subtree 전체 다음)에 가이드를 그리면 포인터에서 한참 떨어진 곳에
 *          선이 생긴다. 포인터 바로 밑이 첫 자식 자리다.
 *       ⓑ 포인터가 한 단 들여쓴 위치보다 오른쪽이다 — 노션의 "들여쓴 위치" 드롭.
 *
 * 키보드 이동(`block-move.ts`)과 달리 **드래그는 안으로 들어갈 수 있다.** 키보드는
 * 한 키에 순서와 깊이를 섞으면 예측할 수 없어서 막았지만, 드래그는 가이드가
 * 목적지를 **먼저 보여준다** — 놓기 전에 어디로 가는지 안다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 계획은 id 로 들고 가서 지운 **뒤에** 목적지를 다시 찾는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 키보드 이동은 소스가 연속 형제라 "뒤쪽 연산 먼저"로 매핑 없이 끝났다. 드래그는
 * 떨어진 선택(깊이가 섞인 블록들)도 한곳으로 모을 수 있어야 하는데(정본: *"선택
 * subtree 들이 상대 순서를 유지한 채 이동"*), 그러면 목적지가 소스들 **사이**에
 * 있을 수 있다. 어느 순서로 해도 한쪽 위치가 밀린다.
 *
 * 그래서 목적지를 위치가 아니라 **블록 id + 종류(앞/뒤/첫 자식)** 로 들고 가서,
 * 소스를 지운 문서에서 id 로 다시 찾는다. `pm-blocks.ts` 의 `findContainerById`
 * 가 말하는 원칙 그대로다 — 위치 매핑 실수는 "블록이 엉뚱한 데로 갔다"로
 * 나타나고 재현이 어렵다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { TextSelection, type Command, type EditorState } from '@tiptap/pm/state'

import { blockDeletionRanges, BlockSelection, isBlockSelection } from './block-selection.ts'
import type { CommandDeps } from './commands.ts'
import { newBlockId } from './pm-adapter.ts'
import { canNestUnder, describeContainer, findContainerById, visibleBlocks } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'

// ── 드롭 후보 ─────────────────────────────────────────────────────────

/** 드롭 후보 한 줄의 문서 쪽 정보. 좌표는 화면이 채운다. */
export type LineInfo = {
  readonly blockId: string
  /** 컨테이너 노드 앞의 위치. 화면이 `view.nodeDOM(pos)` 로 DOM 을 찾는다. */
  readonly pos: number
  /** 이 블록 밑에 자식을 둘 수 있는가 — `canNestUnder`. */
  readonly canNest: boolean
  /** 화면에 보이는 자식이 있는가(자식이 있고 펼쳐져 있다). */
  readonly hasVisibleChildren: boolean
}

/** 좌표까지 채운 한 줄. 좌표는 화면이 정한 기준(프레임) 상대값이다. */
export type BlockLine = LineInfo & {
  /** 이 블록 **자신의 줄**(자식 제외)의 위·아래. */
  readonly top: number
  readonly bottom: number
  /** 내용이 시작하는 x. 들여쓰기 판정과 가이드의 시작점. */
  readonly contentLeft: number
}

/** 이 블록들(자손 포함)의 id. */
export function subtreeIds(doc: PmNode, rootIds: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const id of rootIds) {
    const info = findContainerById(doc, id)
    if (!info) continue
    out.add(info.id)
    info.node.descendants((node) => {
      if (node.type.name === 'blockContainer') out.add(String(node.attrs.blockId ?? ''))
      return true
    })
  }
  return out
}

/**
 * 드롭 후보가 될 줄들. **화면 순서**이고, 끌고 있는 블록의 subtree 는 뺀다.
 *
 * 빼는 이유가 정본의 엣지 케이스다: *"자기 자신 또는 후손 위로 드롭 → 차단
 * (**드롭 존 비활성**)."* 후보에서 아예 없애면 그 위에는 가이드가 그려지지
 * 않는다 — 놓았다가 거부당하는 것보다 처음부터 자리가 없는 편이 낫다.
 */
export function dropCandidates(
  doc: PmNode,
  isCollapsed: (blockId: string) => boolean,
  draggedIds: readonly string[],
): LineInfo[] {
  const excluded = subtreeIds(doc, draggedIds)
  const out: LineInfo[] = []
  for (const entry of visibleBlocks(doc, isCollapsed).order) {
    const block = entry.node
    if (excluded.has(block.id)) continue
    const node = doc.nodeAt(block.pos)
    if (!node) continue
    const info = describeContainer(node, block.pos)
    out.push({
      blockId: block.id,
      pos: block.pos,
      canNest: canNestUnder(info),
      hasVisibleChildren: block.children.length > 0 && !block.collapsed,
    })
  }
  return out
}

// ── 좌표 → 드롭 ───────────────────────────────────────────────────────

export type DropTarget = {
  /** 그 블록 앞 / 뒤(subtree 다음) / 첫 자식 자리. */
  readonly kind: 'before' | 'after' | 'child'
  readonly blockId: string
}

export type DropHit = { readonly target: DropTarget; readonly line: BlockLine }

/**
 * 포인터가 가리키는 드롭 자리.
 *
 * 줄은 화면 순서라 `top` 이 오름차순이다. **이진 탐색**으로 찾는다 — 정본
 * 엣지 케이스 *"대용량 — 긴 페이지 드래그 | 드롭 타겟 계산을 …"* 에 대해,
 * pointermove 는 초당 60번 오고 줄은 수천 개일 수 있다.
 *
 * 줄 사이 틈이나 문서 위·아래 바깥에 포인터가 있으면 **가장 가까운 줄**을 쓴다.
 * 끌고 있는 블록의 자리는 후보에서 빠져 있으므로(`dropCandidates`) 그 위에서는
 * 바로 위·아래 줄이 잡히고, 결과는 제자리다.
 *
 * @param indent 한 단 들여쓰기의 폭(px). `.blk-group` 의 margin-left 와 같아야 한다.
 */
export function resolveDrop(
  lines: readonly BlockLine[],
  x: number,
  y: number,
  indent: number,
): DropHit | null {
  if (lines.length === 0) return null

  // top ≤ y 인 마지막 줄.
  let lo = 0
  let hi = lines.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lines[mid].top <= y) lo = mid
    else hi = mid - 1
  }

  const distance = (line: BlockLine): number =>
    y < line.top ? line.top - y : y > line.bottom ? y - line.bottom : 0
  let line = lines[lo]
  const next = lines[lo + 1]
  if (next && distance(next) < distance(line)) line = next

  if (y < (line.top + line.bottom) / 2) {
    return { target: { kind: 'before', blockId: line.blockId }, line }
  }
  // ⓐ 보이는 자식이 있으면 바로 아랫줄이 첫 자식이다.
  if (line.hasVisibleChildren) {
    return { target: { kind: 'child', blockId: line.blockId }, line }
  }
  // ⓑ 한 단 들여쓴 위치보다 오른쪽이면 자식으로.
  if (line.canNest && x >= line.contentLeft + indent) {
    return { target: { kind: 'child', blockId: line.blockId }, line }
  }
  return { target: { kind: 'after', blockId: line.blockId }, line }
}

/** 파란 가이드 라인의 자리. 항상 포인터가 있는 줄의 위 또는 아래 경계다. */
export function dropGuide(hit: DropHit, indent: number): { top: number; left: number } {
  const { target, line } = hit
  switch (target.kind) {
    case 'before':
      return { top: line.top, left: line.contentLeft }
    case 'after':
      return { top: line.bottom, left: line.contentLeft }
    case 'child':
      return { top: line.bottom, left: line.contentLeft + indent }
  }
}

// ── 드롭 계획과 적용 ──────────────────────────────────────────────────

export type DropPlan =
  | {
      readonly kind: 'drop'
      /** 옮길 최상위 블록들의 id. 문서 순서 — 이 순서대로 모인다. */
      readonly sourceIds: readonly string[]
      readonly target: DropTarget
      /** 접힌 블록 안으로 들어가면 펼칠 블록. */
      readonly expand: string | null
    }
  /** 자기 자신·후손 위, 자식을 둘 수 없는 블록 밑, 또는 사라진 블록. */
  | { readonly kind: 'invalid_target' }
  | { readonly kind: 'no_blocks' }

/**
 * 드롭을 계산한다. 문서를 고치지 않는다.
 *
 * 화면이 후보에서 이미 걸렀더라도 여기서 **다시** 막는다. 드래그 도중 문서가
 * 바뀔 수 있고(Phase 1 의 협업), 화면의 판단을 믿는 계층은 화면이 바뀌면 같이
 * 무너진다.
 */
export function planDrop(
  doc: PmNode,
  rootIds: readonly string[],
  target: DropTarget,
  isCollapsed: (blockId: string) => boolean,
): DropPlan {
  const sources: { id: string; pos: number; size: number }[] = []
  for (const id of rootIds) {
    const info = findContainerById(doc, id)
    if (info) sources.push({ id, pos: info.pos, size: info.node.nodeSize })
  }
  if (sources.length === 0) return { kind: 'no_blocks' }
  sources.sort((a, b) => a.pos - b.pos)

  const dest = findContainerById(doc, target.blockId)
  if (!dest) return { kind: 'invalid_target' }

  // 정본: "자기 자신 또는 후손 위로 드롭 → 차단". 자기 subtree 안으로 옮기면
  // 블록이 자기 자신의 자손이 된다 — 트리가 아니게 된다.
  for (const s of sources) {
    if (dest.pos >= s.pos && dest.pos < s.pos + s.size) return { kind: 'invalid_target' }
  }

  if (target.kind === 'child' && !canNestUnder(dest)) return { kind: 'invalid_target' }

  // 접힌 블록 안으로 들어가면 화면에서 사라진다 — 펼친다. `planMerge` 가 접힌
  // 대상으로 자식을 이관할 때 앞 블록을 펼치는 것과 같은 판결이다(HANDOFF §3.2-5).
  const expand = target.kind === 'child' && isCollapsed(dest.id) ? dest.id : null

  return { kind: 'drop', sourceIds: sources.map((s) => s.id), target, expand }
}

/**
 * 계획을 문서에 적용하고 옮긴 블록 id 를 돌려준다. 실패하면 null.
 *
 * ① 소스를 들어낸다 — `blockDeletionRanges` 가 빈 그룹을 그룹째 치운다
 *   (`blockGroup: blockContainer+`, 빈 채로 두면 `tr.delete()` 가 던진다)
 * ② **지운 문서에서** 목적지를 id 로 다시 찾는다
 * ③ 넣는다. 목적지에 자식 그룹이 없으면 그룹을 만들어 넣는다
 */
export function applyDrop(
  tr: EditorState['tr'],
  plan: Extract<DropPlan, { kind: 'drop' }>,
): string[] | null {
  const positions: number[] = []
  const moving: PmNode[] = []
  for (const id of plan.sourceIds) {
    const info = findContainerById(tr.doc, id)
    if (!info) return null
    positions.push(info.pos)
    moving.push(info.node)
  }

  const { ranges, emptiesDoc } = blockDeletionRanges(tr.doc, positions)
  // 문서 전체를 끌었다면 놓을 자리가 문서 밖뿐이다. 계획 단계에서 막히지만 방어한다.
  if (ranges.length === 0 || emptiesDoc) return null
  for (let i = ranges.length - 1; i >= 0; i -= 1) tr.delete(ranges[i].from, ranges[i].to)

  const dest = findContainerById(tr.doc, plan.target.blockId)
  if (!dest) return null

  switch (plan.target.kind) {
    case 'before':
      tr.insert(dest.pos, moving)
      break
    case 'after':
      tr.insert(dest.pos + dest.node.nodeSize, moving)
      break
    case 'child':
      if (dest.groupPos !== null) {
        tr.insert(dest.groupPos + 1, moving)
      } else {
        tr.insert(
          dest.contentPos + dest.contentNode.nodeSize,
          blockSchema.nodes.blockGroup.create(null, moving),
        )
      }
      break
  }

  return moving.map((node) => String(node.attrs.blockId ?? ''))
}

/**
 * 드롭. 옮긴 블록들이 블록 선택 상태로 남는다 — 이어서 `Mod+Shift+↑↓` 로
 * 미세 조정하거나 `Backspace` 로 지울 수 있게.
 *
 * 제자리에 놓았으면 아무 것도 하지 않는다. 트랜잭션을 만들면 undo 스택에 빈
 * 항목이 쌓여서, Cmd+Z 한 번이 "아무 일도 안 일어난 것"을 되돌린다.
 */
export function dropBlocksCommand(
  rootIds: readonly string[],
  target: DropTarget,
  deps: CommandDeps,
): Command {
  return (state, dispatch) => {
    const plan = planDrop(state.doc, rootIds, target, deps.isCollapsed)
    if (plan.kind !== 'drop') return false

    const tr = state.tr
    const moved = applyDrop(tr, plan)
    if (!moved) return false
    if (tr.doc.eq(state.doc)) return false

    const first = findContainerById(tr.doc, moved[0])
    const last = findContainerById(tr.doc, moved[moved.length - 1])
    if (first && last) tr.setSelection(BlockSelection.create(tr.doc, first.pos, last.pos))

    if (dispatch) dispatch(tr.scrollIntoView())
    // 펼침은 dispatch **뒤에**. 펼침이 빈 트랜잭션으로 다시 그리게 하므로,
    // 앞에서 부르면 우리 트랜잭션이 낡은 state 위에 얹힌다.
    if (plan.expand) deps.expand?.(plan.expand)
    return true
  }
}

// ── 핸들이 무엇을 잡는가 ──────────────────────────────────────────────

/**
 * 이 블록의 핸들을 잡으면 무엇이 딸려 오는가.
 *
 * 그 블록이 **이미 선택된 덩어리 안**이면(선택된 루트이거나 그 자손이면) 선택
 * 전체다 — 정본: *"다중 선택 드래그 → 선택 subtree 들이 상대 순서를 유지한 채
 * 이동."* 선택 밖의 블록이면 그 블록 하나다. 하이라이트된 블록의 핸들을 잡았는데
 * 하나만 끌려 나오면 사용자는 선택이 풀렸다고 느낀다.
 */
export function handleTargets(state: EditorState, blockPos: number): string[] {
  const sel = state.selection
  const doc = state.doc
  if (isBlockSelection(sel)) {
    const inside = sel.rootPositions.some((pos) => {
      const node = doc.nodeAt(pos)
      return node !== null && blockPos >= pos && blockPos < pos + node.nodeSize
    })
    if (inside) return sel.blockIds
  }
  const node = doc.nodeAt(blockPos)
  return node ? [String(node.attrs.blockId ?? '')] : []
}

/** 핸들 클릭 — 잡은 것을 블록 선택으로. 다음 PR 의 핸들 메뉴가 이 선택에 동작한다. */
export function selectHandleTargetsCommand(rootIds: readonly string[]): Command {
  return (state, dispatch) => {
    const positions = rootIds
      .map((id) => findContainerById(state.doc, id)?.pos)
      .filter((pos): pos is number => pos !== undefined)
      .sort((a, b) => a - b)
    if (positions.length === 0) return false
    if (dispatch) {
      dispatch(
        state.tr.setSelection(
          BlockSelection.create(state.doc, positions[0], positions[positions.length - 1]),
        ),
      )
    }
    return true
  }
}

// ── + 버튼 ────────────────────────────────────────────────────────────

/**
 * `+` — 이 블록 바로 아랫줄에 빈 문단을 만들고 `/` 메뉴를 연다 (F-01-08 시나리오 1).
 *
 * `/` 를 **문서에 실제로 넣는다.** 슬래시 메뉴는 "방금 들어온 글자가 줄 시작의
 * `/` 인가"로 열리므로(`slash-menu.ts`), 메뉴를 여는 별도 통로를 만들지 않아도
 * 된다. 통로가 둘이면 한쪽만 고쳐진다. 문단 생성과 `/` 가 한 트랜잭션이라
 * `Cmd+Z` 한 번에 둘 다 사라진다.
 *
 * 자리는 분할(Enter)과 같은 판결을 따른다 — *새 블록은 화면에서 원본 바로
 * 다음 줄에 온다*(HANDOFF §3.2-4). 펼쳐진 자식이 있으면 첫 자식, 아니면 형제.
 */
export function insertBlockBelowCommand(blockId: string, deps: CommandDeps): Command {
  return (state, dispatch) => {
    const info = findContainerById(state.doc, blockId)
    if (!info) return false

    const id = (deps.newId ?? newBlockId)()
    const paragraph = blockSchema.nodes.blockContainer.create(
      { blockId: id },
      blockSchema.nodes.paragraph.create({ props: {}, format: {} }, blockSchema.text('/')),
    )

    const expanded =
      info.groupPos !== null &&
      info.groupNode !== null &&
      info.groupNode.childCount > 0 &&
      !deps.isCollapsed(info.id)
    const at = expanded && info.groupPos !== null ? info.groupPos + 1 : info.pos + info.node.nodeSize

    const tr = state.tr.insert(at, paragraph)
    const fresh = findContainerById(tr.doc, id)
    if (!fresh) return false
    // `/` 뒤에 캐럿.
    tr.setSelection(TextSelection.create(tr.doc, fresh.contentPos + 2))
    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
}
