/**
 * 폼 편집 화면의 문구 — 데이터베이스의 폼 탭 (인접 제품 7a-3 · F-13-01 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ③⑧
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
