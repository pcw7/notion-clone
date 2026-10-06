/**
 * 표의 손잡이 — 행 · 열 넣기 · 지우기 · 끝에 더하기 (Phase 2 1d-2 · F-01-18 · 화면)
 *
 * ⚠ `'use client'` 를 달지 않는다 — `block-gutter.tsx` 와 같은 이유(이미 클라이언트 그래프 안이고, 함수 props 는 경계를 넘지 못한다).
 *
 * 정본: 01-block-editor.md F-01-18 *"행/열 핸들(첫 셀 hover 시 나타나는 6점 아이콘) → 위/아래/좌/우로 행·열 추가, 삭제"* ·
 * *"권한 없음 → 행/열 핸들 · 셀 메뉴 · 모서리 드래그 미노출"*.
 *
 * 무엇을 할지는 `lib/editor/table.ts`(`editTableCommand`) · `block-menu.ts`(`tableAxisMenuItems`)가 정한다. 여기서는 포인터가 있는 셀을
 * 찾아 손잡이를 놓고 메뉴를 그린다.
 *
 *   · 셀 위에 포인터가 오면 그 행의 왼쪽 끝(셀 안쪽 여백 — 블록 핸들과 겹치지 않게)에 행 손잡이, 그 열의 위 경계에 열 손잡이, 표의
 *     아래 · 오른쪽에 "+" 막대가 선다. 손잡이로 가는 동안(표 둘레 16px)은 그대로 둔다
 *   · 손잡이를 누르면 메뉴 — 위 · 아래(왼쪽 · 오른쪽)에 넣기 · 지우기. 키보드는 블록 메뉴와 같은 규칙(`navigateMenu`)
 *   · 손잡이는 탭 순서 밖이다(블록 핸들과 같다) — 키보드 길은 블록 메뉴의 '표'(F-12-13)
 *   · 읽기 전용이면 아무것도 그리지 않는다
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import type { EditorView } from '@tiptap/pm/view'

import { firstEnabled, navigateMenu, tableAxisMenuItems, type MenuCursor, type MenuItem } from '@/lib/editor/block-menu'
import type { CommandDeps } from '@/lib/editor/commands'
import { editTableCommand, tableShape } from '@/lib/editor/table'

/** 손잡이로 가는 동안 손잡이를 지키는 표 둘레(px). */
const KEEP_MARGIN_PX = 16

/** 포인터가 있는 셀 — 좌표는 프레임 기준. */
type Hover = {
  blockId: string
  row: number
  column: number
  rowTop: number
  rowHeight: number
  columnLeft: number
  columnWidth: number
  table: { left: number; top: number; right: number; bottom: number }
  /** 표의 크기 — 끝에 더할 자리. 포인터가 움직일 때 잰다(렌더 중에 편집기를 읽지 않는다). */
  rows: number
  columns: number
}

type OpenMenu = { blockId: string; axis: 'row' | 'column'; index: number; top: number; left: number; items: MenuItem[] }

export function TableControls({
  viewRef,
  frameRef,
  deps,
}: {
  viewRef: RefObject<EditorView | null>
  frameRef: RefObject<HTMLDivElement | null>
  deps: CommandDeps
}) {
  const [hover, setHoverState] = useState<Hover | null>(null)
  const [menu, setMenuState] = useState<OpenMenu | null>(null)
  const hoverRef = useRef<Hover | null>(null)
  const menuRef = useRef<OpenMenu | null>(null)
  // 상태와 ref 를 함께 — 포인터 핸들러는 ref 를, 렌더는 상태를 읽는다(`block-gutter.tsx` 의 `show` 와 같다).
  const setHover = useCallback((next: Hover | null): void => {
    hoverRef.current = next
    setHoverState(next)
  }, [])
  const setMenu = useCallback((next: OpenMenu | null): void => {
    menuRef.current = next
    setMenuState(next)
  }, [])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const onMove = (event: MouseEvent): void => {
      if (menuRef.current) return
      const view = viewRef.current
      if (!view || !view.editable) {
        if (hoverRef.current) setHover(null)
        return
      }
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.blk-table-control')) return
      const cell = target?.closest<HTMLElement>('.blk-editor .blk-table td') ?? null
      const box = frame.getBoundingClientRect()
      if (cell === null) {
        // 손잡이로 가는 길 — 표 둘레에서는 지킨다.
        const current = hoverRef.current
        if (!current) return
        const x = event.clientX - box.left
        const y = event.clientY - box.top
        const t = current.table
        const near = x >= t.left - KEEP_MARGIN_PX && x <= t.right + KEEP_MARGIN_PX && y >= t.top - KEEP_MARGIN_PX && y <= t.bottom + KEEP_MARGIN_PX
        if (!near) setHover(null)
        return
      }
      const row = cell.parentElement
      const table = cell.closest('table')
      const container = cell.closest<HTMLElement>('[data-block-id]')
      if (!row || !table || !container || !view.dom.contains(container)) return
      const rows = [...(row.parentElement?.children ?? [])]
      const blockId = container.getAttribute('data-block-id') ?? ''
      const shape = tableShape(view.state.doc, blockId)
      if (shape === null) return
      const cellRect = cell.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      const tableRect = table.getBoundingClientRect()
      const next: Hover = {
        blockId,
        row: rows.indexOf(row),
        column: [...row.children].indexOf(cell),
        rowTop: rowRect.top - box.top,
        rowHeight: rowRect.height,
        columnLeft: cellRect.left - box.left,
        columnWidth: cellRect.width,
        table: { left: tableRect.left - box.left, top: tableRect.top - box.top, right: tableRect.right - box.left, bottom: tableRect.bottom - box.top },
        rows: shape.rows,
        columns: shape.columns,
      }
      const cur = hoverRef.current
      if (
        cur && cur.blockId === next.blockId && cur.row === next.row && cur.column === next.column && cur.rowTop === next.rowTop &&
        cur.table.right === next.table.right && cur.table.bottom === next.table.bottom && cur.rows === next.rows && cur.columns === next.columns
      ) return
      setHover(next)
    }
    const onLeave = (): void => {
      if (!menuRef.current) setHover(null)
    }
    frame.addEventListener('mousemove', onMove)
    frame.addEventListener('mouseleave', onLeave)
    return () => {
      frame.removeEventListener('mousemove', onMove)
      frame.removeEventListener('mouseleave', onLeave)
    }
  }, [frameRef, viewRef, setHover])

  const run = useCallback(
    (blockId: string, change: Parameters<typeof editTableCommand>[1]): void => {
      const view = viewRef.current
      if (!view) return
      editTableCommand(blockId, change, deps.newId)(view.state, view.dispatch.bind(view))
      setHover(null)
      view.focus()
    },
    [viewRef, deps, setHover],
  )

  const openMenu = (axis: 'row' | 'column'): void => {
    const view = viewRef.current
    const h = hoverRef.current
    if (!view || !h) return
    const index = axis === 'row' ? h.row : h.column
    const items = tableAxisMenuItems(view.state, h.blockId, axis, index)
    if (items.length === 0) return
    setMenu(
      axis === 'row'
        ? { blockId: h.blockId, axis, index, top: h.rowTop, left: h.table.left + 14, items }
        : { blockId: h.blockId, axis, index, top: h.table.top + 10, left: h.columnLeft + h.columnWidth / 2, items },
    )
  }

  const closeMenu = useCallback(
    (restoreFocus: boolean): void => {
      setMenu(null)
      setHover(null)
      if (restoreFocus) viewRef.current?.focus()
    },
    [viewRef, setMenu, setHover],
  )

  if (!hover && !menu) return null

  return (
    <>
      {hover && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="행 메뉴"
            data-axis="row"
            className="blk-table-control blk-table-handle"
            style={{ top: hover.rowTop + hover.rowHeight / 2 - 10, left: hover.table.left + 1 }}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => openMenu('row')}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="열 메뉴"
            data-axis="column"
            className="blk-table-control blk-table-handle"
            style={{ top: hover.table.top - 4, left: hover.columnLeft + hover.columnWidth / 2 - 10 }}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => openMenu('column')}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="행 더하기"
            data-edge="bottom"
            className="blk-table-control blk-table-add"
            style={{ top: hover.table.bottom + 1, left: hover.table.left, width: hover.table.right - hover.table.left }}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => run(hover.blockId, { kind: 'add_row', at: hover.rows })}
          >
            +
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="열 더하기"
            data-edge="right"
            className="blk-table-control blk-table-add"
            style={{ top: hover.table.top, left: hover.table.right + 1, height: hover.table.bottom - hover.table.top }}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => run(hover.blockId, { kind: 'add_column', at: hover.columns })}
          >
            +
          </button>
        </>
      )}
      {menu && <TableAxisMenu menu={menu} onRun={(item) => item.action?.kind === 'table_edit' && run(item.action.blockId, item.action.change)} onClose={closeMenu} />}
    </>
  )
}

/** 손잡이의 메뉴 — 평평한 목록. 포커스 · 키 규칙은 블록 메뉴와 같다(`block-menu.tsx` 머리말). */
function TableAxisMenu({ menu, onRun, onClose }: { menu: OpenMenu; onRun: (item: MenuItem) => void; onClose: (restoreFocus: boolean) => void }) {
  const [cursor, setCursor] = useState<MenuCursor>(() => ({ index: firstEnabled(menu.items), sub: null }))
  const rootRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    const id = menu.items[cursor.index]?.id
    if (id) itemRefs.current.get(id)?.focus()
  }, [cursor, menu.items])

  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [onClose])

  const activate = (item: MenuItem): void => {
    if (!item.enabled) return
    onRun(item)
    onClose(true)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const nav = navigateMenu(menu.items, cursor, event.key)
    if (nav.kind === 'none') return
    event.preventDefault()
    event.stopPropagation()
    if (nav.kind === 'move') setCursor(nav.cursor)
    else if (nav.kind === 'activate') activate(nav.item)
    else onClose(true)
  }

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label={menu.axis === 'row' ? '행 메뉴' : '열 메뉴'}
      className="blk-menu blk-table-control"
      style={{ top: menu.top, left: menu.left }}
      onKeyDown={onKeyDown}
    >
      {menu.items.map((item, i) => (
        <button
          key={item.id}
          ref={(el) => {
            if (el) itemRefs.current.set(item.id, el)
            else itemRefs.current.delete(item.id)
          }}
          type="button"
          role="menuitem"
          aria-disabled={!item.enabled}
          tabIndex={cursor.index === i ? 0 : -1}
          className="blk-menu-item"
          onMouseEnter={() => item.enabled && setCursor({ index: i, sub: null })}
          onClick={() => activate(item)}
        >
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}
