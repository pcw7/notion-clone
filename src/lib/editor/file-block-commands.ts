/**
 * 파일 블록의 편집기 명령 — 캡션 (F-1b · 정본 §3.4 [보강 F-1] ⑧)
 *
 * 이미지의 캡션 명령(`image-block.ts` · 10n-62)과 같은 모양이다 — 캡션은 `properties.caption`(RichText) 이고 코드 캡션의 읽기 · 쓰기
 * (`codeCaptionText` · `withCodeCaption`)를 그대로 쓴다. 타입 검사만 `file` 이다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Command, EditorState } from '@tiptap/pm/state'

import { FILE_TYPE } from '../block/file-block.ts'
import { codeCaptionText, isCaptionFormatted, withCodeCaption } from '../block/code.ts'
import { sameJsonValue } from '../contracts/json-safe.ts'
import { separateUndoStep } from './code-block.ts'
import { blockTypeOf, findContainerById } from './pm-blocks.ts'

export type FileBlockInfo = { readonly blockId: string; readonly pos: number; readonly node: PmNode }

/** 그 id 의 파일 블록 — 없거나 파일 블록이 아니면(타입이 바뀌었다) null. */
export function fileBlockInfo(state: EditorState, blockId: string): FileBlockInfo | null {
  const info = findContainerById(state.doc, blockId)
  if (!info || blockTypeOf(info.contentNode) !== FILE_TYPE) return null
  return { blockId, pos: info.contentPos, node: info.contentNode }
}

export type FileCaptionInfo = FileBlockInfo & { readonly caption: string; readonly captionFormatted: boolean }

export function fileCaptionInfo(state: EditorState, blockId: string): FileCaptionInfo | null {
  const info = fileBlockInfo(state, blockId)
  if (info === null) return null
  const props = (info.node.attrs.props ?? {}) as Record<string, unknown>
  return { ...info, caption: codeCaptionText(props), captionFormatted: isCaptionFormatted(props) }
}

/** 캡션을 쓴다 — 같은 값이면 거절. 되돌리기는 한 걸음(이미지 · 코드와 같다). */
export function setFileCaptionCommand(blockId: string, text: string): Command {
  return (state, dispatch) => {
    const current = fileBlockInfo(state, blockId)
    if (current === null) return false
    const props = (current.node.attrs.props ?? {}) as Record<string, unknown>
    const next = withCodeCaption(props, text)
    if (sameJsonValue(next, props)) return false
    let tr
    try {
      tr = state.tr.setNodeMarkup(current.pos, undefined, { ...current.node.attrs, props: next })
    } catch {
      // 수선이 오기 전 스키마를 어긴 협업 문서 — 이미지 · 버튼의 명령과 같은 까닭으로 삼킨다.
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
