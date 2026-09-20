'use client'

/**
 * 표 그리드 — W8-b (F-04-02 Table · F-03-16 셀 편집 · F-04-15 "더 보기")
 *
 * 정본: 04-database-views.md F-04-02 · F-04-15 / 03-database-core.md F-03-16 · F-03-17
 *
 * ──────────────────────────────────────────────────────────────────────
 * 평범한 `<table>` 이다 — TanStack 을 쓰지 않는다 (HANDOFF §3.2-11)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 필터·정렬·페이지네이션이 전부 서버 쪽이고 한 번에 50행만 그린다. TanStack 의 핵심
 * 가치(클라이언트 테이블 상태 · 가상화)를 쓰지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * List 뷰도 이 컴포넌트다 — `variant="list"` (보드 4c-2조각 · F-04-04)
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-04-04: *"table view 렌더러에 `variant='list'` 를 두어 셀 컴포넌트를 재사용하고 그리드 레이아웃만 교체한다. 별도
 * 컴포넌트 트리를 만들면 셀 에디터를 두 벌 유지하게 된다."* 그래서 List 는 **같은 DOM(격자 · 행 · 칸)에 배치만 다르다** —
 * 선택 · 편집 · 키보드 이동 · 저장 · "더 보기"가 전부 한 벌이다. 다른 것은 셋: 머리 행을 화면에서 감춘다(이름은 스크린
 * 리더에 남긴다 · 머리 메뉴와 속성 추가는 List 에 없다), 행이 가로로 흐른다(제목 왼쪽 · 속성 오른쪽), 빈 칸을 접는다.
 * 어느 칸을 접는지는 `lib/database/list-layout.ts` 가 정한다(DOM 없이 검사).
 *
 * `display` 를 바꾼 `<table>` 은 브라우저가 표의 암묵 역할을 떼어낼 수 있다. 그래서 `grid` · `rowgroup` · `row` ·
 * `gridcell` 을 **명시한다.**
 *
 * ──────────────────────────────────────────────────────────────────────
 * 규칙은 순수 함수에 있고, 이 파일은 조립만 한다
 * ──────────────────────────────────────────────────────────────────────
 *
 *   키 → 다음 상태      `grid-nav.ts` 의 `handleGridKey`
 *   값 ↔ 글자           `cell-format.ts`
 *   값의 계약           `validateCellValue` (서버와 같은 함수 — `cell-format.ts` 가 부른다)
 *
 * 여기 남는 것은 포커스를 옮기고, 요청을 보내고, 실패하면 되돌리는 일이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 포커스는 칸이 갖는다 (roving tabindex)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 선택된 칸 하나만 `tabIndex=0` 이고 나머지는 `-1` 이다. Tab 으로 표에 들어오면 첫 칸
 * 으로 오고, 표 끝의 Tab 은 표 밖으로 나간다(`grid-nav.ts` 머리말). 포커스가 실제로
 * 칸에 있어야 키가 이 표의 처리기를 **반드시** 지난다 — `aria-activedescendant` 로
 * 표 컨테이너가 포커스를 쥐는 방식도 되지만, 편집칸이 열리면 포커스가 어차피 칸
 * 안으로 들어가므로 두 방식을 섞게 된다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 셀 쓰기는 낙관적이고, 늦게 온 응답은 버전으로 거른다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 칸을 먼저 칠하고 PATCH 한다. 같은 행의 두 칸을 빠르게 고치면 응답이 순서를 바꿔
 * 도착할 수 있고, 먼저 보낸 요청의 응답이 나중에 오면 **두 번째 변경이 빠진 행**으로
 * 덮어쓴다. 지금 들고 있는 행보다 `version`(X-6)이 낮은 응답은 버린다.
 *
 * 실패하면 **그 칸만** 되돌린다. 행 전체를 되돌리면 같은 행에서 성공한 다른 칸의
 * 변경까지 지운다.
 *
 * ⚠ 본문의 저장 큐(F-05-04 outbox)는 여기 없다. 끊긴 동안 고친 칸은 되돌아가고
 *   오류 문구가 뜬다 — 조용히 사라지지 않고 **저장되지 않았다고 말한다.**
 */

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { useRouter } from 'next/navigation'

import type { DatabaseAccess } from '@/lib/database/database'
import type { SortKey } from '@/lib/database/filter'
import { sortFirst } from '@/lib/database/filter-draft'
import type { RowJson } from '@/lib/database/http'
import { isCellColumn, type CellColumn, type ViewColumn } from '@/lib/database/view-columns'
import { MAX_QUERY_PAGINATION } from '@/lib/database/limits'
import {
  emptyValue,
  insertOption,
  isEmptyValue,
  isMvpPropertyType,
  isOptionType,
  optionIdOf,
  optionValue,
  readRelationValue,
  type CellValue,
  type MvpPropertyType,
} from '@/lib/database/property-types'
import { cellText, defaultColumnWidth, draftOf, parseDraft, readCell, sameValue } from '@/lib/database/cell-format'
import { handleGridKey, type CellPos, type GridMode, type KeyResult } from '@/lib/database/grid-nav'
import { isCollapsed, isRelationCollapsed, type TableVariant } from '@/lib/database/list-layout'
import * as api from './table-api'
import { CellDisplay, RelationChips, TYPE_ICON, TYPE_LABEL, type RelationLabels } from './cell-view'
import { useRelationLabels } from './use-relation-labels'
import { SelectEditor } from './select-editor'
import { AddColumn } from './add-column'
import { ColumnMenu } from './column-menu'
import { isSortable } from './view-toolbar'

const keyOf = (at: CellPos): string => `${at.row}:${at.col}`
const samePos = (a: CellPos, b: CellPos): boolean => a.row === b.row && a.col === b.col

/** 표시 순서가 뒤에 오는 응답인가. 버전은 bigint 문자열이다. */
const notOlder = (incoming: string, current: string): boolean => BigInt(incoming) >= BigInt(current)

export function DatabaseTable(props: {
  workspaceId: string
  viewId: string
  dataSourceId: string
  tableName: string
  /** 보이는 컬럼만, 뷰 순서로. */
  columns: ViewColumn[]
  rows: RowJson[]
  hasMore: boolean
  nextCursor: string | null
  access: DatabaseAccess
  /** 지금 뷰의 정렬(지워진 속성의 키를 뺀 것). 머리 메뉴의 정렬이 이것을 고친다. */
  sorts: readonly SortKey[]
  /** `list` 면 같은 격자를 목록 모양으로 그린다(머리말). 기본은 `table`. */
  variant?: TableVariant
  /** 첫 화면의 relation 제목(서버 렌더가 준다). 그 뒤에 온 행의 것은 `useRelationLabels` 가 받는다. */
  relationLabels: RelationLabels
}) {
  const { workspaceId, viewId, dataSourceId, tableName, access } = props
  const variant: TableVariant = props.variant ?? 'table'
  const isList = variant === 'list'
  const router = useRouter()

  const [columns, setColumns] = useState<ViewColumn[]>(props.columns)
  const [rows, setRows] = useState<RowJson[]>(props.rows)
  const [cursor, setCursor] = useState<string | null>(props.nextCursor)
  const [hasMore, setHasMore] = useState(props.hasMore)
  const [mode, setModeState] = useState<GridMode>({ kind: 'idle' })
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [addingRow, setAddingRow] = useState(false)

  /**
   * 지금 상태를 **동기적으로** 들고 있는 사본.
   *
   * 한 사용자 동작이 이벤트 여러 개로 온다 — 다른 칸을 누르면 그 칸의 `mousedown` 이
   * 먼저, 편집칸의 `blur` 가 그 뒤다. `mousedown` 이 이미 저장하고 선택을 옮겼는데
   * `blur` 가 옛 상태(렌더 전의 `mode`)를 보면 **같은 칸을 두 번 저장한다.**
   */
  const modeRef = useRef<GridMode>(mode)
  const setMode = (next: GridMode) => {
    modeRef.current = next
    setModeState(next)
  }

  const cellRefs = useRef(new Map<string, HTMLTableCellElement>())
  const editorRef = useRef<HTMLInputElement>(null)

  const size = { rows: rows.length, cols: columns.length }

  // 선택이 옮겨지면 그 칸으로 포커스를 옮긴다(roving tabindex).
  useEffect(() => {
    if (mode.kind === 'selected') cellRefs.current.get(keyOf(mode.at))?.focus()
    if (mode.kind === 'editing') {
      const input = editorRef.current
      if (input) {
        input.focus()
        // 캐럿을 끝에 둔다. `type="date"` 는 선택 범위를 지원하지 않아 던진다.
        if (input.type === 'text') input.setSelectionRange(input.value.length, input.value.length)
      }
    }
  }, [mode])

  // ★ 셀 값은 **셀 컬럼**에만 있다. relation 컬럼의 값은 셀이 아니라 캐시의 `RelationValue` 다(불변식 C2) — 셀의 규칙
  //   (`readCell` · `parseDraft` · `emptyValue`)에 넘기면 조용히 틀린 값이 된다. 타입이 그것을 막는다(`isCellColumn`).
  const valueAt = (row: RowJson, column: CellColumn): CellValue =>
    readCell(column.type, row.properties[column.propertyId])

  // relation 칸의 제목 — 첫 화면은 서버가 줬고, "더 보기" · 새 행의 것은 여기서 받는다.
  const labels = useRelationLabels(workspaceId, props.relationLabels, rows, columns)

  // ── 저장 ───────────────────────────────────────────────────────────

  const saveCell = async (rowId: string, column: CellColumn, next: CellValue, previous: CellValue) => {
    // 같은 값이면 보내지 않는다 — 셀 쓰기마다 block.version 이 오른다(X-6).
    if (sameValue(previous, next)) return

    const withValue = (row: RowJson, value: CellValue): RowJson => ({
      ...row,
      properties: { ...row.properties, [column.propertyId]: value },
      ...(column.type === 'title' ? { title: cellText(value) } : {}),
    })

    setError(null)
    setRows((current) => current.map((row) => (row.id === rowId ? withValue(row, next) : row)))

    const result = await api.updateCell(workspaceId, rowId, column.propertyId, next)
    if (!result.ok) {
      // 그 칸만 되돌린다. 그사이 같은 칸을 또 고쳤다면(값이 `next` 가 아니면) 두지 않는다.
      setRows((current) =>
        current.map((row) =>
          row.id === rowId && sameValue(valueAt(row, column), next) ? withValue(row, previous) : row,
        ),
      )
      setError(result.message)
      return
    }
    // 늦게 온 응답은 버린다(머리말).
    setRows((current) =>
      current.map((row) => (row.id === rowId && notOlder(result.value.version, row.version) ? result.value : row)),
    )
  }

  // ── 편집 ───────────────────────────────────────────────────────────

  const startEdit = (at: CellPos) => {
    const row = rows[at.row]
    const column = columns[at.col]
    if (row === undefined || column === undefined) return

    // relation 칸은 아직 읽기 전용이다 — 행 고르기는 relation 5b-2 가 붙인다. 선택만 한다.
    if (!isCellColumn(column)) {
      setMode({ kind: 'selected', at })
      return
    }

    // F-03-16 엣지 케이스: *"읽기 전용 프로퍼티 편집 시도 → 편집 모드 진입 차단."*
    if (!access.canEditContent) {
      setMode({ kind: 'selected', at })
      return
    }

    const value = valueAt(row, column)
    if (column.type === 'checkbox') {
      // 체크박스에는 편집칸이 없다. "편집 시작"이 곧 토글이다.
      setMode({ kind: 'selected', at })
      void saveCell(row.id, column, { type: 'checkbox', checkbox: !(value.type === 'checkbox' && value.checkbox) }, value)
      return
    }
    setDraft(draftOf(value))
    setMode({ kind: 'editing', at })
  }

  /** 편집 중인 칸을 저장한다. 값이 틀리면 `false` — 호출자는 편집에 머문다. */
  const commitEdit = (at: CellPos): boolean => {
    const row = rows[at.row]
    const column = columns[at.col]
    if (row === undefined || column === undefined || !isCellColumn(column)) return true
    // select · status 는 고르는 순간 저장됐다. 편집을 닫는 것 말고 할 일이 없다.
    if (isOptionType(column.type) || column.type === 'checkbox') return true

    const previous = valueAt(row, column)
    const parsed = parseDraft(column.type, draft, previous)
    if (!parsed.ok) {
      setError(parsed.message)
      return false
    }
    void saveCell(row.id, column, parsed.value, previous)
    return true
  }

  // ── 키보드 ─────────────────────────────────────────────────────────

  const apply = (result: KeyResult) => {
    const target = result.target
    switch (result.effect) {
      case 'edit':
        if (target) startEdit(target)
        return
      case 'commit':
        // 틀린 값이면 편집에 머문다 — 틀린 입력을 버리고 옮기면 사용자는 친 것을 잃는다.
        if (target && !commitEdit(target)) return
        setMode(result.mode)
        return
      case 'cancel':
        setError(null)
        setMode(result.mode)
        return
      case 'clear': {
        const row = target ? rows[target.row] : undefined
        const column = target ? columns[target.col] : undefined
        if (row && column && isCellColumn(column) && access.canEditContent) {
          void saveCell(row.id, column, emptyValue(column.type), valueAt(row, column))
        }
        setMode(result.mode)
        return
      }
      case 'none':
        setMode(result.mode)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    // 편집기가 이미 쓴 키(옵션 목록의 ↑↓ · Enter)는 표의 규칙을 타지 않는다
    // (`select-editor.tsx` 머리말).
    if (event.defaultPrevented) return
    const before = modeRef.current
    const result = handleGridKey(
      before,
      {
        key: event.key,
        shift: event.shiftKey,
        mod: event.ctrlKey || event.metaKey,
        alt: event.altKey,
        composing: event.nativeEvent.isComposing,
      },
      size,
    )
    if (result.handled) {
      event.preventDefault()
      apply(result)
    } else if (result.mode.kind !== before.kind) {
      // 표 끝의 Tab: 기본 동작(다음 포커스)은 그대로 두고 선택만 푼다.
      setMode(result.mode)
    }
  }

  // ── 마우스 · 포커스 ────────────────────────────────────────────────

  const onCellMouseDown = (at: CellPos, event: MouseEvent<HTMLTableCellElement>) => {
    const current = modeRef.current
    // 편집칸 안을 누른 것이다(캐럿 옮기기 · 옵션 목록). 표가 할 일이 없다.
    if (current.kind === 'editing' && samePos(current.at, at)) return

    // 다른 칸을 누르면 편집하던 칸을 저장하고 옮긴다. 값이 틀리면 옮기지 않는다.
    if (current.kind === 'editing' && !commitEdit(current.at)) {
      event.preventDefault()
      return
    }

    const column = columns[at.col]
    // F-03-16: *"한 번 더 클릭 → 편집 모드."* 체크박스는 첫 클릭에 토글한다 — 칸이 곧 버튼이다.
    if ((current.kind === 'selected' && samePos(current.at, at)) || column?.type === 'checkbox') {
      event.preventDefault()
      cellRefs.current.get(keyOf(at))?.focus()
      startEdit(at)
      return
    }
    setMode({ kind: 'selected', at })
  }

  /** Tab 으로 표에 들어왔다. 첫 칸을 선택한다. */
  const onCellFocus = (at: CellPos) => {
    if (modeRef.current.kind === 'idle') setMode({ kind: 'selected', at })
  }

  /**
   * 편집하던 칸에서 포커스가 **표 밖으로** 나갔다(바깥을 눌렀다). 저장하고 선택을 푼다.
   *
   * 다른 칸을 누른 경우는 `mousedown` 이 이미 처리했다 — `modeRef` 가 그 칸을 가리키므로
   * 여기서는 아무것도 하지 않는다(`modeRef` 머리말).
   */
  const onCellBlur = (at: CellPos, event: FocusEvent<HTMLTableCellElement>) => {
    const current = modeRef.current
    if (current.kind !== 'editing' || !samePos(current.at, at)) return
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    if (!commitEdit(at)) {
      // 틀린 값을 들고 떠났다. 붙잡아 둘 수 없으므로 버리고, 버렸다고 말한다.
      setError((message) => `${message ?? '값을 확인하세요.'} — 저장하지 않았습니다.`)
    }
    setMode({ kind: 'idle' })
  }

  // ── select ─────────────────────────────────────────────────────────

  const pickOption = (at: CellPos, optionId: string | null) => {
    const row = rows[at.row]
    const column = columns[at.col]
    if (row === undefined || column === undefined || !isCellColumn(column) || !isOptionType(column.type)) return
    void saveCell(row.id, column, optionValue(column.type, optionId), valueAt(row, column))
    setMode({ kind: 'selected', at })
  }

  const createOption = async (at: CellPos, name: string) => {
    const column = columns[at.col]
    if (column === undefined) return
    const result = await api.addOption(workspaceId, dataSourceId, column.propertyId, name)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const option = result.value
    // 같은 이름이면 서버가 기존 옵션을 준다(수렴). 이미 목록에 있으면 넣지 않는다.
    // status 옵션은 자기 그룹의 끝에 선다 — 서버가 읽어 주는 순서와 같게(`insertOption`).
    setColumns((current) =>
      current.map((c) => (c.propertyId === column.propertyId ? { ...c, options: insertOption(c.options, option) } : c)),
    )
    pickOption(at, option.id)
  }

  // ── 행 · 컬럼 ──────────────────────────────────────────────────────

  const addRow = async () => {
    setAddingRow(true)
    setError(null)
    const result = await api.createRow(workspaceId, viewId)
    setAddingRow(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const index = rows.length
    setRows((current) => [...current, result.value])
    // 새 행의 제목 칸을 바로 편집한다 — 빈 행이 이름 없이 쌓이지 않게.
    const titleCol = columns.findIndex((c) => c.type === 'title')
    if (titleCol >= 0 && access.canEditContent) {
      setDraft('')
      setMode({ kind: 'editing', at: { row: index, col: titleCol } })
    }
  }

  const addColumn = async (name: string, type: MvpPropertyType): Promise<string | null> => {
    const result = await api.addColumn(workspaceId, dataSourceId, name, type)
    if (!result.ok) return result.message
    const property = result.value
    // 표가 그리는 것은 셀 타입뿐이다. 엣지 타입(relation)의 칸은 relation 5b 가 그린다 — 이 폼은 그것을 만들지 않는다.
    const cellType = property.type
    if (!isMvpPropertyType(cellType)) return null
    // 다시 읽지 않고 붙인다. 이미 불러온 행들을 버리면 "더 보기"로 모은 것이 사라진다.
    // 기존 행에는 이 컬럼의 값이 없으므로 빈 값으로 그려진다.
    setColumns((current) => [
      ...current,
      {
        propertyId: property.id,
        name: property.name,
        type: cellType,
        visible: true,
        orderKey: property.orderKey,
        width: null,
        wrap: false,
        // status 는 만드는 순간 옵션 셋이 함께 생긴다 — 스키마 응답이 싣고 온다.
        options: property.options ?? [],
      },
    ])
    return null
  }

  // ── 머리 메뉴 ──────────────────────────────────────────────────────
  //
  // 전부 공유 설정(뷰 · 스키마)이다. 저장한 뒤 서버 렌더를 다시 받고, 표는 `page.tsx`
  // 의 key(필터 · 정렬 · 컬럼)가 바뀌어 새로 마운트된다 — 정렬이 바뀐 목록에 옛 커서로
  // 이어 붙이지 않는다.

  const afterStructure = (result: api.ApiResult<null>): string | null => {
    if (!result.ok) return result.message
    router.refresh()
    return null
  }

  const columnActions = (column: ViewColumn) => ({
    onSort: async (direction: SortKey['direction']) =>
      afterStructure(
        await api.updateView(workspaceId, viewId, { sorts: sortFirst(props.sorts, column.propertyId, direction) }),
      ),
    onRename: async (name: string) =>
      afterStructure(await api.renameColumn(workspaceId, dataSourceId, column.propertyId, name)),
    onHide: async () =>
      afterStructure(await api.setColumnVisible(workspaceId, viewId, column.propertyId, false)),
    onDelete: async () =>
      afterStructure(await api.deleteColumn(workspaceId, dataSourceId, column.propertyId)),
  })

  // F-03-17: 누적 10,000건 상한. 여기서 멈추고 필터로 좁히라고 말한다 — "전부 훑는"
  // 로직은 반드시 깨진다. 무한 스크롤을 만들지 않는 이유이기도 하다.
  const reachedCap = rows.length >= MAX_QUERY_PAGINATION

  const loadMore = async () => {
    if (cursor === null || loadingMore || reachedCap) return
    setLoadingMore(true)
    const result = await api.loadRows(workspaceId, viewId, cursor)
    setLoadingMore(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setRows((current) => {
      // 그사이 "+ 새로 만들기"로 붙인 행이 다음 페이지에 또 올 수 있다.
      const seen = new Set(current.map((row) => row.id))
      return [...current, ...result.value.rows.filter((row) => !seen.has(row.id))]
    })
    setCursor(result.value.nextCursor)
    setHasMore(result.value.hasMore)
  }

  // ── 그리기 ─────────────────────────────────────────────────────────

  const focusTarget: CellPos | null =
    mode.kind === 'idle' ? (rows.length > 0 && columns.length > 0 ? { row: 0, col: 0 } : null) : mode.at
  const totalWidth =
    columns.reduce((sum, c) => sum + (c.width ?? defaultColumnWidth(c.type)), 0) +
    (access.canEditStructure ? 44 : 0)

  return (
    <section className="flex min-w-0 flex-col gap-3">
      {/*
        표를 가로 스크롤 상자로 감싸지 않는다. 한 축이 `auto` 인 상자는 다른 축의
        `visible` 도 `auto` 로 계산되어(CSS 규칙), 칸 안의 팝오버(옵션 편집기 · 속성
        추가 폼)가 **세로로 잘리고** 상자 안에 스크롤이 생긴다. 넓은 표는 페이지가
        가로로 스크롤한다. 표 안에서만 스크롤하게 하려면 팝오버를 칸 밖(고정 위치)으로
        빼야 한다 — e2e 의 잘림 검사가 그 조건을 본다.
      */}
      <div>
        <table
          role="grid"
          aria-label={tableName || '제목 없음'}
          aria-rowcount={rows.length + 1}
          data-testid="db-table"
          data-variant={variant}
          onKeyDown={onKeyDown}
          style={isList ? undefined : { width: totalWidth }}
          className={isList ? 'block w-full text-sm' : 'table-fixed border-collapse text-sm'}
        >
          {/* List 는 머리 행을 화면에서 감춘다. 컬럼 이름은 스크린 리더에 남는다. */}
          <thead role="rowgroup" className={isList ? 'sr-only' : undefined}>
            <tr role="row">
              {columns.map((column) => (
                <th
                  key={column.propertyId}
                  scope="col"
                  data-property-id={column.propertyId}
                  style={{ width: column.width ?? defaultColumnWidth(column.type) }}
                  className="border border-neutral-200 px-2 py-1.5 text-left text-xs font-medium text-neutral-500 dark:border-neutral-800"
                >
                  {/*
                    `th` 에 truncate(overflow: hidden)를 걸지 않는다 — 머리 메뉴 팝오버가
                    잘린다. 자르는 것은 이름 칸뿐이다.
                  */}
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate">
                      <span aria-hidden className="mr-1.5 text-neutral-400">
                        {TYPE_ICON[column.type]}
                      </span>
                      {column.name}
                      <span className="sr-only"> ({TYPE_LABEL[column.type]})</span>
                    </span>
                    {/* 감춘 머리 안의 버튼은 Tab 으로는 닿는데 보이지 않는다 — List 에는 두지 않는다. */}
                    {access.canEditStructure && !isList && (
                      <ColumnMenu
                        name={column.name}
                        isTitle={column.type === 'title'}
                        sortable={isSortable(column)}
                        {...columnActions(column)}
                      />
                    )}
                  </div>
                </th>
              ))}
              {access.canEditStructure && !isList && (
                <th className="w-11 border border-neutral-200 p-0 dark:border-neutral-800">
                  <AddColumn onAdd={addColumn} />
                </th>
              )}
            </tr>
          </thead>

          <tbody role="rowgroup" className={isList ? 'block' : undefined}>
            {rows.map((row, r) => (
              <tr
                key={row.id}
                role="row"
                data-row-id={row.id}
                className={
                  isList
                    ? 'flex items-center gap-1 border-b border-neutral-100 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/60'
                    : undefined
                }
              >
                {columns.map((column, c) => {
                  const at = { row: r, col: c }
                  const isSelected = mode.kind !== 'idle' && samePos(mode.at, at)
                  const isEditing = mode.kind === 'editing' && samePos(mode.at, at)
                  // 칸은 둘 중 하나다 — 셀(값이 EAV 에 있다) 아니면 relation(값이 엣지이고 여기에는 캐시의 id 가 있다).
                  const cell = isCellColumn(column)
                    ? ({ kind: 'cell', column, value: valueAt(row, column) } as const)
                    : ({ kind: 'relation', column, value: readRelationValue(row.properties[column.propertyId]) } as const)
                  // List: 빈 칸은 접는다. 선택 · 편집 중이면 비어 있어도 선다(`list-layout.ts`).
                  const collapsed =
                    cell.kind === 'cell'
                      ? isCollapsed(variant, cell.column.type, cell.value, isSelected)
                      : isRelationCollapsed(variant, cell.value, isSelected)
                  const empty =
                    cell.kind === 'cell'
                      ? isEmptyValue(cell.value) && cell.column.type !== 'checkbox'
                      : cell.value.count === 0
                  const display =
                    isList && empty ? (
                      // 제목은 "제목 없음", 선택된 빈 속성 칸은 그 속성의 이름 — 무엇을 채우는 자리인지 말한다.
                      <span className="truncate text-neutral-400" data-testid="db-list-placeholder">
                        {column.type === 'title' ? '제목 없음' : column.name}
                      </span>
                    ) : cell.kind === 'cell' ? (
                      <CellDisplay value={cell.value} options={column.options} />
                    ) : (
                      <RelationChips value={cell.value} labels={labels} />
                    )
                  return (
                    <td
                      key={column.propertyId}
                      ref={(el) => {
                        if (el) cellRefs.current.set(keyOf(at), el)
                        else cellRefs.current.delete(keyOf(at))
                      }}
                      role="gridcell"
                      tabIndex={focusTarget !== null && samePos(focusTarget, at) ? 0 : -1}
                      aria-selected={isSelected}
                      aria-readonly={!access.canEditContent || cell.kind === 'relation' || undefined}
                      data-cell={keyOf(at)}
                      data-property-id={column.propertyId}
                      data-editing={isEditing || undefined}
                      data-collapsed={collapsed || undefined}
                      title={isList && column.type !== 'title' ? column.name : undefined}
                      onMouseDown={(e) => onCellMouseDown(at, e)}
                      onFocus={() => onCellFocus(at)}
                      onBlur={(e) => onCellBlur(at, e)}
                      className={
                        isList
                          ? `relative h-9 items-center rounded px-1.5 outline-none ${collapsed ? 'hidden' : 'flex'} ${
                              column.type === 'title' ? 'min-w-0 flex-1' : 'max-w-[16rem] flex-none'
                            } ${isEditing && column.type !== 'title' ? 'min-w-[11rem]' : ''} ${
                              isSelected ? 'shadow-[inset_0_0_0_2px_theme(colors.blue.500)]' : ''
                            }`
                          : `relative h-9 border border-neutral-200 px-2 align-middle outline-none dark:border-neutral-800 ${
                              isSelected ? 'shadow-[inset_0_0_0_2px_theme(colors.blue.500)]' : ''
                            }`
                      }
                    >
                      {isEditing && cell.kind === 'cell' && isOptionType(cell.column.type) ? (
                        <>
                          {display}
                          <SelectEditor
                            options={column.options}
                            currentId={optionIdOf(cell.value)}
                            isStatus={column.type === 'status'}
                            // List 의 속성은 오른쪽에 붙어 있다 — 왼쪽 기준으로 열면 화면 밖으로 나간다.
                            align={isList ? 'right' : 'left'}
                            canCreate={access.canEditStructure}
                            onPick={(optionId) => pickOption(at, optionId)}
                            onCreate={(name) => void createOption(at, name)}
                          />
                        </>
                      ) : isEditing ? (
                        <input
                          ref={editorRef}
                          type={column.type === 'date' ? 'date' : 'text'}
                          inputMode={column.type === 'number' ? 'decimal' : undefined}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          aria-label={`${column.name} 편집`}
                          data-testid="db-cell-input"
                          autoComplete="off"
                          className={`absolute inset-0 h-full w-full bg-white px-2 outline-none dark:bg-neutral-950 ${
                            column.type === 'number' ? 'text-right tabular-nums' : ''
                          }`}
                        />
                      ) : isList ? (
                        // 칸이 flex 라 안쪽 글자가 줄어들 수 있어야 말줄임이 된다.
                        <div className="min-w-0 flex-1">{display}</div>
                      ) : (
                        display
                      )}
                    </td>
                  )
                })}
                {access.canEditStructure && !isList && (
                  <td aria-hidden className="border border-neutral-200 dark:border-neutral-800" />
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* F-04-01 · F-04-02: 행이 0개여도 헤더 · 빈 상태 · "+ 새로 만들기"는 남는다. */}
      {rows.length === 0 && (
        <p className="px-2 text-sm text-neutral-400" data-testid="db-empty">
          아직 행이 없습니다.
        </p>
      )}

      {error && (
        <p role="alert" data-testid="db-error" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {access.canCreateRows && (
          <button
            type="button"
            data-testid="db-add-row"
            disabled={addingRow}
            onClick={() => void addRow()}
            className="rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
          >
            {addingRow ? '만드는 중…' : '+ 새로 만들기'}
          </button>
        )}

        {hasMore && !reachedCap && (
          <button
            type="button"
            data-testid="db-load-more"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className="rounded-md border border-neutral-300 px-3 py-1 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {loadingMore ? '불러오는 중…' : '더 보기'}
          </button>
        )}

        {hasMore && reachedCap && (
          <p className="text-neutral-500">
            한 번에 볼 수 있는 행은 {MAX_QUERY_PAGINATION.toLocaleString('ko-KR')}개까지입니다. 필터로 좁혀 보세요.
          </p>
        )}

        <span className="ml-auto text-xs text-neutral-400" data-testid="db-row-count">
          {hasMore ? `${rows.length}개 불러옴 · 더 있음` : `${rows.length}개`}
        </span>
      </div>
    </section>
  )
}
