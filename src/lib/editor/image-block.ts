/**
 * 이미지 블록의 편집 명령 — 대체 텍스트 쓰기 (플랫폼 잔여 10d-1b · F-12-13) · 캡션 쓰기 (10n-62 · F-01-15)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 이미지의 대체 텍스트 ⑤
 *
 * 대체 텍스트는 본문의 것이다(`format.alt_text` · `format.alt_decorative`) — 대화상자가 저장할 때 이 명령으로 Y.Doc 에 쓴다(버튼 블록의
 * 라벨과 같은 길 · `button-block.ts`). 쓰는 모양은 `withImageAlt` 하나(빈 말 · 거짓은 키를 지운다 · 모르는 키는 그대로).
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Command, EditorState } from '@tiptap/pm/state'

import { IMAGE_TYPE, readImageAlt, withImageAlt, type ImageAlt } from '../block/image.ts'
import { codeCaptionText, isCaptionFormatted, withCodeCaption } from '../block/code.ts'
import { sameJsonValue } from '../contracts/json-safe.ts'
import { separateUndoStep } from './code-block.ts'
import { blockTypeOf, findContainerById } from './pm-blocks.ts'

/** 이미지 블록 하나의 지금 값. */
export type ImageBlockInfo = { readonly blockId: string; readonly pos: number; readonly node: PmNode; readonly alt: ImageAlt }

/** 이 블록이 이미지 블록이면 그 지금 값, 아니면(없다 · 타입이 바뀌었다) null. */
export function imageBlockInfo(state: EditorState, blockId: string): ImageBlockInfo | null {
  const info = findContainerById(state.doc, blockId)
  if (!info || blockTypeOf(info.contentNode) !== IMAGE_TYPE) return null
  return { blockId, pos: info.contentPos, node: info.contentNode, alt: readImageAlt(info.contentNode.attrs.format) }
}

/** 대체 텍스트를 쓴다 — 같은 값이면 쓰지 않는다(되돌리기 기록을 더럽히지 않게). */
export function setImageAltCommand(blockId: string, alt: ImageAlt): Command {
  return (state, dispatch) => {
    const current = imageBlockInfo(state, blockId)
    if (current === null) return false
    const format = (current.node.attrs.format ?? {}) as Record<string, unknown>
    const next = withImageAlt(format, alt)
    if (sameJsonValue(next, format)) return false
    let tr
    try {
      tr = state.tr.setNodeMarkup(current.pos, undefined, { ...current.node.attrs, format: next })
    } catch {
      // 수선이 오기 전 스키마를 어긴 협업 문서 — 버튼 블록의 명령과 같은 까닭으로 삼킨다.
      return false
    }
    if (dispatch) {
      separateUndoStep(state)
      dispatch(tr)
      separateUndoStep(state)
    }
    return true
  }
}

// ── 캡션 (10n-62 · F-01-15 · 정본 §3.4 [보강 10n-62] 이미지의 캡션 편집) ─────────────────────────────

/** 이미지 블록의 캡션 — 평문(정화한 뒤)과, 평문 한 런으로 옮기면 잃는 것이 있는가. 코드 블록의 캡션과 같은 읽기(`code.ts`). */
export type ImageCaptionInfo = ImageBlockInfo & { readonly caption: string; readonly captionFormatted: boolean }

export function imageCaptionInfo(state: EditorState, blockId: string): ImageCaptionInfo | null {
  const info = imageBlockInfo(state, blockId)
  if (info === null) return null
  const props = (info.node.attrs.props ?? {}) as Record<string, unknown>
  return { ...info, caption: codeCaptionText(props), captionFormatted: isCaptionFormatted(props) }
}

/**
 * 캡션을 쓴다 — 코드 블록의 캡션과 같은 규칙(`withCodeCaption` · 정본 §3.4 [보강] 코드 블록 ⑤): 평문 런 · **글자가 바뀌지 않았으면 쓰지
 * 않는다**(받은 서식 · 링크 · 멘션을 지킨다) · 비우면 키를 지운다 · 자르지 않는다(2000자마다 런을 나눈다). 같은 값이면 거절(되돌리기 기록을
 * 더럽히지 않게).
 */
export function setImageCaptionCommand(blockId: string, text: string): Command {
  return (state, dispatch) => {
    const current = imageBlockInfo(state, blockId)
    if (current === null) return false
    const props = (current.node.attrs.props ?? {}) as Record<string, unknown>
    const next = withCodeCaption(props, text)
    if (sameJsonValue(next, props)) return false
    let tr
    try {
      tr = state.tr.setNodeMarkup(current.pos, undefined, { ...current.node.attrs, props: next })
    } catch {
      // 수선이 오기 전 스키마를 어긴 협업 문서 — 대체 텍스트의 명령과 같은 까닭으로 삼킨다.
      return false
    }
    if (dispatch) {
      separateUndoStep(state)
      dispatch(tr)
      separateUndoStep(state)
    }
    return true
  }
}
