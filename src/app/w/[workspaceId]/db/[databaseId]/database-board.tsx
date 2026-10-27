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
 * 그룹 머리의 계산은 서버가 낸다 (2d-3 · F-04-16)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 계산이 걸리면 열 머리의 카드 수 자리에 그 값을 그린다(노션처럼 — 무엇의 계산인지는 `title`). 값은 필터를 지난 그 그룹의 행
 * **전부**로 계산한 것이라 불러온 카드로 셈하지 않는다. 카드를 옮기거나 만들면 카드 수는 로컬로 고치고, 머리 값은 서버에서 **다시
 * 받는다**(`loadGroupCalculations` — 행은 읽지 않는 질의 하나). 늦게 온 옛 답은 버린다(`calcSeq`). 고르는 곳은 도구줄의 "그룹"
 * 패널이다(보드 안에 팝오버를 두지 않는다 — 아래).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 보드 안에 팝오버를 두지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 보드는 가로 스크롤 상자다. 그 안의 절대 위치 팝오버는 세로로 잘린다(`database-table.tsx` 머리말의 CSS 규칙). 열 머리의
 * 동작은 버튼 둘(`+` · 숨기기)이고 메뉴가 없다. 그룹 기준 · 빈 그룹 숨김은 도구줄의 "그룹" 패널(`view-toolbar.tsx`)이
 * 보드 밖에서 연다. 새 카드의 제목 편집은 카드 안의 입력칸이다.
 */

import { rowOpenHref } from '@/lib/database/open-pages'
import Link from '@/app/link'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { useRouter } from 'next/navigation'

import type { DatabaseAccess } from '@/lib/database/database'
import type { RowJson } from '@/lib/database/http'
import { PageIconView } from '../../page-icon-view'
import type { GroupBy } from '@/lib/database/group'
import type { ViewColumn } from '@/lib/database/view'
import type { GroupableType, SelectOption, StatusGroupKind } from '@/lib/database/property-types'
import type { DateUnit } from '@/lib/database/date-group'
import type { TextMode } from '@/lib/database/text-group'
import { cellText, parseDraft, readCell, sameValue } from '@/lib/database/cell-format'
import {
  fillKeyOf,
  groupLabel,
  moveCard,
  moveChoices,
  prefillCells,
  resolveDrop,
  type ColumnBox,
  type DropTarget,
} from '@/lib/database/board-drag'
import { EDITED_OUT_OF_VIEW_NOTICE, MOVED_OUT_OF_VIEW_NOTICE } from '@/lib/database/out-of-view'
import { AnchoredLayer, containsAcrossLayers } from '../../anchored-layer'
import { templateRowNote, UNTITLED_TEMPLATE, type DefaultTemplate } from '@/lib/database/new-row'
import { CALCULATION_LABEL, formatCalculation, type Calculation, type CalculationResult } from '@/lib/database/calculations'
import * as api from './table-api'
import { OptionChip, type PeopleNames, type RelationIcons, type RelationLabels } from './cell-view'
import { NewRowMenu } from './new-row-menu'
import { CardBadges } from './card-badges'
import { useRelationLabels } from './use-relation-labels'
import { usePeopleNames } from './use-people-names'
import { useRollupValues } from './use-rollup-values'
import { useRowReminders } from './use-row-reminders'
import type { DateReminderJson } from '@/lib/database/reminder'
import { EMPTY_ROLLUP_PAGE, type RollupPage } from '@/lib/database/rollup-functions'
import { formulaEvaluator, formulaValuesByRow, type FormulaPlan } from '@/lib/database/formula-plan'
import type { FormulaValue } from '@/lib/formula/formula'
import { useAdoptServerValue, useLiveServerRefresh } from './use-table-changes'

/** `GET /groups` 의 그룹 하나 — 행은 `rowJson`. 서버 렌더(`page.tsx`)도 같은 모양으로 내려준다. */
export type BoardGroupJson = {
  readonly key: string
  readonly option: SelectOption | null
  /** 범주 열의 그룹(10n-27). 옵션 열 · `''` · checkbox 는 null. */
  readonly statusGroup: StatusGroupKind | null
  /** 이 열의 `+` · 드롭이 채울 옵션(10n-27 — 범주 열은 서버가 정한다). 없으면 null. */
  readonly fillOptionId: string | null
  readonly count: number
  readonly hidden: boolean
  /** 그룹 머리의 계산 값(2d-3). 계산이 없으면 null — 머리는 카드 수. */
  readonly calculation: CalculationResult | null
  readonly rows: readonly RowJson[]
  readonly hasMore: boolean
  readonly nextCursor: string | null
}

export type GroupProperty = {
  readonly id: string
  readonly name: string
  readonly type: GroupableType
  /** 날짜로 묶는 단위(B-1) — 머리의 이름(2026년 10월)을 만든다. 날짜가 아니면 없다. */
  readonly dateUnit?: DateUnit | null
  /** 숫자로 묶는 구간의 크기(B-2) — 머리의 이름(20 ~ 30)을 만든다. 숫자가 아니면 없다. */
  readonly numberSize?: number | null
  /** 글로 묶는 방식(B-2b) — 첫 글자면 어느 열에도 새로 만들거나 끌어 놓지 못한다(`fillKeyOf`). 글이 아니면 없다. */
  readonly textMode?: TextMode | null
  /** 상대 날짜 그룹(B-3) — 서버가 쓴 오늘. 어제 · 오늘 · 내일 열의 "새로 만들기"가 이 날로 그 날을 셈한다(`fillKeyOf`). */
  readonly today?: string | null
}

/** 이만큼 움직여야 드래그다. 그 전에 놓으면 클릭(포커스)이다. */
const DRAG_THRESHOLD_PX = 4
/**
 * 터치는 **길게 눌러** 끈다(10m-1 · 정본 §3.10 끝 [보강] 좁은 화면 ⑨ⓑ) — 카드 전체에 `touch-action: none` 을 주면 폰의 보드(거의 카드로
 * 덮인다)를 손가락으로 스크롤할 수 없다. 이 시간을 이 거리 안에서 버티면 끌기, 그 전에 넘게 움직이면 스크롤이다.
 */
const LONG_PRESS_MS = 350
const TOUCH_SLOP_PX = 8
const UNTITLED = '제목 없음'

/** 터치로 누른 채 기다리는 카드 — 시간이 차면 끌기가 된다(`startTouchDrag`). */
type Press = {
  readonly row: RowJson
  readonly key: string
  readonly pointerId: number
  readonly target: HTMLLIElement
  readonly startX: number
  readonly startY: number
  readonly timer: ReturnType<typeof setTimeout>
}

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
  /** 템플릿 목록을 묻는 데 쓴다(`New ▾` · 템플릿은 표의 것이다). */
  dataSourceId: string
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
  /** 그 행들의 아이콘(8c-3a) — 제목 맵과 같은 답에서 왔다. */
  relationIcons: RelationIcons
  /** 사람 칸의 이름(6g-2) — 첫 화면의 것은 서버가 준다. */
  peopleNames?: PeopleNames
  /** 이 뷰의 기본 템플릿(F-08-03). 열의 `+` 를 그냥 누르면 이것으로 만든다 — 그 열의 값이 템플릿의 값을 덮는다. */
  defaultTemplate?: DefaultTemplate | null
  /** 살아 있는 그룹 머리의 계산(2d-3) — 무엇의 계산인지(머리의 `title`). 없으면 머리는 카드 수. */
  calculation?: { readonly propertyId: string; readonly propertyName: string; readonly fn: Calculation } | null
  /** 뷰 검색어(2e-2) — 서버 렌더가 이것으로 그룹을 읽었다. 열의 "더 보기" · 머리 값 다시 받기도 같은 검색어를 싣는다. */
  search?: string | null
  /** 서버 화면이 읽기 전의 시각(ms) — 구독이 붙기 전의 변경을 메운다(#250 · `use-table-changes.ts`). */
  /** 행을 여는 주소의 바탕(8n-1 · F-02-20) — 지금 데이터베이스 화면의 주소면 피크로, null 이면 행 화면으로(전체 페이지). */
  peekBase?: string | null
  renderedAt?: number
  /** 첫 화면의 rollup 값(10n-33 · 서버 렌더가 계산해 준다) — 카드의 배지. 그 뒤에 온 카드의 것은 `useRollupValues` 가 받는다. */
  rollupValues?: RollupPage
  /** 수식의 계획(10n-34 · 서버 렌더가 뷰의 컬럼 전부로 만든다) — 카드의 수식 배지를 그 카드의 칸으로 계산한다. */
  formulaPlan?: FormulaPlan | null
}) {
  const { workspaceId, viewId, dataSourceId, tableName, columns, property, groupBy, manualOrder, access } = props
  const router = useRouter()

  const [groups, setGroupsState] = useState<readonly BoardGroupJson[]>(props.groups)
  const [error, setError] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [editing, setEditingState] = useState<Editing | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  /** 템플릿으로 만들었는데 빠진 것이 있으면(`templateRowNote`). 오류가 아니다. */
  const [notice, setNotice] = useState<string | null>(null)
  /** 기본 템플릿 — 어느 열의 `▾` 에서 바꿔도 **모든 열**의 `+` 가 따른다. 그래서 열이 아니라 보드가 들고 있다. */
  const [defaultTemplate, setDefaultTemplate] = useState<DefaultTemplate | null>(props.defaultTemplate ?? null)

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

  // 표 변경 알림(2k-3 · F-04-24) — 다른 곳에서 바뀌면 서버 렌더를 다시 부르고 새 그룹을 받아들인다. 끌기 · 편집 · 만들기 · 더 보기
  // 중이면 끝난 뒤에. "더 보기"로 더 읽은 카드는 첫 페이지로 돌아간다(§7).
  const boardBusy = draggingId !== null || editing !== null || busyKey !== null || loadingKey !== null
  useLiveServerRefresh(workspaceId, dataSourceId, boardBusy, props.renderedAt)
  useAdoptServerValue(props.groups, boardBusy, (next) => update(() => next))

  /** 머리 값을 다시 받은 횟수 — 늦게 온 옛 답을 버린다(머리말). */
  const calcSeq = useRef(0)
  const calculation = props.calculation ?? null
  const refreshCalculations = async () => {
    if (calculation === null) return
    const seq = ++calcSeq.current
    const result = await api.loadGroupCalculations(workspaceId, viewId, props.search)
    if (seq !== calcSeq.current) return
    if (!result.ok) {
      setError(result.message)
      return
    }
    update((current) => current.map((g) => ({ ...g, calculation: result.value[g.key] ?? null })))
  }

  const boardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const pressRef = useRef<Press | null>(null)
  const dropRef = useRef<DropTarget | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const titleColumn = columns.find((c) => c.type === 'title') ?? null
  /** 카드의 배지 — 제목과 그룹 프로퍼티(열이 곧 그 값이다)는 뺀다. */
  const badgeColumns = columns.filter((c) => c.type !== 'title' && c.propertyId !== property.id)
  // 카드의 날짜 종(10n-76) — 서버가 다시 그릴 때마다(`renderedAt`) 다시 읽는다(남이 건 리마인더는 행의 판을 바꾸지 않는다)
  const [reminders] = useRowReminders(workspaceId, dataSourceId, groups.flatMap((g) => g.rows), badgeColumns.some((c) => c.type === 'date'), props.renderedAt)
  const labelOf = (group: BoardGroupJson) => groupLabel(property.type, property.name, group, property)

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

  /** 터치로 누른 채 기다리던 것을 거둔다 — 손가락이 움직였거나(스크롤) · 뗐거나 · 브라우저가 가져갔다. */
  const cancelPress = (): Press | null => {
    const p = pressRef.current
    if (p !== null) clearTimeout(p.timer)
    pressRef.current = null
    return p
  }

  // 끄는 동안의 터치 이동은 스크롤로 가지 않게 막는다. 막을 수 있는지는 손가락이 닿는 순간의 처리기로 정해지므로 끌기를 시작할 때 붙이면
  // 늦다 — 보드가 늘 비수동으로 듣고, 끄는 동안만 막는다(그 밖에는 스크롤 그대로). React 의 터치 사건은 수동이라 막지 못한다.
  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const onTouchMove = (event: TouchEvent): void => {
      if (dragRef.current !== null && event.cancelable) event.preventDefault()
    }
    board.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      board.removeEventListener('touchmove', onTouchMove)
      const p = pressRef.current
      if (p !== null) clearTimeout(p.timer)
      pressRef.current = null
    }
  }, [])

  /** 길게 누르는 동안 · 끄는 동안에는 기기의 길게 누르기 메뉴를 띄우지 않는다. */
  const onCardContextMenu = (event: ReactMouseEvent<HTMLLIElement>) => {
    if (pressRef.current !== null || dragRef.current !== null) event.preventDefault()
  }

  /** 길게 누르기가 찼다 — 끌기로. 좌표는 지금 잰다(손가락은 아직 그 자리다). */
  const startTouchDrag = (): void => {
    const p = cancelPress()
    if (p === null) return
    try {
      p.target.setPointerCapture(p.pointerId)
    } catch {
      return // 그사이 손가락이 떨어졌다
    }
    dragRef.current = {
      id: p.row.id,
      fromKey: p.key,
      startX: p.startX,
      startY: p.startY,
      moved: true,
      layout: measure(),
      target: null,
    }
    setDraggingId(p.row.id)
  }

  const onCardPointerDown = (row: RowJson, key: string, event: ReactPointerEvent<HTMLLIElement>) => {
    if (event.button !== 0 || !access.canEditContent) return
    if (editingRef.current?.rowId === row.id) return
    // 카드 안의 버튼 · 링크는 제 일을 한다.
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return
    if (event.pointerType === 'touch') {
      // 막지 않는다 — 곧 움직이면 스크롤이다. 버티면 끌기(머리말의 LONG_PRESS_MS).
      cancelPress()
      pressRef.current = {
        row,
        key,
        pointerId: event.pointerId,
        target: event.currentTarget,
        startX: event.clientX,
        startY: event.clientY,
        timer: setTimeout(startTouchDrag, LONG_PRESS_MS),
      }
      return
    }
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
    const p = pressRef.current
    if (p !== null && p.pointerId === event.pointerId) {
      // 길게 누르기가 차기 전에 움직였다 — 스크롤이다(브라우저가 곧 가져간다)
      if (Math.hypot(event.clientX - p.startX, event.clientY - p.startY) > TOUCH_SLOP_PX) cancelPress()
      return
    }
    const d = dragRef.current
    if (!d) return
    if (!d.moved) {
      if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) < DRAG_THRESHOLD_PX) return
      d.moved = true
      // 좌표는 시작할 때 한 번 잰다 — 끄는 동안 카드는 자리를 바꾸지 않는다(놓을 때 옮긴다).
      d.layout = measure()
      setDraggingId(d.id)
    }
    // 받을 수 없는 열(첫 글자 열 · 옵션이 없는 범주 열 — `fillKeyOf` 가 null)에는 끌어 놓지 못한다(B-2b ③) · 제 열 안의 차례는 바꾼다
    const layout = d.layout.filter((c) => c.key === d.fromKey || accepting.has(c.key))
    d.target = resolveDrop(layout, { id: d.id, fromKey: d.fromKey }, event.clientX, event.clientY, manualOrder)
    if (!sameTarget(dropRef.current, d.target)) {
      dropRef.current = d.target
      setDrop(d.target)
    }
  }

  const onCardPointerUp = (event: ReactPointerEvent<HTMLLIElement>) => {
    // 길게 누르기가 차기 전에 뗐다 — 탭이다. 마우스의 누르기처럼 카드에 포커스를 준다.
    if (cancelPress() !== null) {
      event.currentTarget.focus()
      return
    }
    const d = endDrag()
    if (!d || !d.moved || d.target === null) return
    void commitMove(d.id, d.fromKey, d.target)
  }

  /**
   * "옮기기" 메뉴로 옮긴다(10m-2) — 끌기와 같은 요청. 낙관적 갱신이 카드를 새 자리에 그리면 그 카드의 "옮기기" 단추에 포커스를 돌려준다 —
   * 키보드로 이어서 옮길 수 있게(카드가 다시 그려져 포커스를 잃는다).
   */
  const moveByMenu = (rowId: string, fromKey: string, target: DropTarget) => {
    void commitMove(rowId, fromKey, target)
    requestAnimationFrame(() =>
      boardRef.current?.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-testid="db-card-move"]`)?.focus(),
    )
  }

  const commitMove = async (rowId: string, fromKey: string, target: DropTarget) => {
    const moved = moveCard(groupsRef.current, rowId, target)
    if (moved === null) return
    setError(null)
    setNotice(null)
    update(() => moved.columns)

    const result = await api.moveCard(workspaceId, viewId, {
      rowId,
      groupKey: target.key,
      beforeRowId: target.beforeRowId,
      // 서버가 "아직 이 보드에 서는가" 를 내가 보는 검색어까지 넣어 판정한다(10n-15)
      search: props.search ?? null,
    })
    if (!result.ok) {
      // 롤백 단위 = 서버 API 단위(머리말). 그사이 다른 갱신이 있었어도 이 카드만 제자리로.
      update((current) => moveCard(current, rowId, moved.undo)?.columns ?? current)
      setError(result.message)
      return
    }
    takeRow(result.value.row)
    // 조건(필터 · 검색) 밖으로 옮겼다 — 그 까닭을 말한다(10n-15 · F-04-03). 카드는 표 변경 알림의 다시 읽기(정렬된 보드는 아래의 열 다시
    // 읽기)에서 곧 빠진다 — 여기서 지우지 않는다(서버의 답이 화면을 정한다)
    if (!result.value.inView) setNotice(MOVED_OUT_OF_VIEW_NOTICE)
    // 열 사이로 옮겼으면 두 열의 머리 값이 바뀐다(2d-3). 열 안 이동은 값이 그대로다.
    if (target.key !== fromKey) void refreshCalculations()
    // 정렬된 보드: 옮긴 카드의 자리는 정렬이 정한다(머리말). 열 안 이동은 여기 오지 않는다(resolveDrop 이 null).
    if (!manualOrder && target.key !== fromKey) await reloadColumn(target.key)
  }

  // ── 읽기 ────────────────────────────────────────────────────────────

  const reloadColumn = async (key: string) => {
    const result = await api.loadGroupRows(workspaceId, viewId, key, null, props.search)
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
    const result = await api.loadGroupRows(workspaceId, viewId, group.key, group.nextCursor, props.search)
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

  /** `templateId` 가 `null` 이면 빈 카드다. 무엇으로 만들지는 열의 `New ▾` 가 정한다(`new-row-menu.tsx`). */
  const addCard = async (group: BoardGroupJson, templateId: string | null) => {
    if (busyKey !== null) return
    setBusyKey(group.key)
    setError(null)
    setNotice(null)
    // F-04-03: 그 그룹 값이 미리 채워진 새 카드. 값이 곧 그룹이라 열에서 사라지지 않는다.
    // 템플릿으로 만들어도 이 값이 **템플릿의 값을 덮는다**(08 F-08-03 — 서버가 호출자의 셀을 나중에 쓴다).
    const result = await api.createRowFrom(workspaceId, viewId, {
      templateId,
      // 범주 열(10n-27)은 서버가 정한 옵션으로 — `+` 는 그 옵션이 있을 때만 선다
      cells: prefillCells(property.type, property.id, fillKeyOf(group, property) ?? group.key),
    })
    setBusyKey(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const { row } = result.value
    update((current) =>
      current.map((g) => (g.key === group.key ? { ...g, rows: [...g.rows, row], count: g.count + 1 } : g)),
    )
    setNotice(templateRowNote(result.value.skippedPages, result.value.skippedLinks))
    void refreshCalculations()
    // 새 카드의 제목을 바로 받는다 — 이름 없는 카드가 쌓이지 않게(표와 같은 규칙).
    // ★ 초안은 그 카드의 **지금 제목**이다 — 템플릿이 준 제목을 빈 글자로 덮지 않는다(표의 `addRow` 와 같은 이유).
    if (access.canEditContent && titleColumn !== null) {
      setEditing({ rowId: row.id, draft: cellText(readCell('title', row.properties[titleColumn.propertyId])) })
    }
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
    // 뷰를 실어 보낸다 — 고친 카드가 조건 밖이면 곧 빠지므로 그 까닭을 말한다(10n-16)
    const result = await api.updateCellInView(workspaceId, e.rowId, titleColumn.propertyId, parsed.value, { id: viewId, search: props.search ?? null })
    if (!result.ok) {
      update((current) => mapRow(current, e.rowId, (r) => withValue(r, previous)))
      setError(result.message)
      return
    }
    takeRow(result.value.row)
    if (result.value.inView === false) setNotice(EDITED_OUT_OF_VIEW_NOTICE)
    // 제목의 계산(값 세기 · 고유 값)이면 머리 값이 바뀐다(2d-3).
    if (calculation?.propertyId === titleColumn.propertyId) void refreshCalculations()
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

  const { labels, icons: relationIcons } = useRelationLabels(
    workspaceId,
    props.relationLabels,
    props.relationIcons,
    groups.flatMap((g) => g.rows),
    columns,
  )
  // 사람 칸의 이름(6g-2) — 카드의 배지
  const { names: peopleNames } = usePeopleNames(workspaceId, props.peopleNames ?? {}, groups.flatMap((g) => g.rows), columns)
  // rollup 칸의 값(10n-33) — 카드의 배지. 신호로 서버 렌더를 다시 부르면 다시 계산된 것을 받아들인다(카드와 같은 때 · `use-rollup-values.ts` ③)
  const serverRollups = props.rollupValues ?? EMPTY_ROLLUP_PAGE
  const { page: rollups, adopt: adoptRollups } = useRollupValues(workspaceId, dataSourceId, serverRollups, groups.flatMap((g) => g.rows), columns)
  useAdoptServerValue(serverRollups, boardBusy, adoptRollups)
  // 수식 칸의 값(10n-34) — 카드의 배지. 그 카드의 칸으로 여기서 계산한다(표와 같은 함수 — 열을 옮겨 칸이 바뀌면 따라 바뀐다)
  const formulas = useMemo(() => (props.formulaPlan ? formulaEvaluator(props.formulaPlan) : null), [props.formulaPlan])
  const formulaValues = useMemo(() => formulaValuesByRow(formulas, groups.flatMap((g) => g.rows), columns), [formulas, groups, columns])

  const visible = groups.filter((g) => !g.hidden)
  const hiddenGroups = groups.filter((g) => g.hidden)
  /** 카드를 받을 수 있는 열 — 채울 값이 있다(`fillKeyOf`). 끌기 · "옮기기" 메뉴가 다른 열로 옮길 때 묻는다(B-2b ③). */
  const accepting = new Set(visible.filter((g) => fillKeyOf(g, property) !== null).map((g) => g.key))
  /** 카드의 "옮기기"가 고를 자리(10m-2) — 화면에 선 열만(숨긴 그룹으로는 옮기지 않는다 — 끌기와 같다). */
  const cardMove = (rowId: string): CardMove | null => {
    const choices = moveChoices(visible, rowId, manualOrder)
    if (choices === null) return null
    const labelByKey = new Map(visible.map((g) => [g.key, labelOf(g)]))
    return {
      ...choices,
      others: choices.others.filter((o) => accepting.has(o.key)).map((o) => ({ ...o, label: labelByKey.get(o.key) ?? o.key })),
    }
  }

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
                {calculation !== null && group.calculation !== null ? (
                  <span
                    data-testid="db-board-calc"
                    title={`${calculation.propertyName} · ${CALCULATION_LABEL[calculation.fn]}`}
                    className="truncate text-xs tabular-nums text-neutral-500 dark:text-neutral-400"
                  >
                    {formatCalculation(group.calculation)}
                  </span>
                ) : (
                  <span data-testid="db-board-count" className="text-xs tabular-nums text-neutral-400">
                    {group.count}
                  </span>
                )}
                <span className="ml-auto flex items-center">
                  {access.canCreateRows && fillKeyOf(group, property) !== null && (
                    <NewRowMenu
                      workspaceId={workspaceId}
                      viewId={viewId}
                      dataSourceId={dataSourceId}
                      defaultTemplate={defaultTemplate}
                      canSetDefault={access.canEditStructure}
                      canPickTemplate={access.canViewAllRows}
                      busy={busyKey !== null}
                      onCreate={(templateId) => void addCard(group, templateId)}
                      onDefaultChange={setDefaultTemplate}
                      label="+"
                      ariaLabel={
                        defaultTemplate === null
                          ? `${label}에 새로 만들기`
                          : `${label}에 ${defaultTemplate.title || UNTITLED_TEMPLATE} 템플릿으로 새로 만들기`
                      }
                      // 오른쪽 열에서 왼쪽 기준으로 열면 목록이 화면 밖으로 나간다.
                      align="right"
                      testId="db-board-add"
                    />
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
                    openHref={rowOpenHref(workspaceId, row.id, props.peekBase ?? null)}
                    groupKey={group.key}
                    badgeColumns={badgeColumns}
                    button={{ workspaceId, canPress: access.canEditContent }}
                    relationLabels={labels}
                    peopleNames={peopleNames}
                    relationIcons={relationIcons}
                    rollups={rollups}
                    formulaValues={formulaValues?.get(row.id)}
                    formulaErrors={formulas?.errors}
                    reminders={reminders[row.id]}
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
                    onPointerCancel={() => {
                      cancelPress()
                      endDrag()
                    }}
                    onContextMenu={onCardContextMenu}
                    move={access.canEditContent ? cardMove(row.id) : null}
                    onMove={(target) => moveByMenu(row.id, group.key, target)}
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
      {notice && (
        <p role="status" data-testid="db-notice" className="text-sm text-amber-700 dark:text-amber-300">
          {notice}
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
  openHref,
  groupKey,
  badgeColumns,
  button,
  relationLabels,
  peopleNames,
  relationIcons,
  rollups,
  formulaValues,
  formulaErrors,
  reminders,
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
  onContextMenu,
  move,
  onMove,
}: {
  row: RowJson
  /** 그 행 페이지(8f-1). */
  openHref: string
  groupKey: string
  badgeColumns: readonly ViewColumn[]
  /** 버튼 칸의 재료(5a-4) — 카드에도 단추가 선다. */
  button: { readonly workspaceId: string; readonly canPress: boolean }
  relationLabels: RelationLabels
  relationIcons: RelationIcons
  peopleNames: PeopleNames
  rollups: RollupPage
  formulaValues: Readonly<Record<string, FormulaValue>> | undefined
  formulaErrors: Readonly<Record<string, string | null>> | undefined
  reminders: Readonly<Record<string, DateReminderJson>> | undefined
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
  onPointerUp: (event: ReactPointerEvent<HTMLLIElement>) => void
  onPointerCancel: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLLIElement>) => void
  /** 끌지 않고 옮길 자리(10m-2) — 옮길 수 없으면 null(단추가 서지 않는다). */
  move: CardMove | null
  onMove: (target: DropTarget) => void
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
        onContextMenu={onContextMenu}
        // 터치 — 길게 누르는 동안 글자를 고르거나 기기의 미리 보기를 띄우지 않는다(10m-1)
        className={`flex flex-col gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 touch:select-none [-webkit-touch-callout:none] dark:border-neutral-700 dark:bg-neutral-950 ${
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
          // 카드 제목은 그 행 페이지의 아이콘을 앞에 단다(8c-3a — 없으면 기본 글리프).
          <div className="group/title flex items-start gap-1.5">
            <div
              data-testid="db-board-card-title"
              className={`flex min-w-0 flex-1 items-start gap-1.5 ${row.title ? 'break-words' : 'text-neutral-400'}`}
            >
              <PageIconView icon={row.icon} fallback className="mt-[0.2em]" />
              <span className="min-w-0">{row.title || UNTITLED}</span>
            </div>
            {/* 그 행 페이지를 연다(8f-1) — 카드를 끄는 누르기로 번지지 않게 막는다. 제목 옆에 둔다(제목의 글자에 섞이지 않게). */}
            <Link
              href={openHref}
              data-testid="db-row-open"
              aria-label={`${row.title || UNTITLED} 열기`}
              tabIndex={-1}
              onPointerDown={(e) => e.stopPropagation()}
              className="shrink-0 rounded border border-neutral-200 bg-white px-1.5 text-xs text-neutral-500 opacity-0 after:content-['열기'] hover:bg-neutral-50 group-hover/title:opacity-100 touch:opacity-100 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {move !== null && <CardMoveMenu title={row.title || UNTITLED} move={move} onMove={onMove} />}
          </div>
        )}
        <CardBadges
          row={row}
          columns={badgeColumns}
          relationLabels={relationLabels}
          relationIcons={relationIcons}
          peopleNames={peopleNames}
          rollups={rollups}
          formulaValues={formulaValues}
          formulaErrors={formulaErrors}
          reminders={reminders}
          testId="db-board-badge"
          button={button}
        />
      </li>
    </>
  )
}

/** 카드의 "옮기기"가 고를 자리 — 열의 이름을 붙였다(`moveChoices` 의 것). */
type CardMove = {
  readonly others: readonly { readonly key: string; readonly label: string; readonly target: DropTarget }[]
  readonly up: DropTarget | null
  readonly down: DropTarget | null
}

/**
 * 끌지 않고 옮기기(10m-2 · WCAG 2.5.7 끌기 동작의 대안 · 2.1.1 키보드) — 카드의 "옮기기" 단추가 자리 목록을 연다: 같은 열의 위 · 아래
 * (수동 순서일 때) · 다른 열마다(그 열의 맨 뒤). 끌기와 같은 자리라 같은 요청으로 간다(`commitMove`).
 *
 * 목록은 몸으로 내보낸 층이다(`AnchoredLayer`) — 그래서 DOM 의 탭 순서가 단추 뒤로 이어지지 않는다. 열 때 첫 항목에 포커스를 두고,
 * Esc 는 단추로 돌려준다 · 포커스가 층과 단추 밖으로 나가면 닫는다 · 바깥을 누르면 닫는다(`containsAcrossLayers`).
 */
function CardMoveMenu({ title, move, onMove }: { title: string; move: CardMove; onMove: (target: DropTarget) => void }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onDown = (e: MouseEvent) => {
      if (boxRef.current === null || !containsAcrossLayers(boxRef.current, e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = (target: DropTarget) => {
    setOpen(false)
    onMove(target)
  }
  const item = 'flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none dark:hover:bg-neutral-800 dark:focus:bg-neutral-800'

  return (
    <span
      ref={boxRef}
      className="relative shrink-0"
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
        data-testid="db-card-move"
        aria-label={`${title} 옮기기`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded border border-neutral-200 bg-white px-1.5 text-xs text-neutral-500 opacity-0 hover:bg-neutral-50 focus:opacity-100 group-hover/title:opacity-100 touch:opacity-100 aria-expanded:opacity-100 dark:border-neutral-700 dark:bg-neutral-900"
      >
        옮기기
      </button>
      {open && (
        <AnchoredLayer align="end">
          <div
            ref={listRef}
            role="group"
            aria-label={`${title} 옮길 자리`}
            data-testid="db-card-move-menu"
            className="w-52 popover-surface p-1 text-left text-sm font-normal dark:bg-neutral-950"
          >
            {move.up !== null && (
              <button type="button" data-testid="db-card-move-up" className={item} onClick={() => pick(move.up!)}>
                ↑ 위로
              </button>
            )}
            {move.down !== null && (
              <button type="button" data-testid="db-card-move-down" className={item} onClick={() => pick(move.down!)}>
                ↓ 아래로
              </button>
            )}
            {move.others.map((o) => (
              <button
                key={o.key}
                type="button"
                data-testid="db-card-move-to"
                data-group-key={o.key}
                className={item}
                onClick={() => pick(o.target)}
              >
                → {o.label}
              </button>
            ))}
          </div>
        </AnchoredLayer>
      )}
    </span>
  )
}
