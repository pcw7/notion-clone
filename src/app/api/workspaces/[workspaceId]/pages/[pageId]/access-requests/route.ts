/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/access-requests — 접근 · 편집 권한을 요청한다 (7e-1 · 7e-2 · F-06-15)
 *
 * `{ "kind"?: "page_access" | "edit_access" }` — 없으면(몸체가 비어도) 접근 요청이다. 접근 요청은 볼 수 없는 사람이(요청 화면),
 * 편집 요청은 볼 수는 있지만 고칠 수 없는 사람이(공유 패널). 이미 열린 요청이 있으면 새로 만들지 않는다(`sent: false` — 화면은
 * 둘 다 "보냈습니다"). 이미 가졌으면 409 `has_access`, 요청할 수 있는 페이지가 아니면(편집 요청인데 볼 수 없는 것 포함) 404.
 *
 * **워크스페이스 밖의 사람**(로그인했지만 멤버십이 없거나 떠난 사람 · 7g-2)도 이 라우트 하나로 접근 요청을 보낸다 — 정책이
 * 허락하고 살아 있는 페이지일 때만. 그 사람에게 이 라우트는 요청 말고 아무것도 하지 않는다 — 편집 요청 · 요청할 수 없는 페이지는
 * 멤버가 아닌 사람이 받던 404 그대로다.
 */

import { asBlockId } from '@/lib/ids'
import { requireWorkspaceVisitor } from '@/lib/auth/route-session'
import { isAccessRequestKind, requestAccess, requestAccessAsOutsider } from '@/lib/permissions/access-request'
import { accessRequestResponse } from '@/lib/permissions/access-request-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/access-requests'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const session = await requireWorkspaceVisitor(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(raw)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  // 몸체는 없어도 된다(요청 화면의 버튼) — 있으면 JSON 이어야 한다.
  const text = await request.text()
  let body: { kind?: unknown } = {}
  if (text.trim() !== '') {
    try {
      body = (JSON.parse(text) ?? {}) as { kind?: unknown }
    } catch {
      return Response.json({ error: 'invalid_body' }, { status: 400 })
    }
  }
  const kind = body.kind ?? 'page_access'
  if (!isAccessRequestKind(kind)) return Response.json({ error: 'invalid_kind' }, { status: 400 })

  if (session.outsider !== undefined) {
    if (kind !== 'page_access') return Response.json({ error: 'not_found' }, { status: 404 })
    const result = await requestAccessAsOutsider(session.outsider, pageId)
    if (!result.ok) return accessRequestResponse(result)
    return Response.json({ ok: true, sent: result.value.sent })
  }

  const result = await requestAccess(session.ctx, pageId, kind)
  if (!result.ok) return accessRequestResponse(result)
  return Response.json({ ok: true, sent: result.value.sent })
}
