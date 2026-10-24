/**
 * 이미지 블록 노드 뷰 — F-01-15 (P0: image)
 *
 * 정본 F-01-15 의 UI 요구: 업로드 / URL 입력, 진행률, 캡션, "불러올 수 없음" 폴백.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이 뷰의 DOM 은 우리 것이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 진행률 막대는 1초에 여러 번 바뀐다. 그 변화를 ProseMirror 가 문서 변경으로
 * 읽으면 뷰를 다시 그리고, 그러면 업로드 중인 상태가 통째로 날아간다(#31 에서
 * 토글 접기로 겪은 그 사고다).
 *
 * 지금은 **기본값이 이미 막아 준다** — `contentDOM` 이 없는 노드 뷰의
 * `ignoreMutation` 기본 구현이 `!contentDOM && type != 'selection'` 이다
 * (`prosemirror-view`). 그래도 `() => true` 를 명시해 둔다: 나중에 캡션을
 * 편집 영역으로 만들어 `contentDOM` 이 생기는 순간 기본값이 뒤집히고, 그때
 * 증상은 "가끔 업로드 표시가 사라진다"로 나타나 원인을 찾기 어렵다.
 * ⚠ 이 방어는 e2e 가 증명하지 못한다 — 빼고 돌려도 71개가 전부 통과했다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 위치는 `getPos()` 로 다시 묻는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 업로드는 몇 초가 걸리고 그동안 사용자는 위쪽에서 계속 타이핑한다. 시작할 때의
 * 위치를 들고 있으면 끝났을 때 **엉뚱한 블록에 이미지를 넣는다.** `getPos()` 는
 * ProseMirror 가 매핑해 주는 현재 위치라 그때 다시 묻는 것이 옳다. 블록이 그
 * 사이 지워졌으면 `undefined` 이고, 그러면 아무것도 하지 않는다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import {
  readImageAlt,
  imageAltText,
  IMAGE_TYPE,
  imageDisplayUrl,
  isSafeImageUrl,
  readCaption,
  readImageSource,
  readImageLayout,
  withImageSource,
  IMAGE_ALIGNS,
  draggedImageWidth,
  steppedImageWidth,
  type ImageAlign,
  type ImageHandleSide,
  type ImageSource,
} from '../block/image.ts'
import { setImageLayoutCommand } from './image-block.ts'
import { ALLOWED_IMAGE_MIME } from '../file/limits.ts'
import type { UploadOutcome } from '../file/upload-client.ts'
import { takeQueuedUpload } from './image-drop.ts'
import { containerAt } from './pm-blocks.ts'

export type ImageViewDeps = {
  /** 이 워크스페이스. 파일 주소를 만드는 데 쓴다(저장하지 않는다 — FS2). */
  readonly workspaceId: string
  /** 파일을 올리고 `file.id` 를 돌려준다. 실패도 값으로 온다. */
  readonly uploadImage: (
    file: File,
    onProgress: (fraction: number) => void,
  ) => Promise<UploadOutcome>
  /** 대체 텍스트 대화상자를 연다(10d-1b · F-12-13) — 편집기 밖의 오버레이. 읽기 전용 편집기는 아무것도 하지 않는다. */
  readonly openImageAlt: (blockId: string) => void
  /** 캡션 입력을 연다(10n-62) — 편집기 밖의 입력칸(코드 캡션과 같은 것). 읽기 전용 편집기는 아무것도 하지 않는다. */
  readonly openImageCaption: (blockId: string) => void
}

/** 정렬 단추의 말(10n-63). */
const ALIGN_LABEL: Readonly<Record<ImageAlign, string>> = { left: '왼쪽', center: '가운데', right: '오른쪽' }

/** 대체 텍스트 단추의 말(10d-1b) — 장식이면 "장식 이미지" · 말이 있으면 ✓ · 없으면 "대체 텍스트". */
function altButtonLabel(format: unknown): string {
  const alt = readImageAlt(format)
  if (alt.decorative) return '장식 이미지'
  return alt.text.trim() !== '' ? '대체 텍스트 ✓' : '대체 텍스트'
}

/** 컨테이너의 blockId — 노드 뷰는 내용 노드만 받으므로 위로 올라간다(`button-view.ts` 와 같다). */
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

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  el.className = className
  if (text !== undefined) el.textContent = text
  return el
}

export function imageNodeView(
  node: PmNode,
  view: EditorView,
  getPos: () => number | undefined,
  deps: ImageViewDeps,
): NodeView {
  const dom = element('figure', 'blk blk-image')
  // 캐럿이 안으로 들어가면 사용자는 여기에 타이핑하려 한다. 저장될 곳이 없다.
  dom.contentEditable = 'false'

  /** 상호작용 요소를 담는 곳. ProseMirror 에게 넘기지 않을 이벤트의 기준이다. */
  const controls = element('div', 'blk-image-controls')

  let current = node
  /** 업로드 중에는 문서에 아직 아무것도 없다 — 뷰 안에서만 사는 상태다. */
  let uploading = false
  let failure = ''

  // ── 문서에 쓰기 ─────────────────────────────────────────────────────

  /**
   * 이미지 주소를 문서에 쓴다 — 썼으면 true. 쓰지 못했으면(읽기 전용 · 블록이 사라졌다) 부르는 쪽이 그렇다고 그린다 — 쓰지 않으면
   * 트랜잭션이 없어 `update` 가 다시 그리지 않으므로 "올리는 중"이 그대로 남았다(8a-2 리뷰).
   */
  const setSource = (source: ImageSource | null): boolean => {
    // 읽기 전용이면 쓰지 않는다 — 서버가 거부하고 편집기가 본문을 버린다(8a-2 가 찾은 옛 구멍 · `node-views.ts` to_do 와 같다).
    if (!view.editable) return false
    const pos = getPos()
    if (pos === undefined) return false
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== IMAGE_TYPE) return false
    const props = withImageSource(node.attrs.props as Record<string, unknown>, source)
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, props }))
    return true
  }

  /** 넣지 못했다고 그린다. */
  const notWritten = (): void => {
    failure = view.editable ? '이미지를 넣지 못했습니다 — 블록이 바뀌었습니다.' : '읽기 전용이라 이미지를 넣지 못했습니다.'
    render()
  }

  // ── 업로드 ──────────────────────────────────────────────────────────

  const picker = document.createElement('input')
  picker.type = 'file'
  picker.accept = ALLOWED_IMAGE_MIME.join(',')
  picker.className = 'blk-image-file'
  picker.hidden = true

  const progress = element('progress', 'blk-image-progress')
  progress.max = 1
  progress.value = 0

  const startUpload = async (file: File): Promise<void> => {
    uploading = true
    failure = ''
    render()

    const result = await deps.uploadImage(file, (fraction) => {
      // 렌더를 다시 돌리지 않는다 — 진행률 막대 하나만 움직인다.
      progress.value = fraction
      progress.textContent = `${Math.round(fraction * 100)}%`
    })

    uploading = false
    if (result.ok) {
      // 썼으면 트랜잭션이 `update` 를 불러 다시 그린다. 못 썼으면 여기서 그린다.
      if (!setSource({ kind: 'file', fileId: result.fileId })) notWritten()
      return
    }
    failure = result.message
    render()
  }

  picker.addEventListener('change', () => {
    const file = picker.files?.[0]
    // 같은 파일을 다시 고를 수 있게 값을 비운다 — 비우지 않으면 change 가 안 난다.
    picker.value = ''
    if (file) void startUpload(file)
  })

  /**
   * 끌어다 놓거나 붙여넣어서 **이미 파일이 정해진 채로** 만들어진 블록인가.
   *
   * 그 경로(`image-drop.ts`)는 빈 블록을 먼저 넣고 파일은 큐에 둔다. 진행률 UI 가
   * 여기 있으므로 올리는 일도 여기서 한다 — 두 벌의 업로드 상태를 만들지 않는다.
   */
  const queued = (): File | null => {
    const pos = getPos()
    if (pos === undefined) return null
    const info = containerAt(view.state.doc.resolve(pos))
    return info === null ? null : takeQueuedUpload(view, info.id)
  }

  // ── 그리기 ──────────────────────────────────────────────────────────

  const renderEmpty = (): void => {
    const pick = element('button', 'blk-image-pick', '이미지 추가')
    pick.type = 'button'
    pick.addEventListener('click', () => {
      // 읽기 전용이면 올리지 않는다 — 올려도 쓸 수 없다.
      if (view.editable) picker.click()
    })

    const form = element('form', 'blk-image-url')
    const input = element('input', 'blk-image-url-input')
    input.type = 'url'
    input.placeholder = '이미지 주소 붙여넣기'
    input.setAttribute('aria-label', '이미지 주소')
    const add = element('button', 'blk-image-url-add', '추가')
    add.type = 'submit'

    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const url = input.value.trim()
      if (!isSafeImageUrl(url)) {
        // 저장 경로에서도 거부되는 값이다(`validateDoc`). 여기서 먼저 말해 준다.
        failure = 'http 또는 https 로 시작하는 주소만 넣을 수 있습니다.'
        render()
        return
      }
      if (!setSource({ kind: 'external', url })) notWritten()
    })

    form.append(input, add)
    controls.append(pick, form)
  }

  /**
   * 폭 손잡이(10n-64 · 정본 §3.4 [보강 10n-63] ④) — 슬라이더다(`role="slider"` · 지금 폭의 % · ←→ 5%씩 · Home · End). 끄는 동안은 CSS 변수로만
   * 미리 보이고(문서를 고치지 않는다 — 끄는 걸음마다 Y.Doc 에 쓰면 되돌리기 · 협업이 걸음 수만큼 늘어난다) 놓을 때 한 번 쓴다
   * (`setImageLayoutCommand` — 정렬은 그대로). 두 번 누르면 원래 크기(폭을 지운다).
   */
  const resizeHandle = (side: ImageHandleSide, frame: HTMLElement): HTMLElement => {
    const handle = element('span', 'blk-image-handle')
    handle.dataset.side = side
    handle.setAttribute('data-testid', `image-resize-${side}`)
    handle.setAttribute('role', 'slider')
    handle.setAttribute('aria-label', side === 'left' ? '그림 폭(왼쪽 손잡이)' : '그림 폭')
    handle.setAttribute('aria-valuemin', '10')
    handle.setAttribute('aria-valuemax', '100')
    handle.tabIndex = 0
    const ratioNow = (): number => {
      const column = dom.getBoundingClientRect().width
      return column > 0 ? Math.min(1, frame.getBoundingClientRect().width / column) : 1
    }
    const syncValue = (): void => handle.setAttribute('aria-valuenow', String(Math.round(ratioNow() * 100)))
    // 그림이 다 불러와지면 원래 크기의 폭을 안다
    queueMicrotask(syncValue)
    frame.querySelector('img')?.addEventListener('load', syncValue)
    const commit = (width: number | null): void => {
      const id = containerIdAt(view, getPos)
      if (id === '' || !view.editable) return
      // 같은 값이면 명령이 거절한다 — 미리보기를 지우려 그 자리에서 다시 그린다
      const refocus = document.activeElement === handle
      if (!setImageLayoutCommand(id, { width })(view.state, view.dispatch.bind(view))) render()
      // 다시 그리며 손잡이가 새로 섰다 — 키로 바꾸던 손잡이면 같은 쪽에 포커스를 돌려준다
      if (refocus) dom.querySelector<HTMLElement>(`.blk-image-handle[data-side="${side}"]`)?.focus()
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
      dom.style.setProperty('--blk-image-width', `${drag.width * 100}%`)
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

  const renderImage = (source: ImageSource, caption: string, alt: string): void => {
    const url = imageDisplayUrl(deps.workspaceId, source)
    if (url === null) return

    // 틀(10n-64) — 폭 · 정렬은 틀에 걸리고 그림은 틀을 채운다. 손잡이가 그림의 양쪽 가장자리에 붙는다
    const frame = element('span', 'blk-image-frame')
    const img = document.createElement('img')
    img.src = url
    // 대체 텍스트(10d-1a · F-12-13) — 장식이면 빈 말 · 있으면 그것 · 없으면 캡션(`imageAltText` — 공개 화면 · 내보내기와 같은 함수).
    img.alt = alt
    img.addEventListener('error', () => {
      // 정본 엣지 케이스: *"깨진 이미지 대신 '불러올 수 없음' + 원본 링크."* 손잡이도 함께 걷는다(틀째)
      frame.remove()
      const box = element('div', 'blk-image-error', '이미지를 불러올 수 없습니다. ')
      const link = element('a', 'blk-image-origin', '원본 열기')
      link.href = url
      link.target = '_blank'
      link.rel = 'noreferrer noopener'
      box.append(link)
      dom.prepend(box)
    })
    frame.append(img)
    // 손잡이는 늘 단다 — 읽기 전용 편집기에서는 CSS 가 숨기고 눌러도 쓰지 않는다(편집할 수 있게 바뀌어도 다시 그리지 않는다)
    for (const side of ['left', 'right'] as const) frame.append(resizeHandle(side, frame))
    dom.prepend(frame)

    if (caption !== '') {
      const figcaption = element('figcaption', 'blk-image-caption', caption)
      dom.append(figcaption)
    }
  }

  const render = (): void => {
    dom.replaceChildren()
    controls.replaceChildren()

    const props = current.attrs.props as Record<string, unknown>
    const source = readImageSource(props)

    // 폭 · 정렬(10n-63 · 정본 §3.4 [보강 10n-63]) — 그림이 있을 때만 뜻이 있다. CSS 가 그림 · 캡션에 건다(`editor.css`)
    const layout = readImageLayout(current.attrs.format)
    if (source !== null && layout.width !== null) {
      dom.dataset.width = String(layout.width)
      dom.style.setProperty('--blk-image-width', `${layout.width * 100}%`)
    } else {
      delete dom.dataset.width
      dom.style.removeProperty('--blk-image-width')
    }
    if (source !== null && layout.align !== 'left') dom.dataset.align = layout.align
    else delete dom.dataset.align

    if (uploading) {
      dom.dataset.state = 'uploading'
      controls.append(element('span', 'blk-image-status', '올리는 중'), progress)
    } else if (source !== null) {
      dom.dataset.state = 'ready'
      renderImage(source, readCaption(props), imageAltText(current.attrs.format, props))
      // 대체 텍스트(10d-1b) — 편집할 수 있을 때만 쓴다(읽기 전용 편집기에서는 CSS 가 숨기고, 눌러도 열지 않는다)
      const altButton = element('button', 'blk-image-alt', altButtonLabel(current.attrs.format))
      altButton.type = 'button'
      altButton.setAttribute('data-testid', 'image-alt-open')
      altButton.addEventListener('click', () => {
        if (!view.editable) return
        const id = containerIdAt(view, getPos)
        if (id !== '') deps.openImageAlt(id)
      })
      controls.append(altButton)
      // 캡션(10n-62) — 편집기 밖의 입력칸으로 고친다(원자 노드 안에 편집 영역을 두지 않는다 · 캐럿 · 선택이 두 개가 된다). 트리거 표시
      // (`data-code-ui`)는 코드 블록의 오버레이와 같은 것 — 열린 입력칸의 바깥 누르기가 이 단추를 건너뛰고 이 단추의 click 이 닫는다.
      const captionButton = element('button', 'blk-image-caption-open', readCaption(props) === '' ? '캡션 추가' : '캡션 고치기')
      captionButton.type = 'button'
      captionButton.setAttribute('data-testid', 'image-caption-open')
      captionButton.setAttribute('data-code-ui', 'image_caption')
      // 누르는 동안 편집기의 선택을 옮기지 않는다(코드 블록의 크롬 단추와 같다)
      captionButton.addEventListener('mousedown', (event) => event.preventDefault())
      captionButton.addEventListener('click', () => {
        if (!view.editable) return
        const id = containerIdAt(view, getPos)
        if (id !== '') deps.openImageCaption(id)
      })
      controls.append(captionButton)
      // 정렬(10n-63) — 단추 셋 · 고른 것이 눌려 있다 · 편집할 수 있을 때만 쓴다(읽기 전용 편집기에서는 CSS 가 숨긴다)
      const alignGroup = element('span', 'blk-image-align')
      alignGroup.setAttribute('role', 'group')
      alignGroup.setAttribute('aria-label', '그림 정렬')
      for (const align of IMAGE_ALIGNS) {
        const button = element('button', 'blk-image-align-button', ALIGN_LABEL[align])
        button.type = 'button'
        button.setAttribute('data-testid', `image-align-${align}`)
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
      // `role="alert"` — 업로드 실패는 스크린리더에도 알려야 한다.
      const box = element('div', 'blk-image-failure', failure)
      box.setAttribute('role', 'alert')
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
      if (updated.type.name !== IMAGE_TYPE) return false
      current = updated
      // 업로드가 끝나 출처가 생겼으면 실패 메시지는 낡은 것이다.
      if (readImageSource(updated.attrs.props) !== null) failure = ''
      render()
      return true
    },

    // 버튼·입력칸의 이벤트는 우리 것이다. 이미지 자체의 클릭은 넘겨서
    // 블록 선택이 되게 둔다.
    stopEvent: (event) => {
      const target = event.target
      // 아래 단추 줄 · 폭 손잡이(10n-64 — 키 · 끌기를 편집기가 선택 옮기기로 받지 않게)
      return target instanceof Node && (controls.contains(target) || (target instanceof Element && target.closest('.blk-image-handle') !== null))
    },

    // 이 안의 DOM 변화는 전부 우리가 만든 것이다. `contentDOM` 이 없는 동안은
    // 기본값도 같은 일을 하지만, 캡션 편집이 붙는 날을 위해 명시해 둔다(머리말).
    ignoreMutation: () => true,
  }
}
