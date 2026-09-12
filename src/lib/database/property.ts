/**
 * 프로퍼티 스키마 관리 — W8-a (F-03-02)
 *
 * 정본: 00-canonical-data-model.md §3.5 (`property`, 불변식 P1~P5)
 *       03-database-core.md F-03-02
 *
 * ──────────────────────────────────────────────────────────────────────
 * 스키마 변경은 셀 쓰기와 다른 무게를 갖는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-03-02: *"스키마는 셀보다 충돌 비용이 크다. 스키마 변경은 **서버 직렬화 +
 * 낙관적 잠금(version)** 권고."*
 *
 * 그래서 모든 변경이 `data_source` 행을 `FOR UPDATE` 로 잠그고 `schema_version`
 * 을 올린다. 두 사람이 동시에 컬럼을 추가해도 순서가 정해지고, 낡은 스키마를
 * 들고 있던 클라이언트의 셀 쓰기는 버전 비교로 막힌다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 삭제는 soft delete 다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-03-02 데이터 모델 함의: *"프로퍼티 삭제는 **soft delete**(`deleted_at`) 로
 * 두어 복원과 undo 를 지원한다."* 셀 값(`page_property_value`)은 **지우지 않는다** —
 * 지우면 복원이 "빈 컬럼을 되살리는 것"이 되어 의미가 없다.
 *
 * 그 결정의 대가가 마이그레이션 0013 의 `[정정]` 이다: 이름 UNIQUE 가 살아있는
 * 행에만 걸려야 지운 이름을 다시 쓸 수 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * `title` 은 특별하다
 * ──────────────────────────────────────────────────────────────────────
 *
 * API 문서 명시: *"Every data source has exactly one `title` property. Its type
 * cannot be changed to something else, and no other property can be changed to
 * `title`."*
 *
 * 세 규칙 전부를 여기서 막는다. DB 도 절반을 막지만(`ux_property_one_title` ·
 * `ck_property_title_alive`) 그건 **마지막 방어선**이고, 사용자에게 제약 위반
 * 오류 대신 이유를 말해 주는 것은 이 계층의 일이다.
 */

import { randomBytes } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { orderKeyBetween } from '../block/order-key.ts'
import {
  DEFAULT_PROPERTY_TYPE,
  isMvpPropertyType,
  type MvpPropertyType,
} from './property-types.ts'

/**
 * data_source 당 프로퍼티 상한.
 *
 * 마스터 문서 §"추가 상수 고정": `프로퍼티 500/DS`. 정본은 `[확인필요]` 로 뒀지만
 * 상한이 없으면 스키마 질의가 한 행에 500열을 그리려 들 때 화면이 먼저 죽는다.
 */
export const MAX_PROPERTIES_PER_DATA_SOURCE = 500

/** `property.id` 길이. nanoid(21, base62) — 정본 C-4. */
export const PROPERTY_ID_LENGTH = 21

export const MAX_PROPERTY_NAME_LENGTH = 200
export const MAX_PROPERTY_DESCRIPTION_LENGTH = 2000

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/**
 * `property.id` 를 만든다.
 *
 * `nanoid` 를 의존성으로 넣지 않았다 — 필요한 것이 "base62 21자"뿐이고
 * `node:crypto` 로 열 줄이다. 새 의존성은 라이선스 확인과 공급망 표면을 늘린다
 * (CLAUDE.md 절대 제약 1 의 정신).
 *
 * **모듈로 편향을 피한다.** `randomBytes(21)` 의 각 바이트를 `% 62` 하면 앞쪽
 * 문자가 더 자주 나온다. 62 * 4 = 248 이므로 248 이상인 바이트는 버리고 다시 뽑는다.
 */
export function newPropertyId(): string {
  let out = ''
  while (out.length < PROPERTY_ID_LENGTH) {
    for (const b of randomBytes(PROPERTY_ID_LENGTH)) {
      if (b >= 248) continue
      out += BASE62[b % 62]
      if (out.length === PROPERTY_ID_LENGTH) break
    }
  }
  return out
}

// ── 결과 ──────────────────────────────────────────────────────────────

export type PropertySummary = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly type: MvpPropertyType
  readonly config: Record<string, unknown>
  readonly orderKey: string
}

export type SchemaSnapshot = {
  readonly dataSourceId: string
  /** 낡은 스키마로 셀을 쓰는 것을 막는 축. 클라이언트가 들고 다닌다. */
  readonly schemaVersion: string
  /** `order_idx` 순. 살아있는 것만. */
  readonly properties: readonly PropertySummary[]
}

export type PropertyFailure =
  | 'not_found'
  /** 볼 수는 있지만 스키마를 고칠 수 없다. */
  | 'forbidden'
  | 'duplicate_name'
  | 'invalid_name'
  | 'unsupported_type'
  /** `title` 은 삭제·타입 변경이 불가하고, 다른 것을 `title` 로 바꿀 수도 없다. */
  | 'title_immutable'
  | 'too_many_properties'
  /** 클라이언트가 낡은 스키마를 들고 있다. 다시 읽어야 한다. */
  | 'schema_conflict'

export type PropertyResult<T = SchemaSnapshot> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly reason: PropertyFailure
      /** `schema_conflict` 일 때 서버의 현재 버전. */
      readonly currentVersion?: string
    }

const fail = (reason: PropertyFailure, currentVersion?: string): PropertyResult<never> =>
  currentVersion === undefined
    ? ({ ok: false, reason } as const)
    : ({ ok: false, reason, currentVersion } as const)

// ── 공통 ──────────────────────────────────────────────────────────────

type DataSourceRow = { id: string; schema_version: string; container_id: string }

/**
 * data_source 를 잠그고 **스키마를 고칠 권한이 있는지** 본다.
 *
 * 권한의 대상은 data_source 가 아니라 그것을 담은 **블록**이다 — ACL 은 블록
 * 트리에 걸려 있고(`acl_entry.node_id`), data_source 는 그 블록의 확장이다.
 * `owner_database_id` 가 곧 `block.id` 이므로(X-2) 그 id 로 판정한다.
 *
 * 묻는 capability 는 `edit_content` 가 아니라 **`edit_structure`** 다. 정본 §3.3
 * 매트릭스가 그 구분을 이미 갖고 있다 — `database` 의 `edit_content` **레벨**은
 * `['view','comment','edit_content','create_child']` 를 주고 `edit_structure` 는
 * 주지 않는다. 즉 "값은 고칠 수 있지만 컬럼은 못 고치는 사람"이 데이터로 존재한다.
 * 레벨 비교로 추측하지 않고 capability 를 묻는다(규칙 A2).
 *
 * ⚠ **알려진 공백**: `resolveCaps` 는 ACL 대상을 `'page'` 로 고정하고 있다
 * (`permissions/effective.ts` — "database 는 W8 에서 온다"). 그래서 database 노드에
 * `edit_content` **레벨**을 직접 부여하면 페이지에 정의되지 않은 레벨이라 무시된다.
 * 상속받은 페이지 grant 로는 정상 동작한다. 대상 종류를 `effective()` 에 흘리는
 * 것은 별개 변경이다 — HANDOFF §7 에 남긴다.
 */
async function lockSchema(
  tx: Tx,
  ctx: SessionContext,
  dataSourceId: string,
  expectedVersion?: string,
): Promise<DataSourceRow | PropertyResult<never>> {
  const ds = await tx.queryMaybe<DataSourceRow>(
    `SELECT ds.id, ds.schema_version, ds.owner_database_id AS container_id
       FROM data_source ds
       JOIN block b ON b.id = ds.owner_database_id
      WHERE ds.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'
      FOR UPDATE OF ds`,
    [dataSourceId, ctx.workspaceId],
  )
  if (ds === null) return fail('not_found')

  const caps = await effectiveCaps(tx, ctx, ds.container_id)
  // 못 보는 사람에게는 존재를 알리지 않는다.
  if (!can(caps, 'view')) return fail('not_found')
  if (!can(caps, 'edit_structure')) return fail('forbidden')

  if (expectedVersion !== undefined && expectedVersion !== ds.schema_version) {
    return fail('schema_conflict', ds.schema_version)
  }
  return ds
}

function isFailure(v: DataSourceRow | PropertyResult<never>): v is PropertyResult<never> {
  return 'ok' in v
}

/** 스키마를 고쳤으면 반드시 부른다. 이것이 stale 쓰기 차단의 유일한 축이다. */
async function bumpSchema(tx: Tx, dataSourceId: string): Promise<string> {
  const row = await tx.queryOne<{ schema_version: string }>(
    `UPDATE data_source SET schema_version = schema_version + 1, updated_at = now()
      WHERE id = $1 RETURNING schema_version`,
    [dataSourceId],
  )
  return row.schema_version
}

type PropertyRow = {
  id: string
  name: string
  description: string | null
  type: string
  config: Record<string, unknown> | null
  order_idx: string
}

function toSummary(row: PropertyRow): PropertySummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // 스키마 ENUM 은 24종이라 MVP 밖 타입이 DB 에 있을 수 있다. 읽기는 관대하게
    // — 모르는 타입 하나가 스키마 조회 전체를 500 으로 만들면 복구할 길이 없다.
    type: isMvpPropertyType(row.type) ? row.type : DEFAULT_PROPERTY_TYPE,
    config: row.config ?? {},
    orderKey: row.order_idx,
  }
}

async function readSchema(tx: Tx, dataSourceId: string): Promise<SchemaSnapshot> {
  const [ds, rows] = await Promise.all([
    tx.queryOne<{ schema_version: string }>(
      `SELECT schema_version FROM data_source WHERE id = $1`,
      [dataSourceId],
    ),
    tx.query<PropertyRow>(
      `SELECT id, name, description, type, config, order_idx
         FROM property
        WHERE data_source_id = $1 AND deleted_at IS NULL
        ORDER BY order_idx, id`,
      [dataSourceId],
    ),
  ])
  return {
    dataSourceId,
    schemaVersion: ds.schema_version,
    properties: rows.map(toSummary),
  }
}

function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // 개행을 접는다. 컬럼 헤더는 한 줄이고, 개행이 들어가면 표가 들쭉날쭉해진다.
  const name = raw.replace(/\s+/g, ' ').trim()
  if (name.length === 0 || name.length > MAX_PROPERTY_NAME_LENGTH) return null
  return name
}

// ── 조회 ──────────────────────────────────────────────────────────────

export async function getSchema(
  ctx: SessionContext,
  dataSourceId: string,
): Promise<PropertyResult> {
  return withReadTransaction(async (tx) => {
    const ds = await tx.queryMaybe<DataSourceRow>(
      `SELECT ds.id, ds.schema_version, ds.owner_database_id AS container_id
         FROM data_source ds
         JOIN block b ON b.id = ds.owner_database_id
        WHERE ds.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'`,
      [dataSourceId, ctx.workspaceId],
    )
    if (ds === null) return fail('not_found')
    if (!can(await effectiveCaps(tx, ctx, ds.container_id), 'view')) return fail('not_found')

    return { ok: true, value: await readSchema(tx, dataSourceId) } as const
  })
}

// ── 추가 ──────────────────────────────────────────────────────────────

export type AddPropertyInput = {
  readonly name: string
  readonly type?: MvpPropertyType
  readonly description?: string
  readonly config?: Record<string, unknown>
  /** 주면 낙관적 잠금이 된다. */
  readonly expectedVersion?: string
}

/**
 * 프로퍼티를 추가한다. **맨 뒤**에 붙는다(표 우측 끝 `+` 의 위치 그대로).
 */
export async function addProperty(
  ctx: SessionContext,
  dataSourceId: string,
  input: AddPropertyInput,
): Promise<PropertyResult> {
  const name = normalizeName(input.name)
  if (name === null) return fail('invalid_name')

  const type = input.type ?? DEFAULT_PROPERTY_TYPE
  // ★ `title` 을 추가로 만들 수 없다. data_source 를 만들 때 하나가 생기고
  //   그것이 전부다(불변식 P1). DB 도 막지만 이유를 말해 주는 쪽이 낫다.
  if (type === 'title') return fail('title_immutable')
  if (!isMvpPropertyType(type)) return fail('unsupported_type')

  if (
    input.description !== undefined &&
    (typeof input.description !== 'string' ||
      input.description.length > MAX_PROPERTY_DESCRIPTION_LENGTH)
  ) {
    return fail('invalid_name')
  }

  return withTransaction(async (tx) => {
    const ds = await lockSchema(tx, ctx, dataSourceId, input.expectedVersion)
    if (isFailure(ds)) return ds

    const counts = await tx.queryOne<{ n: string; dup: string }>(
      `SELECT count(*) AS n,
              count(*) FILTER (WHERE name = $2) AS dup
         FROM property
        WHERE data_source_id = $1 AND deleted_at IS NULL`,
      [dataSourceId, name],
    )
    // F-03-02: 노션 UI 는 동명을 허용하는 것으로 보이지만 *"formula 의
    // `prop("이름")` 해석이 모호해지므로 클론에서는 **금지 권고**"* 다.
    // DB 의 부분 UNIQUE 도 막지만 그쪽은 23505 를 던질 뿐이다.
    if (Number(counts.dup) > 0) return fail('duplicate_name')
    if (Number(counts.n) >= MAX_PROPERTIES_PER_DATA_SOURCE) return fail('too_many_properties')

    const last = await tx.queryMaybe<{ order_idx: string }>(
      `SELECT order_idx FROM property
        WHERE data_source_id = $1 AND deleted_at IS NULL
        ORDER BY order_idx DESC LIMIT 1`,
      [dataSourceId],
    )

    await tx.query(
      `INSERT INTO property (id, data_source_id, name, description, type, config, order_idx,
                             created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::property_type, $6::jsonb, $7, now(), now())`,
      [
        newPropertyId(),
        dataSourceId,
        name,
        input.description ?? null,
        type,
        JSON.stringify(input.config ?? {}),
        orderKeyBetween(last?.order_idx ?? null, null),
      ],
    )

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: await readSchema(tx, dataSourceId) } as const
  })
}

// ── 수정 ──────────────────────────────────────────────────────────────

export type UpdatePropertyInput = {
  readonly name?: string
  readonly description?: string | null
  readonly config?: Record<string, unknown>
  readonly expectedVersion?: string
}

/**
 * 이름 · 설명 · config 를 고친다.
 *
 * **타입은 고칠 수 없다.** 타입 변환은 F-03-09(변환 매트릭스 + 손실 경고)이고
 * 모든 셀을 다시 쓰는 작업이라 이 함수의 일이 아니다. 여기서 `type` 을 받으면
 * "이름만 바꾸려다 데이터를 잃는" 경로가 생긴다.
 *
 * 불변식 P2: `id` 는 바뀌지 않는다. 그래서 이름을 바꿔도 formula/rollup 참조와
 * 셀 값이 그대로 살아 있다.
 */
export async function updateProperty(
  ctx: SessionContext,
  dataSourceId: string,
  propertyId: string,
  input: UpdatePropertyInput,
): Promise<PropertyResult> {
  const name = input.name === undefined ? undefined : normalizeName(input.name)
  if (input.name !== undefined && name === null) return fail('invalid_name')
  if (
    input.description !== undefined &&
    input.description !== null &&
    (typeof input.description !== 'string' ||
      input.description.length > MAX_PROPERTY_DESCRIPTION_LENGTH)
  ) {
    return fail('invalid_name')
  }

  return withTransaction(async (tx) => {
    const ds = await lockSchema(tx, ctx, dataSourceId, input.expectedVersion)
    if (isFailure(ds)) return ds

    const target = await tx.queryMaybe<{ type: string }>(
      `SELECT type FROM property
        WHERE id = $1 AND data_source_id = $2 AND deleted_at IS NULL`,
      [propertyId, dataSourceId],
    )
    if (target === null) return fail('not_found')

    if (name !== undefined) {
      const dup = await tx.queryMaybe<{ one: number }>(
        `SELECT 1 AS one FROM property
          WHERE data_source_id = $1 AND name = $2 AND id <> $3 AND deleted_at IS NULL`,
        [dataSourceId, name, propertyId],
      )
      if (dup !== null) return fail('duplicate_name')
    }

    await tx.query(
      `UPDATE property
          SET name = coalesce($3, name),
              -- description 은 null 로 **지울 수 있어야** 하므로 coalesce 로
              -- 접으면 안 된다. "안 보냈다"와 "비워라"를 구분한다.
              description = CASE WHEN $4::boolean THEN $5 ELSE description END,
              config = coalesce($6::jsonb, config),
              updated_at = now()
        WHERE id = $1 AND data_source_id = $2`,
      [
        propertyId,
        dataSourceId,
        name ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.config === undefined ? null : JSON.stringify(input.config),
      ],
    )

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: await readSchema(tx, dataSourceId) } as const
  })
}

// ── 순서 ──────────────────────────────────────────────────────────────

/**
 * 프로퍼티를 `beforeId` 앞으로 옮긴다. `beforeId` 가 null 이면 맨 뒤로.
 *
 * fractional index 를 쓰므로 **옮기는 행 하나만** 쓴다. 정수 position 이면
 * 한 칸 옮길 때마다 뒤의 전부를 다시 써야 하고, 500개 컬럼에서 그것은 매번
 * 500행 UPDATE 다.
 */
export async function moveProperty(
  ctx: SessionContext,
  dataSourceId: string,
  propertyId: string,
  beforeId: string | null,
  expectedVersion?: string,
): Promise<PropertyResult> {
  return withTransaction(async (tx) => {
    const ds = await lockSchema(tx, ctx, dataSourceId, expectedVersion)
    if (isFailure(ds)) return ds

    const rows = await tx.query<{ id: string; order_idx: string }>(
      `SELECT id, order_idx FROM property
        WHERE data_source_id = $1 AND deleted_at IS NULL
        ORDER BY order_idx, id`,
      [dataSourceId],
    )
    const moving = rows.find((r) => r.id === propertyId)
    if (moving === undefined) return fail('not_found')
    if (beforeId !== null && !rows.some((r) => r.id === beforeId)) return fail('not_found')

    // ★ 자기 앞으로 옮기기는 **아무 일도 아니다.** 아래에서 자신을 목록에서
    //   빼기 때문에 `findIndex` 가 -1 을 돌려주고, 그러면 경계가 둘 다 null 이
    //   되어 **맨 앞으로 날아간다.** 실제로 그 버그를 테스트가 잡았다.
    //
    //   `schema_version` 도 올리지 않는다 — 바뀐 게 없으면 올리지 않는 것이
    //   프로젝터와 같은 규칙이고(X-6), 올리면 남의 낙관적 잠금을 헛되게 깨뜨린다.
    if (beforeId === propertyId) {
      return { ok: true, value: await readSchema(tx, dataSourceId) } as const
    }

    // 옮기는 자신을 뺀 목록에서 자리를 찾는다. 빼지 않으면 "자기 앞으로
    // 옮기기"가 자기 자신을 경계로 써서 키가 제자리에 머문다.
    const others = rows.filter((r) => r.id !== propertyId)
    const at = beforeId === null ? others.length : others.findIndex((r) => r.id === beforeId)
    const prev = at > 0 ? (others[at - 1]?.order_idx ?? null) : null
    const next = at < others.length ? (others[at]?.order_idx ?? null) : null

    await tx.query(`UPDATE property SET order_idx = $3, updated_at = now() WHERE id = $1 AND data_source_id = $2`, [
      propertyId,
      dataSourceId,
      orderKeyBetween(prev, next),
    ])

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: await readSchema(tx, dataSourceId) } as const
  })
}

// ── 삭제 · 복원 ───────────────────────────────────────────────────────

/**
 * 프로퍼티를 지운다 — **soft delete** 다.
 *
 * 셀 값(`page_property_value`)은 **건드리지 않는다.** 지우면 복원이 빈 컬럼을
 * 되살리는 것이 되어 F-03-02 가 요구한 "복원과 undo"가 성립하지 않는다.
 * 화면에서 사라지는 것은 스키마 조회가 `deleted_at IS NULL` 로 거르기 때문이다.
 */
export async function deleteProperty(
  ctx: SessionContext,
  dataSourceId: string,
  propertyId: string,
  expectedVersion?: string,
): Promise<PropertyResult> {
  return withTransaction(async (tx) => {
    const ds = await lockSchema(tx, ctx, dataSourceId, expectedVersion)
    if (isFailure(ds)) return ds

    const target = await tx.queryMaybe<{ type: string }>(
      `SELECT type FROM property
        WHERE id = $1 AND data_source_id = $2 AND deleted_at IS NULL`,
      [propertyId, dataSourceId],
    )
    if (target === null) return fail('not_found')
    // API 문서 명시: title 은 삭제할 수 없다. DB 의 `ck_property_title_alive` 도
    // 막지만 그쪽은 CHECK 위반을 던질 뿐이라 이유가 화면에 닿지 않는다.
    if (target.type === 'title') return fail('title_immutable')

    await tx.query(
      `UPDATE property SET deleted_at = now(), updated_at = now()
        WHERE id = $1 AND data_source_id = $2`,
      [propertyId, dataSourceId],
    )

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: await readSchema(tx, dataSourceId) } as const
  })
}

/**
 * 지운 프로퍼티를 되살린다. 셀 값이 그대로 돌아온다.
 *
 * 그 사이에 같은 이름의 프로퍼티가 생겼으면 `duplicate_name` 이다 — 이름을
 * 자동으로 바꿔 주지 않는다. 사용자가 의도하지 않은 이름이 생기는 것보다
 * 거부하고 묻는 편이 낫다.
 */
export async function restoreProperty(
  ctx: SessionContext,
  dataSourceId: string,
  propertyId: string,
  expectedVersion?: string,
): Promise<PropertyResult> {
  return withTransaction(async (tx) => {
    const ds = await lockSchema(tx, ctx, dataSourceId, expectedVersion)
    if (isFailure(ds)) return ds

    const target = await tx.queryMaybe<{ name: string }>(
      `SELECT name FROM property
        WHERE id = $1 AND data_source_id = $2 AND deleted_at IS NOT NULL`,
      [propertyId, dataSourceId],
    )
    if (target === null) return fail('not_found')

    const dup = await tx.queryMaybe<{ one: number }>(
      `SELECT 1 AS one FROM property
        WHERE data_source_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [dataSourceId, target.name],
    )
    if (dup !== null) return fail('duplicate_name')

    // 맨 뒤로 되살린다. 원래 자리의 `order_idx` 가 그 사이 다른 프로퍼티에게
    // 점유됐을 수 있고, 충돌하면 `UNIQUE` 가 아니라 **순서가 조용히 뒤섞인다**.
    const last = await tx.queryMaybe<{ order_idx: string }>(
      `SELECT order_idx FROM property
        WHERE data_source_id = $1 AND deleted_at IS NULL
        ORDER BY order_idx DESC LIMIT 1`,
      [dataSourceId],
    )
    await tx.query(
      `UPDATE property SET deleted_at = NULL, order_idx = $3, updated_at = now()
        WHERE id = $1 AND data_source_id = $2`,
      [propertyId, dataSourceId, orderKeyBetween(last?.order_idx ?? null, null)],
    )

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: await readSchema(tx, dataSourceId) } as const
  })
}
