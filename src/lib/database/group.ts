/**
 * 그룹 · 보드 — 보드 4a조각 (F-04-11 Group by · F-04-03 Board 의 서버 쪽)
 *
 * 정본: 00-canonical-data-model.md §3.6 (`view.group_by` · `row_position`) · §3.5 불변식 R1
 *       04-database-views.md F-04-11 (버킷 규칙 · 2단계 질의) · F-04-03 (드롭 = 셀 값 + 순서)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 그룹 키는 문자열 하나다 — 빈 값 그룹은 ''
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-04-11 의 버킷 규칙 중 **select · status · checkbox** 셋이다(04 의 현실적 대안: *"MVP 는 select/status/checkbox
 * 3종 그룹만"*). 키는 select · status 가 **옵션 id**(셀의 사이드카가 그것이다 · §3.2-8 — status 는 "그룹이 강제되는
 * select" 라 같은 길을 탄다 · `property-types.ts` `OPTION_TYPES`), checkbox 가 `'true'` · `'false'`. 값이 빈 행은 `''` 그룹("No X")에 모인다 — 정본 `row_position.group_key
 * DEFAULT ''` 가 그 자리다. 없는 옵션을 가리키는 셀(옵션이 지워진 뒤)도 `''` 로 접는다 — SQL 의 키 식이
 * 그렇게 계산하므로 카운트 · 행 · 커서가 한 규칙을 본다.
 *
 * **빈 그룹과 "No X" 그룹은 다른 개념이다**(F-04-11): 빈 그룹 = 옵션은 있으나 행이 0개(`hide_empty` 가 거른다),
 * "No X" = 값이 없는 행의 수집처(`hidden` 으로 개별 숨김). 그래서 `''` 도 `hidden` 에 들어갈 수 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 두 단계로 읽는다 — 카운트, 그리고 보이는 그룹의 상위 N행
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-04-11: *"그룹 200개 × 각 5,000행 → 2단계 쿼리 필수 — (1) 그룹 키 + 카운트만, (2) 화면에 보이는 그룹만
 * 상위 N행."* 카운트는 GROUP BY 한 번, 행은 윈도 함수(`row_number() OVER (PARTITION BY 키)`)로 그룹마다
 * `load_limit + 1` 개까지 한 번에 읽는다. 그 뒤는 그룹마다 독립 커서(`queryGroupRows`)다 — 한 열의 "더 보기"가
 * 다른 열을 다시 읽지 않는다(F-04-15).
 *
 * 권한은 `queryRows` 와 같다 — data_source 단위 게이트가 질의 앞에 있고, 못 보면 카운트도 내주지 않는다
 * (F-04-11: *"볼 수 없는 행은 그룹 카운트에서도 제외 — 카운트만으로 비공개 행의 존재가 드러나는 대표 경로"*).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 열 안 순서: 정렬이 있으면 정렬이, 없으면 `row_position` 이 정한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정렬 키가 살아 있으면 `row_position` 을 **읽지 않는다.** 정렬된 열에서 카드를 끌어 놓은 자리는 어차피 다음
 * 읽기에서 정렬이 되돌린다 — 노션도 정렬이 걸린 보드에서는 열 안 이동을 막는다. 그때 드롭은 셀 값만 바꾼다.
 *
 * 수동 순서는 **자리 있는 행(`order_idx` 순) → 자리 없는 행(트리 순서)** 이다. 새 행 · 옮겨 온 적 없는 행은
 * 자리가 없고, 그것이 정상이다(마이그레이션 0022 머리말). 자리 없는 행 **앞**에 놓으려면 그 행까지의 자리 없는
 * 행들에 먼저 자리를 준다(`materializePositions`) — 그래야 새 키를 그 사이에 만들 수 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 드롭은 한 트랜잭션이다 — 셀 값과 순서
 * ──────────────────────────────────────────────────────────────────────
 *
 * 마스터 문서 §5.2 4번: *"드롭 = '셀 값 + 순서' 2 mutation 을 **서버 단일 API** 로."* 둘로 나누면 "값은 바뀌었는데
 * 자리가 옛 열에 남은 카드"가 생긴다. 셀은 `row.ts` 의 `updateCellsIn` 으로 쓴다 — 검증 · 사이드카 · 제목 투영 ·
 * 버전 올리기를 여기 복사하지 않는다. 값이 이미 같으면 셀을 건드리지 않는다(버전이 헛되이 오르지 않는다).
 *
 * 권한은 **`edit_content`** 다. F-04-03: *"`Can edit content` 사용자 — 카드 드래그는 허용(셀 값 변경 = 데이터
 * 편집), 그룹 프로퍼티 변경 · 그룹 숨김은 차단. 이 둘을 한 권한으로 묶으면 board 가 사실상 읽기 전용이 된다."*
 * 그룹 설정(`group_by`)은 `view.ts` 의 `updateView` 가 `edit_structure` 로 지킨다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps, readableScopes } from '../permissions/effective.ts'
import { orderKeyBetween, orderKeysBetween } from '../block/order-key.ts'
import { textRun, type ValidationIssue } from '../contracts/rich-text.ts'
import {
  compileCursor,
  compileFilter,
  compileSorts,
  filterTypeOf,
  ParamBag,
  UNGROUPED_ORDER_KEY,
  type CompiledSort,
  type FilterContext,
  type FilterNode,
  type PropertyTypes,
  type SortKey,
} from './filter.ts'
import { refreshDerivedForView } from './derived-values.ts'
import {
  STATUS_GROUP_KINDS,
  isGroupableType,
  isOptionType,
  optionValue,
  readStatusDefault,
  type CellValue,
  type DateValue,
  type GroupableType,
  type SelectOption,
  type StatusGroupKind,
} from './property-types.ts'
import { readOptionsOf } from './options.ts'
import {
  DEFAULT_DATE_UNIT,
  DEFAULT_WEEK_START,
  RELATIVE_KEYS,
  isBucketKey,
  isDateUnit,
  isWeekStart,
  relativeDayOf,
  shiftDateValue,
  todayIn,
  type DateUnit,
  type WeekStart,
} from './date-group.ts'
import { DEFAULT_NUMBER_SIZE, isNumberBucketKey, isNumberSize, shiftNumber } from './number-group.ts'
import { DEFAULT_TEXT_MODE, FOLDED_CHOSEONG, OTHER_INITIAL, compareTextKeys, isInitialKey, isTextMode, type TextMode } from './text-group.ts'
import { readSubItemPair } from './sub-items.ts'
import {
  compileTree,
  decodeCursorValues,
  encodeCursorValues,
  readPropertyTypes,
  toQueriedRow,
  type QueriedRow,
  type RowRow,
} from './query.ts'
import { readRow, updateCellsIn, type RowFailure, type RowSummary } from './row.ts'
import { MAX_QUERY_LIMIT } from './limits.ts'
import { calculationResult, canCalculate, isCalculation, type Calculation, type CalculationResult } from './calculations.ts'
import {
  columnStatsOf,
  completeIdsOf,
  EMPTY_STATS_ROW,
  statsJsonSql,
  type CalculatedColumn,
  type Calculations,
  type StatsRow,
} from './calculate.ts'
import { compileSearch } from './search.ts'
import { canViewOwnerDatabase } from './source-access.ts'
import { restrictedRowsSql, rowsAccessIn, type RowsAccess } from './row-access.ts'
import { isCardView } from './view-columns.ts'
import { readSubItemDisplay } from './sub-item-scope.ts'

// ── 계약 ──────────────────────────────────────────────────────────────

/** 그룹으로 묶을 수 있는 타입. F-04-11 의 9종 중 셋(머리말). 정의는 클라이언트도 읽는 `property-types.ts` 에 있다. */
export { GROUPABLE_TYPES, isGroupableType, type GroupableType } from './property-types.ts'

/** 값이 없는 행의 그룹. 정본 `row_position.group_key DEFAULT ''`. */
export const NO_VALUE_KEY = ''
/** 숨긴 그룹 키 목록의 상한 — F-04-11 의 "그룹 200개" 규모. */
export const MAX_HIDDEN_GROUPS = 200

/**
 * `view.group_by` 의 모양. `SortKey` 처럼 snake_case 로 저장한다.
 *
 * 그룹 순서는 **옵션 순서(스키마 전역)** 다 — 뷰별 `group_order` 배열을 두지 않았다. F-04-11 동시편집 엣지의
 * 권고: *"그룹 순서를 select 옵션의 fractional index 로 옮기면 배열 LWW 자체가 사라진다 — 단 뷰별 그룹 순서를
 * 포기하게 된다."* 그 트레이드오프를 택했다. `hidden` 은 배열이라 LWW 지만, 죽은 키는 렌더에서 무시한다
 * (F-04-11: "지연 GC — 매 조회마다 정리 쿼리를 돌리면 쓰기 부하가 는다").
 */
export type GroupBy = {
  readonly property_id: string
  /** 숨긴 그룹 키. `''` 도 올 수 있다("No X" 숨김). */
  readonly hidden?: readonly string[]
  /** 행이 0개인 그룹을 그리지 않는다. `''` 그룹도 포함이다. */
  readonly hide_empty?: boolean
  /**
   * 그룹 머리의 계산(2d-3 · F-04-16) — 없으면 카드 수(노션 보드의 기본). 모든 그룹이 같은 계산이다. 모양과 함수 이름은 CHECK
   * (`ck_view_group_by_calculation` · 0055)이 막는다. `null` 은 저장하지 않는다(받으면 "없음"으로 접는다).
   */
  readonly calculation?: GroupCalculation | null
  /**
   * status 를 범주(그룹) 단위로 묶는다(10n-27 · 정본 §3.6 [보강] `view.group_by` · 03 F-03-05) — 열이 할 일 · 진행 중 · 완료이고 키가 그룹
   * kind 다. 없으면 옵션 단위. status 가 아닌 속성에 주면 거부한다.
   */
  readonly status_by?: 'group'
  /**
   * 날짜를 묶는 단위(B-1 · 정본 §3.6 [보강 B-1] · F-04-11) — 일 · 주 · 월 · 년. 없으면 월(`DEFAULT_DATE_UNIT`). 날짜가 아닌 속성에 주면
   * 거부한다. 키는 버킷의 첫 날(`YYYY-MM-DD` · `date-group.ts`)이다.
   */
  readonly date_unit?: DateUnit
  /** 주의 시작 요일(B-3b) — 없으면 월요일. 날짜 속성의 단위 "주"에서만 읽는다(날짜가 아닌 속성이면 거부). */
  readonly week_start?: WeekStart
  /**
   * 숫자를 묶는 구간의 크기(B-2 · 정본 §3.6 [보강 B-2]) — 0 보다 크고 소수 여섯 자리까지. 없으면 10. 숫자가 아닌 속성에 주면 거부한다.
   * 키는 구간의 아래 끝(`number-group.ts`)이다.
   */
  readonly number_size?: number
  /**
   * 글을 묶는 방식(B-2b · 정본 §3.6 [보강 B-2b]) — `exact`(글 그대로 · 없으면 이것) · `first`(첫 글자 — 한글은 초성). 글(`rich_text`)
   * 속성에만 — 아니면 거부한다.
   */
  readonly text_by?: TextMode
  /**
   * 그룹의 순서(S-1 · 정본 §3.6 [보강 S-1] · 04 F-04-11 `group_by.sort`) — 데이터에서 나온 그룹(날짜 · 숫자 · 글)만 오름 · 내림. 없으면
   * 오름차순(`descending` 만 저장한다). 선택 · 상태 · 체크박스에 주면 거부한다 — 그 순서는 옵션 순서다(뷰별 `group_order` 를 두지 않는다).
   */
  readonly sort?: GroupSort
}

/** 그룹의 순서(S-1). 값 없음 그룹은 어느 쪽이든 맨 앞이다(노션 보드의 "No X" 열 — 왼쪽 끝). */
export const GROUP_SORTS = ['ascending', 'descending'] as const
export type GroupSort = (typeof GROUP_SORTS)[number]

export function isGroupSort(value: unknown): value is GroupSort {
  return typeof value === 'string' && (GROUP_SORTS as readonly string[]).includes(value)
}

/** 순서를 고를 수 있는 그룹 — 그룹이 옵션이 아니라 데이터에서 나오는 타입(B-1 · B-2 · B-2b). */
const SORTABLE_GROUP_TYPES: readonly string[] = ['date', 'number', 'rich_text']

/** 그룹 머리의 계산 — 어느 속성의 칸으로 어느 함수를. */
export type GroupCalculation = { readonly property_id: string; readonly function: Calculation }

export function validateGroupBy(raw: unknown, types: PropertyTypes): ValidationIssue[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [{ path: 'groupBy', message: '객체여야 합니다' }]
  }
  const g = raw as Record<string, unknown>
  const issues: ValidationIssue[] = []
  if (typeof g.property_id !== 'string' || !types.has(g.property_id)) {
    issues.push({ path: 'groupBy.property_id', message: '없는 프로퍼티입니다' })
  } else if (!isGroupableType(types.get(g.property_id))) {
    issues.push({ path: 'groupBy.property_id', message: 'select · status · checkbox · 날짜 · 숫자 · 글 프로퍼티만 그룹으로 묶을 수 있습니다' })
  }
  if (g.hidden !== undefined) {
    if (!Array.isArray(g.hidden) || g.hidden.some((k) => typeof k !== 'string')) {
      issues.push({ path: 'groupBy.hidden', message: '문자열 배열이어야 합니다' })
    } else if (g.hidden.length > MAX_HIDDEN_GROUPS) {
      issues.push({ path: 'groupBy.hidden', message: `숨긴 그룹이 ${MAX_HIDDEN_GROUPS}개를 넘습니다` })
    }
  }
  if (g.hide_empty !== undefined && typeof g.hide_empty !== 'boolean') {
    issues.push({ path: 'groupBy.hide_empty', message: 'boolean 이어야 합니다' })
  }
  // 범주 단위(10n-27) — status 에만 'group'
  if (g.status_by !== undefined && !(g.status_by === 'group' && typeof g.property_id === 'string' && types.get(g.property_id) === 'status')) {
    issues.push({ path: 'groupBy.status_by', message: "status 속성에만 'group' 을 줄 수 있습니다" })
  }
  // 날짜의 단위(B-1) — 날짜 속성에만 · 일 · 주 · 월 · 년
  if (g.date_unit !== undefined && !(isDateUnit(g.date_unit) && typeof g.property_id === 'string' && types.get(g.property_id) === 'date')) {
    issues.push({ path: 'groupBy.date_unit', message: "날짜 속성에만 'day' · 'week' · 'month' · 'year' 를 줄 수 있습니다" })
  }
  // 주의 시작 요일(B-3b) — 날짜 속성에만 · 월요일 · 일요일
  if (g.week_start !== undefined && !(isWeekStart(g.week_start) && typeof g.property_id === 'string' && types.get(g.property_id) === 'date')) {
    issues.push({ path: 'groupBy.week_start', message: "날짜 속성에만 'monday' · 'sunday' 를 줄 수 있습니다" })
  }
  // 숫자의 구간 크기(B-2) — 숫자 속성에만 · 0 보다 크고 소수 여섯 자리까지
  if (g.number_size !== undefined && !(isNumberSize(g.number_size) && typeof g.property_id === 'string' && types.get(g.property_id) === 'number')) {
    issues.push({ path: 'groupBy.number_size', message: '숫자 속성에만 0 보다 큰 구간 크기(소수 여섯 자리까지)를 줄 수 있습니다' })
  }
  // 글을 묶는 방식(B-2b) — 글 속성에만 · 글 그대로 · 첫 글자
  if (g.text_by !== undefined && !(isTextMode(g.text_by) && typeof g.property_id === 'string' && types.get(g.property_id) === 'rich_text')) {
    issues.push({ path: 'groupBy.text_by', message: "글 속성에만 'exact' · 'first' 를 줄 수 있습니다" })
  }
  // 그룹의 순서(S-1) — 데이터에서 나온 그룹(날짜 · 숫자 · 글)에만 · 오름 · 내림
  if (
    g.sort !== undefined &&
    !(isGroupSort(g.sort) && typeof g.property_id === 'string' && SORTABLE_GROUP_TYPES.includes(types.get(g.property_id) ?? ''))
  ) {
    issues.push({ path: 'groupBy.sort', message: "날짜 · 숫자 · 글 속성에만 'ascending' · 'descending' 을 줄 수 있습니다(선택 · 상태는 옵션 순서)" })
  }
  // 그룹 머리의 계산(2d-3) — null 은 "없음"(카드 수). 고를 때는 살아 있고 그 함수를 고를 수 있는 타입이어야 한다.
  if (g.calculation !== undefined && g.calculation !== null) {
    const c = g.calculation as Record<string, unknown>
    if (typeof c !== 'object' || Array.isArray(c) || typeof c.property_id !== 'string' || !isCalculation(c.function)) {
      issues.push({ path: 'groupBy.calculation', message: '{ property_id, function } 이어야 합니다' })
    } else {
      const type = types.get(c.property_id)
      if (type === undefined) issues.push({ path: 'groupBy.calculation.property_id', message: '없는 프로퍼티입니다' })
      else if (!canCalculate(type, c.function)) {
        issues.push({ path: 'groupBy.calculation.function', message: '이 속성에서 고를 수 없는 계산입니다' })
      }
    }
  }
  return issues
}

/**
 * 지금 타입에 맞는 버킷 키만 남긴다(S-1 · 정본 [보강 S-1] ④) — 타입을 바꾼 뒤의 저장값(날짜의 단위 · 순서 …)은 지우지 않지만 화면에는 그
 * 타입의 키만 보인다(`ViewDetail.groupBy`). 화면이 지금 설정에 얹어 저장해도 검사에 걸리지 않고, 그 저장이 낡은 키를 정리한다.
 */
export function fitGroupByToType(g: GroupBy, type: string): GroupBy {
  const { status_by, date_unit, week_start, number_size, text_by, sort, ...rest } = g
  return {
    ...rest,
    ...(type === 'status' && status_by !== undefined ? { status_by } : {}),
    ...(type === 'date' && date_unit !== undefined ? { date_unit } : {}),
    ...(type === 'date' && week_start !== undefined ? { week_start } : {}),
    ...(type === 'number' && number_size !== undefined ? { number_size } : {}),
    ...(type === 'rich_text' && text_by !== undefined ? { text_by } : {}),
    ...(SORTABLE_GROUP_TYPES.includes(type) && sort !== undefined ? { sort } : {}),
  }
}

/** 저장할 모양으로 정리한다 — 모르는 키를 버리고 중복 hidden 을 접는다. `validateGroupBy` 를 지난 값만. */
export function normalizeGroupBy(raw: GroupBy): GroupBy {
  const hidden = [...new Set(raw.hidden ?? [])]
  const calculation = raw.calculation
  return {
    property_id: raw.property_id,
    ...(hidden.length > 0 ? { hidden } : {}),
    ...(raw.hide_empty ? { hide_empty: true } : {}),
    ...(raw.status_by === 'group' ? { status_by: 'group' as const } : {}),
    ...(isDateUnit(raw.date_unit) ? { date_unit: raw.date_unit } : {}),
    ...(isWeekStart(raw.week_start) && raw.week_start !== DEFAULT_WEEK_START ? { week_start: raw.week_start } : {}),
    ...(isNumberSize(raw.number_size) ? { number_size: raw.number_size } : {}),
    ...(isTextMode(raw.text_by) ? { text_by: raw.text_by } : {}),
    ...(raw.sort === 'descending' ? { sort: 'descending' as const } : {}),
    ...(calculation !== undefined && calculation !== null
      ? { calculation: { property_id: calculation.property_id, function: calculation.function } }
      : {}),
  }
}

/**
 * 그룹 머리의 계산이 지금 살아 있는가 — 프로퍼티가 있고 그 타입이 그 함수를 고를 수 있을 때만(2d-3). 지워졌거나 타입을 바꿔 맞지
 * 않게 됐으면 null 이다 — 머리는 카드 수로 돌아가고 저장값은 남는다(열 집계와 같은 태도 · `computeCalculations`).
 */
export function liveGroupCalculation(groupBy: GroupBy, types: PropertyTypes): GroupCalculation | null {
  const c = groupBy.calculation
  if (c === undefined || c === null) return null
  const type = types.get(c.property_id)
  return type !== undefined && canCalculate(type, c.function) ? c : null
}

// ── 결과 모양 ─────────────────────────────────────────────────────────

export type BoardGroup = {
  readonly key: string
  /** select · status 그룹의 옵션. `''` 그룹 · checkbox 그룹 · 범주 열은 null. */
  readonly option: SelectOption | null
  /** 범주 열의 그룹(10n-27) — `status_by: 'group'` 일 때만. 그 밖은 null. */
  readonly statusGroup: StatusGroupKind | null
  /**
   * 이 열에 놓거나 이 열의 `+` 로 만든 카드가 받는 옵션 — 옵션 열은 그 옵션, 범주 열은 "기본 옵션이 그 범주면 그것, 아니면 그 범주의
   * 첫 옵션"(10n-27). 범주에 옵션이 없거나 `''` · checkbox 열이면 null.
   */
  readonly fillOptionId: string | null
  /** 필터를 지난 행 수. 숨긴 그룹도 센다(숨긴 그룹 목록에 개수를 보여 준다). */
  readonly count: number
  readonly hidden: boolean
  /** 그룹 머리의 계산 값(2d-3) — 계산이 없거나 살아 있지 않으면 null(머리는 카드 수). 숨긴 그룹도 계산한다. */
  readonly calculation: CalculationResult | null
  /** 숨긴 그룹은 비어 있다. */
  readonly rows: readonly QueriedRow[]
  readonly hasMore: boolean
  readonly nextCursor: string | null
}

export type GroupsPage = {
  readonly propertyId: string
  readonly propertyType: GroupableType
  /** 정렬 키가 없어 `row_position` 이 순서를 정한다 — 화면은 이때만 열 안 이동을 허용한다. */
  readonly manualOrder: boolean
  /** 살아 있는 그룹 머리의 계산(2d-3 · `liveGroupCalculation`). 없으면 null — 머리는 카드 수. */
  readonly calculation: GroupCalculation | null
  /** 묶는 단위(10n-27) — status 의 범주 단위면 `'group'`. */
  readonly statusBy: 'option' | 'group'
  /** 날짜로 묶으면 그 단위(B-1) — 그 밖은 null. 화면이 머리의 이름(`dateGroupLabel`)과 새 행의 날짜를 이것으로 만든다. */
  readonly dateUnit: DateUnit | null
  /** 숫자로 묶으면 그 구간의 크기(B-2) — 그 밖은 null. 화면이 머리의 이름(`numberGroupLabel`)을 이것으로 만든다. */
  readonly numberSize: number | null
  /** 글로 묶으면 그 방식(B-2b) — 그 밖은 null. 화면이 머리의 이름과 받을 수 있는 덩이(첫 글자면 없다)를 이것으로 정한다. */
  readonly textMode: TextMode | null
  /** 상대 날짜로 묶으면(B-3) 서버가 쓴 오늘(`YYYY-MM-DD` — 보는 사람의 시간대) — 화면이 "새로 만들기"의 날짜를 이것으로 채운다. 그 밖은 null. */
  readonly today: string | null
  readonly groups: readonly BoardGroup[]
  /** 하위 그룹(B-4a · 보드의 가로줄) — 없으면 null. 있으면 열(`groups`)의 행은 비어 있고 칸(`sub.groups[].cells`)이 행을 싣는다. */
  readonly sub: SubGroupsPage | null
}

/** 하위 그룹(B-4a)의 칸 하나 — (가로줄, 열). 행은 그 칸의 첫 페이지 · 칸마다 커서(`queryGroupRows` 의 `subKey`). */
export type SubGroupCell = {
  readonly count: number
  readonly rows: readonly QueriedRow[]
  readonly hasMore: boolean
  readonly nextCursor: string | null
}

/** 가로줄 하나 — 열과 같은 머리(옵션 · 범주 · 채울 옵션) · 그 줄의 행 수 · 숨김 · 열 키 → 칸. */
export type SubGroup = {
  readonly key: string
  readonly option: SelectOption | null
  readonly statusGroup: StatusGroupKind | null
  readonly fillOptionId: string | null
  readonly count: number
  readonly hidden: boolean
  readonly cells: Readonly<Record<string, SubGroupCell>>
}

/** 하위 그룹(B-4a) — 가로줄 축의 설정(화면이 이름 · 새 행 채우기를 이것으로) · 가로줄들(순서대로). */
export type SubGroupsPage = {
  readonly propertyId: string
  readonly propertyType: GroupableType
  readonly statusBy: 'option' | 'group'
  readonly dateUnit: DateUnit | null
  readonly numberSize: number | null
  readonly textMode: TextMode | null
  readonly today: string | null
  readonly groups: readonly SubGroup[]
}

/** 그룹 머리의 계산만(2d-3) — 카드를 옮긴 뒤 머리의 값을 다시 받는다. 행은 읽지 않는다. */
export type GroupCalculationsPage = {
  readonly calculation: GroupCalculation | null
  /** 그룹 키 → 값. 계산이 없으면 비어 있다. */
  readonly values: Readonly<Record<string, CalculationResult>>
}

export type GroupRowsPage = {
  readonly rows: readonly QueriedRow[]
  readonly hasMore: boolean
  readonly nextCursor: string | null
}

export type MoveRowInput = {
  readonly rowId: string
  /** 놓을 그룹. 옵션 id · `'true'`/`'false'` · `''`. */
  readonly groupKey: string
  /** 이 행 **앞**에 놓는다. `null` 이면 열의 맨 뒤. 정렬이 걸린 뷰에서는 무시된다. */
  readonly beforeRowId?: string | null
  /** 화면이 쓰고 있는 뷰 검색어(2e-1) — 옮긴 뒤 "아직 이 보드에 서는가"(`inView`)를 물을 때만 쓴다. 이동 자체에는 상관없다. */
  readonly search?: string | null
  /**
   * 덩이 안의 차례만 바꾼다(표의 그룹 G-2b · 정본 [보강 G-1] ⑦) — 그 행이 지금 이 그룹이 아니면 셀을 쓰지 않고 거부한다(`not_found` —
   * 화면이 낡았다). 표는 고쳐서 다른 그룹 값이 된 행을 고친 덩이에 남기므로(④), 그 행을 덩이 안에서 끌면 보드의 규칙으론 값이 되돌아간다.
   */
  readonly within?: boolean
  /** 보는 사람의 오늘(B-3 · `YYYY-MM-DD`) — 상대 날짜 그룹의 키를 셀 때. 없으면 UTC 의 오늘. */
  readonly today?: string | null
  /** 놓을 가로줄(B-4a · 하위 그룹이 있는 보드). 주지 않으면 그 행의 지금 가로줄에 남는다. */
  readonly subGroupKey?: string
}

export type MoveOutcome = {
  readonly row: RowSummary
  readonly groupKey: string
  /** 놓인 가로줄(B-4a) — 하위 그룹이 없으면 null. */
  readonly subGroupKey: string | null
  /** 순서를 저장했는가. 정렬이 걸린 뷰면 false — 셀 값만 바뀌었다. */
  readonly positioned: boolean
  /**
   * 옮긴 행이 아직 이 보드에 서는가(10n-15 · 정본 §3.6 [보강] 옮긴 카드가 보드의 조건 밖으로 나가면) — 보드가 행을 고르는 술어 그대로
   * (권한 · 이 사람이 실제로 보는 필터 · 하위 항목 · 화면이 보낸 검색어). 거짓이면 화면이 안내한다(F-04-03 · F-04-24).
   */
  readonly inView: boolean
}

export type GroupFailure = RowFailure | 'not_grouped'

export type GroupResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly reason: GroupFailure
      readonly issues?: readonly ValidationIssue[]
      readonly currentVersion?: string
    }

const fail = (reason: GroupFailure): GroupResult<never> => ({ ok: false, reason })

function isFailure<T>(v: T | GroupResult<never>): v is GroupResult<never> {
  return typeof v === 'object' && v !== null && 'ok' in v
}

// ── 뷰 열기 ───────────────────────────────────────────────────────────

type Board = {
  readonly viewId: string
  readonly dataSourceId: string
  readonly filter: FilterNode | null
  readonly sorts: readonly SortKey[]
  readonly loadLimit: number
  readonly groupBy: GroupBy
  readonly propertyType: GroupableType
  readonly options: readonly SelectOption[]
  readonly types: PropertyTypes
  /**
   * 하위 항목의 상위 항목 프로퍼티(2b-2b). 있으면 보드는 **부모만**(최상위 행) 그린다 — 03 F-03-18 *"보드/캘린더/갤러리 뷰는
   * Parents only 만 지원"*. 카드의 열 · 개수도 같은 조건을 지난다.
   */
  readonly subItemsParent: string | null
  /** 살아 있는 그룹 머리의 계산(2d-3). */
  readonly calculation: GroupCalculation | null
  /**
   * 뷰 검색어(2e-1 · F-04-27) — 카드 · 개수 · 머리 값이 같이 좁혀진다(필터와 AND). 그룹(열)은 남는다 — 04 *"그룹은 유지하고 카드만
   * 좁힌다. 빈 그룹이 되어도 컬럼은 남기는 편이 덜 혼란스럽다"*(빈 그룹 숨김을 켰으면 그것이 따로 거른다).
   */
  readonly search: string | null
  /** 행의 범위(6f-2b-1) — "만들기만" 이면 자기가 열 수 있는 카드만 · 개수 · 머리 값도 같다(`compileBoard` 하나가 WHERE 를 만든다). */
  readonly access: RowsAccess
  /** 필터의 "나"(6g-2c) — 보드를 연 세션의 사람. */
  readonly context: FilterContext
  /** status 를 범주 단위로 묶는다(10n-27) — 열 · 키가 그룹 kind 다. */
  readonly statusByGroup: boolean
  /** 범주 단위일 때 그 속성의 기본 옵션 — 범주 열에 놓은 카드가 받을 옵션을 정한다. 그 밖은 null. */
  readonly defaultOptionId: string | null
  /** 날짜로 묶는 단위(B-1) — 날짜 속성이면 저장값(없으면 월), 그 밖은 null. 그룹은 옵션이 아니라 데이터에서 나온다(`catalogOf`). */
  readonly dateUnit: DateUnit | null
  /** 숫자로 묶는 구간의 크기(B-2) — 숫자 속성이면 저장값(없으면 10), 그 밖은 null. 그룹은 데이터에서 나온다(`catalogOf`). */
  readonly numberSize: number | null
  /** 글로 묶는 방식(B-2b) — 글 속성이면 저장값(없으면 글 그대로), 그 밖은 null. 그룹은 데이터에서 나온다(`catalogOf`). */
  readonly textMode: TextMode | null
  /** 보는 사람의 오늘(B-3 · `YYYY-MM-DD`) — 상대 날짜 그룹의 키가 이것에서 며칠 떨어졌나다. */
  readonly today: string
  /** 주의 시작 요일(B-3b) — 날짜를 주로 묶을 때 키가 그 요일의 날이다. */
  readonly weekStart: WeekStart
  /** 그룹의 순서(S-1) — 데이터에서 나온 그룹을 오름 · 내림으로. 옵션 · 체크박스 축은 읽지 않는다(늘 오름). */
  readonly sort: GroupSort
  /** 하위 그룹(B-4a · 보드의 가로줄) — 보드이고 `sub_group_by` 가 살아 있는 · 그룹 기준과 다른 속성을 가리킬 때만. */
  readonly sub: GroupAxis | null
  /** 뷰 검색의 relation 제목(V-2)을 찾을 읽기 범위 — 검색어가 있을 때만(`readableScopes`) · 없으면 null. */
  readonly searchScopes: readonly string[] | null
}

/**
 * 그룹 축 하나의 설정(B-4a) — 열(`group_by`)과 가로줄(`sub_group_by`)이 같은 규칙(키 식 · 목록 · 키 판정 · 놓을 때의 값)을 쓴다. 보드는
 * 열의 축이기도 하다(`Board` 가 이 필드를 다 갖는다).
 */
type GroupAxis = Pick<
  Board,
  | 'groupBy'
  | 'propertyType'
  | 'options'
  | 'statusByGroup'
  | 'defaultOptionId'
  | 'dateUnit'
  | 'numberSize'
  | 'textMode'
  | 'today'
  | 'weekStart'
  | 'sort'
>

/** 보드를 읽는 요청의 공통 입력 — 뷰 검색어(2e-1) · 보는 사람의 오늘(B-3 — 상대 날짜 그룹 · 없으면 UTC 의 오늘). */
export type BoardReadInput = { readonly search?: string | null; readonly today?: string | null }

/**
 * 그룹이 걸린 뷰를 열고 권한 · 그룹 프로퍼티를 읽는다.
 *
 * 그룹 프로퍼티가 지워졌으면 `not_grouped` 다 — `view.ts` 의 `readView` 가 그런 뷰의 `groupBy` 를 null 로
 * 주는 것과 같은 규칙(죽은 참조는 읽기에서 무시한다). 복원하면 그대로 돌아온다.
 */
async function openBoard(
  tx: Tx,
  ctx: SessionContext,
  viewId: string,
  need: 'view' | 'edit_content',
  search: string | null = null,
  today: string | null = null,
): Promise<Board | GroupResult<never>> {
  const view = await tx.queryMaybe<{
    database_id: string
    data_source_id: string
    owner: string
    filter: unknown
    sorts: unknown
    group_by: unknown
    sub_group_by: unknown
    type: string
    load_limit: number
    sub_item_display: string | null
  }>(
    // 필터 · 정렬은 이 사람이 실제로 보는 것 — 개인 것이 있으면 그것이 공유 것을 대체한다(2h-1 · F-04-17 · `view.ts` `effectiveFilter`).
    `SELECT v.database_id, v.data_source_id, ds.owner_database_id AS owner,
            coalesce(o.filter, v.filter) AS filter, coalesce(o.sorts, v.sorts) AS sorts,
            v.group_by, v.sub_group_by, v.type, v.load_limit, v.sub_item_display
       FROM view v
       JOIN block b ON b.id = v.database_id
       JOIN data_source ds ON ds.id = v.data_source_id
       LEFT JOIN view_user_override o ON o.view_id = v.id AND o.user_id = $3
      WHERE v.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live' AND ds.lifecycle = 'live'
        AND v.owner_kind = 'database_view'`,
    [viewId, ctx.workspaceId, ctx.userId],
  )
  if (view === null) return fail('not_found')

  const caps = await effectiveCaps(tx, ctx, view.database_id)
  const access = await rowsAccessIn(tx, ctx, caps)
  if (access === null) return fail('not_found')
  // 붙인 소스의 보드(2l-2) — 카드는 원본의 행이다. 원본을 못 보면 없는 것과 같다(`view.ts` `openView` 와 같은 규칙). 카드를 다른 열로
  // 옮기는 셀 쓰기는 `updateCellsIn` 이 원본의 `edit_content` 로 다시 묻는다 — 아래의 `edit_content` 는 이 뷰 안의 자리(`row_position`)의 것이다.
  if (view.owner !== view.database_id && !(await canViewOwnerDatabase(tx, ctx, view.owner))) return fail('not_found')
  if (need === 'edit_content' && !can(caps, 'edit_content')) return fail('forbidden')

  const groupBy = view.group_by as GroupBy | null
  if (groupBy === null || typeof groupBy !== 'object' || typeof groupBy.property_id !== 'string') {
    return fail('not_grouped')
  }
  const types = await readPropertyTypes(tx, view.data_source_id)
  // 상대 날짜(B-3)의 오늘 — 부르는 쪽이 보는 사람의 시간대로 셈해 준다(`readViewerToday`). 모양이 틀리면 UTC 의 오늘
  const todayKey = typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : todayIn('UTC')
  const axis = await readAxis(tx, groupBy, types, todayKey)
  if (axis === null) return fail('not_grouped')
  // 하위 그룹(B-4a) — 보드에서만 · 살아 있는 · 그룹 기준과 다른 속성일 때만(아니면 저장값은 두고 읽지 않는다)
  const rawSub = view.sub_group_by as GroupBy | null
  const sub =
    view.type === 'board' && rawSub !== null && typeof rawSub === 'object' && typeof rawSub.property_id === 'string' && rawSub.property_id !== groupBy.property_id
      ? await readAxis(tx, rawSub, types, todayKey)
      : null

  return {
    viewId,
    dataSourceId: view.data_source_id,
    filter: (view.filter as FilterNode | null) ?? null,
    sorts: Array.isArray(view.sorts) ? (view.sorts as SortKey[]) : [],
    loadLimit: view.load_limit,
    types,
    // 카드 뷰(보드 · 갤러리)가 평평한 목록이면 하위 항목도 따로 카드로 — 부모만을 풀다(K-1). 그룹이 걸린 표 · 목록은 늘 부모만(G-1)
    subItemsParent:
      isCardView(view.type) && readSubItemDisplay(view.sub_item_display) === 'flattened'
        ? null
        : ((await readSubItemPair(tx, view.data_source_id))?.parentPropertyId ?? null),
    calculation: liveGroupCalculation(groupBy, types),
    search,
    access,
    // 상대 날짜 필터(R-1)도 그 오늘로 — 상대 날짜 그룹(B-3)과 같은 날
    context: { me: ctx.userId, today: todayKey },
    ...axis,
    sub,
    // 뷰 검색의 relation 제목(V-2) — 검색어가 있을 때만 읽기 범위를 묻는다
    searchScopes: search === null ? null : await readableScopes(tx, ctx),
  }
}

/** 축 하나를 읽는다 — 묶을 수 없는 속성(지워졌거나 타입이 바뀌었다)이면 null. */
async function readAxis(tx: Tx, groupBy: GroupBy, types: PropertyTypes, today: string): Promise<GroupAxis | null> {
  const propertyType = types.get(groupBy.property_id)
  if (!isGroupableType(propertyType)) return null
  // 범주 단위(10n-27) — status 에서만 산다(타입을 바꾼 뒤의 저장값은 옵션 단위로 읽는다)
  const statusByGroup = propertyType === 'status' && groupBy.status_by === 'group'
  const defaultOptionId = statusByGroup
    ? readStatusDefault((await tx.queryOne<{ config: unknown }>(`SELECT config FROM property WHERE id = $1`, [groupBy.property_id])).config)
    : null
  return {
    groupBy,
    propertyType,
    options: isOptionType(propertyType) ? await readOptions(tx, groupBy.property_id) : [],
    statusByGroup,
    defaultOptionId,
    dateUnit: propertyType === 'date' ? (isDateUnit(groupBy.date_unit) ? groupBy.date_unit : DEFAULT_DATE_UNIT) : null,
    numberSize: propertyType === 'number' ? (isNumberSize(groupBy.number_size) ? groupBy.number_size : DEFAULT_NUMBER_SIZE) : null,
    textMode: propertyType === 'rich_text' ? (isTextMode(groupBy.text_by) ? groupBy.text_by : DEFAULT_TEXT_MODE) : null,
    today,
    weekStart: isWeekStart(groupBy.week_start) ? groupBy.week_start : DEFAULT_WEEK_START,
    // 그룹의 순서(S-1) — 데이터에서 나온 그룹만(타입을 바꾼 뒤의 저장값은 오름으로 읽는다)
    sort: SORTABLE_GROUP_TYPES.includes(propertyType) && groupBy.sort === 'descending' ? 'descending' : 'ascending',
  }
}

/** 열의 순서가 곧 이 순서다. status 옵션은 그룹 순서가 먼저다(`options.ts` 머리말). */
async function readOptions(tx: Tx, propertyId: string): Promise<SelectOption[]> {
  return (await readOptionsOf(tx, [propertyId])).get(propertyId) ?? []
}

/**
 * 그룹 목록(순서대로). `''` 가 **맨 앞**이다 — 노션 보드의 "No X" 열이 왼쪽 끝에 있다.
 * checkbox 는 안 된 것 → 된 것(할 일 보드의 자연스러운 순서).
 */
type CatalogEntry = { key: string; option: SelectOption | null; statusGroup: StatusGroupKind | null; fillOptionId: string | null }

function catalogOf(board: GroupAxis, counted: ReadonlyMap<string, unknown> = new Map()): CatalogEntry[] {
  const none = { option: null, statusGroup: null, fillOptionId: null }
  // 날짜(B-1) — 그룹은 옵션이 아니라 데이터에서 나온다: 필터 · 검색 · 권한을 지난 행이 든 버킷들(날짜 오름차순) · 값 없음이 맨 앞
  // 숫자(B-2)도 그렇다 — 구간들은 **숫자 오름차순**(글자 순이면 -10 · 100 · 20)
  // 글(B-2b)도 그렇다 — 글 그대로는 한국어 순서 · 첫 글자는 ㄱ ~ ㅎ · A ~ Z · #
  if (board.dateUnit !== null || board.numberSize !== null || board.textMode !== null) {
    const keys = [...counted.keys()].filter((k) => k !== NO_VALUE_KEY)
    const { textMode } = board
    const relativeOrder: readonly string[] = RELATIVE_KEYS
    const buckets =
      board.numberSize !== null
        ? keys.sort((a, b) => Number(a) - Number(b))
        : textMode !== null
          ? keys.sort((a, b) => compareTextKeys(a, b, textMode))
          : board.dateUnit === 'relative'
            ? keys.sort((a, b) => relativeOrder.indexOf(a) - relativeOrder.indexOf(b))
            : keys.sort()
    // 내림(S-1)이면 뒤집는다 — 값 없음은 그래도 맨 앞
    if (board.sort === 'descending') buckets.reverse()
    return [{ key: NO_VALUE_KEY, ...none }, ...buckets.map((key) => ({ key, ...none }))]
  }
  if (board.propertyType === 'checkbox') {
    return [
      { key: 'false', ...none },
      { key: 'true', ...none },
    ]
  }
  // 범주 단위(10n-27) — 열은 그룹 순서 · 옵션이 없는 범주도 열이다
  if (board.statusByGroup) {
    return [
      { key: NO_VALUE_KEY, ...none },
      ...STATUS_GROUP_KINDS.map((kind) => ({ key: kind, option: null, statusGroup: kind, fillOptionId: fillOptionOf(board, kind) })),
    ]
  }
  return [{ key: NO_VALUE_KEY, ...none }, ...board.options.map((o) => ({ key: o.id, option: o, statusGroup: null, fillOptionId: o.id }))]
}

/**
 * 이 보드의 그룹 키인가 — 놓을 열 · 읽을 열을 받을 때. 날짜(B-1)는 데이터에 없어도 그 단위의 버킷 키면 된다(빈 달에도 놓을 수 있다).
 */
function isGroupKeyOf(board: GroupAxis, key: string): boolean {
  if (board.dateUnit !== null) return key === NO_VALUE_KEY || isBucketKey(key, board.dateUnit, board.weekStart)
  if (board.numberSize !== null) return key === NO_VALUE_KEY || isNumberBucketKey(key, board.numberSize)
  // 글 그대로(B-2b)는 아무 글이나 키다(놓으면 그 글이 된다) · 첫 글자는 그 머리들만
  if (board.textMode !== null) return board.textMode === 'exact' || key === NO_VALUE_KEY || isInitialKey(key)
  return catalogOf(board).some((g) => g.key === key)
}

/** 범주 열에 들어오는 카드가 받는 옵션 — 기본 옵션이 그 범주면 그것, 아니면 그 범주의 첫 옵션(옵션 순서). 없으면 null(10n-27). */
function fillOptionOf(board: GroupAxis, kind: StatusGroupKind): string | null {
  const inGroup = board.options.filter((o) => o.group === kind)
  return inGroup.find((o) => o.id === board.defaultOptionId)?.id ?? inGroup[0]?.id ?? null
}

// ── SQL 조각 ──────────────────────────────────────────────────────────

/**
 * 행의 그룹 키를 계산하는 식. `gv` 는 그룹 프로퍼티의 셀(LEFT JOIN — 없으면 NULL).
 *
 * select: 살아 있는 옵션 id 면 그것, 아니면(빈 셀 · 지워진 옵션) `''`.
 * checkbox: NULL(셀 없음)은 false 다 — `checkbox` 의 빈 값이 false 이기 때문(`emptyValue`).
 */
function keyExprOf(board: GroupAxis, params: ParamBag, alias = 'gv'): string {
  // 날짜(B-1) — 값에 적힌 달력 날짜(`start` 의 앞 열 자)가 든 버킷의 첫 날 · 값 없음은 ''(시간대로 옮기지 않는다 — `date-group.ts`)
  // 상대 날짜(B-3) — 적힌 날짜가 오늘에서 며칠 떨어졌나(`date - date` 는 날수) · 이름은 `date-group.ts` 의 `relativeOf` 와 같은 경계
  if (board.dateUnit === 'relative') {
    const today = params.bind(board.today)
    return `(SELECT CASE WHEN r.n IS NULL THEN ''
                     WHEN r.n = 0 THEN 'today' WHEN r.n = 1 THEN 'tomorrow' WHEN r.n = -1 THEN 'yesterday'
                     WHEN r.n BETWEEN 2 AND 7 THEN 'next_7' WHEN r.n BETWEEN -7 AND -2 THEN 'last_7'
                     WHEN r.n BETWEEN 8 AND 30 THEN 'next_30' WHEN r.n BETWEEN -30 AND -8 THEN 'last_30'
                     WHEN r.n > 30 THEN 'later' ELSE 'earlier' END
               FROM (SELECT (left(${alias}.value -> 'date' ->> 'start', 10))::date - ${today}::date AS n) r)`
  }
  if (board.dateUnit !== null) {
    const date = `(left(${alias}.value -> 'date' ->> 'start', 10))::date`
    // 일요일 시작의 주(B-3b) — 그 주의 일요일(`dow` 는 일요일 = 0). 월요일 시작은 date_trunc('week')(ISO)
    const bucket =
      board.dateUnit === 'day'
        ? date
        : board.dateUnit === 'week' && board.weekStart === 'sunday'
          ? `(${date} - extract(dow from ${date})::int)`
          : `date_trunc('${board.dateUnit}', ${date})`
    return `coalesce(to_char(${bucket}, 'YYYY-MM-DD'), '')`
  }
  // 숫자(B-2) — 구간의 아래 끝을 numeric 으로 정확히 · 글자는 trim_scale 의 것(`number-group.ts`) · 값 없음은 ''
  // 글(B-2b) — 글 그대로는 사이드카 그대로 · 첫 글자는 첫 비공백 글자의 머리(한글은 초성 — 표는 `text-group.ts` 의 것 · 음절은 코드
  // 포인트로 가른다 — ko 콜레이션의 BETWEEN 은 자음 낱자를 음절 사이에 넣는다)
  if (board.textMode === 'exact') return `coalesce(${alias}.text_value, '')`
  if (board.textMode === 'first') {
    const table = params.bind(FOLDED_CHOSEONG)
    const other = params.bind(OTHER_INITIAL)
    return `(SELECT CASE WHEN f.c IS NULL THEN ''
                     WHEN ascii(f.c) BETWEEN 44032 AND 55203 THEN substr(${table}::text, (ascii(f.c) - 44032) / 588 + 1, 1)
                     WHEN f.c ~ '^[A-Za-z]$' THEN upper(f.c)
                     ELSE ${other}::text END
               FROM (SELECT substring(${alias}.text_value from '\\S') AS c) f)`
  }
  if (board.numberSize !== null) {
    const size = params.bind(String(board.numberSize))
    return `coalesce(trim_scale(floor(${alias}.num_value / ${size}::numeric) * ${size}::numeric)::text, '')`
  }
  if (board.propertyType === 'checkbox') {
    return `(CASE WHEN ${alias}.bool_value THEN 'true' ELSE 'false' END)`
  }
  const ids = params.bind(board.options.map((o) => o.id))
  // 범주 단위(10n-27) — 셀의 옵션을 그 옵션의 그룹으로. 옵션 id ↔ kind 표를 묶는다(옵션은 이미 읽었다 · 지워진 옵션 · 빈 셀은 '')
  if (board.statusByGroup) {
    const kinds = params.bind(board.options.map((o) => o.group ?? ''))
    return `coalesce((SELECT m.k FROM unnest(${ids}::text[], ${kinds}::text[]) AS m(id, k) WHERE m.id = ${alias}.text_value), '')`
  }
  return `(CASE WHEN ${alias}.text_value = ANY(${ids}::text[]) THEN ${alias}.text_value ELSE '' END)`
}

/** 수동 순서. `rp` 는 이 (뷰, 그룹)의 자리(LEFT JOIN — 없으면 NULL → 맨 뒤). */
const MANUAL_ORDER: CompiledSort = {
  orderBy: 'rp.order_idx COLLATE "C" ASC NULLS LAST, b.order_key COLLATE "C" ASC',
  keys: [{ expr: 'rp.order_idx COLLATE "C"', direction: 'asc', cast: '::text' }],
}

/** 칸 키의 구분 글자(B-4a) — 열 키 + 이것 + 가로줄 키. 제어 문자라 어떤 그룹 키(옵션 id · 날짜 · 숫자 · 글)에도 들지 않는다. SQL 은 `chr(31)`. */
const CELL_SEPARATOR = '\u001f'

/** 그 칸의 키 — 하위 그룹이 없으면 열 키 그대로. */
function cellKeyOf(board: Board, groupKey: string, subKey: string | null): string {
  return board.sub === null ? groupKey : `${groupKey}${CELL_SEPARATOR}${subKey ?? NO_VALUE_KEY}`
}

/** 칸 키를 열 키 · 가로줄 키로 — 하위 그룹이 없으면 가로줄은 null. */
function splitCell(board: Board, cell: string): readonly [string, string | null] {
  if (board.sub === null) return [cell, null]
  const at = cell.indexOf(CELL_SEPARATOR)
  return at < 0 ? [cell, NO_VALUE_KEY] : [cell.slice(0, at), cell.slice(at + 1)]
}

/**
 * 열 · 가로줄의 셀을 잇는 JOIN 과 키 식(B-4a) — 열은 `gv` · 가로줄은 `sv`. 칸 키 식(`cellExpr`)이 자리(`row_position.group_key`) · 칸 소속에
 * 쓰인다 — 하위 그룹이 없으면 열 키 식 그대로.
 */
function cellSql(board: Board, params: ParamBag): { joins: string; keyExpr: string; subKeyExpr: string | null; cellExpr: string } {
  const gp = params.bind(board.groupBy.property_id)
  const keyExpr = keyExprOf(board, params)
  const gvJoin = `LEFT JOIN page_property_value gv ON gv.page_id = p.id AND gv.property_id = ${gp}`
  if (board.sub === null) return { joins: gvJoin, keyExpr, subKeyExpr: null, cellExpr: keyExpr }
  const sp = params.bind(board.sub.groupBy.property_id)
  const subKeyExpr = keyExprOf(board.sub, params, 'sv')
  return {
    joins: `${gvJoin}\n       LEFT JOIN page_property_value sv ON sv.page_id = p.id AND sv.property_id = ${sp}`,
    keyExpr,
    subKeyExpr,
    cellExpr: `(${keyExpr} || chr(31) || ${subKeyExpr})`,
  }
}

type Compiled = {
  readonly keyExpr: string
  /** 가로줄 키 식(B-4a) — 하위 그룹이 없으면 null. */
  readonly subKeyExpr: string | null
  readonly from: string
  readonly where: string
  readonly order: CompiledSort
  readonly manual: boolean
  readonly sortColumns: string
}

/** 살아 있는 정렬 키가 있는가. 없으면(전부 지워진 프로퍼티) 수동 순서다 — 사용자에게는 정렬이 없는 것과 같다. */
function hasLiveSort(board: Board): boolean {
  return board.sorts.some((s) => filterTypeOf(board.types.get(s.property_id)) !== null)
}

/**
 * 질의의 공통 부분. `$1` 은 dataSourceId, 나머지는 `params` 가 발급한다.
 *
 * `withOrder: false` 면 정렬 파라미터를 **바인딩하지 않는다** — 카운트 질의는 ORDER BY 가 없고, 쓰지 않는 파라미터를
 * 바인딩하면 pg 가 "bind message supplies N parameters" 로 거부한다(테스트가 잡았다).
 */
function compileBoard(board: Board, params: ParamBag, withOrder = true): Compiled {
  const cell = cellSql(board, params)
  const keyExpr = cell.keyExpr
  const viewParam = params.bind(board.viewId)
  const manual = !hasLiveSort(board)
  const order = manual ? MANUAL_ORDER : withOrder ? compileSorts(board.sorts, board.types, params) : MANUAL_ORDER
  // 권한이 필터보다 먼저다(F-03-17) — "만들기만" 이면 자기가 열 수 있는 행만(6f-2b-1). 카드 · 개수 · 머리 값이 이 WHERE 하나를 쓴다.
  const accessSql = restrictedRowsSql(board.access, params)
  const filterSql = compileFilter(board.filter, board.types, params, board.context)
  const treeSql = board.subItemsParent === null ? null : compileTree({ parentPropertyId: board.subItemsParent, under: null }, params)
  const searchSql = board.search === null ? null : compileSearch(board.search, board.types, params, board.searchScopes)
  return {
    keyExpr,
    subKeyExpr: cell.subKeyExpr,
    from: `FROM page p
       JOIN block b ON b.id = p.id
       ${cell.joins}
       LEFT JOIN row_position rp ON rp.view_id = ${viewParam} AND rp.row_id = p.id AND rp.group_key = ${cell.cellExpr}`,
    where: ['p.data_source_id = $1', 'p.is_template = false', "b.lifecycle = 'live'", accessSql, filterSql, searchSql, treeSql]
      .filter((s): s is string => s !== null)
      .join(' AND '),
    order,
    manual,
    sortColumns: order.keys.map((k, i) => `, ${k.expr} AS sort_${i}`).join(''),
  }
}

// 행 페이지의 아이콘(8c-3a)도 — `toQueriedRow` 가 읽는다. 표(`query.ts`)와 같은 열이어야 한 화면의 두 뷰가 같은 행을 그린다.
const ROW_COLUMNS =
  "b.id, b.order_key, p.properties_cache, b.properties, b.format -> 'page_icon' AS page_icon, p.unique_seq, b.created_at, b.last_edited_at, b.version"

function nextCursorOf(order: CompiledSort, last: RowRow | undefined, hasMore: boolean): string | null {
  if (!hasMore || last === undefined) return null
  return encodeCursorValues([...order.keys.map((_, i) => last[`sort_${i}`]), last.order_key])
}

// ── 읽기 ──────────────────────────────────────────────────────────────

/**
 * 보드의 그룹 전부와, 보이는 그룹의 첫 페이지 행.
 */
export async function queryGroups(ctx: SessionContext, viewId: string, input: BoardReadInput = {}): Promise<GroupResult<GroupsPage>> {
  // 뷰를 읽기 트랜잭션 안에서 연다 — 수식으로 거르거나 정렬하면 그 캐시를 먼저 채운다(2j-2 · 이 사람의 실제 필터로)
  await refreshDerivedForView(ctx, viewId)
  return withReadTransaction(async (tx) => {
    const board = await openBoard(tx, ctx, viewId, 'view', input.search ?? null, input.today ?? null)
    if (isFailure(board)) return board

    // ── ① 카운트 (+ 그룹 머리의 계산) ──
    const counted = await readGroupCounts(tx, board)
    const countOf = new Map([...counted].map(([key, r]) => [key, r.n]))

    const hidden = new Set(board.groupBy.hidden ?? [])
    const catalog = catalogOf(board, counted)
      .map((g) => ({ ...g, count: countOf.get(g.key) ?? 0, hidden: hidden.has(g.key) }))
      // 빈 그룹 숨김은 옵션 단위의 개념이다 — `''` 그룹도 행이 0개면 빠진다.
      .filter((g) => !(board.groupBy.hide_empty && g.count === 0))

    // ── ①' 하위 그룹(B-4a) — 칸마다 카운트 · 가로줄 목록(열과 같은 규칙 — 숨김 · 빈 줄 숨기기) ──
    const sub = board.sub
    const cellCounts = sub === null ? [] : await readCellCounts(tx, board)
    const cellCount = new Map(cellCounts.map((c) => [cellKeyOf(board, c.key, c.sub), c.n]))
    const laneTotals = new Map<string, number>()
    for (const c of cellCounts) laneTotals.set(c.sub, (laneTotals.get(c.sub) ?? 0) + c.n)
    const laneHidden = new Set(sub?.groupBy.hidden ?? [])
    const lanes =
      sub === null
        ? []
        : catalogOf(sub, laneTotals)
            .map((l) => ({ ...l, count: laneTotals.get(l.key) ?? 0, hidden: laneHidden.has(l.key) }))
            .filter((l) => !(sub.groupBy.hide_empty && l.count === 0))

    // ── ② 보이는 그룹(칸)의 상위 N행 — 그룹(칸)마다 load_limit + 1 ──
    const visibleKeys = catalog.filter((g) => !g.hidden && g.count > 0).map((g) => g.key)
    const visibleLanes = lanes.filter((l) => !l.hidden && l.count > 0).map((l) => l.key)
    const rowsByKey = new Map<string, RowRow[]>()
    const params = new ParamBag(2)
    const q = compileBoard(board, params)
    if (visibleKeys.length > 0 && (sub === null || visibleLanes.length > 0)) {
      const keysParam = params.bind(visibleKeys)
      const lanesParam = q.subKeyExpr === null ? null : params.bind(visibleLanes)
      const limitParam = params.bind(board.loadLimit + 1)
      // 하위 그룹이면 칸(열 · 가로줄)마다 — 칸 키로 모은다
      const partition = q.subKeyExpr === null ? q.keyExpr : `${q.keyExpr}, ${q.subKeyExpr}`
      const rows = await tx.query<RowRow & { group_key: string; sub_key: string | null; rn: string }>(
        `SELECT t.* FROM (
           SELECT ${ROW_COLUMNS}, ${q.keyExpr} AS group_key, ${q.subKeyExpr ?? 'NULL::text'} AS sub_key${q.sortColumns},
                  row_number() OVER (PARTITION BY ${partition} ORDER BY ${q.order.orderBy}) AS rn
             ${q.from}
            WHERE ${q.where} AND ${q.keyExpr} = ANY(${keysParam}::text[])${
              lanesParam === null ? '' : ` AND ${q.subKeyExpr} = ANY(${lanesParam}::text[])`
            }
         ) t
         WHERE t.rn <= ${limitParam}
         ORDER BY t.group_key, t.sub_key, t.rn`,
        [board.dataSourceId, ...params.values],
      )
      for (const row of rows) {
        const key = cellKeyOf(board, row.group_key, row.sub_key)
        const list = rowsByKey.get(key) ?? []
        list.push(row)
        rowsByKey.set(key, list)
      }
    }
    /** 그 칸(하위 그룹이 없으면 열)의 첫 페이지. */
    const pageOf = (cell: string) => {
      const fetched = rowsByKey.get(cell) ?? []
      const hasMore = fetched.length > board.loadLimit
      const page = fetched.slice(0, board.loadLimit)
      return { rows: page.map(toQueriedRow), hasMore, nextCursor: nextCursorOf(q.order, page[page.length - 1], hasMore) }
    }

    const groups: BoardGroup[] = catalog.map((g) => ({
      key: g.key,
      option: g.option,
      statusGroup: g.statusGroup,
      fillOptionId: g.fillOptionId,
      count: g.count,
      hidden: g.hidden,
      calculation: groupCalculationOf(board, counted.get(g.key)),
      // 하위 그룹이면 열의 행은 비어 있다 — 칸이 싣는다
      ...(sub === null ? pageOf(g.key) : { rows: [], hasMore: false, nextCursor: null }),
    }))

    const subPage: SubGroupsPage | null =
      sub === null
        ? null
        : {
            propertyId: sub.groupBy.property_id,
            propertyType: sub.propertyType,
            statusBy: sub.statusByGroup ? 'group' : 'option',
            dateUnit: sub.dateUnit,
            numberSize: sub.numberSize,
            textMode: sub.textMode,
            today: sub.dateUnit === 'relative' ? sub.today : null,
            groups: lanes.map((l) => ({
              key: l.key,
              option: l.option,
              statusGroup: l.statusGroup,
              fillOptionId: l.fillOptionId,
              count: l.count,
              hidden: l.hidden,
              cells: Object.fromEntries(
                catalog.map((g) => {
                  const cell = cellKeyOf(board, g.key, l.key)
                  return [g.key, { count: cellCount.get(cell) ?? 0, ...pageOf(cell) }]
                }),
              ),
            })),
          }

    return {
      ok: true,
      value: {
        propertyId: board.groupBy.property_id,
        propertyType: board.propertyType,
        manualOrder: q.manual,
        calculation: board.calculation,
        statusBy: board.statusByGroup ? 'group' : 'option',
        dateUnit: board.dateUnit,
        numberSize: board.numberSize,
        textMode: board.textMode,
        today: board.dateUnit === 'relative' ? board.today : null,
        groups,
        sub: subPage,
      },
    } as const
  })
}

/**
 * 그룹 머리의 계산만 다시 낸다(2d-3) — 카드를 옮기거나 만든 뒤 화면이 부른다. 카운트와 같은 질의 하나(`readGroupCounts`)라
 * 머리의 값과 카드 수가 같은 행들을 본다. 그룹 목록(옵션)에 있는 키만 낸다 — 행이 없는 그룹도(빈 통계).
 */
export async function queryGroupCalculations(
  ctx: SessionContext,
  viewId: string,
  input: BoardReadInput = {},
): Promise<GroupResult<GroupCalculationsPage>> {
  await refreshDerivedForView(ctx, viewId)
  return withReadTransaction(async (tx) => {
    const board = await openBoard(tx, ctx, viewId, 'view', input.search ?? null, input.today ?? null)
    if (isFailure(board)) return board
    if (board.calculation === null) return { ok: true, value: { calculation: null, values: {} } } as const
    const counted = await readGroupCounts(tx, board)
    const values: Record<string, CalculationResult> = {}
    for (const g of catalogOf(board, counted)) {
      const result = groupCalculationOf(board, counted.get(g.key))
      if (result !== null) values[g.key] = result
    }
    return { ok: true, value: { calculation: board.calculation, values } } as const
  })
}

/**
 * 그룹마다 열 집계(표 · 목록의 그룹 G-2d · 정본 §3.6 [보강 G-1] ⑨) — 덩이 아래의 집계 줄. 그 그룹의 행 전부(머리의 개수와 같은 행 —
 * 권한 · 필터 · 검색어 · 하위 항목의 부모만)로 계산한다. 질의는 열 · 그룹 수와 무관하게 하나 — 행과 그룹 키를 CTE 로 한 번 고르고 그룹마다 ·
 * 열마다 그 행들의 칸을 모은다(평평한 표의 `computeCalculations` 와 같은 통계 식). `groupKey` 를 주면 그 그룹만(덩이의 다시 읽기).
 * 행이 없는 그룹은 빈 통계다. 계산이 없거나 타입에 맞지 않는 열은 빠진다.
 */
export async function queryGroupColumnCalculations(
  ctx: SessionContext,
  viewId: string,
  columns: readonly CalculatedColumn[],
  input: BoardReadInput & { readonly groupKey?: string } = {},
): Promise<GroupResult<Readonly<Record<string, Calculations>>>> {
  const wanted = columns.filter(
    (c): c is CalculatedColumn & { calculation: Calculation } =>
      c.calculation !== null && c.calculation !== undefined && canCalculate(c.type, c.calculation),
  )
  await refreshDerivedForView(ctx, viewId)
  return withReadTransaction(async (tx) => {
    const board = await openBoard(tx, ctx, viewId, 'view', input.search ?? null, input.today ?? null)
    if (isFailure(board)) return board
    if (input.groupKey !== undefined && !isGroupKeyOf(board, input.groupKey)) return fail('invalid_value')
    // 날짜(B-1)의 그룹은 데이터에서 나온다 — 아래 질의가 낸 키를 더한다
    const keys = catalogOf(board)
      .map((g) => g.key)
      .filter((k) => input.groupKey === undefined || k === input.groupKey)
    if (input.groupKey !== undefined && keys.length === 0) keys.push(input.groupKey)
    const out: Record<string, Calculations> = Object.fromEntries(keys.map((k) => [k, {}]))
    if (wanted.length === 0) return { ok: true, value: out } as const

    const params = new ParamBag(2)
    const c = compileBoard(board, params, false)
    const only = input.groupKey === undefined ? null : params.bind(input.groupKey)
    // 상태 열의 완료 그룹(10n-30) — 그 열에만 완료 개수를 센다
    const completeOf = await completeIdsOf(tx, wanted.filter((w) => w.type === 'status').map((w) => w.propertyId))
    const select = wanted.map((w, i) => {
      const p = params.bind(w.propertyId)
      const complete = completeOf.get(w.propertyId)
      const completeParam = complete === undefined ? null : params.bind(complete)
      return `(SELECT ${statsJsonSql('v', completeParam)}
                 FROM r JOIN page_property_value v ON v.page_id = r.id AND v.property_id = ${p} WHERE r.key = k.key) AS c${i}`
    })
    const rows = await tx.query<Record<string, unknown> & { key: string; n: number }>(
      `WITH r AS (SELECT p.id, ${c.keyExpr} AS key ${c.from} WHERE ${c.where}${only === null ? '' : ` AND ${c.keyExpr} = ${only}`})
       SELECT k.key, k.n, ${select.join(', ')} FROM (SELECT key, count(*)::int AS n FROM r GROUP BY key) k`,
      [board.dataSourceId, ...params.values],
    )
    const byKey = new Map(rows.map((r) => [r.key, r]))
    if ((board.dateUnit !== null || board.numberSize !== null || board.textMode !== null) && input.groupKey === undefined) {
      for (const r of rows) if (!keys.includes(r.key)) keys.push(r.key)
    }
    for (const key of keys) {
      const row = byKey.get(key)
      const values: Record<string, CalculationResult> = {}
      for (const [i, w] of wanted.entries()) {
        const stats = (row?.[`c${i}`] as StatsRow | null | undefined) ?? EMPTY_STATS_ROW
        values[w.propertyId] = calculationResult(w.calculation, columnStatsOf(row?.n ?? 0, stats))
      }
      out[key] = values
    }
    return { ok: true, value: out } as const
  })
}

type GroupCount = { readonly n: number; readonly stats: StatsRow | null }

/**
 * 그룹마다 행 수 — 그룹 머리의 계산이 살아 있으면 같은 `GROUP BY` 에 그 속성의 칸 통계(`statsJsonSql`)를 얹는다. 행을 고르는 조건
 * (필터 · 휴지통 · 템플릿 · 부모만)이 카운트와 **같은 한 질의**다 — 머리의 값과 카드 수가 다른 행들을 볼 길이 없다. 숨긴 그룹도
 * 계산한다(04 F-04-16 *"필터는 반영, 그룹 숨김은 미반영"*).
 */
async function readGroupCounts(tx: Tx, board: Board): Promise<Map<string, GroupCount>> {
  const params = new ParamBag(2)
  const c = compileBoard(board, params, false)
  const calc = board.calculation === null ? null : params.bind(board.calculation.property_id)
  // 상태 속성의 머리 계산이면 완료 그룹(10n-30 — 완료 비율)
  const statusCalc = board.calculation !== null && board.types.get(board.calculation.property_id) === 'status' ? board.calculation.property_id : null
  const completeParam = statusCalc === null ? null : params.bind((await completeIdsOf(tx, [statusCalc])).get(statusCalc) ?? [])
  const counted = await tx.query<{ key: string; n: number; s: StatsRow | null }>(
    `SELECT ${c.keyExpr} AS key, count(*)::int AS n${calc === null ? '' : `, ${statsJsonSql('cv', completeParam)} AS s`}
       ${c.from}${calc === null ? '' : `
       LEFT JOIN page_property_value cv ON cv.page_id = p.id AND cv.property_id = ${calc}`}
      WHERE ${c.where} GROUP BY 1`,
    [board.dataSourceId, ...params.values],
  )
  return new Map(counted.map((r) => [r.key, { n: r.n, stats: r.s ?? null }]))
}

/** 칸(열 · 가로줄)마다 행 수(B-4a) — 카드를 고르는 조건이 카운트와 같은 한 WHERE(`compileBoard`)다. 하위 그룹이 있을 때만 부른다. */
async function readCellCounts(tx: Tx, board: Board): Promise<{ key: string; sub: string; n: number }[]> {
  const params = new ParamBag(2)
  const c = compileBoard(board, params, false)
  if (c.subKeyExpr === null) return []
  return tx.query<{ key: string; sub: string; n: number }>(
    `SELECT ${c.keyExpr} AS key, ${c.subKeyExpr} AS sub, count(*)::int AS n ${c.from} WHERE ${c.where} GROUP BY 1, 2`,
    [board.dataSourceId, ...params.values],
  )
}

/** 그룹 하나의 머리 값. 행이 없는 그룹(`GROUP BY` 가 줄을 내지 않는다)은 빈 통계로 — 세기 · 합은 0, 평균은 빈 값. */
function groupCalculationOf(board: Board, counted: GroupCount | undefined): CalculationResult | null {
  if (board.calculation === null) return null
  return calculationResult(board.calculation.function, columnStatsOf(counted?.n ?? 0, counted?.stats ?? EMPTY_STATS_ROW))
}

/**
 * 한 그룹의 다음 페이지 — 그룹별 독립 커서(F-04-15).
 *
 * 숨긴 그룹도 읽을 수 있다(숨김은 화면의 일이고 권한이 아니다). 정렬 구성이 바뀌어 커서 길이가 맞지 않으면
 * 처음부터 읽는다(`queryRows` 와 같은 태도).
 */
export async function queryGroupRows(
  ctx: SessionContext,
  viewId: string,
  groupKey: string,
  input: { readonly cursor?: string | null; readonly limit?: number; readonly subKey?: string } & BoardReadInput = {},
): Promise<GroupResult<GroupRowsPage>> {
  await refreshDerivedForView(ctx, viewId)
  return withReadTransaction(async (tx) => {
    const board = await openBoard(tx, ctx, viewId, 'view', input.search ?? null, input.today ?? null)
    if (isFailure(board)) return board
    if (!isGroupKeyOf(board, groupKey)) return fail('invalid_value')
    // 하위 그룹(B-4a)이면 칸 — 가로줄 키를 주면 그 칸만(칸마다 커서)
    if (input.subKey !== undefined && (board.sub === null || !isGroupKeyOf(board.sub, input.subKey))) return fail('invalid_value')

    const limit = Math.min(Math.max(1, Math.floor(input.limit ?? board.loadLimit)), MAX_QUERY_LIMIT)
    const params = new ParamBag(2)
    const q = compileBoard(board, params)
    const keyParam = params.bind(groupKey)
    const subParam = input.subKey === undefined || q.subKeyExpr === null ? null : params.bind(input.subKey)
    const cursorValues = decodeCursorValues(input.cursor)
    const cursorSql = cursorValues === null ? null : compileCursor(q.order, cursorValues, params)
    const limitParam = params.bind(limit + 1)

    const rows = await tx.query<RowRow>(
      `SELECT ${ROW_COLUMNS}${q.sortColumns}
         ${q.from}
        WHERE ${q.where} AND ${q.keyExpr} = ${keyParam}${subParam === null ? '' : ` AND ${q.subKeyExpr} = ${subParam}`}${
          cursorSql === null ? '' : ` AND ${cursorSql}`
        }
        ORDER BY ${q.order.orderBy}
        LIMIT ${limitParam}`,
      [board.dataSourceId, ...params.values],
    )
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    return {
      ok: true,
      value: { rows: page.map(toQueriedRow), hasMore, nextCursor: nextCursorOf(q.order, page[page.length - 1], hasMore) },
    } as const
  })
}

// ── 이동 ──────────────────────────────────────────────────────────────

/**
 * 날짜 버킷 사이로 옮긴 행의 새 값(B-1) — 지금 값을 버킷 차이만큼 민다(시각 · 끝 날짜 · 시간대를 지킨다 · `shiftDateValue`).
 * 칸을 그사이 읽을 수 없으면(지금 키가 있는데 값이 없다 — 일어나지 않아야 한다) 그 버킷의 첫 날로.
 */
async function shiftedDateOf(tx: Tx, board: GroupAxis, rowId: string, from: string, to: string): Promise<CellValue | null> {
  const cell = await tx.queryMaybe<{ value: { date?: DateValue | null } }>(
    `SELECT value FROM page_property_value WHERE page_id = $1 AND property_id = $2`,
    [rowId, board.groupBy.property_id],
  )
  const date = cell?.value.date ?? null
  // 상대 날짜(B-3) — 어제 · 오늘 · 내일이면 그 날로(적힌 날에서 그 날까지의 날수만큼 민다) · 범위 덩이는 받을 날이 없다
  if (board.dateUnit === 'relative') {
    const day = relativeDayOf(to, board.today)
    if (day === null) return null
    return { type: 'date', date: date === null ? { start: day } : shiftDateValue(date, date.start.slice(0, 10), day, 'day') }
  }
  if (date === null || board.dateUnit === null) return { type: 'date', date: { start: to } }
  return { type: 'date', date: shiftDateValue(date, from, to, board.dateUnit) }
}

/** 숫자 구간 사이로 옮긴 행의 새 값(B-2) — 지금 값에 구간 차이만큼 더한다(`shiftNumber` · 소수 오차 없이). 값을 못 읽으면 아래 끝. */
async function shiftedNumberOf(tx: Tx, board: GroupAxis, rowId: string, from: string, to: string): Promise<CellValue> {
  const cell = await tx.queryMaybe<{ value: { number?: number | null } }>(
    `SELECT value FROM page_property_value WHERE page_id = $1 AND property_id = $2`,
    [rowId, board.groupBy.property_id],
  )
  const value = cell?.value.number ?? null
  return { type: 'number', number: value === null ? Number(to) : shiftNumber(value, from, to) }
}

/** 그 열에 놓은 카드의 셀 값. 범주 열에 옵션이 없으면 null — 놓을 수 없다(10n-27). */
function cellValueFor(board: GroupAxis, groupKey: string): CellValue | null {
  // 날짜(B-1) — 값이 없던 행은 그 버킷의 첫 날(날짜만) · 값 없음 열은 비운다. 값이 있던 행은 `moveRow` 가 단위만큼 민다
  if (board.propertyType === 'date') {
    if (groupKey === NO_VALUE_KEY) return { type: 'date', date: null }
    // 상대 날짜(B-3) — 어제 · 오늘 · 내일만 그 날 · 범위 덩이는 받을 날이 없다
    if (board.dateUnit === 'relative') {
      const day = relativeDayOf(groupKey, board.today)
      return day === null ? null : { type: 'date', date: { start: day } }
    }
    return { type: 'date', date: { start: groupKey } }
  }
  // 숫자(B-2) — 값이 없던 행은 구간의 아래 끝 · 값 없음 열은 비운다. 값이 있던 행은 `moveRow` 가 구간 차이만큼 더한다
  if (board.propertyType === 'number') return { type: 'number', number: groupKey === NO_VALUE_KEY ? null : Number(groupKey) }
  // 글(B-2b) — 글 그대로면 그 글(서식 없이) · 값 없음 열은 비운다. 첫 글자면 받을 값이 없다(첫 글자만 정할 수는 없다 — 범주 열과 같다)
  if (board.propertyType === 'rich_text') {
    if (board.textMode === 'first') return null
    return { type: 'rich_text', rich_text: groupKey === NO_VALUE_KEY ? [] : [textRun(groupKey)] }
  }
  if (board.propertyType === 'checkbox') return { type: 'checkbox', checkbox: groupKey === 'true' }
  if (groupKey === NO_VALUE_KEY) return optionValue(board.propertyType, null)
  if (board.statusByGroup) {
    const fill = fillOptionOf(board, groupKey as StatusGroupKind)
    return fill === null ? null : optionValue('status', fill)
  }
  return optionValue(board.propertyType, groupKey)
}

/**
 * 카드를 옮긴다 — 그룹(= 셀 값)과 열 안 자리를 **한 트랜잭션**으로.
 */
export async function moveRow(
  ctx: SessionContext,
  viewId: string,
  input: MoveRowInput,
): Promise<GroupResult<MoveOutcome>> {
  // 거부를 돌려주면 롤백된다(`withCommandTransaction` 머리말) — 아래의 "쓰기 전에 검사"가 깨져도 반쯤 옮긴 카드는 없다.
  return withCommandTransaction(async (tx) => {
    // 검색어는 끝의 "아직 이 보드에 서는가" 에만 닿는다 — 아래의 자리 계산(`isInGroup` · `placeIn`)은 보드 질의를 쓰지 않는다.
    const board = await openBoard(tx, ctx, viewId, 'edit_content', input.search ?? null, input.today ?? null)
    if (isFailure(board)) return board
    if (!isGroupKeyOf(board, input.groupKey)) return fail('invalid_value')
    // 하위 그룹(B-4a) — 가로줄 키를 주면 그 축의 키여야 한다
    const sub = board.sub
    if (input.subGroupKey !== undefined && (sub === null || !isGroupKeyOf(sub, input.subGroupKey))) return fail('invalid_value')
    if (input.beforeRowId === input.rowId) return fail('invalid_value')

    // 행을 잠근다 — 같은 카드를 두 사람이 끌면 순서가 정해진다(셀은 LWW, 자리는 나중 것).
    const row = await tx.queryMaybe<{ id: string }>(
      `SELECT p.id FROM page p JOIN block b ON b.id = p.id
        WHERE p.id = $1 AND p.data_source_id = $2 AND p.is_template = false AND b.lifecycle = 'live'
        FOR UPDATE OF b`,
      [input.rowId, board.dataSourceId],
    )
    if (row === null) return fail('not_found')

    // 지금 칸 · 놓을 칸(B-4a — 하위 그룹이면 열 + 가로줄 · 가로줄 키를 주지 않으면 지금 가로줄에 남는다)
    const currentCell = await currentCellOf(tx, board, input.rowId)
    const [current, currentSub] = splitCell(board, currentCell)
    const subTarget = sub === null ? null : (input.subGroupKey ?? currentSub ?? NO_VALUE_KEY)
    const targetCell = cellKeyOf(board, input.groupKey, subTarget)

    // ★ **쓰기 전에** 놓을 자리를 검사한다. 화면이 낡아 `beforeRowId` 의 카드가 그사이 다른 열(칸)로 갔을 수 있다 — 셀을 쓴
    //   뒤에 알면 "값은 바뀌었는데 거부된" 이동이 된다(#103).
    const manual = !hasLiveSort(board)
    if (manual && !(await isInCell(tx, board, input.beforeRowId ?? null, targetCell))) return fail('not_found')

    // ── ① 셀 값. 이미 그 그룹(가로줄)이면 건드리지 않는다 · 두 축을 한 번에 쓴다(B-4a) ──
    if (input.within === true && currentCell !== targetCell) return fail('not_found')
    const cells: { propertyId: string; value: CellValue }[] = []
    if (current !== input.groupKey) {
      const value = await movedValueOf(tx, board, input.rowId, current, input.groupKey)
      // 옵션이 없는 범주 열 · 첫 글자 열(B-2b) · 상대 날짜의 범위(B-3)에는 놓을 수 없다(10n-27) — 받을 값이 없다
      if (value === null) return fail('invalid_value')
      cells.push({ propertyId: board.groupBy.property_id, value })
    }
    if (sub !== null && subTarget !== null && currentSub !== subTarget) {
      const value = await movedValueOf(tx, sub, input.rowId, currentSub ?? NO_VALUE_KEY, subTarget)
      if (value === null) return fail('invalid_value')
      cells.push({ propertyId: sub.groupBy.property_id, value })
    }
    if (cells.length > 0) {
      const written = await updateCellsIn(tx, ctx, input.rowId, { cells })
      if (!written.ok) return written
    }

    // ── ② 자리. 옛 그룹의 자리는 지운다 — PK 가 (뷰, 그룹, 행)이라 두 열에 남을 수 있다. 평평한 표의 자리(`'*'` · 10n-59)는 남긴다 —
    //    그룹을 풀면 그 차례가 돌아와야 한다(정본 [보강 G-1] ⑦) ──
    await tx.query(`DELETE FROM row_position WHERE view_id = $1 AND row_id = $2 AND group_key <> $3`, [viewId, input.rowId, UNGROUPED_ORDER_KEY])

    if (manual) {
      const orderIdx = await placeIn(tx, board, targetCell, input.rowId, input.beforeRowId ?? null)
      await tx.query(
        `INSERT INTO row_position (view_id, group_key, row_id, order_idx) VALUES ($1, $2, $3, $4)`,
        [viewId, targetCell, input.rowId, orderIdx],
      )
    }

    const summary = await readRow(tx, input.rowId)
    if (summary === null) return fail('not_found')
    // ── ③ 아직 이 보드에 서는가(10n-15) — 판정은 서버의 컴파일러 하나에 있다(화면이 필터를 다시 풀지 않는다) ──
    const inView = await standsInBoard(tx, board, input.rowId)
    return { ok: true, value: { row: summary, groupKey: input.groupKey, subGroupKey: subTarget, positioned: manual, inView } } as const
  })
}

/**
 * 그 행이 이 보드에 서는가 — 보드가 카드를 고르는 WHERE 그대로(`compileBoard` — 권한 · 실제로 보는 필터 · 하위 항목 · 검색어). 수식 ·
 * rollup 의 필터는 지금 저장된 파생 값으로 판정한다(읽기가 새로 계산하므로 틀릴 수 있다 — 다음 읽기가 정한다 · 정본 ③).
 */
async function standsInBoard(tx: Tx, board: Board, rowId: string): Promise<boolean> {
  const params = new ParamBag(2)
  const q = compileBoard(board, params, false)
  const rowParam = params.bind(rowId)
  const hit = await tx.queryMaybe<{ one: number }>(
    `SELECT 1 AS one ${q.from} WHERE ${q.where} AND p.id = ${rowParam}`,
    [board.dataSourceId, ...params.values],
  )
  return hit !== null
}

/** 옮긴 행이 받을 한 축의 값 — 날짜 · 숫자는 민다(B-1 · B-2) · 그 밖은 그 그룹의 값. 받을 값이 없으면 null(범주 · 첫 글자 · 상대 날짜의 범위). */
async function movedValueOf(tx: Tx, axis: GroupAxis, rowId: string, from: string, to: string): Promise<CellValue | null> {
  const shifts = from !== NO_VALUE_KEY && to !== NO_VALUE_KEY
  if (shifts && axis.dateUnit !== null) return shiftedDateOf(tx, axis, rowId, from, to)
  if (shifts && axis.numberSize !== null) return shiftedNumberOf(tx, axis, rowId, from, to)
  return cellValueFor(axis, to)
}

/** 그 행의 지금 칸 키(하위 그룹이 없으면 열 키). */
async function currentCellOf(tx: Tx, board: Board, rowId: string): Promise<string> {
  const params = new ParamBag(3)
  const cell = cellSql(board, params)
  const row = await tx.queryOne<{ key: string }>(
    `SELECT ${cell.cellExpr} AS key
       FROM page p
       ${cell.joins}
      WHERE p.id = $1 AND p.data_source_id = $2`,
    [rowId, board.dataSourceId, ...params.values],
  )
  return row.key
}

/**
 * 새 자리 키를 계산한다. 옮기는 행의 자리는 이미 지워져 있다.
 *
 *   beforeRowId 있음 → 그 행의 자리 앞. 그 행에 자리가 없으면 거기까지 자리를 먼저 준다
 *   null            → 열의 맨 뒤. 자리 없는 행이 있으면 그것들에 먼저 자리를 준다 —
 *                     안 그러면 "맨 뒤"로 놓은 카드가 자리 없는 행들 **앞**에 그려진다
 */
/** `before` 가 그 칸(하위 그룹이 없으면 열)의 살아 있는 카드인가. null(맨 뒤)이면 언제나 참이다. `moveRow` 가 **쓰기 전에** 묻는다. */
async function isInCell(tx: Tx, board: Board, before: string | null, cell: string): Promise<boolean> {
  if (before === null) return true
  const target = await tx.queryMaybe<{ one: number }>(
    `SELECT 1 AS one FROM page p JOIN block b ON b.id = p.id
      WHERE p.id = $1 AND p.data_source_id = $2 AND p.is_template = false AND b.lifecycle = 'live'`,
    [before, board.dataSourceId],
  )
  return target !== null && (await currentCellOf(tx, board, before)) === cell
}

/** 그 칸(하위 그룹이 없으면 열)에서의 새 자리 키. `before` 는 `moveRow` 가 이미 검사했다(`isInCell`). */
async function placeIn(tx: Tx, board: Board, groupKey: string, rowId: string, before: string | null): Promise<string> {

  await materializePositions(tx, board, groupKey, rowId, before)

  if (before === null) {
    const last = await tx.queryOne<{ max: string | null }>(
      `SELECT max(order_idx) AS max FROM row_position WHERE view_id = $1 AND group_key = $2`,
      [board.viewId, groupKey],
    )
    return orderKeyBetween(last.max, null)
  }

  const after = await tx.queryOne<{ order_idx: string }>(
    `SELECT order_idx FROM row_position WHERE view_id = $1 AND group_key = $2 AND row_id = $3`,
    [board.viewId, groupKey, before],
  )
  const prev = await tx.queryOne<{ max: string | null }>(
    `SELECT max(order_idx) AS max FROM row_position
      WHERE view_id = $1 AND group_key = $2 AND order_idx < $3`,
    [board.viewId, groupKey, after.order_idx],
  )
  return orderKeyBetween(prev.max, after.order_idx)
}

/**
 * 그룹의 자리 없는 행들에 트리 순서대로 자리를 준다 — `upTo` 까지(포함), null 이면 전부.
 *
 * 화면 순서를 바꾸지 않는다: 자리 없는 행은 자리 있는 행 **뒤에 트리 순서**로 보였고, 마지막 자리 뒤에 그 순서로
 * 키를 주니 그대로다. 필터는 보지 않는다 — 자리는 (뷰, 그룹)의 것이고 필터에 가린 행도 그 열의 행이다.
 */
async function materializePositions(
  tx: Tx,
  board: Board,
  groupKey: string,
  movingRowId: string,
  upTo: string | null,
): Promise<void> {
  const params = new ParamBag(4)
  // 칸 키(B-4a — 하위 그룹이면 열 + 가로줄)로 묻는다 — `groupKey` 도 칸 키다
  const cell = cellSql(board, params)
  const unpositioned = await tx.query<{ id: string }>(
    `SELECT p.id
       FROM page p
       JOIN block b ON b.id = p.id
       ${cell.joins}
       LEFT JOIN row_position rp ON rp.view_id = $1 AND rp.row_id = p.id AND rp.group_key = $2
      WHERE p.data_source_id = $3 AND p.is_template = false AND b.lifecycle = 'live'
        AND ${cell.cellExpr} = $2 AND rp.row_id IS NULL AND p.id <> ${params.bind(movingRowId)}
      ORDER BY b.order_key COLLATE "C"`,
    [board.viewId, groupKey, board.dataSourceId, ...params.values],
  )
  const stop = upTo === null ? unpositioned.length : unpositioned.findIndex((r) => r.id === upTo) + 1
  const targets = unpositioned.slice(0, Math.max(0, stop))
  if (targets.length === 0) return

  const last = await tx.queryOne<{ max: string | null }>(
    `SELECT max(order_idx) AS max FROM row_position WHERE view_id = $1 AND group_key = $2`,
    [board.viewId, groupKey],
  )
  const keys = orderKeysBetween(last.max, null, targets.length)
  for (const [i, r] of targets.entries()) {
    await tx.query(
      `INSERT INTO row_position (view_id, group_key, row_id, order_idx) VALUES ($1, $2, $3, $4)`,
      [board.viewId, groupKey, r.id, keys[i]],
    )
  }
}
