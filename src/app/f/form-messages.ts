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
}

export function formFailureMessage(reason: unknown): string {
  // 자기 칸만 — `FAILURE['constructor']` 는 객체 원형의 함수다
  return typeof reason === 'string' && Object.hasOwn(FAILURE, reason) ? FAILURE[reason]! : '제출하지 못했습니다. 다시 시도해 주세요.'
}

/** 필수 질문의 표시 — 화면이 제목 옆에 붙인다(읽는 기계에는 `aria-required`). */
export const REQUIRED_MARK = '*'

/** 확인 화면의 "다른 응답" — 새 화면(새 제출 토큰). */
export const ANOTHER_RESPONSE = '다른 응답 제출'
