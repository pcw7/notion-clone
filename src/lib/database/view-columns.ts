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
  readRelationConfig,
  type MvpPropertyType,
  type RelationLimit,
  type SelectOption,
} from './property-types.ts'
import { readRollupConfig, type RollupFunction } from './rollup-functions.ts'

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

export type ViewColumn = CellColumn | RelationColumn | RollupColumn

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
