/**
 * 폼의 응답 상한 · 마감 시각 — 받는 값의 규칙과 닫힘 판정 (인접 제품 7b-2 · F-13-02 · F-17-10 계층 7 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ⑩
 *
 * **닫힘은 판정이다** — 상한에 닿거나 마감 시각이 지나면 받지 않되 `access` 는 그대로다(상한을 올리거나 시각을 미루면 다시 받는다). 명령 ·
 * 공개 읽기 · 제출 · 편집 화면이 이 판정 하나를 쓴다.
 */

/** 응답 상한의 범위 — 0100 의 CHECK 과 같다. */
export const MAX_RESPONSES_LIMIT = 100_000

/** 닫힌 까닭 — 상한에 닿았다 · 마감 시각이 지났다. 열려 있으면 null. */
export type FormClosedReason = 'limit' | 'time'

/**
 * 닫혔는가 — 마감 시각이 먼저다(시각이 지났으면 상한과 상관없이 닫혔다). `responseCount` 는 이 폼으로 받은 살아 있는 응답의 수.
 */
export function formClosedReason(
  limits: { readonly maxResponses: number | null; readonly closesAt: string | null },
  responseCount: number,
  now: number = Date.now(),
): FormClosedReason | null {
  if (limits.closesAt !== null && Date.parse(limits.closesAt) <= now) return 'time'
  if (limits.maxResponses !== null && responseCount >= limits.maxResponses) return 'limit'
  return null
}

/** 받은 응답 상한 — null 은 없음 · 1~100,000 의 정수만. 틀리면 undefined. */
export function parseMaxResponses(raw: unknown): number | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > MAX_RESPONSES_LIMIT) return undefined
  return raw
}

/** 받은 마감 시각 — null 은 없음 · 시간대가 붙은 ISO 날짜 시각만(브라우저가 자기 시간대로 바꿔 보낸다). 틀리면 undefined. */
export function parseClosesAt(raw: unknown): string | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'string' || raw.length > 40) return undefined
  // 시간대가 없으면 어느 시각인지 모른다 — 서버의 시간대로 읽지 않는다
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) return undefined
  const at = Date.parse(raw)
  return Number.isNaN(at) ? undefined : new Date(at).toISOString()
}
