/**
 * 편집 커맨드 — F-01-19 가 ProseMirror 로 내려앉는 자리
 *
 * 정본: 01-block-editor.md F-01-19 · F-01-07, F-12-01 P0 최소 세트
 *       마스터 문서 §7-4
 *
 * ──────────────────────────────────────────────────────────────────────
 * "직접 구현하지 않는다"가 무엇을 뜻하는가
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-01-19 클론 대안: *"ProseMirror 의 `splitBlock` / `joinBackward` 커맨드와
 * selection 매핑을 그대로 쓰고, 노션식 예외(리스트 탈출, 헤딩 뒤 paragraph,
 * 자식 귀속)만 커맨드를 덮어써 조정한다."*
 *
 * 실제로 해보면 `splitBlock` 을 **그대로 부를 수는 없다.** 우리
 * `blockContainer` 는 `blockContent blockGroup?` 이고 `defining: true` 라,
 * `splitBlock` 은 절단점 뒤의 모든 것 — **`blockGroup` 까지** — 을 새 노드로
 * 옮긴다. 그게 정확히 정본이 금지한 "자식이 뒤 블록으로 딸려가는" 동작이고
 * §7-4 가 "최빈 버그"로 지목한 것이다.
 *
 * 그래서 "덮어쓴다"를 문자 그대로 한다: 트랜잭션은 우리가 조립하되,
 * **위치 계산·매핑·스텝 기계는 ProseMirror 것을 쓴다.** 직접 만들지 않는 것은
 * DOM selection ↔ 모델 오프셋 매핑, 스텝/매핑, 히스토리다 — 버그 밀도가 높은
 * 부분은 전부 그쪽에 있다. 우리가 쓰는 것은 "무엇을 할지"뿐이고 그 결정은
 * `block-rules.ts` 에 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 트랜잭션 1개 = undo 1회
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-01-19 데이터 모델 함의: *"undo 는 이 트랜잭션 전체가 1단위여야 한다.
 * 분할을 2개 트랜잭션으로 쪼개면 Cmd+Z 두 번을 눌러야 원상복구되어 사용성이
 * 무너진다."* 모든 커맨드가 `state.tr` **하나**만 만들어 dispatch 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * IME
 * ──────────────────────────────────────────────────────────────────────
 *
 * §7-4 완화 전략 ④: *"`compositionstart~end` 사이 모든 핸들러 무력화."*
 * 그 게이트는 `createKeydownHandler()` 한 곳에 있다. 커맨드 각각이
 * `isComposing` 을 확인하지 않는다 — 하나만 빠뜨려도 한글 마지막 글자가
 * 사라지고, 어느 커맨드가 빠졌는지 찾기 어렵다.
 */

import type { Node as PmNode, NodeType } from '@tiptap/pm/model'
import { NodeSelection, TextSelection, type Command, type Transaction } from '@tiptap/pm/state'
import { liftTarget } from '@tiptap/pm/transform'

import { normalizeFormat, specOf, type BlockFormat, type BlockType } from '../block/types.ts'
import { planMerge, planSplit, type MergePlan } from './block-rules.ts'
import { newBlockId, runsToInline } from './pm-adapter.ts'
import {
  canNestUnder,
  containerAt,
  findContainerById,
  toRuleBlock,
  visibleNeighbors,
  type ContainerInfo,
} from './pm-blocks.ts'
import { blockSchema, PAGE_REF_NODE } from './schema.ts'
import type { RichTextRun } from '../contracts/rich-text.ts'

/**
 * 커맨드가 문서 밖에서 받아야 하는 것들.
 *
 * `isCollapsed` 가 여기 있는 이유: 접힘은 문서 데이터가 아니라 뷰어별 상태다
 * (F-01-13). 그런데 분할·병합 규칙의 **입력**이므로 밖에서 주입해야 한다.
 */
export type CommandDeps = {
  isCollapsed: (blockId: string) => boolean
  /** 병합 때문에 접힌 대상을 펼쳐야 할 때. */
  expand?: (blockId: string) => void
  /** 규칙이 병합을 거부했을 때. 사용자에게 이유를 보여줄 유일한 기회다. */
  onBlocked?: (plan: Extract<MergePlan, { kind: 'blocked' }>) => void
  /**
   * 조작 자체를 하지 않았을 때의 이유 (F-01-09 의 하위 페이지 거부 등).
   *
   * `onBlocked` 와 따로 둔다 — 저쪽은 `MergePlan` 의 **판결**을 그대로
   * 전달하는 통로라 `reason` 이 병합 어휘로 닫혀 있다.
   */
  onRefused?: (detail: string) => void
  /** 테스트에서 결정적 id 를 쓰기 위한 구멍. */
  newId?: () => string
}

const NO_COLLAPSE: CommandDeps = { isCollapsed: () => false }

// ── 노드 조립 ─────────────────────────────────────────────────────────

function contentNodeType(type: BlockType): NodeType {
  return blockSchema.nodes[type === 'page' ? PAGE_REF_NODE : type]
}

function makeContentNode(
  type: BlockType,
  title: readonly RichTextRun[],
  properties: Record<string, unknown>,
  format: BlockFormat,
): PmNode {
  const nodeType = contentNodeType(type)
  const attrs = { props: properties, format }
  return specOf(type).hasRichText
    ? nodeType.create(attrs, runsToInline(title))
    : nodeType.create(attrs)
}

function makeContainer(
  blockId: string,
  type: BlockType,
  title: readonly RichTextRun[],
  properties: Record<string, unknown>,
  format: BlockFormat,
  children: readonly PmNode[] = [],
): PmNode {
  const content = [makeContentNode(type, title, properties, format)]
  if (children.length > 0) {
    content.push(blockSchema.nodes.blockGroup.create(null, children as PmNode[]))
  }
  return blockSchema.nodes.blockContainer.create({ blockId }, content)
}

/**
 * 캐럿을 (블록 id, 오프셋)으로 되돌린다.
 *
 * 구조를 고친 뒤 위치를 손으로 매핑하지 않고 id 로 다시 찾는다. 오프셋 단위는
 * `rich-text-ops.ts` 가 정한 문서 단위이고 ProseMirror 의 텍스트블록 오프셋과
 * 같은 수다 — 그래서 변환이 없다.
 */
function placeCaret(tr: Transaction, blockId: string, offset: number): void {
  const info = findContainerById(tr.doc, blockId)
  if (!info) return

  if (info.contentNode.isTextblock) {
    const max = info.contentNode.content.size
    const pos = info.contentPos + 1 + Math.max(0, Math.min(offset, max))
    tr.setSelection(TextSelection.create(tr.doc, pos))
    return
  }
  tr.setSelection(NodeSelection.create(tr.doc, info.contentPos))
}

/** 내용 노드의 인라인 내용만 바꾼다. 노드 자체는 유지 — CRDT 위치 유실을 줄인다. */
function replaceTitle(tr: Transaction, blockId: string, title: readonly RichTextRun[]): void {
  const info = findContainerById(tr.doc, blockId)
  if (!info || !info.contentNode.isTextblock) return
  const from = info.contentPos + 1
  const to = from + info.contentNode.content.size
  tr.replaceWith(from, to, runsToInline(title))
}

/** 내용 노드의 타입·attrs 를 바꾼다. 인라인 내용은 유지된다. */
function setContentType(
  tr: Transaction,
  blockId: string,
  type: BlockType,
  properties: Record<string, unknown>,
  format: BlockFormat,
): void {
  const info = findContainerById(tr.doc, blockId)
  if (!info) return
  tr.setNodeMarkup(info.contentPos, contentNodeType(type), { props: properties, format })
}

// ── Enter ─────────────────────────────────────────────────────────────

export function splitBlockCommand(deps: CommandDeps = NO_COLLAPSE): Command {
  return (state, dispatch) => {
    const tr = state.tr
    if (!state.selection.empty) tr.deleteSelection()

    const $from = tr.selection.$from
    const info = containerAt($from)
    if (!info || info.id === '') return false

    // 자식 페이지 참조는 그 페이지의 것이다. Enter 로 쪼개지 않는다.
    if (info.contentNode.type.name === PAGE_REF_NODE) return false

    const offset = info.contentNode.isTextblock ? $from.parentOffset : 0
    const plan = planSplit(toRuleBlock(info, deps.isCollapsed), offset)
    const newId = (deps.newId ?? newBlockId)()

    switch (plan.kind) {
      case 'escape_to_paragraph': {
        // 리스트 탈출. 블록을 만들지 않고 타입만 되돌린다.
        // properties 는 비운다 — to_do 의 checked 가 문단에 남으면 안 된다.
        setContentType(tr, info.id, 'paragraph', {}, normalizeFormat('paragraph', info.contentNode.attrs.format))
        placeCaret(tr, info.id, 0)
        break
      }

      case 'insert_paragraph_after': {
        // divider·image 뒤에 빈 문단. 원자 뒤에 캐럿을 둘 자리를 만든다.
        tr.insert(info.pos + info.node.nodeSize, makeContainer(newId, 'paragraph', [], {}, {}))
        placeCaret(tr, newId, 0)
        break
      }

      case 'split': {
        replaceTitle(tr, info.id, plan.head)

        const fresh = findContainerById(tr.doc, info.id)
        if (!fresh) return false

        const newContainer = makeContainer(
          newId,
          plan.newType,
          plan.tail,
          plan.newProperties,
          plan.newFormat,
        )

        if (plan.newPlacement === 'first_child' && fresh.groupPos !== null) {
          // 펼쳐진 자식이 있다 → 새 블록은 첫 자식. 자식을 옮기지 않고도
          // 새 블록이 화면에서 원본 바로 다음 줄에 온다(block-rules.ts 판결 ①).
          tr.insert(fresh.groupPos + 1, newContainer)
        } else {
          tr.insert(fresh.pos + fresh.node.nodeSize, newContainer)
        }

        placeCaret(tr, newId, 0)
        break
      }
    }

    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
}

/**
 * Shift+Enter — 블록 안에서 줄바꿈 (soft break).
 *
 * 별도 노드를 두지 않고 텍스트에 `\n` 을 넣는다. 노션 공개 API 도 soft break 를
 * `text.content` 안의 개행으로 표현하므로, 이렇게 하면 RichText 계약에 그대로
 * 담기고 어댑터에 예외가 생기지 않는다. 렌더는 CSS `white-space: pre-wrap`.
 */
export function softBreakCommand(): Command {
  return (state, dispatch) => {
    const info = containerAt(state.selection.$from)
    if (!info || !info.contentNode.isTextblock) return false
    if (dispatch) dispatch(state.tr.insertText('\n').scrollIntoView())
    return true
  }
}

// ── Backspace / Delete ────────────────────────────────────────────────

function applyMergePlan(
  tr: Transaction,
  plan: MergePlan,
  source: ContainerInfo,
  targetId: string | null,
  deps: CommandDeps,
): boolean {
  switch (plan.kind) {
    case 'noop':
      return false

    case 'revert_type_to_paragraph': {
      setContentType(tr, source.id, 'paragraph', {}, normalizeFormat('paragraph', source.contentNode.attrs.format))
      placeCaret(tr, source.id, 0)
      return true
    }

    case 'select_target': {
      // divider·image 는 이어붙일 자리가 없다. 삭제 대기 상태로 만든다.
      if (targetId === null) return false
      const target = findContainerById(tr.doc, targetId)
      if (!target) return false
      tr.setSelection(NodeSelection.create(tr.doc, target.contentPos))
      return true
    }

    case 'blocked': {
      deps.onBlocked?.(plan)
      // true 를 돌려 기본 Backspace 를 막는다. 여기서 false 를 주면
      // ProseMirror 가 대신 글자를 지워서, 거부했는데 텍스트가 사라진다.
      return true
    }

    case 'merge': {
      if (targetId === null) return false

      // 사라질 블록의 자식을 먼저 떼어낸다.
      const movedChildren: PmNode[] = []
      if (plan.movesChildren && source.groupNode) {
        source.groupNode.forEach((child) => movedChildren.push(child))
      }

      // ① 원본 컨테이너를 지운다. 대상은 화면상 **앞**이므로 대상의 위치는
      //    이 삭제에 영향받지 않는다. 단 원본이 대상의 자식일 수 있으므로
      //    (첫 자식에서 Backspace) 이후 대상을 id 로 다시 찾는다.
      tr.delete(source.pos, source.pos + source.node.nodeSize)

      // ② 자식을 대상의 자식 끝으로 이관한다.
      if (movedChildren.length > 0) {
        const target = findContainerById(tr.doc, targetId)
        if (!target) return false

        if (target.groupPos !== null && target.groupNode) {
          tr.insert(target.groupPos + target.groupNode.nodeSize - 1, movedChildren)
        } else {
          const at = target.contentPos + target.contentNode.nodeSize
          tr.insert(at, blockSchema.nodes.blockGroup.create(null, movedChildren))
        }
        // 접힌 대상 안으로 자식이 들어가면 화면에서 사라진다 → 펼친다.
        if (plan.expandTarget) deps.expand?.(targetId)
      }

      // ③ 이어붙인 텍스트를 대상에 쓴다.
      replaceTitle(tr, targetId, plan.resultTitle)
      placeCaret(tr, targetId, plan.caretOffset)
      return true
    }
  }
}

/**
 * Backspace — 블록 맨 앞에서만 동작한다.
 *
 * 그 외에는 `false` 를 돌려 ProseMirror 의 기본 동작(글자 지우기)에 넘긴다.
 * 우리가 글자 지우기까지 다루면 IME·합자·이모지 같은 것을 다시 구현해야 한다.
 */
export function mergeBackwardCommand(deps: CommandDeps = NO_COLLAPSE): Command {
  return (state, dispatch) => {
    const sel = state.selection
    if (!sel.empty) return false

    const info = containerAt(sel.$from)
    if (!info || info.id === '') return false
    if (info.contentNode.isTextblock && sel.$from.parentOffset !== 0) return false

    const { previous } = visibleNeighbors(state.doc, info.id, deps.isCollapsed)
    const target = previous === null ? null : findContainerById(state.doc, previous)

    const plan = planMerge(
      toRuleBlock(info, deps.isCollapsed),
      target === null ? null : toRuleBlock(target, deps.isCollapsed),
    )

    const tr = state.tr
    if (!applyMergePlan(tr, plan, info, previous, deps)) return false
    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
}

/**
 * Delete — 블록 맨 끝에서 다음 블록을 끌어올린다.
 *
 * 같은 규칙 함수를 **역할만 바꿔** 부른다: 사라지는 쪽이 다음 블록, 남는 쪽이
 * 지금 블록. 규칙을 두 번 적지 않는다.
 */
export function mergeForwardCommand(deps: CommandDeps = NO_COLLAPSE): Command {
  return (state, dispatch) => {
    const sel = state.selection
    if (!sel.empty) return false

    const info = containerAt(sel.$from)
    if (!info || info.id === '') return false
    if (info.contentNode.isTextblock && sel.$from.parentOffset !== info.contentNode.content.size) {
      return false
    }

    const { next } = visibleNeighbors(state.doc, info.id, deps.isCollapsed)
    if (next === null) return false
    const source = findContainerById(state.doc, next)
    if (!source) return false

    const plan = planMerge(toRuleBlock(source, deps.isCollapsed), toRuleBlock(info, deps.isCollapsed))

    // Delete 로는 "타입 되돌림"을 하지 않는다. 그 동작은 캐럿이 있는 블록에
    // 대한 것이고(F-01-01), 여기서 사라지는 쪽은 다음 블록이다.
    if (plan.kind === 'revert_type_to_paragraph') return false

    const tr = state.tr
    if (!applyMergePlan(tr, plan, source, info.id, deps)) return false
    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
}

// ── Tab / Shift+Tab (F-01-07) ─────────────────────────────────────────

/**
 * Tab — 이전 형제의 자식으로 들여쓴다.
 *
 * 정본 F-01-07: 들여쓰기는 **이전 형제의 자식이 되는 것**이다. 이전 형제가
 * 없으면(그룹의 첫 항목) 들여쓸 수 없다 — 부모가 없는 자식이 되기 때문이다.
 *
 * ⚠ 옮기기를 `delete + insert` 로 한다. `ReplaceAroundStep` 으로 노드 정체성을
 * 유지하는 편이 이론상 낫지만, Phase 1 의 y-prosemirror 도 노드 이동을
 * 삭제+삽입으로 표현하므로 실질 차이가 없다. 반대로 분할·병합에서는 대상 노드를
 * **유지**한다(내용만 교체) — 거기가 F-01-19 이 경고한 CRDT 위치 유실 지점이다.
 */
export function indentCommand(deps: CommandDeps = NO_COLLAPSE): Command {
  return (state, dispatch) => {
    const info = containerAt(state.selection.$from)
    if (!info || info.id === '') return false

    const $pos = state.doc.resolve(info.pos)
    const parentGroup = $pos.parent
    const index = $pos.index()
    if (parentGroup.type.name !== 'blockGroup' || index === 0) return false

    const prevSibling = parentGroup.child(index - 1)
    const prevInfo = findContainerById(state.doc, String(prevSibling.attrs.blockId ?? ''))
    if (!prevInfo) return false

    // 자식을 가질 수 없는 블록 밑으로 넣지 않는다 — heading 뿐 아니라 하위 페이지
    // 참조도다. 스키마는 둘 다 허용하지만 저장할 때 `validateDoc` 이 거부한다.
    if (!canNestUnder(prevInfo)) return false

    const caretOffset = state.selection.$from.parentOffset
    const moving = info.node
    const tr = state.tr
    tr.delete(info.pos, info.pos + moving.nodeSize)

    const target = findContainerById(tr.doc, prevInfo.id)
    if (!target) return false

    if (target.groupPos !== null && target.groupNode) {
      tr.insert(target.groupPos + target.groupNode.nodeSize - 1, moving)
    } else {
      tr.insert(
        target.contentPos + target.contentNode.nodeSize,
        blockSchema.nodes.blockGroup.create(null, [moving]),
      )
    }

    // 접힌 블록 안으로 들여쓰면 방금 만진 블록이 화면에서 사라진다.
    if (deps.isCollapsed(target.id)) deps.expand?.(target.id)

    placeCaret(tr, info.id, caretOffset)
    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
}

/**
 * Shift+Tab — 한 단 내어쓴다.
 *
 * `liftTarget` 은 ProseMirror 의 것을 쓴다. "이 범위를 몇 단 위로 올릴 수
 * 있는가"는 스키마에 달린 질문이고, 우리가 다시 계산할 이유가 없다.
 * 뒤따르는 형제들은 그대로 남는다 — 노션도 그렇게 동작한다(내어쓴 블록만 이동).
 */
export function outdentCommand(): Command {
  return (state, dispatch) => {
    const info = containerAt(state.selection.$from)
    if (!info || info.id === '') return false

    const $start = state.doc.resolve(info.pos + 1)
    const $end = state.doc.resolve(info.pos + info.node.nodeSize - 1)
    const range = $start.blockRange($end, (node) => node.type.name === 'blockGroup')
    if (!range) return false

    // 루트 blockGroup 은 doc 의 직속이라 올릴 곳이 없다.
    if (range.depth <= 1) return false

    const target = liftTarget(range)
    if (target === null) return false

    const caretOffset = state.selection.$from.parentOffset
    const tr = state.tr.lift(range, target)
    placeCaret(tr, info.id, caretOffset)
    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
}

// ── 타입 변환 (F-01-06) ───────────────────────────────────────────────

/**
 * Turn into — 텍스트를 보존하며 블록 타입을 바꾼다.
 *
 * F-01-06: 텍스트는 보존하고, 대상 타입이 지원하지 않는 format 은 버린다.
 * `normalizeFormat` 이 이미 그 규칙을 갖고 있으므로 여기서 다시 판단하지 않는다.
 */
/**
 * 타입 변환을 **주어진 트랜잭션에** 적용한다.
 *
 * 커맨드가 아니라 트랜잭션 변형으로 뽑아둔 이유: 슬래시 메뉴는 `/쿼리` 삭제와
 * 타입 변환을 **한 트랜잭션**으로 묶어야 한다(그러지 않으면 Cmd+Z 를 두 번
 * 눌러야 한다). 커맨드만 있으면 두 트랜잭션을 합칠 방법이 스텝 복사뿐인데,
 * 그건 매핑이 어긋나기 쉽다.
 *
 * @param caretOffset 변환 후 캐럿을 둘 오프셋. 생략하면 트랜잭션의 현재 캐럿.
 */
export function applyTurnInto(
  tr: Transaction,
  blockId: string,
  type: BlockType,
  deps: CommandDeps = NO_COLLAPSE,
  caretOffset?: number,
): boolean {
  const info = findContainerById(tr.doc, blockId)
  if (!info || info.id === '') return false
  if (info.contentNode.type.name === PAGE_REF_NODE) return false

  const rule = toRuleBlock(info, deps.isCollapsed)
  if (rule.type === type) return false

  // 자식이 있는 블록을 자식 불가 타입으로 바꾸면 자식이 갈 곳이 없다.
  if (rule.hasChildren && !specOf(type).canHaveChildren) return false

  const offset =
    caretOffset ?? (tr.selection.$from.parent.isTextblock ? tr.selection.$from.parentOffset : 0)

  if (specOf(type).hasRichText) {
    // to_do 로 갈 때 checked 를 켜진 상태로 물려받지 않는다.
    const properties = type === 'to_do' ? { checked: false } : {}
    setContentType(tr, info.id, type, properties, normalizeFormat(type, rule.format))
    if (!specOf(rule.type).hasRichText) replaceTitle(tr, info.id, [])
    placeCaret(tr, info.id, offset)
    return true
  }

  // 텍스트를 담지 않는 타입으로 바꾸면 텍스트가 사라진다.
  // 내용이 있으면 거부한다 — 조용히 버리지 않는다.
  if (rule.title.length > 0) return false
  tr.replaceWith(
    info.contentPos,
    info.contentPos + info.contentNode.nodeSize,
    makeContentNode(type, [], {}, normalizeFormat(type, rule.format)),
  )
  placeCaret(tr, info.id, 0)
  return true
}

/** F-01-06 Turn into. 텍스트를 보존하며 블록 타입을 바꾼다. */
export function turnIntoCommand(type: BlockType, deps: CommandDeps = NO_COLLAPSE): Command {
  return (state, dispatch) => {
    const info = containerAt(state.selection.$from)
    if (!info) return false

    const tr = state.tr
    if (!applyTurnInto(tr, info.id, type, deps)) return false
    if (dispatch) dispatch(tr)
    return true
  }
}

// ── 키맵 ──────────────────────────────────────────────────────────────

export type KeyBindings = Readonly<Record<string, Command>>

/**
 * F-12-01 P0 최소 세트 중 이 PR이 담당하는 것.
 *
 * `/` 메뉴 · 마크다운 입력 규칙 · 서식 단축키는 다음 단계다.
 */
export function createBlockKeymap(deps: CommandDeps = NO_COLLAPSE): KeyBindings {
  return {
    Enter: splitBlockCommand(deps),
    'Shift-Enter': softBreakCommand(),
    Backspace: mergeBackwardCommand(deps),
    Delete: mergeForwardCommand(deps),
    Tab: indentCommand(deps),
    'Shift-Tab': outdentCommand(),
  }
}

/**
 * IME 게이트.
 *
 * §7-4 완화 전략 ④: "`compositionstart~end` 사이 모든 핸들러 무력화."
 * F-01-19: "`compositionend` 전에 분할하면 조합 문자가 유실된다. macOS/Windows/
 * Android IME 마다 `keydown` 순서가 다르므로 `isComposing` 플래그 필수."
 *
 * **게이트가 한 곳이어야 한다.** 커맨드마다 확인하게 만들면 하나만 빠뜨려도
 * 한글 마지막 글자가 사라지고, 어느 커맨드가 빠졌는지 찾기 어렵다.
 *
 * `view.composing` 과 `event.isComposing` 을 **둘 다** 본다. 전자는 ProseMirror
 * 가 관리하고 후자는 브라우저가 준다. Android 계열에서 둘이 어긋나는 사례가
 * 알려져 있어 한쪽만 믿지 않는다.
 */
export function isComposingEvent(
  view: { composing: boolean },
  event: { isComposing?: boolean; keyCode?: number },
): boolean {
  // keyCode 229 = "IME 가 처리 중". 일부 브라우저가 isComposing 대신 이걸 준다.
  return view.composing || event.isComposing === true || event.keyCode === 229
}
