/**
 * POST /f/[token]/submit — 공개 폼의 응답을 받는다 (인접 제품 7a-2a · F-13-02 · F-17-10)
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ⑥
 *
 * 몸체 `{ submission, answers: { [propertyId]: 답 }, website }` — `submission` 은 화면이 준 제출 토큰, `website` 는 허니팟(사람에게 보이지
 * 않는 칸). 웹 공개 폼은 **세션을 보지 않는다** — 제출자는 주체가 아니다. 워크스페이스 멤버만의 폼(7b-1)이면 쿠키의 세션을 넘겨
 * 응답자를 정한다(판정은 그쪽 — 정본 ⑨). 판정 · 방어 · 넣기는 `submitFormResponse` 한 곳이다.
 *
 *   200 `{ ok: true }`(+ `responsePath` — 응답자가 그 행을 받았으면 그 주소 · 7b-4) · 404 열 수 없는 폼(이유를 말하지 않는다) ·
 *   403 `bad_origin` · 409 `already_submitted`(7b-3) · 410 `form_closed`(7b-2) · 429 `rate_limited` ·
 *   400 `invalid_token` | `expired` | `too_fast` | `invalid_value`(+ `issues` — 질문마다 까닭) | `invalid_input`(몸체가 JSON 이 아니다)
 */

import { requestMeta } from '@/lib/auth/request-meta'
import { readSessionToken } from '@/lib/auth/session-cookie'
import { submitFailureStatus, submitFormResponse } from '@/lib/database/form-submit'
import { allowedOrigins } from '@/lib/platform/allowed-origins'

const HEADERS = { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' }

export async function POST(request: Request, ctx: RouteContext<'/f/[token]/submit'>): Promise<Response> {
  const { token } = await ctx.params
  const body = (await request.json().catch(() => null)) as { submission?: unknown; answers?: unknown; website?: unknown } | null
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ ok: false, error: 'invalid_input' }, { status: 400, headers: HEADERS })
  }
  const result = await submitFormResponse({
    token,
    submission: body.submission,
    answers: body.answers,
    trap: body.website,
    origin: request.headers.get('origin'),
    allowedOrigins: allowedOrigins(request.url),
    submitter: requestMeta(request),
    sessionToken: await readSessionToken(),
  })
  if (result.ok) {
    const { responsePath } = result.value
    return Response.json({ ok: true, ...(responsePath === null ? {} : { responsePath }) }, { headers: HEADERS })
  }
  return Response.json(
    { ok: false, error: result.reason, ...(result.issues === undefined ? {} : { issues: result.issues }) },
    { status: submitFailureStatus(result.reason), headers: HEADERS },
  )
}
