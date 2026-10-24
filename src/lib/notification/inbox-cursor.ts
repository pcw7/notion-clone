/**
 * 인박스 커서 — 무한 스크롤의 "여기부터"(§7 정리 10n-69 · F-11-07 · 11 *"패널 … 무한 스크롤"*)
 *
 * 정본: HANDOFF §3.2-302
 *
 * 인박스의 한 줄은 묶음(N2 — `group_key` · 페이지)이고 차례는 묶음의 **마지막 알림 시각**이 새 것부터다. 커서는 지난 쪽의 마지막 줄 —
 * `(마지막 시각, group_key, page_id)` — 이고 다음 쪽은 그보다 뒤(작은) 줄이다. 시각이 같은 줄은 `group_key` · `page_id` 가 가른다.
 *
 * **시각은 DB 가 준 글자 그대로 싣는다.** `timestamptz` 는 마이크로초까지 있고 JS `Date` 는 밀리초까지다 — `Date` 로 실으면 같은 밀리초 안의
 * 더 이른 줄이 커서보다 "크다"고 판정돼 건너뛰어진다. 글자는 `::timestamptz` 로 되읽으면 그대로다.
 *
 * 밖으로는 불투명한 글자(base64url JSON)다 — 화면은 받은 것을 되돌려 보낼 뿐이다. 망가진 커서는 null(처음부터가 아니라 거절 — 라우트가 400).
 */

export type InboxCursor = {
  /** 묶음의 마지막 알림 시각 — DB 의 `timestamptz::text` 그대로(머리말). */
  readonly at: string
  readonly groupKey: string
  readonly pageId: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** `timestamptz::text`(DateStyle ISO)의 모양 — 날짜 · 시각 · 소수(선택) · 오프셋. 되읽기 전에 모양부터 본다. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2}){0,2}$/

/** 커서를 글자로 — 다음 쪽 요청이 그대로 되돌려 보낸다. */
export function encodeInboxCursor(cursor: InboxCursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.groupKey, cursor.pageId]), 'utf8').toString('base64url')
}

/** 글자를 커서로 — 모양이 틀리면 null. */
export function decodeInboxCursor(raw: string): InboxCursor | null {
  if (raw.length === 0 || raw.length > 1024) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) return null
  const [at, groupKey, pageId] = parsed as unknown[]
  if (typeof at !== 'string' || !TIMESTAMP.test(at)) return null
  if (typeof groupKey !== 'string' || groupKey.length === 0 || groupKey.length > 512) return null
  if (typeof pageId !== 'string' || !UUID.test(pageId)) return null
  return { at, groupKey, pageId }
}
