/**
 * 바뀐 행만 그룹 화면에 합친다 — DB 실시간 동기화 RT-5조각 (F-05-16 · F-05-06 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md 판결 X-5 [보강] "X-5 의 단계" ㉒~㉔ [보강 RT-5]
 *
 * 그룹 델타(`group=1`)는 뷰에 서는 바뀐 행마다 그룹 키와 **그 그룹 안의** 이웃(`group`)을, 그리고 그룹 머리(`groups`)를 준다. 여기는 그것을
 * 그룹마다 평평한 목록의 합치기(`delta-merge.ts` 의 `mergeDelta`)로 나눈다 — 그룹 K 의 몫은 "그룹이 K 인 뷰에 서는 행은 그룹 안의 자리로, 다른
 * 그룹 · 뷰 밖이 된 행은 K 의 뷰 밖으로"(`deltaForGroup`). 그룹을 건너간 행은 옛 그룹에서 빠지고 새 그룹의 이웃 사이에 선다.
 *
 * **확신이 없으면 합치지 않는다**(`groupedDeltaFallback`): 평평한 것의 까닭(reset · 스키마 · 이 뷰 · 개인 설정) + 그룹 자리가 없다(여러 값 ·
 * 하위 그룹 · 부모만 — 서버가 `groupPlaced: false`) + **그룹 목록이 화면과 다르다**(그룹이 생기거나 사라졌다 · 숨김이 바뀌었다 — 빈 그룹 숨기기 ·
 * 데이터에서 나온 버킷).
 */

import { mergeDelta, type DeltaGroupHead, type DeltaJson, type DeltaRowJson, type FullReason } from './delta-merge.ts'
import type { RowJson } from './http.ts'

/** 화면이 함께 보낼 "더 보기" 커서의 상한 — 넘으면 다시 읽는다(주소의 길이 · 서버도 같은 상한). */
export const MAX_GROUP_PAGES = 50

/** 그룹 화면이 다시 읽는 까닭 — 평평한 것 + 그룹 목록이 화면과 다르다(`groups`). */
export type GroupedFullReason = FullReason | 'groups'

/** 화면에 선 그룹 — 차례대로(숨긴 그룹도 · 숨긴 그룹은 행이 없다). */
export type ShownGroup = {
  readonly key: string
  readonly hidden: boolean
  readonly rows: readonly RowJson[]
  readonly hasMore: boolean
  readonly nextCursor: string | null
}

/** 화면의 그룹 목록과 델타의 머리가 같은가 — 키 · 차례 · 숨김. */
export function sameGroupHeads(screen: readonly { readonly key: string; readonly hidden: boolean }[], heads: readonly DeltaGroupHead[]): boolean {
  return screen.length === heads.length && screen.every((g, i) => g.key === heads[i]!.key && g.hidden === heads[i]!.hidden)
}

/**
 * 그룹 델타로 합칠 수 없는 까닭 — 없으면 null(머리말). 바뀐 행이 없으면 늘 null 이다(머리도 그대로).
 */
export function groupedDeltaFallback(
  delta: DeltaJson,
  screen: readonly { readonly key: string; readonly hidden: boolean }[],
): GroupedFullReason | null {
  if (delta.personalChanged === true) return 'personal'
  if (delta.reset) return 'reset'
  if (delta.schemaChanged) return 'schema'
  if (delta.viewChanged) return 'view'
  if (delta.rows.length === 0) return null
  const standing = delta.rows.filter((r): r is DeltaRowJson & { kind: 'row_upsert' } => r.kind === 'row_upsert' && r.inView)
  if (delta.groupPlaced !== true || delta.groups === undefined || standing.some((r) => r.group === undefined)) return 'unplaced'
  if (!sameGroupHeads(screen, delta.groups)) return 'groups'
  const keys = new Set(delta.groups.map((h) => h.key))
  if (standing.some((r) => !keys.has(r.group!.key))) return 'groups'
  return null
}

/**
 * 그룹 K 의 몫 — 그룹이 K 인 뷰에 서는 행은 그룹 안의 자리(`place`)로, 다른 그룹 · 뷰 밖이 된 행은 K 의 뷰 밖으로(`inView: false`). 빠진 행은
 * 그대로. 평평한 합치기(`mergeDelta`)가 그대로 받는다.
 */
export function deltaForGroup(rows: readonly DeltaRowJson[], key: string): DeltaRowJson[] {
  return rows.map((row): DeltaRowJson => {
    if (row.kind !== 'row_upsert') return row
    const group = row.group
    const rest: Record<string, unknown> = { ...row }
    delete rest.group
    delete rest.place
    const base = rest as unknown as DeltaRowJson & { kind: 'row_upsert' }
    return row.inView && group !== undefined && group.key === key
      ? { ...base, inView: true, place: { before: group.before, after: group.after, beyond: group.beyond } }
      : { ...base, inView: false }
  })
}

/**
 * 그룹마다 "더 보기" 커서 — 숨기지 않은 그룹 가운데 더 볼 것이 남은 것. 상한을 넘으면 null(다시 읽는다).
 */
export function groupPages(groups: readonly ShownGroup[]): Record<string, string> | null {
  const pages: Record<string, string> = {}
  let n = 0
  for (const g of groups) {
    if (g.hidden || !g.hasMore || g.nextCursor === null) continue
    pages[g.key] = g.nextCursor
    n += 1
  }
  return n > MAX_GROUP_PAGES ? null : pages
}

/**
 * 보드 — 그룹마다 ⑪ 의 합치기(조건 밖으로 남기는 행이 없다 — 보드는 빠진 카드를 남기지 않는다 · 숨긴 그룹은 건너뛴다). 그룹 하나라도
 * 어긋나면 null — 보드 전체를 다시 읽는다. 머리는 부르는 쪽이 델타의 `groups` 로 갈아 끼운다.
 */
export function mergeGroupedDelta(
  groups: readonly ShownGroup[],
  rows: readonly DeltaRowJson[],
): { readonly rows: ReadonlyMap<string, RowJson[]>; readonly changed: boolean } | null {
  const merged = new Map<string, RowJson[]>()
  let changed = false
  for (const g of groups) {
    if (g.hidden) continue
    const result = mergeDelta({ previous: g.rows, outside: new Set(), touched: new Set(), rows: deltaForGroup(rows, g.key), hasMore: g.hasMore })
    if (!result.ok) return null
    merged.set(g.key, result.rows)
    changed ||= result.changed
  }
  return { rows: merged, changed }
}
