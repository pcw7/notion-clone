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

import type { ValidationIssue } from '../contracts/rich-text.ts'
import type { Tx } from '../db/tx.ts'
import { isOptionColor, isStatusGroupKind, type CellValue, type SelectOption } from './property-types.ts'

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

/**
 * 쓰려는 칸의 옵션이 **그 속성의 옵션**인가 — select · status 칸의 id 가 그 속성의 `select_option` 에 없으면 거부한다(셀 쓰기의
 * `peopleIssuesIn` 과 같은 자리 · HANDOFF §7 의 구멍).
 *
 * 모양 검사(`validateCellValue`)는 id 의 꼴만 봤다. 없는 id(다른 속성의 옵션 · 아무 uuid)를 API 로 넣으면 읽기에서 빈 값으로 접혀
 * 망가지지는 않았지만, 보드의 열 · 필터 · 집계가 "어느 열에도 없는 값"을 쥐게 됐다. 비우기(`null`)는 그대로 된다. 지운 옵션도 여기서
 * 걸린다(10n-6).
 *
 * **확인한 옵션 행을 `FOR SHARE` 로 쥔다**(정본 §3.5 [보강] 옵션 고치기 · 지우기 ③) — 옵션 지우기는 그 행을 먼저 지우므로 이 쓰기가
 * 끝나기를 기다리고, 그 뒤의 셀 비우기가 이 쓰기까지 본다. 쥐지 않으면 확인과 쓰기 사이에 지운 옵션의 id 가 셀에 남는다. 그래서 이
 * 확인은 쓰기 트랜잭션에서만 부른다.
 */
export async function optionIssuesIn(
  tx: Tx,
  cells: readonly { readonly propertyId: string; readonly value: CellValue }[],
): Promise<ValidationIssue[]> {
  return (await missingOptionRefs(tx, cells)).map((r) => ({ path: `cells.${r.propertyId}.${r.kind}.id`, message: '이 속성의 옵션이 아닙니다' }))
}

/**
 * 그 속성에 없는 옵션을 가리키는 칸을 뺀다 — 템플릿의 값이 쓴다(지운 프로퍼티의 값을 무시하는 것과 같은 까닭: 남겨 두면 셀 쓰기의 옵션
 * 확인이 요청 전체를 거부해 그 템플릿으로는 영영 행을 못 만든다 · 08 *"템플릿에 저장된 property 가 이후 삭제됨 → 해당 값은 무시"*). 그런 값은
 * 이 확인 전에 API 로 쓰였거나 앞으로 옵션 지우기가 남길 것이다.
 */
export async function withoutMissingOptions<Cell extends { readonly propertyId: string; readonly value: CellValue }>(
  tx: Tx,
  cells: readonly Cell[],
): Promise<Cell[]> {
  const missing = new Set((await missingOptionRefs(tx, cells)).map((r) => r.propertyId))
  return cells.filter((cell) => !missing.has(cell.propertyId))
}

async function missingOptionRefs(
  tx: Tx,
  cells: readonly { readonly propertyId: string; readonly value: CellValue }[],
): Promise<{ propertyId: string; id: string; kind: 'select' | 'status' }[]> {
  const refs: { propertyId: string; id: string; kind: 'select' | 'status' }[] = []
  for (const cell of cells) {
    const v = cell.value
    if (v.type === 'select' && v.select !== null) refs.push({ propertyId: cell.propertyId, id: v.select.id, kind: 'select' })
    if (v.type === 'status' && v.status !== null) refs.push({ propertyId: cell.propertyId, id: v.status.id, kind: 'status' })
  }
  if (refs.length === 0) return []
  // FOR SHARE — 옵션 지우기와 줄을 선다(`optionIssuesIn` 머리말)
  const known = await tx.query<{ property_id: string; id: string }>(
    `SELECT property_id, id FROM select_option WHERE id = ANY($1::uuid[]) FOR SHARE`,
    [[...new Set(refs.map((r) => r.id))]],
  )
  const ok = new Set(known.map((row) => `${row.property_id}:${row.id}`))
  return refs.filter((r) => !ok.has(`${r.propertyId}:${r.id}`))
}
