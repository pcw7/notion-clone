/**
 * POST /p/[token]/report/submit — 공개 화면의 신고 폼이 보내는 곳 (게시 · 공유 6b-1b · F-17-08 · F-17-10)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 페이지 신고
 *
 * 스크립트 없이 도는 HTML 폼(`application/x-www-form-urlencoded`)을 받아 `submitReport` 에 넘기고 **303 으로 신고 화면에 돌려보낸다**
 * (접수 · 실패 까닭을 쿼리로). 세션을 읽지 않는다.
 *
 *   · **같은 출처만** — `Origin` 이 있으면 이 서버의 것이어야 한다. 다른 사이트의 방문자를 시켜 신고를 퍼붓는 길을 막는다(없으면
 *     브라우저가 아니다 — 받되 레이트리밋이 지킨다)
 *   · **허니팟** — 사람에게 보이지 않는 칸(`website`)이 차 있으면 받은 척하고 남기지 않는다(F-17-10 *"허니팟"*)
 *   · 없는 페이지 · 열 수 없는 페이지는 404 화면으로(이유를 말하지 않는다)
 */

import { requestMeta } from '@/lib/auth/request-meta'
import { submitReport } from '@/lib/moderation/report'

const back = (request: Request, token: string, params: Record<string, string>): Response => {
  const url = new URL(`/p/${token}/report`, request.url)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return Response.redirect(url, 303)
}

export async function POST(request: Request, ctx: RouteContext<'/p/[token]/report/submit'>): Promise<Response> {
  const { token } = await ctx.params
  const form = await request.formData().catch(() => null)
  const pageId = typeof form?.get('page') === 'string' && form.get('page') !== '' ? String(form.get('page')) : undefined
  const keep: Record<string, string> = pageId === undefined ? {} : { page: pageId }

  const origin = request.headers.get('origin')
  if (origin !== null && origin !== new URL(request.url).origin) return back(request, token, { ...keep, error: 'bad_origin' })
  if (form === null) return back(request, token, { ...keep, error: 'invalid_reason' })

  // 허니팟 — 받은 척한다(봇이 실패를 보고 고쳐 오지 않게)
  const trap = form.get('website')
  if (typeof trap === 'string' && trap.trim() !== '') return back(request, token, { ...keep, sent: '1' })

  const result = await submitReport({
    token,
    pageId,
    reason: form.get('reason'),
    detail: form.get('detail') ?? '',
    reporter: requestMeta(request),
  })
  if (!result.ok) {
    if (result.reason === 'not_found') return new Response('없는 페이지입니다.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex' } })
    return back(request, token, { ...keep, error: result.reason })
  }
  return back(request, token, { ...keep, sent: '1' })
}
