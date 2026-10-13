/**
 * 공개 폼의 문구 — 제출 실패의 한 줄 (인접 제품 7a-2b · F-13-02 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ⑥ⓒ ⑦
 *
 * 값이 틀린 것(`invalid_value`)은 질문마다 그 칸 아래에 서버의 까닭을 그대로 쓴다 — 여기는 그 밖의 한 줄이다. 모르는 까닭은 일반 문구다.
 */

const FAILURE: Readonly<Record<string, string>> = {
  invalid_value: '답을 확인해 주세요.',
  too_fast: '조금 뒤에 다시 제출해 주세요.',
  expired: '화면이 오래되었습니다. 새로 고친 뒤 다시 제출해 주세요(입력한 내용은 복사해 두세요).',
  invalid_token: '화면을 새로 고친 뒤 다시 제출해 주세요.',
  rate_limited: '제출이 너무 잦습니다. 잠시 뒤에 다시 시도해 주세요.',
  not_found: '이 폼은 더 이상 응답을 받지 않습니다.',
  bad_origin: '이 화면에서 제출해 주세요.',
  form_closed: '이 폼은 응답을 마감했습니다.',
  already_submitted: '이미 응답했습니다. 이 폼은 한 사람당 한 번만 받습니다.',
}

export function formFailureMessage(reason: unknown): string {
  // 자기 칸만 — `FAILURE['constructor']` 는 객체 원형의 함수다
  return typeof reason === 'string' && Object.hasOwn(FAILURE, reason) ? FAILURE[reason]! : '제출하지 못했습니다. 다시 시도해 주세요.'
}

/** 필수 질문의 표시 — 화면이 제목 옆에 붙인다(읽는 기계에는 `aria-required`). */
export const REQUIRED_MARK = '*'

/** 확인 화면의 "내 응답 보기" — 응답자가 그 행을 받았을 때만(7b-4 · 정본 ⑫). */
export const MY_RESPONSE = '내 응답 보기'

/** 받은 주소가 이 앱의 행 화면인가 — 서버가 준 것만 링크로 세운다(다른 곳으로 보내지 않는다). */
export function responsePathOf(raw: unknown): string | null {
  return typeof raw === 'string' && /^\/w\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(raw) ? raw : null
}

/** 확인 화면의 "다른 응답" — 새 화면(새 제출 토큰). */
export const ANOTHER_RESPONSE = '다른 응답 제출'

/** 워크스페이스 멤버만의 폼(7b-1) — 응답자를 남긴다고 미리 말한다(공개 폼은 익명이라 없다). */
export function respondentNote(name: string): string {
  return `응답자: ${name || '나'} — 응답에 이름이 남습니다.`
}

/** 워크스페이스 멤버만의 폼에 로그인하지 않고 왔다 — 폼의 제목도 싣지 않는다(워크스페이스 안의 이름이다 · 정본 ⑨). */
export const WORKSPACE_FORM_LOGIN = '이 폼은 워크스페이스 멤버만 응답할 수 있습니다. 로그인한 뒤 다시 열어 주세요.'

/** 닫힌 폼(7b-2 — 응답 상한 · 마감 시각)의 화면 — 404 가 아니라 마감했다고 말한다(정본 ⑩). */
export const FORM_CLOSED = '이 폼은 응답을 마감했습니다.'

/** 한 사람당 한 번인 폼(7b-3)에 이미 낸 멤버의 화면 — 폼 대신(정본 ⑪). */
export const ALREADY_RESPONDED = '이미 응답했습니다. 이 폼은 한 사람당 한 번만 받습니다.'
