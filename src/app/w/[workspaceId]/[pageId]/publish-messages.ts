/**
 * 웹 게시 절의 문구 — 공유 패널 (게시 · 공유 6a-3 · F-06-08 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [정정] 웹 게시 · [보강] 공개 화면
 *
 * 서버의 실패 까닭(`PublishFailure`)을 사람의 말로. 모르는 까닭은 일반 문구다.
 */

const FAILURE: Readonly<Record<string, string>> = {
  not_found: '이 페이지를 찾을 수 없습니다.',
  forbidden: '전체 권한이 있어야 웹에 게시할 수 있습니다.',
  not_page: '페이지만 웹에 게시할 수 있습니다.',
  trashed: '휴지통의 페이지는 게시할 수 없습니다.',
  policy_disabled: '워크스페이스 정책이 웹 게시를 막았습니다.',
  not_published: '게시되어 있지 않습니다.',
  invalid_input: '바꾸지 못했습니다.',
}

export function publishFailureMessage(reason: unknown): string {
  // 자기 칸만 — `FAILURE['constructor']` 는 객체 원형의 함수다(단위 검사가 잡았다)
  return typeof reason === 'string' && Object.hasOwn(FAILURE, reason) ? FAILURE[reason]! : '바꾸지 못했습니다.'
}

/** 게시하기 전에 무엇이 열리는지 — 하위 페이지가 함께 공개된다(06 *"all of its subpages will be published too"*). */
export const PUBLISH_HINT = '웹에 게시하면 주소를 아는 누구나 로그인 없이 이 페이지와 하위 페이지를 볼 수 있습니다.'

/** 주소를 바꾸기 전에 — 옛 주소는 곧바로 닫힌다. */
export const ROTATE_WARNING = '주소를 바꾸면 지금 주소로는 더 이상 열리지 않습니다.'

/** 위 페이지의 게시로 공개된 페이지 — 볼 수 없는 위 페이지는 이름 없이. */
export function coveredMessage(title: string | null): string {
  if (title === null) return '위 페이지가 웹에 게시되어 이 페이지도 공개되어 있습니다.'
  const name = title.trim() === '' ? '제목 없음' : title.trim()
  return `위 페이지 "${name}" 이(가) 웹에 게시되어 이 페이지도 공개되어 있습니다.`
}

/** 공개 주소 — 이 앱의 주소 위에. */
export function publicUrlOf(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/p/${token}`
}
