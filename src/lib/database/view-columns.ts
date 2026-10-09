/**
 * 뷰의 컬럼 — 모양과 술어 (relation 5b-1조각)
 *
 * **DB 를 모르는 모듈이다.** `view.ts` 에서 떼어냈다: 화면(클라이언트 컴포넌트)이 `isCellColumn` 을 값으로 쓰는데
 * `view.ts` 는 `db/tx.ts` → `pg` 를 끌어온다. 클라이언트가 그것을 값으로 import 하면 `next build` 가 브라우저 번들에서
 * `dns` · `fs` 를 못 찾아 죽는다 — **타입체크와 린트는 이것을 못 본다**(`import type` 은 지워지므로 타입만 가져오던 동안은
 * 멀쩡했다). `testing/client-bundle.test.ts` 가 이 경계를 지킨다.
 */

import {
  isMvpPropertyType,
  isOptionType,
  readRelationConfig,
  type MvpPropertyType,
  type RelationLimit,
  type SelectOption,
} from './property-types.ts'
import { readRollupConfig, type RollupFunction } from './rollup-functions.ts'
import type { FormulaType } from '../formula/values.ts'
import type { Calculation } from './calculations.ts'
import { formulaFilterType, isFilterableType } from './filter.ts'

type ColumnBase = {
  readonly propertyId: string
  readonly name: string
  readonly visible: boolean
  readonly orderKey: string
  readonly width: number | null
  readonly wrap: boolean
  /**
   * select 컬럼의 옵션 목록(`order_idx` 순). 다른 타입은 빈 배열이다.
   *
   * 셀은 **옵션 id** 만 들고 있어서(`property-types.ts` 머리말) 이것 없이는 화면이
   * 이름을 그릴 수 없다. 컬럼에 싣는 이유는 `GET /rows` 가 컬럼과 행을 한 왕복에
   * 주는 것과 같다 — 옵션을 따로 읽으면 표를 열 때마다 왕복이 하나 더 는다.
   */
  readonly options: readonly SelectOption[]
  /**
   * 이 뷰에서 이 열의 집계 함수(2d-1 · `view_property.calculation`). 없으면 null. 타입에 맞지 않는 저장값(타입을 바꾼 뒤)도 그대로
   * 싣는다 — 계산하는 쪽(`calculate.ts`)이 맞지 않으면 빼고, 화면은 그 열의 고를 수 있는 목록으로 다시 고르게 한다.
   */
  readonly calculation?: Calculation | null
}

/** 값이 셀(`page_property_value`)에 있는 컬럼 — 필터 · 정렬 · 셀 편집이 이것만 받는다. */
export type CellColumn = ColumnBase & { readonly type: MvpPropertyType }

/**
 * relation 컬럼(relation 5b). **값이 셀이 아니다** — 행의 `properties` 에는 캐시의 `RelationValue`(앞 25개 id + 개수)가 있고,
 * 제목은 따로 받는다(`relation.ts` `loadRelationLabels` — 권한과 휴지통을 거기서 거른다).
 *
 * 한 타입으로 뭉개지 않고 **가른다.** `column.type` 을 셀의 규칙(`readCell` · 필터 축 · 폭)에 그대로 넘기는 코드가 많은데,
 * 그 자리들이 relation 을 받으면 조용히 틀린 값을 만든다 — 갈라 두면 컴파일러가 좁히라고 한다(`isCellColumn`).
 */
export type RelationColumn = ColumnBase & {
  readonly type: 'relation'
  readonly relation: {
    readonly targetDataSourceId: string
    readonly limit: RelationLimit
    /** 짝이 있다(양방향 · 같은 표의 자기 짝 포함). 화면이 "반대쪽에도 보인다"를 말할 때 쓴다. */
    readonly synced: boolean
    /** 하위 항목 짝의 한쪽(2b-1) — 화면이 트리를 그릴 때 쓴다. 일반 relation 은 null. */
    readonly subItems: 'parent' | 'children' | null
    /** 종속 관계 짝의 한쪽(2b-3) — 화면이 켜졌는지 말할 때 쓴다. 일반 relation 은 null. */
    readonly dependencies: 'blocked_by' | 'blocking' | null
  }
}

/**
 * rollup 컬럼(rollup 5c). **값이 행에 없다** — 어디에도 저장하지 않고 읽을 때 계산한다(정본 §3.5 [보강] rollup v1).
 * 칸을 그리는 데 필요한 것은 따로 받는다(`rollup.ts` `computeRollups` → `RollupPage`).
 *
 * 그래서 여기 싣는 `rollup` 은 **설정**이다: 무엇을 타고(관계) 무엇을(대상) 어떻게(함수) 모으는지. 화면이 이것으로
 * 그리지는 않는다 — 실제로 적용한 함수는 `RollupPage.columns[id].function` 이다(대상 타입에 맞지 않으면 접힌다).
 * 속성 추가 폼이 방금 만든 컬럼을 새로고침 없이 붙일 때, 그리고 머리에 이름을 세울 때 쓴다.
 */
export type RollupColumn = ColumnBase & {
  readonly type: 'rollup'
  readonly rollup: {
    readonly relationPropertyId: string
    readonly targetPropertyId: string
    readonly function: RollupFunction
  }
}

/**
 * 고유 ID 컬럼(2a-1 · F-03-09). **값이 셀이 아니라 행에 있다** — 행의 `uniqueSeq`(`page.unique_seq`). 접두사는 표 전체에
 * 하나라(data source 의 것 · 정본 §3.5 [보강] 고유 ID ⑦) 행마다 싣지 않고 여기 싣는다. 그리는 것은 `formatUniqueId`.
 *
 * 셀 컬럼이 아니므로 셀 편집 · 셀 필터 축에 넘어가지 않는다(`isCellColumn` 이 거른다) — 필터 · 정렬은 `filter.ts` 가 이 타입을
 * 따로 안다.
 */
export type UniqueIdColumn = ColumnBase & {
  readonly type: 'unique_id'
  readonly uniqueId: { readonly prefix: string | null }
}

/**
 * 수식 컬럼(2i-2 · F-03-12). **값이 행에 없다** — 읽을 때 계산한다(`formula-property.ts` `computeFormulaValues` → `FormulaPage`).
 * 여기 싣는 것은 **설정**이다: 사람이 읽는 식(지금 이름으로 되돌린 것 — 편집기가 이 식을 연다) · 저장된 식(`⟦id⟧` — 화면이 같은 행의
 * 칸으로 계산할 때 이것을 읽는다 · `formula-plan.ts`) · 결과 타입.
 */
export type FormulaColumn = ColumnBase & {
  readonly type: 'formula'
  readonly formula: {
    readonly expression: string
    /** 저장된 식 — 원문 그대로에 속성 자리만 `⟦id⟧`(2i-3a). 이름으로 되돌린 `expression` 을 다시 읽지 않는다(이름이 겹치면 다른 속성을 묶는다). */
    readonly source: string
    readonly resultType: FormulaType
  }
}

export type ViewColumn = CellColumn | RelationColumn | RollupColumn | UniqueIdColumn | FormulaColumn

/** 이 표의 하위 항목 짝(2b-2) — 컬럼(숨긴 것 포함)의 relation 표시에서 읽는다. 꺼져 있으면 null. */
export function subItemPairOf(
  columns: readonly ViewColumn[],
): { readonly parentPropertyId: string; readonly childrenPropertyId: string } | null {
  const sideOf = (side: 'parent' | 'children') =>
    columns.find((c) => c.type === 'relation' && c.relation.subItems === side)?.propertyId
  const parent = sideOf('parent')
  const children = sideOf('children')
  return parent !== undefined && children !== undefined ? { parentPropertyId: parent, childrenPropertyId: children } : null
}

/**
 * 이 뷰가 하위 항목을 **트리로** 그리는가 — 표 · 목록(2b-2). 갤러리는 "부모만"이다(`showsParentsOnly`) · 보드도 부모만이지만 그룹 질의
 * (`group.ts`)가 따로 본다.
 */
export function nestsSubItems(viewType: string): boolean {
  return viewType === 'table' || viewType === 'list'
}

/**
 * 이 뷰가 하위 항목이 켜진 표에서 **부모(최상위 행)만** 그리는가 — 갤러리(2f-1). 03 F-03-18 *"보드/캘린더/갤러리 뷰는 Parents only 만
 * 지원"*. 펴지 않으므로 자식을 읽는 길(`?parent=`)이 없다. 검색 중에도 부모만이다(보드와 같다).
 */
export function showsParentsOnly(viewType: string): boolean {
  return viewType === 'gallery'
}

/** 거르고 정렬할 수 있는 컬럼 — 셀 컬럼 + 고유 ID(2a-2 · `filter.ts` `FILTERABLE_TYPES` 와 같은 목록). */
export type FilterableColumn = CellColumn | UniqueIdColumn

/** 그 타입 그대로 거를 수 있는 컬럼인가(셀 · 고유 ID). 수식까지 고르려면 `filterColumnOf` 를 쓴다. */
export function isFilterableColumn(column: ViewColumn): column is FilterableColumn {
  return isFilterableType(column.type)
}

/**
 * 거르고 정렬할 때 이 컬럼이 보이는 모양(2j-3) — 셀 · 고유 ID 는 그대로, 수식은 **결과 타입의 칸 컬럼**(수 → 숫자 · 글 → 텍스트 · 참거짓 →
 * 체크박스 · 날짜 → 날짜 — `formulaFilterType`, 서버의 `filterTypeOf` 와 같은 표)이다. 그래서 도구줄의 연산자 · 값 입력이 칸과 같은 것을
 * 쓴다 — 서버는 같은 연산자로 수식 값의 캐시(`derived_value`)를 거른다. 거를 수 없으면 null(relation · rollup).
 */
export function filterColumnOf(column: ViewColumn): FilterableColumn | null {
  if (isFilterableColumn(column)) return column
  if (column.type !== 'formula') return null
  const type = formulaFilterType(column.formula.resultType)
  if (type === null || type === 'unique_id') return null
  return {
    propertyId: column.propertyId,
    name: column.name,
    visible: column.visible,
    orderKey: column.orderKey,
    width: column.width,
    wrap: column.wrap,
    options: [],
    calculation: null,
    type,
  }
}

/** 컬럼들 중 거르고 정렬할 수 있는 것을 그 모양으로(`filterColumnOf`). */
export function filterColumnsOf(columns: readonly ViewColumn[]): FilterableColumn[] {
  return columns.flatMap((c) => {
    const f = filterColumnOf(c)
    return f === null ? [] : [f]
  })
}

/**
 * 저장된 config → 컬럼의 relation 부분. relation 의 모양이 아니면(손상) null — 그 컬럼은 그리지 않는다.
 *
 * 서버(`view.ts` `readColumns`)와 화면(방금 만든 relation 컬럼을 새로고침 없이 붙일 때)이 **같은 함수**로 읽는다. 두 벌이면
 * 방금 만든 컬럼과 새로고침한 컬럼이 다르게 동작한다(`limit` 을 한쪽만 읽는 식으로).
 */
export function relationOf(config: unknown): RelationColumn['relation'] | null {
  const parsed = readRelationConfig(config)
  if (parsed === null) return null
  return {
    targetDataSourceId: parsed.target_data_source_id,
    limit: parsed.limit ?? 'none',
    synced: parsed.synced_property_id !== undefined,
    subItems: parsed.sub_items ?? null,
    dependencies: parsed.dependencies ?? null,
  }
}

/**
 * 저장된 config → 컬럼의 rollup 부분. rollup 의 모양이 아니면 null — 그 컬럼은 그리지 않는다(relation 과 같은 규칙).
 */
export function rollupOf(config: unknown): RollupColumn['rollup'] | null {
  const parsed = readRollupConfig(config)
  if (parsed === null) return null
  return {
    relationPropertyId: parsed.relation_property_id,
    targetPropertyId: parsed.target_property_id,
    function: parsed.function,
  }
}

/**
 * 값이 셀에 있는 컬럼인가.
 *
 * **"relation 이 아니다"로 묻지 않는다.** 셀이 없는 타입은 relation 하나가 아니었고(rollup 이 둘째다) 앞으로도 는다
 * (formula). 부정으로 물으면 새 타입이 들어올 때마다 이 술어를 고쳐야 하고, 고치기 전까지 그 타입이 **셀인 척**
 * 통과한다 — `readCell` · `parseDraft` · 필터 축이 조용히 틀린 값을 만든다. 셀 타입 목록에 있는지로 묻는다.
 */
export function isCellColumn(column: ViewColumn): column is CellColumn {
  return isMvpPropertyType(column.type)
}

/**
 * 정렬할 수 있는 컬럼.
 *
 * ⚠ select 를 뺀다. 지금의 컴파일러는 select 를 사이드카(`text_value` = **옵션 id**)로
 *   정렬해서 사용자에게는 아무 규칙 없는 순서로 보인다. F-04-10 이 요구하는 것은
 *   **옵션 정의 순서**(`select_option.order_idx` 조인)이고 그것이 들어올 때 연다.
 *   status 도 같은 사이드카라 같이 뺀다(`OPTION_TYPES`).
 */
export function isSortable(column: ViewColumn): boolean {
  // 서버가 정렬할 수 있는 타입으로 묻는다(`filterColumnOf` — 셀 타입 + 고유 ID + 수식(결과 타입 · 2j-3)). relation 은 사이드카가
  // 없고(값이 엣지다), rollup 은 저장된 값이 없다(정본 D1) — 전에는 "relation 이 아니다"로 물어서 rollup 머리에 정렬이 섰고, 누르면
  // 서버가 그 키를 조용히 건너뛰어 아무 일도 없었다(2a-2 에서 바로잡았다).
  const f = filterColumnOf(column)
  return f !== null && !isOptionType(f.type)
}
