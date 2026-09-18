'use client'

/**
 * 본문 에디터 — 협업 편집기를 협업 서버에 붙인 화면 (F-05-01 · F-05-04 · F-05-15 · F-05-19 · CRDT 6d조각)
 *
 * 여기서 하는 일은 **조립과 표시**뿐이다. 편집 규칙은 `src/lib/editor/`, 연결과 보존은 `src/lib/collab/` 에 있고 둘 다 DOM 없이
 * 검사된다. 이 파일에 규칙을 쓰기 시작하면 그 순간부터 검사할 수 없는 코드가 된다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 저장이라는 단계가 없다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 편집은 Y.Doc 에 쓰이고(`collab/collab-editor.ts`), 연결이 그것을 협업 서버로 보내 로그에 쌓는다(`collab/collab-connection.ts`).
 * 본문 행은 그 결과의 투영이다(판결 X-1). 그래서 PUT 저장 · 낙관적 잠금 · 충돌 배너가 없다 — 두 사람이 같은 문단을 쳐도 서로를
 * 덮어쓰지 않기 때문이다.
 *
 *   - **서버가 준 Y 상태로 시작한다**(`initialState`) — 첫 동기화 전에도 본문이 보인다(빈 화면 없이)
 *   - **끊겨도 친 글을 잃지 않는다**(F-05-04) — 서버가 확인하지 않은 편집은 IndexedDB 에 남고(`collab/pending-store.ts`),
 *     다시 열면 되살려 보낸다. 확인된 것은 남기지 않는다
 *   - **서버가 문서를 닫으면 연결이 로컬 문서를 버리고 다시 연다** — 그때 `doc` 이 바뀌므로 편집기를 새 문서로 다시 만든다.
 *     다시 여는 동안에는 편집을 막는다(버린 문서에 친 편집은 쌓이지 않는다). 버린 편집은 사용자에게 보여 준다(F-12-16)
 *   - **하위 페이지는 서버가 자리를 정한다**(§3.2-25 · 6b) — `/쿼리` 를 지운 편집이 서버에 쌓인 뒤에 캐럿이 있던 블록 id 를 넘긴다.
 *     참조 노드는 동기화로 도착한다 — 로컬에 넣으면 참조가 둘이 된다
 *   - **참조의 제목은 문서에 없다**(§3.2-22) — 서버가 권한으로 거른 맵을 주고, 모르는 참조를 받으면 다시 읽는다
 *
 * 접힘 상태는 여전히 이 컴포넌트의 `useRef` 에 있다(F-01-13: *"문서 데이터로 저장하면 상대 화면이 멋대로 접힘"*).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type * as Y from 'yjs'

import { blockIdFromHash, revealBlockCommand } from '@/lib/editor/block-menu'
import { plainTextForBlocks } from '@/lib/editor/block-clipboard'
import { selectedBlockCount } from '@/lib/editor/block-selection'
import type { CommandDeps } from '@/lib/editor/commands'
import { createEditor, type EditorDeps } from '@/lib/editor/create-editor'
import { createNodeViews } from '@/lib/editor/node-views'
import { containerAt, findContainerById } from '@/lib/editor/pm-blocks'
import { PAGE_REF_NODE } from '@/lib/editor/schema'
import {
  closeSlashMenu,
  filterSlashCommands,
  runSlashCommand,
  slashMenuState,
  type SlashCommand,
} from '@/lib/editor/slash-menu'
import { createCollabEditorState } from '@/lib/collab/collab-editor'
import { openCollabConnection, type CollabConnection, type CollabSnapshot, type DiscardedDoc } from '@/lib/collab/collab-connection'
import { decodeBodyState } from '@/lib/collab/collab-protocol'
import { openPendingEditStore, pendingEditKey } from '@/lib/collab/pending-store'
import { BODY_FRAGMENT, readBodyYDoc } from '@/lib/collab/ydoc'
import { uploadImageFile } from '@/lib/file/upload-client'
import { BlockGutter } from './block-gutter'

/** 이 시간 넘게 서버가 확인하지 않으면 "동기화 중…"을 보여 준다 — 그 전에는 무표시다(F-05-04). */
const SYNCING_AFTER_MS = 3000
/** 하위 페이지를 만들기 전에 `/쿼리` 지우기가 서버에 쌓이기를 기다리는 한도. */
const CONFIRM_TIMEOUT_MS = 10_000
/** 서버가 넣은 참조가 동기화로 도착하기를 기다리는 한도 — 도착하면 그 블록을 고른다. */
const REF_ARRIVAL_TIMEOUT_MS = 5000

type Status =
  | { kind: 'idle' }
  /** 오류가 아닌 안내 — 블록 링크를 복사했다 같은 것. */
  | { kind: 'notice'; message: string }
  /** `unsaved` 는 서버가 받지 못해 버린 편집의 평문이다(F-12-16 "내용 보기"). */
  | { kind: 'error'; message: string; unsaved?: string }

type MenuUi = { open: boolean; query: string; index: number; left: number; top: number }

const CLOSED_MENU: MenuUi = { open: false, query: '', index: 0, left: 0, top: 0 }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 문서에 있는 하위 페이지 참조의 blockId. */
function pageRefIds(view: EditorView): string[] {
  const ids: string[] = []
  view.state.doc.descendants((node, _pos, parent) => {
    if (node.type.name !== PAGE_REF_NODE) return true
    const id = String(parent?.attrs.blockId ?? '')
    if (id !== '') ids.push(id)
    return false
  })
  return ids
}

export function BodyEditor({
  workspaceId,
  pageId,
  userId,
  collabUrl,
  initialState,
  canEdit,
  initialPageRefTitles,
}: {
  workspaceId: string
  pageId: string
  /** 보존본 열쇠에 들어간다 — 같은 브라우저의 다른 사람에게 내 편집을 보내지 않는다. */
  userId: string
  /** 협업 서버 주소. 서버 렌더가 준다(`collab/collab-url.ts`). */
  collabUrl: string
  /** 서버가 준 본문 Y 상태(base64) — 첫 동기화 전에도 본문이 보인다. */
  initialState: string
  /** 이 사람이 이 페이지를 고칠 수 있는가 — 연결이 읽기 전용으로 받으면 그쪽이 이긴다. */
  canEdit: boolean
  /** 하위 페이지 참조의 제목 — 볼 수 있는 것만, 볼 수 없으면 null. 참조 노드는 제목을 싣지 않는다. */
  initialPageRefTitles: Readonly<Record<string, string | null>>
}) {
  const router = useRouter()
  const mountRef = useRef<HTMLDivElement | null>(null)
  /** 블록 핸들의 좌표 기준. 에디터 DOM 이 아니라 그 바깥 틀이다(`block-gutter.tsx`). */
  const frameRef = useRef<HTMLDivElement | null>(null)
  /** `Mod+/` 가 부를 "블록 메뉴 열기". 블록 핸들이 채운다. */
  const openMenuRef = useRef<(() => void) | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const connectionRef = useRef<CollabConnection | null>(null)
  /** 지금 편집기가 붙어 있는 Y.Doc — 연결이 문서를 버리고 다시 열면 바뀐다. */
  const boundDocRef = useRef<Y.Doc | null>(null)
  /** 협업 편집기가 돌려준 deps — 노드 뷰를 다시 만들 때 그대로 쓴다(되돌리기 짝이 들어 있다). */
  const editorDepsRef = useRef<EditorDeps | null>(null)

  /** 접힘 상태 — 문서에 없다(F-01-13). */
  const collapsedRef = useRef<Set<string>>(new Set())
  /** 하위 페이지 참조의 제목 — 문서에 없다. 서버가 권한으로 거른 것에서 시작하고, 모르는 참조를 받으면 다시 읽는다. */
  const pageRefTitlesRef = useRef<Map<string, string | null>>(new Map(Object.entries(initialPageRefTitles)))
  /** 제목을 다시 읽는 중인가 — 한 번에 하나만. */
  const refreshingTitlesRef = useRef(false)

  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [menu, setMenu] = useState<MenuUi>(CLOSED_MENU)
  /** 블록 선택 개수 — 화면 표시가 아니라 스크린리더 안내용이다(F-12-12). */
  const [selectedBlocks, setSelectedBlocks] = useState(0)
  /** 연결이 알려주는 것 — 온라인 · 읽기 전용 · 미확인 편집 · 다시 여는 중 · 닫힘. */
  const [link, setLink] = useState<Pick<CollabSnapshot, 'online' | 'readOnly' | 'unconfirmed' | 'reopening' | 'closed'>>({
    online: false,
    readOnly: null,
    unconfirmed: false,
    reopening: false,
    closed: null,
  })
  /** 미확인 편집이 3초 넘게 남아 있다 — 그때만 "동기화 중…"을 말한다(F-05-04: 기본 무표시). */
  const [syncing, setSyncing] = useState(false)
  const syncingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 버린 편집의 내용을 펼쳐 보여주는 중인가(F-12-16 "내용 보기"). */
  const [showUnsaved, setShowUnsaved] = useState(false)

  const editable = canEdit && link.readOnly !== true && !link.reopening && link.closed === null
  /** 물을 때마다 판단한다 — `createEditor` 가 이 함수를 그대로 쓴다. */
  const editableRef = useRef(editable)
  editableRef.current = editable

  useEffect(() => {
    viewRef.current?.setProps({ editable: () => editableRef.current })
  }, [editable])

  // ── 제목 맵 ─────────────────────────────────────────────────────────

  /** 모르는 참조를 받았으면 맵을 다시 읽는다 — 노드 뷰는 맵이 바뀌어도 스스로 다시 그리지 않는다. */
  const refreshPageRefTitles = useCallback(async () => {
    if (refreshingTitlesRef.current) return
    refreshingTitlesRef.current = true
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/page-ref-titles`)
      if (!res.ok) return
      const data = (await res.json()) as { pageRefTitles?: Record<string, string | null> }
      pageRefTitlesRef.current = new Map(Object.entries(data.pageRefTitles ?? {}))
      const view = viewRef.current
      const deps = editorDepsRef.current
      if (view && deps) view.setProps({ nodeViews: createNodeViews(deps) })
    } catch {
      // 다음 참조가 도착하면 다시 청한다.
    } finally {
      refreshingTitlesRef.current = false
    }
  }, [workspaceId, pageId])

  const checkUnknownRefs = useCallback(
    (view: EditorView) => {
      const unknown = pageRefIds(view).some((id) => !pageRefTitlesRef.current.has(id))
      if (unknown) void refreshPageRefTitles()
    },
    [refreshPageRefTitles],
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
   * 하위 페이지 만들기 (F-02-13 · CRDT 6b · 6d).
   *
   * 참조 노드를 **로컬에 넣지 않는다** — 서버도 부모 본문에 넣으므로 둘이 되고, 그러면 문서 순서의 첫째만 남아 사용자가 고른
   * 자리가 아닐 수 있다(§3.2-24). 대신 캐럿이 있던 블록 id 를 넘겨 서버가 그 자리에 넣는다(`createPage` 의 `at`).
   *
   * `/쿼리` 를 지운 편집이 **서버에 쌓인 뒤에** 넘긴다 — 먼저 넘기면 서버가 보는 그 블록에는 아직 `/페이지` 글자가 있어
   * 대체가 아니라 뒤에 들어간다.
   */
  const createSubpage = useCallback(async () => {
    const view = viewRef.current
    const connection = connectionRef.current
    if (!view || !connection) return
    const at = containerAt(view.state.selection.$from)?.id ?? null

    // 메뉴가 열려 있으면 `/쿼리` 를 지운다. 서버 왕복 사이에 더 입력했어도 플러그인 상태가 매핑을 따라온다.
    const tr = view.state.tr
    const state = slashMenuState(view.state)
    if (state.active && view.state.selection.head > state.from) tr.delete(state.from, view.state.selection.head)
    closeSlashMenu(tr)
    view.dispatch(tr)

    try {
      await Promise.race([
        connection.confirm(),
        sleep(CONFIRM_TIMEOUT_MS).then(() => {
          throw new Error('timeout')
        }),
      ])
    } catch {
      setStatus({ kind: 'error', message: '연결이 끊겨 하위 페이지를 만들지 못했습니다. 연결이 돌아오면 다시 시도해 주세요.' })
      return
    }

    let id: string
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentPageId: pageId, at }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus({ kind: 'error', message: '하위 페이지를 만들지 못했습니다.' })
        return
      }
      id = String(data.page.id)
      // 만든 사람은 그 페이지를 볼 수 있다. 참조가 도착하기 전에 맵에 넣어 둔다.
      pageRefTitlesRef.current.set(id, String(data.page.title ?? ''))
    } catch {
      setStatus({ kind: 'error', message: '연결에 실패했습니다.' })
      return
    }

    // 사이드바 · 하위 페이지 목록은 서버 렌더다.
    router.refresh()

    // 참조 노드는 서버가 넣고 동기화로 온다 — 도착하면 그 블록을 고른다.
    const deadline = Date.now() + REF_ARRIVAL_TIMEOUT_MS
    for (;;) {
      const current = viewRef.current
      if (!current) return
      const placed = findContainerById(current.state.doc, id)
      if (placed) {
        current.dispatch(current.state.tr.setSelection(NodeSelection.create(current.state.doc, placed.contentPos)).scrollIntoView())
        current.focus()
        return
      }
      if (Date.now() > deadline) return
      await sleep(50)
    }
  }, [workspaceId, pageId, router])

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

  // ── 편집기 · 연결 ───────────────────────────────────────────────────

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false

    const deps: EditorDeps = {
      workspaceId,
      // 업로드는 XHR 로 한다(진행률). 자세한 이유는 `upload-client.ts`.
      uploadImage: (file, onProgress) => uploadImageFile(workspaceId, file, { onProgress }),
      isCollapsed: (id) => collapsedRef.current.has(id),
      expand: expandBlock,
      toggleCollapsed: (id) => {
        if (collapsedRef.current.has(id)) collapsedRef.current.delete(id)
        else collapsedRef.current.add(id)
        viewRef.current?.dispatch(viewRef.current.state.tr)
      },
      openPage: (id) => router.push(`/w/${workspaceId}/${id}`),
      pageRefTitle: (id) => pageRefTitlesRef.current.get(id),
      onBlocked: (plan) => setStatus({ kind: 'error', message: plan.detail }),
      onRefused: (detail) => setStatus({ kind: 'error', message: detail }),
      openBlockMenu: () => openMenuRef.current?.(),
    }

    /** `#{blockId}` 로 들어왔으면 그 블록을 보여준다(F-01-08 의 받는 쪽). */
    const reveal = (): void => {
      const id = blockIdFromHash(window.location.hash)
      const current = viewRef.current
      if (!id || !current) return
      revealBlockCommand(id, gutterDeps)(current.state, current.dispatch.bind(current))
    }

    /** 이 Y.Doc 에 편집기를 붙인다 — 연결이 문서를 버리고 다시 열면 다시 부른다. */
    const bind = (ydoc: Y.Doc): void => {
      viewRef.current?.destroy()
      const collab = createCollabEditorState(ydoc.getXmlFragment(BODY_FRAGMENT), deps)
      editorDepsRef.current = collab.deps
      boundDocRef.current = ydoc
      const view = createEditor({
        mount,
        state: collab.state,
        editable: () => editableRef.current,
        // ★ 협업 편집기가 돌려준 deps 를 넘긴다 — 받은 것을 그대로 넘기면 Mod-z 가 아무것도 되돌리지 않는다(§3.3-117).
        deps: collab.deps,
        onTransaction: (v) => {
          syncMenu(v)
          // 같은 값이면 리렌더하지 않는다 — 트랜잭션마다 불리는 자리다.
          const count = selectedBlockCount(v.state)
          setSelectedBlocks((prev) => (prev === count ? prev : count))
          checkUnknownRefs(v)
        },
      })
      viewRef.current = view
      reveal()
    }

    void (async () => {
      const store = await openPendingEditStore()
      if (disposed) return
      const connection = await openCollabConnection({
        url: collabUrl,
        workspaceId,
        pageId,
        initialState: decodeBodyState(initialState),
        store,
        storeKey: pendingEditKey(userId, pageId),
        onChange: (snapshot) => {
          // 3초를 재는 것은 여기다 — 미확인이 풀리면 타이머를 끄고 곧바로 조용해진다.
          if (snapshot.unconfirmed && syncingTimerRef.current === null) {
            syncingTimerRef.current = setTimeout(() => setSyncing(true), SYNCING_AFTER_MS)
          } else if (!snapshot.unconfirmed && syncingTimerRef.current !== null) {
            clearTimeout(syncingTimerRef.current)
            syncingTimerRef.current = null
            setSyncing(false)
          }
          setLink({
            online: snapshot.online,
            readOnly: snapshot.readOnly,
            unconfirmed: snapshot.unconfirmed,
            reopening: snapshot.reopening,
            closed: snapshot.closed,
          })
          // 버리고 다시 연 문서 — 편집기를 그 문서로 다시 만든다.
          if (!disposed && snapshot.doc !== boundDocRef.current) bind(snapshot.doc)
        },
        onDiscarded: (discarded: DiscardedDoc) => {
          if (!discarded.unconfirmed) return
          const text = plainTextForBlocks(readBodyYDoc(discarded.doc, pageId).doc.blocks)
          setStatus({
            kind: 'error',
            message: '서버가 받지 못한 편집이 있어 본문을 다시 불러왔습니다. 아래에서 내용을 확인해 복사해 주세요.',
            unsaved: text,
          })
        },
      })
      if (disposed) {
        void connection.destroy()
        return
      }
      connectionRef.current = connection
      bind(connection.snapshot().doc)
      checkUnknownRefs(viewRef.current!)
    })()

    // 같은 페이지 안에서 해시만 바뀌는 경우도 받는다.
    window.addEventListener('hashchange', reveal)

    /**
     * 에디터를 **빗나간** 파일 드롭을 삼킨다.
     *
     * 브라우저의 기본 동작은 그 파일을 여는 것이고, 그건 이 페이지를 떠나는 일이다 — 조금 빗나가게 놓았을 뿐인데 편집하던
     * 화면이 사라진다. 에디터 안쪽은 플러그인이 받아 이미지 블록으로 만든다(`image-drop.ts`).
     */
    const swallowFileDrop = (event: DragEvent): void => {
      if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault()
    }
    window.addEventListener('dragover', swallowFileDrop)
    window.addEventListener('drop', swallowFileDrop)

    return () => {
      disposed = true
      if (syncingTimerRef.current !== null) clearTimeout(syncingTimerRef.current)
      window.removeEventListener('hashchange', reveal)
      window.removeEventListener('dragover', swallowFileDrop)
      window.removeEventListener('drop', swallowFileDrop)
      void connectionRef.current?.destroy()
      connectionRef.current = null
      viewRef.current?.destroy()
      viewRef.current = null
      boundDocRef.current = null
    }
    // 마운트 시 한 번만 만든다. 서버 렌더가 다시 와도 편집기를 다시 만들지 않는다 —
    // 편집 중인 문서를 갈아끼우면 사용자가 방금 친 글이 사라진다.
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

  const banner = (() => {
    if (link.closed === 'not_found') return '이 페이지에 접근할 수 없습니다. 권한이 바뀌었거나 페이지가 지워졌습니다.'
    if (link.closed === 'login') return '로그인이 풀렸습니다. 다시 로그인하면 이어서 편집할 수 있습니다.'
    if (link.closed === 'misconfigured') return '협업 서버에 연결할 수 없습니다. 설정을 확인해 주세요.'
    if (link.reopening) return '다른 곳의 변경과 맞추는 중입니다. 잠시 편집할 수 없습니다.'
    if (canEdit && link.readOnly === true) return '이 페이지를 고칠 권한이 사라져 읽기 전용입니다.'
    if (!canEdit) return '읽기 전용입니다 — 이 페이지를 고칠 권한이 없습니다.'
    if (!link.online) return '오프라인입니다. 계속 편집할 수 있고, 변경 사항은 연결이 돌아오면 저장됩니다.'
    return null
  })()

  return (
    <section aria-label="본문" className="relative">
      {/*
        F-12-16 의 `Offline` 배너와 닫힘 안내. **편집을 막지 않는다** — 정본: *"저장 실패 시 편집 차단이 아니라 경고 유지"*.
        친 글은 보존본에 쌓이고 연결이 돌아오면 나간다. 다시 여는 중 · 읽기 전용 · 닫힘일 때만 편집기가 잠긴다.
      */}
      {banner && (
        <p
          role="status"
          className="mb-3 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          {banner}
        </p>
      )}

      {status.kind === 'error' && (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 text-sm text-red-600">
          <span>{status.message}</span>
          {status.unsaved !== undefined && (
            <>
              {/*
                정본 F-12-16: *"조용히 버리면 데이터 손실 신고가 된다"* — 못 보낸 내용을 **볼 수 있어야** 한다.
                서버가 거부한 편집은 다시 보낼 길이 없으므로, 사용자가 자기 글을 복사해 갈 길이 유일한 탈출구다.
              */}
              <button
                type="button"
                onClick={() => setShowUnsaved((v) => !v)}
                className="rounded border border-red-300 px-2 py-1 text-xs dark:border-red-800"
              >
                {showUnsaved ? '내용 숨기기' : '저장하지 못한 내용 보기'}
              </button>
              {showUnsaved && (
                <textarea
                  readOnly
                  aria-label="저장하지 못한 내용"
                  value={status.unsaved}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-40 w-full rounded border border-red-200 bg-white p-2 font-mono text-xs text-neutral-800 dark:border-red-900 dark:bg-neutral-950 dark:text-neutral-200"
                />
              )}
            </>
          )}
        </div>
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

      {/*
        정본 F-05-04: **기본 무표시.** 잘 되는 것은 조용해야 한다 — 1초마다
        깜빡이는 "저장됨"은 정보가 아니라 소음이고, 진짜 문제가 그 안에 묻힌다.
        서버가 3초 넘게 확인하지 않았을 때만 말한다.
      */}
      <p role="status" aria-live="polite" className="mt-2 h-4 text-xs text-neutral-400">
        {syncing ? '동기화 중…' : ''}
      </p>
    </section>
  )
}
