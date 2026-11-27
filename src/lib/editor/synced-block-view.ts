/**
 * 동기화 블록의 노드 뷰 — 머리 줄 · 사본의 자리 (SB-1 · SB-2 · F-01-11 · 정본 [보강 SB-0] ⑦ ⑧ ⑪ⓐⓑ ⑫ⓒ · ㉑)
 *
 * ⚠ 이 파일은 브라우저에서만 로드된다(`document` 를 쓴다).
 *
 *   div.blk.blk-synced_block[data-block-type=synced_block][data-synced=original|copy]   (contenteditable=false)
 *     span.blk-synced-badge     ← 동기화 그림 + `원본`(사본이면 `사본`)
 *     button.blk-synced-copy-button ← "복사"(원본 — 이 원본의 사본 하나를 클립보드에 · ⑪ⓑ 시나리오 2)
 *     button.blk-synced-unsync  ← "동기화 해제"(원본 · 고칠 수 있을 때)
 *     div.blk-synced-copy[data-copy-state]  ← 사본만 — 원본 페이지의 내용(중첩 편집기) 또는 자리(불러오는 중 · 권한 없음 · 휴지통 · 삭제됨)
 *
 *   · 틀(테두리)은 **컨테이너**에 그린다 — 원본의 내용(= 자식 그룹)이 틀 안에 선다(`editor.css` · AI 블록 · 콜아웃과 같은 짜임)
 *   · 사본의 내용은 **화면에 들 때** 지연 로드한 구현이 그린다(`synced-copy-view-impl.ts` — 사본이 없는 페이지의 첫 번들에 싣지 않는다)
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'
import type * as Y from 'yjs'

import { isSyncedCopyProps, SYNCED_BLOCK_TYPE, syncedFromOf } from '../block/synced-block.ts'
import type { CollabConnection, CollabSnapshot } from '../collab/collab-connection.ts'
import { BLOCKS_MIME, syncedCopyClipboard } from './block-clipboard.ts'
import { BlockSelection, deleteBlockSelectionCommand } from './block-selection.ts'
import type { createNodeViews, NodeViewDeps } from './node-views.ts'
import { unsyncSyncedBlockCommand } from './synced-block.ts'
import type { createCopyEditorState, watchSyncedGroup } from './synced-copy-binding.ts'

/**
 * 사본의 묶기 — 협업 편집기가 준다(`synced-copy-binding.ts` · 편집기 클래스). 번들을 재 보고 정했다(SB-2):
 *   · 지연 청크가 ProseMirror · Yjs · y-prosemirror 를 값으로 가져오면 번들러가 그 공유 모듈로 첫 번들의 청크를 다시 갈라 처음 받는 JS 가
 *     4KB 가까이 늘었다(가져오지 않으면 내 코드만큼만 는다)
 *   · 이 노드 뷰가 정적으로 가져오면 노드 뷰만 쓰는 화면(데이터베이스 · 행 미리보기)의 첫 번들에 y-prosemirror 가 끌려 들었다(+40KB)
 * 협업 편집기는 이미 그것들을 가졌다.
 */
export type CopyBinding = {
  readonly createCopyEditorState: typeof createCopyEditorState
  readonly watchSyncedGroup: typeof watchSyncedGroup
  readonly EditorView: typeof EditorView
}

/** 사본이 묻는 지금의 맥락 — 편집기가 준다(SB-2). */
export type SyncedCopyHost = {
  readonly workspaceId: string
  /** 이 편집기의 페이지 — 같은 페이지의 사본은 새 연결 없이 이 문서에 묶는다(⑧). */
  readonly pageId: string
  /** 협업 서버 주소 — 다른 페이지의 원본에 embed 연결로 붙는다. */
  readonly collabUrl: string
  /** 이 편집기가 묶인 Y.Doc — 없으면(아직 · 미리보기) null. */
  readonly doc: Y.Doc | null
  /** 이 페이지를 지금 고칠 수 있는가 — "사본 지우기"(원본이 삭제되었다)를 보일까. */
  readonly editable: boolean
  /**
   * 원본 페이지에 embed 연결을 연다(`openCollabConnection({ embed: true })` — presence · 보존본 · 보내기가 없다). 편집기가 준다 — 지연 로드한
   * 구현이 연결 모듈을 직접 가져오지 않게(첫 번들의 청크가 갈리지 않게).
   */
  openEmbed(pageId: string, onChange: (snapshot: CollabSnapshot) => void): Promise<CollabConnection>
  /** 사본의 묶기 — 협업 편집기가 가진 것(`CopyBinding` 머리말). */
  readonly binding: CopyBinding
}

/** 사본의 중첩 편집기가 쓰는 노드 뷰 — 바깥 편집기와 같은 것(`node-views.ts` 가 준다). */
export type CopyNodeViews = ReturnType<typeof createNodeViews>

export type SyncedBlockViewDeps = {
  /** 지금의 맥락 — 없으면(읽기 전용 미리보기 · 검사) 사본은 내용 없이 자리만 그린다. */
  readonly syncedCopyHost?: () => SyncedCopyHost | null
}

/** 지연 로드한 사본의 내용 — 화면에 들고 나갈 때 알린다. */
export type MountedSyncedCopy = {
  setVisible(visible: boolean): void
  stopEvent(event: Event): boolean
  destroy(): void
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 컨테이너의 blockId — 노드 뷰는 내용 노드만 받으므로 위로 올라간다. */
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

/** 동기화 그림(두 화살표가 도는 고리) — 단순한 도형이다. */
function syncGlyph(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', 'blk-synced-glyph')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', 'M13 5.5A5.5 5.5 0 0 0 3.2 4.2M3 2v2.5h2.5M3 10.5a5.5 5.5 0 0 0 9.8 1.3M13 14v-2.5h-2.5')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.5')
  path.setAttribute('stroke-linecap', 'round')
  svg.append(path)
  return svg
}

/**
 * 원본의 "복사" — 사본 하나를 클립보드에 싣는다(⑪ⓑ). 우리 형식(`BLOCKS_MIME`)은 복사 사건에서만 실을 수 있어 그 사건을 일으킨다 — 문서의
 * 포획 단계에서 받아 편집기의 복사 처리(블록 선택)에 닿지 않게 한다.
 */
function copyOriginalToClipboard(originalId: string, deps: NodeViewDeps): boolean {
  const host = deps.syncedCopyHost?.() ?? null
  const json = syncedCopyClipboard(originalId, host === null ? null : { workspaceId: host.workspaceId, pageId: host.pageId })
  let wrote = false
  const onCopy = (event: ClipboardEvent): void => {
    if (event.clipboardData === null) return
    event.preventDefault()
    event.stopImmediatePropagation()
    event.clipboardData.setData(BLOCKS_MIME, json)
    event.clipboardData.setData('text/plain', '')
    wrote = true
  }
  document.addEventListener('copy', onCopy, { capture: true })
  try {
    document.execCommand('copy')
  } finally {
    document.removeEventListener('copy', onCopy, { capture: true })
  }
  return wrote
}

/** "사본 지우기" — 이 사본의 블록을 블록 선택으로 지운다(지우기 명령의 규칙 그대로 · 되돌릴 수 있다). */
function removeBlockAt(view: EditorView, getPos: () => number | undefined, deps: NodeViewDeps): void {
  const pos = getPos()
  if (pos === undefined || !view.editable) return
  const $pos = view.state.doc.resolve(pos)
  view.dispatch(view.state.tr.setSelection(BlockSelection.create(view.state.doc, $pos.before($pos.depth))))
  deleteBlockSelectionCommand(deps)(view.state, view.dispatch.bind(view))
}

/**
 * @param nestedNodeViews 사본의 중첩 편집기가 쓸 노드 뷰 — `node-views.ts` 가 준다(지연 로드한 구현이 그 모듈을 가져오지 않게).
 */
export function syncedBlockNodeView(
  node: PmNode,
  view: EditorView,
  getPos: () => number | undefined,
  deps: NodeViewDeps,
  nestedNodeViews: () => CopyNodeViews,
): NodeView {
  const dom = document.createElement('div')
  dom.className = `blk blk-${SYNCED_BLOCK_TYPE}`
  dom.dataset.blockType = SYNCED_BLOCK_TYPE
  dom.contentEditable = 'false'

  const badge = document.createElement('span')
  badge.className = 'blk-synced-badge'
  const label = document.createElement('span')
  badge.append(syncGlyph(), label)

  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.className = 'blk-synced-copy-button'
  copyButton.textContent = '복사'
  copyButton.title = '이 원본의 사본을 복사합니다 — 다른 곳에 붙여넣으면 같은 내용이 동기화됩니다'
  copyButton.addEventListener('mousedown', (event) => event.preventDefault())
  copyButton.addEventListener('click', () => {
    const id = containerIdAt(view, getPos)
    if (id === '') return
    const done = copyOriginalToClipboard(id, deps)
    copyButton.textContent = done ? '복사됨' : '복사 실패'
    setTimeout(() => (copyButton.textContent = '복사'), 1500)
  })

  const unsync = document.createElement('button')
  unsync.type = 'button'
  unsync.className = 'blk-synced-unsync'
  unsync.textContent = '동기화 해제'
  unsync.addEventListener('mousedown', (event) => event.preventDefault())
  unsync.addEventListener('click', () => {
    // 읽기 전용이면 하지 않는다 — 노드 뷰는 편집 가능 여부가 바뀌어도 다시 만들어지지 않으므로 누르는 순간에 묻는다
    if (!view.editable) return
    const id = containerIdAt(view, getPos)
    if (id !== '') unsyncSyncedBlockCommand(id)(view.state, view.dispatch.bind(view))
  })

  const copy = isSyncedCopyProps(node.attrs.props)
  dom.dataset.synced = copy ? 'copy' : 'original'
  label.textContent = copy ? '사본' : '원본'
  badge.title = copy ? '동기화 블록의 사본 — 원본 페이지의 내용을 보여 줍니다' : '동기화 블록의 원본 — 여기서 고친 내용이 사본에도 보입니다'
  copyButton.hidden = copy
  unsync.hidden = copy
  dom.append(badge, copyButton, unsync)

  // ── 사본의 자리(SB-2) — 화면에 들 때 구현을 불러 원본의 내용을 그린다 ──
  let mounted: MountedSyncedCopy | null = null
  let observer: IntersectionObserver | null = null
  let gone = false
  if (copy) {
    const body = document.createElement('div')
    body.className = 'blk-synced-copy'
    body.dataset.copyState = 'loading'
    const place = document.createElement('div')
    place.className = 'blk-synced-place'
    place.textContent = '동기화된 내용을 불러오는 중…'
    body.append(place)
    dom.append(body)
    const originalId = syncedFromOf(node.attrs.props, containerIdAt(view, getPos))
    let visible = false
    let loading = false
    const load = (): void => {
      if (loading) return
      loading = true
      void import('./synced-copy-view-impl.ts').then((impl) => {
        if (gone) return
        mounted = impl.mountSyncedCopy(body, {
          originalId,
          outer: view,
          host: deps.syncedCopyHost?.() ?? null,
          nodeViews: nestedNodeViews,
          removeCopy: () => removeBlockAt(view, getPos, deps),
        })
        mounted.setVisible(visible)
      })
    }
    const onVisible = (now: boolean): void => {
      visible = now
      if (now) load()
      mounted?.setVisible(now)
    }
    if (typeof IntersectionObserver === 'undefined') onVisible(true)
    else {
      observer = new IntersectionObserver((records) => onVisible(records.some((r) => r.isIntersecting)), { rootMargin: '200px 0px' })
      observer.observe(dom)
    }
  }

  return {
    dom,
    update: (updated) => {
      if (updated.type.name !== SYNCED_BLOCK_TYPE) return false
      // 원본 ↔ 사본 · 가리키는 원본이 바뀌면 다시 만든다(사본의 연결 · 묶기가 그 원본에 매였다)
      if (isSyncedCopyProps(updated.attrs.props) !== copy) return false
      if (copy && (updated.attrs.props as Record<string, unknown>)?.synced_from !== (node.attrs.props as Record<string, unknown>)?.synced_from) return false
      return true
    },
    // 단추 누르기 · 사본의 내용(읽기 전용 중첩 편집기의 글 고르기)은 바깥 편집기가 아니라 우리가 받는다
    stopEvent: (event) =>
      (event.target instanceof Node && (unsync.contains(event.target) || copyButton.contains(event.target))) || (mounted?.stopEvent(event) ?? false),
    ignoreMutation: () => true,
    destroy: () => {
      gone = true
      observer?.disconnect()
      mounted?.destroy()
    },
  }
}
