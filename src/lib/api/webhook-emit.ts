/**
 * 공개 API 웹훅 이벤트 내보내기 — 앱의 명령이 **자기 트랜잭션에서** 부른다 (API-9 · F-09-09)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑬ · 마이그레이션 0151 · 0152
 *
 * 부르는 곳은 명령의 목(choke point)이다 — 사람이 앱에서 하든 · 공개 API · 자동화 · AI · 가져오기 · 템플릿이 하든 같은 이벤트가 난다.
 *
 *   ① **구독이 없으면 조회 하나** — 트랜잭션마다 · 워크스페이스마다 켜진 구독을 한 번 묻고(`ix_api_webhook_workspace`) 그 트랜잭션 안에서는
 *      기억한다. 그 종류를 고른 구독이 없으면 아무것도 읽거나 쓰지 않는다 — 본문의 글자 하나(협업의 update)도 이 조회 하나다.
 *   ② **쓰기는 커밋 직전**(`tx.defer`) — 같은 트랜잭션의 같은 (종류, 대상)은 메모리에서 먼저 합친다. 묶는 줄의 잠금은 트랜잭션의 맨 끝에
 *      (종류, 대상) 차례로만 잡는다 — 명령의 다른 잠금(행 · 블록)과 엇갈려 교착하지 않는다. 되돌린 savepoint · 거부한 명령은 쓰지 않는다.
 *   ③ 구독 행은 `FOR KEY SHARE` 로 먼저 잡는다(지우는 명령 · 워커와 같은 차례) — 그 사이 지웠거나 멈춘 구독에는 쓰지 않는다.
 *   ④ `data` 는 쓸 때 만든다(`build`) — 명령이 끝난 뒤의 자리(부모)를 싣는다. null 이면 내지 않는다(템플릿 · 사라진 대상).
 *
 * 권한은 여기서 보지 않는다 — 보낼 때마다 워커가 토큰의 사람으로 다시 묻는다(`webhook-deliver.ts`).
 */

import { randomUUID } from 'node:crypto'

import type { Tx } from '../db/tx.ts'
import { webhooksOffSql } from '../notification/webhook-switch.ts'
import {
  AGGREGATED_LIST_KEY,
  aggregateDueAt,
  isAggregatedType,
  mergeAggregatedData,
  mergeAuthors,
  mergeIdList,
  mergeSchemaChanges,
  webhookParentOf,
  type AggregatedEventType,
  type AuthorRef,
  type BlockRef,
  type SchemaAction,
  type SchemaChange,
  type WebhookParent,
} from './webhook-aggregate.ts'
import { isWebhookEventType } from './webhook-events.ts'
import type { WebhookEntityType } from './webhook-outbox.ts'

type Runner = Pick<Tx, 'query'> & { readonly defer?: Tx['defer'] }

/** 일을 한 사람 — 자동화의 위임이면 자동화를 만든 사람(앱이 적는 사람). 사람이 없으면(익명 폼 · 시스템) null — 저자가 비어 나간다. */
export type WebhookActor = { readonly workspaceId: string; readonly userId: string | null }

export type WebhookEmission = {
  readonly type: string
  readonly entity: { readonly id: string; readonly type: WebhookEntityType }
  /** 쓸 때 만드는 `data`(묶는 종류면 목록 밖의 칸). null 이면 내지 않는다. */
  readonly build: (tx: Pick<Tx, 'query'>) => Promise<Record<string, unknown> | null>
  /** 묶는 종류의 목록(`updated_blocks` · `updated_properties`). */
  readonly items?: readonly unknown[]
}

type Pending = {
  readonly actor: WebhookActor
  readonly emission: WebhookEmission
  readonly subscriptions: readonly string[]
  readonly at: Date
}

type ActiveSubscription = { readonly id: string; readonly types: ReadonlySet<string> }

const ACTIVE = new WeakMap<object, Map<string, readonly ActiveSubscription[]>>()

/** ① 이 트랜잭션에서 이 워크스페이스의 켜진 구독 — 한 번만 묻는다. */
async function activeSubscriptionsIn(tx: Runner, workspaceId: string): Promise<readonly ActiveSubscription[]> {
  let byWorkspace = ACTIVE.get(tx)
  if (byWorkspace === undefined) {
    byWorkspace = new Map()
    ACTIVE.set(tx, byWorkspace)
  }
  const known = byWorkspace.get(workspaceId)
  if (known !== undefined) return known
  const rows = await tx.query<{ id: string; event_types: string[] }>(
    `SELECT s.id, s.event_types
       FROM api_webhook_subscription s
       JOIN api_token t ON t.id = s.api_token_id
      WHERE s.workspace_id = $1 AND s.status = 'active'
        AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())
        AND NOT ${webhooksOffSql('s.workspace_id')}
      ORDER BY s.id`,
    [workspaceId],
  )
  const found = rows.map((r) => ({ id: r.id, types: new Set(r.event_types) }))
  byWorkspace.set(workspaceId, found)
  return found
}

/** 이 종류들 중 하나라도 고른 켜진 구독이 있는가 — 데이터를 마련하기 전에 묻는다(구독이 없으면 그 조회 하나로 끝). */
export async function wantsWebhookIn(tx: Runner, workspaceId: string, types: readonly string[]): Promise<boolean> {
  const subs = await activeSubscriptionsIn(tx, workspaceId)
  return subs.some((s) => types.some((t) => s.types.has(t)))
}

/** 이벤트 하나를 낸다 — 고른 구독이 없으면 아무것도 하지 않는다. 쓰기는 커밋 직전(②). */
export async function emitWebhookIn(tx: Runner, actor: WebhookActor, emission: WebhookEmission): Promise<void> {
  if (!isWebhookEventType(emission.type)) throw new Error(`모르는 웹훅 이벤트: ${emission.type}`)
  const subscriptions = (await activeSubscriptionsIn(tx, actor.workspaceId)).filter((s) => s.types.has(emission.type)).map((s) => s.id)
  if (subscriptions.length === 0) return
  const pending: Pending = { actor, emission, subscriptions, at: new Date() }
  if (tx.defer !== undefined) tx.defer(OUTBOX, pending, flushWebhookEvents)
  else await flushWebhookEvents(tx, [pending])
}

const OUTBOX = {}

type Group = {
  readonly type: AggregatedEventType
  readonly entity: WebhookEmission['entity']
  readonly build: WebhookEmission['build']
  authors: AuthorRef[]
  items: unknown[]
  readonly subscriptions: Set<string>
  firstAt: Date
  lastAt: Date
}

const authorsOf = (actor: WebhookActor): AuthorRef[] => (actor.userId === null ? [] : [{ id: actor.userId, type: 'person' }])

/** ② 커밋 직전 — 보통 이벤트는 일어난 차례로 · 묶는 것은 (종류, 대상)마다 하나로 합쳐 키 차례로. */
async function flushWebhookEvents(tx: Pick<Tx, 'query'>, items: readonly Pending[]): Promise<void> {
  const ids = [...new Set(items.flatMap((p) => p.subscriptions))].sort()
  // ③ 구독 행 먼저(KEY SHARE) — 켜진 것만
  const live = new Set(
    (
      await tx.query<{ id: string }>(
        `SELECT id FROM api_webhook_subscription WHERE id = ANY($1::uuid[]) AND status = 'active' ORDER BY id FOR KEY SHARE`,
        [ids],
      )
    ).map((r) => r.id),
  )
  if (live.size === 0) return

  const plain: Pending[] = []
  const groups = new Map<string, Group>()
  for (const p of items) {
    const type = p.emission.type
    if (!isAggregatedType(type)) {
      plain.push(p)
      continue
    }
    const key = `${type}\u0000${p.emission.entity.id}`
    const next = p.emission.items ?? []
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, {
        type,
        entity: p.emission.entity,
        build: p.emission.build,
        authors: mergeAuthors([], authorsOf(p.actor)),
        items: type === 'data_source.schema_updated' ? mergeSchemaChanges([], next as SchemaChange[]) : mergeIdList([], next),
        subscriptions: new Set(p.subscriptions),
        firstAt: p.at,
        lastAt: p.at,
      })
      continue
    }
    group.authors = mergeAuthors(group.authors, authorsOf(p.actor))
    group.items = type === 'data_source.schema_updated' ? mergeSchemaChanges(group.items, next as SchemaChange[]) : mergeIdList(group.items, next)
    for (const s of p.subscriptions) group.subscriptions.add(s)
    if (p.at < group.firstAt) group.firstAt = p.at
    if (p.at > group.lastAt) group.lastAt = p.at
  }

  for (const p of plain) {
    const subs = p.subscriptions.filter((s) => live.has(s))
    if (subs.length === 0) continue
    const data = await p.emission.build(tx)
    if (data === null) continue
    await tx.query(
      `INSERT INTO api_webhook_event (id, subscription_id, workspace_id, event_id, type, entity_id, entity_type, authors, data, occurred_at, status, next_attempt_at)
       SELECT gen_random_uuid(), s.id, s.workspace_id, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, 'pending', $8
         FROM api_webhook_subscription s WHERE s.id = ANY($1::uuid[])`,
      [subs, randomUUID(), p.emission.type, p.emission.entity.id, p.emission.entity.type, JSON.stringify(authorsOf(p.actor)), JSON.stringify(data), p.at],
    )
  }

  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)!
    const subs = [...group.subscriptions].filter((s) => live.has(s)).sort()
    if (subs.length === 0) continue
    const base = await group.build(tx)
    if (base === null) continue
    await upsertAggregated(tx, group, subs, { ...base, [AGGREGATED_LIST_KEY[group.type]]: group.items })
  }
}

/**
 * 묶는 줄에 합치거나 새로 연다 — 구독마다. 열린 줄(`window_started_at`)이 있으면 잠그고 합친다 · 없으면 새 줄(창은 지금부터). 그 사이 다른
 * 쓰기가 연 줄과 부딪히면(부분 UNIQUE) 다음 판에 합치고 · 워커가 봉인했으면 다음 판에 새로 연다 — 세 판까지.
 */
async function upsertAggregated(tx: Pick<Tx, 'query'>, group: Group, subscriptions: readonly string[], data: Record<string, unknown>): Promise<void> {
  const eventId = randomUUID()
  let pending = subscriptions
  for (let round = 0; round < 3 && pending.length > 0; round += 1) {
    const open = await tx.query<{
      id: string
      subscription_id: string
      authors: unknown
      data: Record<string, unknown>
      window_started_at: Date
      occurred_at: Date
    }>(
      `SELECT id, subscription_id, authors, data, window_started_at, occurred_at FROM api_webhook_event
        WHERE subscription_id = ANY($1::uuid[]) AND entity_id = $2 AND type = $3 AND window_started_at IS NOT NULL
        ORDER BY subscription_id
        FOR UPDATE`,
      [pending, group.entity.id, group.type],
    )
    for (const row of open) {
      const last = row.occurred_at > group.lastAt ? row.occurred_at : group.lastAt
      await tx.query(
        `UPDATE api_webhook_event SET data = $2::jsonb, authors = $3::jsonb, occurred_at = $4, next_attempt_at = $5 WHERE id = $1`,
        [
          row.id,
          JSON.stringify(mergeAggregatedData(group.type, row.data, data)),
          JSON.stringify(mergeAuthors(row.authors, group.authors)),
          last,
          aggregateDueAt(row.window_started_at, last),
        ],
      )
    }
    const merged = new Set(open.map((r) => r.subscription_id))
    const rest = pending.filter((s) => !merged.has(s))
    if (rest.length === 0) return
    const opened = await tx.query<{ subscription_id: string }>(
      `INSERT INTO api_webhook_event (id, subscription_id, workspace_id, event_id, type, entity_id, entity_type, authors, data, occurred_at,
                                      status, next_attempt_at, window_started_at)
       SELECT gen_random_uuid(), s.id, s.workspace_id, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, 'pending', $9, $10
         FROM api_webhook_subscription s WHERE s.id = ANY($1::uuid[])
       ON CONFLICT (subscription_id, entity_id, type) WHERE window_started_at IS NOT NULL DO NOTHING
       RETURNING subscription_id`,
      [
        rest,
        eventId,
        group.type,
        group.entity.id,
        group.entity.type,
        JSON.stringify(group.authors),
        JSON.stringify(data),
        group.lastAt,
        aggregateDueAt(group.firstAt, group.lastAt),
        group.firstAt,
      ],
    )
    const got = new Set(opened.map((r) => r.subscription_id))
    pending = rest.filter((s) => !got.has(s))
  }
}

// ── 데이터 — 쓸 때 읽는다 ─────────────────────────────────────────────

type NodeRow = {
  type: string
  workspace_id: string
  parent_type: string
  parent_id: string
  parent_block_type: string | null
  is_template: boolean | null
}

async function readNode(tx: Pick<Tx, 'query'>, nodeId: string): Promise<NodeRow | null> {
  const rows = await tx.query<NodeRow>(
    `SELECT b.type::text AS type, b.workspace_id, b.parent_type::text AS parent_type, b.parent_id, pb.type::text AS parent_block_type, p.is_template
       FROM block b
       LEFT JOIN block pb ON b.parent_type = 'block' AND pb.id = b.parent_id
       LEFT JOIN page p ON p.id = b.id
      WHERE b.id = $1`,
    [nodeId],
  )
  return rows[0] ?? null
}

const parentOf = (row: NodeRow): WebhookParent =>
  webhookParentOf({ parentType: row.parent_type, parentId: row.parent_id, parentBlockType: row.parent_block_type, workspaceId: row.workspace_id })

/** 페이지 · 데이터베이스의 `{ parent }` — 템플릿 · 없는 노드면 null. */
const nodeData = (nodeId: string) => async (tx: Pick<Tx, 'query'>) => {
  const row = await readNode(tx, nodeId)
  return row === null || row.is_template === true ? null : { parent: parentOf(row) }
}

/** 데이터 소스의 `{ parent: 데이터베이스 }`. */
const sourceData = (dataSourceId: string) => async (tx: Pick<Tx, 'query'>) => {
  const rows = await tx.query<{ db: string }>(`SELECT owner_database_id AS db FROM data_source WHERE id = $1`, [dataSourceId])
  return rows[0] === undefined ? null : { parent: { id: rows[0].db, type: 'database' } satisfies WebhookParent }
}

// ── 명령의 목이 부르는 것 ─────────────────────────────────────────────

export type NodeChange = 'created' | 'moved' | 'deleted' | 'undeleted' | 'locked' | 'unlocked'

/**
 * 페이지 · 데이터베이스의 일 — `page.*` · `database.*`(데이터베이스에는 잠금 이벤트가 없다 — 노션). 데이터베이스의 행(페이지)이 생기거나
 * 휴지통에 가거나 돌아오면 그 데이터 소스의 `data_source.content_updated` 도 낸다. 템플릿은 내지 않는다.
 *
 * @param kind 아는 쪽이 준다 — 모르면 쓸 일이 있을 때만 행을 읽어 정한다
 */
export async function emitNodeEventIn(
  tx: Runner,
  actor: WebhookActor,
  change: NodeChange,
  nodeId: string,
  kind?: 'page' | 'database',
): Promise<void> {
  const rowChange = change === 'created' || change === 'deleted' || change === 'undeleted'
  const candidates = [
    ...(kind !== 'database' ? [`page.${change}`] : []),
    ...(kind !== 'page' && change !== 'locked' && change !== 'unlocked' ? [`database.${change}`] : []),
    ...(rowChange && kind !== 'database' ? ['data_source.content_updated'] : []),
  ]
  if (!(await wantsWebhookIn(tx, actor.workspaceId, candidates))) return
  const row = await readNode(tx, nodeId)
  if (row === null || row.is_template === true) return
  if (row.type !== 'page' && row.type !== 'database') return
  if (row.type === 'database' && (change === 'locked' || change === 'unlocked')) return
  await emitWebhookIn(tx, actor, { type: `${row.type}.${change}`, entity: { id: nodeId, type: row.type }, build: nodeData(nodeId) })
  if (rowChange && row.type === 'page' && row.parent_type === 'data_source') {
    await emitWebhookIn(tx, actor, rowsChanged(row.parent_id, [nodeId]))
  }
}

const rowsChanged = (dataSourceId: string, rowIds: readonly string[]): WebhookEmission => ({
  type: 'data_source.content_updated',
  entity: { id: dataSourceId, type: 'data_source' },
  build: sourceData(dataSourceId),
  items: rowIds.map((id): BlockRef => ({ id, type: 'block' })),
})

/** 본문이 바뀌었다 — `page.content_updated`(묶는다 · `updated_blocks` = 바뀐 블록). 템플릿은 내지 않는다. */
export async function emitBodyChangedIn(tx: Runner, actor: WebhookActor, pageId: string, blockIds: Iterable<string>): Promise<void> {
  if (!(await wantsWebhookIn(tx, actor.workspaceId, ['page.content_updated']))) return
  await emitWebhookIn(tx, actor, {
    type: 'page.content_updated',
    entity: { id: pageId, type: 'page' },
    build: nodeData(pageId),
    items: [...blockIds].map((id): BlockRef => ({ id, type: 'block' })),
  })
}

/**
 * 속성 값이 바뀌었다 — `page.properties_updated`(묶는다 · `updated_properties` = 공개 API 의 속성 id — 제목은 `title`). 행이면 그 데이터
 * 소스의 `data_source.content_updated` 도(행이 바뀌었다).
 */
export async function emitPropertiesChangedIn(
  tx: Runner,
  actor: WebhookActor,
  pageId: string,
  apiPropertyIds: readonly string[],
  row?: { readonly dataSourceId: string; readonly isTemplate: boolean },
): Promise<void> {
  if (row?.isTemplate === true) return
  const types = ['page.properties_updated', ...(row === undefined ? [] : ['data_source.content_updated'])]
  if (!(await wantsWebhookIn(tx, actor.workspaceId, types))) return
  await emitWebhookIn(tx, actor, {
    type: 'page.properties_updated',
    entity: { id: pageId, type: 'page' },
    build: nodeData(pageId),
    items: apiPropertyIds,
  })
  if (row !== undefined) await emitWebhookIn(tx, actor, rowsChanged(row.dataSourceId, [pageId]))
}

/** 행의 칸 하나가 바뀌었다(관계 · 검증 — 셀 명령 밖의 칸 쓰기) — 행의 소스는 쓸 일이 있을 때만 읽는다. 제목 속성이 아니다. */
export async function emitRowPropertyChangedIn(tx: Runner, actor: WebhookActor, rowId: string, propertyId: string): Promise<void> {
  if (!(await wantsWebhookIn(tx, actor.workspaceId, ['page.properties_updated', 'data_source.content_updated']))) return
  const rows = await tx.query<{ data_source_id: string; is_template: boolean }>(`SELECT data_source_id, is_template FROM page WHERE id = $1`, [rowId])
  if (rows[0] === undefined) return
  await emitPropertiesChangedIn(tx, actor, rowId, [propertyId], { dataSourceId: rows[0].data_source_id, isTemplate: rows[0].is_template })
}

/** 행 셀의 속성 id → 공개 API 의 속성 id(제목 속성은 `title` — `schema-object.ts` 와 같다). */
export function apiPropertyIdsOf(propertyIds: readonly string[], titlePropertyId: string | null): string[] {
  return propertyIds.map((id) => (id === titlePropertyId ? 'title' : id))
}

/** 데이터 소스의 구조가 바뀌었다 — `data_source.schema_updated`(묶는다 · `updated_properties` = `{ id, name, action }`). */
export async function emitSchemaChangedIn(
  tx: Runner,
  actor: WebhookActor,
  dataSourceId: string,
  changes: readonly { readonly propertyId: string; readonly action: SchemaAction }[],
): Promise<void> {
  if (!(await wantsWebhookIn(tx, actor.workspaceId, ['data_source.schema_updated']))) return
  const ids = [...new Set(changes.map((c) => c.propertyId))]
  const props =
    ids.length === 0
      ? []
      : await tx.query<{ id: string; name: string; type: string }>(
          `SELECT id, name, type::text AS type FROM property WHERE data_source_id = $1 AND id = ANY($2::text[])`,
          [dataSourceId, ids],
        )
  const byId = new Map(props.map((p) => [p.id, p]))
  const items: SchemaChange[] = changes.flatMap((c) => {
    const p = byId.get(c.propertyId)
    return p === undefined ? [] : [{ id: p.type === 'title' ? 'title' : p.id, name: p.name, action: c.action }]
  })
  await emitWebhookIn(tx, actor, {
    type: 'data_source.schema_updated',
    entity: { id: dataSourceId, type: 'data_source' },
    build: sourceData(dataSourceId),
    items,
  })
}

/** 데이터 소스의 일 — `data_source.created` · `deleted` · `undeleted`. */
export async function emitDataSourceEventIn(
  tx: Runner,
  actor: WebhookActor,
  change: 'created' | 'deleted' | 'undeleted',
  dataSourceId: string,
): Promise<void> {
  await emitWebhookIn(tx, actor, {
    type: `data_source.${change}`,
    entity: { id: dataSourceId, type: 'data_source' },
    build: sourceData(dataSourceId),
  })
}

/**
 * 댓글의 일 — `comment.created` · `updated` · `deleted`(묶지 않는다 — 노션). `data` 는 `{ page_id, parent }` — 부모는 그 페이지 또는 본문
 * 블록. 지운 마지막 댓글은 스레드째 사라지므로 자리는 부르는 쪽이 준다(쓸 때 읽지 않는다).
 */
export async function emitCommentEventIn(
  tx: Runner,
  actor: WebhookActor,
  change: 'created' | 'updated' | 'deleted',
  comment: { readonly id: string; readonly pageId: string; readonly blockId: string },
): Promise<void> {
  const parent: WebhookParent = comment.blockId === comment.pageId ? { id: comment.pageId, type: 'page' } : { id: comment.blockId, type: 'block' }
  await emitWebhookIn(tx, actor, {
    type: `comment.${change}`,
    entity: { id: comment.id, type: 'comment' },
    build: async () => ({ page_id: comment.pageId, parent }),
  })
}
