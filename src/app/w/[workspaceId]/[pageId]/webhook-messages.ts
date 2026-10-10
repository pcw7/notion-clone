/**
 * 페이지 웹훅 칸의 글자 — 거절 · 상태 · 마지막 배달 (히스토리 · 활동 4e-3 · F-11-19 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 페이지 웹훅 — 화면 ⓘ ⓙ
 */

import type { OutboundUrlProblem } from '@/lib/net/outbound'

/** 걸기 전에 알리는 한 줄(정본 ⓘ — 11 *"연결 시 경고 필수"*). */
export const WEBHOOK_NOTICE = '이 페이지와 아래 페이지(권한이 같은 곳)의 활동이 — 제목 · 사람 이름 · 무엇을 했는지 — 이 주소로 나갑니다.'

const PROBLEMS: Record<OutboundUrlProblem, string> = {
  invalid: '올바른 주소가 아닙니다.',
  too_long: '주소가 너무 깁니다.',
  not_https: 'https 주소만 받습니다.',
  credentials: '주소에 사용자 이름 · 비밀번호를 넣을 수 없습니다.',
  port: '기본 포트(443)만 받습니다.',
  private_host: '내부 주소로는 보낼 수 없습니다.',
}

const ERRORS: Record<string, string> = {
  too_many: '이 페이지에는 웹훅을 5개까지 걸 수 있습니다.',
  forbidden: '이 페이지의 전체 권한이 있어야 웹훅을 다룰 수 있습니다.',
  not_found: '이 페이지를 찾을 수 없습니다.',
  row_page: '데이터베이스 행에는 웹훅을 걸 수 없습니다.',
}

/** 거절의 까닭 — 주소 모양이면 그 까닭을, 아니면 오류를. */
export function webhookErrorMessage(error: string | undefined, problem: string | undefined): string {
  if (error === 'invalid_url') return PROBLEMS[problem as OutboundUrlProblem] ?? PROBLEMS.invalid
  return ERRORS[error ?? ''] ?? '웹훅을 바꾸지 못했습니다.'
}

/** 상태(정본 ⓙ) — 켜짐 · 멈춤(직접) · 멈춤(실패가 이어져). */
export function webhookStateLabel(paused: { readonly reason: string } | null): string {
  if (paused === null) return '켜짐'
  return paused.reason === 'failures' ? '멈춤 — 보내기가 계속 실패했습니다' : '멈춤'
}

/** 마지막 배달(정본 ⓙ) — 보냄 · 실패(HTTP 코드) · 보내지 않음 + 시각. `time` 은 시각 글자를 만드는 함수다. */
export function lastDeliveryLabel(
  last: { readonly status: string; readonly at: string; readonly httpStatus: number | null } | null,
  time: (iso: string) => string,
): string {
  if (last === null) return '아직 보낸 적 없음'
  const when = time(last.at)
  if (last.status === 'sent') return `보냄 · ${when}`
  if (last.status === 'failed') return `실패${last.httpStatus === null ? '' : `(HTTP ${last.httpStatus})`} · ${when}`
  return `보내지 않음 · ${when}`
}
