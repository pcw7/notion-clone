/**
 * 파일 · 비디오 블록의 편집기 명령 — 캡션 (F-1b · F-2 · 정본 §3.4 [보강 F-1] ⑧ · [보강 F-2] ④)
 *
 * 이미지의 캡션 명령(`image-block.ts` · 10n-62)과 같은 모양이다 — 캡션은 `properties.caption`(RichText) 이고 코드 캡션의 읽기 · 쓰기
 * (`codeCaptionText` · `withCodeCaption`)를 그대로 쓴다. 블록 타입만 다르다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Command, EditorState } from '@tiptap/pm/state'

import { FILE_TYPE } from '../block/file-block.ts'
import { VIDEO_TYPE } from '../block/video-block.ts'
import { BOOKMARK_TYPE } from '../block/bookmark-block.ts'
import { codeCaptionText, isCaptionFormatted, withCodeCaption } from '../block/code.ts'
import { sameJsonValue } from '../contracts/json-safe.ts'
import { separateUndoStep } from './code-block.ts'
import { blockTypeOf, findContainerById } from './pm-blocks.ts'

type CaptionedType = typeof FILE_TYPE | typeof VIDEO_TYPE | typeof BOOKMARK_TYPE

export type FileBlockInfo = { readonly blockId: string; readonly pos: number; readonly node: PmNode }
export type FileCaptionInfo = FileBlockInfo & { readonly caption: string; readonly captionFormatted: boolean }

/** 그 id 의 그 타입 블록 — 없거나 타입이 다르면(바뀌었다) null. */
function blockInfoOf(state: EditorState, blockId: string, type: CaptionedType): FileBlockInfo | null {
  const info = findContainerById(state.doc, blockId)
  if (!info || blockTypeOf(info.contentNode) !== type) return null
  return { blockId, pos: info.contentPos, node: info.contentNode }
}

function captionInfoOf(info: FileBlockInfo | null): FileCaptionInfo | null {
  if (info === null) return null
  const props = (info.node.attrs.props ?? {}) as Record<string, unknown>
  return { ...info, caption: codeCaptionText(props), captionFormatted: isCaptionFormatted(props) }
}

/** 캡션을 쓰는 명령 — 같은 값이면 거절. 되돌리기는 한 걸음(이미지 · 코드와 같다). */
function captionCommand(type: CaptionedType): (blockId: string, text: string) => Command {
  return (blockId, text) => (state, dispatch) => {
    const current = blockInfoOf(state, blockId, type)
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

export function fileBlockInfo(state: EditorState, blockId: string): FileBlockInfo | null {
  return blockInfoOf(state, blockId, FILE_TYPE)
}

export function fileCaptionInfo(state: EditorState, blockId: string): FileCaptionInfo | null {
  return captionInfoOf(blockInfoOf(state, blockId, FILE_TYPE))
}

export const setFileCaptionCommand = captionCommand(FILE_TYPE)

/** 비디오(F-2) — 같은 입력칸 · 같은 명령. */
export function videoCaptionInfo(state: EditorState, blockId: string): FileCaptionInfo | null {
  return captionInfoOf(blockInfoOf(state, blockId, VIDEO_TYPE))
}

export const setVideoCaptionCommand = captionCommand(VIDEO_TYPE)

/** 북마크(F-3) — 같은 입력칸 · 같은 명령. */
export function bookmarkCaptionInfo(state: EditorState, blockId: string): FileCaptionInfo | null {
  return captionInfoOf(blockInfoOf(state, blockId, BOOKMARK_TYPE))
}

export const setBookmarkCaptionCommand = captionCommand(BOOKMARK_TYPE)
