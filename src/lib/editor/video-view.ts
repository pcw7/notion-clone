/**
 * 비디오 블록 노드 뷰 — F-01-15 P1 (32번 트랙 F-2 · 정본 §3.4 [보강 F-2] ④)
 *
 * 이미지 노드 뷰(`image-view.ts`)를 본뜬다 — 틀 · 폭 손잡이 · 정렬 단추 · 빈 상태(올리기 · 주소) · 올리는 중(진행률 · 취소 · 다시 올리기) · 실패.
 * 다른 것:
 *
 *   · `<img>` 대신 `<video controls preload="metadata">` — 폭 · 정렬은 이미지의 `format` 키 그대로(`readImageLayout` · `setImageLayoutCommand` 가
 *     이미지와 비디오를 함께 받는다).
 *   · 불러오지 못해도 틀을 걷지 않는다 — 플레이어가 제 실패를 그리고, 그 아래에 "원본 열기" 를 단다(브라우저가 코덱을 모를 수 있다 · 주소는 맞다).
 *   · 대체 텍스트가 없다 — 캡션이 그 말이다(`video_caption` — 이미지 · 파일 · 코드와 같은 편집기 밖 입력칸).
 *   · 올리기는 `kind='video'` — 서버가 mp4 · webm 의 머리 바이트로 가린다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import {
  IMAGE_ALIGNS,
  draggedImageWidth,
  imageDisplayUrl,
  readCaption,
  readImageLayout,
  steppedImageWidth,
  withImageSource,
  type ImageAlign,
  type ImageHandleSide,
} from '../block/image.ts'
import { VIDEO_TYPE, isSafeVideoUrl, readVideoSource, type VideoSource } from '../block/video-block.ts'
import { ALLOWED_VIDEO_MIME } from '../file/limits.ts'
import type { UploadOutcome } from '../file/upload-client.ts'
import { setImageLayoutCommand } from './image-block.ts'
import { takeQueuedUpload } from './image-drop.ts'
import { containerAt } from './pm-blocks.ts'

export type VideoViewDeps = {
  readonly workspaceId: string
  /** 비디오를 올리고(`kind='video'`) `file.id` 를 돌려준다. 실패도 값으로 온다. */
  readonly uploadVideo: (file: File, onProgress: (fraction: number) => void, signal?: AbortSignal) => Promise<UploadOutcome>
  /** 캡션 입력을 연다 — 편집기 밖의 입력칸. 읽기 전용 편집기는 아무것도 하지 않는다. */
  readonly openVideoCaption: (blockId: string) => void
}

const ALIGN_LABEL: Readonly<Record<ImageAlign, string>> = { left: '왼쪽', center: '가운데', right: '오른쪽' }

function containerIdAt(view: EditorView, getPos: () => number | undefined): string {
  const pos = getPos()
  if (pos === undefined) return ''
  const $pos = view.state.doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name === 'blockContainer') return String(node.attrs.blockId ?? '')
  }
  return ''
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  el.className = className
  if (text !== undefined) el.textContent = text
  return el
}

export function videoNodeView(node: PmNode, view: EditorView, getPos: () => number | undefined, deps: VideoViewDeps): NodeView {
  const dom = element('figure', 'blk blk-video')
  dom.contentEditable = 'false'
  const controls = element('div', 'blk-video-controls')
  let current = node
  let uploading = false
  let failure = ''
  let retryFile: File | null = null
  let controller: AbortController | null = null

  // ── 문서에 쓰기 ─────────────────────────────────────────────────────
  const setSource = (source: VideoSource | null): boolean => {
    if (!view.editable) return false
    const pos = getPos()
    if (pos === undefined) return false
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== VIDEO_TYPE) return false
    const props = withImageSource(node.attrs.props as Record<string, unknown>, source)
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, props }))
    return true
  }
  const notWritten = (): void => {
    failure = view.editable ? '비디오를 넣지 못했습니다 — 블록이 바뀌었습니다.' : '읽기 전용이라 비디오를 넣지 못했습니다.'
    render()
  }

  // ── 올리기 ──────────────────────────────────────────────────────────
  const picker = document.createElement('input')
  picker.type = 'file'
  picker.accept = ALLOWED_VIDEO_MIME.join(',')
  picker.className = 'blk-video-file'
  picker.hidden = true
  const progress = element('progress', 'blk-video-progress')
  progress.max = 1
  progress.value = 0
  const startUpload = async (file: File): Promise<void> => {
    uploading = true
    failure = ''
    retryFile = null
    progress.value = 0
    progress.textContent = '0%'
    const mine = new AbortController()
    controller = mine
    render()
    const result = await deps.uploadVideo(
      file,
      (fraction) => {
        progress.value = fraction
        progress.textContent = `${Math.round(fraction * 100)}%`
      },
      mine.signal,
    )
    if (controller === mine) controller = null
    uploading = false
    if (result.ok) {
      if (!setSource({ kind: 'file', fileId: result.fileId })) notWritten()
      return
    }
    failure = result.cancelled === true ? '' : result.message
    retryFile = result.retryable === true ? file : null
    render()
  }
  picker.addEventListener('change', () => {
    const file = picker.files?.[0]
    picker.value = ''
    if (file) void startUpload(file)
  })
  const queued = (): File | null => {
    const pos = getPos()
    if (pos === undefined) return null
    const info = containerAt(view.state.doc.resolve(pos))
    return info === null ? null : takeQueuedUpload(view, info.id)
  }

  // ── 그리기 ──────────────────────────────────────────────────────────
  const renderEmpty = (): void => {
    const pick = element('button', 'blk-video-pick', '비디오 올리기')
    pick.type = 'button'
    pick.setAttribute('data-testid', 'video-pick')
    pick.addEventListener('click', () => {
      if (view.editable) picker.click()
    })
    const form = element('form', 'blk-video-url')
    const input = element('input', 'blk-video-url-input')
    input.type = 'url'
    input.placeholder = '비디오 주소 붙여넣기(mp4 · webm)'
    input.setAttribute('aria-label', '비디오 주소')
    const add = element('button', 'blk-video-url-add', '추가')
    add.type = 'submit'
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const url = input.value.trim()
      if (!isSafeVideoUrl(url)) {
        failure = 'http 또는 https 로 시작하는 주소만 넣을 수 있습니다.'
        render()
        return
      }
      if (!setSource({ kind: 'external', url })) notWritten()
    })
    form.append(input, add)
    controls.append(pick, form)
  }

  /** 폭 손잡이 — 이미지의 것과 같은 규칙(`image-view.ts` · 정본 [보강 10n-63] ④): 끄는 동안은 CSS 변수로만 · 놓을 때 한 번 쓴다 · 키 · 두 번 누르기. */
  const resizeHandle = (side: ImageHandleSide, frame: HTMLElement): HTMLElement => {
    const handle = element('span', 'blk-video-handle')
    handle.dataset.side = side
    handle.setAttribute('data-testid', `video-resize-${side}`)
    handle.setAttribute('role', 'slider')
    handle.setAttribute('aria-label', side === 'left' ? '비디오 폭(왼쪽 손잡이)' : '비디오 폭')
    handle.setAttribute('aria-valuemin', '10')
    handle.setAttribute('aria-valuemax', '100')
    handle.tabIndex = 0
    const ratioNow = (): number => {
      const column = dom.getBoundingClientRect().width
      return column > 0 ? Math.min(1, frame.getBoundingClientRect().width / column) : 1
    }
    const syncValue = (): void => handle.setAttribute('aria-valuenow', String(Math.round(ratioNow() * 100)))
    queueMicrotask(syncValue)
    frame.querySelector('video')?.addEventListener('loadedmetadata', syncValue)
    const commit = (width: number | null): void => {
      const id = containerIdAt(view, getPos)
      if (id === '' || !view.editable) return
      const refocus = document.activeElement === handle
      if (!setImageLayoutCommand(id, { width })(view.state, view.dispatch.bind(view))) render()
      if (refocus) dom.querySelector<HTMLElement>(`.blk-video-handle[data-side="${side}"]`)?.focus()
    }
    let drag: { startX: number; startPx: number; column: number; align: ImageAlign; width: number } | null = null
    handle.addEventListener('mousedown', (event) => event.preventDefault())
    handle.addEventListener('pointerdown', (event) => {
      if (!view.editable || event.button !== 0) return
      event.preventDefault()
      handle.setPointerCapture(event.pointerId)
      const align = readImageLayout(current.attrs.format).align
      drag = { startX: event.clientX, startPx: frame.getBoundingClientRect().width, column: dom.getBoundingClientRect().width, align, width: ratioNow() }
      dom.dataset.resizing = 'true'
    })
    handle.addEventListener('pointermove', (event) => {
      if (drag === null) return
      drag.width = draggedImageWidth(drag.startPx, event.clientX - drag.startX, drag.column, side, drag.align)
      dom.dataset.width = String(drag.width)
      dom.style.setProperty('--blk-video-width', `${drag.width * 100}%`)
      handle.setAttribute('aria-valuenow', String(Math.round(drag.width * 100)))
    })
    const finish = (event: PointerEvent): void => {
      if (drag === null) return
      const moved = Math.abs(event.clientX - drag.startX) > 2
      const width = drag.width
      drag = null
      delete dom.dataset.resizing
      if (moved) commit(width)
    }
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', () => {
      drag = null
      delete dom.dataset.resizing
      render()
    })
    handle.addEventListener('dblclick', (event) => {
      event.preventDefault()
      commit(null)
    })
    handle.addEventListener('keydown', (event) => {
      const next = steppedImageWidth(ratioNow(), event.key)
      if (next === null) return
      event.preventDefault()
      commit(next)
    })
    return handle
  }

  const renderVideo = (source: VideoSource, caption: string): void => {
    const url = imageDisplayUrl(deps.workspaceId, source)
    if (url === null) return
    const frame = element('span', 'blk-video-frame')
    const video = document.createElement('video')
    video.controls = true
    video.preload = 'metadata'
    video.src = url
    video.addEventListener('error', () => {
      // 틀은 걷지 않는다 — 플레이어가 제 실패를 그린다(머리말). "원본 열기" 를 아래에 한 번만 단다.
      if (dom.querySelector('.blk-video-error') !== null) return
      const box = element('div', 'blk-video-error', '비디오를 재생할 수 없습니다. ')
      const link = element('a', 'blk-video-origin', '원본 열기')
      link.href = url
      link.target = '_blank'
      link.rel = 'noreferrer noopener'
      box.append(link)
      frame.after(box)
    })
    frame.append(video)
    for (const side of ['left', 'right'] as const) frame.append(resizeHandle(side, frame))
    dom.prepend(frame)
    if (caption !== '') dom.append(element('figcaption', 'blk-video-caption', caption))
  }

  const render = (): void => {
    dom.replaceChildren()
    controls.replaceChildren()
    const props = current.attrs.props as Record<string, unknown>
    const source = readVideoSource(props)
    const layout = readImageLayout(current.attrs.format)
    if (source !== null && layout.width !== null) {
      dom.dataset.width = String(layout.width)
      dom.style.setProperty('--blk-video-width', `${layout.width * 100}%`)
    } else {
      delete dom.dataset.width
      dom.style.removeProperty('--blk-video-width')
    }
    if (source !== null && layout.align !== 'left') dom.dataset.align = layout.align
    else delete dom.dataset.align
    if (uploading) {
      dom.dataset.state = 'uploading'
      const cancel = element('button', 'blk-video-upload-cancel', '취소')
      cancel.type = 'button'
      cancel.setAttribute('data-testid', 'video-upload-cancel')
      cancel.addEventListener('mousedown', (event) => event.preventDefault())
      cancel.addEventListener('click', () => controller?.abort())
      controls.append(element('span', 'blk-video-status', '올리는 중'), progress, cancel)
    } else if (source !== null) {
      dom.dataset.state = 'ready'
      const caption = readCaption(props)
      renderVideo(source, caption)
      const captionButton = element('button', 'blk-video-caption-open', caption === '' ? '캡션 추가' : '캡션 고치기')
      captionButton.type = 'button'
      captionButton.setAttribute('data-testid', 'video-caption-open')
      captionButton.setAttribute('data-code-ui', 'video_caption')
      captionButton.addEventListener('mousedown', (event) => event.preventDefault())
      captionButton.addEventListener('click', () => {
        if (!view.editable) return
        const id = containerIdAt(view, getPos)
        if (id !== '') deps.openVideoCaption(id)
      })
      controls.append(captionButton)
      const alignGroup = element('span', 'blk-video-align')
      alignGroup.setAttribute('role', 'group')
      alignGroup.setAttribute('aria-label', '비디오 정렬')
      for (const align of IMAGE_ALIGNS) {
        const button = element('button', 'blk-video-align-button', ALIGN_LABEL[align])
        button.type = 'button'
        button.setAttribute('data-testid', `video-align-${align}`)
        button.setAttribute('aria-pressed', String(layout.align === align))
        button.addEventListener('mousedown', (event) => event.preventDefault())
        button.addEventListener('click', () => {
          if (!view.editable) return
          const id = containerIdAt(view, getPos)
          if (id !== '') setImageLayoutCommand(id, { align })(view.state, view.dispatch.bind(view))
        })
        alignGroup.append(button)
      }
      controls.append(alignGroup)
    } else {
      dom.dataset.state = 'empty'
      renderEmpty()
    }
    if (failure !== '') {
      const box = element('div', 'blk-video-failure', failure)
      box.setAttribute('role', 'alert')
      const again = retryFile
      if (again !== null && view.editable) {
        const retry = element('button', 'blk-video-upload-retry', '다시 올리기')
        retry.type = 'button'
        retry.setAttribute('data-testid', 'video-upload-retry')
        retry.addEventListener('mousedown', (event) => event.preventDefault())
        retry.addEventListener('click', () => void startUpload(again))
        box.append(' ', retry)
      }
      controls.append(box)
    }
    if (controls.childElementCount > 0) dom.append(controls)
    dom.append(picker)
  }

  render()
  const pending = queued()
  if (pending !== null) void startUpload(pending)

  return {
    dom,
    update: (updated) => {
      if (updated.type.name !== VIDEO_TYPE) return false
      current = updated
      if (readVideoSource(updated.attrs.props) !== null) failure = ''
      render()
      return true
    },
    // 단추 줄 · 폭 손잡이 · 플레이어(재생 · 탐색을 편집기가 선택 옮기기로 받지 않게)
    stopEvent: (event) => {
      const target = event.target
      return (
        target instanceof Node &&
        (controls.contains(target) || (target instanceof Element && (target.closest('.blk-video-handle') !== null || target.closest('video') !== null)))
      )
    },
    ignoreMutation: () => true,
  }
}
