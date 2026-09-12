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

import { blockIdFromHash, revealBlockCommand } from '@/lib/editor/block-menu'
import { selectedBlockCount } from '@/lib/editor/block-selection'
import type { CommandDeps } from '@/lib/editor/commands'
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
import { uploadImageFile } from '@/lib/file/upload-client'
import { BlockGutter } from './block-gutter'

const SAVE_DEBOUNCE_MS = 1000

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }
  /** 오류가 아닌 안내 — 블록 링크를 복사했다 같은 것. */
  | { kind: 'notice'; message: string }
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
  /** 블록 핸들의 좌표 기준. 에디터 DOM 이 아니라 그 바깥 틀이다(`block-gutter.tsx`). */
  const frameRef = useRef<HTMLDivElement | null>(null)
  /** `Mod+/` 가 부를 "블록 메뉴 열기". 블록 핸들이 채운다. */
  const openMenuRef = useRef<(() => void) | null>(null)
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
  /** 블록 선택 개수 — 화면 표시가 아니라 스크린리더 안내용이다(F-12-12). */
  const [selectedBlocks, setSelectedBlocks] = useState(0)

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

  // ── 접힘 · 핸들 ─────────────────────────────────────────────────────

  /**
   * 접힌 블록을 펼친다. 에디터 커맨드(병합)와 블록 핸들(드롭) 둘 다 부른다 —
   * 한 벌만 두어야 "펼쳤는데 한쪽 화면만 안 바뀌는" 일이 없다.
   */
  const expandBlock = useCallback((id: string) => {
    collapsedRef.current.delete(id)
    // 접힘은 CSS 로 표현되므로 DOM 을 다시 그리게 한다.
    viewRef.current?.dispatch(viewRef.current.state.tr)
  }, [])

  const gutterDeps = useMemo<CommandDeps>(
    () => ({
      isCollapsed: (id) => collapsedRef.current.has(id),
      expand: expandBlock,
      onRefused: (detail) => setStatus({ kind: 'error', message: detail }),
    }),
    [expandBlock],
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
        workspaceId,
        // 업로드는 XHR 로 한다(진행률). 자세한 이유는 `upload-client.ts`.
        uploadImage: (file, onProgress) =>
          uploadImageFile(workspaceId, file, { onProgress }),
        isCollapsed: (id) => collapsedRef.current.has(id),
        expand: expandBlock,
        toggleCollapsed: (id) => {
          if (collapsedRef.current.has(id)) collapsedRef.current.delete(id)
          else collapsedRef.current.add(id)
          viewRef.current?.dispatch(viewRef.current.state.tr)
        },
        openPage: (id) => router.push(`/w/${workspaceId}/${id}`),
        onBlocked: (plan) => setStatus({ kind: 'error', message: plan.detail }),
        onRefused: (detail) => setStatus({ kind: 'error', message: detail }),
        openBlockMenu: () => openMenuRef.current?.(),
      },
      onTransaction: (v, tr) => {
        syncMenu(v)
        // 같은 값이면 리렌더하지 않는다 — 트랜잭션마다 불리는 자리다.
        const count = selectedBlockCount(v.state)
        setSelectedBlocks((prev) => (prev === count ? prev : count))
        if (tr.docChanged) scheduleSave()
      },
    })

    viewRef.current = view

    // `/{pageId}#{blockId}` 로 들어왔으면 그 블록을 보여준다(F-01-08 "Copy link to
    // block" 의 받는 쪽). 같은 페이지 안에서 해시만 바뀌는 경우도 받는다.
    const reveal = (): void => {
      const id = blockIdFromHash(window.location.hash)
      const current = viewRef.current
      if (!id || !current) return
      revealBlockCommand(id, gutterDeps)(current.state, current.dispatch.bind(current))
    }
    reveal()
    window.addEventListener('hashchange', reveal)

    /**
     * 에디터를 **빗나간** 파일 드롭을 삼킨다.
     *
     * 브라우저의 기본 동작은 그 파일을 여는 것이고, 그건 이 페이지를 떠나는
     * 일이다 — 조금 빗나가게 놓았을 뿐인데 편집하던 화면이 사라진다.
     * 에디터 안쪽은 플러그인이 받아 이미지 블록으로 만든다(`image-drop.ts`).
     */
    const swallowFileDrop = (event: DragEvent): void => {
      if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault()
    }
    window.addEventListener('dragover', swallowFileDrop)
    window.addEventListener('drop', swallowFileDrop)

    return () => {
      window.removeEventListener('hashchange', reveal)
      window.removeEventListener('dragover', swallowFileDrop)
      window.removeEventListener('drop', swallowFileDrop)
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
      // ★ 메뉴가 먹은 키는 에디터까지 가면 안 된다. `preventDefault()` 는
      //   브라우저 기본 동작만 막을 뿐 ProseMirror 의 `handleKeyDown` 은 그대로
      //   돌아서, Enter 로 항목을 고르면 그 직후 블록이 한 번 더 쪼개졌다.
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
        event.stopPropagation()
      }
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

      {status.kind === 'notice' && (
        <p role="status" className="mb-3 break-all text-sm text-neutral-500">
          {status.message}
        </p>
      )}

      {/*
        프레임: 왼쪽으로 3rem 넓혀 핸들이 들어갈 여백을 hover 영역에 포함시킨다.
        -ml-12 와 pl-12 가 상쇄하므로 에디터의 위치는 그대로다 — 슬래시 메뉴는
        섹션 기준 좌표를 쓰므로 영향이 없다.
      */}
      <div ref={frameRef} className="relative -ml-12 pl-12">
        <div ref={mountRef} />
        <BlockGutter
          viewRef={viewRef}
          frameRef={frameRef}
          deps={gutterDeps}
          workspaceId={workspaceId}
          pageId={pageId}
          openMenuRef={openMenuRef}
          onNotice={(message) => setStatus({ kind: 'notice', message })}
        />
      </div>

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

      {/*
        F-12-12: "블록 선택 모드에는 시각적 하이라이트뿐 아니라 aria-selected 와
        라이브 리전 안내가 필요하다." aria-selected 는 데코레이션이 달고,
        개수 안내가 여기다 — 하이라이트는 보이지 않는 사용자에게 아무 것도 알리지 않는다.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {selectedBlocks > 0 ? `블록 ${selectedBlocks}개 선택됨` : ''}
      </p>

      <p className="mt-2 h-4 text-xs text-neutral-400">
        {status.kind === 'saving' && '저장 중…'}
        {status.kind === 'saved' && '저장됨'}
      </p>
    </section>
  )
}
