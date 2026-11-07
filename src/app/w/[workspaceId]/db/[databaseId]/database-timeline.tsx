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
 * 이 화면은 지연 로드되는 조각이다(`database-timeline-lazy.tsx`) — 도구줄(늘 실리는 쪽)에는 아무것도 더하지 않는다(정본 [보강 TL-2] ⑤).
 */

import Link from '@/app/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { cellDays } from '@/lib/database/calendar'
import { rowOpenHref } from '@/lib/database/open-pages'
import type { RowJson } from '@/lib/database/http'
import { TIMELINE_ZOOMS, type TimelineZoom } from '@/lib/database/timeline'
import {
  headerTicks,
  placeBar,
  shiftWindow,
  todayX,
  windowForToday,
  windowFrom,
  windowWidth,
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
  search?: string | null
  /** 행을 여는 주소의 바탕(8n-1 · F-02-20) — null 이면 행 화면으로. */
  peekBase?: string | null
  /** 서버 화면이 읽기 전의 시각(ms) — 구독이 붙기 전의 변경을 메운다(#250). */
  renderedAt?: number
}) {
  const { workspaceId, viewId, canEditStructure } = props
  const router = useRouter()
  const today = useToday(props.today)
  const [win, setWin] = useState<TimelineWindow>({ from: props.from, to: props.to })
  const [zoom, setZoom] = useState<TimelineZoom>(props.zoom)
  const [showTable, setShowTable] = useState(props.showTable)
  const [datePropertyId, setDatePropertyId] = useState(props.datePropertyId)
  const [rows, setRows] = useState<readonly RowJson[]>(props.rows)
  const [undated, setUndated] = useState(props.undated)
  const [truncated, setTruncated] = useState(props.truncated)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const winRef = useRef(win)
  const seq = useRef(0)

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
          setRows(body.rows)
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
    [workspaceId, viewId, props.search],
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
      className="flex flex-col gap-2"
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
          <span data-testid="timeline-undated" className="text-neutral-500">
            날짜 없음 {undated}
          </span>
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

        <div data-testid="timeline-scroll" className="min-w-0 flex-1 overflow-x-auto">
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
              const days = cellDays(row.properties[datePropertyId])
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
                        data-start={days.start}
                        data-end={days.end}
                        aria-label={`${title} · ${days.start} ~ ${days.end}`}
                        title={title}
                        className={`absolute top-1.5 flex items-center overflow-hidden bg-blue-500/80 px-1 text-xs whitespace-nowrap text-white hover:bg-blue-600 ${
                          place.clippedStart ? '' : 'rounded-l'
                        } ${place.clippedEnd ? '' : 'rounded-r'}`}
                        style={{ left: place.left, width: Math.max(place.width, 3), height: ROW_PX - 12 }}
                      >
                        {inside ? title : null}
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
      {rows.length === 0 && (
        <p className="px-2 text-sm text-neutral-500" data-testid="timeline-empty">
          이 기간에 걸친 행이 없습니다.
        </p>
      )}
    </div>
  )
}
