/**
 * 멀티 블록 선택 — F-01-09
 *
 * 정본: 01-block-editor.md F-01-09, 12-platform-ux.md F-12-01 · F-12-12
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 커스텀 Selection 인가 (플러그인 상태가 아니라)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 선택된 블록 집합을 플러그인 상태에 두면 `state.selection` 과 **두 개의 진실**이
 * 생긴다. 캐럿은 여전히 어딘가에 있으므로 타이핑이 그 블록에 들어가고, 문서가
 * 바뀔 때(협업자의 편집, `blockIdPlugin` 의 보정) 집합을 손으로 다시 매핑해야
 * 한다. F-01-09 엣지 케이스가 요구하는 *"선택 중 다른 사용자가 해당 블록 삭제 →
 * **선택 집합에서 자동 제외**"* 가 바로 그 매핑이다.
 *
 * ProseMirror 의 `Selection` 을 상속하면 그 매핑이 공짜로 온다 — 트랜잭션마다
 * `map()` 이 불린다. `prosemirror-tables` 의 `CellSelection` 이 같은 이유로
 * 같은 선택을 했고, 우리는 그 전례를 그대로 따른다(`visible = false`,
 * 범위 배열, `replace()` 재정의).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 선택은 "두 경계" 이고, 그 사이의 최상위 블록이 대상이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-01-09 클론 대안: *"MVP 는 연속 범위 선택만(anchor/head 인덱스 두 개)."*
 * 그대로다. `$anchorBlock` · `$headBlock` 두 위치만 저장하고, 대상 블록은
 * **문서에서 매번 계산**한다.
 *
 * 계산의 규칙이 정본의 요구다: *"중첩 — 부모와 자식을 함께 선택 후 이동 |
 * 자식 중복 이동 금지 → **최상위 노드만 추출(top-level normalization)** 필수."*
 * `rootsBetween()` 이 그것이고, 그래서 **자식은 목록에 없고 부모에 딸려 온다.**
 * 삭제·복제·이동이 자손을 두 번 건드릴 방법이 구조적으로 없어진다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 접힘은 선택이 아니라 **확장**의 문제다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 어떤 블록이 두 경계 사이에 있는가는 문서 순서만으로 정해진다 — 접힌 자식도
 * 문서 안에 그대로 있으므로 선택에 포함된다(접힌 토글을 지우면 자식도 지워지는
 * 것이 맞다). 반면 `Shift+↓` 가 **다음에 무엇을 잡는가**는 화면 순서의 문제다.
 * 그래서 `BlockSelection` 자체는 접힘을 모르고, 확장 커맨드만 `isCollapsed` 를
 * 받는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 하위 페이지는 이 경로로 지워지지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `save-page-body.ts`: *"문서에서 자식 페이지가 빠져 있으면 **저장을 거부한다** —
 * 낡은 에디터 탭 하나가 하위 페이지를 통째로 지워버리는 경로를 만들지 않기
 * 위해서."* 블록 선택 삭제는 정확히 그 경로가 될 수 있으므로, 선택에 하위 페이지
 * 참조가 하나라도 있으면 **아무 것도 지우지 않고** 이유를 보여준다.
 */

import { Fragment, Slice, type Node as PmNode, type ResolvedPos } from '@tiptap/pm/model'
import {
  Selection,
  SelectionRange,
  TextSelection,
  type Command,
  type EditorState,
  type SelectionBookmark,
  type Transaction,
} from '@tiptap/pm/state'
import type { Mappable } from '@tiptap/pm/transform'

import type { BlockType } from '../block/types.ts'
import { applyTurnInto, type CommandDeps } from './commands.ts'
import { newBlockId } from './pm-adapter.ts'
import { containerAt, findContainerById, visibleBlocks, type VisibleBlock } from './pm-blocks.ts'
import { blockSchema, PAGE_REF_NODE } from './schema.ts'
import type { VisibleEntry, VisibleIndex } from './tree.ts'

const CONTAINER = 'blockContainer'
const GROUP = 'blockGroup'

/** 하위 페이지가 섞인 선택을 파괴적으로 다루려 할 때 보여줄 이유. */
export const PAGE_REF_REFUSAL =
  '선택에 하위 페이지가 들어 있어 그대로 두었습니다. 하위 페이지는 휴지통으로만 삭제합니다.'

// ── 위치 유틸 ─────────────────────────────────────────────────────────

/** 이 위치가 `blockContainer` 바로 앞을 가리키는가. */
export function pointsAtContainer($pos: ResolvedPos): boolean {
  return $pos.parent.type.name === GROUP && $pos.nodeAfter?.type.name === CONTAINER
}

/**
 * 두 경계 사이의 **최상위 블록** 위치들 (top-level normalization).
 *
 * 정본 F-01-09: *"자식 중복 이동 금지 → 최상위 노드만 추출."*
 * 어떤 블록을 담으면 그 자손은 담지 않는다 — `nodesBetween` 의 콜백에서
 * `false` 를 돌려주는 것이 그 한 줄이다.
 *
 * 경계는 **컨테이너 앞 위치**이고, 경계에서 시작하는 컨테이너는 포함된다.
 * 범위에 걸치기만 한 조상(경계보다 앞에서 시작하는 컨테이너)은 담지 않고
 * 안으로 들어간다 — 그러지 않으면 자식 하나를 고르려 할 때 부모가 통째로 잡힌다.
 */
export function rootsBetween(doc: PmNode, a: number, b: number): number[] {
  const from = Math.min(a, b)
  const to = Math.max(a, b)
  const roots: number[] = []

  // `nodesBetween` 은 `pos < to` 인 자식만 방문한다. `to` 에서 시작하는
  // 컨테이너까지 보려면 한 칸 더 줘야 한다.
  doc.nodesBetween(from, to + 1, (node, pos) => {
    const name = node.type.name
    if (name === GROUP) return true
    // blockContent(paragraph·heading…) 안에는 컨테이너가 없다.
    if (name !== CONTAINER) return false
    if (pos < from || pos > to) return true
    roots.push(pos)
    return false
  })

  return roots
}

/** 이 컨테이너(자손 포함)가 하위 페이지 참조를 품고 있는가. */
export function containsPageRef(container: PmNode): boolean {
  let found = false
  container.descendants((node) => {
    if (found) return false
    if (node.type.name === PAGE_REF_NODE) {
      found = true
      return false
    }
    return true
  })
  return found
}

/** 선택된 최상위 블록 중 하나라도 하위 페이지를 품고 있는가. */
export function selectionHasPageRef(doc: PmNode, roots: readonly number[]): boolean {
  return roots.some((pos) => {
    const node = doc.nodeAt(pos)
    return node !== null && containsPageRef(node)
  })
}

// ── Selection ─────────────────────────────────────────────────────────

/**
 * 연속 범위 블록 선택.
 *
 * `ranges` 는 **최상위 블록 하나당 하나**다. 하나의 평평한 범위로 합칠 수 없는
 * 이유는 선택이 서로 다른 깊이에 걸칠 수 있기 때문이다 — 예를 들어 "A 의 마지막
 * 자식"과 "A 의 다음 형제"는 화면에서 붙어 있지만 문서 위치 사이에는 A 의 닫는
 * 토큰이 끼어 있다. 합친 범위를 지우면 그 토큰까지 지워져 트리가 무너진다.
 */
export class BlockSelection extends Selection {
  /** 선택을 시작한 블록 **앞**의 위치. 움직이지 않는 쪽. */
  readonly $anchorBlock: ResolvedPos
  /** 확장으로 움직이는 쪽. */
  readonly $headBlock: ResolvedPos
  /** 선택된 최상위 컨테이너들의 위치. 문서 순서. */
  readonly rootPositions: readonly number[]

  constructor($anchorBlock: ResolvedPos, $headBlock: ResolvedPos = $anchorBlock) {
    const doc = $anchorBlock.node(0)
    const roots = rootsBetween(doc, $anchorBlock.pos, $headBlock.pos)
    if (roots.length === 0) {
      throw new RangeError('블록 선택이 블록을 하나도 담지 못했습니다')
    }

    const ranges = roots.map((pos) => {
      const node = doc.nodeAt(pos)
      if (!node) throw new RangeError(`위치 ${pos} 에 블록이 없습니다`)
      return new SelectionRange(doc.resolve(pos), doc.resolve(pos + node.nodeSize))
    })

    // ⚠ 기준 anchor·head 는 **선택 범위의 양끝**이다. `$anchorBlock`/`$headBlock`
    // 을 그대로 넘기면 블록 하나를 고른 경우 둘이 같아서 **DOM 선택이 접힌다.**
    // 그러면 브라우저의 복사 명령이 "복사할 것이 없다"고 보고 `copy` 이벤트 자체를
    // 일으키지 않아, 블록 하나를 골라 Ctrl+C 하면 아무 일도 일어나지 않는다
    // (실제 브라우저 검증에서 잡았다). `CellSelection` 도 같은 이유로 셀 내용의
    // 양끝을 기준으로 준다. 우리 판정은 아래 두 필드만 쓰므로 영향이 없다.
    super(ranges[0].$from, ranges[ranges.length - 1].$to, ranges)
    this.$anchorBlock = $anchorBlock
    this.$headBlock = $headBlock
    this.rootPositions = roots
  }

  /** 선택된 최상위 블록들의 `block.id`. 문서 순서. */
  get blockIds(): string[] {
    const doc = this.$anchorBlock.node(0)
    return this.rootPositions.map((pos) => String(doc.nodeAt(pos)?.attrs.blockId ?? ''))
  }

  eq(other: Selection): boolean {
    return (
      other instanceof BlockSelection &&
      other.$anchorBlock.pos === this.$anchorBlock.pos &&
      other.$headBlock.pos === this.$headBlock.pos
    )
  }

  /**
   * 문서가 바뀌면 경계만 옮긴다. 대상 블록은 생성자가 다시 계산한다.
   *
   * 경계가 더 이상 컨테이너를 가리키지 않으면(= 그 블록이 사라졌다) 블록 선택을
   * 포기하고 가까운 캐럿으로 떨어진다. F-01-09: *"선택 중 다른 사용자가 해당
   * 블록 삭제 → 선택 집합에서 자동 제외."*
   */
  map(doc: PmNode, mapping: Mappable): Selection {
    const $anchor = doc.resolve(mapping.map(this.$anchorBlock.pos))
    const $head = doc.resolve(mapping.map(this.$headBlock.pos))
    if (pointsAtContainer($anchor) && pointsAtContainer($head)) {
      return new BlockSelection($anchor, $head)
    }
    return Selection.near($head, 1)
  }

  /**
   * 복사할 내용 — 최상위 컨테이너들을 그대로.
   *
   * `openStart`/`openEnd` 가 0 이라 붙여넣을 때 블록 경계가 열리지 않는다.
   * 구조 보존 복붙(F-01-10)의 내부 경로가 이 슬라이스를 쓰게 된다.
   */
  content(): Slice {
    const doc = this.$anchorBlock.node(0)
    const nodes: PmNode[] = []
    for (const pos of this.rootPositions) {
      const node = doc.nodeAt(pos)
      if (node) nodes.push(node)
    }
    return new Slice(Fragment.fromArray(nodes), 0, 0)
  }

  replace(tr: Transaction, content: Slice = Slice.empty): void {
    replaceBlockSelection(tr, this, content)
  }

  replaceWith(tr: Transaction, node: PmNode): void {
    this.replace(tr, new Slice(Fragment.from(node), 0, 0))
  }

  toJSON(): unknown {
    return { type: 'block', anchor: this.$anchorBlock.pos, head: this.$headBlock.pos }
  }

  static fromJSON(doc: PmNode, json: { anchor: number; head: number }): BlockSelection {
    return new BlockSelection(doc.resolve(json.anchor), doc.resolve(json.head))
  }

  /** 컨테이너 앞 위치 두 개로 만든다. */
  static create(doc: PmNode, anchorPos: number, headPos: number = anchorPos): BlockSelection {
    return new BlockSelection(doc.resolve(anchorPos), doc.resolve(headPos))
  }

  getBookmark(): SelectionBookmark {
    return new BlockBookmark(this.$anchorBlock.pos, this.$headBlock.pos)
  }
}

// 캐럿이 없는 선택이다. 브라우저 selection 을 그리지 않게 한다 —
// `CellSelection` 과 같다. 하이라이트는 데코레이션이 담당한다.
BlockSelection.prototype.visible = false

/**
 * ⚠ `jsonID` 는 **전역** 레지스트리다. Next.js 의 Fast Refresh 가 이 모듈을 다시
 * 평가하면 같은 id 로 두 번 등록되어 `RangeError` 가 나고, 그 예외 하나로
 * 에디터 전체가 뜨지 않는다. 등록은 `EditorState.fromJSON` 을 쓸 때만 필요하고
 * 우리는 쓰지 않으므로, 실패해도 무시하는 편이 안전하다.
 */
try {
  Selection.jsonID('block', BlockSelection)
} catch {
  // 이미 등록됨(모듈 재평가).
}

/** 히스토리가 문서 없이 들고 다니는 형태. */
class BlockBookmark implements SelectionBookmark {
  readonly anchor: number
  readonly head: number

  // ⚠ 파라미터 프로퍼티(`constructor(readonly anchor: number)`)를 쓰지 않는다 —
  // node 의 strip-only TypeScript 모드가 지원하지 않아 `node --test` 가 죽는다.
  constructor(anchor: number, head: number) {
    this.anchor = anchor
    this.head = head
  }

  map(mapping: Mappable): BlockBookmark {
    return new BlockBookmark(mapping.map(this.anchor), mapping.map(this.head))
  }

  resolve(doc: PmNode): Selection {
    const $anchor = doc.resolve(this.anchor)
    const $head = doc.resolve(this.head)
    if (pointsAtContainer($anchor) && pointsAtContainer($head)) {
      return new BlockSelection($anchor, $head)
    }
    return Selection.near($head, 1)
  }
}

export function isBlockSelection(selection: Selection): selection is BlockSelection {
  return selection instanceof BlockSelection
}

// ── 삭제 ──────────────────────────────────────────────────────────────

export type DeletionRange = { readonly from: number; readonly to: number }

/**
 * 무엇을 지울지 계산한다.
 *
 * 단순히 "선택된 컨테이너들"이 아니다. **자식이 전부 사라지는 `blockGroup` 은
 * 그룹 노드째 지워야 한다** — 스키마가 `blockContainer+` 라 빈 그룹은 존재할 수
 * 없고, 빈 채로 남기려 하면 `tr.delete()` 가 그 자리에서 던진다.
 *
 * 예외가 하나 있다: **루트 그룹**은 `doc` 의 필수 자식이라 지울 수 없다.
 * 그래서 `emptiesDoc` 으로 알려주고, 부르는 쪽이 빈 문단을 먼저 채운다.
 */
export function blockDeletionRanges(
  doc: PmNode,
  roots: readonly number[],
): { ranges: DeletionRange[]; emptiesDoc: boolean } {
  const sorted = [...roots].sort((a, b) => a - b)

  // 부모 그룹별로 "몇 개 중 몇 개가 사라지는가".
  const groups = new Map<number, { total: number; removed: number; depth: number }>()
  for (const pos of sorted) {
    const $pos = doc.resolve(pos)
    const groupPos = $pos.before($pos.depth)
    const seen = groups.get(groupPos)
    if (seen) seen.removed += 1
    else groups.set(groupPos, { total: $pos.parent.childCount, removed: 1, depth: $pos.depth })
  }

  const ranges: DeletionRange[] = []
  const collapsed = new Set<number>()
  let emptiesDoc = false

  for (const [groupPos, info] of groups) {
    if (info.removed < info.total) continue
    // 깊이 1 = 루트 blockGroup. 지울 수 없다.
    if (info.depth <= 1) {
      emptiesDoc = true
      continue
    }
    const group = doc.nodeAt(groupPos)
    if (!group) continue
    ranges.push({ from: groupPos, to: groupPos + group.nodeSize })
    collapsed.add(groupPos)
  }

  for (const pos of sorted) {
    const $pos = doc.resolve(pos)
    // 그룹째 지우기로 했으면 그 자식은 이미 포함됐다.
    if (collapsed.has($pos.before($pos.depth))) continue
    const node = doc.nodeAt(pos)
    if (node) ranges.push({ from: pos, to: pos + node.nodeSize })
  }

  ranges.sort((a, b) => a.from - b.from)
  return { ranges, emptiesDoc }
}

function emptyParagraphContainer(blockId: string): PmNode {
  return blockSchema.nodes.blockContainer.create(
    { blockId },
    blockSchema.nodes.paragraph.create({ props: {}, format: {} }),
  )
}

/**
 * 선택된 블록들을 지우고(선택적으로) 그 자리에 내용을 넣는다.
 *
 * `Selection.replace()` 의 구현이자 삭제 커맨드의 본체다. 한 트랜잭션에서
 * 끝난다 — F-01-09 데이터 모델 함의: *"일괄 조작은 단일 tx_id 로 묶어 undo
 * 1회에 되돌아가게 한다."*
 *
 * 순서에 규칙이 둘 있다.
 *
 *   ① **문서를 비우는 삭제는 빈 문단을 먼저 넣는다.** 다 지운 뒤에 넣으려 하면
 *      그 중간 상태가 스키마를 어겨 `tr.delete()` 가 던진다.
 *   ② **뒤에서 앞으로 지운다.** 앞에서 지우면 뒤 범위의 위치가 밀린다.
 *      매핑을 쓸 수도 있지만, 역순 삭제는 매핑 자체가 필요 없다.
 *
 * 넣을 내용은 지운 **뒤에** `replaceSelection` 으로 넣는다. 삽입 위치가 인라인을
 * 받을 수 있는 자리인지, 감쌀 노드가 필요한지는 ProseMirror 가 이미 안다.
 */
export function replaceBlockSelection(
  tr: Transaction,
  selection: BlockSelection,
  content: Slice = Slice.empty,
  newId: () => string = newBlockId,
): boolean {
  const roots = selection.rootPositions
  // 하위 페이지는 이 경로로 사라지지 않는다(파일 머리말).
  if (selectionHasPageRef(tr.doc, roots)) return false

  const { ranges, emptiesDoc } = blockDeletionRanges(tr.doc, roots)
  if (ranges.length === 0) return false

  // ① 문서가 통째로 비는 경우에만 자리채움을 **먼저** 넣는다. 이때 모든 범위는
  //    루트 그룹의 직속 자식이므로 마지막 범위 끝은 그룹 안의 유효한 자리다.
  if (emptiesDoc) tr.insert(ranges[ranges.length - 1].to, emptyParagraphContainer(newId()))

  // ② 뒤에서 앞으로.
  for (let i = ranges.length - 1; i >= 0; i -= 1) tr.delete(ranges[i].from, ranges[i].to)

  // ③ 넣을 내용이 있으면 **지운 자리에** 빈 블록을 하나 세우고 거기에 넣는다.
  //    그러지 않으면 `Selection.near` 가 뒤 블록을 찾아내고, 친 글자가 그 블록
  //    머리에 붙는다("BC" 를 지우고 "새로"를 쳤는데 "새로D" 가 된다).
  //    지운 자리가 그룹 안이 아닌 경우(그룹째 사라진 경우)에만 뒤 블록으로 넘긴다.
  const at = ranges[0].from
  if (content.size > 0 && !emptiesDoc && tr.doc.resolve(at).parent.type.name === GROUP) {
    tr.insert(at, emptyParagraphContainer(newId()))
  }

  tr.setSelection(Selection.near(tr.doc.resolve(at), 1))
  if (content.size > 0) tr.replaceSelection(content)
  return true
}

// ── 화면 순서 위의 이동 ───────────────────────────────────────────────

/**
 * 이 블록의 **화면상 자손을 건너뛴** 다음 블록.
 *
 * 선택된 블록의 자손은 이미 선택에 딸려 있다. 건너뛰지 않으면 `Shift+↓` 를
 * 눌러도 하이라이트가 그대로여서 "키가 안 먹는다"로 보인다.
 * 평탄화가 전위 순회라 자손은 바로 뒤에 더 깊은 depth 로 붙어 있다.
 */
function afterSubtree(
  index: VisibleIndex<VisibleBlock>,
  id: string,
): VisibleEntry<VisibleBlock> | null {
  const start = index.positionOf(id)
  if (start < 0) return null
  const depth = index.order[start].depth
  let i = start + 1
  while (i < index.order.length && index.order[i].depth > depth) i += 1
  return i < index.order.length ? index.order[i] : null
}

function idAt(doc: PmNode, pos: number): string {
  return String(doc.nodeAt(pos)?.attrs.blockId ?? '')
}

/**
 * `Shift+↑↓` 가 head 를 옮길 자리.
 *
 * 경계 두 개(anchor·head)만으로 확장과 축소를 가른다: **head 가 anchor 보다
 * 위에 있는데 아래로 가면 축소**, 그 반대면 확장이다.
 *
 * 축소·확장 모두 head 를 **선택의 가장자리 루트** 기준으로 옮긴다(head 자신이
 * 아니라). head 는 shift+클릭으로 루트가 아닌 블록을 가리킬 수 있고, 그때
 * head 를 기준으로 한 칸 옮기면 같은 선택이 다시 나와 키가 먹지 않는다.
 */
export function nextSelectionEdge(
  doc: PmNode,
  selection: BlockSelection,
  direction: 1 | -1,
  isCollapsed: (blockId: string) => boolean,
): number | null {
  const roots = selection.rootPositions
  const index = visibleBlocks(doc, isCollapsed)
  const firstId = idAt(doc, roots[0])
  const lastId = idAt(doc, roots[roots.length - 1])

  const shrinking =
    direction === 1
      ? selection.$headBlock.pos < selection.$anchorBlock.pos
      : selection.$headBlock.pos > selection.$anchorBlock.pos

  let entry: VisibleEntry<VisibleBlock> | null
  if (direction === 1) {
    entry = shrinking ? index.next(firstId) : afterSubtree(index, lastId)
  } else {
    entry = index.previous(shrinking ? lastId : firstId)
  }
  return entry === null ? null : entry.node.pos
}

// ── 커맨드 ────────────────────────────────────────────────────────────

/**
 * Esc — 편집 모드에서 블록 선택 모드로 (F-12-01 시나리오 2).
 *
 * 캐럿이 있던 블록 하나가 선택된다. 이 상태에서 같은 키가 다르게 동작하는 것이
 * F-12-01 이 말한 "모드 의존적" 단축키다.
 */
export function selectBlockCommand(): Command {
  return (state, dispatch) => {
    if (isBlockSelection(state.selection)) return false
    const info = containerAt(state.selection.$from)
    if (!info) return false
    if (dispatch) dispatch(state.tr.setSelection(BlockSelection.create(state.doc, info.pos)))
    return true
  }
}

/**
 * 블록 선택 모드에서 나온다.
 *
 * 캐럿을 **마지막 선택 블록의 끝**에 둔다. `Selection.near` 에게 뒤로 찾게 하면
 * 그 블록이 텍스트를 담지 않는 경우(divider·image)에도 알아서 유효한 자리를
 * 고른다 — 우리가 타입별로 분기하지 않는다.
 */
export function exitBlockSelectionCommand(): Command {
  return (state, dispatch) => {
    const sel = state.selection
    if (!isBlockSelection(sel)) return false
    if (dispatch) {
      const last = sel.rootPositions[sel.rootPositions.length - 1]
      const node = state.doc.nodeAt(last)
      const end = node ? last + node.nodeSize : last
      dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(end), -1)))
    }
    return true
  }
}

/** `Shift+↑↓` — 범위 확장/축소 (F-12-01 시나리오 3). */
export function extendBlockSelectionCommand(direction: 1 | -1, deps: CommandDeps): Command {
  return (state, dispatch) => {
    const sel = state.selection
    if (!isBlockSelection(sel)) return false
    const head = nextSelectionEdge(state.doc, sel, direction, deps.isCollapsed)
    if (head === null) return true // 문서 끝. 편집 모드로 새 나가지 않게 잡아둔다.
    if (dispatch) {
      dispatch(
        state.tr
          .setSelection(BlockSelection.create(state.doc, sel.$anchorBlock.pos, head))
          .scrollIntoView(),
      )
    }
    return true
  }
}

/** `↑↓` — 선택을 이웃 블록 하나로 옮긴다. 모드는 유지된다. */
export function moveBlockSelectionCommand(direction: 1 | -1, deps: CommandDeps): Command {
  return (state, dispatch) => {
    const sel = state.selection
    if (!isBlockSelection(sel)) return false
    // 확장 쪽 규칙만 쓴다 — anchor 를 함께 옮기므로 축소가 성립하지 않는다.
    const collapsedSel = BlockSelection.create(
      state.doc,
      direction === 1
        ? sel.rootPositions[sel.rootPositions.length - 1]
        : sel.rootPositions[0],
    )
    const next = nextSelectionEdge(state.doc, collapsedSel, direction, deps.isCollapsed)
    if (next === null) return true
    if (dispatch) {
      dispatch(state.tr.setSelection(BlockSelection.create(state.doc, next)).scrollIntoView())
    }
    return true
  }
}

/** Backspace / Delete — 선택된 블록을 지운다 (F-12-01 시나리오 5). */
export function deleteBlockSelectionCommand(deps: CommandDeps): Command {
  return (state, dispatch) => {
    const sel = state.selection
    if (!isBlockSelection(sel)) return false

    if (selectionHasPageRef(state.doc, sel.rootPositions)) {
      deps.onRefused?.(PAGE_REF_REFUSAL)
      // true 를 돌려 뒤 커맨드(기본 Backspace)로 넘기지 않는다. 거부했는데
      // 다른 무언가가 지우면 거부의 의미가 없다 — `applyMergePlan` 의
      // `blocked` 와 같은 이유다.
      return true
    }

    const tr = state.tr
    if (!replaceBlockSelection(tr, sel, Slice.empty, deps.newId)) return false
    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
}

/**
 * 선택된 블록 전부의 타입을 바꾼다 (F-01-09: *"비연속 선택 후 Turn into →
 * 각 블록 개별 변환"*).
 *
 * 개별 변환이므로 일부만 성공할 수 있다 — 자식이 있는 블록을 heading 으로
 * 바꾸려는 경우처럼 `applyTurnInto` 가 거부하는 블록은 그대로 남는다.
 */
export function turnSelectionIntoCommand(type: BlockType, deps: CommandDeps): Command {
  return (state, dispatch) => {
    const sel = state.selection
    if (!isBlockSelection(sel)) return false

    const tr = state.tr
    let changed = 0
    for (const id of sel.blockIds) {
      if (applyTurnInto(tr, id, type, deps, 0)) changed += 1
    }
    // 바뀐 것이 없어도 true — 블록 선택 상태에서 이 키가 편집 모드용 커맨드로
    // 흘러가면 엉뚱한 블록이 바뀐다.
    if (changed === 0) return true

    // `applyTurnInto` 는 캐럿을 옮긴다. 블록 선택을 되돌린다.
    tr.setSelection(
      BlockSelection.create(
        tr.doc,
        tr.mapping.map(sel.$anchorBlock.pos),
        tr.mapping.map(sel.$headBlock.pos),
      ),
    )
    if (dispatch) dispatch(tr)
    return true
  }
}

/** 컨테이너 subtree 를 복제하며 모든 `blockId` 를 새로 발급한다. */
function withFreshIds(node: PmNode, newId: () => string): PmNode {
  const name = node.type.name
  if (name !== CONTAINER && name !== GROUP) return node

  const children: PmNode[] = []
  node.forEach((child) => children.push(withFreshIds(child, newId)))
  const content = Fragment.fromArray(children)

  return name === CONTAINER
    ? node.type.create({ ...node.attrs, blockId: newId() }, content, node.marks)
    : node.copy(content)
}

/**
 * `Mod+D` — 선택된 블록 복제 (F-12-01 시나리오 5 · F-01-08 키보드 대안).
 *
 * 각 블록을 **자기 바로 뒤에** 넣는다. 전부 모아 마지막 블록 뒤에 넣으면 서로
 * 다른 깊이에 걸친 선택에서 구조가 바뀐다.
 *
 * 새 id 를 직접 발급한다. `blockIdPlugin` 이 중복 id 를 보정해 주긴 하지만
 * 그건 **보정**이고, 복제한 블록을 곧바로 선택하려면 id 를 알아야 한다.
 */
export function duplicateBlockSelectionCommand(deps: CommandDeps): Command {
  return (state, dispatch) => {
    const sel = state.selection
    if (!isBlockSelection(sel)) return false

    if (selectionHasPageRef(state.doc, sel.rootPositions)) {
      deps.onRefused?.(PAGE_REF_REFUSAL)
      return true
    }

    const newId = deps.newId ?? newBlockId
    const tr = state.tr
    const copyIds: string[] = []

    // 뒤에서 앞으로 — 앞에 넣으면 뒤 위치가 밀린다.
    for (let i = sel.rootPositions.length - 1; i >= 0; i -= 1) {
      const pos = sel.rootPositions[i]
      const node = state.doc.nodeAt(pos)
      if (!node) continue
      const copy = withFreshIds(node, newId)
      copyIds.unshift(String(copy.attrs.blockId ?? ''))
      tr.insert(pos + node.nodeSize, copy)
    }
    if (copyIds.length === 0) return false

    const first = findContainerById(tr.doc, copyIds[0])
    const last = findContainerById(tr.doc, copyIds[copyIds.length - 1])
    if (first && last) tr.setSelection(BlockSelection.create(tr.doc, first.pos, last.pos))

    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
}

/** 그룹의 자식 컨테이너 위치들. */
function childPositions(group: PmNode, groupPos: number): number[] {
  const out: number[] = []
  let pos = groupPos + 1
  group.forEach((child) => {
    out.push(pos)
    pos += child.nodeSize
  })
  return out
}

/**
 * `Mod+A` — 3단 확장 (F-12-01: *"편집 모드에서 현재 블록 텍스트 전체 선택,
 * 다시 누르면 블록 선택으로 확장"*).
 *
 *   ① 블록 안 텍스트 전체
 *   ② 그 블록(블록 선택 모드 진입)
 *   ③ 형제 전체 → 부모 → 부모의 형제 전체 → …
 *
 * 단계를 문서에서 읽어 정한다. "몇 번째 눌렀는가"를 기억하지 않는다 — 그 카운터는
 * 마우스 클릭 하나로 어긋나고, 어긋난 뒤에는 사용자가 예측할 수 없다.
 */
export function selectAllBlocksCommand(): Command {
  return (state, dispatch) => {
    const sel = state.selection
    const doc = state.doc

    if (isBlockSelection(sel)) {
      // 기준은 **가장 얕은** 루트의 그룹이다. 첫 루트를 쓰면 깊이가 섞인 선택
      // ("A 의 마지막 자식"과 "A 의 다음 형제")에서 안쪽 그룹이 기준이 되어
      // Mod+A 가 선택을 **줄인다** — 전체 선택 키가 줄이면 안 된다.
      let shallowest = sel.rootPositions[0]
      let minDepth = doc.resolve(shallowest).depth
      for (const pos of sel.rootPositions) {
        const depth = doc.resolve(pos).depth
        if (depth < minDepth) {
          minDepth = depth
          shallowest = pos
        }
      }

      const $first = doc.resolve(shallowest)
      const groupPos = $first.before($first.depth)
      const siblings = childPositions($first.parent, groupPos)

      const sameGroup = sel.rootPositions.filter((pos) => {
        const $pos = doc.resolve(pos)
        return $pos.before($pos.depth) === groupPos
      })
      const coversGroup =
        sameGroup.length === siblings.length && sameGroup.length === sel.rootPositions.length

      if (!coversGroup) {
        if (dispatch) {
          dispatch(
            state.tr.setSelection(
              BlockSelection.create(doc, siblings[0], siblings[siblings.length - 1]),
            ),
          )
        }
        return true
      }

      // 이미 형제 전체다. 한 단 올라간다. 루트 그룹이면 더 갈 곳이 없다.
      if ($first.depth <= 1) return true
      if (dispatch) {
        dispatch(state.tr.setSelection(BlockSelection.create(doc, $first.before($first.depth - 1))))
      }
      return true
    }

    const info = containerAt(sel.$from)
    if (!info) return false

    // 텍스트가 없는 블록(divider·image)은 곧바로 블록 선택이다.
    if (!info.contentNode.isTextblock) {
      if (dispatch) dispatch(state.tr.setSelection(BlockSelection.create(doc, info.pos)))
      return true
    }

    const from = info.contentPos + 1
    const to = from + info.contentNode.content.size
    if (sel.from <= from && sel.to >= to) {
      if (dispatch) dispatch(state.tr.setSelection(BlockSelection.create(doc, info.pos)))
      return true
    }
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(doc, from, to)))
    return true
  }
}

/** 화면에 알릴 선택 블록 수. 0 이면 블록 선택 모드가 아니다. */
export function selectedBlockCount(state: EditorState): number {
  const sel = state.selection
  return isBlockSelection(sel) ? sel.rootPositions.length : 0
}
