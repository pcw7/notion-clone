/**
 * 파일 블록 노드 뷰 — F-01-15 P1 (32번 트랙 F-1b · 정본 §3.4 [보강 F-1] ⑧)
 *
 * 이미지 노드 뷰(`image-view.ts`)를 본뜬다 — DOM 은 우리 것이고(`ignoreMutation`), 올리는 상태는 뷰 안에만 산다(문서에는 출처만 쓴다),
 * 위치는 `getPos()` 로 다시 묻는다. 다른 것:
 *
 *   · 그림이 아니라 **카드**다 — 📎 이름 · 크기 · 누르면 내려받기(앱의 파일 경로 — 서버가 이미지가 아니면 attachment 로 준다 · 정본 ③) ·
 *     바깥 주소는 새 탭. 이름 · 크기는 블록에 없다(정본 ①) — `deps.fileMeta` 가 `GET /files/{id}` 를 읽어 기억한다(없으면 "파일").
 *   · 폭 · 정렬 · 대체 텍스트가 없다. 캡션은 이미지와 같은 편집기 밖의 입력칸(`data-code-ui="file_caption"`).
 *   · 올리기는 `kind='file'` — MIME 을 가리지 않는다(크기 · 빈 파일은 서버가 거절하고 여기서 말한다).
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import { FILE_TYPE, fileDisplayName, formatFileSize, isSafeFileUrl, readFileSource, type FileSource } from '../block/file-block.ts'
import { imageContentPath, readCaption, withImageSource } from '../block/image.ts'
import type { UploadOutcome } from '../file/upload-client.ts'
import type { FileMetaSource } from './file-meta.ts'
import { takeQueuedUpload } from './image-drop.ts'
import { containerAt } from './pm-blocks.ts'

export type FileViewDeps = {
  readonly workspaceId: string
  /** 파일을 올리고(`kind='file'`) `file.id` 를 돌려준다. 실패도 값으로 온다. */
  readonly uploadFile: (file: File, onProgress: (fraction: number) => void, signal?: AbortSignal) => Promise<UploadOutcome>
  /** 올린 파일의 이름 · 크기(정본 ⑧). 없으면(읽기 전용 미리보기 · 검사) 이름 없이 그린다. */
  readonly fileMeta?: FileMetaSource
  /** 캡션 입력을 연다 — 편집기 밖의 입력칸(이미지 · 코드와 같다). 읽기 전용 편집기는 아무것도 하지 않는다. */
  readonly openFileCaption: (blockId: string) => void
}

/** 컨테이너의 blockId — 노드 뷰는 내용 노드만 받으므로 위로 올라간다(`image-view.ts` 와 같다). */
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

export function fileNodeView(node: PmNode, view: EditorView, getPos: () => number | undefined, deps: FileViewDeps): NodeView {
  const dom = element('figure', 'blk blk-file')
  dom.contentEditable = 'false'
  const controls = element('div', 'blk-file-controls')
  let current = node
  let uploading = false
  let failure = ''
  let retryFile: File | null = null
  let controller: AbortController | null = null

  // ── 문서에 쓰기 ─────────────────────────────────────────────────────
  const setSource = (source: FileSource | null): boolean => {
    if (!view.editable) return false
    const pos = getPos()
    if (pos === undefined) return false
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== FILE_TYPE) return false
    // 출처의 모양은 이미지와 같다(정본 ①) — 같은 쓰기 함수
    const props = withImageSource(node.attrs.props as Record<string, unknown>, source)
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, props }))
    return true
  }
  const notWritten = (): void => {
    failure = view.editable ? '파일을 넣지 못했습니다 — 블록이 바뀌었습니다.' : '읽기 전용이라 파일을 넣지 못했습니다.'
    render()
  }

  // ── 올리기 ──────────────────────────────────────────────────────────
  const picker = document.createElement('input')
  picker.type = 'file'
  picker.className = 'blk-file-file'
  picker.hidden = true
  const progress = element('progress', 'blk-file-progress')
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
    const result = await deps.uploadFile(
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
  /** 끌어다 놓거나 붙여넣어서 파일이 정해진 채로 만들어진 블록인가(`image-drop.ts` 의 큐 — 이미지와 같은 큐). */
  const queued = (): File | null => {
    const pos = getPos()
    if (pos === undefined) return null
    const info = containerAt(view.state.doc.resolve(pos))
    return info === null ? null : takeQueuedUpload(view, info.id)
  }

  // ── 그리기 ──────────────────────────────────────────────────────────
  const renderEmpty = (): void => {
    const pick = element('button', 'blk-file-pick', '파일 올리기')
    pick.type = 'button'
    pick.setAttribute('data-testid', 'file-pick')
    pick.addEventListener('click', () => {
      if (view.editable) picker.click()
    })
    const form = element('form', 'blk-file-url')
    const input = element('input', 'blk-file-url-input')
    input.type = 'url'
    input.placeholder = '파일 주소 붙여넣기'
    input.setAttribute('aria-label', '파일 주소')
    const add = element('button', 'blk-file-url-add', '추가')
    add.type = 'submit'
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const url = input.value.trim()
      if (!isSafeFileUrl(url)) {
        failure = 'http 또는 https 로 시작하는 주소만 넣을 수 있습니다.'
        render()
        return
      }
      if (!setSource({ kind: 'external', url })) notWritten()
    })
    form.append(input, add)
    controls.append(pick, form)
  }

  /** 카드 — 이름 · 크기는 메타가 오면 그 자리에서 바꾼다(다시 그리지 않는다 · 깜빡이지 않게). */
  const renderCard = (source: FileSource): void => {
    const card = element('a', 'blk-file-card')
    card.setAttribute('data-testid', 'file-card')
    const name = element('span', 'blk-file-name')
    const size = element('span', 'blk-file-size')
    const known = source.kind === 'file' ? (deps.fileMeta?.peek(source.fileId) ?? null) : null
    name.textContent = fileDisplayName(source, known?.name ?? null)
    size.textContent = known === null ? '' : formatFileSize(known.size)
    if (source.kind === 'file') {
      card.href = imageContentPath(deps.workspaceId, source.fileId)
      card.setAttribute('download', name.textContent ?? '')
      if (known === null && deps.fileMeta !== undefined) {
        void deps.fileMeta.get(source.fileId).then((meta) => {
          // 그 사이에 출처가 바뀌었으면 낡은 답이다
          const now = readFileSource(current.attrs.props)
          if (meta === null || now === null || now.kind !== 'file' || now.fileId !== source.fileId) return
          name.textContent = fileDisplayName(source, meta.name)
          size.textContent = formatFileSize(meta.size)
          card.setAttribute('download', name.textContent ?? '')
        })
      }
    } else {
      card.href = source.url
      card.target = '_blank'
      card.rel = 'noopener noreferrer'
    }
    const icon = element('span', 'blk-file-icon', '📎')
    icon.setAttribute('aria-hidden', 'true')
    card.append(icon, name, size)
    dom.prepend(card)
  }

  const render = (): void => {
    dom.replaceChildren()
    controls.replaceChildren()
    const props = current.attrs.props as Record<string, unknown>
    const source = readFileSource(props)
    if (uploading) {
      dom.dataset.state = 'uploading'
      const cancel = element('button', 'blk-file-upload-cancel', '취소')
      cancel.type = 'button'
      cancel.setAttribute('data-testid', 'file-upload-cancel')
      cancel.addEventListener('mousedown', (event) => event.preventDefault())
      cancel.addEventListener('click', () => controller?.abort())
      controls.append(element('span', 'blk-file-status', '올리는 중'), progress, cancel)
    } else if (source !== null) {
      dom.dataset.state = 'ready'
      renderCard(source)
      const caption = readCaption(props)
      if (caption !== '') dom.append(element('figcaption', 'blk-file-caption', caption))
      // 교체 — 다시 고르면 새 파일을 올려 출처를 바꾼다(옛 파일의 참조는 투영이 내린다)
      const replace = element('button', 'blk-file-replace', '교체')
      replace.type = 'button'
      replace.setAttribute('data-testid', 'file-replace')
      replace.addEventListener('mousedown', (event) => event.preventDefault())
      replace.addEventListener('click', () => {
        if (view.editable) picker.click()
      })
      controls.append(replace)
      const captionButton = element('button', 'blk-file-caption-open', caption === '' ? '캡션 추가' : '캡션 고치기')
      captionButton.type = 'button'
      captionButton.setAttribute('data-testid', 'file-caption-open')
      captionButton.setAttribute('data-code-ui', 'file_caption')
      captionButton.addEventListener('mousedown', (event) => event.preventDefault())
      captionButton.addEventListener('click', () => {
        if (!view.editable) return
        const id = containerIdAt(view, getPos)
        if (id !== '') deps.openFileCaption(id)
      })
      controls.append(captionButton)
    } else {
      dom.dataset.state = 'empty'
      renderEmpty()
    }
    if (failure !== '') {
      const box = element('div', 'blk-file-failure', failure)
      box.setAttribute('role', 'alert')
      const again = retryFile
      if (again !== null && view.editable) {
        const retry = element('button', 'blk-file-upload-retry', '다시 올리기')
        retry.type = 'button'
        retry.setAttribute('data-testid', 'file-upload-retry')
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
      if (updated.type.name !== FILE_TYPE) return false
      current = updated
      if (readFileSource(updated.attrs.props) !== null) failure = ''
      render()
      return true
    },
    // 단추 · 입력칸 · 카드 링크의 이벤트는 우리 것이다 — 편집기가 선택 옮기기로 받지 않게.
    stopEvent: (event) => {
      const target = event.target
      return target instanceof Node && (controls.contains(target) || (target instanceof Element && target.closest('.blk-file-card') !== null))
    },
    ignoreMutation: () => true,
  }
}
