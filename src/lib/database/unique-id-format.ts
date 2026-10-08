/**
 * 고유 ID 의 모양 — 접두사 다듬기 · 표시 문자열 (F-03-09 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 고유 ID ⑥ ⑦
 *
 * 화면(속성 편집 · 칸)과 서버(명령)가 **같은 함수**로 다듬고 그린다 — 두 벌이면 화면이 받은 접두사를 서버가 거부하거나, 표와 행
 * 페이지가 다른 모양을 그린다. 그래서 `db/tx.ts` 를 끌어오지 않는 이 파일에 둔다(`view-columns.ts` 머리말의 경계).
 */

/** 저장되는 접두사의 모양(마이그레이션 0050 `ck_data_source_unique_id_prefix` 와 같은 식). */
export const UNIQUE_ID_PREFIX_PATTERN = /^[A-Z0-9]{2,7}$/

export type PrefixInput = { readonly ok: true; readonly prefix: string | null } | { readonly ok: false }

/**
 * 사람이 넣은 접두사를 저장할 모양으로 다듬는다.
 *
 * 대소문자를 가리지 않고 받아 **대문자로** 바꾼다(03: *"대소문자를 구분하지 않고 항상 대문자로 표시"*). 앞뒤 공백은 걷는다.
 * `null` · 빈 문자열은 "접두사 없음"이다. 그 밖에 영숫자 2~7자가 아니면 거부한다 — 고쳐 주지 않는다(`TA-SK` 를 `TASK` 로
 * 바꾸면 사람이 뜻하지 않은 접두사가 생긴다).
 */
export function normalizeUniqueIdPrefix(raw: unknown): PrefixInput {
  if (raw === null) return { ok: true, prefix: null }
  if (typeof raw !== 'string') return { ok: false }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: true, prefix: null }
  const upper = trimmed.toUpperCase()
  return UNIQUE_ID_PREFIX_PATTERN.test(upper) ? { ok: true, prefix: upper } : { ok: false }
}

/**
 * 필터 값 칸에 친 글자 → 번호. `12` 도, 화면에 보이는 그대로 `TASK-12` 도 받는다(접두사는 표 전체에 하나라 거를 뜻이 없다 —
 * 떼고 번호만 본다). 0 이상의 정수가 아니면 null — 칸이 그 값을 받지 않는다.
 */
export function parseUniqueIdQuery(text: string): number | null {
  const match = /^(?:[A-Za-z0-9]+-)?(\d{1,15})$/.exec(text.trim())
  return match === null ? null : Number(match[1])
}

/**
 * 내보내기가 행의 ID 칸에 싣는 값(2a-2b). 노션 API 의 프로퍼티 값과 같은 모양이다(`{"type":"unique_id","unique_id":{"prefix","number"}}`).
 *
 * 셀이 아니다(C1 — `page_property_value` 에 이 모양은 없다). 내보내기의 스냅숏이 행을 읽을 때 `page.unique_seq` 와 data source 의 접두사로
 * 만들어 그 행의 칸 묶음에 끼운다 — CSV 와 행 Markdown 이 **같은 함수**(`cellPlainText`)로 쓰게 하려고.
 */
export type UniqueIdCell = {
  readonly type: 'unique_id'
  readonly unique_id: { readonly prefix: string | null; readonly number: number }
}

export function uniqueIdCell(prefix: string | null, seq: number): UniqueIdCell {
  return { type: 'unique_id', unique_id: { prefix, number: seq } }
}

/** 칸 → 표시 문자열. 모양이 아니면(번호가 없던 행 · 손상) 빈 문자열. */
export function uniqueIdCellText(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) return ''
  const value = (raw as { type?: unknown; unique_id?: { prefix?: unknown; number?: unknown } }).unique_id
  if ((raw as { type?: unknown }).type !== 'unique_id' || typeof value !== 'object' || value === null) return ''
  if (typeof value.number !== 'number' || !Number.isSafeInteger(value.number) || value.number < 1) return ''
  return formatUniqueId(typeof value.prefix === 'string' ? value.prefix : null, value.number)
}

/** 표시 문자열 — `접두사-번호`, 접두사가 없으면 번호만. 번호가 없으면(템플릿) 빈 문자열. */
export function formatUniqueId(prefix: string | null, seq: number | null): string {
  if (seq === null) return ''
  return prefix === null ? String(seq) : `${prefix}-${seq}`
}
