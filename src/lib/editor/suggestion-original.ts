/**
 * 수락 전 원문 — 제안 마크를 뗀 문서 (SG-2 · F-05-12 · 판결 U-2 · 불변식 S8)
 *
 * 정본: 00-canonical-data-model.md [보강 SG-1] ③ ④ · 제안 편집 (U-2)
 *
 * 편집기 밖(행 투영 · 공개 화면 · 내보내기 · 검색 색인 · 복제 · 버전)은 **수락 전 원문**을 본다 — `suggestion_insert` 글은 빼고
 * `suggestion_delete` 글은 그냥 글로 둔다. `suggestion_format` 글은 제안 전 서식이다 — 더한 서식을 떼고 뺀 서식을 다시 건다(SG-5a ·
 * `suggestion-format.ts` — 거절했을 때의 모양). 계약 런(`EditorDoc`)에는 제안을 담을
 * 자리가 없으므로 Y.Doc → 문서 읽기(`collab/ydoc.ts` `readBodyYDoc`)가 이것을 거친다. 편집기 쪽 변환(복사 · 형 바꾸기 — `inlineToRuns`)은
 * 거치지 않는다 — 편집기 안에서는 제안이 보여야 한다.
 *
 * 뗀 마크는 sid 마다 모아 돌려준다 — 투영이 메타 표(`suggestion`)를 문서에 맞춘다(`suggestion/project.ts`).
 */

import { Fragment, type Mark, type Node as PmNode } from '@tiptap/pm/model'

import { SUGGESTION_DELETE_MARK, SUGGESTION_FORMAT_MARK, SUGGESTION_INSERT_MARK } from './schema.ts'
import { formatChangeOf, undoFormat } from './suggestion-format.ts'

export type SuggestionKind = 'insert' | 'delete' | 'format'

/**
 * 문서 안의 제안 하나 — sid 마다 처음 본 종류 · 사람, 그 sid 의 글을 문서 차례로 이은 것. 값은 참여자가 Y.Doc 에 쓴 그대로다
 * (모양 · 멤버인지는 투영이 본다).
 */
export type SuggestionMark = {
  readonly sid: string
  readonly kind: SuggestionKind
  readonly authorId: string
  readonly text: string
}

const KIND_OF: Readonly<Record<string, SuggestionKind>> = {
  [SUGGESTION_INSERT_MARK]: 'insert',
  [SUGGESTION_DELETE_MARK]: 'delete',
  [SUGGESTION_FORMAT_MARK]: 'format',
}

const kindOf = (mark: Mark): SuggestionKind | undefined => KIND_OF[mark.type.name]

/** 원문 문서와 거기서 뗀 제안들. 제안이 없으면 받은 문서를 그대로 돌려준다. */
export function originalOf(doc: PmNode): { readonly doc: PmNode; readonly suggestions: readonly SuggestionMark[] } {
  const found = new Map<string, { kind: SuggestionKind; authorId: string; text: string }>()
  const note = (mark: Mark, kind: SuggestionKind, node: PmNode): void => {
    const sid = String(mark.attrs.sid)
    const text = node.isText ? (node.text ?? '') : node.textContent
    const seen = found.get(sid)
    if (seen === undefined) found.set(sid, { kind, authorId: String(mark.attrs.author_id), text })
    else seen.text += text
  }

  const visit = (node: PmNode): PmNode => {
    let changed = false
    const children: PmNode[] = []
    node.forEach((child) => {
      if (!node.inlineContent) {
        const next = visit(child)
        if (next !== child) changed = true
        children.push(next)
        return
      }
      let inserted = false
      let format: Mark | null = null
      for (const mark of child.marks) {
        const kind = kindOf(mark)
        if (kind === undefined) continue
        note(mark, kind, child)
        if (kind === 'insert') inserted = true
        if (kind === 'format') format = mark
      }
      // 넣자는 글은 원문에 없다 — 남이 지우자고 한 것이어도(insert 와 delete 가 함께 선 글) 뺀다
      if (inserted) {
        changed = true
        return
      }
      let marks: readonly Mark[] = child.marks.filter((m) => kindOf(m) === undefined)
      // 서식 제안 전 모양(SG-5a)
      if (format !== null) marks = undoFormat(marks, formatChangeOf(format), (type) => node.type.allowsMarkType(type))
      if (format === null && marks.length === child.marks.length) children.push(child)
      else {
        changed = true
        children.push(child.mark(marks))
      }
    })
    // `fromArray` 가 마크가 같아진 이웃 글을 합친다
    return changed ? node.copy(Fragment.fromArray(children)) : node
  }

  const original = visit(doc)
  return {
    doc: original,
    suggestions: [...found].map(([sid, s]) => ({ sid, kind: s.kind, authorId: s.authorId, text: s.text })),
  }
}
