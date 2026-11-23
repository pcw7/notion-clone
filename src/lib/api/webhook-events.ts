/**
 * 공개 API 웹훅의 이벤트 카탈로그 (API-8 · F-09-09 · 순수 — 브라우저 묶음에도 들어간다)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫ · 마이그레이션 0151 `ck_api_webhook_event_types` · `ck_api_webhook_event_type`
 *       09-api-integrations.md F-09-09 *"이벤트 타입 전량"*
 *
 * 노션의 이름 그대로(2025-09-03 — 데이터 소스 판). 고를 수 있는 것은 아래 21개 — **내보내는 것은 API-9** 다(이 조각은 구독 · 서명 ·
 * 배달 · `test` 까지). 노션이 deprecated 로 둔 `database.content_updated` · `database.schema_updated` 는 처음부터 `data_source.*` 로 낸다.
 * 문서가 어긋나는 `file_upload.*` · `view.*` 는 넣지 않는다. `test` 는 노션에 없다 — "테스트 보내기" 만 내고 고를 수 없다.
 * 목록을 바꾸면 마이그레이션의 두 CHECK 도 함께 바꾼다.
 */

export type WebhookEventFamily = 'page' | 'database' | 'data_source' | 'comment'

export type WebhookEventDef = {
  readonly type: string
  readonly family: WebhookEventFamily
  /** 화면의 말. */
  readonly label: string
  /** 이 이벤트를 내보내는 조각 — 지금은 모두 API-9. */
  readonly emitter: 'API-9'
}

const def = (type: string, family: WebhookEventFamily, label: string): WebhookEventDef => ({ type, family, label, emitter: 'API-9' })

export const WEBHOOK_EVENTS: readonly WebhookEventDef[] = [
  def('page.created', 'page', '만들어짐'),
  def('page.properties_updated', 'page', '속성이 바뀜'),
  def('page.content_updated', 'page', '본문이 바뀜'),
  def('page.moved', 'page', '옮겨짐'),
  def('page.deleted', 'page', '휴지통으로'),
  def('page.undeleted', 'page', '되살림'),
  def('page.locked', 'page', '잠김'),
  def('page.unlocked', 'page', '잠금 풀림'),
  def('database.created', 'database', '만들어짐'),
  def('database.moved', 'database', '옮겨짐'),
  def('database.deleted', 'database', '휴지통으로'),
  def('database.undeleted', 'database', '되살림'),
  def('data_source.created', 'data_source', '만들어짐'),
  def('data_source.content_updated', 'data_source', '행이 바뀜'),
  def('data_source.moved', 'data_source', '옮겨짐'),
  def('data_source.deleted', 'data_source', '휴지통으로'),
  def('data_source.undeleted', 'data_source', '되살림'),
  def('data_source.schema_updated', 'data_source', '구조가 바뀜'),
  def('comment.created', 'comment', '달림'),
  def('comment.updated', 'comment', '고쳐짐'),
  def('comment.deleted', 'comment', '지워짐'),
]

export const WEBHOOK_EVENT_TYPES: readonly string[] = WEBHOOK_EVENTS.map((e) => e.type)

/** "테스트 보내기" 의 이벤트 — 노션에 없다 · 고를 수 없다 · 대상은 구독 자신(`webhook_subscription`). */
export const TEST_EVENT_TYPE = 'test'

export const WEBHOOK_FAMILY_LABEL: Readonly<Record<WebhookEventFamily, string>> = {
  page: '페이지',
  database: '데이터베이스',
  data_source: '데이터 소스',
  comment: '댓글',
}

export const WEBHOOK_FAMILIES: readonly WebhookEventFamily[] = ['page', 'database', 'data_source', 'comment']

const KNOWN = new Set(WEBHOOK_EVENT_TYPES)

export function isWebhookEventType(value: unknown): value is string {
  return typeof value === 'string' && KNOWN.has(value)
}

/** 고른 이벤트 — 배열 · 카탈로그의 것만 · 하나 이상. 겹침은 하나로 · 카탈로그 차례로 둔다. 아니면 null. */
export function parseEventTypes(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) return null
  if (!input.every(isWebhookEventType)) return null
  const chosen = new Set(input)
  return WEBHOOK_EVENT_TYPES.filter((t) => chosen.has(t))
}

/** 이벤트 종류의 화면 말 — `페이지 · 만들어짐`. 모르는 것은 그대로. */
export function webhookEventLabel(type: string): string {
  if (type === TEST_EVENT_TYPE) return '테스트'
  const found = WEBHOOK_EVENTS.find((e) => e.type === type)
  return found === undefined ? type : `${WEBHOOK_FAMILY_LABEL[found.family]} · ${found.label}`
}
