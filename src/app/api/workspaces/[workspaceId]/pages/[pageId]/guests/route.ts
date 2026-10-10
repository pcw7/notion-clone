/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/guests — 이메일로 이 페이지를 준다 · 없으면 게스트로 들인다 (7d-1 · F-06-09)
 *
 * `{ "email": "…", "level": "view" | "comment" | "edit" }`. 그 페이지를 공유할 수 있는 사람만(`manage_perm`). 받은 사람이 이미
 * 멤버면 역할을 건드리지 않고 공유만 한다(`as: "member"`), 아니면 게스트로 들인다(`as: "guest"`). **계정이 없으면 대기 초대를
 * 남기고 초대 메일을 보낸다**(`as: "pending"` · 7g-1) — 받는 사람이 링크로 가입해 받아들이면 그때 들어온다. 토큰은 응답에 싣지
 * 않는다(개발 환경의 메일 대신 `devLink` 만 — 워크스페이스 초대 라우트와 같다).
 *
 *   not_found · forbidden               → 404 · 403   (공유 설정과 같다 — 볼 수 없으면 없는 페이지와 같다)
 *   invalid_email · invalid_level · guest_level → 400
 *   unavailable                         → 409         (입력은 맞는데 지금 상태가 허락하지 않는다 — 멈춘 사람)
 *   guest_limit                         → 403         (요금제의 게스트 한도 — 8k-2 · 권한 거부와 코드로 가른다)
 */

import { asBlockId } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { inviteGuestToPage, type GuestInviteFailure } from '@/lib/workspace/guest'
import { sendWorkspaceInvite } from '@/lib/workspace/invite-mailer'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/guests'>

const STATUS: Readonly<Record<GuestInviteFailure, number>> = {
  not_found: 404,
  forbidden: 403,
  invalid_email: 400,
  invalid_level: 400,
  guest_level: 400,
  unavailable: 409,
  guest_limit: 403,
  policy_disabled: 403,
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(raw)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { email?: unknown; level?: unknown }

  const result = await inviteGuestToPage(session.ctx, pageId, body.email, body.level)
  if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
  if (result.value.as === 'pending') {
    const devLink = await sendWorkspaceInvite({
      to: result.value.email,
      token: result.value.token,
      workspaceName: null,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin,
    })
    return Response.json({
      ok: true,
      as: 'pending',
      joined: false,
      ...(process.env.NODE_ENV === 'production' ? {} : devLink ? { devLink } : {}),
    })
  }
  return Response.json({ ok: true, as: result.value.as, joined: result.value.joined })
}
