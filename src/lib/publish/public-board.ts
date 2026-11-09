/**
 * 공개 보드의 열 짓기 — 행 → 옵션 순서의 열 (공개 화면의 뷰 PV-1 · F-06-08 · 순수)
 *
 * 정본: 00-canonical-data-model.md [보강 PV-1] ②
 *
 * 열 순서는 옵션 순서(스키마) · 값이 빈 행은 "없음" 열(맨 앞) · 체크박스는 체크 안 함 → 체크 · 숨긴 그룹은 뺀다. 카드는 들어온 행 순서 그대로.
 * 이 파일은 DB 도 React 도 모른다.
 */

/** 보드로 그릴 수 있는 그룹 기준의 타입 — 다른 타입(날짜 · 숫자 · 글)은 표로 그린다. */
export const PUBLIC_BOARD_GROUP_TYPES = ['select', 'status', 'checkbox'] as const
export type PublicBoardGroupType = (typeof PUBLIC_BOARD_GROUP_TYPES)[number]

export const isBoardGroupType = (type: string): type is PublicBoardGroupType =>
  (PUBLIC_BOARD_GROUP_TYPES as readonly string[]).includes(type)

/** 값 없음 그룹의 키 — 앱의 `NO_VALUE_KEY` 와 같다. */
export const BOARD_NONE_KEY = ''

export type BoardOption = { readonly id: string; readonly name: string; readonly color: string }

export type BoardColumn<T> = {
  /** 옵션 id · 체크박스는 'false' / 'true' · 값 없음은 ''. */
  readonly key: string
  readonly name: string
  readonly color: string | null
  readonly rows: readonly T[]
}

export type BoardSpec = {
  readonly type: PublicBoardGroupType
  readonly options: readonly BoardOption[]
  /** 숨긴 그룹 키. */
  readonly hidden: readonly string[]
  readonly hideEmpty: boolean
}

/**
 * 행의 그룹 키 — `cell` 은 그 속성의 `properties_cache` 값. 모르는(지운) 옵션은 값 없음으로 센다.
 */
export function boardKeyOf(spec: Pick<BoardSpec, 'type' | 'options'>, cell: unknown): string {
  const record = typeof cell === 'object' && cell !== null && !Array.isArray(cell) ? (cell as Record<string, unknown>) : null
  if (spec.type === 'checkbox') return record?.checkbox === true ? 'true' : 'false'
  const ref = record?.[spec.type]
  const id = typeof ref === 'object' && ref !== null ? (ref as { id?: unknown }).id : undefined
  return typeof id === 'string' && spec.options.some((o) => o.id === id) ? id : BOARD_NONE_KEY
}

/** 열을 짓는다 — 행은 `keyOf` 로 열에 앉는다. */
export function buildBoardColumns<T>(spec: BoardSpec, rows: readonly T[], keyOf: (row: T) => string): BoardColumn<T>[] {
  const heads: { key: string; name: string; color: string | null }[] =
    spec.type === 'checkbox'
      ? [
          { key: 'false', name: '체크 안 함', color: null },
          { key: 'true', name: '체크', color: null },
        ]
      : [{ key: BOARD_NONE_KEY, name: '없음', color: null }, ...spec.options.map((o) => ({ key: o.id, name: o.name, color: o.color }))]
  const by = new Map<string, T[]>(heads.map((h) => [h.key, []]))
  for (const row of rows) by.get(keyOf(row))?.push(row)
  return heads
    .filter((h) => !spec.hidden.includes(h.key))
    .map((h) => ({ ...h, rows: by.get(h.key) ?? [] }))
    .filter((c) => !(spec.hideEmpty && c.rows.length === 0))
}
