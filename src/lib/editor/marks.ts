/**
 * 인라인 서식 커맨드 — F-01-03 / F-12-01
 *
 * 정본: 01-block-editor.md F-01-03, 12-platform-ux.md F-12-01
 *   "서식: `cmd/ctrl + B/I/U`, `cmd/ctrl + shift + S`(취소선),
 *    `cmd/ctrl + E`(인라인 코드), `cmd/ctrl + K`(링크)"
 *
 * 대부분 ProseMirror 의 `toggleMark` 를 그대로 쓴다. 우리가 얹는 것은 두 가지다.
 *
 *   ① **색은 토글이 아니다.** 19색 중 하나를 고르는 것이고 `default` 는
 *      "색 없음"이라 마크를 **제거**한다. `toggleMark` 로는 표현되지 않는다
 *      (같은 색을 다시 누르면 꺼져야 하는데, 다른 색을 누르면 갈아타야 한다).
 *   ② **링크는 attrs 가 있다.** 이미 링크인 범위에 다른 URL 을 걸면 갈아타야
 *      하는데, `toggleMark` 는 attrs 가 다르면 겹쳐 쌓는다.
 */

import { toggleMark } from '@tiptap/pm/commands'
import type { Command } from '@tiptap/pm/state'

import { isColor, type Color } from '../contracts/rich-text.ts'
import { blockSchema, BOOLEAN_MARK_NAMES, type BooleanMark } from './schema.ts'

/** bold/italic/strikethrough/underline/code 토글. */
export function toggleFormat(mark: BooleanMark): Command {
  return toggleMark(blockSchema.marks[mark])
}

/**
 * 색 지정.
 *
 * `default` 를 주면 색 마크를 제거한다 — 계약에 `default_background` 가 없는
 * 이유와 같다(`contracts/rich-text.ts`): "기본"은 색이 없는 상태이지 색이 아니다.
 */
export function setTextColor(color: Color): Command {
  return (state, dispatch) => {
    if (!isColor(color)) return false
    const markType = blockSchema.marks.color
    const { empty, ranges } = state.selection

    if (empty) {
      // 선택이 없으면 다음에 타이핑할 글자에 적용한다(storedMarks).
      if (!dispatch) return true
      const tr = state.tr
      if (color === 'default') tr.removeStoredMark(markType)
      else tr.addStoredMark(markType.create({ color }))
      dispatch(tr)
      return true
    }

    if (!dispatch) return true
    // ⚠ `selection.from`/`to` 가 아니라 **`ranges` 전부**를 돈다.
    // 블록 선택(F-01-09)은 선택된 블록마다 범위를 하나씩 갖고, `from`/`to` 는
    // 그중 첫 범위일 뿐이다. 그것만 칠하면 여러 블록을 골라 색을 바꿨는데
    // 첫 블록만 바뀐다. `toggleMark` 가 같은 이유로 `ranges` 를 돈다.
    const tr = state.tr
    for (const { $from, $to } of ranges) {
      tr.removeMark($from.pos, $to.pos, markType)
      if (color !== 'default') tr.addMark($from.pos, $to.pos, markType.create({ color }))
    }
    dispatch(tr)
    return true
  }
}

/**
 * 링크 설정 / 해제.
 *
 * `href === null` 이면 해제. 이미 링크인 범위에 다른 URL 을 주면 **갈아탄다** —
 * `removeMark` 를 먼저 부르는 이유다. 겹쳐 쌓이면 어느 링크가 이기는지가
 * 문서 순서에 달리게 되고, RichText 계약(`text.link` 는 하나)으로 직렬화할 때
 * 하나가 조용히 사라진다.
 */
export function setLink(href: string | null): Command {
  return (state, dispatch) => {
    const { empty, ranges } = state.selection
    // 링크는 범위에 걸린다. 선택이 없으면 걸 자리가 없다.
    if (empty) return false

    if (!dispatch) return true
    const markType = blockSchema.marks.link
    const tr = state.tr
    // `setTextColor` 와 같은 이유로 범위 전부를 돈다.
    for (const { $from, $to } of ranges) {
      tr.removeMark($from.pos, $to.pos, markType)
      if (href !== null && href !== '') tr.addMark($from.pos, $to.pos, markType.create({ href }))
    }
    dispatch(tr)
    return true
  }
}

/** 이 선택에 걸린 boolean 마크들. 툴바 활성 표시용. */
export function activeFormats(state: Parameters<Command>[0]): BooleanMark[] {
  const { from, $from, to, empty } = state.selection
  const active: BooleanMark[] = []

  for (const name of BOOLEAN_MARK_NAMES) {
    const markType = blockSchema.marks[name]
    const on = empty
      ? Boolean(markType.isInSet(state.storedMarks ?? $from.marks()))
      : state.doc.rangeHasMark(from, to, markType)
    if (on) active.push(name)
  }

  return active
}

/** 이 선택에 걸린 색. 없으면 'default'. */
export function activeColor(state: Parameters<Command>[0]): Color {
  const { $from, empty } = state.selection
  const marks = empty ? (state.storedMarks ?? $from.marks()) : $from.marks()
  const found = blockSchema.marks.color.isInSet(marks)
  const value = found?.attrs.color
  return isColor(value) ? value : 'default'
}
