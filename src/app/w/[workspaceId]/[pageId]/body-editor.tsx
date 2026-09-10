'use client'

/**
 * 본문 에디터 — W4 의 화면
 *
 * 여기서 하는 일은 **조립과 저장**뿐이다. 편집 규칙은 전부 `src/lib/editor/`
 * 에 있고 DOM 없이 테스트된다. 이 파일에 규칙을 쓰기 시작하면 그 순간부터
 * 테스트할 수 없는 코드가 된다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 접힘 상태는 여기에 있다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-01-13: *"문서 데이터로 저장하면 상대 화면이 멋대로 접힘 → 로컬 저장 권장."*
 * 그래서 `collapsed` 는 문서에도 서버에도 없고 이 컴포넌트의 `useRef` 에 있다.
 * 커맨드는 `isCollapsed` 를 주입받아 병합·분할 규칙에 쓴다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 저장 — Phase 0 은 페이지 단위 LWW
 * ──────────────────────────────────────────────────────────────────────
 *
 * 마스터 문서 §5.1 의 대체안: *"페이지 단위 last-write-wins + 다른 사람이
 * 편집 중 배너."* 배너를 띄우려면 충돌을 **알아야** 하므로 읽을 때 받은
 * `version` 을 저장 시 되돌려 보낸다(낙관적 잠금). 409 가 오면 덮어쓰지 않고
 * 사용자에게 선택지를 준다.
 *
 * 디바운스는 1초다(§9-Q1 의 잠정 결정과 같은 값). 저장 중에 또 편집하면
 * 끝난 뒤 한 번 더 보낸다 — 마지막 상태가 반드시 서버에 도달해야 한다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EditorView } from '@tiptap/pm/view'

import { createEditor } from '@/lib/editor/create-editor'
import { pmToDoc } from '@/lib/editor/pm-adapter'
import {
  closeSlashMenu,
  filterSlashCommands,
  insertSubpageRef,
  runSlashCommand,
  slashMenuState,
  type SlashCommand,
} from '@/lib/editor/slash-menu'
import type { EditorDoc } from '@/lib/editor/document'

const SAVE_DEBOUNCE_MS = 1000

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }
  | { kind: 'conflict' }

type MenuUi = { open: boolean; query: string; index: number; left: number; top: number }

const CLOSED_MENU: MenuUi = { open: false, query: '', index: 0, left: 0, top: 0 }

export function BodyEditor({
  workspaceId,
  pageId,
  initialDoc,
  initialVersion,
}: {
  workspaceId: string
  pageId: string
  initialDoc: EditorDoc
  initialVersion: string
}) {
  const router = useRouter()
  const mountRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  /** 접힘 상태 — 문서에 없다(F-01-13). */
  const collapsedRef = useRef<Set<string>>(new Set())
  /** 서버가 마지막으로 알려준 version. 낙관적 잠금의 기준. */
  const versionRef = useRef(initialVersion)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  const pendingRef = useRef(false)

  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' })
  const [menu, setMenu] = useState<MenuUi>(CLOSED_MENU)

  // ── 저장 ────────────────────────────────────────────────────────────

  const save = useCallback(async (): Promise<void> => {
    if (savingRef.current) {
      // 저장 중에 또 편집됐다. 지금 도는 루프가 한 번 더 돈다.
      pendingRef.current = true
      return
    }

    savingRef.current = true
    setStatus({ kind: 'saving' })

    try {
      // 재귀 대신 루프다. 저장이 끝나는 사이에 들어온 편집을 반드시 한 번 더
      // 보낸다 — 마지막 상태가 서버에 도달하지 않으면 사용자가 친 글이 사라진다.
      do {
        pendingRef.current = false

        const view = viewRef.current
        if (!view) return

        const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/body`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ doc: pmToDoc(view.state.doc), version: versionRef.current }),
        })
        const data = await res.json()

        if (res.status === 409 && data.error === 'version_conflict') {
          setStatus({ kind: 'conflict' })
          return
        }
        if (!res.ok) {
          setStatus({ kind: 'error', message: data.message ?? '저장하지 못했습니다.' })
          return
        }

        versionRef.current = String(data.version)
      } while (pendingRef.current)

      setStatus({ kind: 'saved' })
      // 사이드바·하위 페이지 목록이 서버 렌더다.
      router.refresh()
    } catch {
      setStatus({ kind: 'error', message: '연결에 실패했습니다.' })
    } finally {
      savingRef.current = false
    }
  }, [workspaceId, pageId, router])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS)
  }, [save])

  /** 충돌을 사용자가 해결한다 — 내 것으로 덮어쓴다. */
  const overwrite = useCallback(async () => {
    versionRef.current = ''
    const view = viewRef.current
    if (!view) return
    setStatus({ kind: 'saving' })
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/body`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        // version 을 빼면 순수 LWW 다 — 서버가 무조건 덮어쓴다.
        body: JSON.stringify({ doc: pmToDoc(view.state.doc) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus({ kind: 'error', message: '저장하지 못했습니다.' })
        return
      }
      versionRef.current = String(data.version)
      setStatus({ kind: 'saved' })
      router.refresh()
    } catch {
      setStatus({ kind: 'error', message: '연결에 실패했습니다.' })
    }
  }, [workspaceId, pageId, router])

  // ── 슬래시 메뉴 ─────────────────────────────────────────────────────

  const syncMenu = useCallback((view: EditorView) => {
    const state = slashMenuState(view.state)
    if (!state.active) {
      setMenu((prev) => (prev.open ? CLOSED_MENU : prev))
      return
    }
    // 캐럿 위치에 띄운다. 뷰포트 아래쪽이면 위로 뒤집는 것은 CSS 가 한다.
    const coords = view.coordsAtPos(view.state.selection.head)
    const box = view.dom.getBoundingClientRect()
    setMenu((prev) => ({
      open: true,
      query: state.query,
      // 쿼리가 바뀌면 선택을 첫 항목으로 되돌린다.
      index: prev.query === state.query ? prev.index : 0,
      left: coords.left - box.left,
      top: coords.bottom - box.top,
    }))
  }, [])

  /**
   * 하위 페이지 만들기 (F-02-13).
   *
   * 서버가 진짜 `block` 행을 만든 **뒤에** 참조 노드를 넣는다 — 참조 노드의
   * id 가 곧 그 페이지의 id 여야 하기 때문이다. 가짜 id 로 먼저 넣으면 그 사이
   * 자동 저장이 존재하지 않는 페이지를 참조한다.
   */
  const createSubpage = useCallback(async () => {
    const view = viewRef.current
    if (!view) return
    setStatus({ kind: 'saving' })
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentPageId: pageId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus({ kind: 'error', message: '하위 페이지를 만들지 못했습니다.' })
        return
      }
      const current = viewRef.current
      if (!current) return
      insertSubpageRef(current.state, current.dispatch.bind(current), {
        id: String(data.page.id),
        title: String(data.page.title ?? ''),
      })
      current.focus()
    } catch {
      setStatus({ kind: 'error', message: '연결에 실패했습니다.' })
    }
  }, [workspaceId, pageId])

  const execute = useCallback(
    (command: SlashCommand) => {
      const view = viewRef.current
      if (!view) return

      if (command.kind === 'page') {
        void createSubpage()
        return
      }

      runSlashCommand(view.state, view.dispatch.bind(view), command, {
        isCollapsed: (id) => collapsedRef.current.has(id),
      })
      view.focus()
    },
    [createSubpage],
  )

  // ── 에디터 생성 ─────────────────────────────────────────────────────

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const view = createEditor({
      mount,
      doc: initialDoc,
      editable: true,
      deps: {
        isCollapsed: (id) => collapsedRef.current.has(id),
        expand: (id) => {
          collapsedRef.current.delete(id)
          // 접힘은 CSS 로 표현되므로 DOM 을 다시 그리게 한다.
          viewRef.current?.dispatch(viewRef.current.state.tr)
        },
        toggleCollapsed: (id) => {
          if (collapsedRef.current.has(id)) collapsedRef.current.delete(id)
          else collapsedRef.current.add(id)
          viewRef.current?.dispatch(viewRef.current.state.tr)
        },
        openPage: (id) => router.push(`/w/${workspaceId}/${id}`),
        onBlocked: (plan) => setStatus({ kind: 'error', message: plan.detail }),
      },
      onTransaction: (v, tr) => {
        syncMenu(v)
        applyCollapsedAttributes(v, collapsedRef.current)
        if (tr.docChanged) scheduleSave()
      },
    })

    viewRef.current = view
    applyCollapsedAttributes(view, collapsedRef.current)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      view.destroy()
      viewRef.current = null
    }
    // 마운트 시 한 번만 만든다. initialDoc 이 바뀌어도 다시 만들지 않는다 —
    // 편집 중인 내용을 서버 렌더가 덮어쓰면 사용자가 방금 친 글이 사라진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 메뉴 키 조작 ────────────────────────────────────────────────────

  // useMemo 가 필요하다 — 아래 useEffect 의 의존성이라 매 렌더 새 배열이면
  // 키 핸들러가 계속 다시 붙는다.
  const items = useMemo(
    () => (menu.open ? filterSlashCommands(menu.query) : []),
    [menu.open, menu.query],
  )

  useEffect(() => {
    if (!menu.open) return
    const onKeyDown = (event: KeyboardEvent) => {
      // IME 조합 중에는 메뉴가 키를 가로채지 않는다 — 한글 입력이 깨진다.
      if (event.isComposing) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMenu((m) => ({ ...m, index: (m.index + 1) % Math.max(items.length, 1) }))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMenu((m) => ({ ...m, index: (m.index - 1 + items.length) % Math.max(items.length, 1) }))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const command = items[menu.index]
        if (command) execute(command)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        const view = viewRef.current
        if (view) view.dispatch(closeSlashMenu(view.state.tr))
      }
    }
    // capture 로 잡아야 ProseMirror 의 keymap 보다 먼저 본다.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [menu.open, menu.index, items, execute])

  // ── 렌더 ────────────────────────────────────────────────────────────

  return (
    <section aria-label="본문" className="relative">
      {status.kind === 'conflict' && (
        <div
          role="alert"
          className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950"
        >
          <span>다른 사람이 이 페이지를 먼저 저장했습니다. 지금 저장하면 그 내용을 덮어씁니다.</span>
          <button
            type="button"
            onClick={() => void overwrite()}
            className="rounded border border-amber-400 px-2 py-1 text-xs"
          >
            내 것으로 덮어쓰기
          </button>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
          >
            다시 불러오기
          </button>
        </div>
      )}

      {status.kind === 'error' && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {status.message}
        </p>
      )}

      <div ref={mountRef} />

      {menu.open && items.length > 0 && (
        <ul
          role="listbox"
          aria-label="블록 삽입"
          style={{ left: menu.left, top: menu.top }}
          className="absolute z-10 max-h-72 w-64 overflow-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {items.map((command, i) => (
            <li key={command.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === menu.index}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => execute(command)}
                onMouseEnter={() => setMenu((m) => ({ ...m, index: i }))}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  i === menu.index ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                }`}
              >
                {command.label}
                <span className="ml-2 text-xs text-neutral-400">{command.group}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 h-4 text-xs text-neutral-400">
        {status.kind === 'saving' && '저장 중…'}
        {status.kind === 'saved' && '저장됨'}
      </p>
    </section>
  )
}

/**
 * 접힘을 DOM 속성으로 반영한다.
 *
 * 자식을 DOM 에서 **빼지 않는다.** ProseMirror 는 DOM 구조로 위치를 계산하므로
 * 노드를 빼면 캐럿 위치가 어긋난다. `data-collapsed` 를 달고 CSS 가 숨긴다.
 */
function applyCollapsedAttributes(view: EditorView, collapsed: ReadonlySet<string>): void {
  const containers = view.dom.querySelectorAll<HTMLElement>('[data-block-id]')
  for (const el of containers) {
    const id = el.getAttribute('data-block-id') ?? ''
    if (collapsed.has(id)) el.setAttribute('data-collapsed', 'true')
    else el.removeAttribute('data-collapsed')
  }
}
