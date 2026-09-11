/**
 * 블록 핸들 — `+` · `⋮⋮` · 드래그 가이드 (F-01-08)
 *
 * ⚠ `'use client'` 를 달지 않는다. 이 컴포넌트는 `body-editor.tsx`(클라이언트
 * 경계)만 렌더하므로 이미 클라이언트 그래프 안에 있다 — Next 문서
 * (01-getting-started/05-server-and-client-components.md): *"Once a file is marked
 * with "use client", all of its imports … are included in the client bundle."*
 * 여기에 경계를 또 두면 ref·함수 props 가 "직렬화 가능해야 한다"는 경계 규칙에
 * 걸린다.
 *
 * 여기서 하는 일은 ① 포인터가 어느 줄 위에 있는지 ② 줄들의 좌표 ③ 그리기
 * 뿐이다. **무엇을 할지는 `lib/editor/block-handle.ts` 가 정하고 거기서 DOM 없이
 * 테스트된다.**
 *
 * ──────────────────────────────────────────────────────────────────────
 * 편집기 DOM 을 건드리지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 핸들·가이드는 에디터 DOM 의 **바깥**(형제)에 절대 위치로 그린다. 드래그 중인
 * 블록을 흐리게 하는 것도 블록 DOM 이 아니라 **프레임**에 속성을 단다.
 *
 * ProseMirror 는 편집기 DOM 의 속성 변경을 문서 변경 후보로 등록해 그 범위를 다시
 * 읽고, 그때 DOM selection 으로 선택을 새로 만든다(`block-selection-plugin.ts` 의
 * `keepBlockSelection` 머리말). 블록 DOM 에 `data-dragging` 을 달면 드래그를
 * 시작하는 순간 블록 선택이 풀릴 수 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 좌표는 프레임 기준
 * ──────────────────────────────────────────────────────────────────────
 *
 * 창 전체가 스크롤된다(레이아웃에 스크롤 컨테이너가 없다). 프레임과 블록은 함께
 * 스크롤되므로 **프레임 기준 좌표는 스크롤과 무관하다.** 그래서 줄 좌표를 드래그
 * 시작 때 한 번만 재고, 포인터는 매번 프레임 기준으로 바꾼다 — 프레임 사각형
 * 하나만 읽으면 된다.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { EditorView } from '@tiptap/pm/view'

import {
  dropBlocksCommand,
  dropCandidates,
  dropGuide,
  handleTargets,
  insertBlockBelowCommand,
  resolveDrop,
  selectHandleTargetsCommand,
  type BlockLine,
  type DropHit,
} from '@/lib/editor/block-handle'
import type { CommandDeps } from '@/lib/editor/commands'
import { findContainerById } from '@/lib/editor/pm-blocks'

/** 한 단 들여쓰기 = `.blk-group` 의 margin-left(1.5rem). 둘이 어긋나면 자식 드롭 판정이 틀린다. */
const INDENT_PX = 24
/** 이만큼 움직여야 드래그다. 그 전에 놓으면 클릭(= 블록 선택). */
const DRAG_THRESHOLD_PX = 4
/** `+` 와 `⋮⋮` 두 버튼의 폭 + 내용과의 간격. */
const GUTTER_WIDTH_PX = 46

type Hover = { blockId: string; top: number; left: number }
type Guide = { top: number; left: number }
type Drag = {
  ids: string[]
  startX: number
  startY: number
  moved: boolean
  lines: BlockLine[]
  hit: DropHit | null
}

/**
 * 이 높이의 줄에 있는 **가장 안쪽** 블록.
 *
 * 포인터 x 대신 **에디터 오른쪽 끝**에서 찾는다. 블록 내용 요소는 가로로 꽉 차
 * 있어서(p·h1·li·div 모두 블록 요소) 오른쪽 끝에서 찾으면 그 줄의 가장 안쪽
 * 블록이 잡힌다. 포인터 x 로 찾으면 핸들이 있는 왼쪽 여백에서는 아무것도 없거나,
 * 들여쓴 블록의 줄인데 부모가 잡힌다.
 */
function lineAt(view: EditorView, frame: HTMLElement, clientY: number): Hover | null {
  const editor = view.dom.getBoundingClientRect()
  const el = document.elementFromPoint(editor.right - 2, clientY)
  const container = el?.closest<HTMLElement>('[data-block-id]')
  if (!container || !view.dom.contains(container)) return null
  const blockId = container.getAttribute('data-block-id') ?? ''
  if (blockId === '') return null

  const content = (container.firstElementChild as HTMLElement | null) ?? container
  const rect = content.getBoundingClientRect()
  const box = frame.getBoundingClientRect()
  return { blockId, top: rect.top - box.top, left: rect.left - box.left }
}

/** 드롭 후보 줄들의 좌표를 잰다. 문서 쪽 정보는 `dropCandidates` 가 준다. */
function measureLines(
  view: EditorView,
  frame: HTMLElement,
  draggedIds: readonly string[],
  isCollapsed: (id: string) => boolean,
): BlockLine[] {
  const box = frame.getBoundingClientRect()
  const out: BlockLine[] = []
  for (const info of dropCandidates(view.state.doc, isCollapsed, draggedIds)) {
    const dom = view.nodeDOM(info.pos)
    const content = dom instanceof HTMLElement ? (dom.firstElementChild as HTMLElement | null) : null
    if (!content) continue
    const rect = content.getBoundingClientRect()
    // 접힌 조상 밑이라 화면에 없다. `dropCandidates` 가 이미 거르지만 좌표가 0 인 줄이
    // 섞이면 이진 탐색의 전제(top 오름차순)가 깨진다.
    if (rect.height === 0) continue
    out.push({
      ...info,
      top: rect.top - box.top,
      bottom: rect.bottom - box.top,
      contentLeft: rect.left - box.left,
    })
  }
  return out
}

export function BlockGutter({
  viewRef,
  frameRef,
  deps,
}: {
  viewRef: RefObject<EditorView | null>
  /** 에디터를 감싼 프레임. 좌표의 기준이고, 드래그 중 흐림 표시를 다는 곳이다. */
  frameRef: RefObject<HTMLDivElement | null>
  deps: CommandDeps
}) {
  const [hover, setHover] = useState<Hover | null>(null)
  const [guide, setGuide] = useState<Guide | null>(null)
  // 리스너 안에서 최신 값을 봐야 한다. state 는 리스너가 붙던 순간의 값에 갇힌다.
  const hoverRef = useRef<Hover | null>(null)
  const dragRef = useRef<Drag | null>(null)

  const show = (next: Hover | null): void => {
    hoverRef.current = next
    setHover(next)
  }

  // ── hover ───────────────────────────────────────────────────────────

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const onMove = (event: MouseEvent): void => {
      if (dragRef.current) return
      const view = viewRef.current
      // 정본: "권한 없음 → 핸들 자체를 노출하지 않음".
      if (!view || !view.editable) return
      const next = lineAt(view, frame, event.clientY)
      // 줄 사이 틈 — 직전 줄을 유지한다. 없애면 핸들로 가는 도중에 사라진다.
      if (next === null) return
      const cur = hoverRef.current
      if (cur && cur.blockId === next.blockId && cur.top === next.top && cur.left === next.left) return
      show(next)
    }
    const onLeave = (): void => {
      if (!dragRef.current) show(null)
    }
    // 타이핑하는 동안은 치운다. 글 옆에 떠 있으면 거슬린다 — 노션도 그렇게 한다.
    const onKey = (): void => {
      if (!dragRef.current) show(null)
    }

    frame.addEventListener('mousemove', onMove)
    frame.addEventListener('mouseleave', onLeave)
    frame.addEventListener('keydown', onKey)
    return () => {
      frame.removeEventListener('mousemove', onMove)
      frame.removeEventListener('mouseleave', onLeave)
      frame.removeEventListener('keydown', onKey)
    }
  }, [frameRef, viewRef])

  // ── 드래그 ──────────────────────────────────────────────────────────

  const endDrag = (): Drag | null => {
    const d = dragRef.current
    dragRef.current = null
    setGuide(null)
    frameRef.current?.removeAttribute('data-dragging')
    return d
  }

  // Esc 로 취소. capture 로 받아야 ProseMirror 의 Esc(블록 선택 전환)보다 먼저 본다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !dragRef.current) return
      event.preventDefault()
      event.stopPropagation()
      endDrag()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // endDrag 는 ref 와 setter 만 쓴다 — 렌더마다 새로 붙일 이유가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    const view = viewRef.current
    const current = hoverRef.current
    if (!view || !current) return
    const info = findContainerById(view.state.doc, current.blockId)
    if (!info) return

    // 에디터의 선택·포커스를 흔들지 않는다.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      ids: handleTargets(view.state, info.pos),
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      lines: [],
      hit: null,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = dragRef.current
    const view = viewRef.current
    const frame = frameRef.current
    if (!d || !view || !frame) return

    if (!d.moved) {
      if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) < DRAG_THRESHOLD_PX) return
      d.moved = true
      // 끄는 블록을 블록 선택으로 만든다 — 무엇을 끌고 있는지 하이라이트로 보인다.
      // 흐림은 프레임 속성으로(머리말: 편집기 DOM 을 건드리지 않는다).
      selectHandleTargetsCommand(d.ids)(view.state, view.dispatch.bind(view))
      frame.setAttribute('data-dragging', 'true')
      d.lines = measureLines(view, frame, d.ids, deps.isCollapsed)
    }

    const box = frame.getBoundingClientRect()
    d.hit = resolveDrop(d.lines, event.clientX - box.left, event.clientY - box.top, INDENT_PX)
    setGuide(d.hit ? dropGuide(d.hit, INDENT_PX) : null)
  }

  const onPointerUp = (): void => {
    const d = endDrag()
    const view = viewRef.current
    if (!d || !view) return

    if (!d.moved) {
      // 클릭 — 잡은 것을 블록 선택으로. 다음 단계의 핸들 메뉴가 이 선택에 동작한다.
      selectHandleTargetsCommand(d.ids)(view.state, view.dispatch.bind(view))
    } else if (d.hit) {
      dropBlocksCommand(d.ids, d.hit.target, deps)(view.state, view.dispatch.bind(view))
    }
    view.focus()
  }

  const onAdd = (): void => {
    const view = viewRef.current
    const current = hoverRef.current
    if (!view || !current) return
    insertBlockBelowCommand(current.blockId, deps)(view.state, view.dispatch.bind(view))
    view.focus()
  }

  return (
    <>
      {hover && (
        <div
          className="blk-gutter"
          style={{ top: hover.top, left: hover.left - GUTTER_WIDTH_PX }}
        >
          {/*
            tabIndex -1: 핸들은 hover 로만 나타나는 마우스용 보조 UI 다. 키보드에는
            같은 일을 하는 경로가 따로 있다(Esc 로 선택 → Mod+Shift+↑↓ 로 이동,
            F-12-13 의 WCAG 2.1 SC 2.1.1 대체 경로). 탭 순서에 끼우면 블록마다
            탭 정지가 생긴다.
          */}
          <button
            type="button"
            tabIndex={-1}
            aria-label="아래에 블록 추가"
            className="blk-gutter-button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onAdd}
          >
            +
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="블록 옮기기 — 끌어서 옮기거나 눌러서 선택"
            className="blk-gutter-button blk-gutter-grip"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => endDrag()}
          >
            ⋮⋮
          </button>
        </div>
      )}

      {guide && (
        <div
          aria-hidden
          className="blk-drop-guide"
          style={{ top: guide.top - 1, left: guide.left }}
        />
      )}
    </>
  )
}
