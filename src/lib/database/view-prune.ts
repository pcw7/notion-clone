/**
 * 지운 속성 · 타입을 바꾼 속성의 조건을 뷰에서 뺀다 — 공유 층 · 모든 사람의 개인 층 · 뺀 것의 기록 (DB 실시간 동기화 RT-3조각 · F-05-16)
 *
 * 정본: 00-canonical-data-model.md §3.6 `view_user_override` [보강 RT-3] ③ · §3.5 [보강] 프로퍼티 타입 바꾸기 ⑤ · 마이그레이션 0154
 *       05-collaboration-sync.md F-05-16 *"B의 개인 필터가 A의 스키마 변경으로 무효화 → 그 조건만 drop 하고 배너 표시. 뷰 전체를 리셋하지
 *       않는다"*
 *
 * 속성을 지우는(타입을 바꾸는) 명령의 **트랜잭션 안에서** 부른다 — 속성이 사라진 것과 조건이 빠진 것이 함께 커밋된다. 그 속성을 가리키는
 * **조건만** 뺀다: 묶음(AND · OR)의 다른 규칙은 그대로고, 비게 된 묶음은 접힌다(`withoutRules`). 정렬은 그 키만.
 *
 *   공유 층   `view.filter` · `view.sorts` — 다 빠지면 필터 없음(NULL) · 정렬 `[]`
 *   개인 층   `view_user_override` — 덮어쓴 칸만 본다. 다 빠져도 **빈 묶음 · `[]`** 로 남긴다(NULL 은 "덮어쓰지 않았다"라 공유 것으로 돌아가
 *             그 사람이 고르지 않은 조건이 걸린다). 고치면 0154 의 트리거가 그 사람에게만 신호를 보낸다
 *
 * 뺀 것은 `view_filter_notice` 에 남긴다 — 개인 층은 그 사람, 공유 층은 NULL(보는 모두). **지운 사람에게는 알리지 않는다**(스스로 했다 —
 * 개인 층은 기록하지 않고 공유 층은 본 것으로 넣는다). 화면이 그 뷰를 다음에 볼 때 한 번 띄운다(`listViewNotices`).
 *
 * 되살리기(`restoreProperty`)는 뺀 조건을 돌려놓지 않는다 — 그 사이 사람마다 필터를 고쳤을 수 있고, 묶음의 어느 자리였는지 되짚을 수 없다.
 * 읽기 경로는 그대로 지운 속성의 규칙을 무시한다(F-03-17 — 이 정리 전의 옛 행 · 정리와 엇갈린 저장).
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import type { Tx } from '../db/tx.ts'
import { withoutRules, type FilterLeaf, type FilterNode, type SortKey } from './filter.ts'

/** 무엇을 뺄 것인가 — 규칙 하나 · 정렬 키 하나마다. */
export type ConditionDrop = {
  readonly leaf: (leaf: FilterLeaf) => boolean
  readonly sort: (key: SortKey) => boolean
}

export type PrunedLayer = {
  readonly filter: FilterNode | null
  readonly sorts: readonly SortKey[] | null
  /** 뺀 규칙 수 · 정렬 키 수. 둘 다 0 이면 받은 것을 그대로 돌려준다. */
  readonly filters: number
  readonly sortKeys: number
}

/** 개인 층의 "필터 없음" — 빈 묶음(0059 · NULL 은 "덮어쓰지 않았다"). */
const NO_FILTER: FilterNode = { op: 'and', children: [] }

/**
 * 한 층의 필터 · 정렬에서 뺀다 — 순수 함수. `sorts` 가 null 이면(개인 층이 정렬을 덮어쓰지 않았다) 그대로 null.
 * 개인 층(`personal`)은 덮어쓴 필터가 다 빠져도 빈 묶음으로 남는다(머리말).
 */
export function pruneLayer(
  filter: FilterNode | null,
  sorts: readonly SortKey[] | null,
  drop: ConditionDrop,
  layer: 'shared' | 'personal',
): PrunedLayer {
  const pruned = withoutRules(filter, drop.leaf)
  const keptSorts = sorts === null ? null : sorts.filter((key) => !drop.sort(key))
  const sortKeys = sorts === null || keptSorts === null ? 0 : sorts.length - keptSorts.length
  const nextFilter = pruned.removed > 0 && pruned.filter === null && layer === 'personal' && filter !== null ? NO_FILTER : pruned.filter
  return {
    filter: nextFilter,
    sorts: sortKeys === 0 ? sorts : keptSorts,
    filters: pruned.removed,
    sortKeys,
  }
}

export type PruneReason = 'property_deleted' | 'type_changed'

export type PruneOutcome = {
  /** 모든 층에서 뺀 규칙 수 · 정렬 키 수. */
  readonly filters: number
  readonly sorts: number
  /** 고친 공유 층(뷰) 수 · 개인 층 수. */
  readonly sharedViews: number
  readonly personalLayers: number
}

/**
 * 이 표의 모든 뷰(공유 층)와 그 뷰들의 개인 층에서 `drop` 이 고르는 조건을 빼고 알림을 남긴다. 부르는 쪽이 스키마 잠금(`lockSchema`)을 쥔
 * 트랜잭션이어야 한다. 행을 `FOR UPDATE` 로 잡고 읽는다 — 그 사이 뷰 · 개인 설정을 고친 쓰기를 기다려 그 값에서 뺀다(덮어써 잃지 않는다).
 * 차례는 id 순 — 다른 정리와 같은 차례로 잡는다.
 */
export async function pruneViewConditions(
  tx: Tx,
  ctx: SessionContext,
  input: {
    readonly dataSourceId: string
    readonly propertyId: string
    readonly propertyName: string
    readonly reason: PruneReason
    readonly drop: ConditionDrop
  },
): Promise<PruneOutcome> {
  let filters = 0
  let sorts = 0
  let sharedViews = 0
  let personalLayers = 0
  const note = async (viewId: string, userId: string | null, layer: PrunedLayer): Promise<void> => {
    const id = randomUUID()
    await tx.query(
      `INSERT INTO view_filter_notice (id, view_id, user_id, property_id, property_name, reason, filters, sorts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, viewId, userId, input.propertyId, input.propertyName, input.reason, layer.filters, layer.sortKeys],
    )
    // 공유 층 — 지운 사람은 본 것으로(머리말)
    if (userId === null) await tx.query(`INSERT INTO view_filter_notice_seen (notice_id, user_id) VALUES ($1, $2)`, [id, ctx.userId])
  }

  // ── 공유 층 — 이 표를 보는 모든 뷰(붙인 뷰 · 대시보드 위젯 포함). 속성 id 가 글에 없는 뷰는 잡지도 않는다 ──
  const views = await tx.query<{ id: string; filter: FilterNode | null; sorts: SortKey[] | null }>(
    `SELECT id, filter, sorts FROM view
      WHERE data_source_id = $1
        AND (strpos(coalesce(filter::text, ''), $2) > 0 OR strpos(coalesce(sorts::text, ''), $2) > 0)
      ORDER BY id
      FOR UPDATE`,
    [input.dataSourceId, input.propertyId],
  )
  for (const view of views) {
    const layer = pruneLayer(view.filter, Array.isArray(view.sorts) ? view.sorts : [], input.drop, 'shared')
    if (layer.filters + layer.sortKeys === 0) continue
    await tx.query(`UPDATE view SET filter = $2::jsonb, sorts = $3::jsonb, updated_at = now() WHERE id = $1`, [
      view.id,
      layer.filter === null ? null : JSON.stringify(layer.filter),
      JSON.stringify(layer.sorts ?? []),
    ])
    await note(view.id, null, layer)
    filters += layer.filters
    sorts += layer.sortKeys
    sharedViews += 1
  }

  // ── 개인 층 — 그 뷰들의 모든 사람. 덮어쓴 칸만 본다 ──
  const layers = await tx.query<{ view_id: string; user_id: string; filter: FilterNode | null; sorts: SortKey[] | null }>(
    `SELECT o.view_id, o.user_id, o.filter, o.sorts
       FROM view_user_override o JOIN view v ON v.id = o.view_id
      WHERE v.data_source_id = $1
        AND (strpos(coalesce(o.filter::text, ''), $2) > 0 OR strpos(coalesce(o.sorts::text, ''), $2) > 0)
      ORDER BY o.view_id, o.user_id
      FOR UPDATE OF o`,
    [input.dataSourceId, input.propertyId],
  )
  for (const own of layers) {
    const layer = pruneLayer(own.filter, Array.isArray(own.sorts) ? own.sorts : null, input.drop, 'personal')
    if (layer.filters + layer.sortKeys === 0) continue
    await tx.query(
      `UPDATE view_user_override SET filter = $3::jsonb, sorts = $4::jsonb, updated_at = now() WHERE view_id = $1 AND user_id = $2`,
      [own.view_id, own.user_id, layer.filter === null ? null : JSON.stringify(layer.filter), layer.sorts === null ? null : JSON.stringify(layer.sorts)],
    )
    if (own.user_id !== ctx.userId) await note(own.view_id, own.user_id, layer)
    filters += layer.filters
    sorts += layer.sortKeys
    personalLayers += 1
  }

  return { filters, sorts, sharedViews, personalLayers }
}
