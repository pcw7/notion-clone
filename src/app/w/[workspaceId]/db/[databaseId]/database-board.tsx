'use client'

/**
 * 보드 — 보드 4b조각 (F-04-03 Board · F-04-11 Group by · F-04-15 그룹별 "더 보기")
 *
 * 정본: 04-database-views.md F-04-03 · F-04-11 · F-04-15 / 00-canonical-data-model.md §3.6
 *
 * 규칙(어디에 놓이는가 · 상태가 어떻게 바뀌는가 · 되돌리려면 어디로)은 `lib/database/board-drag.ts` 에 있고 DOM 없이
 * 검사된다. 여기 남는 것은 좌표를 재고, 요청을 보내고, 실패하면 되돌리는 일이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 드롭은 요청 하나다 — 먼저 옮기고, 거부되면 `undo` 자리로 되돌린다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `api.moveCard` 하나가 셀 값과 자리를 한 트랜잭션으로 쓴다(마스터 문서 §5.2 4번 · §3.3-148). 화면은 `moveCard`(순수)로
 * 먼저 옮기고, 거부되면 그것이 돌려준 `undo` 자리로 다시 옮긴다 — **롤백 단위 = 서버 API 단위**(F-04-25 의 권고: 셀 값 +
 * 순서 둘을 따로 되돌리는 코드를 두지 않는다). 성공하면 서버가 준 행으로 갈아 끼우되, 들고 있는 것보다 낮은 `version` 은
 * 버린다(`database-table.tsx` 와 같은 규칙).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 정렬된 보드는 열 사이 이동만이다 (§3.3-149)
 * ──────────────────────────────────────────────────────────────────────
 *
 * `manualOrder: false` 면 열 안 드래그는 아무 일도 없다(`resolveDrop` 이 null). 열 사이 이동은 셀 값만 바꾸고, 옮긴 카드가
 * 그 열의 어디에 오는지는 정렬이 정한다 — 서버 응답에는 정렬 위치가 없으므로 **그 열의 첫 페이지를 다시 읽는다.**
 *
 * ──────────────────────────────────────────────────────────────────────
 * 그룹 설정은 서버 렌더를 다시 받고, 카드는 로컬 상태다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 숨기기 · 보이기는 `groupBy` 저장(`edit_structure` — F-04-03 의 분리)이고, 저장 뒤 `router.refresh()`. 보드는 `groupBy` 를
 * 담은 key 로 새로 마운트된다(`page.tsx`). 카드 이동 · 새 카드 · "더 보기"는 로컬이다 — 다시 읽으면 불러온 페이지를 잃는다.
 *
 * 숨긴 그룹 띠에는 `data-group-key` 가 없어 드롭 자리 측정(`measure`)에 잡히지 않는다 — F-04-03: *"숨긴 그룹으로
 * 드래그 → 드롭 타겟 없음."*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 보드 안에 팝오버를 두지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 보드는 가로 스크롤 상자다. 그 안의 절대 위치 팝오버는 세로로 잘린다(`database-table.tsx` 머리말의 CSS 규칙). 열 머리의
 * 동작은 버튼 둘(`+` · 숨기기)이고 메뉴가 없다. 그룹 기준 · 빈 그룹 숨김은 도구줄의 "그룹" 패널(`view-toolbar.tsx`)이
 * 보드 밖에서 연다. 새 카드의 제목 편집은 카드 안의 입력칸이다.
 */

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { useRouter } from 'next/navigation'

import type { DatabaseAccess } from '@/lib/database/database'
import type { RowJson } from '@/lib/database/http'
import type { GroupBy } from '@/lib/database/group'
import type { ViewColumn } from '@/lib/database/view'
import type { GroupableType, SelectOption } from '@/lib/database/property-types'
import { isEmptyValue, readRelationValue } from '@/lib/database/property-types'
import { cellText, parseDraft, readCell, sameValue } from '@/lib/database/cell-format'
import {
  groupLabel,
  moveCard,
  prefillCells,
  resolveDrop,
  type ColumnBox,
  type DropTarget,
} from '@/lib/database/board-drag'
import * as api from './table-api'
import { CellDisplay, OptionChip, RelationChips, type RelationLabels } from './cell-view'
import { useRelationLabels } from './use-relation-labels'

/** `GET /groups` 의 그룹 하나 — 행은 `rowJson`. 서버 렌더(`page.tsx`)도 같은 모양으로 내려준다. */
export type BoardGroupJson = {
  readonly key: string
  readonly option: SelectOption | null
  readonly count: number
  readonly hidden: boolean
  readonly rows: readonly RowJson[]
  readonly hasMore: boolean
  readonly nextCursor: string | null
}

export type GroupProperty = {
  readonly id: string
  readonly name: string
  readonly type: GroupableType
}

/** 이만큼 움직여야 드래그다. 그 전에 놓으면 클릭(포커스)이다. */
const DRAG_THRESHOLD_PX = 4
const UNTITLED = '제목 없음'

type Drag = {
  readonly id: string
  readonly fromKey: string
  readonly startX: number
  readonly startY: number
  moved: boolean
  layout: readonly ColumnBox[]
  target: DropTarget | null
}

type Editing = { readonly rowId: string; readonly draft: string }

/** 표시 순서가 뒤에 오는 응답인가. 버전은 bigint 문자열이다. */
const notOlder = (incoming: string, current: string): boolean => BigInt(incoming) >= BigInt(current)

const sameTarget = (a: DropTarget | null, b: DropTarget | null): boolean =>
  a === b || (a !== null && b !== null && a.key === b.key && a.beforeRowId === b.beforeRowId)

export function DatabaseBoard(props: {
  workspaceId: string
  viewId: string
  tableName: string
  /** 보이는 컬럼만, 뷰 순서로. 카드의 배지가 이 순서다. */
  columns: ViewColumn[]
  property: GroupProperty
  groupBy: GroupBy
  manualOrder: boolean
  groups: BoardGroupJson[]
  access: DatabaseAccess
  /** 첫 화면의 relation 제목(서버 렌더가 준다). 그 뒤에 온 카드의 것은 `useRelationLabels` 가 받는다. */
  relationLabels: RelationLabels
}) {
  const { workspaceId, viewId, tableName, columns, property, groupBy, manualOrder, access } = props
  const router = useRouter()

  const [groups, setGroupsState] = useState<readonly BoardGroupJson[]>(props.groups)
  const [error, setError] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [editing, setEditingState] = useState<Editing | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [loadingKey, setLoadingKey] = useState<string | null>(null)

  /**
   * 지금 상태의 동기 사본. 드롭 → 낙관적 갱신 → 응답 → 갈아 끼우기가 한 상태에서 이어지도록 모든 갱신이 여기를 거친다
   * (`database-table.tsx` 의 `modeRef` 와 같은 이유 — 이벤트 여러 개가 렌더 전의 상태를 보면 두 번 적용된다).
   */
  const groupsRef = useRef(groups)
  const update = (next: (current: readonly BoardGroupJson[]) => readonly BoardGroupJson[]) => {
    groupsRef.current = next(groupsRef.current)
    setGroupsState(groupsRef.current)
  }
  const editingRef = useRef<Editing | null>(null)
  const setEditing = (next: Editing | null) => {
    editingRef.current = next
    setEditingState(next)
  }

  const boardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const dropRef = useRef<DropTarget | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const titleColumn = columns.find((c) => c.type === 'title') ?? null
  /** 카드의 배지 — 제목과 그룹 프로퍼티(열이 곧 그 값이다)는 뺀다. */
  const badgeColumns = columns.filter((c) => c.type !== 'title' && c.propertyId !== property.id)
  const labelOf = (group: BoardGroupJson) => groupLabel(property.type, property.name, group)

  useEffect(() => {
    if (editing !== null) titleInputRef.current?.focus()
  }, [editing])

  // ── 상태 도우미 ──────────────────────────────────────────────────────

  const mapRow = (
    current: readonly BoardGroupJson[],
    rowId: string,
    fn: (row: RowJson) => RowJson,
  ): readonly BoardGroupJson[] =>
    current.map((g) => (g.rows.some((r) => r.id === rowId) ? { ...g, rows: g.rows.map((r) => (r.id === rowId ? fn(r) : r)) } : g))

  const findRow = (rowId: string): RowJson | null => {
    for (const g of groupsRef.current) {
      const row = g.rows.find((r) => r.id === rowId)
      if (row) return row
    }
    return null
  }

  /** 서버가 준 행으로 갈아 끼운다. 늦게 온(버전이 낮은) 응답은 버린다. */
  const takeRow = (row: RowJson) =>
    update((current) => mapRow(current, row.id, (r) => (notOlder(row.version, r.version) ? row : r)))

  // ── 드래그 ──────────────────────────────────────────────────────────

  /** 열 · 카드의 사각형. 숨긴 그룹 띠는 `data-group-key` 가 없어 여기 없다(머리말). */
  const measure = (): ColumnBox[] => {
    const root = boardRef.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>('[data-group-key]')).map((column) => {
      const box = column.getBoundingClientRect()
      return {
        key: column.dataset.groupKey ?? '',
        left: box.left,
        right: box.right,
        cards: Array.from(column.querySelectorAll<HTMLElement>('[data-row-id]')).map((card) => {
          const r = card.getBoundingClientRect()
          return { id: card.dataset.rowId ?? '', top: r.top, bottom: r.bottom }
        }),
      }
    })
  }

  const endDrag = (): Drag | null => {
    const d = dragRef.current
    dragRef.current = null
    dropRef.current = null
    setDrop(null)
    setDraggingId(null)
    return d
  }

  // Esc 로 드래그 취소. capture 로 받는다 — 카드 안 입력칸의 Esc 보다 먼저.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || dragRef.current === null) return
      event.preventDefault()
      endDrag()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const onCardPointerDown = (row: RowJson, key: string, event: ReactPointerEvent<HTMLLIElement>) => {
    if (event.button !== 0 || !access.canEditContent) return
    if (editingRef.current?.rowId === row.id) return
    // 카드 안의 버튼 · 링크는 제 일을 한다.
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return
    // 끄는 동안 글자가 선택되지 않게. 포커스는 직접 준다.
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      id: row.id,
      fromKey: key,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      layout: [],
      target: null,
    }
  }

  const onCardPointerMove = (event: ReactPointerEvent<HTMLLIElement>) => {
    const d = dragRef.current
    if (!d) return
    if (!d.moved) {
      if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) < DRAG_THRESHOLD_PX) return
      d.moved = true
      // 좌표는 시작할 때 한 번 잰다 — 끄는 동안 카드는 자리를 바꾸지 않는다(놓을 때 옮긴다).
      d.layout = measure()
      setDraggingId(d.id)
    }
    d.target = resolveDrop(d.layout, { id: d.id, fromKey: d.fromKey }, event.clientX, event.clientY, manualOrder)
    if (!sameTarget(dropRef.current, d.target)) {
      dropRef.current = d.target
      setDrop(d.target)
    }
  }

  const onCardPointerUp = () => {
    const d = endDrag()
    if (!d || !d.moved || d.target === null) return
    void commitMove(d.id, d.fromKey, d.target)
  }

  const commitMove = async (rowId: string, fromKey: string, target: DropTarget) => {
    const moved = moveCard(groupsRef.current, rowId, target)
    if (moved === null) return
    setError(null)
    update(() => moved.columns)

    const result = await api.moveCard(workspaceId, viewId, {
      rowId,
      groupKey: target.key,
      beforeRowId: target.beforeRowId,
    })
    if (!result.ok) {
      // 롤백 단위 = 서버 API 단위(머리말). 그사이 다른 갱신이 있었어도 이 카드만 제자리로.
      update((current) => moveCard(current, rowId, moved.undo)?.columns ?? current)
      setError(result.message)
      return
    }
    takeRow(result.value.row)
    // 정렬된 보드: 옮긴 카드의 자리는 정렬이 정한다(머리말). 열 안 이동은 여기 오지 않는다(resolveDrop 이 null).
    if (!manualOrder && target.key !== fromKey) await reloadColumn(target.key)
  }

  // ── 읽기 ────────────────────────────────────────────────────────────

  const reloadColumn = async (key: string) => {
    const result = await api.loadGroupRows(workspaceId, viewId, key, null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    update((current) =>
      current.map((g) =>
        g.key === key
          ? { ...g, rows: result.value.rows, hasMore: result.value.hasMore, nextCursor: result.value.nextCursor }
          : g,
      ),
    )
  }

  const loadMore = async (group: BoardGroupJson) => {
    if (group.nextCursor === null || loadingKey !== null) return
    setLoadingKey(group.key)
    setError(null)
    const result = await api.loadGroupRows(workspaceId, viewId, group.key, group.nextCursor)
    setLoadingKey(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    update((current) =>
      current.map((g) => {
        if (g.key !== group.key) return g
        // 그사이 `+` 로 붙인 카드가 다음 페이지에 또 올 수 있다.
        const seen = new Set(g.rows.map((r) => r.id))
        return {
          ...g,
          rows: [...g.rows, ...result.value.rows.filter((r) => !seen.has(r.id))],
          hasMore: result.value.hasMore,
          nextCursor: result.value.nextCursor,
        }
      }),
    )
  }

  // ── 새 카드 · 제목 ──────────────────────────────────────────────────

  const addCard = async (group: BoardGroupJson) => {
    if (busyKey !== null) return
    setBusyKey(group.key)
    setError(null)
    // F-04-03: 그 그룹 값이 미리 채워진 새 카드. 값이 곧 그룹이라 열에서 사라지지 않는다.
    const result = await api.createRow(workspaceId, viewId, prefillCells(property.type, property.id, group.key))
    setBusyKey(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    update((current) =>
      current.map((g) => (g.key === group.key ? { ...g, rows: [...g.rows, result.value], count: g.count + 1 } : g)),
    )
    // 새 카드의 제목을 바로 받는다 — 이름 없는 카드가 쌓이지 않게(표와 같은 규칙).
    if (access.canEditContent && titleColumn !== null) setEditing({ rowId: result.value.id, draft: '' })
  }

  const commitTitle = async () => {
    const e = editingRef.current
    if (e === null || titleColumn === null) return
    // Enter 와 blur 가 같은 편집을 두 번 저장하지 않게 먼저 닫는다.
    setEditing(null)
    const row = findRow(e.rowId)
    if (row === null) return
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
    update((current) => mapRow(current, e.rowId, (r) => withValue(r, parsed.value)))
    const result = await api.updateCell(workspaceId, e.rowId, titleColumn.propertyId, parsed.value)
    if (!result.ok) {
      update((current) => mapRow(current, e.rowId, (r) => withValue(r, previous)))
      setError(result.message)
      return
    }
    takeRow(result.value)
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

  // ── 그룹 숨기기 · 보이기 (edit_structure) ──────────────────────────

  const setHidden = async (key: string, hidden: boolean) => {
    const next = new Set(groupBy.hidden ?? [])
    if (hidden) next.add(key)
    else next.delete(key)
    setError(null)
    const result = await api.updateView(workspaceId, viewId, { groupBy: { ...groupBy, hidden: [...next] } })
    if (!result.ok) {
      setError(result.message)
      return
    }
    router.refresh()
  }

  // ── 그리기 ──────────────────────────────────────────────────────────

  const { labels } = useRelationLabels(
    workspaceId,
    props.relationLabels,
    groups.flatMap((g) => g.rows),
    columns,
  )

  const visible = groups.filter((g) => !g.hidden)
  const hiddenGroups = groups.filter((g) => g.hidden)

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={tableName || UNTITLED}>
      <div
        ref={boardRef}
        data-testid="db-board"
        data-manual-order={manualOrder}
        className={`flex items-start gap-3 overflow-x-auto pb-3 ${draggingId !== null ? 'select-none' : ''}`}
      >
        {visible.map((group) => {
          const label = labelOf(group)
          const isTarget = drop !== null && drop.key === group.key
          return (
            <section
              key={group.key}
              data-group-key={group.key}
              data-testid="db-board-column"
              data-drop-target={isTarget || undefined}
              aria-label={label}
              className={`flex w-64 flex-none flex-col gap-2 rounded-md p-2 ${
                isTarget ? 'bg-blue-50 dark:bg-blue-950/40' : 'bg-neutral-50 dark:bg-neutral-900'
              }`}
            >
              <header className="flex items-center gap-1.5 px-1">
                {group.option ? (
                  <OptionChip option={group.option} />
                ) : (
                  <span className="truncate text-sm font-medium text-neutral-700 dark:text-neutral-200">{label}</span>
                )}
                <span data-testid="db-board-count" className="text-xs tabular-nums text-neutral-400">
                  {group.count}
                </span>
                <span className="ml-auto flex items-center">
                  {access.canCreateRows && (
                    <button
                      type="button"
                      aria-label={`${label}에 새로 만들기`}
                      data-testid="db-board-add"
                      disabled={busyKey !== null}
                      onClick={() => void addCard(group)}
                      className="rounded px-1.5 text-neutral-500 hover:bg-neutral-200 disabled:opacity-40 dark:hover:bg-neutral-800"
                    >
                      +
                    </button>
                  )}
                  {access.canEditStructure && (
                    <button
                      type="button"
                      aria-label={`${label} 그룹 숨기기`}
                      data-testid="db-board-hide"
                      onClick={() => void setHidden(group.key, true)}
                      className="rounded px-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
                    >
                      –
                    </button>
                  )}
                </span>
              </header>

              <ul className="flex flex-col gap-1.5" aria-label={`${label} 카드`}>
                {group.rows.map((row) => (
                  <BoardCard
                    key={row.id}
                    row={row}
                    groupKey={group.key}
                    badgeColumns={badgeColumns}
                    relationLabels={labels}
                    dragging={draggingId === row.id}
                    dropBefore={isTarget && drop.beforeRowId === row.id}
                    editing={editing?.rowId === row.id ? editing : null}
                    canDrag={access.canEditContent}
                    inputRef={titleInputRef}
                    onDraft={(draft) => setEditing({ rowId: row.id, draft })}
                    onTitleKeyDown={onTitleKeyDown}
                    onTitleBlur={() => void commitTitle()}
                    onPointerDown={onCardPointerDown}
                    onPointerMove={onCardPointerMove}
                    onPointerUp={onCardPointerUp}
                    onPointerCancel={() => endDrag()}
                  />
                ))}
                {isTarget && drop.beforeRowId === null && <DropLine />}
              </ul>

              {group.rows.length === 0 && !isTarget && (
                <p className="px-1 text-xs text-neutral-400">카드가 없습니다.</p>
              )}

              {group.hasMore && (
                <button
                  type="button"
                  data-testid="db-board-load-more"
                  disabled={loadingKey !== null}
                  onClick={() => void loadMore(group)}
                  className="self-start rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-200 disabled:opacity-40 dark:hover:bg-neutral-800"
                >
                  {loadingKey === group.key ? '불러오는 중…' : `더 보기 (${group.rows.length} / ${group.count})`}
                </button>
              )}
            </section>
          )
        })}
      </div>

      {visible.length === 0 && (
        <p className="px-2 text-sm text-neutral-400" data-testid="db-board-empty">
          보이는 그룹이 없습니다.
        </p>
      )}

      {hiddenGroups.length > 0 && (
        <div data-testid="db-board-hidden" className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span>숨긴 그룹</span>
          {hiddenGroups.map((group) => {
            const label = labelOf(group)
            return (
              <span
                key={group.key}
                data-testid="db-board-hidden-group"
                className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-neutral-800"
              >
                {label}
                <span className="tabular-nums text-neutral-400">{group.count}</span>
                {access.canEditStructure && (
                  <button
                    type="button"
                    aria-label={`${label} 그룹 보이기`}
                    data-testid="db-board-show"
                    onClick={() => void setHidden(group.key, false)}
                    className="ml-1 text-blue-700 hover:underline dark:text-blue-300"
                  >
                    보이기
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}

      {error && (
        <p role="alert" data-testid="db-error" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  )
}

function DropLine() {
  return <li aria-hidden data-testid="db-board-drop" className="h-0.5 rounded bg-blue-500" />
}

function BoardCard({
  row,
  groupKey,
  badgeColumns,
  relationLabels,
  dragging,
  dropBefore,
  editing,
  canDrag,
  inputRef,
  onDraft,
  onTitleKeyDown,
  onTitleBlur,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  row: RowJson
  groupKey: string
  badgeColumns: readonly ViewColumn[]
  relationLabels: RelationLabels
  dragging: boolean
  dropBefore: boolean
  editing: Editing | null
  canDrag: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onDraft: (draft: string) => void
  onTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onTitleBlur: () => void
  onPointerDown: (row: RowJson, key: string, event: ReactPointerEvent<HTMLLIElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLLIElement>) => void
  onPointerUp: () => void
  onPointerCancel: () => void
}) {
  return (
    <>
      {dropBefore && <DropLine />}
      <li
        data-row-id={row.id}
        data-testid="db-board-card"
        data-dragging={dragging || undefined}
        tabIndex={0}
        onPointerDown={(e) => onPointerDown(row, groupKey, e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className={`flex flex-col gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-950 ${
          canDrag ? 'cursor-grab' : ''
        } ${dragging ? 'opacity-40' : ''}`}
      >
        {editing !== null ? (
          <input
            ref={inputRef}
            value={editing.draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={onTitleKeyDown}
            onBlur={onTitleBlur}
            aria-label="카드 제목"
            data-testid="db-board-title-input"
            placeholder={UNTITLED}
            autoComplete="off"
            className="w-full bg-transparent outline-none"
          />
        ) : (
          <div data-testid="db-board-card-title" className={row.title ? 'break-words' : 'text-neutral-400'}>
            {row.title || UNTITLED}
          </div>
        )}
        {badgeColumns.map((column) => {
          if (column.type === 'relation') {
            const related = readRelationValue(row.properties[column.propertyId])
            if (related.count === 0) return null
            return (
              <span key={column.propertyId} title={column.name} data-testid="db-board-badge" className="max-w-full">
                <RelationChips value={related} labels={relationLabels} />
              </span>
            )
          }
          // rollup 배지는 아직 없다 — 값이 행에 없어서 카드마다 따로 물어야 한다(표 · 목록은 5c-2 가 그린다 · §7).
          if (column.type === 'rollup') return null
          const value = readCell(column.type, row.properties[column.propertyId])
          if (value.type === 'checkbox' ? !value.checkbox : isEmptyValue(value)) return null
          return (
            <span
              key={column.propertyId}
              title={column.name}
              data-testid="db-board-badge"
              className="max-w-full truncate text-xs text-neutral-600 dark:text-neutral-300"
            >
              {value.type === 'select' || value.type === 'status' ? (
                <CellDisplay value={value} options={column.options} />
              ) : value.type === 'checkbox' ? (
                `☑ ${column.name}`
              ) : (
                cellText(value)
              )}
            </span>
          )
        })}
      </li>
    </>
  )
}
