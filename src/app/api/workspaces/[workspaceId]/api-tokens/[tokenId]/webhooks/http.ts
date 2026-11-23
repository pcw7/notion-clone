/**
 * API 웹훅 라우트들이 같이 쓰는 것 — 거부 코드의 HTTP 상태 (API-8 · F-09-09)
 *
 * 상태는 `apiWebhookFailureStatus`(권한 403 · 없음 404 · 상한 · 상태 409 · 간격 429 · 그 밖 400). URL 의 거절 까닭(`problem`)도 싣는다.
 */

import { apiWebhookFailureStatus, type ApiWebhookFailure } from '@/lib/api/webhooks'
import type { OutboundUrlProblem } from '@/lib/net/outbound'

export const apiWebhookFailure = (failure: { readonly reason: ApiWebhookFailure; readonly problem?: OutboundUrlProblem }): Response =>
  Response.json(
    { ok: false, error: failure.reason, ...(failure.problem === undefined ? {} : { problem: failure.problem }) },
    { status: apiWebhookFailureStatus(failure.reason), headers: { 'cache-control': 'no-store' } },
  )

export const noStore = { 'cache-control': 'no-store' } as const
