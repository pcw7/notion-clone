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

import { randomBytes, randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { orderKeyBetween, orderKeysBetween } from '../block/order-key.ts'
import { isUuid } from '../ids.ts'
import {
  DEFAULT_PROPERTY_TYPE,
  OPTION_COLORS,
  STATUS_DEFAULT_OPTIONS,
  STATUS_GROUP_KINDS,
  isAppPropertyType,
  isMvpPropertyType,
  isOptionColor,
  isOptionType,
  isStatusGroupKind,
  type AppPropertyType,
  type MvpPropertyType,
  type OptionColor,
  type SelectOption,
  type StatusGroupKind,
} from './property-types.ts'
import { readOptionsOf, toSelectOption } from './options.ts'
import { addPropertyToViews } from './view.ts'

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
  /** 셀 타입 7종 + 엣지 타입(`relation`). 모르는 타입은 읽기에서 `rich_text` 로 접는다(`toSummary`). */
  readonly type: AppPropertyType
  readonly config: Record<string, unknown>
  readonly orderKey: string
  /**
   * select · status 의 옵션(`options.ts` 의 순서). 다른 타입에는 없다.
   *
   * **옵션은 스키마다** — status 는 만드는 순간 옵션 셋이 함께 생기므로, 스키마 응답에 없으면 방금 더한 상태 컬럼의
   * 편집기가 새로고침 전까지 비어 있다.
   */
  readonly options?: readonly SelectOption[]
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
  /** 옵션 색이 `option_color` ENUM 에 없다. */
  | 'invalid_color'
  /** 옵션의 그룹이 틀렸다 — status 가 아닌데 그룹을 줬거나, 세 범주에 없는 값이다. */
  | 'invalid_group'
  /** status 의 `config.default_option_id` 가 이 프로퍼티의 옵션이 아니다(또는 모르는 키가 있다). */
  | 'invalid_config'
  /** relation 의 대상 data_source 가 없거나 볼 수 없다 — 둘을 구분하지 않는다(존재가 샌다). */
  | 'invalid_target'

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
export async function lockSchema(
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

export function isSchemaFailure(v: unknown): v is PropertyResult<never> {
  return typeof v === 'object' && v !== null && 'ok' in v
}

function isFailure(v: DataSourceRow | PropertyResult<never>): v is PropertyResult<never> {
  return 'ok' in v
}

/** 스키마를 고쳤으면 반드시 부른다. 이것이 stale 쓰기 차단의 유일한 축이다. */
export async function bumpSchema(tx: Tx, dataSourceId: string): Promise<string> {
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

function toSummary(row: PropertyRow, optionsOf: ReadonlyMap<string, readonly SelectOption[]>): PropertySummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // 스키마 ENUM 은 24종이라 MVP 밖 타입이 DB 에 있을 수 있다. 읽기는 관대하게
    // — 모르는 타입 하나가 스키마 조회 전체를 500 으로 만들면 복구할 길이 없다.
    type: isAppPropertyType(row.type) ? row.type : DEFAULT_PROPERTY_TYPE,
    config: row.config ?? {},
    orderKey: row.order_idx,
    ...(isOptionType(row.type) ? { options: optionsOf.get(row.id) ?? [] } : {}),
  }
}

export async function readSchema(tx: Tx, dataSourceId: string): Promise<SchemaSnapshot> {
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
  const optionsOf = await readOptionsOf(tx, rows.filter((r) => isOptionType(r.type)).map((r) => r.id))
  return {
    dataSourceId,
    schemaVersion: ds.schema_version,
    properties: rows.map((row) => toSummary(row, optionsOf)),
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

  return withCommandTransaction(async (tx) => {
    const ds = await lockSchema(tx, ctx, dataSourceId, input.expectedVersion)
    if (isFailure(ds)) return ds

    const inserted = await insertPropertyIn(tx, dataSourceId, {
      name,
      type,
      description: input.description ?? null,
      // status 의 config 는 받지 않는다 — 기본 옵션 id 는 아래에서 만든 옵션에서 나온다.
      config: type === 'status' ? {} : (input.config ?? {}),
    })
    if (isSchemaFailure(inserted)) return inserted
    if (type === 'status') await seedStatus(tx, inserted)

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: await readSchema(tx, dataSourceId) } as const
  })
}

/**
 * 프로퍼티 행 하나를 **맨 뒤에** 넣는다 — 이름 중복 · 상한 검사 · 뷰 시딩까지. 잠금과 버전 올리기는 호출자의 일이다.
 *
 * `relation.ts` 가 함께 쓴다: 양방향 relation 은 프로퍼티 **둘**을(때로는 서로 다른 data_source 에) 한 트랜잭션에서
 * 만들고 서로의 id 를 config 에 적는다 — 그래서 id 를 미리 받아 둘 수 있다.
 */
export async function insertPropertyIn(
  tx: Tx,
  dataSourceId: string,
  input: {
    readonly id?: string
    /** 이미 `normalizeName` 을 지난 이름. */
    readonly name: string
    readonly type: AppPropertyType
    readonly description: string | null
    readonly config: Record<string, unknown>
  },
): Promise<string | PropertyResult<never>> {
  const slot = await checkPropertySlots(tx, dataSourceId, [input.name])
  if (slot !== null) return slot

  const last = await tx.queryMaybe<{ order_idx: string }>(
    `SELECT order_idx FROM property
      WHERE data_source_id = $1 AND deleted_at IS NULL
      ORDER BY order_idx DESC LIMIT 1`,
    [dataSourceId],
  )

  const propertyId = input.id ?? newPropertyId()
  await tx.query(
    `INSERT INTO property (id, data_source_id, name, description, type, config, order_idx,
                           created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::property_type, $6::jsonb, $7, now(), now())`,
    [
      propertyId,
      dataSourceId,
      input.name,
      input.description,
      input.type,
      JSON.stringify(input.config),
      orderKeyBetween(last?.order_idx ?? null, null),
    ],
  )

  // ★ 새 컬럼은 이 data_source 의 **모든 뷰**에 나타나야 한다.
  //   `view_property.visible` 기본값이 `false` 이고 행이 없으면 조인에서
  //   빠지므로, 시딩하지 않으면 "컬럼을 추가했는데 표에 없다" 가 된다.
  await addPropertyToViews(tx, dataSourceId, propertyId)
  return propertyId
}

/**
 * 이 이름들로 프로퍼티를 더 만들 수 있는가 — 이름 중복(있는 것과 · 서로) · 상한. 만들 수 있으면 null.
 *
 * ★ **쓰기 전에 전부 검사한다.** 프로퍼티를 여럿 만드는 명령(양방향 relation)이 첫 프로퍼티를 넣은 뒤에 역방향의 이름이
 *   겹친다는 것을 알면 안 된다 — 이것으로 먼저 전부 묻는다. 거부를 돌려주면 롤백되는 안전망(`withCommandTransaction` ·
 *   HANDOFF §3.3-158)이 있지만 검사를 앞에 두는 것이 먼저다.
 */
export async function checkPropertySlots(
  tx: Tx,
  dataSourceId: string,
  names: readonly string[],
): Promise<PropertyResult<never> | null> {
  if (new Set(names).size !== names.length) return fail('duplicate_name')
  const counts = await tx.queryOne<{ n: string; dup: string }>(
    `SELECT count(*) AS n,
            count(*) FILTER (WHERE name = ANY($2::text[])) AS dup
       FROM property
      WHERE data_source_id = $1 AND deleted_at IS NULL`,
    [dataSourceId, names],
  )
  // F-03-02: 노션 UI 는 동명을 허용하는 것으로 보이지만 *"formula 의
  // `prop("이름")` 해석이 모호해지므로 클론에서는 **금지 권고**"* 다.
  // DB 의 부분 UNIQUE 도 막지만 그쪽은 23505 를 던질 뿐이다.
  if (Number(counts.dup) > 0) return fail('duplicate_name')
  if (Number(counts.n) + names.length > MAX_PROPERTIES_PER_DATA_SOURCE) return fail('too_many_properties')
  return null
}

/** 이름을 검사하고 정리한다(`relation.ts` 가 같은 규칙을 쓴다). 틀리면 null. */
export function normalizePropertyName(raw: unknown): string | null {
  return normalizeName(raw)
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

  return withCommandTransaction(async (tx) => {
    const ds = await lockSchema(tx, ctx, dataSourceId, input.expectedVersion)
    if (isFailure(ds)) return ds

    const target = await tx.queryMaybe<{ type: string }>(
      `SELECT type FROM property
        WHERE id = $1 AND data_source_id = $2 AND deleted_at IS NULL`,
      [propertyId, dataSourceId],
    )
    if (target === null) return fail('not_found')

    if (target.type === 'status' && input.config !== undefined) {
      if (!(await isValidStatusConfig(tx, propertyId, input.config))) return fail('invalid_config')
    }

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
  return withCommandTransaction(async (tx) => {
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
  return withCommandTransaction(async (tx) => {
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
  return withCommandTransaction(async (tx) => {
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

    // 뷰에도 다시 넣는다. 지우는 동안 `view_property` 행은 남아 있었지만
    // (폭·숬서 설정이 돌아오라고 그러다) 그 사이 만들어진 뷰에는 행이 없다.
    await addPropertyToViews(tx, dataSourceId, propertyId)

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: await readSchema(tx, dataSourceId) } as const
  })
}

// ── select 옵션 ───────────────────────────────────────────────────────

export type AddSelectOptionInput = {
  readonly name: string
  /** 생략하면 팔레트를 돌아가며 준다. */
  readonly color?: OptionColor
  /** status 옵션의 범주. 생략하면 `todo`. select 에 주면 거부한다(`invalid_group` · 불변식 SG3). */
  readonly group?: StatusGroupKind
}

export type SelectOptionResult = {
  readonly option: SelectOption
  /** `false` 면 같은 이름(대소문자 무시)의 옵션이 이미 있어서 그것을 돌려준 것이다. */
  readonly created: boolean
  readonly schemaVersion: string
}

/**
 * select 프로퍼티에 옵션을 추가한다 — F-03-04 의 *"`XXX` 생성"*.
 *
 * **옵션은 스키마다.** 셀이 아니라 `select_option` 레지스트리에 들어가고, 그 컬럼을
 * 쓰는 모든 행이 같은 목록을 본다. 그래서 `lockSchema`(= `edit_structure`)를 지나고
 * `schema_version` 을 올린다. `edit_content` 만 가진 사람은 **기존 옵션을 고를 수는
 * 있지만 새 옵션을 만들 수 없다.** 노션이 이 경우를 어떻게 다루는지 1차 출처로
 * 확인하지 못했으므로 좁은 쪽을 골랐다 — 나중에 넓히는 것은 규칙 한 줄이지만,
 * 넓게 열었다가 좁히면 이미 만들어진 옵션을 되돌릴 수 없다.
 *
 * **같은 이름이면 새로 만들지 않고 있는 것을 돌려준다.** 옵션 이름 유니크는
 * 대소문자 무시다(`ux_select_option_name`). F-03-04 동시편집 엣지 케이스: *"A 가
 * 옵션 생성, B 가 같은 이름 옵션 생성 → 서버에서 이름 정규화 후 병합, 두 id 중
 * 하나로 수렴."* 거부하면 B 의 화면은 "생성 실패" 를 띄우지만, B 가 원한 것(그
 * 이름의 옵션을 이 셀에 넣기)은 이미 가능하다.
 */
export async function addSelectOption(
  ctx: SessionContext,
  dataSourceId: string,
  propertyId: string,
  input: AddSelectOptionInput,
): Promise<PropertyResult<SelectOptionResult>> {
  const name = normalizeName(input.name)
  if (name === null) return fail('invalid_name')
  if (input.color !== undefined && !isOptionColor(input.color)) return fail('invalid_color')
  if (input.group !== undefined && !isStatusGroupKind(input.group)) return fail('invalid_group')

  return withCommandTransaction(async (tx) => {
    const ds = await lockSchema(tx, ctx, dataSourceId)
    if (isFailure(ds)) return ds

    const target = await tx.queryMaybe<{ type: string }>(
      `SELECT type FROM property
        WHERE id = $1 AND data_source_id = $2 AND deleted_at IS NULL`,
      [propertyId, dataSourceId],
    )
    if (target === null) return fail('not_found')
    // select · status 가 같은 레지스트리를 쓴다(0013 머리말). multi_select 는 그 타입이 들어올 때 연다.
    if (!isOptionType(target.type)) return fail('unsupported_type')
    // 불변식 SG3: status 옵션은 그룹이 있고, 그 밖의 옵션은 없다. DB 트리거도 막지만 이유를 말해 주는 쪽이 낫다.
    if (target.type === 'select' && input.group !== undefined) return fail('invalid_group')

    const groupKind: StatusGroupKind | null = target.type === 'status' ? (input.group ?? 'todo') : null
    const group =
      groupKind === null
        ? null
        : await tx.queryOne<{ id: string }>(
            `SELECT id FROM status_group WHERE property_id = $1 AND kind = $2::status_group_kind`,
            [propertyId, groupKind],
          )

    const stats = await tx.queryOne<{ n: string; last: string | null }>(
      `SELECT count(*) AS n, max(order_idx) AS last FROM select_option WHERE property_id = $1`,
      [propertyId],
    )
    // F-03-04 현실적 대안: "색상은 고정 10색 팔레트 라운드로빈". 개수로 돌리므로
    // 결정적이다 — 무작위면 같은 조작을 두 번 했을 때 테스트가 다른 색을 본다.
    const color = input.color ?? OPTION_COLORS[Number(stats.n) % OPTION_COLORS.length]

    const inserted = await tx.queryMaybe<{ id: string; name: string; color: string }>(
      `INSERT INTO select_option (id, property_id, name, color, group_id, order_idx)
       VALUES ($1, $2, $3, $4::option_color, $5, $6)
       ON CONFLICT (property_id, lower(name)) DO NOTHING
       RETURNING id, name, color::text AS color`,
      [randomUUID(), propertyId, name, color, group?.id ?? null, orderKeyBetween(stats.last, null)],
    )

    if (inserted !== null) {
      return {
        ok: true,
        value: {
          option: toSelectOption({ ...inserted, group_kind: groupKind }),
          created: true,
          schemaVersion: await bumpSchema(tx, dataSourceId),
        },
      } as const
    }

    // 같은 이름이 이미 있다 — 그것으로 수렴한다. 바뀐 것이 없으므로 버전을 올리지
    // 않는다(`moveProperty` 의 자기 앞 이동과 같은 규칙: 올리면 남의 낙관적 잠금을
    // 헛되게 깨뜨린다).
    // status 면 있는 옵션의 **그룹도 그대로** 돌려준다 — 요청한 그룹으로 옮기지 않는다(옮기기는 다른 명령이다).
    const existing = await tx.queryOne<{ id: string; name: string; color: string; group_kind: string | null }>(
      `SELECT o.id, o.name, o.color::text AS color, g.kind::text AS group_kind
         FROM select_option o
         LEFT JOIN status_group g ON g.id = o.group_id
        WHERE o.property_id = $1 AND lower(o.name) = lower($2)`,
      [propertyId, name],
    )
    return {
      ok: true,
      value: { option: toSelectOption(existing), created: false, schemaVersion: ds.schema_version },
    } as const
  })
}

// ── status ────────────────────────────────────────────────────────────

/**
 * status 프로퍼티의 세 그룹과 기본 옵션 셋을 만들고 첫 옵션을 **기본 옵션**으로 건다 (F-03-05 시나리오 1).
 *
 * 프로퍼티 행이 먼저 있어야 한다 — 그룹 · 옵션이 그것을 FK 로 가리키고, 0023 의 트리거가 그 타입을 읽는다.
 *
 * **기본 옵션은 새 행의 초깃값일 뿐이다**(HANDOFF §3.2-29). F-03-05 는 *"기본 옵션이 있는 동안 셀을 비울 수
 * 없다"* 까지 적었지만(2차 출처) 그 불변식은 이미 있는 행에서 성립하지 않는다 — status 컬럼을 나중에 더하면 기존
 * 행은 값이 없다. 전부 채우려면 스키마 잠금 안에서 행 수만큼 셀을 쓰고 모든 행의 `version` 을 올려야 한다(남의
 * 낙관적 잠금을 전부 깬다). 반만 지키는 불변식을 두지 않았다.
 */
async function seedStatus(tx: Tx, propertyId: string): Promise<void> {
  const groupIds = new Map<StatusGroupKind, string>()
  for (const kind of STATUS_GROUP_KINDS) {
    const id = randomUUID()
    groupIds.set(kind, id)
    await tx.query(
      `INSERT INTO status_group (id, property_id, kind) VALUES ($1, $2, $3::status_group_kind)`,
      [id, propertyId, kind],
    )
  }

  const keys = orderKeysBetween(null, null, STATUS_DEFAULT_OPTIONS.length)
  let defaultOptionId: string | null = null
  for (const [i, option] of STATUS_DEFAULT_OPTIONS.entries()) {
    const id = randomUUID()
    defaultOptionId ??= id
    await tx.query(
      `INSERT INTO select_option (id, property_id, name, color, group_id, order_idx)
       VALUES ($1, $2, $3, $4::option_color, $5, $6)`,
      [id, propertyId, option.name, option.color, groupIds.get(option.group), keys[i]],
    )
  }
  await tx.query(`UPDATE property SET config = $2::jsonb WHERE id = $1`, [
    propertyId,
    JSON.stringify({ default_option_id: defaultOptionId }),
  ])
}

/** status 의 config 는 `default_option_id`(이 프로퍼티의 옵션 id 또는 null) 하나다. 모르는 키는 거부한다. */
async function isValidStatusConfig(tx: Tx, propertyId: string, config: Record<string, unknown>): Promise<boolean> {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return false
  if (Object.keys(config).some((key) => key !== 'default_option_id')) return false
  const id = config.default_option_id
  if (id === undefined || id === null) return true
  if (typeof id !== 'string' || !isUuid(id)) return false
  const found = await tx.queryMaybe<{ one: number }>(
    `SELECT 1 AS one FROM select_option WHERE id = $1 AND property_id = $2`,
    [id, propertyId],
  )
  return found !== null
}
