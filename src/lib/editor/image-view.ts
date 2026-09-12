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
  IMAGE_TYPE,
  imageDisplayUrl,
  isSafeImageUrl,
  readCaption,
  readImageSource,
  withImageSource,
  type ImageSource,
} from '../block/image.ts'
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

  const setSource = (source: ImageSource | null): void => {
    const pos = getPos()
    if (pos === undefined) return
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== IMAGE_TYPE) return
    const props = withImageSource(node.attrs.props as Record<string, unknown>, source)
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, props }))
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
      setSource({ kind: 'file', fileId: result.fileId })
      // `setSource` 가 트랜잭션을 일으키면 `update` 가 다시 그린다.
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
    pick.addEventListener('click', () => picker.click())

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
      setSource({ kind: 'external', url })
    })

    form.append(input, add)
    controls.append(pick, form)
  }

  const renderImage = (source: ImageSource, caption: string): void => {
    const url = imageDisplayUrl(deps.workspaceId, source)
    if (url === null) return

    const img = document.createElement('img')
    img.src = url
    // 캡션이 곧 대체 텍스트다. 없으면 빈 문자열 — 장식 이미지로 읽힌다(F-12-12).
    img.alt = caption
    img.addEventListener('error', () => {
      // 정본 엣지 케이스: *"깨진 이미지 대신 '불러올 수 없음' + 원본 링크."*
      img.remove()
      const box = element('div', 'blk-image-error', '이미지를 불러올 수 없습니다. ')
      const link = element('a', 'blk-image-origin', '원본 열기')
      link.href = url
      link.target = '_blank'
      link.rel = 'noreferrer noopener'
      box.append(link)
      dom.prepend(box)
    })
    dom.prepend(img)

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

    if (uploading) {
      dom.dataset.state = 'uploading'
      controls.append(element('span', 'blk-image-status', '올리는 중'), progress)
    } else if (source !== null) {
      dom.dataset.state = 'ready'
      renderImage(source, readCaption(props))
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
      return target instanceof Node && controls.contains(target)
    },

    // 이 안의 DOM 변화는 전부 우리가 만든 것이다. `contentDOM` 이 없는 동안은
    // 기본값도 같은 일을 하지만, 캡션 편집이 붙는 날을 위해 명시해 둔다(머리말).
    ignoreMutation: () => true,
  }
}
