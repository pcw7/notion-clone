/**
 * 폼 편집 화면의 문구 — 데이터베이스의 폼 탭 (인접 제품 7a-3 · F-13-01 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ③⑧⑨
 *
 * 서버의 실패 까닭(`FormFailure` · 라우트의 `invalid_input`)을 사람의 말로 · 공개 주소의 모양.
 */

const FAILURE: Readonly<Record<string, string>> = {
  not_found: '이 폼을 찾을 수 없습니다. 그사이 지워졌을 수 있습니다.',
  forbidden: '이 폼을 고칠 권한이 없습니다. 공개 · 닫기는 전체 권한이 있어야 합니다.',
  locked: '데이터베이스가 잠겨 있어 고칠 수 없습니다.',
  invalid_input: '값을 확인하세요(길이 · 같은 질문 두 번).',
  unsupported_type: '질문으로 받을 수 없는 속성입니다.',
  policy_disabled: '워크스페이스 정책이 웹 공개를 막았습니다.',
}

export function formEditorFailureMessage(reason: unknown): string {
  // 자기 칸만 — `FAILURE['constructor']` 는 객체 원형의 함수다
  return typeof reason === 'string' && Object.hasOwn(FAILURE, reason) ? FAILURE[reason]! : '저장하지 못했습니다.'
}

/** 공개 폼의 주소 — 이 앱의 주소 위에(`/f/{폼 토큰}`). */
export function formUrlOf(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/f/${token}`
}

/** 공유 절의 설명 — 무엇이 열리는지 먼저 말한다(웹 게시와 같은 태도). */
export const FORM_PUBLIC_HINT = '웹에 공개하면 주소를 아는 누구나 로그인 없이 답할 수 있습니다. 응답은 이 데이터베이스의 행으로 쌓입니다.'

/** 질문이 하나도 없을 때. */
export const NO_QUESTIONS = '질문이 없습니다. 아래에서 속성을 골라 질문으로 더하세요.'

/** 공유의 셋(7b-1 · 정본 ⑨) — 고르는 순서 · 이름 · 무엇이 열리는지. */
export const FORM_ACCESS_OPTIONS = [
  { access: 'closed', label: '닫힘', hint: '응답을 받지 않습니다. 주소는 남아 다시 열면 같은 주소입니다.' },
  { access: 'workspace', label: '워크스페이스 멤버만', hint: '로그인한 이 워크스페이스의 멤버가 주소로 답합니다. 응답에 이름이 남습니다(게스트는 답할 수 없습니다).' },
  { access: 'public', label: '웹 공개', hint: FORM_PUBLIC_HINT },
] as const

export type FormAccessChoice = (typeof FORM_ACCESS_OPTIONS)[number]['access']

/** 바꾼 뒤의 한 줄. */
export function formAccessNotice(access: FormAccessChoice): string {
  if (access === 'closed') return '폼을 닫았습니다. 그 주소로는 응답을 받지 않습니다.'
  return access === 'workspace' ? '워크스페이스 멤버만 답할 수 있게 열었습니다.' : '폼을 웹에 공개했습니다.'
}

/** 바꿀 수 없는 사람에게 보이는 지금의 상태 — 닫혔으면 말하지 않는다. */
export function formAccessState(access: FormAccessChoice): string | null {
  if (access === 'closed') return null
  return access === 'workspace' ? '이 폼은 워크스페이스 멤버에게 열려 있습니다.' : '이 폼은 웹에 공개되어 있습니다.'
}

// ── 응답 받기(7b-2 · 정본 ⑩) ──────────────────────────────────────────

/** 받은 수 — 상한이 있으면 함께. 예: `받은 응답 3개 / 상한 10개` */
export function responseCountText(count: number, max: number | null): string {
  return `받은 응답 ${count}개${max === null ? '' : ` / 상한 ${max}개`}`
}

/** 한 사람당 한 번(7b-3 · 정본 ⑪)의 칸. */
export const ONE_PER_RESPONDENT_LABEL = '한 사람당 한 번만 받기'

/** 켰을 때의 한 줄 — 막는 것은 워크스페이스 멤버만의 폼뿐이다(웹 공개 폼은 응답자를 모른다). */
export function onePerRespondentNote(access: FormAccessChoice): string {
  return access === 'workspace'
    ? '이미 응답한 멤버에게는 폼 대신 "이미 응답했습니다" 가 보입니다. 그 응답을 지우면 다시 낼 수 있습니다.'
    : '워크스페이스 멤버만의 폼에서만 막습니다 — 웹 공개 폼은 누가 냈는지 알 수 없습니다.'
}

/** 닫힌 까닭 — 무엇을 고치면 다시 받는지까지. */
export function closedBecauseText(reason: 'limit' | 'time'): string {
  return reason === 'limit'
    ? '응답 상한에 닿아 받지 않습니다 — 상한을 올리거나 지우면 다시 받습니다.'
    : '마감 시각이 지나 받지 않습니다 — 시각을 미루거나 지우면 다시 받습니다.'
}

/** 상한 칸의 글 → 보낼 값. 비면 null(없음) · 1~100,000 의 정수가 아니면 undefined(틀렸다 — 서버와 같은 범위). */
export function limitOfDraft(text: string | null): number | null | undefined {
  if (text === null || text.trim() === '') return null
  const n = Number(text.trim())
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : undefined
}

/** ISO 시각 → `datetime-local` 칸의 값(이 브라우저의 시간대). 비면 빈 글. */
export function localDateTimeOf(iso: string | null): string {
  if (iso === null) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** `datetime-local` 칸의 값 → 보낼 ISO 시각(이 브라우저의 시간대로 읽는다 · 시간대를 붙인다). 비면 null · 틀리면 undefined. */
export function isoOfLocalDateTime(local: string): string | null | undefined {
  if (local.trim() === '') return null
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return undefined
  const at = new Date(local)
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString()
}
