/**
 * 인라인 수식의 명령 — 찾기 · 쓰기 · 만들기 · 입력 규칙 (Phase 2 1b · F-01-20 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 블록 수식 ⑨ (인라인) · 01-block-editor.md F-01-20
 *
 * 인라인 수식은 rich text 의 원자 노드(`equation` · 3b조각부터)다. **id 가 없다** — 그래서 입력창은 위치가 아니라 **(블록 id, 그 블록
 * 안에서 몇 번째 수식)** 으로 찾는다. 위치를 들고 있으면 협업 바인딩이 원격 변경을 문서 통째 교체로 적용할 때(y-prosemirror) 무엇을
 * 가리키는지 잃는다. 순번은 그 블록에 누가 수식을 앞에 넣을 때만 어긋난다(드물다 — 그때는 다른 수식을 고친다 · props 통째 LWW 와 같은
 * 무게).
 *
 *   · 만들기 셋 — `$$식$$` 을 치면 닫는 순간 수식이 된다(입력 규칙) · Ctrl/Cmd+Shift+E 는 고른 글자를 수식으로, 고른 것이 없으면 빈 수식을
 *     넣고 입력창을 연다(F-01-20 의 세 경로 중 플로팅 툴바는 없다 — 툴바가 아직 없다)
 *   · 빈 수식은 남기지 않는다 — 비워 저장하면 지우고, 새로 넣은 빈 수식을 저장하지 않고 닫으면 지운다(F-01-20 *"인라인 빈 수식은 저장 전
 *     제거"*). 저장 모양(rich text)은 빈 식을 받는다 — 정규화가 지우면 입력창이 쓰는 중인 빈 수식을 서버가 지운다
 *   · 코드 블록(평문 본문) 안에서는 만들지 않는다 — 입력 규칙은 `code: true` 노드에서 돌지 않고, 단축키도 평문 본문을 거른다
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { InputRule } from '@tiptap/pm/inputrules'
import { NodeSelection, TextSelection, type Command, type EditorState } from '@tiptap/pm/state'

import { clampExpression } from '../block/equation.ts'
import { createInlineAtom } from './atom-marks.ts'
import { separateUndoStep } from './code-block.ts'
import { containerAt, findContainerById } from './pm-blocks.ts'
import { blockSchema, EQUATION_NODE, isPlainTextNode } from './schema.ts'

/** 인라인 수식 하나를 가리키는 말 — 블록 id 와 그 블록 안의 순번(0부터). */
export type InlineEquationRef = { readonly blockId: string; readonly index: number }

/** 그 블록의 내용 노드 안 인라인 수식들 — (위치, 노드), 문서 순서. */
function equationsIn(content: PmNode, contentPos: number): { pos: number; node: PmNode }[] {
  const out: { pos: number; node: PmNode }[] = []
  content.forEach((child, offset) => {
    if (child.type.name === EQUATION_NODE) out.push({ pos: contentPos + 1 + offset, node: child })
  })
  return out
}

/** 이 위치의 인라인 수식을 가리키는 말 — 수식이 아니면 null. */
export function inlineEquationRefAt(state: EditorState, pos: number): InlineEquationRef | null {
  const node = state.doc.nodeAt(pos)
  if (node?.type.name !== EQUATION_NODE) return null
  const info = containerAt(state.doc.resolve(pos))
  if (info === null) return null
  const index = equationsIn(info.contentNode, info.contentPos).findIndex((e) => e.pos === pos)
  return index < 0 ? null : { blockId: info.id, index }
}

/** 가리키는 인라인 수식의 지금 위치 · 노드 — 없으면(지워짐 · 블록이 사라짐) null. */
export function findInlineEquation(state: EditorState, ref: InlineEquationRef): { pos: number; node: PmNode; expression: string } | null {
  const info = findContainerById(state.doc, ref.blockId)
  if (!info) return null
  const found = equationsIn(info.contentNode, info.contentPos)[ref.index]
  return found ? { ...found, expression: String(found.node.attrs.expression ?? '') } : null
}

/** 식을 쓴다 — 비면(공백뿐이어도) 그 수식을 지운다 · 상한까지 자른다 · 같으면 쓰지 않는다. */
export function setInlineEquationCommand(ref: InlineEquationRef, text: string): Command {
  return (state, dispatch) => {
    const found = findInlineEquation(state, ref)
    if (found === null) return false
    const tr = state.tr
    if (text.trim() === '') {
      tr.delete(found.pos, found.pos + found.node.nodeSize)
    } else {
      const expression = clampExpression(text)
      if (expression === found.expression) return false
      tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, expression })
    }
    if (dispatch) {
      separateUndoStep(state)
      dispatch(tr)
      separateUndoStep(state)
    }
    return true
  }
}

/** 빈 수식이면 지운다 — 새로 넣은 빈 수식을 저장하지 않고 닫았을 때. 비어 있지 않으면 false. */
export function removeEmptyInlineEquationCommand(ref: InlineEquationRef): Command {
  return (state, dispatch) => {
    const found = findInlineEquation(state, ref)
    if (found === null || found.expression.trim() !== '') return false
    if (dispatch) dispatch(state.tr.delete(found.pos, found.pos + found.node.nodeSize))
    return true
  }
}

/**
 * Ctrl/Cmd+Shift+E — 고른 글자를 수식으로(글자가 식이 된다 · 그 자리의 서식을 이어받는다). 고른 것이 없으면 빈 수식을 넣고 `open` 으로
 * 입력창을 연다. 한 블록 안의 글자 선택만 받는다(코드 블록 · 여러 블록에 걸친 선택은 아니다).
 */
export function insertInlineEquationCommand(open: (ref: InlineEquationRef) => void): Command {
  return (state, dispatch, view) => {
    const { selection } = state
    if (!(selection instanceof TextSelection) || (view !== undefined && !view.editable)) return false
    const { $from, $to } = selection
    if (!$from.sameParent($to) || !$from.parent.inlineContent || isPlainTextNode($from.parent)) return false
    const text = state.doc.textBetween($from.pos, $to.pos, '\n', '')
    const expression = clampExpression(text)
    // 서식은 고른 글자 전체에 걸린 것 — 시작점의 `marks()` 는 경계 앞 글자의 서식이다(기울임 글자를 골라도 기울임을 잃었다).
    const marks = selection.empty ? $from.marks() : ($from.marksAcross($to) ?? $from.marks())
    const node = createInlineAtom(blockSchema.nodes[EQUATION_NODE]!, { expression: expression.trim() === '' ? '' : expression }, marks)
    if (!dispatch) return true
    const tr = state.tr.replaceRangeWith($from.pos, $to.pos, node)
    const at = tr.mapping.map($from.pos, -1)
    // 캐럿은 수식 뒤 — 이어 쓴다. 빈 수식이면 입력창이 연다(아래).
    tr.setSelection(TextSelection.create(tr.doc, at + node.nodeSize))
    separateUndoStep(state)
    dispatch(tr.scrollIntoView())
    if (node.attrs.expression === '' && view !== undefined) {
      const ref = inlineEquationRefAt(view.state, at)
      if (ref !== null) open(ref)
    }
    return true
  }
}

/** 골라진(노드 선택) 인라인 수식의 Enter — 입력창을 연다. 아니면 false. */
export function openSelectedInlineEquationCommand(open: (ref: InlineEquationRef) => void): Command {
  return (state, dispatch, view) => {
    const { selection } = state
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== EQUATION_NODE) return false
    if (view !== undefined && !view.editable) return false
    const ref = inlineEquationRefAt(state, selection.from)
    if (ref === null) return false
    if (dispatch) open(ref)
    return true
  }
}

/**
 * `$$식$$` — 닫는 `$$` 를 치는 순간 수식이 된다(F-01-20 ①). 식은 비어 있지 않아야 하고(공백뿐이면 아니다) 앞이 `$` 가 아니어야 한다
 * (`$$$` 를 연달아 친 것을 수식으로 잡지 않는다). 그 자리의 서식을 이어받는다.
 */
export function inlineEquationInputRule(): InputRule {
  return new InputRule(/(?:^|[^$])\$\$([^$]+)\$\$$/, (state, match, start, end) => {
    const inner = match[1] ?? ''
    if (inner.trim() === '') return null
    const from = start + (match[0].length - inner.length - 4)
    const $from = state.doc.resolve(from)
    const node = createInlineAtom(blockSchema.nodes[EQUATION_NODE]!, { expression: clampExpression(inner) }, $from.marks())
    return state.tr.replaceRangeWith(from, end, node)
  })
}
