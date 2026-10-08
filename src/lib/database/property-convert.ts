/**
 * 프로퍼티 타입 바꾸기 — DB 심화 2c-1조각 (F-03-14 의 서버 명령)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 프로퍼티 타입 바꾸기 · 마이그레이션 0053 · 03-database-core.md F-03-14
 *
 * ──────────────────────────────────────────────────────────────────────
 * 같은 id · 한 트랜잭션
 * ──────────────────────────────────────────────────────────────────────
 *
 * 프로퍼티의 `type` 을 바꾸고 그 칸 전부를 같은 트랜잭션에서 다시 쓴다 — id 는 그대로라(P2) 뷰의 컬럼 · 정렬 · rollup 의 참조가 끊기지
 * 않는다. 한 트랜잭션이라 "반쯤 바뀐 표"가 없다. 순서가 중요하다: **타입을 먼저 바꾸고** 칸을 다시 쓴다 — 칸의 봉투가 프로퍼티의 타입과
 * 같아야 한다(CV1 · 0053 의 트리거).
 *
 * 변환과 엇갈린 셀 쓰기(변환 전에 읽은 스키마로 옛 타입의 봉투를 쓰는 요청)는 CV1 이 거부한다. 이 명령은 칸을 `FOR UPDATE` 로 잠그고
 * 읽어 그사이의 쓰기를 기다리게 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 손실은 확인을 받는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 값이 있던 칸이 비게 되는 변환(`"약 3개"` → 숫자)이 하나라도 있으면 `lossy_conversion` 과 그 개수로 거부한다 — 아무것도 바꾸지 않는다.
 * 확인(`confirmLoss`)을 실어 다시 부르면 바꾼다. 노션은 묻지 않고 바꾸고 되돌릴 수 없다(03) — 되돌리기(스냅숏)는 아직 없으므로 묻는
 * 것이 지금 줄 수 있는 안전이다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction } from '../db/tx.ts'
import { orderKeysBetween } from '../block/order-key.ts'
import { readCell } from './cell-format.ts'
import { withoutProperty, type FilterNode } from './filter.ts'
import { readOptionsOf } from './options.ts'
import { bumpSchema, isSchemaFailure, lockSchema, readSchema, type PropertyFailure, type SchemaSnapshot } from './property.ts'
import { OPTION_COLORS, deriveSidecars, isMvpPropertyType, type CellValue } from './property-types.ts'
import { canConvert, convertCell, isBlank, type ConvertibleType } from './type-conversion.ts'

/** 한 번에 바꿀 수 있는 칸 수(정본 ⑦). 그 위는 백그라운드 잡이 필요하다(03 · 아직 없다). */
export const MAX_CONVERT_CELLS = 10_000

export type ConvertInput = {
  readonly type: unknown
  /** 값이 사라지는 칸이 있어도 바꾼다. 없으면 그런 칸이 있을 때 `lossy_conversion` 으로 거부한다. */
  readonly confirmLoss?: boolean
  readonly expectedVersion?: string
}

export type ConvertOutcome = {
  readonly schema: SchemaSnapshot
  /** 값이 있던 칸 중 새 타입으로 옮겨진 수. */
  readonly converted: number
  /** 값이 사라진 칸 수(확인을 받은 것). */
  readonly lost: number
  /** 지운 필터 규칙 수(이 속성을 가리키던 것 — 정본 ⑤). */
  readonly filtersRemoved: number
}

export type ConvertFailure = PropertyFailure | 'lossy_conversion' | 'too_large'

export type ConvertResult =
  | { readonly ok: true; readonly value: ConvertOutcome }
  | { readonly ok: false; readonly reason: ConvertFailure; readonly lost?: number; readonly currentVersion?: string }

const fail = (reason: ConvertFailure, extra: { lost?: number } = {}): ConvertResult => ({ ok: false, reason, ...extra })

export async function convertProperty(
  ctx: SessionContext,
  dataSourceId: string,
  propertyId: string,
  input: ConvertInput,
): Promise<ConvertResult> {
  return withCommandTransaction(async (tx) => {
    const own = await lockSchema(tx, ctx, dataSourceId, input.expectedVersion)
    if (isSchemaFailure(own)) return own as ConvertResult

    const property = await tx.queryMaybe<{ type: string }>(
      `SELECT type::text AS type FROM property WHERE id = $1 AND data_source_id = $2 AND deleted_at IS NULL`,
      [propertyId, dataSourceId],
    )
    if (property === null) return fail('not_found')
    // 제목은 바꿀 수도 바꿔 올 수도 없다(API 문서 명시 · P1).
    if (property.type === 'title' || input.type === 'title') return fail('title_immutable')
    if (property.type === input.type) return { ok: true, value: { schema: await readSchema(tx, dataSourceId), converted: 0, lost: 0, filtersRemoved: 0 } } as const
    if (!canConvert(property.type, input.type) || !isMvpPropertyType(property.type)) return fail('unsupported_type')
    const from = property.type
    const to: ConvertibleType = input.type

    // ── 칸 — 잠그고 읽는다(그사이의 셀 쓰기를 기다리게) ──
    // **표의 행 순서대로** 읽는다 — 선택으로 바꿀 때 옵션의 순서와 이름의 표기(대소문자만 다른 둘 중 어느 것)가 그 순서로 정해진다.
    // 순서 없이 읽으면 판마다 다른 옵션이 생긴다(검사가 두 번째 판에서 잡았다).
    const cells = await tx.query<{ page_id: string; value: unknown }>(
      `SELECT v.page_id, v.value FROM page_property_value v JOIN block b ON b.id = v.page_id
        WHERE v.property_id = $1 ORDER BY b.order_key COLLATE "C", v.page_id FOR UPDATE OF v`,
      [propertyId],
    )
    if (cells.length > MAX_CONVERT_CELLS) return fail('too_large')

    // ── 옵션 — 옛 이름(선택에서 바꿀 때)과 새 옵션(선택으로 바꿀 때) ──
    // 이 프로퍼티의 옵션은 타입을 바꿔도 지우지 않는다 — 선택으로 되돌리면 같은 이름이 같은 옵션(색 그대로)으로 돌아온다(정본 ③).
    const options = (await readOptionsOf(tx, [propertyId])).get(propertyId) ?? []
    const nameOf = new Map(options.map((o) => [o.id, o.name]))
    const idOfName = new Map(options.map((o) => [o.name.toLowerCase(), o.id]))
    const created: { id: string; name: string }[] = []
    const optionIdFor = (name: string): string => {
      const known = idOfName.get(name.toLowerCase())
      if (known !== undefined) return known
      const id = randomUUID()
      idOfName.set(name.toLowerCase(), id)
      created.push({ id, name })
      return id
    }

    let converted = 0
    let lost = 0
    const next: { pageId: string; value: CellValue }[] = []
    for (const cell of cells) {
      const before = readCell(from, cell.value)
      const after = convertCell(before, to, { optionName: (id) => nameOf.get(id) ?? null, optionIdFor })
      if (after.lost) lost += 1
      else if (after.value !== null && !isBlank(before)) converted += 1
      if (after.value !== null) next.push({ pageId: cell.page_id, value: after.value })
    }
    if (lost > 0 && input.confirmLoss !== true) return fail('lossy_conversion', { lost })

    // ── 쓰기 — 타입 먼저, 그다음 칸(CV1) ──
    await tx.query(
      `UPDATE property SET type = $3::property_type, config = '{}'::jsonb, updated_at = now() WHERE id = $1 AND data_source_id = $2`,
      [propertyId, dataSourceId, to],
    )
    if (created.length > 0) {
      const last = await tx.queryOne<{ last: string | null; n: string }>(
        `SELECT max(order_idx COLLATE "C") AS last, count(*) AS n FROM select_option WHERE property_id = $1`,
        [propertyId],
      )
      const keys = orderKeysBetween(last.last, null, created.length)
      for (const [i, option] of created.entries()) {
        await tx.query(
          `INSERT INTO select_option (id, property_id, name, color, group_id, order_idx) VALUES ($1, $2, $3, $4::option_color, NULL, $5)`,
          [option.id, propertyId, option.name, OPTION_COLORS[(Number(last.n) + i) % OPTION_COLORS.length], keys[i]],
        )
      }
    }
    await tx.query(`DELETE FROM page_property_value WHERE property_id = $1`, [propertyId])
    if (next.length > 0) {
      const sidecars = next.map((c) => deriveSidecars(c.value))
      await tx.query(
        `INSERT INTO page_property_value (page_id, property_id, value, num_value, text_value, date_start, date_end, bool_value, filled_by, updated_at)
         SELECT t.page_id, $1, t.value, t.num, t.txt, t.ds, t.de, t.bool, 'user', now()
           FROM unnest($2::uuid[], $3::jsonb[], $4::numeric[], $5::text[], $6::timestamptz[], $7::timestamptz[], $8::boolean[])
             AS t(page_id, value, num, txt, ds, de, bool)`,
        [
          propertyId,
          next.map((c) => c.pageId),
          next.map((c) => JSON.stringify(c.value)),
          sidecars.map((s) => s.num),
          sidecars.map((s) => s.text),
          sidecars.map((s) => s.dateStart),
          sidecars.map((s) => s.dateEnd),
          sidecars.map((s) => s.bool),
        ],
      )
    }

    // ── 필터 — 이 속성의 규칙은 지운다(값의 뜻이 바뀌었다 · 정본 ⑤) ──
    let filtersRemoved = 0
    const views = await tx.query<{ id: string; filter: FilterNode | null }>(
      `SELECT id, filter FROM view WHERE data_source_id = $1 AND filter IS NOT NULL`,
      [dataSourceId],
    )
    for (const view of views) {
      const pruned = withoutProperty(view.filter, propertyId)
      if (pruned.removed === 0) continue
      filtersRemoved += pruned.removed
      await tx.query(`UPDATE view SET filter = $2::jsonb, updated_at = now() WHERE id = $1`, [
        view.id,
        pruned.filter === null ? null : JSON.stringify(pruned.filter),
      ])
    }

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: { schema: await readSchema(tx, dataSourceId), converted, lost, filtersRemoved } } as const
  })
}
