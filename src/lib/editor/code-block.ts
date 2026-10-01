/**
 * 코드 블록의 명령 — 언어 · 줄바꿈 · 캡션 (잔여 묶음 8a-2 · F-01-14 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 코드 블록의 저장 모양 ④~⑦
 *
 * 노드 뷰의 버튼 · 편집기 밖의 오버레이(언어 목록 · 캡션 입력) · 블록 메뉴가 모두 이 명령을 부른다 — 쓰는 규칙을 한 곳에 둔다.
 *
 *   · **블록 id 로 찾는다** — 오버레이는 편집기가 다시 만들어져도(연결이 문서를 버리고 다시 열면 `bind()`) 살아 있으므로, 열 때의
 *     위치나 노드를 붙잡지 않는다. 지금 문서에서 다시 찾고, 코드 블록이 아니면(그 사이 바뀌었다) 아무것도 하지 않는다
 *   · **새 객체로 바꾼다** — props · format 은 Y.Doc attr 과 참조를 나눠 가진다. 제자리에서 고치면 Y update 가 생기지 않아 이
 *     화면만 바뀌고 다른 참여자와 영원히 갈린다(8a-2 조사의 프로브)
 *   · **바뀐 것이 없으면 false** — 같은 값을 다시 쓰면 props 통째 LWW(정본 ⑦)의 충돌만 늘고 로그가 자란다
 *   · 되돌리기는 **따로 한 단계** — 협업 편집기의 되돌리기는 500ms 안의 변경을 한 단계로 묶는다. 언어를 바꾸고 곧바로 친 글자가
 *     한 번의 Mod+Z 로 함께 사라지지 않게, 쓰기 앞뒤로 묶기를 끊는다(`separateUndoStep`)
 *   · **스크롤하지 않는다** — 선택을 옮기지 않는 attrs 쓰기다(`runCodeCommand`)
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'
import { yUndoPluginKey } from 'y-prosemirror'

import {
  CODE_TYPE,
  codeCaptionText,
  codeLanguageOf,
  isCaptionFormatted,
  withCodeCaption,
  withCodeLanguage,
} from '../block/code.ts'
import { normalizeFormat, type BlockFormat } from '../block/types.ts'
import { sameJsonValue } from '../contracts/json-safe.ts'
import { blockTypeOf, findContainerById } from './pm-blocks.ts'

/** 코드 블록 하나의 지금 값 — 오버레이와 블록 메뉴가 그린다. */
export type CodeBlockInfo = {
  readonly blockId: string
  /** 내용 노드(`code_block`)의 위치. */
  readonly pos: number
  readonly node: PmNode
  /** 저장된 언어 — 없거나 plain text 면 null. 목록 밖의 값도 그대로다. */
  readonly language: string | null
  readonly wrap: boolean
  /** 캡션의 평문(정화한 뒤). */
  readonly caption: string
  /** 받은 캡션에 평문 한 런으로 옮기면 잃는 것(서식 · 링크 · 멘션 · 여러 런)이 있는가. */
  readonly captionFormatted: boolean
  readonly text: string
}

/** 이 블록이 코드 블록이면 그 지금 값, 아니면(없다 · 타입이 바뀌었다) null. */
export function codeBlockInfo(state: EditorState, blockId: string): CodeBlockInfo | null {
  const info = findContainerById(state.doc, blockId)
  if (!info || blockTypeOf(info.contentNode) !== CODE_TYPE) return null
  const props = (info.contentNode.attrs.props ?? {}) as Record<string, unknown>
  const format = (info.contentNode.attrs.format ?? {}) as BlockFormat
  return {
    blockId,
    pos: info.contentPos,
    node: info.contentNode,
    language: codeLanguageOf(props),
    wrap: format.code_wrap === true,
    caption: codeCaptionText(props),
    captionFormatted: isCaptionFormatted(props),
    text: info.contentNode.textContent,
  }
}

/**
 * 되돌리기의 묶기를 끊는다 — 협업 편집기(y-prosemirror)의 UndoManager 가 있을 때만. 없으면(Phase 0 편집기 · 테스트) 아무것도
 * 하지 않는다.
 */
export function separateUndoStep(state: EditorState): void {
  const manager = (yUndoPluginKey.getState(state) as { undoManager?: { stopCapturing: () => void } } | undefined)?.undoManager
  manager?.stopCapturing()
}

/**
 * 코드 블록의 attrs 를 바꾸는 트랜잭션 — 바뀐 것이 없거나 코드 블록이 아니면 null. `change` 는 새 props · format 을 돌려준다
 * (새 객체여야 한다).
 */
function codeAttrsTransaction(
  state: EditorState,
  blockId: string,
  change: (props: Record<string, unknown>, format: BlockFormat) => { props: Record<string, unknown>; format: BlockFormat },
): Transaction | null {
  const current = codeBlockInfo(state, blockId)
  if (current === null) return null
  const props = (current.node.attrs.props ?? {}) as Record<string, unknown>
  const format = (current.node.attrs.format ?? {}) as BlockFormat
  const next = change(props, format)
  const nextFormat = normalizeFormat(CODE_TYPE, next.format)
  // 던지지 않는 비교 — 수선이 오기 전의 협업 문서에는 bigint 같은 값이 있을 수 있다(`JSON.stringify` 가 던진다 · 정본 ⑧).
  if (sameJsonValue(next.props, props) && sameJsonValue(nextFormat, format)) return null
  try {
    return state.tr.setNodeMarkup(current.pos, undefined, { ...current.node.attrs, props: next.props, format: nextFormat })
  } catch {
    // 수선이 오기 전 스키마를 어긴 협업 문서에서 setNodeMarkup 이 던질 수 있다(내용 검사) — 키맵의 swallowCommandErrors 와 같은
    // 까닭으로 삼킨다. 바꾸지 못한 것은 화면이 그대로 보여 준다.
    return null
  }
}

function runCodeCommand(transaction: (state: EditorState) => Transaction | null): Command {
  return (state, dispatch) => {
    const tr = transaction(state)
    if (tr === null) return false
    if (dispatch) {
      separateUndoStep(state)
      // 스크롤하지 않는다 — attrs 만 바꾸고 선택은 그대로다. 크롬 버튼은 mousedown 을 막아 캐럿이 전에 친 자리(화면 밖일 수 있다)에
      // 남으므로, 스크롤하면 누른 블록을 두고 그 캐럿으로 화면이 튄다(8a-2 설계 비평). 블록 색 · 할 일 체크와 같다.
      dispatch(tr)
      separateUndoStep(state)
    }
    return true
  }
}

/** 언어를 바꾼다 — null · plain text 면 키를 지운다(정본 ④). 목록 밖의 값도 받는다(64자까지). */
export function setCodeLanguageCommand(blockId: string, language: string | null): Command {
  return runCodeCommand((state) =>
    codeAttrsTransaction(state, blockId, (props, format) => ({ props: withCodeLanguage(props, language), format: { ...format } })),
  )
}

/** 줄바꿈을 켜거나 끈다 — 켜면 `code_wrap: true`, 끄면 키를 지운다(정본 ⑥). */
export function setCodeWrapCommand(blockId: string, wrap: boolean): Command {
  return runCodeCommand((state) =>
    codeAttrsTransaction(state, blockId, (props, format) => {
      const next: BlockFormat = { ...format }
      if (wrap) next.code_wrap = true
      else delete next.code_wrap
      return { props: { ...props }, format: next }
    }),
  )
}

/**
 * 캡션을 쓴다 — 평문 한 런(정본 ⑤). **글자가 바뀌지 않았으면 쓰지 않는다** — 받은 캡션의 서식 · 링크 · 멘션을 지킨다. 비우면 키를
 * 지운다.
 */
export function setCodeCaptionCommand(blockId: string, text: string): Command {
  return runCodeCommand((state) =>
    codeAttrsTransaction(state, blockId, (props, format) => ({ props: withCodeCaption(props, text), format: { ...format } })),
  )
}
