/**
 * 옵션 레지스트리 읽기 — select · status 가 같은 표(`select_option`)를 쓴다 (F-03-04 · F-03-05)
 *
 * 정본: 00-canonical-data-model.md §3.5 `select_option` (+ [보강] `status_group`) · 마이그레이션 0013 · 0023
 *
 * ──────────────────────────────────────────────────────────────────────
 * 옵션을 읽는 곳은 여기 하나다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 뷰의 컬럼(`view.ts`) · 보드의 열(`group.ts`) · 익스포트(`export/snapshot.ts`)가 저마다 `select_option` 을 읽고
 * 있었다. status 가 들어오며 **순서 규칙이 하나 더 생겼다** — 세 곳이 따로 읽으면 "표의 옵션 목록과 보드의 열
 * 순서가 다른" 구간이 생긴다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * status 옵션은 그룹 순서가 먼저다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `할 일 → 진행 중 → 완료`, 그 안에서 `order_idx`. 나중에 "진행 중" 그룹에 더한 옵션이 `완료` **뒤**에 서면 보드의
 * 열이 흐름을 거스른다(시작 전 · 진행 중 · 완료 · 검토 중). `status_group_kind` ENUM 의 선언 순서가 곧 그 순서라
 * `ORDER BY g.kind` 하나로 끝난다. select 옵션은 그룹이 없어(NULL) 전부 같은 자리에 서고 `order_idx` 가 정한다 —
 * select 의 순서는 그대로다.
 */

import type { Tx } from '../db/tx.ts'
import { isOptionColor, isStatusGroupKind, type SelectOption } from './property-types.ts'

type OptionRow = {
  property_id: string
  id: string
  name: string
  color: string
  group_kind: string | null
}

export function toSelectOption(row: {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly group_kind?: string | null
}): SelectOption {
  return {
    id: row.id,
    name: row.name,
    // 스키마 ENUM 밖의 색은 읽기에서 기본색으로 접는다(읽기는 관대하게 — `property.ts` `toSummary` 와 같은 규칙).
    color: isOptionColor(row.color) ? row.color : 'default',
    ...(isStatusGroupKind(row.group_kind) ? { group: row.group_kind } : {}),
  }
}

/** 프로퍼티들의 옵션 — 프로퍼티 id → 옵션 목록(머리말의 순서). 옵션이 없는 프로퍼티는 맵에 없다. */
export async function readOptionsOf(
  tx: Tx,
  propertyIds: readonly string[],
): Promise<Map<string, SelectOption[]>> {
  const out = new Map<string, SelectOption[]>()
  if (propertyIds.length === 0) return out

  const rows = await tx.query<OptionRow>(
    `SELECT o.property_id, o.id, o.name, o.color::text AS color, g.kind::text AS group_kind
       FROM select_option o
       LEFT JOIN status_group g ON g.id = o.group_id
      WHERE o.property_id = ANY($1::text[])
      ORDER BY o.property_id, g.kind NULLS FIRST, o.order_idx, o.id`,
    [propertyIds],
  )
  for (const row of rows) {
    const list = out.get(row.property_id) ?? []
    list.push(toSelectOption(row))
    out.set(row.property_id, list)
  }
  return out
}
