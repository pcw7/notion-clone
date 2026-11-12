'use client'

/**
 * 대시보드의 편집 화면 — DB-3 (F-04-20 · "편집" 을 누를 때 받는 청크)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 DB-1] ② ③ ⑤
 *
 * - 위젯 넣기: 이 데이터베이스에 붙은 소스(소유 · 연결) · 타입(표 · 보드 · 목록 · 갤러리 · 캘린더 · 타임라인 · 차트 · 지도) · 줄("새 줄" · 자리가
 *   있는 줄 — 줄 끝의 "+" 는 그 줄). 다른 데이터베이스의 소스는 먼저 연결한다(2l-3 의 고르개 그대로 — 연결하면 그 소스를 보는 표 탭도 함께
 *   생긴다). 자리가 없으면 서버가 `full`.
 * - 옮기기: 손잡이를 끌거나 메뉴의 왼쪽 · 오른쪽 · 위 줄 · 아래 줄(키보드로 닿는 대안). 배치를 통째로, 읽은 판(`updatedAt`)과 함께 보낸다 —
 *   그 사이 다른 사람이 고쳤으면 `conflict`: 말하고 다시 읽는다(남의 옮기기를 덮지 않는다).
 * - 지우기: 메뉴 안에서 한 번 더 묻는다. 줄 높이: 줄 끝에서 작게 · 보통 · 크게. 위젯 이름: 머리의 칸(보통 뷰의 이름 바꾸기 명령).
 *
 * 놓을 자리 · 옮긴 배치는 `dashboard-edit.ts` 가 정한다(순수). 고치면 서버 렌더를 다시 받는다 — 위젯은 서버가 다시 흘려 보낸다.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { DatabaseListItem } from '@/lib/database/database'
import { dashboardGrid } from '@/lib/database/dashboard-grid'
import {
  DASHBOARD_HEIGHTS,
  MAX_DASHBOARD_ROWS,
  WIDGET_VIEW_TYPES,
  type DashboardHeight,
  type DashboardLayout,
  type WidgetViewType,
} from '@/lib/database/dashboard-layout'
import {
  DASHBOARD_DRAG_THRESHOLD,
  canAddWidget,
  dropLine,
  dropTarget,
  dropWidget,
  layoutOfGrid,
  moveWidget,
  rowHasRoom,
  setRowHeight,
  type DropLine,
  type MoveDirection,
  type RowBox,
} from '@/lib/database/dashboard-edit'
import { useDashboardEdit, type DashboardSourceOption, type EditNotice, type EditUi } from './dashboard-edit-frame'
import { LinkPicker, candidateLabel } from './data-source-panel'
import { VIEW_TYPE_ICON } from './view-tabs'
import * as api from './table-api'

const FULL_MESSAGE = '위젯은 12개 · 줄은 3개까지입니다'
const CONFLICT_MESSAGE = '다른 사람이 대시보드를 고쳤습니다 — 다시 불러왔습니다'

const TYPE_LABEL: Readonly<Record<WidgetViewType, string>> = {
  table: '표',
  board: '보드',
  list: '목록',
  gallery: '갤러리',
  calendar: '캘린더',
  timeline: '타임라인',
  chart: '차트',
  map: '지도',
}
const HEIGHT_LABEL: Readonly<Record<DashboardHeight, string>> = { small: '작게', medium: '보통', large: '크게' }
const MOVE_LABEL: Readonly<Record<MoveDirection, string>> = { left: '← 왼쪽으로', right: '오른쪽으로 →', up: '↑ 위 줄로', down: '↓ 아래 줄로' }
const MOVES: readonly MoveDirection[] = ['left', 'right', 'up', 'down']

const MENU_ITEM = 'block w-full rounded px-2 py-1 text-left text-sm hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800'
const QUIET_BUTTON =
  'rounded px-1.5 py-0.5 text-sm text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'

// ── 서버 ──────────────────────────────────────────────────────────────

type DetailJson = { readonly layout: DashboardLayout; readonly updatedAt: string; readonly widgets: readonly { readonly id: string }[] }
type WriteResult = { readonly ok: true; readonly detail: DetailJson } | { readonly ok: false; readonly reason: string | null; readonly message: string }

/** 대시보드 명령 — `full` · `conflict` 는 이 화면의 말로, 나머지는 표 화면과 같은 말로(`table-api.ts`). 던지지 않는다. */
async function write(url: string, init: RequestInit): Promise<WriteResult> {
  try {
    const res = await fetch(url, init)
    const body = (await res.json().catch(() => null)) as { dashboard?: DetailJson; error?: unknown } | null
    if (res.ok && body?.dashboard !== undefined) return { ok: true, detail: body.dashboard }
    const reason = typeof body?.error === 'string' ? body.error : null
    const message =
      reason === 'full' ? FULL_MESSAGE : reason === 'conflict' ? CONFLICT_MESSAGE : api.messageOf(res.status, body as Parameters<typeof api.messageOf>[1])
    return { ok: false, reason, message }
  } catch {
    return { ok: false, reason: null, message: '연결에 실패했습니다. 바뀐 내용이 저장되지 않았습니다.' }
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' }

/** 이 대시보드를 고치는 명령들 — 바쁨 · 알림을 틀의 상태에 쓰고, 고친 뒤 서버 렌더를 다시 받는다. */
function useWrites() {
  const edit = useDashboardEdit()
  const url = `/api/workspaces/${edit.workspaceId}/views/${edit.dashboardId}/dashboard`
  const begin = () => edit.setUi((ui) => ({ ...ui, busy: true, notice: null }))
  const finish = (notice: EditNotice | null, more: Partial<EditUi> = {}) => edit.setUi((ui) => ({ ...ui, busy: false, notice, ...more }))
  const settle = (result: WriteResult, more: Partial<EditUi> = {}): boolean => {
    if (!result.ok) {
      finish({ tone: result.reason === 'conflict' ? 'warn' : 'error', text: result.message })
      // 남이 먼저 고쳤다 — 다시 읽는다(내 것을 다시 보내지 않는다)
      if (result.reason === 'conflict') edit.refresh()
      return false
    }
    finish(null, more)
    edit.accept({ layout: layoutOfGrid(dashboardGrid(result.detail.layout, result.detail.widgets)), updatedAt: result.detail.updatedAt })
    edit.refresh()
    return true
  }

  return {
    /** 옮기기 · 줄 높이 — 배치를 통째로, 읽은 판과 함께. */
    saveLayout: async (layout: DashboardLayout): Promise<boolean> => {
      begin()
      const result = await write(url, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ layout, updatedAt: edit.updatedAt }) })
      return settle(result)
    },
    /** 위젯 넣기 — 넣으면 넣기 창을 닫는다. 실패의 말은 창이 보인다(돌려준다). */
    addWidget: async (input: { readonly dataSourceId: string; readonly type: WidgetViewType; readonly row: number | null }): Promise<WriteResult> => {
      edit.setUi((ui) => ({ ...ui, busy: true, notice: null }))
      const result = await write(`${url}/widgets`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ dataSourceId: input.dataSourceId, type: input.type, name: TYPE_LABEL[input.type], ...(input.row === null ? {} : { row: input.row }) }),
      })
      if (!result.ok) {
        finish(null)
        return result
      }
      settle(result, { adding: null })
      return result
    },
    removeWidget: async (widgetId: string): Promise<boolean> => {
      begin()
      return settle(await write(`${url}/widgets/${widgetId}`, { method: 'DELETE' }))
    },
    /** 위젯 이름 — 위젯은 보통의 뷰다(같은 이름 바꾸기 명령). 배치의 판은 바뀌지 않는다. */
    renameWidget: async (widgetId: string, name: string): Promise<boolean> => {
      begin()
      const result = await api.updateView(edit.workspaceId, widgetId, { name })
      if (!result.ok) {
        finish({ tone: 'error', text: result.message })
        return false
      }
      finish(null)
      edit.refresh()
      return true
    },
  }
}

function Notice({ notice }: { readonly notice: EditNotice }) {
  return (
    <p
      role="alert"
      data-testid="db-dashboard-notice"
      data-tone={notice.tone}
      className={`text-sm ${notice.tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}
    >
      {notice.text}
    </p>
  )
}

// ── 위의 줄 ───────────────────────────────────────────────────────────

/** 편집 모드의 위 줄 — 알림 · "위젯 넣기" · "완료". */
export function EditBar() {
  const edit = useDashboardEdit()
  const working = edit.ui.busy || edit.pending
  const open = edit.ui.adding !== null && edit.ui.adding.row === null
  return (
    <>
      {edit.ui.notice !== null && <Notice notice={edit.ui.notice} />}
      {working && (
        <span data-testid="db-dashboard-saving" className="text-xs text-neutral-400">
          저장하는 중…
        </span>
      )}
      <span className="relative">
        <button
          type="button"
          data-testid="db-dashboard-add"
          aria-expanded={open}
          onClick={() => edit.setUi((ui) => ({ ...ui, notice: null, adding: open ? null : { row: null } }))}
          className="rounded px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          + 위젯 넣기
        </button>
        {open && <AddPanel row={null} />}
      </span>
      <button
        type="button"
        data-testid="db-dashboard-done"
        onClick={edit.leave}
        className="rounded bg-neutral-800 px-2 py-1 text-sm text-white hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900"
      >
        완료
      </button>
    </>
  )
}

// ── 위젯 넣기 ─────────────────────────────────────────────────────────

/** 넣기 창 — 소스 · 줄 · 타입(누르면 넣는다). `row` 는 줄 끝의 "+" 로 열었을 때 그 줄. */
function AddPanel({ row }: { readonly row: number | null }) {
  const edit = useDashboardEdit()
  const { addWidget } = useWrites()
  /** 방금 연결한 소스 — 다시 받은 서버 렌더가 들여올 때까지 여기서 고르개에 세운다. */
  const [linked, setLinked] = useState<DashboardSourceOption[]>([])
  const options = [...edit.sources, ...linked.filter((l) => !edit.sources.some((s) => s.id === l.id))]
  const [source, setSource] = useState(options[0]?.id ?? '')
  const roomy = edit.layout.rows.map((_, i) => i).filter((i) => rowHasRoom(edit.layout, i))
  const canNewRow = edit.layout.rows.length < MAX_DASHBOARD_ROWS
  const [where, setWhere] = useState(row !== null ? String(row) : canNewRow ? 'new' : String(roomy.at(-1) ?? 'new'))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const full = !canAddWidget(edit.layout)

  // 다른 데이터베이스 연결(2l-3 의 고르개)
  const [candidates, setCandidates] = useState<DatabaseListItem[] | null>(null)
  const [target, setTarget] = useState('')
  const [query, setQuery] = useState('')
  const applyCandidates = (listed: readonly DatabaseListItem[]) => {
    const attached = new Set(options.map((s) => s.id))
    const choices = listed.filter((item) => item.id !== edit.databaseId && !attached.has(item.dataSourceId))
    setCandidates(choices)
    setTarget((was) => (choices.some((c) => c.dataSourceId === was) ? was : (choices[0]?.dataSourceId ?? '')))
  }
  const linkOpen = candidates !== null
  useEffect(() => {
    if (!linkOpen) return
    let alive = true
    const timer = window.setTimeout(() => {
      void api.listDatabases(edit.workspaceId, query).then((listed) => {
        if (alive && listed.ok) applyCandidates(listed.value)
      })
    }, 200)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // 후보를 정하는 함수는 소스 목록으로만 달라진다 — 검색어 · 열림만 본다(데이터 소스 창과 같다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, linkOpen, edit.workspaceId])

  const openLink = async () => {
    setError(null)
    setBusy(true)
    setQuery('')
    const listed = await api.listDatabases(edit.workspaceId)
    setBusy(false)
    if (!listed.ok) {
      setError(listed.message)
      return
    }
    applyCandidates(listed.value)
  }
  const link = async () => {
    if (target === '') return
    setBusy(true)
    setError(null)
    const linkedNow = await api.attachLinkedSource(edit.workspaceId, edit.databaseId, target)
    setBusy(false)
    if (!linkedNow.ok) {
      setError(linkedNow.message)
      return
    }
    const item = candidates?.find((c) => c.dataSourceId === target)
    setLinked((was) => [...was, { id: target, name: item === undefined ? '연결한 소스' : candidateLabel(item), owned: false }])
    setSource(target)
    setCandidates(null)
    // 그릇에 붙었다 — 소스 목록(과 새 탭)이 서버 렌더로 따라온다
    edit.refresh()
  }

  const add = async (type: WidgetViewType) => {
    if (source === '') return
    setBusy(true)
    setError(null)
    const result = await addWidget({ dataSourceId: source, type, row: where === 'new' ? null : Number(where) })
    setBusy(false)
    if (!result.ok) setError(result.message)
  }

  const close = () => edit.setUi((ui) => ({ ...ui, adding: null }))
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      close()
    }
  }
  const disabled = busy || edit.ui.busy || edit.pending

  return (
    <div
      role="dialog"
      aria-label="위젯 넣기"
      data-testid="db-dashboard-add-panel"
      onKeyDown={onKeyDown}
      // 위의 "위젯 넣기" 면 단추 아래 · 줄 끝의 "+" 면 줄 높이 고르개 아래(줄 끝은 줄의 높이만큼 길다)
      className={`absolute right-0 z-30 flex w-72 flex-col gap-2 popover-surface p-2 text-left ${row === null ? 'top-full mt-1' : 'top-10'}`}
    >
      {full ? (
        <p role="note" data-testid="db-dashboard-add-full" className="text-sm text-neutral-600 dark:text-neutral-300">
          {FULL_MESSAGE}
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            볼 데이터 소스
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              aria-label="볼 데이터 소스"
              data-testid="db-dashboard-add-source"
              className="rounded border border-neutral-200 bg-transparent px-1.5 py-1 text-sm text-neutral-800 dark:border-neutral-700 dark:text-neutral-100"
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.owned ? option.name : `${option.name} ↗`}
                </option>
              ))}
            </select>
          </label>
          {candidates === null ? (
            <button type="button" data-testid="db-dashboard-link" disabled={disabled} onClick={() => void openLink()} className={`${MENU_ITEM} text-xs text-neutral-500`}>
              다른 데이터베이스 연결…
            </button>
          ) : (
            <LinkPicker
              candidates={candidates}
              target={target}
              busy={disabled}
              query={query}
              onQuery={setQuery}
              onTarget={setTarget}
              onConfirm={() => void link()}
              onCancel={() => setCandidates(null)}
            />
          )}
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            넣을 줄
            <select
              value={where}
              onChange={(e) => setWhere(e.target.value)}
              aria-label="넣을 줄"
              data-testid="db-dashboard-add-row"
              className="rounded border border-neutral-200 bg-transparent px-1.5 py-1 text-sm text-neutral-800 dark:border-neutral-700 dark:text-neutral-100"
            >
              {canNewRow && <option value="new">새 줄</option>}
              {roomy.map((i) => (
                <option key={i} value={String(i)}>
                  {i + 1}번째 줄에
                </option>
              ))}
            </select>
          </label>
          <div role="group" aria-label="위젯 타입" className="grid grid-cols-2 gap-0.5">
            {WIDGET_VIEW_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                data-testid={`db-dashboard-add-type-${type}`}
                disabled={disabled || source === ''}
                onClick={() => void add(type)}
                className={MENU_ITEM}
              >
                <span aria-hidden className="mr-1.5 text-neutral-400">
                  {VIEW_TYPE_ICON[type] ?? '▦'}
                </span>
                {TYPE_LABEL[type]}
              </button>
            ))}
          </div>
        </>
      )}
      {error !== null && (
        <p role="alert" data-testid="db-dashboard-add-error" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <button type="button" data-testid="db-dashboard-add-close" onClick={close} className="self-end rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
        닫기
      </button>
    </div>
  )
}

// ── 위젯 머리 ─────────────────────────────────────────────────────────

/** 편집 모드의 위젯 머리 — 손잡이 · 메뉴(옮기기 · 지우기) · 이름 칸. `name` 이 null 이면 볼 수 없는 위젯(이름 없이 · 머리째 그린다). */
export function WidgetControls({ widgetId, name }: { readonly widgetId: string; readonly name: string | null }) {
  const edit = useDashboardEdit()
  const { saveLayout, removeWidget } = useWrites()
  const [menu, setMenu] = useState(false)
  const [asking, setAsking] = useState(false)
  const boxRef = useRef<HTMLSpanElement>(null)
  const disabled = edit.ui.busy || edit.pending
  const label = name ?? '볼 수 없는 위젯'
  const moves = MOVES.flatMap((direction) => {
    const next = moveWidget(edit.layout, widgetId, direction)
    return next === null ? [] : [{ direction, next }]
  })

  // 바깥을 누르면 메뉴를 닫는다
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) {
        setMenu(false)
        setAsking(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const onMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      setMenu(false)
      setAsking(false)
    }
  }

  const controls = (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <button
        type="button"
        data-testid="db-widget-handle"
        aria-label={`${label} 끌어 옮기기`}
        title="끌어 옮기기"
        disabled={disabled}
        onPointerDown={(event) => {
          if (event.button !== 0 || disabled) return
          // 글자 고르기 · 포커스 옮기기를 막는다 — 끌기는 창의 포인터 사건이 따라간다(`DragLayer`)
          event.preventDefault()
          edit.startGrab({ id: widgetId, x: event.clientX, y: event.clientY, active: false })
        }}
        className={`${QUIET_BUTTON} shrink-0 cursor-grab touch-none`}
      >
        ⠿
      </button>
      <span ref={boxRef} className="relative shrink-0">
        <button
          type="button"
          data-testid="db-widget-menu"
          aria-label={`${label} 위젯 메뉴`}
          aria-expanded={menu}
          onClick={() => {
            setAsking(false)
            setMenu((was) => !was)
          }}
          className={QUIET_BUTTON}
        >
          ⋯
        </button>
        {menu && (
          <div
            role="menu"
            aria-label="위젯 메뉴"
            data-testid="db-widget-menu-panel"
            onKeyDown={onMenuKeyDown}
            className="absolute left-0 top-full z-30 mt-1 w-48 popover-surface p-1"
          >
            {moves.map(({ direction, next }) => (
              <button
                key={direction}
                type="button"
                role="menuitem"
                data-testid={`db-widget-move-${direction}`}
                disabled={disabled}
                onClick={() => {
                  setMenu(false)
                  void saveLayout(next)
                }}
                className={MENU_ITEM}
              >
                {MOVE_LABEL[direction]}
              </button>
            ))}
            {!asking ? (
              <button
                type="button"
                role="menuitem"
                data-testid="db-widget-remove"
                disabled={disabled}
                onClick={() => setAsking(true)}
                className={`${MENU_ITEM} text-red-600 dark:text-red-400`}
              >
                지우기
              </button>
            ) : (
              <div role="group" aria-label="위젯 지우기" data-testid="db-widget-remove-ask" className="mt-1 flex flex-col gap-1.5 px-2 py-1 text-xs">
                <p>
                  {name === null ? '이 위젯' : <strong>{name}</strong>}을(를) 대시보드에서 지웁니다. 항목은 그대로입니다.
                </p>
                <div className="flex gap-1">
                  <button
                    type="button"
                    data-testid="db-widget-remove-confirm"
                    disabled={disabled}
                    // 묻는 상자가 열리면 곧바로 Enter 로 확정할 수 있게
                    autoFocus
                    onClick={() => {
                      setMenu(false)
                      setAsking(false)
                      void removeWidget(widgetId)
                    }}
                    className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-700 disabled:opacity-40"
                  >
                    지우기
                  </button>
                  <button
                    type="button"
                    data-testid="db-widget-remove-cancel"
                    onClick={() => setAsking(false)}
                    className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </span>
      {name === null ? (
        <span className="truncate text-sm text-neutral-500">볼 수 없는 위젯</span>
      ) : (
        <NameInput widgetId={widgetId} name={name} disabled={disabled} />
      )}
    </div>
  )
  // 볼 수 없는 위젯은 머리가 없다 — 머리째 그린다(위젯 틀의 머리와 같은 모양)
  return name === null ? <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">{controls}</div> : controls
}

/** 위젯 이름 칸 — Enter · 떠나면 저장 · Esc 는 되돌린다. 빈 이름 · 같은 이름은 보내지 않는다. */
function NameInput({ widgetId, name, disabled }: { readonly widgetId: string; readonly name: string; readonly disabled: boolean }) {
  const { renameWidget } = useWrites()
  const [draft, setDraft] = useState(name)
  // 서버의 이름이 바뀌면(다시 받음) 칸도 따라간다
  const [seen, setSeen] = useState(name)
  if (seen !== name) {
    setSeen(name)
    setDraft(name)
  }
  const skip = useRef(false)
  const commit = () => {
    if (skip.current) {
      skip.current = false
      return
    }
    const next = draft.replace(/\s+/g, ' ').trim()
    if (next === '' || next === name) {
      setDraft(name)
      return
    }
    void renameWidget(widgetId, next)
  }
  return (
    <input
      type="text"
      data-testid="db-widget-rename"
      aria-label="위젯 이름"
      value={draft}
      maxLength={200}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          skip.current = true
          setDraft(name)
          e.currentTarget.blur()
        }
      }}
      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-neutral-700 hover:border-neutral-200 focus:border-neutral-300 focus:outline-none dark:text-neutral-200 dark:hover:border-neutral-700"
    />
  )
}

// ── 줄 끝 ─────────────────────────────────────────────────────────────

/** 줄 끝 — 줄 높이(작게 · 보통 · 크게) · 자리가 있으면 "+"(이 줄에 위젯 넣기). */
export function RowControls({ row }: { readonly row: number }) {
  const edit = useDashboardEdit()
  const { saveLayout } = useWrites()
  const current = edit.layout.rows[row]
  if (current === undefined) return null
  const disabled = edit.ui.busy || edit.pending
  const open = edit.ui.adding !== null && edit.ui.adding.row === row
  return (
    <div data-testid="db-dashboard-row-controls" className="relative flex shrink-0 flex-row gap-2 md:w-24 md:flex-col">
      <select
        value={current.height}
        aria-label={`${row + 1}번째 줄 높이`}
        data-testid="db-dashboard-row-height"
        disabled={disabled}
        onChange={(e) => {
          const next = setRowHeight(edit.layout, row, e.target.value as DashboardHeight)
          if (next !== null) void saveLayout(next)
        }}
        className="rounded border border-neutral-200 bg-transparent px-1.5 py-1 text-sm text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
      >
        {DASHBOARD_HEIGHTS.map((height) => (
          <option key={height} value={height}>
            {HEIGHT_LABEL[height]}
          </option>
        ))}
      </select>
      {rowHasRoom(edit.layout, row) && (
        <button
          type="button"
          data-testid="db-dashboard-row-add"
          aria-label={`${row + 1}번째 줄에 위젯 넣기`}
          aria-expanded={open}
          onClick={() => edit.setUi((ui) => ({ ...ui, notice: null, adding: open ? null : { row } }))}
          className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-300 px-3 py-1 text-lg text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          +
        </button>
      )}
      {open && <AddPanel row={row} />}
    </div>
  )
}

// ── 끌기 ──────────────────────────────────────────────────────────────

/** 격자의 줄 · 칸 자리 — 서버가 그린 격자에서 잰다. */
function measure(grid: HTMLElement | null): RowBox[] {
  return [...(grid?.querySelectorAll<HTMLElement>('[data-testid="db-dashboard-row"]') ?? [])].map((rowEl) => {
    const r = rowEl.getBoundingClientRect()
    return {
      top: r.top,
      bottom: r.bottom,
      cells: [...rowEl.querySelectorAll<HTMLElement>(':scope > [data-testid="db-widget"]')].map((el) => {
        const c = el.getBoundingClientRect()
        return { id: el.dataset.widgetId ?? '', left: c.left, width: c.width }
      }),
    }
  })
}

/** 끄는 동안의 놓을 자리 줄 — 창의 포인터 사건을 듣고, 놓으면 배치를 보낸다. 끌고 있는 위젯은 흐리게(`data-dragging`). */
export function DragLayer() {
  const edit = useDashboardEdit()
  const { saveLayout } = useWrites()
  const [line, setLine] = useState<{ readonly line: DropLine; readonly left: number; readonly top: number } | null>(null)

  useEffect(() => {
    const grid = () => edit.gridRef.current
    const mark = (id: string, on: boolean) => {
      const el = grid()?.querySelector<HTMLElement>(`[data-testid="db-widget"][data-widget-id="${id}"]`)
      if (el === null || el === undefined) return
      if (on) el.dataset.dragging = 'true'
      else delete el.dataset.dragging
    }
    const plan = (id: string, x: number, y: number) => {
      const rows = measure(grid())
      const target = dropTarget(rows, id, x, y)
      const next = target === null ? null : dropWidget(edit.layout, id, target)
      return { rows, target, next }
    }
    const onMove = (event: PointerEvent) => {
      const g = edit.peekGrab()
      if (g === null) return
      if (!g.active && Math.hypot(event.clientX - g.x, event.clientY - g.y) <= DASHBOARD_DRAG_THRESHOLD) return
      if (!g.active) {
        g.active = true
        mark(g.id, true)
      }
      const { rows, target, next } = plan(g.id, event.clientX, event.clientY)
      const box = grid()?.getBoundingClientRect()
      const drawn = next === null || target === null ? null : dropLine(rows, g.id, target)
      setLine(drawn === null ? null : { line: drawn, left: box?.left ?? 0, top: box?.top ?? 0 })
    }
    const onUp = (event: PointerEvent) => {
      const g = edit.takeGrab()
      if (g === null || !g.active) return
      mark(g.id, false)
      setLine(null)
      const { next } = plan(g.id, event.clientX, event.clientY)
      if (next !== null) void saveLayout(next)
    }
    const onCancel = () => {
      const g = edit.takeGrab()
      if (g !== null) mark(g.id, false)
      setLine(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  })

  if (line === null) return null
  const { line: at, left, top } = line
  return at.kind === 'vertical' ? (
    <span
      aria-hidden
      data-testid="db-dashboard-drop-line"
      style={{ left: at.x - left - 1, top: at.top - top, height: at.bottom - at.top }}
      className="pointer-events-none absolute w-0.5 bg-blue-500"
    />
  ) : (
    <span aria-hidden data-testid="db-dashboard-drop-line" style={{ top: at.y - top - 1 }} className="pointer-events-none absolute left-0 right-0 h-0.5 bg-blue-500" />
  )
}
