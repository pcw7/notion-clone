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
