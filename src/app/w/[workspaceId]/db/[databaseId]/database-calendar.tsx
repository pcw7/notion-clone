'use client'

/**
 * 캘린더 — DB 심화 2g-2조각 (F-04-06 Calendar view)
 *
 * 정본: 04-database-views.md F-04-06 · 00-canonical-data-model.md §3.6 [보강] 캘린더
 *
 * 한 달을 **일요일에 시작하는 6주**(`monthGrid`)로 그리고, 날짜 속성의 값으로 행을 막대로 놓는다. 여러 날에 걸친 값은 주마다 잘라 잇고
 * (`layoutWeek` — 줄 배치), 한 주에 줄이 넘치면 그 날짜 칸에 "+N" 을 단다. 칸에 놓는 날은 **칸 값의 날짜 글자**다(`cellDays` — 서버가 기간
 * 양끝을 넓혀 준 행을 여기서 다시 가른다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 보이는 달은 주소의 `m` 이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 이전 · 다음 · 오늘은 주소의 `m`(`YYYY-MM`)을 바꾸고(`router.replace`), 서버 렌더가 그 달의 격자 기간으로 행을 다시 읽는다 — 다시 마운트
 * 기준에 달이 있다. 검색(`q`)과 같은 자리다(2e-2 가 정한 것). "오늘"은 보는 사람의 날이다 — 서버가 아니라 브라우저가 정한다
 * (`useToday` — 서버 렌더에는 없고 붙은 뒤에 선다).
 *
 * 날짜 칸에 마우스를 올리면 "+" — 그 날이 채워진 새 행을 만들고 막대 자리에서 제목을 바로 받는다(표 · 보드 · 갤러리와 같은 규칙).
 * 날짜 없는 행은 달력에 없고 머리에 "날짜 없음 N개"로만 선다(04 *"달력에서 행이 조용히 사라지는 것이 가장 흔한 혼란"*).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 막대를 끌어 날짜를 옮긴다 (2g-3)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 막대를 잡은 날짜와 놓은 날짜 칸의 **차이만큼** 날짜 값을 옮긴다(`shiftDateValue` — 범위는 길이를 지키고 시각은 그대로). 4px 넘게 움직여야
 * 끌기다 — 그 전에 놓으면 막대의 링크(행 페이지)가 열린다. 끌고 놓은 뒤 따라오는 클릭은 삼킨다. 셀 쓰기 하나이고(`updateCell`) 화면이 먼저
 * 옮긴 뒤 거부되면 제자리로 되돌린다(04 *"낙관적 이동 → 서버 거절 시 원위치"*). 셀 값을 바꾸는 일이라 `edit_content` 다(04 *"카드
 * 드래그 · 리사이즈는 셀 값 변경이므로 허용 · 날짜 속성 변경은 차단 — 둘을 같은 권한으로 묶으면 안 된다"*). 링크의 기본 끌기(브라우저가
 * 주소를 끄는 것)는 막는다 — 그것이 시작되면 포인터 이벤트가 끊긴다.
 */

import { rowOpenHref } from '@/lib/database/open-pages'
import Link from '@/app/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import type { DatabaseAccess } from '@/lib/database/database'
import type { RowJson } from '@/lib/database/http'
import { cellDays, daysBetween, eventsOn, layoutWeek, monthGrid, shiftDateValue, shiftMonth, type CalendarEvent } from '@/lib/database/calendar'
import { cellText, parseDraft, readCell, sameValue } from '@/lib/database/cell-format'
import { PageIconView } from '../../page-icon-view'
import * as api from './table-api'
import { EDITED_OUT_OF_VIEW_NOTICE, MOVED_OUT_OF_VIEW_NOTICE } from '@/lib/database/out-of-view'
import { SearchEmpty } from './view-search'
import { useAdoptServerValue, useLiveServerRefresh } from './use-table-changes'
import { useRowReminders } from './use-row-reminders'
import { ReminderMark } from './reminder-bell'
import { AnchoredLayer, containsAcrossLayers } from '../../anchored-layer'

const UNTITLED = '제목 없음'
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
/** 한 주에 그리는 막대 줄 수. 넘치면 칸마다 "+N". */
const MAX_LANES = 3
/** 막대 한 줄의 높이(px) · 날짜 숫자 줄의 높이(px). */
const LANE_PX = 22
const HEAD_PX = 26

type Editing = { readonly rowId: string; readonly draft: string }

/** 이만큼 움직여야 끌기다. 그 전에 놓으면 클릭(행 페이지 열기)이다. */
const DRAG_THRESHOLD_PX = 4

type Drag = {
  readonly rowId: string
  /** 막대를 잡은 날짜 — 놓은 날짜와의 차이가 옮길 일수다. */
  readonly grabDay: string
  readonly startX: number
  readonly startY: number
  moved: boolean
  /** 끌기를 시작할 때 잰 날짜 칸들(끄는 동안 칸은 움직이지 않는다). */
  cells: { readonly day: string; readonly rect: DOMRect }[]
  target: string | null
}

const notOlder = (incoming: string, current: string): boolean => BigInt(incoming) >= BigInt(current)

/** 보는 사람의 오늘(`YYYY-MM-DD`). 서버 렌더에서는 null — 붙은 뒤에 선다(시간대가 서버와 다를 수 있다). */
function useToday(): string | null {
  return useSyncExternalStore(
    () => () => {},
    () => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    },
    () => null,
  )
}

export function DatabaseCalendar(props: {
  workspaceId: string
  /** 이 뷰의 표 — 표 변경 알림(2k-3)을 구독한다. */
  dataSourceId: string
  viewId: string
  tableName: string
  /** 보이는 달(`YYYY-MM`). */
  month: string
  datePropertyId: string
  /** 그 날짜 속성의 이름 — 막대의 리마인더 종이 말한다(10n-77). 없으면 "날짜". */
  datePropertyName?: string
  /** 제목 컬럼 — 새 행의 제목을 받는다. */
  titlePropertyId: string | null
  rows: RowJson[]
  undated: number
  truncated: boolean
  access: DatabaseAccess
  search?: string | null
  /** 서버 화면이 읽기 전의 시각(ms) — 구독이 붙기 전의 변경을 메운다(#250 · `use-table-changes.ts`). */
  /** 행을 여는 주소의 바탕(8n-1 · F-02-20) — 지금 데이터베이스 화면의 주소면 피크로, null 이면 행 화면으로(전체 페이지). */
  peekBase?: string | null
  renderedAt?: number
}) {
  const { workspaceId, viewId, tableName, month, datePropertyId, titlePropertyId, access } = props
  const router = useRouter()
  const pathname = usePathname()
  const today = useToday()
  const [rows, setRows] = useState<readonly RowJson[]>(props.rows)
  const [busyDay, setBusyDay] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 알릴 것 — 고치거나 옮긴 카드가 이 보기의 조건 밖이 되었을 때(10n-16). 오류가 아니므로 `error` 와 따로 둔다. */
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditingState] = useState<Editing | null>(null)
  const editingRef = useRef<Editing | null>(null)
  const setEditing = (next: Editing | null) => {
    editingRef.current = next
    setEditingState(next)
  }
  const titleInputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLElement>(null)
  const dragRef = useRef<Drag | null>(null)
  /** 끌고 놓은 뒤 따라오는 클릭을 삼킨다(링크가 열리지 않게). */
  const swallowClick = useRef(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropDay, setDropDay] = useState<string | null>(null)
  // 표 변경 알림(2k-3 · F-04-24) — 다른 곳에서 바뀌면 서버 렌더(그 달의 격자)를 다시 부르고 새 막대를 받아들인다. 끌기 · 편집 · 만들기
  // 중이면 끝난 뒤에.
  const calendarBusy = draggingId !== null || editing !== null || busyDay !== null
  useLiveServerRefresh(workspaceId, props.dataSourceId, calendarBusy, props.renderedAt)
  // 막대의 리마인더 종(10n-77) — 보드 · 갤러리와 같은 훅 · 서버가 다시 그릴 때마다(`renderedAt`) 다시 읽는다. 캘린더는 늘 날짜 속성이 있다
  const [reminders] = useRowReminders(workspaceId, props.dataSourceId, rows, true, props.renderedAt)
  useAdoptServerValue(props.rows, calendarBusy, setRows)
  useEffect(() => {
    if (editing !== null) titleInputRef.current?.focus()
  }, [editing?.rowId]) // eslint-disable-line react-hooks/exhaustive-deps -- 새 행이 설 때만 포커스를 준다

  const grid = monthGrid(month)
  const events: CalendarEvent[] = []
  const rowById = new Map<string, RowJson>()
  for (const row of rows) {
    const days = cellDays(row.properties[datePropertyId])
    if (days === null) continue
    events.push({ id: row.id, start: days.start, end: days.end })
    rowById.set(row.id, row)
  }

  const goMonth = (next: string) => {
    const query = new URLSearchParams(window.location.search)
    query.set('m', next)
    router.replace(`${pathname}?${query.toString()}`, { scroll: false })
  }

  /** 그 날이 채워진 새 행 — 막대 자리에서 제목을 바로 받는다. */
  const addOn = async (day: string) => {
    if (busyDay !== null) return
    setBusyDay(day)
    setError(null)
    const result = await api.createRowFrom(workspaceId, viewId, {
      templateId: null,
      cells: [{ propertyId: datePropertyId, value: { type: 'date', date: { start: day } } }],
    })
    setBusyDay(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setRows((current) => [...current, result.value.row])
    if (access.canEditContent && titlePropertyId !== null) setEditing({ rowId: result.value.row.id, draft: '' })
  }

  const commitTitle = async () => {
    const e = editingRef.current
    if (e === null || titlePropertyId === null) return
    setEditing(null)
    const row = rows.find((r) => r.id === e.rowId)
    if (row === undefined) return
    const previous = readCell('title', row.properties[titlePropertyId])
    const parsed = parseDraft('title', e.draft, previous)
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }
    if (sameValue(previous, parsed.value)) return
    const withValue = (r: RowJson, value: typeof parsed.value): RowJson => ({
      ...r,
      title: cellText(value),
      properties: { ...r.properties, [titlePropertyId]: value },
    })
    setRows((current) => current.map((r) => (r.id === e.rowId ? withValue(r, parsed.value) : r)))
    // 뷰를 실어 보낸다 — 고친 카드가 조건 밖이면 곧 빠지므로 그 까닭을 말한다(10n-16)
    const result = await api.updateCellInView(workspaceId, e.rowId, titlePropertyId, parsed.value, { id: viewId, search: props.search ?? null })
    if (!result.ok) {
      setRows((current) => current.map((r) => (r.id === e.rowId ? withValue(r, previous) : r)))
      setError(result.message)
      return
    }
    const saved = result.value.row
    if (result.value.inView === false) setNotice(EDITED_OUT_OF_VIEW_NOTICE)
    setRows((current) => current.map((r) => (r.id === saved.id && notOlder(saved.version, r.version) ? saved : r)))
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

  // ── 끌어 옮기기 (2g-3) ──────────────────────────────────────────────

  const measureDays = (): Drag['cells'] =>
    Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-testid="db-cal-day"]') ?? []).map((el) => ({
      day: el.dataset.day ?? '',
      rect: el.getBoundingClientRect(),
    }))
  const dayAt = (cells: Drag['cells'], x: number, y: number): string | null =>
    cells.find(({ rect }) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom)?.day ?? null

  /**
   * 막대를 누르면 **창에서** 움직임을 듣는다 — 막대에서 들으면 아래 줄로 끌 때 첫 움직임에 포인터가 막대 밖으로 나가 끌기가 시작되지 않는다
   * (검사가 잡았다). 포인터를 붙잡지(capture) 않는다 — 붙잡으면 움직이지 않고 놓아도 클릭이 링크가 아니라 막대로 가서 행 페이지가 열리지
   * 않는다(이것도 검사가 잡았다).
   */
  const onBarPointerDown = (row: RowJson, event: ReactPointerEvent<HTMLDivElement>) => {
    // 새로 누를 때마다 지운다 — 다른 칸에 놓은 끌기는 막대에 클릭을 남기지 않아 표시가 남고, 그대로면 다음 진짜 클릭을 삼킨다(검사가 잡았다).
    swallowClick.current = false
    if (!access.canEditContent || editingRef.current !== null || event.button !== 0) return
    const cells = measureDays()
    const grabDay = dayAt(cells, event.clientX, event.clientY)
    if (grabDay === null) return
    dragRef.current = { rowId: row.id, grabDay, startX: event.clientX, startY: event.clientY, moved: false, cells, target: null }

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (d === null) return
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return
        d.moved = true
        setDraggingId(d.rowId)
      }
      const target = dayAt(d.cells, e.clientX, e.clientY)
      if (target !== d.target) {
        d.target = target
        setDropDay(target)
      }
    }
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    const onUp = () => {
      stop()
      const d = endDrag()
      if (d === null || !d.moved) return
      swallowClick.current = true
      if (d.target === null || d.target === d.grabDay) return
      void moveRow(d.rowId, daysBetween(d.grabDay, d.target))
    }
    const onCancel = () => {
      stop()
      endDrag()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const endDrag = (): Drag | null => {
    const d = dragRef.current
    dragRef.current = null
    setDraggingId(null)
    setDropDay(null)
    return d
  }

  /** 날짜 값을 며칠 옮긴다 — 먼저 옮기고, 거부되면 제자리로. */
  const moveRow = async (rowId: string, days: number) => {
    const row = rows.find((r) => r.id === rowId)
    const before = row?.properties[datePropertyId] as { type: 'date'; date: { start: string; end?: string | null } } | undefined
    if (row === undefined || before?.type !== 'date' || typeof before.date?.start !== 'string') return
    const after = { type: 'date' as const, date: shiftDateValue(before.date, days) }
    const put = (value: unknown) =>
      setRows((current) => current.map((r) => (r.id === rowId ? { ...r, properties: { ...r.properties, [datePropertyId]: value } } : r)))
    setError(null)
    setNotice(null)
    put(after)
    // 뷰를 실어 보낸다 — 필터에 걸리는 날짜로 끌면 카드가 곧 빠지므로 그 까닭을 말한다(10n-16 · 04 *"필터에 걸리는 날짜로 드래그"*)
    const result = await api.updateCellInView(workspaceId, rowId, datePropertyId, after, { id: viewId, search: props.search ?? null })
    if (!result.ok) {
      put(before)
      setError(result.message)
      return
    }
    const saved = result.value.row
    if (result.value.inView === false) setNotice(MOVED_OUT_OF_VIEW_NOTICE)
    setRows((current) => current.map((r) => (r.id === saved.id && notOlder(saved.version, r.version) ? saved : r)))
  }

  const [year, monthNumber] = month.split('-')
  const todayMonth = today?.slice(0, 7) ?? null

  return (
    <section
      ref={rootRef}
      className={`flex min-w-0 flex-col gap-2 ${draggingId !== null ? 'select-none' : ''}`}
      aria-label={tableName || UNTITLED}
      data-testid="db-calendar"
      data-month={month}
    >
      <div className="flex flex-wrap items-center gap-2 px-1">
        <h2 className="text-base font-semibold" data-testid="db-cal-title">
          {Number(year)}년 {Number(monthNumber)}월
        </h2>
        <span className="flex items-center gap-1 text-sm">
          <button type="button" data-testid="db-cal-prev" aria-label="이전 달" onClick={() => goMonth(shiftMonth(month, -1))} className="rounded px-2 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            ‹
          </button>
          <button
            type="button"
            data-testid="db-cal-today"
            disabled={todayMonth === null}
            onClick={() => todayMonth !== null && goMonth(todayMonth)}
            className="rounded px-2 py-0.5 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
          >
            오늘
          </button>
          <button type="button" data-testid="db-cal-next" aria-label="다음 달" onClick={() => goMonth(shiftMonth(month, 1))} className="rounded px-2 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            ›
          </button>
        </span>
        {props.undated > 0 && (
          <UndatedChip
            count={props.undated}
            load={(cursor) => api.loadUndatedRows(workspaceId, viewId, cursor, props.search ?? null)}
            hrefOf={(rowId) => rowOpenHref(workspaceId, rowId, props.peekBase ?? null)}
          />
        )}
      </div>

      <div className="grid grid-cols-7 text-center text-xs text-neutral-500" aria-hidden>
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div role="grid" aria-label={`${Number(year)}년 ${Number(monthNumber)}월`} className="flex flex-col border-l border-t border-neutral-200 dark:border-neutral-800">
        {grid.weeks.map((week) => {
          const { placed, hidden } = layoutWeek(week, events, MAX_LANES)
          return (
            <div key={week[0]} role="row" className="relative grid grid-cols-7" style={{ minHeight: HEAD_PX + MAX_LANES * LANE_PX + 22 }}>
              {week.map((day, i) => {
                const outside = day.slice(0, 7) !== month
                return (
                  <div
                    key={day}
                    role="gridcell"
                    data-testid="db-cal-day"
                    data-day={day}
                    data-today={day === today || undefined}
                    data-drop-target={day === dropDay || undefined}
                    className={`group/day relative border-b border-r border-neutral-200 dark:border-neutral-800 ${
                      day === dropDay ? 'bg-blue-50 dark:bg-blue-950/40' : outside ? 'bg-neutral-50 dark:bg-neutral-900/50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between px-1.5 pt-1 text-xs">
                      {access.canCreateRows ? (
                        <button
                          type="button"
                          data-testid="db-cal-add"
                          aria-label={`${day}에 새로 만들기`}
                          disabled={busyDay !== null}
                          onClick={() => void addOn(day)}
                          className="rounded px-1 text-neutral-400 opacity-0 hover:bg-neutral-100 focus:opacity-100 group-hover/day:opacity-100 dark:hover:bg-neutral-800"
                        >
                          +
                        </button>
                      ) : (
                        <span />
                      )}
                      <span
                        className={`tabular-nums ${day === today ? 'rounded-full bg-red-500 px-1.5 text-white' : outside ? 'text-neutral-400' : 'text-neutral-600 dark:text-neutral-300'}`}
                      >
                        {Number(day.slice(8))}
                      </span>
                    </div>
                    {hidden[i]! > 0 && (
                      <DayOverflow
                        day={day}
                        count={hidden[i]!}
                        rows={eventsOn(day, events).map((e) => rowById.get(e.id)!)}
                        hrefOf={(rowId) => rowOpenHref(workspaceId, rowId, props.peekBase ?? null)}
                      />
                    )}
                  </div>
                )
              })}
              {placed.map((p) => {
                const row = rowById.get(p.id)!
                const isEditing = editing !== null && editing.rowId === row.id
                return (
                  <div
                    key={`${week[0]}-${p.id}`}
                    data-testid="db-cal-event"
                    data-row-id={row.id}
                    data-week={week[0]}
                    data-dragging={draggingId === row.id || undefined}
                    onPointerDown={(e) => onBarPointerDown(row, e)}
                    onClickCapture={(e) => {
                      if (!swallowClick.current) return
                      swallowClick.current = false
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    className={`absolute flex items-center overflow-hidden border border-neutral-200 bg-white px-1.5 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-950 ${
                      p.continuesBefore ? 'rounded-l-none' : 'rounded-l'
                    } ${p.continuesAfter ? 'rounded-r-none' : 'rounded-r'} ${access.canEditContent ? 'cursor-grab' : ''} ${
                      draggingId === row.id ? 'opacity-40' : ''
                    }`}
                    style={{
                      left: `calc(${(p.col * 100) / 7}% + 2px)`,
                      width: `calc(${(p.span * 100) / 7}% - 4px)`,
                      top: HEAD_PX + p.lane * LANE_PX,
                      height: LANE_PX - 3,
                    }}
                  >
                    {isEditing ? (
                      <input
                        ref={titleInputRef}
                        value={editing.draft}
                        onChange={(e) => setEditing({ rowId: row.id, draft: e.target.value })}
                        onKeyDown={onTitleKeyDown}
                        onBlur={() => void commitTitle()}
                        aria-label="새 행 제목"
                        data-testid="db-cal-title-input"
                        placeholder={UNTITLED}
                        autoComplete="off"
                        className="w-full bg-transparent outline-none"
                      />
                    ) : (
                      <Link
                        href={rowOpenHref(workspaceId, row.id, props.peekBase ?? null)}
                        scroll={false}
                        data-testid="db-cal-event-open"
                        draggable={false}
                        onDragStart={(e) => e.preventDefault()}
                        title={row.title || UNTITLED}
                        className={`flex min-w-0 items-center gap-1 truncate hover:underline ${row.title ? '' : 'text-neutral-400'}`}
                      >
                        <PageIconView icon={row.icon} fallback />
                        <span className="truncate" data-testid="db-cal-event-title">
                          {row.title || UNTITLED}
                        </span>
                      </Link>
                    )}
                    {/* 리마인더 종(10n-77) — 보이기만 · 주를 넘어 잘린 막대는 시작하는 조각에만 */}
                    {!isEditing && !p.continuesBefore && reminders[row.id]?.[datePropertyId] !== undefined && (
                      <ReminderMark
                        reminder={reminders[row.id]![datePropertyId]!}
                        propertyName={props.datePropertyName ?? '날짜'}
                        start={(row.properties[datePropertyId] as { date?: { start?: string } } | undefined)?.date?.start ?? null}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {rows.length === 0 && props.search ? <SearchEmpty search={props.search} /> : null}
      {props.truncated && (
        <p role="status" data-testid="db-cal-truncated" className="text-sm text-amber-700 dark:text-amber-300">
          이 달에 행이 너무 많아 일부만 보입니다. 필터로 좁혀 보세요.
        </p>
      )}
      {notice && (
        <p role="status" data-testid="db-notice" className="text-sm text-amber-700 dark:text-amber-300">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="db-error" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  )
}

/**
 * 하루에 넘치는 카드(C-1 · 정본 [보강] 캘린더 ⑤) — "+N"(그날 그려지지 않은 수) 단추가 그날에 걸친 카드 **전부**의 목록을 연다(날짜순 — 막대로
 * 보이는 것도 함께). 항목은 행을 연다(막대의 링크와 같은 곳). 목록은 몸으로 내보낸 층(`AnchoredLayer`)이라 DOM 의 탭 순서가 단추 뒤로 잇지
 * 않는다 — 열 때 첫 항목에 포커스 · Esc 는 단추로 · 바깥을 누르거나 포커스가 층과 단추 밖으로 나가면 닫는다(보드의 "옮기기"와 같다).
 */
function DayOverflow({
  day,
  count,
  rows,
  hrefOf,
}: {
  day: string
  count: number
  rows: readonly RowJson[]
  hrefOf: (rowId: string) => string
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('a')?.focus()
    const onDown = (e: MouseEvent) => {
      if (boxRef.current === null || !containsAcrossLayers(boxRef.current, e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const label = `${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일`
  return (
    <span
      ref={boxRef}
      className="absolute bottom-0.5 left-1"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          buttonRef.current?.focus()
        }
      }}
      onBlur={(e) => {
        if (open && boxRef.current !== null && !(e.relatedTarget instanceof Node && containsAcrossLayers(boxRef.current, e.relatedTarget))) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        data-testid="db-cal-more"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${label}의 카드 ${count}개 더 — 그날의 카드 모두 보기`}
        onClick={() => setOpen((o) => !o)}
        className="rounded px-0.5 text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 aria-expanded:bg-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 dark:aria-expanded:bg-neutral-800"
      >
        +{count}
      </button>
      {open && (
        <AnchoredLayer align="start">
          <div
            ref={listRef}
            role="group"
            aria-label={`${label}의 카드`}
            data-testid="db-cal-day-list"
            className="w-60 popover-surface p-1 text-left text-sm font-normal dark:bg-neutral-950"
          >
            <p className="px-2 pb-1 pt-0.5 text-xs text-neutral-400">{label}</p>
            {rows.map((row) => (
              <Link
                key={row.id}
                href={hrefOf(row.id)}
                scroll={false}
                data-testid="db-cal-day-item"
                data-row-id={row.id}
                onClick={() => setOpen(false)}
                className="flex min-w-0 items-center gap-1 rounded px-2 py-1.5 hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none dark:hover:bg-neutral-800 dark:focus:bg-neutral-800"
              >
                <PageIconView icon={row.icon} fallback />
                <span className={`truncate ${row.title ? '' : 'text-neutral-400'}`}>{row.title || UNTITLED}</span>
              </Link>
            ))}
          </div>
        </AnchoredLayer>
      )}
    </span>
  )
}

/**
 * 날짜 없는 행(C-2 · 정본 [보강] 캘린더 ⑥) — 머리의 "날짜 없음 N개" 단추가 그 행들의 목록을 연다. 열 때마다 처음부터 읽고(`…/calendar/undated`
 * — 수와 같은 조건 · 표의 차례 · 50개씩) "더 보기"로 이어 읽는다. 항목은 그 행을 연다. 층 규칙은 "+N" 의 목록과 같다(`DayOverflow`).
 */
function UndatedChip({
  count,
  load,
  hrefOf,
}: {
  count: number
  load: (cursor: string | null) => Promise<api.ApiResult<api.RowPage>>
  hrefOf: (rowId: string) => string
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<readonly RowJson[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const firstLoad = rows === null

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current === null || !containsAcrossLayers(boxRef.current, e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // 첫 페이지가 오면 첫 항목에 포커스(키보드로 연 사람이 이어서 고르게)
  useEffect(() => {
    if (open && !firstLoad) listRef.current?.querySelector<HTMLElement>('a')?.focus()
  }, [open, firstLoad])

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
    // 열 때마다 처음부터 — 그사이 날짜가 생긴 행이 남지 않게
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
      onBlur={(e) => {
        if (open && boxRef.current !== null && !(e.relatedTarget instanceof Node && containsAcrossLayers(boxRef.current, e.relatedTarget))) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        data-testid="db-cal-undated"
        aria-haspopup="true"
        aria-expanded={open}
        title="날짜 속성이 비어 있어 달력에 놓이지 않은 행 — 눌러 보기"
        onClick={toggle}
        className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100 aria-expanded:bg-amber-100 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900 dark:aria-expanded:bg-amber-900"
      >
        날짜 없음 {count}개
      </button>
      {open && (
        <AnchoredLayer align="start">
          <div
            ref={listRef}
            role="group"
            aria-label="날짜 없는 행"
            aria-busy={busy}
            data-testid="db-cal-undated-list"
            className="max-h-80 w-64 overflow-y-auto popover-surface p-1 text-left text-sm font-normal dark:bg-neutral-950"
          >
            <p className="px-2 pb-1 pt-0.5 text-xs text-neutral-400">날짜가 비어 있어 달력에 놓이지 않은 행</p>
            {firstLoad && busy && (
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
                data-testid="db-cal-undated-item"
                data-row-id={row.id}
                onClick={() => setOpen(false)}
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
                data-testid="db-cal-undated-more"
                disabled={busy}
                onClick={() => void fetchPage(next)}
                className="mt-0.5 w-full rounded px-2 py-1.5 text-left text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
              >
                {busy ? '불러오는 중…' : '더 보기'}
              </button>
            )}
          </div>
        </AnchoredLayer>
      )}
    </span>
  )
}
