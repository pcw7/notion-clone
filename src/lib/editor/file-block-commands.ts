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
import { EMBED_TYPE, readEmbedUrl, withoutEmbedHeight } from '../block/embed-block.ts'
import { isOwnHostUrl } from '../block/embed-origin.ts'
import { codeCaptionText, isCaptionFormatted, withCodeCaption } from '../block/code.ts'
import { sameJsonValue } from '../contracts/json-safe.ts'
import { separateUndoStep } from './code-block.ts'
import { blockTypeOf, findContainerById } from './pm-blocks.ts'

type CaptionedType = typeof FILE_TYPE | typeof VIDEO_TYPE | typeof BOOKMARK_TYPE | typeof EMBED_TYPE

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

/** 임베드(EM-1) — 같은 입력칸 · 같은 명령. */
export function embedCaptionInfo(state: EditorState, blockId: string): FileCaptionInfo | null {
  return captionInfoOf(blockInfoOf(state, blockId, EMBED_TYPE))
}

export const setEmbedCaptionCommand = captionCommand(EMBED_TYPE)

/** 북마크 ↔ 임베드 바꾸기(EM-3) — 바꿀 수 있는 블록의 지금 타입. 아니면 null. */
export function swapSourceOf(state: EditorState, blockId: string): typeof BOOKMARK_TYPE | typeof EMBED_TYPE | null {
  if (blockInfoOf(state, blockId, BOOKMARK_TYPE) !== null) return BOOKMARK_TYPE
  if (blockInfoOf(state, blockId, EMBED_TYPE) !== null) return EMBED_TYPE
  return null
}

/** 이 주소를 임베드로 그릴 수 있는가 — 자기 출처 · http 일반은 아니다. 주소가 없는 빈 블록은 된다. */
export function canEmbedProperties(properties: unknown, ownHosts: readonly string[]): boolean {
  const url = readEmbedUrl(properties)
  // 자기 출처만 막는다 — http 일반 주소는 바꿀 수 있고 임베드가 그리지 않는 이유를 보인다(규칙 모듈을 늘 실리는 쪽에 싣지 않는다).
  return url === null || !isOwnHostUrl(url, ownHosts)
}

/**
 * 북마크 ↔ 임베드 — 블록 id · 주소 · 캡션은 그대로 두고 타입만 바꾼다(임베드 → 북마크는 `height` 를 버린다). 한 트랜잭션 ·
 * 되돌리기 한 걸음. 자기 출처의 주소면 거절한다.
 */
export function swapBookmarkEmbedCommand(blockId: string, ownHosts: readonly string[]): Command {
  return (state, dispatch) => {
    const from = swapSourceOf(state, blockId)
    const info = from === null ? null : blockInfoOf(state, blockId, from)
    if (from === null || info === null) return false
    const props = (info.node.attrs.props ?? {}) as Record<string, unknown>
    const toType = from === BOOKMARK_TYPE ? EMBED_TYPE : BOOKMARK_TYPE
    if (toType === EMBED_TYPE && !canEmbedProperties(props, ownHosts)) return false
    const nodeType = state.schema.nodes[toType]
    if (!nodeType) return false
    let tr
    try {
      tr = state.tr.setNodeMarkup(info.pos, nodeType, { ...info.node.attrs, props: toType === BOOKMARK_TYPE ? withoutEmbedHeight(props) : props })
    } catch {
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
