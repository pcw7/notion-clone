/**
 * 인라인 원자(멘션 · 수식)의 서식을 노드 attr 에 비춘다 — F-05-01 · CRDT 3b조각
 *
 * 정본: 판결 X-1 · HANDOFF §3.2-15
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 attr 인가
 * ──────────────────────────────────────────────────────────────────────
 *
 * y-prosemirror 는 요소 노드를 Y 로 옮길 때 attr 만 싣고(`createTypeFromElementNode`), 반대 방향도
 * `schema.node(이름, attrs, 자식)` 으로 만든다 — **마크를 넘기지 않는다.** 글자의 서식은 `Y.XmlText` 의 attr 이라
 * 남지만 멘션 · 수식에 건 굵게 · 색 · 링크는 Y.Doc 을 지나면 사라진다. 게다가 `updateYFragment` 는 ProseMirror
 * attr 에 없는 Y attr 을 지운다 — 서식을 Y 에 따로 써 둘 자리도 없다. 그래서 싣는 자리는 **노드 attr `marks`** 다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 진실은 마크, attr 은 거울이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 편집 명령(`toggleMark` · `addMark`)은 인라인 원자에도 마크를 걸지만(`node.isInline` 만 본다) attr 은 모른다.
 * 그래서 세 자리에서 맞춘다.
 *
 *   - **만들 때** — `createInlineAtom`(`runsToInline` 이 쓴다)
 *   - **마크가 바뀐 뒤** — `atomMarksPlugin`(appendTransaction). 바인딩 · 서버 쓰기 경로가 문서를 Y.Doc 에 옮기기
 *     전에 돈다. 되돌리기 기록을 끄지 않는다 — 끄면 협업 undo(F-05-15)가 사용자의 서식 변경까지 놓친다(아래)
 *   - **읽을 때** — attr 에서 마크를 되살린다(`collabSchema` · `readBodyYDoc`)
 *
 * 형식은 `Mark.toJSON()` 의 배열(`{type}`, attr 을 가진 마크만 `attrs`)이고 서식이 없으면 null 이다. null attr 은
 * y-prosemirror 가 Y 에 쓰지 않으므로 서식 없는 원자의 Y.Doc 은 이 attr 이 생기기 전과 같다.
 *
 *   ⚠ attr 이름 `marks` 는 저장 포맷이다(`collab/ydoc.ts` 머리말) — 바꾸면 마이그레이션이다
 *   ⚠ 모르는 마크는 되살리지 않는다. 그 원자는 다음 편집에서 아는 마크로 다시 비쳐 모르는 서식이 Y.Doc 에서 빠진다 —
 *     글자 서식과 같다(HANDOFF §7 스키마 버전 게이트)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 되돌리기 기록을 끄지 않는 이유
 * ──────────────────────────────────────────────────────────────────────
 *
 * ProseMirror 의 history 는 appendTransaction 이 붙인 트랜잭션을 원래 편집과 같은 항목으로 묶으므로 기록해도 Cmd+Z 는
 * 한 번이다. 반면 y-prosemirror 는 한 번의 상태 갱신에서 **마지막으로 적용된 트랜잭션**의 `addToHistory` 로 그 갱신 전체를
 * Y.Doc 에 쓸 때의 기록 여부를 정한다(`ySyncPlugin` 의 state.apply) — 여기서 끄면 서식을 건 편집 전체가 협업 undo 에서 빠진다.
 */

import { Mark, type MarkType, type Node as PmNode, type NodeType } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'

import { blockSchema, EQUATION_NODE, MENTION_NODE } from './schema.ts'

/** 서식을 비추는 attr 의 이름. 저장 포맷이다. */
export const ATOM_MARKS_ATTR = 'marks'

/** 서식을 attr 에 비추는 노드 — 인라인 원자. */
export const INLINE_ATOM_NODES: ReadonlySet<string> = new Set([MENTION_NODE, EQUATION_NODE])

type MarkJson = { readonly type: string; readonly attrs?: Record<string, unknown> }

/** 마크 → attr 값. 서식이 없으면 null. */
export function atomMarksAttr(marks: readonly Mark[]): MarkJson[] | null {
  return marks.length === 0 ? null : marks.map((mark) => mark.toJSON() as MarkJson)
}

/** attr 값 → 마크. 던지지 않는다 — 모르는 마크 · 만들 수 없는 마크 · 모양이 틀린 항목은 서식만 뺀다. */
export function marksFromAttr(value: unknown): readonly Mark[] {
  if (!Array.isArray(value)) return []
  const marks: Mark[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const type: MarkType | undefined = blockSchema.marks[String((item as MarkJson).type)]
    if (type === undefined) continue
    try {
      // `null` 이 아니라 `{}` 를 넘긴다 — ProseMirror 는 attrs 가 null 이면 필수 attr 검사를 건너뛰어
      // `href: null` 인 링크를 만든다(검사가 잡았다). 빈 객체면 "값이 없다"로 던진다.
      marks.push(type.create((item as MarkJson).attrs ?? {}))
    } catch {
      // 필수 attr 이 없는 마크(주소 없는 링크 같은 것)
    }
  }
  return Mark.setFrom(marks)
}

/** 서식을 attr 에 비춘 인라인 원자를 만든다. */
export function createInlineAtom(type: NodeType, attrs: Record<string, unknown>, marks: readonly Mark[]): PmNode {
  const sorted = Mark.setFrom(marks)
  return type.create({ ...attrs, [ATOM_MARKS_ATTR]: atomMarksAttr(sorted) }, null, sorted)
}

const inSync = (node: PmNode): boolean =>
  JSON.stringify(node.attrs[ATOM_MARKS_ATTR] ?? null) === JSON.stringify(atomMarksAttr(node.marks))

/** attr 이 마크와 어긋난 인라인 원자를 맞추는 트랜잭션. 맞출 것이 없으면 null. */
export function syncAtomMarks(state: EditorState): Transaction | null {
  const stale: { pos: number; node: PmNode }[] = []
  state.doc.descendants((node, pos) => {
    if (!INLINE_ATOM_NODES.has(node.type.name)) return true
    if (!inSync(node)) stale.push({ pos, node })
    return false
  })
  if (stale.length === 0) return null
  const tr = state.tr
  // attr 만 바꾸므로 위치가 밀리지 않는다.
  for (const { pos, node } of stale) {
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, [ATOM_MARKS_ATTR]: atomMarksAttr(node.marks) }, node.marks)
  }
  return tr
}

export const atomMarksPluginKey = new PluginKey('atomMarks')

/** 편집이 마크를 바꾸면 인라인 원자의 attr 을 맞춘다(머리말). */
export function atomMarksPlugin(): Plugin {
  return new Plugin({
    key: atomMarksPluginKey,
    appendTransaction: (transactions, _oldState, newState) =>
      transactions.some((t) => t.docChanged) ? syncAtomMarks(newState) : null,
  })
}
