/**
 * relation — relation 5a조각 (F-03-10 의 저장 모양과 서버 명령)
 *
 * 정본: 00-canonical-data-model.md §3.5 `relation_edge` · 불변식 C2 · E1 (+ [보강] RE1 · 캐시 투영)
 *       _canon/database.md C-2 판결 · 03-database-core.md F-03-10 · 마이그레이션 0013 · 0024
 *
 * ──────────────────────────────────────────────────────────────────────
 * relation 의 값은 셀이 아니라 엣지다 (C2)
 * ──────────────────────────────────────────────────────────────────────
 *
 * `page_property_value` 에 쓰지 않는다 — CLAUDE.md 의 "되돌리기 비싼 4가지" 중 하나다. 셀 쓰기 경로(`row.ts`
 * `prepareCells`)는 relation 을 **거부**하고, 쓰는 길은 여기의 `linkRows` 하나다. 읽기 모델(`properties_cache`)에는
 * 트리거가 렌더용 배열(앞 25개 + 개수)로 투영한다(0024) — 표 · 보드 · 목록은 캐시 한 컬럼으로 그린다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 값은 집합이다 — 통째로 덮어쓰지 않고 더하고 뺀다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-03-07 의 동시편집 엣지: *"집합 값이므로 LWW 로 덮으면 한쪽이 사라진다. relation 과 동일하게 **add/remove
 * 오퍼레이션 단위로 병합**하라."* A 가 X 를, B 가 Y 를 더하면 둘 다 남아야 한다. 그래서 명령은 `{ add, remove }` 이고
 * "이 목록으로 바꿔라"를 받지 않는다. 엣지의 PK 가 (프로퍼티, from, to) 라 같은 것을 두 번 더해도 하나다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 양방향은 엣지 두 행이다 — 정본 E1 (03 의 "엣지 1행" 권고를 따르지 않는다)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 짝(`config.synced_property_id`)이 있으면 (P, a→b) 와 (S, b→a) 를 **같은 트랜잭션에서** 쓴다. 어느 방향의 칸이든
 * `WHERE property_id = ? AND from_page_id = ?` 한 모양으로 읽고, 방향마다 칩 순서를 따로 갖는다. 03 이 걱정한 "두 행은
 * 어긋난다"는 0024 의 **지연 제약 트리거**가 커밋 시점에 검사한다 — 이 파일이 거울상을 빠뜨리면 트랜잭션이 죽는다.
 *
 * 네 가지 모양(F-03-10):
 *
 *   대상이 다른 표 · 단방향(기본)     P 하나. 짝 없음
 *   대상이 다른 표 · 양방향           P(이 표) + S(대상 표). 서로가 짝
 *   대상이 같은 표 · 프로퍼티 하나    P 하나. **자기 자신이 짝**(S = P) — "A 에 B 를 더하면 B 에도 A 가 보인다"
 *   대상이 같은 표 · 방향을 가른다    P + S 둘 다 이 표에. 서로가 짝("이전 작업" / "다음 작업")
 *
 * ──────────────────────────────────────────────────────────────────────
 * 잠금 — 거울상 쪽 행의 캐시도 다시 써진다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 엣지를 쓰면 트리거가 **나가는 쪽** 행의 `properties_cache` 를 재생성한다. 양방향이면 거울상의 나가는 쪽은 상대 행이다 —
 * 그 행의 셀을 남이 동시에 쓰고 있으면 두 재생성이 겹친다(`row.ts` `updateCellsIn` 이 행을 잠그는 이유). 그래서 이
 * 명령은 **건드리는 행 전부**를 `FOR UPDATE` 로 잠근다. 교착을 피하려고 **id 순서로** 잠근다(셀 쓰기는 한 행만 잠그므로
 * 그쪽과는 순환이 생기지 않는다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 권한
 * ──────────────────────────────────────────────────────────────────────
 *
 *   프로퍼티 만들기   이 표의 `edit_structure`. 대상 표는 **볼 수 있어야** 하고(단방향), 양방향이면 대상 표에도
 *                     프로퍼티가 생기므로 그쪽의 `edit_structure` 도 필요하다
 *   연결하기          이 행의 표의 `edit_content` + 대상 행을 **볼 수 있어야** 한다. 볼 수 없는 id 는 없는 id 와 같은
 *                     답을 받는다(`invalid_value`) — id 를 찍어 보며 존재를 알아낼 수 없다
 *   읽기              이 표의 `view`. 대상 표를 못 보면 제목 없이 **개수만**(`hidden`) — F-03-11 이 권한 없는 연결을
 *                     "N개 항목 접근 불가"로 표기하라고 한 것과 같은 규칙
 *
 * 거울상 엣지는 **시스템이 유지하는 투영**이다 — 대상 표의 `edit_content` 를 요구하지 않는다(F-03-10: *"한쪽에서 연결을
 * 추가/삭제하면 반대쪽에 즉시 반영된다"*). 그래서 대상 행의 `block.version` · `last_edited_*` 도 올리지 않는다: 그 행을
 * 고친 사람이 없고, 올리면 그 행을 편집 중인 남의 낙관적 잠금을 깨뜨린다. 읽기 모델의 `cache_version` 은 트리거가 올린다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 휴지통
 * ──────────────────────────────────────────────────────────────────────
 *
 * 연결된 행이 휴지통에 가도 엣지는 그대로다 — 복원하면 되살아나야 한다(F-03-10). 읽기(`readRelation`)가 살아 있는 행만
 * 준다. 영구 삭제는 FK CASCADE 가 양쪽 엣지를 함께 지운다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps, readableScopes } from '../permissions/effective.ts'
import { orderKeysBetween } from '../block/order-key.ts'
import { isUuid } from '../ids.ts'
import type { ValidationIssue } from '../contracts/rich-text.ts'
import {
  bumpSchema,
  checkPropertySlots,
  insertPropertyIn,
  isSchemaFailure,
  lockSchema,
  newPropertyId,
  normalizePropertyName,
  readSchema,
  type PropertyResult,
  type SchemaSnapshot,
} from './property.ts'
import { decodeCursorValues, encodeCursorValues } from './query.ts'
import { readRow, type RowSummary } from './row.ts'
import { MAX_QUERY_LIMIT } from './limits.ts'
import { readRelationConfig, readRelationValue, type RelationConfig, type RelationLimit } from './property-types.ts'

// ── 계약 ──────────────────────────────────────────────────────────────

// config 계약은 `property-types.ts` 에 있다(클라이언트도 읽고, 여기 두면 `view.ts` 와 값 import 가 순환한다).
export { readRelationConfig, type RelationConfig, type RelationLimit } from './property-types.ts'

/** 한 요청이 더하고 빼는 연결의 상한. 넘으면 나눠 보낸다. */
export const MAX_LINKS_PER_REQUEST = 100

// ── 프로퍼티 만들기 ───────────────────────────────────────────────────

export type AddRelationInput = {
  readonly name: string
  readonly targetDataSourceId: string
  /**
   * 역방향 프로퍼티를 **따로** 만든다 — 그 이름. 대상이 다른 표면 그 표에, 같은 표면 이 표에 생긴다.
   * 생략하면: 대상이 다른 표면 단방향, 같은 표면 프로퍼티 하나가 양쪽으로 동작한다(머리말의 네 모양).
   */
  readonly twoWay?: { readonly name: string }
  readonly limit?: RelationLimit
  readonly expectedVersion?: string
}

export type AddRelationOutcome = {
  readonly schema: SchemaSnapshot
  readonly propertyId: string
  /** 따로 만든 역방향 프로퍼티. 없으면 null(단방향 · 자기 자신이 짝). */
  readonly syncedPropertyId: string | null
}

const propertyFail = (reason: 'invalid_name' | 'invalid_target' | 'forbidden'): PropertyResult<never> => ({ ok: false, reason })

export async function addRelationProperty(
  ctx: SessionContext,
  dataSourceId: string,
  input: AddRelationInput,
): Promise<PropertyResult<AddRelationOutcome>> {
  const name = normalizePropertyName(input.name)
  if (name === null) return propertyFail('invalid_name')
  const inverseName = input.twoWay === undefined ? undefined : normalizePropertyName(input.twoWay.name)
  if (inverseName === null) return propertyFail('invalid_name')
  if (!isUuid(input.targetDataSourceId)) return propertyFail('invalid_target')

  const targetId = input.targetDataSourceId
  const self = targetId === dataSourceId
  const limit = input.limit === 'one' ? { limit: 'one' as const } : {}

  return withCommandTransaction(async (tx) => {
    // 두 표의 스키마를 잠근다면 id 순서로 — 서로를 가리키는 relation 을 동시에 만드는 두 요청이 교착하지 않게.
    const lockTargetToo = !self && inverseName !== undefined
    const first = lockTargetToo && targetId < dataSourceId ? targetId : dataSourceId
    const locks = new Map<string, Awaited<ReturnType<typeof lockSchema>>>()
    locks.set(first, await lockSchema(tx, ctx, first, first === dataSourceId ? input.expectedVersion : undefined))
    if (lockTargetToo) {
      const second = first === dataSourceId ? targetId : dataSourceId
      locks.set(second, await lockSchema(tx, ctx, second, second === dataSourceId ? input.expectedVersion : undefined))
    }

    const own = locks.get(dataSourceId)
    if (isSchemaFailure(own)) return own
    if (lockTargetToo) {
      const target = locks.get(targetId)
      // 대상 표를 못 보면 "없는 대상"과 같은 답이다. 볼 수는 있는데 못 고치면 그때만 forbidden.
      if (isSchemaFailure(target)) return !target.ok && target.reason === 'forbidden' ? target : propertyFail('invalid_target')
    } else if (!self && !(await canViewDataSource(tx, ctx, targetId))) {
      return propertyFail('invalid_target')
    }

    // ★ 쓰기 전에 전부 검사한다. 역방향의 이름이 겹친다는 것을 첫 프로퍼티를 넣은 **뒤에** 알면 반쪽짜리 relation 이
    //   남는다 — 처음에 그랬고 테스트가 잡았다(그 일이 #103 `withCommandTransaction` 을 낳았다 · HANDOFF §3.3-158).
    //   지금은 거부를 돌려주면 롤백되지만, 검사를 앞에 두는 것이 먼저다(헛된 쓰기도 없다).
    const ownNames = self && inverseName !== undefined ? [name, inverseName] : [name]
    const ownSlot = await checkPropertySlots(tx, dataSourceId, ownNames)
    if (ownSlot !== null) return ownSlot
    if (lockTargetToo && inverseName !== undefined) {
      const targetSlot = await checkPropertySlots(tx, targetId, [inverseName])
      if (targetSlot !== null) return targetSlot
    }

    const propertyId = newPropertyId()
    // 같은 표 · 역방향 이름 없음 → 자기 자신이 짝이다.
    const syncedPropertyId = inverseName !== undefined ? newPropertyId() : null
    const synced = syncedPropertyId ?? (self ? propertyId : null)

    const created = await insertPropertyIn(tx, dataSourceId, {
      id: propertyId,
      name,
      type: 'relation',
      description: null,
      config: { target_data_source_id: targetId, ...(synced === null ? {} : { synced_property_id: synced }), ...limit },
    })
    if (isSchemaFailure(created)) return created

    if (syncedPropertyId !== null && inverseName !== undefined) {
      const inverse = await insertPropertyIn(tx, targetId, {
        id: syncedPropertyId,
        name: inverseName,
        type: 'relation',
        description: null,
        // 역방향은 제한을 물려받지 않는다 — "한 작업은 프로젝트 하나"여도 프로젝트는 작업을 여럿 갖는다.
        config: { target_data_source_id: dataSourceId, synced_property_id: propertyId },
      })
      if (isSchemaFailure(inverse)) return inverse
      if (!self) await bumpSchema(tx, targetId)
    }

    await bumpSchema(tx, dataSourceId)
    return {
      ok: true,
      value: { schema: await readSchema(tx, dataSourceId), propertyId, syncedPropertyId },
    } as const
  })
}

/** 이 data_source 를 담은 데이터베이스를 볼 수 있는가. 없거나 다른 워크스페이스면 false. (`rollup.ts` 가 같은 질문을 한다.) */
export async function canViewDataSource(tx: Tx, ctx: SessionContext, dataSourceId: string): Promise<boolean> {
  const ds = await tx.queryMaybe<{ container_id: string }>(
    `SELECT ds.owner_database_id AS container_id
       FROM data_source ds
       JOIN block b ON b.id = ds.owner_database_id
      WHERE ds.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'`,
    [dataSourceId, ctx.workspaceId],
  )
  return ds !== null && can(await effectiveCaps(tx, ctx, ds.container_id), 'view')
}

// ── 연결하기 ──────────────────────────────────────────────────────────

export type RelationFailure =
  | 'not_found'
  | 'forbidden'
  /** 그 행의 표에 없는 프로퍼티이거나 relation 이 아니다. */
  | 'unknown_property'
  | 'readonly_property'
  | 'invalid_value'

export type RelationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: RelationFailure; readonly issues?: readonly ValidationIssue[] }

const fail = (reason: RelationFailure, issues?: readonly ValidationIssue[]): RelationResult<never> =>
  issues === undefined ? { ok: false, reason } : { ok: false, reason, issues }

function isFailure<T>(v: T | RelationResult<never>): v is RelationResult<never> {
  return typeof v === 'object' && v !== null && 'ok' in v
}

export type LinkInput = {
  readonly add?: readonly string[]
  readonly remove?: readonly string[]
}

type OpenRelation = {
  readonly dataSourceId: string
  readonly config: RelationConfig
  /** 대상 표를 볼 수 있는가. 못 보면 더할 수 없고, 읽으면 개수만 받는다. */
  readonly canViewTarget: boolean
}

/**
 * 행과 relation 프로퍼티를 열고 권한을 본다. 행은 아직 잠그지 않는다 — 잠금은 `lockRows` 가 id 순으로 한다.
 *
 * **템플릿 행도 연다**(F-08-02). 불변식 R1(`is_template = false`)은 *목록*의 규칙이지 "이 행 하나를 열어라"의
 * 규칙이 아니다 — 08 이 *"relation property 를 템플릿에 채워두면 그 템플릿으로 만든 모든 페이지가 동일 대상을
 * 참조한다"* 고 경고한 그 기능이 성립하려면 템플릿의 연결 칸을 읽고 고칠 수 있어야 한다. 셀을 쓰는 `updateCells`
 * 가 처음부터 템플릿을 구분하지 않은 것과 같은 축이다(`template.ts` 머리말 — 안을 고치는 것은 행의 길이다).
 *
 * **대상 쪽은 그대로 R1 을 지킨다**: 더할 수 있는 행 · 읽어 오는 행 · 후보 목록은 전부 `is_template = false` 다.
 * 템플릿은 연결의 **대상**이 될 수 없다 — 표에 없는 행을 가리키는 칸이 되기 때문이다.
 */
async function openRelation(
  tx: Tx,
  ctx: SessionContext,
  rowId: string,
  propertyId: string,
  need: 'view' | 'edit_content',
): Promise<OpenRelation | RelationResult<never>> {
  const row = await tx.queryMaybe<{ data_source_id: string; container_id: string }>(
    `SELECT p.data_source_id, ds.owner_database_id AS container_id
       FROM page p
       JOIN block b ON b.id = p.id
       JOIN data_source ds ON ds.id = p.data_source_id
      WHERE p.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'`,
    [rowId, ctx.workspaceId],
  )
  if (row === null) return fail('not_found')

  const caps = await effectiveCaps(tx, ctx, row.container_id)
  if (!can(caps, 'view')) return fail('not_found')
  if (need === 'edit_content' && !can(caps, 'edit_content')) return fail('forbidden')

  const property = await tx.queryMaybe<{ type: string; config: unknown; writable: string }>(
    `SELECT type, config, writable FROM property
      WHERE id = $1 AND data_source_id = $2 AND deleted_at IS NULL`,
    [propertyId, row.data_source_id],
  )
  const config = property === null || property.type !== 'relation' ? null : readRelationConfig(property.config)
  if (property === null || config === null) return fail('unknown_property')
  if (need === 'edit_content' && property.writable === 'readonly') return fail('readonly_property')

  return {
    dataSourceId: row.data_source_id,
    config,
    canViewTarget:
      config.target_data_source_id === row.data_source_id || (await canViewDataSource(tx, ctx, config.target_data_source_id)),
  }
}

function cleanIds(raw: readonly string[] | undefined, path: string): string[] | ValidationIssue {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return { path, message: '배열이어야 합니다' }
  if (raw.some((id) => typeof id !== 'string' || !isUuid(id))) return { path, message: '행 id(uuid) 의 배열이어야 합니다' }
  return [...new Set(raw)]
}

/**
 * 연결을 더하고 뺀다 — 머리말의 규칙 전부가 여기 모인다.
 *
 * `limit: 'one'` 인 칸에 하나를 더하면 **그것으로 바뀐다**(있던 연결을 뺀다) — "하나 고르기"의 자연스러운 뜻이다.
 * 둘 이상을 한 번에 더하면 거부한다. 제한을 나중에 건 칸에 이미 여러 개가 있으면 그대로 둔다(F-03-10: *"기존 값 유지 +
 * 신규 입력만 제한"*) — 빼는 것은 언제나 된다.
 */
export async function linkRows(
  ctx: SessionContext,
  rowId: string,
  propertyId: string,
  input: LinkInput,
): Promise<RelationResult<RowSummary>> {
  const add = cleanIds(input.add, 'add')
  const remove = cleanIds(input.remove, 'remove')
  if (!Array.isArray(add)) return fail('invalid_value', [add])
  if (!Array.isArray(remove)) return fail('invalid_value', [remove])
  if (add.length + remove.length > MAX_LINKS_PER_REQUEST) {
    return fail('invalid_value', [{ path: 'add', message: `한 번에 ${MAX_LINKS_PER_REQUEST}개까지 바꿀 수 있습니다` }])
  }
  if (!isUuid(rowId)) return fail('not_found')
  const both = add.filter((id) => remove.includes(id))
  if (both.length > 0) return fail('invalid_value', [{ path: 'add', message: '같은 행을 더하면서 뺄 수 없습니다' }])

  return withCommandTransaction(async (tx) => {
    const open = await openRelation(tx, ctx, rowId, propertyId, 'edit_content')
    if (isFailure(open)) return open
    const { config } = open
    const synced = config.synced_property_id ?? null

    if (config.limit === 'one' && add.length > 1) {
      return fail('invalid_value', [{ path: 'add', message: '이 속성에는 하나만 연결할 수 있습니다' }])
    }

    // ── 더할 대상: 대상 표의 살아 있는 행이고 볼 수 있어야 한다. 아니면 전부 같은 답(존재를 알리지 않는다) ──
    if (add.length > 0) {
      const found = open.canViewTarget
        ? await tx.query<{ id: string }>(
            `SELECT p.id FROM page p JOIN block b ON b.id = p.id
              WHERE p.id = ANY($1::uuid[]) AND p.data_source_id = $2 AND p.is_template = false
                AND b.workspace_id = $3 AND b.lifecycle = 'live'`,
            [add, config.target_data_source_id, ctx.workspaceId],
          )
        : []
      const ok = new Set(found.map((r) => r.id))
      const bad = add.filter((id) => !ok.has(id))
      if (bad.length > 0) {
        return fail('invalid_value', bad.map((id) => ({ path: 'add', message: `연결할 수 없는 행입니다: ${id}` })))
      }
    }

    // ── 있는 연결 · 제한 'one' 의 교체 ──
    const existing = await tx.query<{ to_page_id: string }>(
      `SELECT to_page_id FROM relation_edge WHERE property_id = $1 AND from_page_id = $2`,
      [propertyId, rowId],
    )
    const has = new Set(existing.map((e) => e.to_page_id))
    const toAdd = add.filter((id) => !has.has(id))
    const replaced = config.limit === 'one' && toAdd.length === 1 ? [...has] : []
    const toRemove = [...new Set([...remove.filter((id) => has.has(id)), ...replaced])]
    if (toAdd.length === 0 && toRemove.length === 0) {
      // 바뀐 것이 없다 — 버전을 헛되이 올리지 않는다(§3.3-148 과 같은 규칙).
      const same = await readRow(tx, rowId)
      return same === null ? fail('not_found') : ({ ok: true, value: same } as const)
    }

    // ── 잠금: 건드리는 행 전부를 id 순서로(머리말) ──
    const touched = synced === null ? [rowId] : [rowId, ...toAdd, ...toRemove]
    await tx.query(`SELECT id FROM block WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [[...new Set(touched)]])

    // ── 빼기: 엣지와 그 거울상 ──
    if (toRemove.length > 0) {
      await tx.query(
        `DELETE FROM relation_edge WHERE property_id = $1 AND from_page_id = $2 AND to_page_id = ANY($3::uuid[])`,
        [propertyId, rowId, toRemove],
      )
      if (synced !== null) {
        await tx.query(
          `DELETE FROM relation_edge WHERE property_id = $1 AND to_page_id = $2 AND from_page_id = ANY($3::uuid[])`,
          [synced, rowId, toRemove],
        )
      }
    }

    // ── 더하기: 칸의 맨 뒤에, 준 순서대로 ──
    if (toAdd.length > 0) {
      const last = await tx.queryOne<{ max: string | null }>(
        `SELECT max(order_idx COLLATE "C") AS max FROM relation_edge WHERE property_id = $1 AND from_page_id = $2`,
        [propertyId, rowId],
      )
      const keys = orderKeysBetween(last.max, null, toAdd.length)
      for (const [i, to] of toAdd.entries()) {
        await tx.query(
          `INSERT INTO relation_edge (property_id, from_page_id, to_page_id, order_idx)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [propertyId, rowId, to, keys[i]],
        )
      }

      if (synced !== null) {
        // 거울상은 **상대 행의 칸**의 맨 뒤에 선다 — 칸마다 순서가 따로다.
        const tails = await tx.query<{ from_page_id: string; max: string | null }>(
          `SELECT from_page_id, max(order_idx COLLATE "C") AS max FROM relation_edge
            WHERE property_id = $1 AND from_page_id = ANY($2::uuid[]) GROUP BY from_page_id`,
          [synced, toAdd],
        )
        const tailOf = new Map(tails.map((t) => [t.from_page_id, t.max]))
        for (const to of toAdd) {
          // 자기 자신이 짝인 프로퍼티에서 자기 자신을 연결하면 거울상이 곧 그 엣지다 — ON CONFLICT 가 접는다.
          await tx.query(
            `INSERT INTO relation_edge (property_id, from_page_id, to_page_id, order_idx)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [synced, to, rowId, orderKeysBetween(tailOf.get(to) ?? null, null, 1)[0]],
          )
        }
      }
    }

    // 고친 것은 **이 행**이다. 상대 행의 버전은 올리지 않는다(머리말).
    await tx.query(
      `UPDATE block SET version = version + 1, last_edited_by = $2, last_edited_at = now() WHERE id = $1`,
      [rowId, ctx.userId],
    )
    const summary = await readRow(tx, rowId)
    return summary === null ? fail('not_found') : ({ ok: true, value: summary } as const)
  })
}

// ── 읽기 ──────────────────────────────────────────────────────────────

export type RelatedRow = { readonly id: string; readonly title: string }

export type RelationPage = {
  /** 볼 수 있고 살아 있는 연결. 칸의 순서(`order_idx`)대로. */
  readonly items: readonly RelatedRow[]
  /** 엣지 전체 개수(캐시의 `count` 와 같다). */
  readonly total: number
  /** 대상 표를 볼 수 없어 제목을 주지 못한 개수 — "N개 항목 접근 불가". 볼 수 있으면 0 이다. */
  readonly hidden: number
  readonly hasMore: boolean
  readonly nextCursor: string | null
}

/**
 * 한 칸의 연결을 제목과 함께 읽는다 — 캐시의 id 를 **여기서 거른다**(머리말 · 0024 머리말).
 *
 * 휴지통에 간 행은 `items` 에도 `hidden` 에도 없다(복원하면 돌아온다). 행 단위 권한이 없으므로(HANDOFF §7) 대상 표를
 * 볼 수 있으면 그 표의 행은 전부 볼 수 있다 — 권한 검사는 표에 대해 한 번이다.
 */
export async function readRelation(
  ctx: SessionContext,
  rowId: string,
  propertyId: string,
  input: { readonly cursor?: string | null; readonly limit?: number } = {},
): Promise<RelationResult<RelationPage>> {
  if (!isUuid(rowId)) return fail('not_found')
  const limit = Math.min(Math.max(1, Math.floor(input.limit ?? 50)), MAX_QUERY_LIMIT)
  // 손상된 커서는 던지지 않고 처음부터 읽는다(`query.ts` `decodeCursorValues` 와 같은 태도).
  const decoded = decodeCursorValues(input.cursor)
  const cursor =
    decoded !== null && decoded.length === 2 && decoded.every((v): v is string => typeof v === 'string') ? decoded : null

  return withReadTransaction(async (tx) => {
    const open = await openRelation(tx, ctx, rowId, propertyId, 'view')
    if (isFailure(open)) return open

    const counts = await tx.queryOne<{ total: number; live: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE b.lifecycle = 'live' AND p.is_template = false)::int AS live
         FROM relation_edge e
         JOIN page p ON p.id = e.to_page_id
         JOIN block b ON b.id = p.id
        WHERE e.property_id = $1 AND e.from_page_id = $2`,
      [propertyId, rowId],
    )
    if (!open.canViewTarget) {
      return { ok: true, value: { items: [], total: counts.total, hidden: counts.live, hasMore: false, nextCursor: null } } as const
    }

    const rows = await tx.query<{ id: string; order_idx: string; title: unknown }>(
      `SELECT p.id, e.order_idx, b.properties->'title' AS title
         FROM relation_edge e
         JOIN page p ON p.id = e.to_page_id
         JOIN block b ON b.id = p.id
        WHERE e.property_id = $1 AND e.from_page_id = $2
          AND b.lifecycle = 'live' AND p.is_template = false
          AND ($3::text IS NULL OR (e.order_idx COLLATE "C", p.id::text) > ($3::text COLLATE "C", $4::text))
        ORDER BY e.order_idx COLLATE "C", p.id
        LIMIT $5`,
      [propertyId, rowId, cursor === null ? null : cursor[0], cursor === null ? null : cursor[1], limit + 1],
    )
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    const hasMore = rows.length > limit
    return {
      ok: true,
      value: {
        items: page.map((r) => ({ id: r.id, title: plainTitle(r.title) })),
        total: counts.total,
        hidden: 0,
        hasMore,
        nextCursor: hasMore && last !== undefined ? encodeCursorValues([last.order_idx, last.id]) : null,
      },
    } as const
  })
}

/**
 * LIKE 의 와일드카드를 글자로 만든다 — `%` · `_` · 그리고 이스케이프 문자 자신(`\`).
 *
 * 안 하면 `100%` 를 찾을 때 `%` 가 "아무 글자"가 되어 전부가 나오고, `_` 는 아무 한 글자와 맞는다. 값은 파라미터로
 * 바인딩하므로 주입은 아니다 — **결과가 틀리는** 문제다.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => '\\' + ch)
}

/** `block.properties.title`(투영된 제목)의 평문. `row.ts` `toRowSummary` 와 같은 규칙이다. */
function plainTitle(raw: unknown): string {
  return Array.isArray(raw)
    ? raw
        .map((r) => (typeof r === 'object' && r !== null ? String((r as { plain_text?: unknown }).plain_text ?? '') : ''))
        .join('')
    : ''
}

// ── 제목 맵 — 표 · 보드 · 목록이 칩을 그릴 때 (relation 5b-1) ──────────────

/** 한 번에 물을 수 있는 id 수. 표 50행 × relation 컬럼 몇 개 × 캐시의 25개를 덮는다. */
export const MAX_RELATION_LABELS = 2000

/**
 * 연결된 행들의 제목 — **캐시의 id 를 여기서 거른다.**
 *
 * 캐시(`properties_cache`)의 relation 칸은 걸러지지 않은 id 다(0024 머리말). 화면이 그 id 로 제목을 직접 읽으면 볼 수
 * 없는 행의 제목이 샌다. 표는 한 화면에 50행 × 컬럼 수만큼 칸이 있어 칸마다 `readRelation` 을 부를 수 없다 — 그래서
 * **id 를 모아 한 번에** 묻는다(`mention-labels` · `page-ref-titles` 와 같은 모양).
 *
 * 답은 셋으로 갈린다:
 *
 *   제목(string)   볼 수 있고 살아 있다. 제목이 비었으면 빈 문자열(화면이 "제목 없음"을 고른다)
 *   null           살아 있지만 **볼 수 없다** — 칩 대신 "볼 수 없는 연결 N개"로 센다(F-03-10 · F-03-11)
 *   (키 없음)      휴지통에 갔거나 없는 행 — 그리지 않는다. 복원하면 다시 제목이 온다
 *
 * `null` 과 "키 없음"을 가르는 것은 존재를 알리는 것이 아니다 — 묻는 사람은 이미 그 id 와 개수를 캐시에서 받았다.
 * 가르지 않으면 휴지통에 간 연결이 "볼 수 없는 연결"로 세어져 영영 남는다.
 *
 * 권한은 목록 필터와 같은 축이다(`readableScopes` — 행은 표의 스코프를 물려받는다).
 */
export async function loadRelationLabels(
  ctx: SessionContext,
  ids: readonly string[],
): Promise<Record<string, string | null>> {
  const wanted = [...new Set(ids.filter((id) => typeof id === 'string' && isUuid(id)))].slice(0, MAX_RELATION_LABELS)
  if (wanted.length === 0) return {}
  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    const rows = await tx.query<{ id: string; title: unknown; readable: boolean }>(
      `SELECT b.id, b.properties->'title' AS title, (b.perm_scope_id = ANY($3::uuid[])) AS readable
         FROM page p
         JOIN block b ON b.id = p.id
        WHERE p.id = ANY($1::uuid[]) AND b.workspace_id = $2
          AND b.lifecycle = 'live' AND p.is_template = false`,
      [wanted, ctx.workspaceId, scopes],
    )
    const out: Record<string, string | null> = {}
    for (const row of rows) out[row.id] = row.readable ? plainTitle(row.title) : null
    return out
  })
}

/** 행들의 캐시에서 relation 칸의 id 를 모은다 — `loadRelationLabels` 에 넘길 것. */
export function relationIdsIn(
  rows: readonly { readonly properties: Readonly<Record<string, unknown>> }[],
  propertyIds: readonly string[],
): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    for (const propertyId of propertyIds) {
      for (const ref of readRelationValue(row.properties[propertyId]).relation) ids.add(ref.id)
    }
  }
  return [...ids]
}

// ── 고를 후보 — 행 고르기 팝오버가 읽는다 (relation 5b-2) ─────────────────

/** 후보 목록의 상한. 넘으면 검색어를 더 치게 한다 — 팝오버는 스크롤해서 고르는 곳이 아니다. */
export const MAX_RELATION_CANDIDATES = 20

/**
 * 이 칸에 **더할 수 있는** 행을 제목으로 찾는다.
 *
 * 주소가 행이다(`rows/{id}/relations/{propertyId}/candidates`) — 대상 표를 클라이언트가 말하지 않는다. 서버가 프로퍼티의
 * config 에서 읽으므로 "이 프로퍼티의 대상이 아닌 표"를 뒤질 수 없고, **이미 연결된 행은 여기서 뺀다**(상한 20 안에서
 * 클라이언트가 빼면 후보가 전부 연결된 것일 때 빈 목록이 된다).
 *
 * `linkRows` 가 받는 것과 같은 집합이다 — 대상 표의 · 살아 있는 · 템플릿이 아닌 행. 대상 표를 못 보면 빈 목록이다
 * (그 표에 무엇이 있는지 알려 주지 않는다). 제목은 title 프로퍼티의 사이드카(`text_value`)로 찾는다 — 필터의
 * `contains` 와 같은 축이고 대소문자를 가리지 않는다. 순서는 표의 순서(`block.order_key`)다.
 */
export async function searchCandidates(
  ctx: SessionContext,
  rowId: string,
  propertyId: string,
  query: string,
): Promise<RelationResult<{ readonly items: readonly RelatedRow[] }>> {
  if (!isUuid(rowId)) return fail('not_found')
  const q = query.trim().slice(0, 200)
  return withReadTransaction(async (tx) => {
    const open = await openRelation(tx, ctx, rowId, propertyId, 'view')
    if (isFailure(open)) return open
    if (!open.canViewTarget) return { ok: true, value: { items: [] } } as const

    const target = open.config.target_data_source_id
    const rows = await tx.query<{ id: string; title: unknown }>(
      `SELECT p.id, b.properties->'title' AS title
         FROM page p
         JOIN block b ON b.id = p.id
         LEFT JOIN property tp ON tp.data_source_id = p.data_source_id AND tp.type = 'title' AND tp.deleted_at IS NULL
         LEFT JOIN page_property_value tv ON tv.page_id = p.id AND tv.property_id = tp.id
        WHERE p.data_source_id = $1 AND p.is_template = false
          AND b.workspace_id = $2 AND b.lifecycle = 'live'
          AND ($3 = '' OR tv.text_value ILIKE '%' || $4 || '%')
          AND NOT EXISTS (SELECT 1 FROM relation_edge e
                           WHERE e.property_id = $5 AND e.from_page_id = $6 AND e.to_page_id = p.id)
        ORDER BY b.order_key COLLATE "C", p.id
        LIMIT $7`,
      // LIKE 의 와일드카드(% · _ · \)를 글자로 만든다 — "100%" 를 찾으면 전부가 아니라 그 글자가 든 행이 나와야 한다.
      [target, ctx.workspaceId, q, escapeLike(q), propertyId, rowId, MAX_RELATION_CANDIDATES],
    )
    return { ok: true, value: { items: rows.map((r) => ({ id: r.id, title: plainTitle(r.title) })) } } as const
  })
}
