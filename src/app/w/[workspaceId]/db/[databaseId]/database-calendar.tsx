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
 * 끌어서 날짜 옮기기는 다음 조각이다(2g-3).
 */

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'

import type { DatabaseAccess } from '@/lib/database/database'
import type { RowJson } from '@/lib/database/http'
import { cellDays, layoutWeek, monthGrid, shiftMonth, type CalendarEvent } from '@/lib/database/calendar'
import { cellText, parseDraft, readCell, sameValue } from '@/lib/database/cell-format'
import { PageIconView } from '../../page-icon-view'
import * as api from './table-api'
import { SearchEmpty } from './view-search'

const UNTITLED = '제목 없음'
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
/** 한 주에 그리는 막대 줄 수. 넘치면 칸마다 "+N". */
const MAX_LANES = 3
/** 막대 한 줄의 높이(px) · 날짜 숫자 줄의 높이(px). */
const LANE_PX = 22
const HEAD_PX = 26

type Editing = { readonly rowId: string; readonly draft: string }

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
  viewId: string
  tableName: string
  /** 보이는 달(`YYYY-MM`). */
  month: string
  datePropertyId: string
  /** 제목 컬럼 — 새 행의 제목을 받는다. */
  titlePropertyId: string | null
  rows: RowJson[]
  undated: number
  truncated: boolean
  access: DatabaseAccess
  search?: string | null
}) {
  const { workspaceId, viewId, tableName, month, datePropertyId, titlePropertyId, access } = props
  const router = useRouter()
  const pathname = usePathname()
  const today = useToday()
  const [rows, setRows] = useState<readonly RowJson[]>(props.rows)
  const [busyDay, setBusyDay] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditingState] = useState<Editing | null>(null)
  const editingRef = useRef<Editing | null>(null)
  const setEditing = (next: Editing | null) => {
    editingRef.current = next
    setEditingState(next)
  }
  const titleInputRef = useRef<HTMLInputElement>(null)
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
    const result = await api.updateCell(workspaceId, e.rowId, titlePropertyId, parsed.value)
    if (!result.ok) {
      setRows((current) => current.map((r) => (r.id === e.rowId ? withValue(r, previous) : r)))
      setError(result.message)
      return
    }
    const saved = result.value
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

  const [year, monthNumber] = month.split('-')
  const todayMonth = today?.slice(0, 7) ?? null

  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={tableName || UNTITLED} data-testid="db-calendar" data-month={month}>
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
          <span
            data-testid="db-cal-undated"
            title="날짜 속성이 비어 있는 행은 달력에 놓이지 않습니다"
            className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            날짜 없음 {props.undated}개
          </span>
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
                    className={`group/day relative border-b border-r border-neutral-200 dark:border-neutral-800 ${outside ? 'bg-neutral-50 dark:bg-neutral-900/50' : ''}`}
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
                      <span data-testid="db-cal-more" className="absolute bottom-0.5 left-1.5 text-[11px] text-neutral-500">
                        +{hidden[i]}
                      </span>
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
                    className={`absolute flex items-center overflow-hidden border border-neutral-200 bg-white px-1.5 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-950 ${
                      p.continuesBefore ? 'rounded-l-none' : 'rounded-l'
                    } ${p.continuesAfter ? 'rounded-r-none' : 'rounded-r'}`}
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
                        href={`/w/${workspaceId}/${row.id}`}
                        data-testid="db-cal-event-open"
                        title={row.title || UNTITLED}
                        className={`flex min-w-0 items-center gap-1 truncate hover:underline ${row.title ? '' : 'text-neutral-400'}`}
                      >
                        <PageIconView icon={row.icon} fallback />
                        <span className="truncate" data-testid="db-cal-event-title">
                          {row.title || UNTITLED}
                        </span>
                      </Link>
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
      {error && (
        <p role="alert" data-testid="db-error" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  )
}
