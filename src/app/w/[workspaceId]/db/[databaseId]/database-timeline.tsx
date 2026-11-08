'use client'

/**
 * 타임라인 — 40번 트랙 TL-2 (F-04-07 Timeline view)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 TL-1] · [보강 TL-2]
 *
 * 날짜 속성 하나의 기간(`DateValue { start, end? }`)을 가로 막대로 그린다. 왼쪽은 행의 제목 칸(`show_table`), 오른쪽은 가로로 스크롤되는
 * 시간축 — 한 행이 한 줄이고 두 쪽의 줄 높이는 같다(`ROW_PX`). 좌표 · 눈금은 `lib/database/timeline-geometry.ts`(DOM 없이 검사)가 낸다.
 *
 * 창(서버에 묻는 기간)은 이 컴포넌트의 상태다 — 처음엔 서버 렌더가 보는 사람의 오늘 근처로 읽어 준 것이고, 이전 · 다음 · 오늘 · 줌을 누르면
 * `GET …/views/{id}/timeline` 으로 그 창을 다시 묻는다(창마다 한 번 · 스크롤로 늘이지 않는다). 창의 자리는 아무도 저장하지 않는다.
 * 줌 · 표 보이기 · 날짜 속성은 뷰의 설정이라 편집자(`edit_structure`)가 바꾸면 PATCH 로 저장하고, 볼 수만 있는 사람은 자기 화면에서만 바뀐다.
 * 다른 사람이 행을 바꾸면(표 변경 알림) 지금 창을 다시 묻는다.
 *
 * TL-3(끌기) — 행을 고칠 수 있는 사람(`canEditContent`)은 막대의 가운데를 끌어 옮기고(`dragDate` 'move') 양끝 손잡이를 끌어 늘이며('start' · 'end'),
 * 막대에 포커스를 두고 Alt+←/→(하루 옮기기) · Alt+Shift+←/→(끝 하루 줄이기 · 늘이기)를 누를 수 있다. "날짜 없음 N" 은 그 행들의 목록을 여는 단추이고
 * 항목을 시간축에 끌어 놓은 날이 시작일이 된다. 쓰는 길은 캘린더와 같은 셀 쓰기 하나(`updateCellInView`) — 먼저 옮기고 거부되면 제자리로.
 *
 * 이 화면은 지연 로드되는 조각이다(`database-timeline-lazy.tsx`) — 도구줄(늘 실리는 쪽)에는 아무것도 더하지 않는다(정본 [보강 TL-2] ⑤).
 */

import Link from '@/app/link'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import { cellDays, daysBetween } from '@/lib/database/calendar'
import { rowOpenHref } from '@/lib/database/open-pages'
import { MOVED_OUT_OF_VIEW_NOTICE } from '@/lib/database/out-of-view'
import type { RowJson } from '@/lib/database/http'
import { TIMELINE_ZOOMS, type TimelineZoom } from '@/lib/database/timeline'
import {
  DAY_PX,
  dayAtX,
  dayDeltaFromPx,
  dragDate,
  headerTicks,
  placeBar,
  shiftWindow,
  todayX,
  windowForToday,
  windowFrom,
  windowWidth,
  type DragMode,
  type TimelineWindow,
} from '@/lib/database/timeline-geometry'
import { PageIconView } from '../../page-icon-view'
import * as api from './table-api'
import { useTableChanges } from './use-table-changes'

const UNTITLED = '제목 없음'
/** 한 줄의 높이(px) · 머리의 높이(px) — 왼쪽 표와 오른쪽 시간축이 같다. */
const ROW_PX = 32
const HEAD_PX = 32
/** 왼쪽 표의 폭(px). */
const TABLE_PX = 224
/** 이보다 좁은 막대는 제목을 막대 오른쪽 바깥에 적는다. */
const LABEL_INSIDE_MIN_PX = 56

const ZOOM_LABEL: Readonly<Record<TimelineZoom, string>> = { day: '일', week: '주', month: '월', quarter: '분기', year: '연' }

/** 이만큼(px) 움직여야 끌기다 — 그보다 작으면 누르기(행을 연다). 캘린더와 같다. */
const DRAG_THRESHOLD_PX = 4

const notOlder = (incoming: string, current: string): boolean => BigInt(incoming) >= BigInt(current)

type DateJson = { start: string; end?: string | null }
type DragState = { rowId: string; mode: DragMode; startX: number; startY: number; moved: boolean; delta: number; before: DateJson }

const BUTTON =
  'rounded border border-neutral-300 px-2 py-0.5 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800'

/** 보는 사람의 오늘(`YYYY-MM-DD`). 서버 렌더에서는 서버가 정한 오늘(보는 사람의 시간대 쿠키)이다. */
function useToday(serverToday: string): string {
  return useSyncExternalStore(
    () => () => {},
    () => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    },
    () => serverToday,
  )
}

type TimelineBody = { ok?: boolean; datePropertyId?: string; rows?: RowJson[]; undated?: number; truncated?: boolean; error?: string }

export function DatabaseTimeline(props: {
  workspaceId: string
  dataSourceId: string
  viewId: string
  /** 보는 사람의 오늘 — 서버가 처음 창을 정한 날. */
  today: string
  from: string
  to: string
  zoom: TimelineZoom
  showTable: boolean
  datePropertyId: string
  /** 이 표의 날짜 속성들 — 둘 이상이면 편집자가 고른다. */
  dateProperties: readonly { readonly id: string; readonly name: string }[]
  rows: RowJson[]
  undated: number
  truncated: boolean
  /** 뷰의 설정을 고칠 수 있다(`edit_structure`) — 아니면 줌 · 표 보이기는 이 화면에서만 바뀐다. */
  canEditStructure: boolean
  /** 행의 내용을 고칠 수 있다(`edit_content`) — 막대 끌기 · 키 · 날짜 없는 행 놓기(TL-3). 캘린더 카드와 같은 판정. */
  canEditContent?: boolean
  search?: string | null
  /** 행을 여는 주소의 바탕(8n-1 · F-02-20) — null 이면 행 화면으로. */
  peekBase?: string | null
  /** 서버 화면이 읽기 전의 시각(ms) — 구독이 붙기 전의 변경을 메운다(#250). */
  renderedAt?: number
}) {
  const { workspaceId, viewId, canEditStructure } = props
  const canEditContent = props.canEditContent === true
  const router = useRouter()
  const today = useToday(props.today)
  const [win, setWin] = useState<TimelineWindow>({ from: props.from, to: props.to })
  const [zoom, setZoom] = useState<TimelineZoom>(props.zoom)
  const [showTable, setShowTable] = useState(props.showTable)
  const [datePropertyId, setDatePropertyId] = useState(props.datePropertyId)
  const [rows, setRowsState] = useState<readonly RowJson[]>(props.rows)
  const [undated, setUndated] = useState(props.undated)
  const [truncated, setTruncated] = useState(props.truncated)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [live, setLive] = useState('')
  const [preview, setPreview] = useState<{ rowId: string; date: DateJson } | null>(null)
  const [dropDay, setDropDay] = useState<string | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const swallowClick = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<readonly RowJson[]>(props.rows)
  const winRef = useRef(win)
  const seq = useRef(0)

  /** 행들을 바꾼다 — 키를 빠르게 거푸 눌러도 늘 가장 새 행을 보도록 ref 도 함께 바꾼다. */
  const setRows = useCallback((next: (current: readonly RowJson[]) => readonly RowJson[]) => {
    rowsRef.current = next(rowsRef.current)
    setRowsState(rowsRef.current)
  }, [])

  /** 창을 다시 묻는다 — 늦게 온 앞 요청의 답은 버린다. */
  const load = useCallback(
    async (target: TimelineWindow) => {
      const id = ++seq.current
      setLoading(true)
      const query = new URLSearchParams({ from: target.from, to: target.to })
      if (props.search) query.set('q', props.search)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/views/${viewId}/timeline?${query.toString()}`)
        const body = (await res.json().catch(() => null)) as TimelineBody | null
        if (id !== seq.current) return
        if (!res.ok || body === null || body.ok !== true || body.rows === undefined) {
          setError('타임라인을 불러오지 못했습니다.')
        } else {
          setError(null)
          const incoming = body.rows
          setRows(() => incoming)
          setUndated(body.undated ?? 0)
          setTruncated(body.truncated === true)
          if (body.datePropertyId !== undefined) setDatePropertyId(body.datePropertyId)
        }
      } catch {
        if (id === seq.current) setError('연결에 실패했습니다.')
      } finally {
        if (id === seq.current) setLoading(false)
      }
    },
    [workspaceId, viewId, props.search, setRows],
  )

  const moveTo = (next: TimelineWindow) => {
    winRef.current = next
    setWin(next)
    void load(next)
  }

  // 표 변경 알림(2k-3) — 다른 곳에서 바뀌면 지금 창을 다시 묻는다
  useTableChanges(
    workspaceId,
    props.dataSourceId,
    { onChanged: () => void load(winRef.current), onRevoked: () => router.refresh() },
    true,
    props.renderedAt,
  )
  useEffect(() => {
    winRef.current = win
  }, [win])

  /** 뷰의 설정을 저장한다 — 편집자만. 실패하면 알린다(화면은 그대로 둔다). */
  const persist = async (patch: { zoom?: TimelineZoom; show_table?: boolean; date_property_id?: string }): Promise<boolean> => {
    if (!canEditStructure) return true
    const result = await api.updateView(workspaceId, viewId, { timeline: patch })
    if (!result.ok) {
      setError(result.message)
      return false
    }
    setError(null)
    return true
  }

  const changeZoom = (next: TimelineZoom) => {
    if (next === zoom) return
    setZoom(next)
    moveTo(windowFrom(win.from, next))
    void persist({ zoom: next })
  }
  const toggleTable = () => {
    const next = !showTable
    setShowTable(next)
    void persist({ show_table: next })
  }
  const changeDateProperty = async (id: string) => {
    if (id === datePropertyId) return
    if (await persist({ date_property_id: id })) {
      setDatePropertyId(id)
      void load(win)
    }
  }

  const dateOf = (rowId: string): DateJson | null => {
    const value = rowsRef.current.find((r) => r.id === rowId)?.properties[datePropertyId] as { type?: string; date?: DateJson } | undefined
    return value?.type === 'date' && typeof value.date?.start === 'string' ? value.date : null
  }

  /** 날짜 칸 하나를 고친다 — 먼저 바꾸고, 거부되면 제자리로. 바뀐 값을 돌려준다(안 바뀌거나 거부되면 null). */
  const writeDate = async (rowId: string, next: (date: DateJson) => { start: string; end?: string } | null): Promise<{ start: string; end?: string } | null> => {
    const before = dateOf(rowId)
    if (before === null) return null
    const date = next(before)
    if (date === null) return null
    const original = rowsRef.current.find((r) => r.id === rowId)?.properties[datePropertyId]
    const put = (value: unknown) =>
      setRows((current) => current.map((r) => (r.id === rowId ? { ...r, properties: { ...r.properties, [datePropertyId]: value } } : r)))
    setError(null)
    setNotice(null)
    put({ type: 'date', date })
    const result = await api.updateCellInView(workspaceId, rowId, datePropertyId, { type: 'date', date }, { id: viewId, search: props.search ?? null })
    if (!result.ok) {
      put(original)
      setError(result.message)
      return null
    }
    const saved = result.value.row
    if (result.value.inView === false) setNotice(MOVED_OUT_OF_VIEW_NOTICE)
    setRows((current) => current.map((r) => (r.id === saved.id && notOlder(saved.version, r.version) ? saved : r)))
    return date
  }

  /** 막대(또는 손잡이)를 누르면 창에서 움직임을 듣는다 — 막대에서 들으면 포인터가 막대 밖으로 나가 끌기가 끊긴다. 포인터를 붙잡지 않는다(클릭이 링크로 가야 한다). */
  const onBarPointerDown = (rowId: string, mode: DragMode, event: ReactPointerEvent<HTMLElement>) => {
    swallowClick.current = false
    if (!canEditContent || event.button !== 0) return
    const before = dateOf(rowId)
    if (before === null) return
    if (mode !== 'move') {
      event.stopPropagation()
      event.preventDefault()
    }
    dragRef.current = { rowId, mode, startX: event.clientX, startY: event.clientY, moved: false, delta: 0, before }
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (d === null) return
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return
        d.moved = true
      }
      const delta = dayDeltaFromPx(e.clientX - d.startX, zoom)
      if (delta !== d.delta) {
        d.delta = delta
        setPreview({ rowId: d.rowId, date: dragDate(d.before, d.mode, delta) ?? d.before })
      }
    }
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      dragRef.current = null
      setPreview(null)
    }
    const onUp = () => {
      const d = dragRef.current
      stop()
      if (d === null || !d.moved) return
      swallowClick.current = true
      if (d.delta !== 0) void writeDate(d.rowId, (date) => dragDate(date, d.mode, d.delta))
    }
    const onCancel = () => stop()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  /** 키보드(F-12-13) — Alt+←/→ 하루 옮기기 · Alt+Shift+←/→ 끝 하루 줄이기 · 늘이기. 바뀐 날짜를 스크린 리더에 알린다. */
  const onBarKeyDown = async (row: RowJson, event: ReactKeyboardEvent<HTMLElement>) => {
    if (!canEditContent || !event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    const dir = event.key === 'ArrowLeft' ? -1 : 1
    const mode: DragMode = event.shiftKey ? 'end' : 'move'
    const saved = await writeDate(row.id, (date) => dragDate(date, mode, dir))
    if (saved === null) return
    setLive(`${row.title || UNTITLED} · ${saved.start.slice(0, 10)} ~ ${(saved.end ?? saved.start).slice(0, 10)}`)
  }

  /** 날짜 없는 행을 놓은 날에 시작일(하루짜리)로 둔다 — 서버의 답을 줄로 더하고 창을 다시 묻는다. */
  const placeUndated = async (row: RowJson, day: string) => {
    setError(null)
    setNotice(null)
    const result = await api.updateCellInView(workspaceId, row.id, datePropertyId, { type: 'date', date: { start: day } }, { id: viewId, search: props.search ?? null })
    if (!result.ok) {
      setError(result.message)
      return
    }
    if (result.value.inView === false) setNotice(MOVED_OUT_OF_VIEW_NOTICE)
    const saved = result.value.row
    setRows((current) => (current.some((r) => r.id === saved.id) ? current.map((r) => (r.id === saved.id ? saved : r)) : [...current, saved]))
    setUndated((n) => Math.max(0, n - 1))
    setLive(`${row.title || UNTITLED} · ${day}`)
    void load(winRef.current)
  }

  /** 날짜 없는 항목을 끌 때 "그 자리의 날"을 재는 함수 — 시간축 영역 밖이면 null. */
  const locateDay = (): ((x: number, y: number) => string | null) => {
    const el = scrollRef.current
    const w = winRef.current
    return (x, y) => {
      if (el === null) return null
      const r = el.getBoundingClientRect()
      if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return null
      return dayAtX(x - r.left + el.scrollLeft, w, zoom)
    }
  }

  const width = windowWidth(win, zoom)
  const ticks = headerTicks(win, zoom)
  const nowX = todayX(today, win, zoom)
  const bodyHeight = rows.length * ROW_PX

  return (
    <div
      data-testid="db-timeline"
      data-zoom={zoom}
      data-from={win.from}
      data-to={win.to}
      data-loading={loading ? 'true' : 'false'}
      className={`flex flex-col gap-2 ${preview !== null ? 'select-none' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" data-testid="timeline-prev" className={BUTTON} onClick={() => moveTo(shiftWindow(win, zoom, -1))}>
          이전
        </button>
        <button type="button" data-testid="timeline-today-button" className={BUTTON} onClick={() => moveTo(windowForToday(today, zoom))}>
          오늘
        </button>
        <button type="button" data-testid="timeline-next" className={BUTTON} onClick={() => moveTo(shiftWindow(win, zoom, 1))}>
          다음
        </button>
        <label className="flex items-center gap-1 text-neutral-600 dark:text-neutral-400">
          줌
          <select
            data-testid="timeline-zoom"
            value={zoom}
            onChange={(e) => changeZoom(e.target.value as TimelineZoom)}
            className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-sm dark:border-neutral-700"
          >
            {TIMELINE_ZOOMS.map((z) => (
              <option key={z} value={z}>
                {ZOOM_LABEL[z]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" data-testid="timeline-table-toggle" aria-pressed={showTable} className={BUTTON} onClick={toggleTable}>
          표
        </button>
        {canEditStructure && props.dateProperties.length > 1 && (
          <label className="flex items-center gap-1 text-neutral-600 dark:text-neutral-400">
            날짜
            <select
              data-testid="timeline-date-property"
              value={datePropertyId}
              onChange={(e) => void changeDateProperty(e.target.value)}
              className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-sm dark:border-neutral-700"
            >
              {props.dateProperties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {undated > 0 && (
          <UndatedList
            count={undated}
            load={(cursor) => api.loadUndatedRows(workspaceId, viewId, cursor, props.search ?? null)}
            hrefOf={(rowId) => rowOpenHref(workspaceId, rowId, props.peekBase ?? null)}
            place={canEditContent ? { start: locateDay, hover: setDropDay, drop: (row, day) => void placeUndated(row, day) } : undefined}
          />
        )}
        {truncated && <span className="text-amber-700 dark:text-amber-400">행이 많아 일부만 보입니다</span>}
        {error !== null && (
          <span role="alert" className="text-red-600 dark:text-red-400">
            {error}
          </span>
        )}
      </div>

      <div className="flex overflow-hidden rounded border border-neutral-200 dark:border-neutral-800">
        {showTable && (
          <div data-testid="timeline-table" className="shrink-0 border-r border-neutral-200 dark:border-neutral-800" style={{ width: TABLE_PX }}>
            <div
              className="flex items-center border-b border-neutral-200 px-2 text-xs text-neutral-500 dark:border-neutral-800"
              style={{ height: HEAD_PX }}
            >
              제목
            </div>
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-1 border-b border-neutral-100 px-2 text-sm dark:border-neutral-900"
                style={{ height: ROW_PX }}
              >
                <Link
                  href={rowOpenHref(workspaceId, row.id, props.peekBase ?? null)}
                  scroll={false}
                  className={`flex min-w-0 items-center gap-1 truncate hover:underline ${row.title ? '' : 'text-neutral-400'}`}
                >
                  <PageIconView icon={row.icon} fallback />
                  <span className="truncate">{row.title || UNTITLED}</span>
                </Link>
              </div>
            ))}
          </div>
        )}

        <div ref={scrollRef} data-testid="timeline-scroll" className="min-w-0 flex-1 overflow-x-auto">
          <div className="relative" style={{ width, minHeight: HEAD_PX + bodyHeight }}>
            {/* 눈금 — 머리의 글자와 세로 구분선 */}
            {ticks.map((t) => (
              <div
                key={t.key}
                className="absolute top-0 bottom-0 border-l border-neutral-100 dark:border-neutral-900"
                style={{ left: t.left, width: t.width }}
              >
                <div
                  className="overflow-hidden border-b border-neutral-200 px-1 text-xs whitespace-nowrap text-neutral-500 dark:border-neutral-800"
                  style={{ height: HEAD_PX, lineHeight: `${HEAD_PX}px` }}
                >
                  {t.label}
                </div>
              </div>
            ))}
            {/* 줄 — 행마다 한 줄 */}
            {rows.map((row, index) => {
              const shown = preview !== null && preview.rowId === row.id ? { type: 'date', date: preview.date } : row.properties[datePropertyId]
              const days = cellDays(shown)
              const place = days === null ? null : placeBar(days.start, days.end, win, zoom)
              const title = row.title || UNTITLED
              const inside = place !== null && place.width >= LABEL_INSIDE_MIN_PX
              return (
                <div
                  key={row.id}
                  data-testid="timeline-row"
                  data-row-id={row.id}
                  className="absolute right-0 left-0 border-b border-neutral-100 dark:border-neutral-900"
                  style={{ top: HEAD_PX + index * ROW_PX, height: ROW_PX }}
                >
                  {place !== null && days !== null && (
                    <>
                      <Link
                        href={rowOpenHref(workspaceId, row.id, props.peekBase ?? null)}
                        scroll={false}
                        draggable={false}
                        data-testid="timeline-bar"
                        data-row-id={row.id}
                        onPointerDown={(e) => onBarPointerDown(row.id, 'move', e)}
                        onDragStart={(e) => e.preventDefault()}
                        onKeyDown={(e) => void onBarKeyDown(row, e)}
                        onClick={(e) => {
                          if (!swallowClick.current) return
                          swallowClick.current = false
                          e.preventDefault()
                        }}
                        data-start={days.start}
                        data-end={days.end}
                        aria-label={`${title} · ${days.start} ~ ${days.end}`}
                        title={title}
                        className={`absolute top-1.5 flex items-center overflow-hidden bg-blue-500/80 px-1 ${canEditContent ? 'cursor-grab touch-none' : ''} text-xs whitespace-nowrap text-white hover:bg-blue-600 ${
                          place.clippedStart ? '' : 'rounded-l'
                        } ${place.clippedEnd ? '' : 'rounded-r'}`}
                        style={{ left: place.left, width: Math.max(place.width, 3), height: ROW_PX - 12 }}
                      >
                        {inside ? title : null}
                        {canEditContent && !place.clippedStart && (
                          <span
                            data-testid="timeline-bar-start"
                            aria-hidden
                            className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize touch-none hover:bg-blue-800/60"
                            onPointerDown={(e) => onBarPointerDown(row.id, 'start', e)}
                          />
                        )}
                        {canEditContent && !place.clippedEnd && (
                          <span
                            data-testid="timeline-bar-end"
                            aria-hidden
                            className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize touch-none hover:bg-blue-800/60"
                            onPointerDown={(e) => onBarPointerDown(row.id, 'end', e)}
                          />
                        )}
                      </Link>
                      {!inside && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute truncate text-xs text-neutral-600 dark:text-neutral-400"
                          style={{ left: place.left + Math.max(place.width, 3) + 4, top: 0, lineHeight: `${ROW_PX}px` }}
                        >
                          {title}
                        </span>
                      )}
                    </>
                  )}
                </div>
              )
            })}
            {/* 날짜 없는 행을 놓을 날 */}
            {dropDay !== null && (
              <div
                data-testid="timeline-drop-day"
                aria-hidden
                className="pointer-events-none absolute top-0 bottom-0 bg-blue-500/20"
                style={{ left: daysBetween(win.from, dropDay) * DAY_PX[zoom], width: DAY_PX[zoom] }}
              />
            )}
            {/* 오늘 세로선 */}
            {nowX !== null && (
              <div
                data-testid="timeline-today"
                aria-hidden
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-red-500"
                style={{ left: nowX }}
              />
            )}
          </div>
        </div>
      </div>
      {notice && (
        <p role="status" data-testid="db-notice" className="text-sm text-amber-700 dark:text-amber-300">
          {notice}
        </p>
      )}
      <div data-testid="timeline-live" role="status" aria-live="polite" className="sr-only">
        {live}
      </div>
      {rows.length === 0 && (
        <p className="px-2 text-sm text-neutral-500" data-testid="timeline-empty">
          이 기간에 걸친 행이 없습니다.
        </p>
      )}
    </div>
  )
}

/**
 * 날짜 없는 행(TL-3 ③) — "날짜 없음 N" 단추가 그 행들의 목록을 연다(캘린더의 길 `…/calendar/undated` · 50개씩 · "더 보기"). 열 때마다 처음부터 읽는다.
 * 항목은 누르면 그 행을 열고, 4px 넘게 끌어 시간축에 놓으면 그 날이 시작일이 된다(끄는 동안 목록은 가려 시간축을 비운다).
 */
function UndatedList({
  count,
  load,
  hrefOf,
  place,
}: {
  count: number
  load: (cursor: string | null) => Promise<api.ApiResult<api.RowPage>>
  hrefOf: (rowId: string) => string
  place?: {
    readonly start: () => (x: number, y: number) => string | null
    readonly hover: (day: string | null) => void
    readonly drop: (row: RowJson, day: string) => void
  }
}) {
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [rows, setRows] = useState<readonly RowJson[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const swallowClick = useRef(false)

  const onItemPointerDown = (row: RowJson, event: ReactPointerEvent<HTMLAnchorElement>) => {
    swallowClick.current = false
    if (place === undefined || event.button !== 0) return
    const locate = place.start()
    const sx = event.clientX
    const sy = event.clientY
    let moved = false
    let target: string | null = null
    const onMove = (e: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < DRAG_THRESHOLD_PX) return
        moved = true
        setDragging(true)
      }
      const day = locate(e.clientX, e.clientY)
      if (day !== target) {
        target = day
        place.hover(day)
      }
    }
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      place.hover(null)
      setDragging(false)
    }
    const onUp = () => {
      stop()
      if (!moved) return
      swallowClick.current = true
      if (target === null) return
      setOpen(false)
      place.drop(row, target)
    }
    const onCancel = () => stop()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current === null || !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const fetchPage = async (cursor: string | null) => {
    setBusy(true)
    setError(null)
    const result = await load(cursor)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setRows((current) => (cursor === null ? result.value.rows : [...(current ?? []), ...result.value.rows]))
    setNext(result.value.hasMore ? result.value.nextCursor : null)
  }

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    setRows(null)
    setNext(null)
    setOpen(true)
    void fetchPage(null)
  }

  return (
    <span
      ref={boxRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          buttonRef.current?.focus()
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        data-testid="timeline-undated"
        aria-haspopup="true"
        aria-expanded={open}
        title="날짜 속성이 비어 있어 시간축에 놓이지 않은 행 — 눌러 보기"
        onClick={toggle}
        className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100 aria-expanded:bg-amber-100 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900 dark:aria-expanded:bg-amber-900"
      >
        날짜 없음 {count}
      </button>
      {open && (
        <div
          role="group"
          aria-label="날짜 없는 행"
          aria-busy={busy}
          data-testid="timeline-undated-panel"
          className={`absolute top-full left-0 z-30 mt-1 max-h-80 w-64 overflow-y-auto popover-surface p-1 text-left text-sm font-normal dark:bg-neutral-950 ${
            dragging ? 'invisible' : ''
          }`}
        >
          <p className="px-2 pt-0.5 pb-1 text-xs text-neutral-400">날짜가 비어 있어 시간축에 놓이지 않은 행{place ? ' — 끌어 놓으면 그 날이 시작일' : ''}</p>
          {rows === null && busy && (
            <p role="status" className="px-2 py-1.5 text-neutral-400">
              불러오는 중…
            </p>
          )}
          {error && (
            <p role="alert" className="px-2 py-1.5 text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {rows?.map((row) => (
            <Link
              key={row.id}
              href={hrefOf(row.id)}
              scroll={false}
              data-testid="timeline-undated-item"
              data-row-id={row.id}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              onPointerDown={(e) => onItemPointerDown(row, e)}
              onClick={(e) => {
                if (swallowClick.current) {
                  swallowClick.current = false
                  e.preventDefault()
                  return
                }
                setOpen(false)
              }}
              className="flex min-w-0 items-center gap-1 rounded px-2 py-1.5 hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none dark:hover:bg-neutral-800 dark:focus:bg-neutral-800"
            >
              <PageIconView icon={row.icon} fallback />
              <span className={`truncate ${row.title ? '' : 'text-neutral-400'}`}>{row.title || UNTITLED}</span>
            </Link>
          ))}
          {rows !== null && rows.length === 0 && <p className="px-2 py-1.5 text-neutral-400">날짜 없는 행이 없습니다</p>}
          {next !== null && (
            <button
              type="button"
              data-testid="timeline-undated-more"
              disabled={busy}
              onClick={() => void fetchPage(next)}
              className="mt-0.5 w-full rounded px-2 py-1.5 text-left text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
            >
              {busy ? '불러오는 중…' : '더 보기'}
            </button>
          )}
        </div>
      )}
    </span>
  )
}
