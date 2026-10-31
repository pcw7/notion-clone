'use client'

/**
 * 갤러리 — DB 심화 2f-1조각 (F-04-05 Gallery view)
 *
 * 정본: 04-database-views.md F-04-05 · 00-canonical-data-model.md §3.6 [보강] 갤러리
 *
 * 04: *"각 행을 커버 이미지가 있는 카드 그리드로 표시한다."* 카드 = 미리보기(2f-2) + 제목(아이콘) + 보이는 속성의 배지(`CardBadges` —
 * 보드와 같은 것).
 *
 * 미리보기는 레이아웃(`view.configuration.gallery` · `gallery.ts`)이 정한다 — **본문의 첫 이미지**(`page_content` · 서버가 행마다 주소를
 * 준다 · `gallery-covers.ts`) 또는 없음. 미리보기가 켜져 있으면 이미지가 없는 카드도 같은 높이의 빈 자리를 둔다 — 04 *"카드 높이는
 * 유지해야 그리드가 흔들리지 않음"*. 이미지가 깨지면(외부 URL 만료) 빈 자리로 돌린다. 카드 폭(작게 · 보통 · 크게)과 맞춤(채우기 · 전체)도
 * 레이아웃이다. 고르는 곳은 도구줄의 "카드" 패널이다.
 *
 * 행은 표와 같은 길로 읽는다(`queryRows` · 필터 · 정렬 · 검색 · "더 보기"). 하위 항목이 켜진 표면 **부모만**이다(03 F-03-18 — 행 라우트 ·
 * 서버 렌더가 `showsParentsOnly` 로 고른다). 카드를 누르면 그 행 페이지가 열린다(8f-1). 카드의 손잡이를 끌거나 제목에서 Alt+← · Alt+→
 * 로 손으로 둔 차례를 바꾼다(10n-61 · 정렬이 없을 때만 — 서버는 표와 같은 `moveViewRow`).
 *
 * "+ 새로 만들기"는 그리드 끝의 카드다(노션처럼). 만들면 그 카드의 제목을 바로 받는다 — 이름 없는 카드가 쌓이지 않게(표 · 보드와 같은
 * 규칙). 템플릿 · 기본 템플릿은 `NewRowMenu` 가 맡는다.
 *
 * 그룹 덩이(G-3a · 정본 [보강 G-3]) — `group` 이 있으면 그 그룹의 카드만: "더 보기"는 그룹 행 라우트 · "새로 만들기"는 그 그룹의 값을
 * 채운다 · 카드 끌기는 덩이 안의 차례(보드 열의 자리 · `within`) · 다른 덩이에 놓으면 그 그룹의 값이 된다(G-3b · 덩이들이 서로를 찾는
 * 자리 `group-lanes.ts` — 표의 덩이 사이 끌기와 같다). 구독은 바깥이 하나로 한다(`live` 거짓).
 */

import { rowOpenHref } from '@/lib/database/open-pages'
import Link from '@/app/link'
import { useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useRouter } from 'next/navigation'

import type { DatabaseAccess } from '@/lib/database/database'
import type { ViewAccess } from '@/lib/database/linked-access'
import type { RowJson } from '@/lib/database/http'
import type { ViewColumn } from '@/lib/database/view'
import { cellText, parseDraft, readCell, sameValue } from '@/lib/database/cell-format'
import { MAX_QUERY_PAGINATION } from '@/lib/database/limits'
import type { GalleryLayout } from '@/lib/database/gallery'
import { templateRowNote, type DefaultTemplate } from '@/lib/database/new-row'
import { PageIconView } from '../../page-icon-view'
import * as api from './table-api'
import type { RowCell } from '@/lib/database/row'
import { EDITED_OUT_OF_VIEW_NOTICE } from '@/lib/database/out-of-view'
import type { PeopleNames, RelationIcons, RelationLabels } from './cell-view'
import { CardBadges } from './card-badges'
import { NewRowMenu } from './new-row-menu'
import { SearchEmpty } from './view-search'
import { useRelationLabels } from './use-relation-labels'
import { useRollupValues } from './use-rollup-values'
import { useRowReminders } from './use-row-reminders'
import { EMPTY_ROLLUP_PAGE, type RollupPage } from '@/lib/database/rollup-functions'
import { formulaEvaluator, formulaValuesByRow, type FormulaPlan } from '@/lib/database/formula-plan'
import { usePeopleNames } from './use-people-names'
import { useAdoptServerValue, useLiveServerRefresh } from './use-table-changes'
import {
  cardDropBefore,
  cardDropMark,
  foreignCardDropBefore,
  foreignCardDropMark,
  insertRow,
  reorderRows,
  stepTarget,
  type CardBox,
} from '@/lib/database/row-drag'
import { GroupLanesContext, type GroupLane } from './group-lanes'
import { TAB_DRAG_THRESHOLD } from '@/lib/database/tab-drag'
import { Highlighted } from './search-term'

const UNTITLED = '제목 없음'

type Editing = { readonly rowId: string; readonly draft: string }

/** 카드 폭 — 그리드 칸의 최소 폭. 칸 수는 컨테이너 폭이 정한다(04 *"그리드 컬럼 수는 컨테이너 폭 기준 자동"*). */
const CARD_GRID: Readonly<Record<GalleryLayout['cover_size'], string>> = {
  small: 'grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]',
  medium: 'grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]',
  large: 'grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]',
}

/** 카드 사이의 간격(px) — 격자의 `gap-3`. 끄는 동안의 막대가 그 가운데에 선다. */
const CARD_GAP = 12

/** 표시 순서가 뒤에 오는 응답인가. 버전은 bigint 문자열이다. */
const notOlder = (incoming: string, current: string): boolean => BigInt(incoming) >= BigInt(current)

export function DatabaseGallery(props: {
  workspaceId: string
  viewId: string
  dataSourceId: string
  tableName: string
  /** 보이는 컬럼만, 뷰 순서로. 카드의 배지가 이 순서다(제목은 카드 머리라 뺀다). */
  columns: ViewColumn[]
  rows: RowJson[]
  hasMore: boolean
  nextCursor: string | null
  relationLabels: RelationLabels
  relationIcons: RelationIcons
  /** 사람 칸의 이름(6g-2) — 첫 화면의 것은 서버가 준다. */
  peopleNames?: PeopleNames
  access: DatabaseAccess
  /** 뷰 안의 일(카드의 차례 · 기본 템플릿)에 쓰는 그릇의 권한(N-2 · `linked-access.ts`) — 없으면 `access` 와 같다. */
  viewAccess?: ViewAccess
  defaultTemplate?: DefaultTemplate | null
  /** 뷰 검색어(2e-2) — "더 보기"도 같은 검색어를 싣는다. */
  search?: string | null
  /** 서버 화면이 읽기 전의 시각(ms) — 구독이 붙기 전의 변경을 메운다(#250 · `use-table-changes.ts`). */
  /** 행을 여는 주소의 바탕(8n-1 · F-02-20) — 지금 데이터베이스 화면의 주소면 피크로, null 이면 행 화면으로(전체 페이지). */
  peekBase?: string | null
  renderedAt?: number
  /** 레이아웃(2f-2) — 미리보기 · 카드 폭 · 맞춤. */
  layout: GalleryLayout
  /** 첫 페이지의 카드 미리보기(행 id → 이미지 주소). "더 보기"의 것은 응답이 함께 준다. */
  covers: Readonly<Record<string, string>>
  /** 첫 페이지의 rollup 값(10n-33 · 서버 렌더가 계산해 준다) — 카드의 배지. 그 뒤에 온 카드의 것은 `useRollupValues` 가 받는다. */
  rollupValues?: RollupPage
  /** 수식의 계획(10n-34 · 서버 렌더가 뷰의 컬럼 전부로 만든다) — 카드의 수식 배지를 그 카드의 칸으로 계산한다. */
  formulaPlan?: FormulaPlan | null
  /** 손으로 둔 차례로 서는가 — 살아 있는 정렬이 없다(10n-61). 참이면 고칠 수 있는 사람에게 카드 끌기를 연다. */
  manualOrder?: boolean
  /** 그룹 덩이(G-3a) — 그 그룹의 카드만 읽고 · "새로 만들기"는 그 그룹의 값(`cells`)을 채운다 · 끌기는 덩이 안의 차례. */
  group?: { readonly key: string; readonly cells: readonly RowCell[]; readonly accepts?: boolean } | null
  /** 표 변경을 스스로 구독하는가(기본 참) — 그룹 덩이는 바깥이 하나로 한다(G-3a ③). */
  live?: boolean
}) {
  const { workspaceId, viewId, dataSourceId, tableName, columns, access } = props
  // 뷰 안의 일(카드의 차례 · 기본 템플릿)은 그릇의 권한이다(N-2) — 소유한 소스의 뷰는 `access` 와 같다.
  const viewAccess: ViewAccess = props.viewAccess ?? access
  const router = useRouter()
  const [rows, setRows] = useState<readonly RowJson[]>(props.rows)
  const [cursor, setCursor] = useState<string | null>(props.hasMore ? props.nextCursor : null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditingState] = useState<Editing | null>(null)
  const [defaultTemplate, setDefaultTemplate] = useState<DefaultTemplate | null>(props.defaultTemplate ?? null)
  /** 보낼 카드 옮기기의 줄(10n-61) — 보내는 동안은 서버 렌더를 받아들이지 않는다(옛 차례로 튀지 않게). */
  const moveChain = useRef<Promise<void>>(Promise.resolve())
  const [pendingMoves, setPendingMoves] = useState(0)
  const [covers, setCovers] = useState<Readonly<Record<string, string>>>(props.covers)
  /** 불러오다 깨진 이미지 — 빈 자리로 돌린다(같은 주소를 다시 묻지 않는다). */
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set())
  const markBroken = (src: string) => setBroken((current) => (current.has(src) ? current : new Set(current).add(src)))
  // 표 변경 알림(2k-3 · F-04-24) — 다른 곳에서 바뀌면 서버 렌더를 다시 부르고 첫 페이지 · 미리보기를 받아들인다. 만들기 · 편집 · 더 보기
  // 중이면 끝난 뒤에. "더 보기"로 더 읽은 카드는 첫 페이지로 돌아간다(§7).
  const galleryBusy = loadingMore || busy || editing !== null || pendingMoves > 0
  useLiveServerRefresh(workspaceId, dataSourceId, galleryBusy, props.renderedAt, props.live !== false)
  useAdoptServerValue(props.rows, galleryBusy, (next) => {
    setRows(next)
    setCursor(props.hasMore ? props.nextCursor : null)
  })
  useAdoptServerValue(props.covers, galleryBusy, setCovers)
  const { layout } = props
  const showCover = layout.cover !== 'none'
  const editingRef = useRef<Editing | null>(null)
  const setEditing = (next: Editing | null) => {
    editingRef.current = next
    setEditingState(next)
  }
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing !== null) titleInputRef.current?.focus()
  }, [editing?.rowId]) // eslint-disable-line react-hooks/exhaustive-deps -- 새 카드가 설 때만 포커스를 준다

  const titleColumn = columns.find((c) => c.type === 'title') ?? null
  const badgeColumns = columns.filter((c) => c.type !== 'title')
  const { labels, icons: relationIcons } = useRelationLabels(workspaceId, props.relationLabels, props.relationIcons, rows, columns)
  // 사람 칸의 이름(6g-2) — 카드의 배지
  const { names: peopleNames } = usePeopleNames(workspaceId, props.peopleNames ?? {}, rows, columns)
  // rollup 칸의 값(10n-33) — 카드의 배지. 신호로 서버 렌더를 다시 부르면 다시 계산된 것을 받아들인다(카드와 같은 때)
  const serverRollups = props.rollupValues ?? EMPTY_ROLLUP_PAGE
  const { page: rollups, adopt: adoptRollups } = useRollupValues(workspaceId, dataSourceId, serverRollups, rows, columns)
  // 카드의 날짜 종(10n-76) — 서버가 다시 그릴 때마다(`renderedAt`) 다시 읽는다
  const [reminders] = useRowReminders(workspaceId, dataSourceId, rows, columns.some((c) => c.type === 'date'), props.renderedAt)
  useAdoptServerValue(serverRollups, galleryBusy, adoptRollups)
  // 수식 칸의 값(10n-34) — 카드의 배지. 그 카드의 칸으로 여기서 계산한다(표와 같은 함수)
  const formulas = useMemo(() => (props.formulaPlan ? formulaEvaluator(props.formulaPlan) : null), [props.formulaPlan])
  const formulaValues = useMemo(() => formulaValuesByRow(formulas, rows, columns), [formulas, rows, columns])

  /** 서버가 준 행으로 갈아 끼운다. 늦게 온(버전이 낮은) 응답은 버린다. */
  const takeRow = (row: RowJson) =>
    setRows((current) => current.map((r) => (r.id === row.id && notOlder(row.version, r.version) ? row : r)))

  // F-03-17: 누적 10,000건 상한. 여기서 멈춘다(표와 같다).
  const reachedCap = rows.length >= MAX_QUERY_PAGINATION

  const loadMore = async () => {
    if (cursor === null || loadingMore || reachedCap) return
    setLoadingMore(true)
    setError(null)
    // 그룹 덩이(G-3a)면 그 그룹의 다음 페이지 — 그룹별 커서(F-04-15)
    const result = props.group
      ? await api.loadGroupRows(workspaceId, viewId, props.group.key, cursor, props.search)
      : await api.loadRows(workspaceId, viewId, cursor, undefined, props.search)
    setLoadingMore(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setRows((current) => {
      // 그사이 "+ 새로 만들기"로 붙인 행이 다음 페이지에 또 올 수 있다.
      const seen = new Set(current.map((r) => r.id))
      return [...current, ...result.value.rows.filter((r) => !seen.has(r.id))]
    })
    setCursor(result.value.hasMore ? result.value.nextCursor : null)
    if (result.value.covers) {
      const more = result.value.covers
      setCovers((current) => ({ ...current, ...more }))
    }
  }

  /** `templateId` 가 `null` 이면 빈 카드다. */
  const addCard = async (templateId: string | null) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    // 그룹 덩이(G-3a)면 그 그룹의 값을 채운다 — 템플릿의 값을 덮는다(표의 그룹과 같다)
    const result = await api.createRowFrom(workspaceId, viewId, { templateId, cells: props.group ? [...props.group.cells] : [] })
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const { row } = result.value
    setRows((current) => [...current, row])
    setNotice(templateRowNote(result.value.skippedPages, result.value.skippedLinks))
    // ★ 초안은 그 카드의 **지금 제목**이다 — 템플릿이 준 제목을 빈 글자로 덮지 않는다(표 · 보드와 같은 이유).
    if (access.canEditContent && titleColumn !== null) {
      setEditing({ rowId: row.id, draft: cellText(readCell('title', row.properties[titleColumn.propertyId])) })
    }
  }

  const commitTitle = async () => {
    const e = editingRef.current
    if (e === null || titleColumn === null) return
    // Enter 와 blur 가 같은 편집을 두 번 저장하지 않게 먼저 닫는다.
    setEditing(null)
    const row = rows.find((r) => r.id === e.rowId)
    if (row === undefined) return
    const previous = readCell('title', row.properties[titleColumn.propertyId])
    const parsed = parseDraft('title', e.draft, previous)
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }
    if (sameValue(previous, parsed.value)) return
    const withValue = (r: RowJson, value: typeof parsed.value): RowJson => ({
      ...r,
      title: cellText(value),
      properties: { ...r.properties, [titleColumn.propertyId]: value },
    })
    setRows((current) => current.map((r) => (r.id === e.rowId ? withValue(r, parsed.value) : r)))
    // 뷰를 실어 보낸다 — 고친 카드가 조건 밖이면 곧 빠지므로 그 까닭을 말한다(10n-16)
    const result = await api.updateCellInView(workspaceId, e.rowId, titleColumn.propertyId, parsed.value, { id: viewId, search: props.search ?? null })
    if (!result.ok) {
      setRows((current) => current.map((r) => (r.id === e.rowId ? withValue(r, previous) : r)))
      setError(result.message)
      return
    }
    takeRow(result.value.row)
    if (result.value.inView === false) setNotice(EDITED_OUT_OF_VIEW_NOTICE)
  }

  const onTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitTitle()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setEditing(null)
    }
  }

  // ── 카드 끌기(10n-61 · F-04-01 · HANDOFF §3.2-297) ─────────────────
  /** 손으로 둔 차례를 바꿀 수 있는가 — 고칠 수 있고 정렬이 없다(서버 렌더가 `manualOrder` 로 준다 · 서버도 `sorted` 로 거부). */
  const canReorder = viewAccess.canEditContent && props.manualOrder === true
  const gridRef = useRef<HTMLUListElement>(null)
  /** 잡은 카드 · 잡은 자리 · 끌기가 시작됐는가 · 지금 표시를 그리게 한 다른 덩이(G-3b — 떠나면 그 표시를 지운다). */
  const cardGrab = useRef<{ id: string; x: number; y: number; active: boolean; lane: GroupLane | null } | null>(null)
  /** 그룹 덩이들이 서로를 찾는 자리(G-3b) — 그룹 화면 밖이면 null. */
  const lanes = useContext(GroupLanesContext)
  /** 다른 덩이에서 끌어 오는 카드가 놓일 세로 막대(G-3b) — 격자의 왼쪽 위에서 잰 자리. */
  const [laneMark, setLaneMark] = useState<{ x: number; top: number; height: number } | null>(null)
  const [draggingCard, setDraggingCard] = useState<string | null>(null)
  /** 놓일 자리의 세로 막대 — 격자의 왼쪽 위에서 잰 자리. */
  const [cardMark, setCardMark] = useState<{ x: number; top: number; height: number } | null>(null)
  const cardBoxes = (): CardBox[] =>
    [...(gridRef.current?.querySelectorAll<HTMLElement>('[data-testid="db-gallery-card"]') ?? [])].map((el) => {
      const r = el.getBoundingClientRect()
      return { id: el.dataset.rowId ?? '', left: r.left, top: r.top, width: r.width, height: r.height }
    })
  /** 이 카드를 `before` 앞에 — 화면을 먼저 그 차례로 그리고 요청은 줄 세워 차례로(표 10n-60 과 같다). 거절되면 까닭을 말하고 서버 렌더를 다시 부른다. */
  const moveCardTo = (rowId: string, before: string | null) => {
    setRows((current) => reorderRows(current, rowId, before))
    setPendingMoves((n) => n + 1)
    const group = props.group
    moveChain.current = moveChain.current.then(async () => {
      // 그룹 덩이면 덩이 안의 차례 — 보드 열의 자리 · 셀은 쓰지 않는다(`within` · G-3a ④)
      const result = group
        ? await api.moveCard(workspaceId, viewId, { rowId, groupKey: group.key, beforeRowId: before, search: props.search ?? null, within: true })
        : await api.moveTableRow(workspaceId, viewId, rowId, before)
      setPendingMoves((n) => n - 1)
      if (!result.ok) {
        setError(result.message)
        router.refresh()
      }
    })
  }
  /**
   * 다른 덩이로(G-3b · 정본 [보강 G-3] ⑤) — 그 그룹의 값이 된다(`within` 없이 · 표의 덩이 사이 끌기와 같다). 이 덩이에서 먼저 빼고, 서버의
   * 답(새 값의 카드)을 그 덩이가 받는다. 거절되면 까닭을 말하고 서버 렌더를 다시 부른다(덩이들이 제 첫 페이지를 받아들인다).
   */
  const moveCardToLane = (rowId: string, key: string, lane: GroupLane, before: string | null) => {
    if (!rows.some((r) => r.id === rowId)) return
    setRows((current) => current.filter((r) => r.id !== rowId))
    setPendingMoves((n) => n + 1)
    moveChain.current = moveChain.current.then(async () => {
      const result = await api.moveCard(workspaceId, viewId, { rowId, groupKey: key, beforeRowId: before, search: props.search ?? null })
      setPendingMoves((n) => n - 1)
      if (!result.ok) {
        setError(result.message)
        lane.reload()
        return
      }
      lane.receive(result.value.row, before, result.value.inView)
    })
  }
  const onGripPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, rowId: string) => {
    if (!canReorder || event.button !== 0) return
    event.preventDefault()
    cardGrab.current = { id: rowId, x: event.clientX, y: event.clientY, active: false, lane: null }
  }
  useEffect(() => {
    if (!canReorder) return
    const onPointerMove = (event: PointerEvent) => {
      const g = cardGrab.current
      if (g === null) return
      if (!g.active && Math.hypot(event.clientX - g.x, event.clientY - g.y) <= TAB_DRAG_THRESHOLD) return
      if (!g.active) {
        g.active = true
        setDraggingCard(g.id)
      }
      // 다른 덩이 위면(G-3b) 그 덩이가 제 막대를 그린다 — 이 덩이의 막대는 지운다
      const foreign = lanes !== null && props.group ? lanes.laneAt(event.clientY, props.group.key) : null
      if (g.lane !== null && g.lane !== foreign?.lane) g.lane.preview(null)
      g.lane = foreign?.lane ?? null
      if (foreign !== null) {
        setCardMark(null)
        foreign.lane.preview({ x: event.clientX, y: event.clientY })
        return
      }
      const mark = cardDropMark(cardBoxes(), g.id, event.clientX, event.clientY, cursor !== null, CARD_GAP)
      const origin = gridRef.current?.getBoundingClientRect()
      setCardMark(mark === null || origin === undefined ? null : { x: mark.x - origin.left, top: mark.top - origin.top, height: mark.height })
    }
    const onPointerUp = (event: PointerEvent) => {
      const g = cardGrab.current
      cardGrab.current = null
      if (g === null || !g.active) return
      setDraggingCard(null)
      setCardMark(null)
      g.lane?.preview(null)
      const foreign = lanes !== null && props.group ? lanes.laneAt(event.clientY, props.group.key) : null
      if (foreign !== null) {
        const into = foreign.lane.dropAt({ x: event.clientX, y: event.clientY })
        if (into !== undefined) moveCardToLane(g.id, foreign.key, foreign.lane, into)
        return
      }
      const before = cardDropBefore(cardBoxes(), g.id, event.clientX, event.clientY, cursor !== null)
      if (before !== undefined) moveCardTo(g.id, before)
    }
    const onPointerCancel = () => {
      cardGrab.current?.lane?.preview(null)
      cardGrab.current = null
      setDraggingCard(null)
      setCardMark(null)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  })
  // 이 덩이를 차선으로 올린다(G-3b) — 끄는 덩이가 이 격자에 막대를 그리게 하고 옮긴 카드를 넘긴다. 렌더마다 다시 올린다(지금의 카드 · 더 보기를
  // 그대로 읽게 — 표의 차선과 같다)
  useEffect(() => {
    if (lanes === null || !props.group || !canReorder) return
    // 채울 값이 없는 범주(10n-27)에는 놓지 못한다 — 막대도 서지 않는다
    const accepts = props.group.accepts !== false
    const more = cursor !== null
    return lanes.register(props.group.key, {
      bounds: () => gridRef.current?.closest<HTMLElement>('[data-testid="db-group"]')?.getBoundingClientRect() ?? null,
      dropAt: (point) => (accepts ? foreignCardDropBefore(cardBoxes(), point.x, point.y, more) : undefined),
      preview: (point) => {
        const origin = gridRef.current?.getBoundingClientRect()
        // 카드가 없으면 격자의 머리에(새 카드 칸의 높이)
        const empty = origin === undefined ? null : { x: origin.left + CARD_GAP / 2, top: origin.top, height: 96 }
        const mark = point === null || !accepts ? null : foreignCardDropMark(cardBoxes(), point.x, point.y, more, CARD_GAP, empty)
        setLaneMark(mark === null || origin === undefined ? null : { x: mark.x - origin.left, top: mark.top - origin.top, height: mark.height })
      },
      receive: (row, before, inView) => {
        setRows((current) => [...insertRow(current, row, before)])
        // 옮긴 카드가 뷰의 조건 밖이 됐다 — 곧 빠지므로 까닭을 말한다(10n-16 과 같은 말)
        if (!inView) setNotice(EDITED_OUT_OF_VIEW_NOTICE)
      },
      reload: () => router.refresh(),
    })
  })
  const dropMark = cardMark ?? laneMark

  /** 카드 제목에서 Alt+← · Alt+→ — 읽는 차례로 한 칸. 초점은 React 가 커밋 뒤에 돌려준다(10n-57). */
  const onCardKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, rowId: string) => {
    if (!canReorder || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const ids = rows.map((r) => r.id)
    const target = stepTarget(ids, ids.indexOf(rowId), event.key === 'ArrowLeft' ? 'up' : 'down', cursor !== null)
    if (target !== undefined) moveCardTo(rowId, target)
  }

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={tableName || UNTITLED}>
      <ul
        data-testid="db-gallery"
        data-card-size={layout.cover_size}
        ref={gridRef}
        aria-busy={pendingMoves > 0 || undefined}
        className={`relative grid gap-3 ${CARD_GRID[layout.cover_size]}`}
      >
        {/* 놓을 자리 — 이 덩이의 카드를 끌 때(`cardMark`) · 다른 덩이의 카드를 이리로 끌 때(`laneMark` · G-3b) */}
        {dropMark !== null && (
          <li
            aria-hidden
            data-testid="db-gallery-drop-mark"
            style={{ left: dropMark.x - 1, top: dropMark.top, height: dropMark.height }}
            className="pointer-events-none absolute z-10 w-0.5 bg-blue-500"
          />
        )}
        {rows.map((row) => (
          <li
            key={row.id}
            data-row-id={row.id}
            data-testid="db-gallery-card"
            data-dragging={draggingCard === row.id ? 'true' : undefined}
            style={draggingCard === row.id ? { opacity: 0.5 } : undefined}
            className="group relative flex min-h-24 flex-col overflow-hidden rounded-md border border-neutral-200 bg-white text-sm shadow-sm dark:border-neutral-700 dark:bg-neutral-950"
          >
            {canReorder && (
              // 끌기 손잡이(10n-61) — 마우스를 올리면 선다(터치는 늘). 글리프는 CSS(표의 손잡이와 같다). 키보드는 제목에서 Alt+← · Alt+→
              <button
                type="button"
                data-testid="db-gallery-grip"
                aria-label={`${row.title || UNTITLED} 끌어서 옮기기`}
                title="끌어서 옮기기 · 제목에서 Alt+← · Alt+→"
                tabIndex={-1}
                onPointerDown={(e) => onGripPointerDown(e, row.id)}
                className="absolute right-1 top-1 z-10 cursor-grab touch-none rounded bg-white/80 px-1 text-xs leading-none text-neutral-400 opacity-0 after:content-['⋮⋮'] hover:text-neutral-700 group-hover:opacity-100 touch:opacity-100 dark:bg-neutral-900/80 dark:hover:text-neutral-200"
              />
            )}
            {showCover && (
              <div data-testid="db-gallery-cover" className="h-32 w-full shrink-0 bg-neutral-100 dark:bg-neutral-900">
                {covers[row.id] !== undefined && !broken.has(covers[row.id]!) && (
                  // eslint-disable-next-line @next/next/no-img-element -- 우리 파일 경로(세션 인증)와 외부 URL 을 그대로 그린다. 썸네일 파이프라인은 아직이다(§7).
                  <img
                    src={covers[row.id]}
                    alt=""
                    loading="lazy"
                    data-testid="db-gallery-cover-image"
                    // 화면이 붙기(hydration) 전에 이미 깨진 이미지에는 `onError` 가 오지 않는다 — 붙는 순간 한 번 본다(`complete` 인데 폭이
                    // 0 이면 깨졌다). 서버 렌더가 `<img>` 를 내보내므로 브라우저는 스크립트보다 먼저 그것을 받는다(#219 의 전체 판이 잡았다).
                    ref={(el) => {
                      if (el !== null && el.complete && el.naturalWidth === 0) markBroken(covers[row.id]!)
                    }}
                    onError={() => markBroken(covers[row.id]!)}
                    className={`h-full w-full ${layout.cover_aspect === 'contain' ? 'object-contain' : 'object-cover'}`}
                  />
                )}
              </div>
            )}
            <div className="flex flex-col gap-1.5 p-3">
              {editing !== null && editing.rowId === row.id ? (
                <input
                  ref={titleInputRef}
                  value={editing.draft}
                  onChange={(e) => setEditing({ rowId: row.id, draft: e.target.value })}
                  onKeyDown={onTitleKeyDown}
                  onBlur={() => void commitTitle()}
                  aria-label="카드 제목"
                  data-testid="db-gallery-title-input"
                  placeholder={UNTITLED}
                  autoComplete="off"
                  className="w-full bg-transparent font-medium outline-none"
                />
              ) : (
                // 카드의 제목이 그 행 페이지로 가는 길이다(8f-1) — 아이콘을 앞에 단다(8c-3a).
                <Link
                  href={rowOpenHref(workspaceId, row.id, props.peekBase ?? null)}
                  scroll={false}
                  data-testid="db-gallery-open"
                  aria-keyshortcuts={canReorder ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined}
                  onKeyDown={(e) => onCardKeyDown(e, row.id)}
                  className={`flex min-w-0 items-start gap-1.5 font-medium hover:underline ${row.title ? 'break-words' : 'text-neutral-400'}`}
                >
                  <PageIconView icon={row.icon} fallback className="mt-[0.2em]" />
                  <span className="min-w-0" data-testid="db-gallery-card-title">
                    {row.title ? <Highlighted text={row.title} /> : UNTITLED}
                  </span>
                </Link>
              )}
              <CardBadges
                row={row}
                columns={badgeColumns}
                relationLabels={labels}
                relationIcons={relationIcons}
                peopleNames={peopleNames}
                rollups={rollups}
                formulaValues={formulaValues?.get(row.id)}
                formulaErrors={formulas?.errors}
                reminders={reminders[row.id]}
                testId="db-gallery-badge"
                button={{ workspaceId, canPress: access.canEditContent }}
              />
            </div>
          </li>
        ))}
        {access.canCreateRows && (
          <li className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-neutral-300 dark:border-neutral-700">
            <NewRowMenu
              workspaceId={workspaceId}
              viewId={viewId}
              dataSourceId={dataSourceId}
              defaultTemplate={defaultTemplate}
              canSetDefault={viewAccess.canEditStructure}
              canPickTemplate={access.canViewAllRows}
              busy={busy}
              onCreate={(templateId) => void addCard(templateId)}
              onDefaultChange={setDefaultTemplate}
              label="+ 새로 만들기"
              ariaLabel="새 카드 만들기"
              testId="db-gallery-add"
            />
          </li>
        )}
      </ul>

      {rows.length === 0 &&
        (props.search ? (
          <SearchEmpty search={props.search} />
        ) : (
          <p className="px-2 text-sm text-neutral-400" data-testid="db-empty">
            아직 행이 없습니다.
          </p>
        ))}

      {cursor !== null && !reachedCap && (
        <button
          type="button"
          data-testid="db-load-more"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          className="self-start rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {loadingMore ? '불러오는 중…' : '더 보기'}
        </button>
      )}

      {error && (
        <p role="alert" data-testid="db-error" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="db-notice" className="text-sm text-amber-700 dark:text-amber-300">
          {notice}
        </p>
      )}
    </section>
  )
}
