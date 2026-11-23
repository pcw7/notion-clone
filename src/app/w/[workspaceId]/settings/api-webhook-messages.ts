/**
 * API 웹훅의 문구 — 설정 → 내 계정 → API 토큰 → 웹훅 (API-8 · F-09-09 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫
 *
 * 거부 코드(`lib/api/webhooks.ts` `ApiWebhookFailure`) · 주소 거절(`OutboundUrlProblem`) · 상태 칩 · 배달 기록의 한 줄을 한 곳에 둔다.
 * 브라우저 묶음에 들어가므로 서버 모듈을 부르지 않는다(상수는 `lib/api/webhook-format.ts` 와 같은 값).
 */

/** 토큰마다 · 워크스페이스마다의 상한 · 시도 상한 — `webhook-format.ts` 와 같은 값. */
export const WEBHOOK_LIMIT_PER_TOKEN = 5
export const WEBHOOK_LIMIT_PER_WORKSPACE = 50
export const WEBHOOK_MAX_ATTEMPTS = 8

const FAILURE: Readonly<Record<string, string>> = {
  forbidden: '웹훅을 관리할 수 없습니다.',
  not_found: '이미 지웠거나 없는 웹훅입니다.',
  token_inactive: '만료한 토큰입니다 — 새 토큰을 만들어 웹훅을 거세요.',
  invalid_url: '받는 주소가 올바르지 않습니다.',
  invalid_events: '받을 이벤트를 하나 이상 고르세요.',
  too_many: `토큰마다 웹훅은 ${WEBHOOK_LIMIT_PER_TOKEN}개까지입니다.`,
  workspace_limit: `이 워크스페이스의 웹훅은 ${WEBHOOK_LIMIT_PER_WORKSPACE}개까지입니다.`,
  webhooks_disabled: '소유자가 이 워크스페이스의 웹훅을 껐습니다.',
  wrong_token: '확인 토큰이 맞지 않습니다. 받는 주소가 받은 값을 그대로 붙여 넣으세요.',
  not_pending: '이미 확인한 웹훅입니다.',
  invalid_state: '지금 상태에서는 할 수 없습니다.',
  too_soon: '방금 보냈습니다. 잠시 뒤 다시 보내세요.',
  test_pending: '보내기를 기다리는 테스트가 이미 다섯 개입니다.',
}

const URL_PROBLEM: Readonly<Record<string, string>> = {
  invalid: '주소의 모양이 아닙니다.',
  too_long: '주소가 너무 깁니다(2,048자까지).',
  not_https: 'https 주소만 받습니다.',
  credentials: '주소에 사용자 이름 · 비밀번호를 넣을 수 없습니다.',
  port: '기본 포트(443)만 받습니다.',
  private_host: '내부 · 사설 주소로는 보낼 수 없습니다.',
}

export function apiWebhookFailureMessage(reason: unknown, problem?: unknown): string {
  if (reason === 'invalid_url' && typeof problem === 'string' && Object.hasOwn(URL_PROBLEM, problem)) return URL_PROBLEM[problem]!
  return typeof reason === 'string' && Object.hasOwn(FAILURE, reason) ? FAILURE[reason]! : '처리하지 못했습니다.'
}

/** 상태 칩 — 구독의 상태와 토큰의 만료를 함께 본다. */
export function webhookStatusLabel(w: { readonly status: string; readonly disabledReason: string | null; readonly tokenExpired: boolean }): {
  readonly text: string
  readonly tone: 'ok' | 'wait' | 'off'
} {
  if (w.status === 'disabled') {
    return { text: w.disabledReason === 'token_revoked' ? '꺼짐 · 토큰 폐기' : '꺼짐 · 실패가 이어짐', tone: 'off' }
  }
  if (w.tokenExpired) return { text: '멈춤 · 토큰 만료', tone: 'off' }
  if (w.status === 'pending_verification') return { text: '확인 기다림', tone: 'wait' }
  if (w.status === 'paused') return { text: '멈춤', tone: 'off' }
  return { text: '켜짐', tone: 'ok' }
}

const SKIP: Readonly<Record<string, string>> = {
  paused: '멈춤',
  disabled: '꺼짐',
  not_verified: '확인 전',
  token_revoked: '토큰 폐기',
  token_expired: '토큰 만료',
  access_lost: '볼 수 없게 됨',
  entity_not_visible: '대상을 볼 수 없음',
  webhooks_disabled: '워크스페이스가 웹훅을 껐음',
  unseal_failed: '봉인을 풀지 못함',
}

const two = (n: number) => String(n).padStart(2, '0')
/** 시각 — 이 브라우저의 시간대로 `11. 23. 14:05`. */
export function shortTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}. ${d.getDate()}. ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** 배달의 결과 한 줄 — 보냄 · 다시 보낼 예정 · 실패 · 건너뜀. */
export function deliveryOutcome(d: {
  readonly status: string
  readonly attempts: number
  readonly httpStatus: number | null
  readonly error: string | null
  readonly skipReason: string | null
  readonly nextAttemptAt?: string | null
}): string {
  const http = d.httpStatus === null ? '' : ` · HTTP ${d.httpStatus}`
  const tries = `${d.attempts}/${WEBHOOK_MAX_ATTEMPTS}회`
  switch (d.status) {
    case 'delivered':
      return `보냄 · ${tries}${http}`
    case 'failed':
      return `실패 · ${tries}${http}`
    case 'skipped':
      return `건너뜀 · ${d.skipReason !== null && Object.hasOwn(SKIP, d.skipReason) ? SKIP[d.skipReason] : (d.skipReason ?? '')}`
    default:
      if (d.attempts === 0) return '보내기를 기다림'
      return `다시 보낼 예정${d.nextAttemptAt ? ` ${shortTime(d.nextAttemptAt)}` : ''} · ${tries}${http || (d.error ? ` · ${d.error}` : '')}`
  }
}

/** 확인 토큰을 보낸 결과 한 줄. */
export function verificationLine(v: { readonly sentAt: string | null; readonly httpStatus: number | null; readonly error: string | null }): string {
  if (v.sentAt === null) return '확인 토큰을 아직 보내지 못했습니다.'
  if (v.error === null) return `받는 주소로 확인 토큰을 보냈습니다${v.httpStatus === null ? '' : ` (HTTP ${v.httpStatus})`}. 받은 값을 아래에 붙여 넣으세요.`
  return `확인 토큰을 보내지 못했습니다 — ${v.httpStatus === null ? v.error : `HTTP ${v.httpStatus}`}. 주소를 고치거나 다시 보내세요.`
}

/** 절 머리의 설명. */
export const API_WEBHOOK_NOTE =
  '이 토큰의 사람이 볼 수 있는 변경을 받는 주소로 보냅니다. 만들면 받는 주소로 확인 토큰을 한 번 보내고, 그 값을 붙여 넣어야 켜집니다. 모든 요청에는 확인 토큰으로 만든 X-Notion-Signature 서명이 붙습니다.'

/** 지우기를 묻는 말. */
export const API_WEBHOOK_REMOVE_CONFIRM = '지우면 기다리던 이벤트와 배달 기록도 사라집니다.'

/** 이벤트를 내보내는 조각이 아직이다(API-9) — 고를 수는 있다. */
export const API_WEBHOOK_EVENTS_NOTE = '페이지 · 데이터베이스 · 댓글 이벤트는 곧 보내기 시작합니다. 지금은 "테스트 보내기" 로 받는 쪽을 확인하세요.'
