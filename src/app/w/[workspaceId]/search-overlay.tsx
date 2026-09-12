'use client'

/**
 * 검색 오버레이 — W7 (F-07-01)
 *
 * 정본: 07-search-navigation.md F-07-01 · F-07-04
 *
 * ──────────────────────────────────────────────────────────────────────
 * 같은 컴포넌트가 "이동"과 "검색" 둘을 한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-07-01: *"입력 0자 = '이동 모드'(최근 방문), 1자 이상 = '검색 모드'.
 * **같은 컴포넌트가 상태만 바꾼다.**"* 그래서 빈 상태의 데이터(`recent`)는
 * 서버 레이아웃이 이미 읽어서 내려준다 — `listRecent` 가 권한으로 걸러서 준다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * `cmd+K` 의 분기 조건은 "텍스트가 선택되어 있는가"다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-07-01 이 헬프센터를 대조해 확정한 규칙이다: 같은 문서가 `cmd/ctrl+K` 를
 * "opens search" 로도, *"With text selected, press `cmd/ctrl + K` to add a link"*
 * 로도 기술한다. 즉 **"커서가 블록 안에 있는가"가 아니라 "선택이 있는가"** 다.
 *
 * 링크 편집(`promptLink`)은 아직 에디터에 연결되지 않았지만(`keymap.ts` 가
 * 선택적 의존으로 받고 아무도 넘기지 않는다), 규칙은 지금 지킨다 — 나중에
 * 링크를 붙일 때 이 분기를 다시 찾아 고치게 하지 않기 위해서다.
 * `cmd/ctrl+P` 는 그 충돌이 없는 우회 경로다(F-07-01).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 에디터를 지키는 것은 포커스 격리다 — `stopPropagation()` 이 아니다
 * ──────────────────────────────────────────────────────────────────────
 *
 * ↑↓ 는 에디터의 블록 선택 이동에, Enter 는 블록 분할에 걸려 있다(`keymap.ts`).
 * 결과를 고르는 Enter 가 본문을 쪼개면 안 된다.
 *
 * 처음에는 슬래시 메뉴의 교훈(HANDOFF §6 — *"`window` capture 리스너의
 * `preventDefault()` 는 ProseMirror 를 막지 못한다"*)을 그대로 적용해 이 보호를
 * `stopPropagation()` 이 한다고 적었다. **반사실로 확인해 보니 틀렸다** — 그 줄을
 * 빼고 `npm run e2e` 를 돌려도 135개가 전부 통과한다.
 *
 * 진짜 이유는 이렇다: 이 오버레이는 **레이아웃에 있어 에디터 DOM 밖**이고, 열리면
 * 포커스가 오버레이의 입력창으로 간다. ProseMirror 의 `handleKeyDown` 은
 * `view.dom` 에 달린 리스너이므로, 타깃이 그 밖이면 **이벤트 경로에 `view.dom` 이
 * 아예 없다.** 슬래시 메뉴는 달랐다 — 거기서는 포커스가 에디터에 남아 있었다.
 *
 * `stopPropagation()` 은 남겼다. `window` 에 keydown 리스너를 다는 컴포넌트가
 * 이미 여럿이고(사이드바 · 블록 거터 · 공유 패널), 그중 하나가 Enter 나 화살표를
 * 집는 순간 load-bearing 이 된다. 다만 **증명하지 못한 것을 증명한 것처럼 적지
 * 않는다**(§5).
 *
 * **IME 조합 중에는 가로채지 않는다.** 조합 중의 Enter 는 한글 후보 확정이다.
 * 가로채면 한국어로 검색할 수가 없다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { splitHighlight } from '@/lib/search/highlight'

/** 사이드바 버튼처럼 오버레이 밖에서 여는 경로. */
const OPEN_EVENT = 'nc:open-search'

/**
 * 오버레이를 연다.
 *
 * 모듈 스토어를 두지 않고 DOM 이벤트로 알린다 — 여는 쪽(사이드바)과 그리는 쪽
 * (레이아웃)이 서로를 모르는 것이 이 한 기능에는 충분하고, 상태를 둘로 두지 않는다.
 */
export function openSearchOverlay(): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

export type SearchHitRow = {
  pageId: string
  title: string
  snippet: string
  breadcrumb: { id: string; title: string }[]
  lastEditedAt: string
  titleHit: boolean
}

export type RecentRow = { id: string; title: string }

const UNTITLED = '제목 없음'

/**
 * 입력이 멈춘 뒤 질의까지의 시간.
 *
 * F-07-01 의 권고가 200~300ms 다. 짧은 쪽을 고른다 — 한국어는 한 글자가 곧
 * 유효한 쿼리라(CJK 1자) 기다림이 영문보다 빨리 체감된다.
 */
const DEBOUNCE_MS = 200

/**
 * 질의의 결과.
 *
 * **"이동 모드(최근 방문)"가 이 합집합에 없다.** 그것은 저장할 상태가 아니라
 * `query` 가 비었다는 사실의 **파생**이다. 저장하면 "질의 결과"와 "입력이
 * 비었는가"라는 두 진실이 생기고, 둘을 맞추려면 입력이 바뀔 때마다 effect 안에서
 * 동기 setState 를 해야 한다 — lint 가 막는 연쇄 렌더가 정확히 그것이다.
 *
 * 그래서 이 값은 **비동기 응답에서만** 바뀐다.
 */
type QueryResult =
  | { kind: 'loading' }
  | { kind: 'results'; rows: SearchHitRow[] }
  | { kind: 'too_short'; minLength: number }
  | { kind: 'error' }

/** 화면이 실제로 그리는 상태. `query` 와 `result` 에서 파생된다. */
type Mode = { kind: 'recent' } | QueryResult

export function SearchOverlay({
  workspaceId,
  recent,
}: {
  workspaceId: string
  /** 빈 상태(F-07-04). 서버가 권한으로 걸러서 준다. */
  recent: RecentRow[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [index, setIndex] = useState(0)

  const searching = query.trim() !== ''
  /**
   * 입력이 비면 **무조건** 이동 모드다 — 낡은 `result` 를 보지 않는다.
   * 지우고 있는 중에 앞 글자의 결과가 잠깐 비치는 일이 없다.
   */
  const mode: Mode = !searching ? { kind: 'recent' } : (result ?? { kind: 'loading' })

  const inputRef = useRef<HTMLInputElement>(null)
  /** 열기 전에 포커스를 갖고 있던 요소. Esc 로 닫으면 여기로 돌려준다(F-07-01). */
  const returnFocusRef = useRef<Element | null>(null)

  /**
   * 화면에 보이는 줄. 이동 모드면 최근 방문, 검색 모드면 결과.
   *
   * `mode` 에서 파생하지 않는다 — `mode` 는 매 렌더 새 객체라 의존성으로 두면
   * 메모가 매번 깨진다. 실제 입력인 `searching` · `result` · `recent` 를 본다.
   */
  const rows = useMemo((): SearchHitRow[] => {
    if (!searching) {
      return recent.map((r) => ({
        pageId: r.id,
        title: r.title,
        snippet: '',
        breadcrumb: [],
        lastEditedAt: '',
        titleHit: false,
      }))
    }
    return result?.kind === 'results' ? result.rows : []
  }, [searching, result, recent])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setResult(null)
    setIndex(0)
    // 원래 자리로 포커스를 돌려준다. ProseMirror 는 선택을 기억하므로
    // `view.dom` 에 포커스를 주면 캐럿이 있던 자리로 돌아온다.
    const back = returnFocusRef.current
    returnFocusRef.current = null
    if (back instanceof HTMLElement) back.focus()
  }, [])

  const openNow = useCallback(() => {
    setOpen((wasOpen) => {
      // 이미 열려 있으면 포커스를 빼앗지 않는다 — 두 번 누른 것이다.
      if (!wasOpen) returnFocusRef.current = document.activeElement
      return true
    })
  }, [])

  // ── 여는 단축키 ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key !== 'k' && key !== 'p') return

      // ★ `cmd+K` 는 **선택이 있으면** 링크 편집이다(F-07-01). 그때는 비켜준다.
      //   `cmd+P` 에는 그 충돌이 없다.
      if (key === 'k') {
        const selection = window.getSelection()
        const hasSelection = selection !== null && !selection.isCollapsed && selection.toString() !== ''
        if (hasSelection) return
      }

      // `cmd+P` 는 브라우저 인쇄를, `cmd+K` 는 일부 브라우저의 검색창을 연다.
      event.preventDefault()
      // 에디터의 keymap 까지 가면 안 된다(§6 — preventDefault 로는 못 막는다).
      event.stopPropagation()
      openNow()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [openNow])

  // 사이드바 버튼 등 밖에서 여는 경로.
  useEffect(() => {
    const onOpen = () => openNow()
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [openNow])

  // 열리면 입력창으로 포커스를 옮긴다.
  //
  // **이것이 에디터를 지키는 메커니즘이다**(머리말 참조). 반사실로 확인했다 —
  // 이 한 줄을 끄면 `npm run e2e` 에서 8개가 실패한다. 타이핑이 본문으로 들어가고
  // (오버레이 입력창이 아니라), Enter 가 엉뚱한 페이지를 열고, 결과가 안 바뀐다.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // ── 질의 (debounce + 이전 요청 취소) ────────────────────────────────
  useEffect(() => {
    const q = query.trim()
    // 입력이 비었으면 아무것도 하지 않는다. **여기서 setState 를 하지 않는 것이
    // 중요하다** — 이동 모드는 파생이므로 쓸 상태가 없다.
    if (!open || q === '') return

    // ★ 이전 요청을 취소한다. F-07-01 이 L 난이도의 근거로 든 것이 이
    //   "요청 취소·경쟁 조건"이다 — 취소하지 않으면 늦게 도착한 옛 응답이
    //   새 응답을 덮어써서, 타이핑을 멈춘 순간 결과가 한 글자 전으로 돌아간다.
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const url = `/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}`
      void fetch(url, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) {
            setResult({ kind: 'error' })
            return
          }
          const data = (await res.json()) as {
            tooShort?: boolean
            minLength?: number
            results?: SearchHitRow[]
          }
          setResult(
            data.tooShort
              ? { kind: 'too_short', minLength: data.minLength ?? 2 }
              : { kind: 'results', rows: data.results ?? [] },
          )
          setIndex(0)
        })
        .catch((error: unknown) => {
          // 취소는 오류가 아니다. 이것을 구분하지 않으면 타이핑하는 동안
          // 오류 메시지가 계속 깜빡인다.
          if (error instanceof DOMException && error.name === 'AbortError') return
          setResult({ kind: 'error' })
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, query, workspaceId])

  // ── 열려 있는 동안의 키 ─────────────────────────────────────────────
  const openRow = useCallback(
    (pageId: string) => {
      // 닫기가 포커스를 되돌리므로 이동보다 먼저 부른다 — 순서를 바꾸면
      // 새 페이지가 마운트된 뒤에 옛 요소로 포커스를 주려다 아무 일도 안 된다.
      close()
      router.push(`/w/${workspaceId}/${pageId}`)
    },
    [close, router, workspaceId],
  )

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      // IME 조합 중의 Enter 는 한글 후보 확정이다. 가로채면 한국어로 검색할 수 없다.
      if (event.isComposing) return
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return

      // 에디터·사이드바의 window 리스너까지 내려보내지 않는다. `preventDefault()`
      // 로는 막을 수 없다(§6) — 그건 브라우저 기본 동작만 막는다.
      //
      // ⚠ **이 줄이 지금 에디터를 지키고 있는 것은 아니다.** 반사실로 확인했다:
      //   빼고 `npm run e2e` 를 돌려도 135개가 전부 통과한다. 에디터가 안전한
      //   진짜 이유는 **포커스 격리**다 — 오버레이가 열리면 포커스가 이 입력창으로
      //   가고, ProseMirror 의 `handleKeyDown` 은 `view.dom` 의 리스너이므로
      //   이벤트 경로에 `view.dom` 이 아예 없다. (슬래시 메뉴(#27)는 달랐다.
      //   거기서는 포커스가 에디터에 남아 있어서 타깃이 `view.dom` 안이었다.)
      //
      //   그래도 남겨 두는 이유: `window` 에 keydown 리스너를 다는 컴포넌트가
      //   이미 여럿이다(사이드바 · 블록 거터 · 공유 패널). 그중 하나가 Enter 나
      //   화살표를 집는 순간 이 줄이 load-bearing 이 된다.
      event.stopPropagation()

      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (rows.length === 0) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setIndex((i) => (i + 1) % rows.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setIndex((i) => (i - 1 + rows.length) % rows.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const row = rows[Math.min(index, rows.length - 1)]
        if (row) openRow(row.pageId)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, rows, index, close, openRow])

  if (!open) return null

  return (
    <div
      // 배경을 누르면 닫는다. 키보드 사용자에게는 Esc 가 같은 일을 하므로
      // 이 div 자체는 포커스 대상이 아니다.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[10vh]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="검색"
        data-testid="search-overlay"
        className="flex max-h-[70vh] w-[92vw] max-w-xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-neutral-900"
      >
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="페이지 검색 또는 이동"
          aria-label="검색어"
          data-testid="search-input"
          // 브라우저의 자동완성 드롭다운이 결과 목록을 가린다.
          autoComplete="off"
          className="w-full flex-none border-b border-neutral-200 bg-transparent px-4 py-3 text-base outline-none dark:border-neutral-700"
        />

        <div className="min-h-0 flex-1 overflow-auto" data-testid="search-results">
          {!searching && rows.length > 0 && (
            <p className="px-4 pt-3 text-xs font-medium text-neutral-400">최근 방문</p>
          )}

          {rows.length > 0 && (
            <ul role="listbox" aria-label={searching ? '검색 결과' : '최근 방문'}>
              {rows.map((row, i) => (
                <li key={row.pageId}>
                  <a
                    href={`/w/${workspaceId}/${row.pageId}`}
                    role="option"
                    aria-selected={i === index}
                    data-testid="search-hit"
                    data-page-id={row.pageId}
                    // 마우스가 지나가면 선택을 옮긴다 — 키보드 선택과 마우스
                    // 호버가 따로 보이면 Enter 가 어디로 갈지 알 수 없다.
                    onMouseEnter={() => setIndex(i)}
                    onClick={(event) => {
                      // `cmd+click`(새 탭)은 브라우저에게 맡긴다(F-07-01).
                      if (event.metaKey || event.ctrlKey || event.shiftKey) return
                      event.preventDefault()
                      openRow(row.pageId)
                    }}
                    className={`block px-4 py-2 ${
                      i === index ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                    }`}
                  >
                    <span className="block truncate text-sm">
                      <Highlighted text={row.title || UNTITLED} query={searching ? query : ''} />
                    </span>

                    {row.breadcrumb.length > 0 && (
                      <span className="mt-0.5 block truncate text-xs text-neutral-400">
                        {row.breadcrumb.map((b) => b.title || UNTITLED).join(' / ')}
                      </span>
                    )}

                    {row.snippet !== '' && (
                      <span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">
                        <Highlighted text={row.snippet} query={query} />
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}

          {mode.kind === 'loading' && rows.length === 0 && (
            <p className="px-4 py-6 text-sm text-neutral-400">찾는 중…</p>
          )}

          {mode.kind === 'results' && mode.rows.length === 0 && (
            <p className="px-4 py-6 text-sm text-neutral-500" data-testid="search-empty">
              검색 결과가 없습니다.
            </p>
          )}

          {/* 짧은 쿼리는 오류가 아니다 — 타이핑하는 중이다. 무엇이 더 필요한지만 알린다. */}
          {mode.kind === 'too_short' && (
            <p className="px-4 py-6 text-sm text-neutral-400">
              {mode.minLength}자 이상 입력하세요.
            </p>
          )}

          {mode.kind === 'error' && (
            <p role="alert" className="px-4 py-6 text-sm text-red-600 dark:text-red-400">
              검색하지 못했습니다. 잠시 뒤 다시 시도하세요.
            </p>
          )}

          {mode.kind === 'recent' && rows.length === 0 && (
            <p className="px-4 py-6 text-sm text-neutral-400">
              최근 방문한 페이지가 없습니다. 검색어를 입력하세요.
            </p>
          )}
        </div>

        <p className="flex-none border-t border-neutral-200 px-4 py-2 text-xs text-neutral-400 dark:border-neutral-700">
          ↑↓ 이동 · Enter 열기 · Esc 닫기
        </p>
      </div>
    </div>
  )
}

/** 일치 구간을 `<mark>` 로 감싼다. 계산은 순수 함수가 한다(`highlight.ts`). */
function Highlighted({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => splitHighlight(text, query), [text, query])
  return (
    <>
      {parts.map((part, i) =>
        part.hit ? (
          <mark key={i} className="bg-amber-200 text-inherit dark:bg-amber-700/60">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}
