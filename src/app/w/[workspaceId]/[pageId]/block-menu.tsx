/**
 * 블록 메뉴 — 화면 (F-01-08 시나리오 4 · F-12-13)
 *
 * ⚠ `'use client'` 를 달지 않는다 — `block-gutter.tsx` 와 같은 이유(이미 클라이언트
 * 그래프 안이고, 함수 props 는 경계를 넘지 못한다).
 *
 * 어떤 항목이 켜져 있는지, 키 하나가 커서를 어디로 옮기는지는 전부
 * `lib/editor/block-menu.ts` 가 정한다. 여기서 하는 일은 그리기 · 포커스 · 클립보드뿐이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 접근성 (F-12-13)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본: *"포커스 트랩 + `esc` 닫기 + 닫은 뒤 원래 요소로 포커스 복귀."*
 *
 *   - `role="menu"` / `menuitem` / 하위 메뉴는 `menuitemradio` + `aria-checked`
 *   - **roving tabindex** — 커서가 있는 항목만 `tabIndex=0`. 포커스는 늘 한 곳에 있다
 *   - 꺼진 항목은 `disabled` 가 아니라 `aria-disabled` — `disabled` 는 포커스를 받지
 *     못해서 화살표로 지나가다 멈출 곳이 사라진다(그래서 커서 규칙이 건너뛴다)
 *   - 닫히면 **에디터로 포커스를 돌려준다.** 블록 선택은 그대로라 이어서
 *     `Mod+Shift+↑↓` 같은 키를 칠 수 있다. 바깥을 눌러 닫았으면 돌려주지 않는다 —
 *     누른 곳이 포커스를 가져가야 한다
 */

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { EditorView } from '@tiptap/pm/view'

import {
  blockLinkPath,
  blockMenuItems,
  firstEnabled,
  navigateMenu,
  setBlockColorCommand,
  type BlockMenuAction,
  type MenuCursor,
  type MenuItem,
} from '@/lib/editor/block-menu'
import {
  deleteBlockSelectionCommand,
  duplicateBlockSelectionCommand,
  isBlockSelection,
  turnSelectionIntoCommand,
} from '@/lib/editor/block-selection'
import type { CommandDeps } from '@/lib/editor/commands'

/**
 * 클립보드에 쓴다.
 *
 * `navigator.clipboard` 는 **보안 컨텍스트**(https · localhost)에만 있다. 같은 네트워크의
 * 다른 기기에서 `http://192.168.…:3000` 으로 열면 없다 — 그때는 예전 방식
 * (`execCommand('copy')`)으로 한 번 더 시도한다. 둘 다 실패하면 false 를 돌려주고,
 * 부르는 쪽이 링크를 화면에 보여준다(손으로 복사할 수 있게).
 */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 권한 거부 — 아래 방식으로 한 번 더.
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

export type BlockMenuProps = {
  view: EditorView
  deps: CommandDeps
  /** 프레임 기준 좌표. */
  top: number
  left: number
  workspaceId: string
  pageId: string
  /** `restoreFocus`: 에디터로 포커스를 돌려줄 것인가. */
  onClose: (restoreFocus: boolean) => void
  onNotice: (message: string) => void
}

export function BlockMenu({ view, deps, top, left, workspaceId, pageId, onClose, onNotice }: BlockMenuProps) {
  // 여는 순간의 선택으로 계산한다. 메뉴가 열려 있는 동안 문서는 바뀌지 않는다.
  const [items] = useState(() => blockMenuItems(view.state, deps))
  const [cursor, setCursor] = useState<MenuCursor>(() => ({ index: firstEnabled(items), sub: null }))
  // 마우스를 올린 상위 항목의 하위 메뉴는 포커스를 옮기지 않고 보여만 준다.
  const [peek, setPeek] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

  // roving tabindex — 커서가 가리키는 항목에 포커스.
  useEffect(() => {
    const top = items[cursor.index]
    const id = cursor.sub === null ? top?.id : top?.children?.[cursor.sub]?.id
    if (id) itemRefs.current.get(id)?.focus()
  }, [cursor, items])

  // 바깥을 누르면 닫는다. capture 로 받아야 에디터가 먼저 selection 을 옮기기 전에 본다.
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [onClose])

  const dispatch = view.dispatch.bind(view)

  const run = (action: BlockMenuAction): void => {
    switch (action.kind) {
      case 'turn_into':
        turnSelectionIntoCommand(action.type, deps)(view.state, dispatch)
        break
      case 'color':
        setBlockColorCommand(action.color)(view.state, dispatch)
        break
      case 'duplicate':
        duplicateBlockSelectionCommand(deps)(view.state, dispatch)
        break
      case 'delete':
        deleteBlockSelectionCommand(deps)(view.state, dispatch)
        break
      case 'copy_link': {
        const sel = view.state.selection
        if (!isBlockSelection(sel)) break
        // 여러 블록을 골랐으면 첫 블록의 링크다.
        const url = `${window.location.origin}${blockLinkPath(workspaceId, pageId, sel.blockIds[0])}`
        void copyText(url).then((ok) => {
          onNotice(ok ? '블록 링크를 복사했습니다.' : `복사하지 못했습니다. 이 링크를 직접 복사하세요: ${url}`)
          // 예전 방식 복사가 임시 textarea 로 포커스를 가져갔을 수 있다.
          view.focus()
        })
        break
      }
    }
  }

  const activate = (item: MenuItem): void => {
    if (!item.enabled) return
    if (item.children) {
      setCursor({ index: items.indexOf(item), sub: firstEnabled(item.children) })
      return
    }
    if (item.action) run(item.action)
    onClose(true)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const nav = navigateMenu(items, cursor, event.key)
    if (nav.kind === 'none') return
    event.preventDefault()
    event.stopPropagation()
    if (nav.kind === 'move') {
      setPeek(null)
      setCursor(nav.cursor)
    } else if (nav.kind === 'activate') {
      activate(nav.item)
    } else {
      onClose(true)
    }
  }

  const register = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) itemRefs.current.set(id, el)
    else itemRefs.current.delete(id)
  }

  return (
    <div ref={rootRef} role="menu" aria-label="블록 메뉴" className="blk-menu" style={{ top, left }} onKeyDown={onKeyDown}>
      {items.map((item, i) => {
        const open = !!item.children && ((cursor.index === i && cursor.sub !== null) || peek === i)
        return (
          <div key={item.id} className="blk-menu-row">
            <button
              ref={register(item.id)}
              type="button"
              role="menuitem"
              aria-disabled={!item.enabled}
              aria-haspopup={item.children ? 'menu' : undefined}
              aria-expanded={item.children ? open : undefined}
              tabIndex={cursor.index === i && cursor.sub === null ? 0 : -1}
              className="blk-menu-item"
              onMouseEnter={() => {
                if (!item.enabled) return
                setCursor({ index: i, sub: null })
                setPeek(item.children ? i : null)
              }}
              onClick={() => activate(item)}
            >
              <span>{item.label}</span>
              {item.children ? (
                <span aria-hidden className="blk-menu-hint">▸</span>
              ) : item.shortcut ? (
                <span className="blk-menu-hint">{item.shortcut.replace('Mod', 'Ctrl')}</span>
              ) : null}
            </button>

            {open && item.children && (
              <div role="menu" aria-label={item.label} className="blk-menu blk-submenu">
                {item.children.map((child, j) => (
                  <button
                    key={child.id}
                    ref={register(child.id)}
                    type="button"
                    role="menuitemradio"
                    aria-checked={child.checked ?? false}
                    aria-disabled={!child.enabled}
                    tabIndex={cursor.index === i && cursor.sub === j ? 0 : -1}
                    className="blk-menu-item"
                    onMouseEnter={() => child.enabled && setCursor({ index: i, sub: j })}
                    onClick={() => activate(child)}
                  >
                    <span className="flex items-center gap-2">
                      {child.action?.kind === 'color' && (
                        <span aria-hidden className="blk-menu-swatch" data-color={child.action.color}>
                          가
                        </span>
                      )}
                      {child.label}
                    </span>
                    {child.checked && <span aria-hidden>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
