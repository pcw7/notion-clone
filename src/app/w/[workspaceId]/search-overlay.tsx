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

import { DEFAULT_SEARCH_SORT, SEARCH_SORTS, type SearchSort } from '@/lib/search/sort'
import {
  NO_SEARCH_FILTERS,
  SEARCH_EDITED_RANGES,
  SEARCH_ME,
  activeFilterCount,
  effectiveSearchFilters,
  narrowsWithoutQuery,
  pageIdInPath,
  searchFilterParams,
  type SearchEditedRange,
  type SearchFilters,
} from '@/lib/search/search-filters'
import { usePathname, useRouter } from 'next/navigation'

import { LEFT_USER } from '@/lib/database/cell-format'
import { splitHighlight } from '@/lib/search/highlight'
import { DATABASE_GLYPH, type PageIcon } from '@/lib/block/page-icon'
import type { PeopleNames } from './db/[databaseId]/cell-view'
import { PeopleEditor } from './db/[databaseId]/people-editor'
import { PageIconView } from './page-icon-view'

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
  /** 페이지 · 데이터베이스(10p-2) — 데이터베이스는 자기 주소로 연다(`rowHref`). 최근 방문은 페이지뿐이다. */
  kind: 'page' | 'database'
  title: string
  /** 페이지 아이콘(8c-2) — 없으면 null(기본 글리프). */
  icon: PageIcon | null
  snippet: string
  breadcrumb: { id: string; title: string }[]
  lastEditedAt: string
  titleHit: boolean
}

export type RecentRow = { id: string; title: string; icon: PageIcon | null }

/** 줄이 여는 주소 — 데이터베이스는 `/db/{id}`(페이지 주소는 데이터베이스를 받지 않는다 · 사이드바와 같은 갈림 · 10p-2). */
function rowHref(workspaceId: string, row: Pick<SearchHitRow, 'pageId' | 'kind'>): string {
  return row.kind === 'database' ? `/w/${workspaceId}/db/${row.pageId}` : `/w/${workspaceId}/${row.pageId}`
}

/** 팀스페이스 필터의 후보(10a-3b) — 내가 멤버인 보관되지 않은 팀스페이스. */
export type SearchTeamspace = { id: string; name: string }

/** 사람 필터 둘(10a-3b) — 만든 사람 · 최종 편집자. */
type PersonFilter = 'createdBy' | 'editedBy'

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
  // `fuzzy` — 오타 대체의 결과(10p-3 · 맞는 결과가 0건이라 제목의 낱말 유사도로 찾았다)
  | { kind: 'results'; rows: SearchHitRow[]; fuzzy: boolean }
  | { kind: 'too_short'; minLength: number }
  | { kind: 'error' }
  /** 요금제가 팀스페이스 필터를 허락하지 않는다(10a-3b — 화면이 연 뒤 요금제가 내려갔다). 조용히 넓히지 않고 말한다. */
  | { kind: 'plan_required' }

/** 화면이 실제로 그리는 상태. `query` 와 `result` 에서 파생된다. */
type Mode = { kind: 'recent' } | QueryResult

/** 정렬의 이름(8l-2) — F-07-02 의 `Best Matches` · `Last Edited: Newest First` … 를 우리말로. */
const SORT_LABEL: Readonly<Record<SearchSort, string>> = {
  best: '가장 잘 맞는 순',
  edited_desc: '편집 — 최신 순',
  edited_asc: '편집 — 오래된 순',
  created_desc: '만든 때 — 최신 순',
  created_asc: '만든 때 — 오래된 순',
}

/** 편집 기간 칩의 말(10a-2). */
const EDITED_LABEL: Readonly<Record<SearchEditedRange, string>> = { day: '오늘', week: '7일', month: '30일', year: '1년' }

/** 사람 필터 칩의 이름(10a-3b). */
const PERSON_FILTER_LABEL: Readonly<Record<PersonFilter, string>> = { createdBy: '만든 사람', editedBy: '최종 편집자' }

/** 팀스페이스 필터의 요금제(10a-3b · 엔타이틀먼트 `search.teamspace_filter`). */
const TEAMSPACE_PLAN_NOTE = '팀스페이스로 좁히기는 Plus · Business · Enterprise 요금제에서 씁니다.'

const CHIP = 'rounded-full border px-2 py-0.5 aria-pressed:border-blue-500 aria-pressed:bg-blue-50 aria-pressed:text-blue-700 dark:aria-pressed:bg-blue-950 dark:aria-pressed:text-blue-300'

export function SearchOverlay({
  workspaceId,
  recent,
  teamspaces,
  teamspaceFilterAllowed,
}: {
  workspaceId: string
  /** 빈 상태(F-07-04). 서버가 권한으로 걸러서 준다. */
  recent: RecentRow[]
  /** 팀스페이스 필터의 후보(10a-3b) — 사이드바와 같은 목록(`listMyTeamspaces`). */
  teamspaces: SearchTeamspace[]
  /** 요금제가 팀스페이스 필터를 허락하는가(10a-3b — 표시 전용 · 서버가 질의를 만들 때 다시 묻는다). */
  teamspaceFilterAllowed: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // 정렬(8l-2 · F-07-02) — 기본은 가장 잘 맞는 순. 오버레이를 닫았다 열어도 고른 것을 기억한다(같은 세션 동안).
  const [sort, setSort] = useState<SearchSort>(DEFAULT_SEARCH_SORT)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [index, setIndex] = useState(0)
  // 필터(10a-2 · F-07-03) — 정렬처럼 닫았다 열어도 기억한다. "이 페이지 안에서" 는 지금 페이지일 때만 효과가 있다(옮겨 가면 저절로 풀린다)
  const pathname = usePathname()
  const currentPageId = pageIdInPath(pathname)
  const [chosen, setChosen] = useState<SearchFilters>(NO_SEARCH_FILTERS)
  // 팀스페이스는 후보에 있고 요금제가 허락할 때만 효과가 있다(10a-3b — 나가거나 보관되면 저절로 풀린다)
  const teamspaceIds = useMemo(() => teamspaces.map((t) => t.id), [teamspaces])
  const filters = useMemo<SearchFilters>(
    () => effectiveSearchFilters(chosen, { currentPageId, teamspaceIds, teamspaceAllowed: teamspaceFilterAllowed }),
    [chosen, currentPageId, teamspaceIds, teamspaceFilterAllowed],
  )
  // 사람 필터의 고르개(10a-3b) — 펼친 것 하나 · 고른 사람의 이름(고른 순간에 안다 — 주소에 싣지 않으므로 다시 읽어 올 일이 없다)
  const [picker, setPicker] = useState<PersonFilter | null>(null)
  const [names, setNames] = useState<PeopleNames>({})
  const narrows = useMemo(() => narrowsWithoutQuery(filters), [filters])
  const filterQuery = useMemo(
    () =>
      searchFilterParams(filters)
        .map(([key, value]) => `&${key}=${encodeURIComponent(value)}`)
        .join(''),
    [filters],
  )

  // 찾는 중 — 검색어가 있거나, 좁히는 필터가 있다(검색어 없이 필터로만 · 정본 §3.9 [보강] 검색 필터 ③)
  const searching = query.trim() !== '' || narrows
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
        kind: 'page' as const,
        title: r.title,
        icon: r.icon,
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
    setPicker(null)
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
    // 찾는 중이 아니면(빈 입력 · 좁히는 필터 없음) 아무것도 하지 않는다. **여기서 setState 를 하지 않는 것이
    // 중요하다** — 이동 모드는 파생이므로 쓸 상태가 없다.
    if (!open || !searching) return

    // ★ 이전 요청을 취소한다. F-07-01 이 L 난이도의 근거로 든 것이 이
    //   "요청 취소·경쟁 조건"이다 — 취소하지 않으면 늦게 도착한 옛 응답이
    //   새 응답을 덮어써서, 타이핑을 멈춘 순간 결과가 한 글자 전으로 돌아간다.
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const url = `/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}&sort=${sort}${filterQuery}`
      void fetch(url, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) {
            // 팀스페이스 필터의 요금제(10a-3b) — 다른 실패와 가른다(조용히 넓히지 않고 그 까닭을 말한다)
            const body = (await res.json().catch(() => null)) as { error?: unknown } | null
            setResult(res.status === 403 && body?.error === 'plan_required' ? { kind: 'plan_required' } : { kind: 'error' })
            return
          }
          const data = (await res.json()) as {
            tooShort?: boolean
            minLength?: number
            results?: SearchHitRow[]
            fuzzy?: boolean
          }
          setResult(
            data.tooShort
              ? { kind: 'too_short', minLength: data.minLength ?? 2 }
              : { kind: 'results', rows: data.results ?? [], fuzzy: data.fuzzy === true },
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
  }, [open, query, sort, workspaceId, searching, filterQuery])

  // ── 열려 있는 동안의 키 ─────────────────────────────────────────────
  const openRow = useCallback(
    (row: SearchHitRow) => {
      // 닫기가 포커스를 되돌리므로 이동보다 먼저 부른다 — 순서를 바꾸면
      // 새 페이지가 마운트된 뒤에 옛 요소로 포커스를 주려다 아무 일도 안 된다.
      close()
      router.push(rowHref(workspaceId, row))
    },
    [close, router, workspaceId],
  )

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      // IME 조합 중의 Enter 는 한글 후보 확정이다. 가로채면 한국어로 검색할 수 없다.
      if (event.isComposing) return
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return

      // 사람 고르개가 펼쳐져 있으면(10a-3b) ↑↓ · Enter 는 고르개의 것이다 — 여기(window 의 capture)서 멈추면 고르개의 입력까지 가지 않는다.
      // Esc 는 고르개만 닫는다(덮개는 그대로).
      if (picker !== null) {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setPicker(null)
          inputRef.current?.focus()
        }
        return
      }

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
        if (row) openRow(row)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, rows, index, close, openRow, picker])

  if (!open) return null

  /** 사람 필터 값의 이름 — 나 · 고른 사람(모르면 떠난 사용자). */
  const personName = (value: string): string => (value === SEARCH_ME ? '나' : Object.hasOwn(names, value) ? names[value]! : LEFT_USER)

  /** 사람 필터를 고른다(10a-3b) — 한 사람 · 고르개를 닫고 입력으로 돌아간다. */
  const pickPerson = (which: PersonFilter, value: string | null) => {
    setChosen((f) => ({ ...f, [which]: value }))
    setPicker(null)
    inputRef.current?.focus()
  }

  /** 사람 필터 칩 — 누르면 고르개를 펼치고 접는다. 포커스를 옮기지 않는다(고르개의 입력이 받는다 · 접힘은 그 입력이 포커스를 잃을 때). */
  const personChip = (which: PersonFilter, testId: string) => {
    const value = filters[which]
    return (
      <button
        type="button"
        aria-pressed={value !== null}
        aria-expanded={picker === which}
        data-testid={testId}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setPicker((p) => (p === which ? null : which))}
        className={CHIP}
      >
        {PERSON_FILTER_LABEL[which]}
        {value !== null && `: ${personName(value)}`} ▾
      </button>
    )
  }

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
        {/* 필터(10a-2 · F-07-03) — 입력 아래에 늘 선다(치기 전에도 고른다) · 누르면 입력으로 돌아간다 */}
        <div data-testid="search-filters" className="flex flex-none flex-wrap items-center gap-1 border-b border-neutral-100 px-4 py-1.5 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">
          <button
            type="button"
            aria-pressed={filters.titleOnly}
            data-testid="search-filter-title"
            onClick={() => {
              setChosen((f) => ({ ...f, titleOnly: !f.titleOnly }))
              inputRef.current?.focus()
            }}
            className={CHIP}
          >
            제목만
          </button>
          <button
            type="button"
            aria-pressed={filters.createdBy === 'me'}
            data-testid="search-filter-mine"
            onClick={() => {
              setChosen((f) => ({ ...f, createdBy: f.createdBy === 'me' ? null : 'me' }))
              inputRef.current?.focus()
            }}
            className={CHIP}
          >
            내가 만든
          </button>
          {personChip('createdBy', 'search-filter-creator')}
          {personChip('editedBy', 'search-filter-editor')}
          <select
            aria-label="편집 기간"
            data-testid="search-filter-edited"
            value={filters.edited ?? ''}
            onChange={(event) => {
              const value = event.target.value
              setChosen((f) => ({ ...f, edited: (SEARCH_EDITED_RANGES as readonly string[]).includes(value) ? (value as SearchEditedRange) : null }))
              inputRef.current?.focus()
            }}
            className="rounded-full border border-neutral-200 bg-transparent px-1.5 py-0.5 dark:border-neutral-700"
          >
            <option value="">편집 — 언제든</option>
            {SEARCH_EDITED_RANGES.map((range) => (
              <option key={range} value={range}>
                편집 — {EDITED_LABEL[range]}
              </option>
            ))}
          </select>
          {/* 팀스페이스(10a-3b) — 내가 멤버인 것 · 요금제가 허락하지 않으면 고르개 대신 그 까닭 */}
          {teamspaces.length > 0 &&
            (teamspaceFilterAllowed ? (
              <select
                aria-label="팀스페이스"
                data-testid="search-filter-teamspace"
                value={filters.teamspace ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  setChosen((f) => ({ ...f, teamspace: value === '' ? null : value }))
                  inputRef.current?.focus()
                }}
                className="max-w-[10rem] rounded-full border border-neutral-200 bg-transparent px-1.5 py-0.5 dark:border-neutral-700"
              >
                <option value="">팀스페이스 — 전체</option>
                {teamspaces.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              <span data-testid="search-filter-teamspace-locked" title={TEAMSPACE_PLAN_NOTE} className="rounded-full border border-dashed border-neutral-200 px-2 py-0.5 text-neutral-400 dark:border-neutral-700">
                팀스페이스 🔒
              </span>
            ))}
          {currentPageId !== null && (
            <button
              type="button"
              aria-pressed={filters.within !== null}
              data-testid="search-filter-within"
              onClick={() => {
                setChosen((f) => ({ ...f, within: f.within === currentPageId ? null : currentPageId }))
                inputRef.current?.focus()
              }}
              className={CHIP}
            >
              이 페이지 안에서
            </button>
          )}
          {activeFilterCount(filters) > 0 && (
            <button
              type="button"
              data-testid="search-filter-clear"
              onClick={() => {
                setChosen(NO_SEARCH_FILTERS)
                inputRef.current?.focus()
              }}
              className="ml-auto text-neutral-400 hover:text-neutral-600"
            >
              필터 풀기
            </button>
          )}
        </div>
        {/* 사람 고르개(10a-3b) — 칩 줄 아래 제자리에(떠 있으면 대화상자가 자른다). 표의 사람 칸과 같은 고르개 · 맨 위 "나" */}
        {picker !== null && (
          <div
            data-testid="search-filter-person"
            data-filter={picker}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPicker(null)
            }}
            className="flex-none border-b border-neutral-100 px-4 py-1.5 dark:border-neutral-800"
          >
            <PeopleEditor
              // 다른 사람 필터로 바꾸면 새로 — 찾던 말을 넘기지 않고 입력이 포커스를 받는다
              key={picker}
              inline
              workspaceId={workspaceId}
              current={filters[picker] === null || filters[picker] === SEARCH_ME ? [] : [filters[picker]!]}
              names={names}
              leading={
                <button
                  type="button"
                  data-testid="search-filter-person-me"
                  data-picked={filters[picker] === SEARCH_ME || undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickPerson(picker, filters[picker] === SEARCH_ME ? null : SEARCH_ME)}
                  className="mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <span className="w-3 text-xs text-blue-600" aria-hidden>
                    {filters[picker] === SEARCH_ME ? '✓' : ''}
                  </span>
                  <span className="flex-1">나</span>
                </button>
              }
              onChange={(ids, known) => {
                setNames((n) => ({ ...n, ...known }))
                // 한 사람 — 새로 든 사람이 값이다. 고른 사람을 다시 고르면 푼다
                const current = filters[picker]
                pickPerson(picker, ids.find((id) => id !== current) ?? null)
              }}
            />
          </div>
        )}
        {/* 정렬(8l-2) — 찾는 동안만 뜻이 있다(빈 입력은 최근 방문). F-07-02 의 다섯 그대로. */}
        {searching && (
          <label className="flex flex-none items-center gap-2 border-b border-neutral-100 px-4 py-1 text-xs text-neutral-500 dark:border-neutral-800">
            정렬
            <select
              data-testid="search-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as SearchSort)}
              className="rounded border border-neutral-200 bg-transparent px-1 py-0.5 dark:border-neutral-700"
            >
              {SEARCH_SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="min-h-0 flex-1 overflow-auto" data-testid="search-results">
          {!searching && rows.length > 0 && (
            <p className="px-4 pt-3 text-xs font-medium text-neutral-400">최근 방문</p>
          )}

          {/* 오타 대체(10p-3 · 정본 §3.9 [보강] 검색 오타 대체 ⑤) — 맞는 결과가 아니라는 것을 먼저 말한다 */}
          {mode.kind === 'results' && mode.fuzzy && rows.length > 0 && (
            <p className="px-4 pt-3 text-xs text-neutral-500 dark:text-neutral-400" data-testid="search-fuzzy">
              일치하는 결과가 없어 비슷한 제목을 보여 줍니다.
            </p>
          )}

          {rows.length > 0 && (
            <ul role="listbox" aria-label={searching ? '검색 결과' : '최근 방문'}>
              {rows.map((row, i) => (
                <li key={row.pageId}>
                  <a
                    href={rowHref(workspaceId, row)}
                    role="option"
                    aria-selected={i === index}
                    data-testid="search-hit"
                    data-page-id={row.pageId}
                    data-kind={row.kind}
                    // 마우스가 지나가면 선택을 옮긴다 — 키보드 선택과 마우스
                    // 호버가 따로 보이면 Enter 가 어디로 갈지 알 수 없다.
                    onMouseEnter={() => setIndex(i)}
                    onClick={(event) => {
                      // `cmd+click`(새 탭)은 브라우저에게 맡긴다(F-07-01).
                      if (event.metaKey || event.ctrlKey || event.shiftKey) return
                      event.preventDefault()
                      openRow(row)
                    }}
                    className={`block px-4 py-2 ${
                      i === index ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                    }`}
                  >
                    <span className="block truncate text-sm">
                      <PageIconView
                        icon={row.icon}
                        fallback
                        glyph={row.kind === 'database' ? DATABASE_GLYPH : undefined}
                        className="mr-1.5 align-[-0.125em]"
                      />
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
              {/* 어떤 필터가 줄였는지(07 엣지) — 위의 "필터 풀기" 로 넓힌다 */}
              {activeFilterCount(filters) > 0 && ` 필터 ${activeFilterCount(filters)}개가 걸려 있습니다 — 위의 "필터 풀기" 로 넓혀 보세요.`}
            </p>
          )}

          {/* 짧은 쿼리는 오류가 아니다 — 타이핑하는 중이다. 무엇이 더 필요한지만 알린다. */}
          {mode.kind === 'too_short' && (
            <p className="px-4 py-6 text-sm text-neutral-400">
              {mode.minLength}자 이상 입력하세요.
            </p>
          )}

          {mode.kind === 'plan_required' && (
            <p role="alert" data-testid="search-plan-required" className="px-4 py-6 text-sm text-amber-700 dark:text-amber-400">
              {TEAMSPACE_PLAN_NOTE} 팀스페이스 필터를 풀어 보세요.
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
