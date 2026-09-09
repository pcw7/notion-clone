/**
 * 커서 페이지네이션 봉투 — F-09-04
 *
 * 정본: docs/research/09-api-integrations.md F-09-04
 *
 * 로드맵 W2: "이 주에 고친 계약은 이후 못 고친다."
 *
 * **가장 중요한 사실**: "커서가 끝날 때까지 돌면 전부 읽힌다"는 가정은 **틀렸다.**
 * 한 쿼리당 10,000행 상한이 있고, 넘어가면 `has_more` 가 아니라
 * `request_status.type='incomplete'` 로 끊긴다. 봉투에 이 필드가 없으면
 * 호출자는 "다 읽었다"고 착각한 채 데이터를 잃는다.
 */

/** 기본 100, 최대 100. */
export const DEFAULT_PAGE_SIZE = 100
export const MAX_PAGE_SIZE = 100

/** 한 쿼리가 커서로 순회할 수 있는 절대 상한. */
export const MAX_QUERY_ROWS = 10_000

export type IncompleteReason = 'query_result_limit_reached'

export type RequestStatus =
  | { type: 'complete' }
  | { type: 'incomplete'; incomplete_reason: IncompleteReason }

export type ListEnvelope<T> = {
  object: 'list'
  results: T[]
  has_more: boolean
  /** 불투명 토큰. 마지막 페이지에서는 null. */
  next_cursor: string | null
  /**
   * 커서 순회가 상한에 걸려 끊겼는지.
   *
   * `has_more:false` 만 보고 "끝까지 읽었다"고 판단하면 안 된다 —
   * 10,000행 상한에 걸린 경우도 `has_more:false` 다.
   */
  request_status: RequestStatus
}

export const COMPLETE: RequestStatus = Object.freeze({ type: 'complete' })

export function incomplete(reason: IncompleteReason): RequestStatus {
  return { type: 'incomplete', incomplete_reason: reason }
}

/** 정상 응답 봉투. */
export function listEnvelope<T>(
  results: T[],
  opts: { nextCursor?: string | null; status?: RequestStatus } = {},
): ListEnvelope<T> {
  const nextCursor = opts.nextCursor ?? null
  return {
    object: 'list',
    results,
    has_more: nextCursor !== null,
    next_cursor: nextCursor,
    request_status: opts.status ?? COMPLETE,
  }
}

/**
 * 호출자가 "전부 읽었는가"를 판단하는 **유일한 올바른 방법.**
 *
 * `!has_more` 만으로 판단하면 10,000행 상한에 걸린 경우를 완주로 오인한다.
 */
export function isFullyRead(env: ListEnvelope<unknown>): boolean {
  return !env.has_more && env.request_status.type === 'complete'
}

/** page_size 파라미터 정규화. 범위를 넘으면 잘라낸다(400 을 내지 않는다). */
export function normalizePageSize(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_SIZE
  return Math.min(Math.floor(n), MAX_PAGE_SIZE)
}

// ── 커서 ──────────────────────────────────────────────────────────────
//
// 커서는 **불투명**해야 한다. 내부 구조가 드러나면 클라이언트가 그것에 기대게
// 되고, 나중에 정렬 키를 바꿀 수 없다.
//
// keyset 방식이다(OFFSET 아님). OFFSET 은 뒤 페이지로 갈수록 느려지고,
// 순회 중 삽입이 일어나면 항목을 건너뛴다.

export type Cursor = {
  /** 마지막으로 돌려준 행의 정렬 키. */
  readonly sortKey: string
  /** 동률 분해용. block 은 order_key 가 같을 수 있다(B7). */
  readonly id: string
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.sortKey, cursor.id]), 'utf8').toString('base64url')
}

export function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [sortKey, id] = parsed
    if (typeof sortKey !== 'string' || typeof id !== 'string') return null
    return { sortKey, id }
  } catch {
    // 손상된 커서는 던지지 않고 null 을 준다. 호출자가 처음부터 다시 읽으면 된다.
    return null
  }
}
