/**
 * 공개 보드의 열 짓기 — 행 → 옵션 순서의 열 · 데이터에서 나온 버킷의 열 (공개 화면의 뷰 PV-1 · PV-6 · F-06-08 · 순수)
 *
 * 정본: 00-canonical-data-model.md [보강 PV-1] ② · ⑦
 *
 * 열 순서는 옵션 순서(스키마) · 값이 빈 행은 "없음" 열(맨 앞) · 체크박스는 체크 안 함 → 체크 · 숨긴 그룹은 뺀다. 카드는 들어온 행 순서 그대로.
 * 날짜 · 숫자 · 글로 묶으면(PV-6) 열은 데이터에서 나온다 — 앱과 같은 차례(`orderBuckets`) · 같은 이름(`groupLabel`)의 머리를 서버가 지어
 * 명세(`buckets`)에 싣는다. 이 파일은 DB 도 React 도 모른다.
 */

import { groupLabel } from '../database/board-drag.ts'
import { orderBuckets, type DataBucket } from '../database/group-bucket.ts'

/** 보드로 그릴 수 있는 그룹 기준의 타입 — 다른 타입(다중 선택 · 수식 …)은 표로 그린다. 날짜 · 숫자 · 글은 PV-6. */
export const PUBLIC_BOARD_GROUP_TYPES = ['select', 'status', 'checkbox', 'date', 'number', 'rich_text'] as const
export type PublicBoardGroupType = (typeof PUBLIC_BOARD_GROUP_TYPES)[number]

export const isBoardGroupType = (type: string): type is PublicBoardGroupType =>
  (PUBLIC_BOARD_GROUP_TYPES as readonly string[]).includes(type)

/** 데이터에서 나온 버킷으로 묶는 타입(PV-6) — 열은 옵션이 아니라 행의 값에서 나온다. */
export const isBucketGroupType = (type: string): type is 'date' | 'number' | 'rich_text' =>
  type === 'date' || type === 'number' || type === 'rich_text'

/** 값 없음 그룹의 키 — 앱의 `NO_VALUE_KEY` 와 같다. */
export const BOARD_NONE_KEY = ''

export type BoardOption = { readonly id: string; readonly name: string; readonly color: string }

/** 열 머리 하나 — 키 · 이름 · 옵션 색(없으면 null). */
export type BoardHead = { readonly key: string; readonly name: string; readonly color: string | null }

export type BoardColumn<T> = BoardHead & {
  readonly rows: readonly T[]
}

export type BoardSpec = {
  readonly type: PublicBoardGroupType
  readonly options: readonly BoardOption[]
  /**
   * 데이터에서 나온 버킷의 열 머리(PV-6 — 날짜 · 숫자 · 글) — 값 없음 열을 맨 앞에 넣어 앱의 차례 · 이름 그대로(`bucketHeadsOf`). 옵션 ·
   * 체크박스면 없다(옵션이 열이다).
   */
  readonly buckets?: readonly BoardHead[] | null
  /** 숨긴 그룹 키. */
  readonly hidden: readonly string[]
  readonly hideEmpty: boolean
}

/**
 * 행의 그룹 키 — `cell` 은 그 속성의 `properties_cache` 값. 모르는(지운) 옵션은 값 없음으로 센다. 데이터 버킷(PV-6)의 키는 이것이 아니라
 * 서버의 키 식(`bucketKeySql` — 앱과 같은 식)이 낸다.
 */
export function boardKeyOf(spec: Pick<BoardSpec, 'type' | 'options'>, cell: unknown): string {
  const record = typeof cell === 'object' && cell !== null && !Array.isArray(cell) ? (cell as Record<string, unknown>) : null
  if (spec.type === 'checkbox') return record?.checkbox === true ? 'true' : 'false'
  const ref = record?.[spec.type]
  const id = typeof ref === 'object' && ref !== null ? (ref as { id?: unknown }).id : undefined
  return typeof id === 'string' && spec.options.some((o) => o.id === id) ? id : BOARD_NONE_KEY
}

/**
 * 데이터 버킷의 열 머리(PV-6) — 값 없음 열이 맨 앞(앱의 `catalogOf` 처럼 행이 없어도 선다) · 나머지는 `keys` 에 든 버킷을 앱과 같은
 * 차례로 · 이름은 앱의 머리(`groupLabel` — "2026년 10월" · "20 ~ 30" · "ㄱ" · 값 없음은 "<속성> 없음"). 색은 없다.
 */
export function bucketHeadsOf(
  propertyType: 'date' | 'number' | 'rich_text',
  propertyName: string,
  bucket: DataBucket,
  keys: Iterable<string>,
): BoardHead[] {
  const head = (key: string): BoardHead => ({ key, name: groupLabel(propertyType, propertyName, { key, option: null }, bucket), color: null })
  return [head(BOARD_NONE_KEY), ...orderBuckets(new Set(keys), bucket).map(head)]
}

/** 열을 짓는다 — 행은 `keyOf` 로 열에 앉는다. */
export function buildBoardColumns<T>(spec: BoardSpec, rows: readonly T[], keyOf: (row: T) => string): BoardColumn<T>[] {
  const heads: readonly BoardHead[] =
    spec.buckets ??
    (spec.type === 'checkbox'
      ? [
          { key: 'false', name: '체크 안 함', color: null },
          { key: 'true', name: '체크', color: null },
        ]
      : [{ key: BOARD_NONE_KEY, name: '없음', color: null }, ...spec.options.map((o) => ({ key: o.id, name: o.name, color: o.color }))])
  const by = new Map<string, T[]>(heads.map((h) => [h.key, []]))
  for (const row of rows) by.get(keyOf(row))?.push(row)
  return heads
    .filter((h) => !spec.hidden.includes(h.key))
    .map((h) => ({ ...h, rows: by.get(h.key) ?? [] }))
    .filter((c) => !(spec.hideEmpty && c.rows.length === 0))
}
