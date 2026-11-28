/**
 * 로그인한 기기 라우트의 공용 — 거부 코드의 HTTP 상태 (AC-3 · F-14-08)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ⑭ [AC-3]
 *
 *   session_required    403   이 세션으로는 못 한다(위임 · API 토큰)
 *   not_found           404   이 사람의 살아 있는 세션이 아니다(남의 세션 · 없는 세션 · 이미 끝난 세션 — 같은 답)
 *   current_session     409   이 세션은 목록에서 끊지 않는다 — 로그아웃 단추로
 */

import type { DevicesFailure } from '@/lib/auth/devices'

export const DEVICE_STATUS: Readonly<Record<DevicesFailure, number>> = {
  session_required: 403,
  not_found: 404,
  current_session: 409,
}

export const deviceFailure = (reason: DevicesFailure): Response => Response.json({ error: reason }, { status: DEVICE_STATUS[reason] })
