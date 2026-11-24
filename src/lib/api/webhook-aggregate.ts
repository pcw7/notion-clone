/**
 * 공개 API 웹훅 이벤트의 모양과 묶기(aggregation) 규칙 (API-9 · F-09-09 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑬ · 마이그레이션 0152 `ck_api_webhook_event_window*`
 *       09-api-integrations.md F-09-09 *"집계는 (subscription_id, entity_id, type) 키의 debounce 윈도우"*
 *
 * 묶는 종류는 넷 — "바뀌었다" 류(본문 · 속성 · 행 · 구조). 한 구독 · 한 대상 · 한 종류의 줄 하나에 **마지막 변경 뒤 15초** 동안 모은다.
 * 잇달아 고쳐도 **창을 연 뒤 2분**이면 나간다(상한). 합칠 때 목록(`updated_blocks` · `updated_properties`)은 처음 나온 차례를 지키고
 * 겹침은 하나로 · 100 까지 · 저자는 합집합(20 까지). 나머지 종류(만들기 · 옮기기 · 휴지통 · 잠금 · 댓글)는 일어난 대로 하나씩 나간다.
 */

/** 마지막 변경 뒤 이만큼 조용하면 보낸다. */
export const AGGREGATE_QUIET_MS = 15_000
/** 창을 연 뒤 이만큼이면 잇달아 고쳐도 보낸다 — 마이그레이션 0152 `ck_api_webhook_event_window_cap` 과 같다. */
export const AGGREGATE_MAX_MS = 120_000
/** 합친 목록의 상한 — 넘는 것은 버린다(받는 쪽은 어차피 다시 읽는다 · thin payload). */
export const AGGREGATE_LIST_MAX = 100
/** 저자 목록의 상한. */
export const AGGREGATE_AUTHORS_MAX = 20

export const AGGREGATED_EVENT_TYPES = [
  'page.content_updated',
  'page.properties_updated',
  'data_source.content_updated',
  'data_source.schema_updated',
] as const
export type AggregatedEventType = (typeof AGGREGATED_EVENT_TYPES)[number]

const AGGREGATED = new Set<string>(AGGREGATED_EVENT_TYPES)

export function isAggregatedType(type: string): type is AggregatedEventType {
  return AGGREGATED.has(type)
}

/** 묶는 종류가 합치는 목록의 키(노션의 이름). */
export const AGGREGATED_LIST_KEY: Readonly<Record<AggregatedEventType, 'updated_blocks' | 'updated_properties'>> = {
  'page.content_updated': 'updated_blocks',
  'page.properties_updated': 'updated_properties',
  'data_source.content_updated': 'updated_blocks',
  'data_source.schema_updated': 'updated_properties',
}

/** 다음 시도 시각 — 마지막 변경 + 15초, 단 창을 연 뒤 2분을 넘지 않는다. */
export function aggregateDueAt(windowStartedAt: Date, lastChangeAt: Date): Date {
  const quiet = Math.max(lastChangeAt.getTime(), windowStartedAt.getTime()) + AGGREGATE_QUIET_MS
  return new Date(Math.min(quiet, windowStartedAt.getTime() + AGGREGATE_MAX_MS))
}

// ── 목록 ──────────────────────────────────────────────────────────────

export type BlockRef = { readonly id: string; readonly type: 'block' }
export type SchemaAction = 'created' | 'updated' | 'deleted'
export type SchemaChange = { readonly id: string; readonly name: string; readonly action: SchemaAction }

/** 겹침을 가리는 키 — 글자면 그 글자 · `{ id }` 면 id. 모양이 아니면 null(버린다). */
function keyOf(item: unknown): string | null {
  if (typeof item === 'string') return item
  if (typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string') return (item as { id: string }).id
  return null
}

/** 목록 합치기 — 앞의 것의 차례를 지키고 겹침은 하나로(먼저 나온 것) · `max` 까지. */
export function mergeIdList<T>(prev: readonly unknown[], next: readonly T[], max: number = AGGREGATE_LIST_MAX): T[] {
  const out: T[] = []
  const seen = new Set<string>()
  for (const item of [...prev, ...next]) {
    if (out.length >= max) break
    const key = keyOf(item)
    if (key === null || seen.has(key)) continue
    seen.add(key)
    out.push(item as T)
  }
  return out
}

/**
 * 구조 변경 합치기 — 속성마다 한 줄(처음 나온 자리) · 이름은 나중 것. 동작은 "가장 의미 있는 결과"(노션):
 * 만들고 고치면 `created` · 무엇이든 지우면 `deleted` · 지우고 되살리면 `updated` · 그 밖은 나중 것.
 */
export function mergeSchemaChanges(prev: readonly unknown[], next: readonly SchemaChange[], max: number = AGGREGATE_LIST_MAX): SchemaChange[] {
  const out = new Map<string, SchemaChange>()
  const isChange = (v: unknown): v is SchemaChange =>
    typeof v === 'object' && v !== null && typeof (v as SchemaChange).id === 'string' && typeof (v as SchemaChange).name === 'string'
    && ['created', 'updated', 'deleted'].includes((v as SchemaChange).action)
  for (const item of [...prev, ...next]) {
    if (!isChange(item)) continue
    const before = out.get(item.id)
    if (before === undefined) {
      if (out.size >= max) continue
      out.set(item.id, { id: item.id, name: item.name, action: item.action })
      continue
    }
    const action: SchemaAction =
      item.action === 'deleted' ? 'deleted'
      : before.action === 'created' ? 'created'
      : before.action === 'deleted' && item.action === 'created' ? 'updated'
      : item.action
    out.set(item.id, { id: item.id, name: item.name, action })
  }
  return [...out.values()]
}

export type AuthorRef = { readonly id: string; readonly type: 'person' }

/** 저자 합집합 — 앞의 차례 · `AGGREGATE_AUTHORS_MAX` 까지. */
export function mergeAuthors(prev: unknown, next: readonly AuthorRef[]): AuthorRef[] {
  const before = Array.isArray(prev) ? prev.filter((a): a is AuthorRef => keyOf(a) !== null) : []
  return mergeIdList<AuthorRef>(before, next, AGGREGATE_AUTHORS_MAX)
}

/**
 * 묶는 줄의 `data` 합치기 — 목록 밖의 칸(`parent` …)은 나중 것 · 목록은 위 규칙. 목록이 아닌 값이 와도 빈 목록으로 본다.
 */
export function mergeAggregatedData(
  type: AggregatedEventType,
  prev: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const key = AGGREGATED_LIST_KEY[type]
  const listOf = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : [])
  const merged =
    type === 'data_source.schema_updated'
      ? mergeSchemaChanges(listOf(prev[key]), listOf(next[key]) as readonly SchemaChange[])
      : mergeIdList(listOf(prev[key]), listOf(next[key]))
  return { ...prev, ...next, [key]: merged }
}

// ── 부모 ──────────────────────────────────────────────────────────────

/** 노션 웹훅의 `data.parent` — `{ id, type }`. 워크스페이스 · teamspace 최상위는 `space`(id = 워크스페이스). */
export type WebhookParent = { readonly id: string; readonly type: 'page' | 'database' | 'data_source' | 'block' | 'space' }

/** 블록 행의 부모 → 웹훅의 부모. 행(데이터베이스의 페이지)의 부모는 데이터 소스다(2025-09-03 판). */
export function webhookParentOf(row: {
  readonly parentType: string
  readonly parentId: string
  readonly parentBlockType: string | null
  readonly workspaceId: string
}): WebhookParent {
  if (row.parentType === 'data_source') return { id: row.parentId, type: 'data_source' }
  if (row.parentType === 'block') {
    if (row.parentBlockType === 'page') return { id: row.parentId, type: 'page' }
    if (row.parentBlockType === 'database') return { id: row.parentId, type: 'database' }
    return { id: row.parentId, type: 'block' }
  }
  return { id: row.workspaceId, type: 'space' }
}
