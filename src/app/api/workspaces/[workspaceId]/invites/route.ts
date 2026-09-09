/**
 * POST /api/workspaces/[workspaceId]/invites — 이메일 초대 발급 (F-14-10)
 *
 * **여기가 `SessionContext` 를 실제로 쓰는 첫 지점이다.**
 *
 * 정본 불변식 A9: 권한을 묻는 함수는 user_id 가 아니라 SessionContext 를 받는다.
 * resolveSessionContext() 가 SSO 게이트까지 통과시킨 뒤에야 컨텍스트를 준다.
 *
 * 워크스페이스 스코프가 안 맞으면 **403 이 아니라 404** 다 (F-02-17):
 * "이 값과 리소스의 workspace_id 가 불일치하면 403 이 아니라 404 로 응답한다
 *  (리소스 존재 자체를 노출하지 않기 위해)."
 */

import { asWorkspaceId } from '@/lib/ids'
import { resolveSessionContext } from '@/lib/auth/session-context'
import { readSessionToken } from '@/lib/auth/session-cookie'
import { createEmailInvite, INVITABLE_ROLES, type InvitableRole } from '@/lib/workspace/invite'
import { sendWorkspaceInvite } from '@/lib/workspace/invite-mailer'

function parseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim()
  if (email.length < 3 || email.length > 254) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

function parseRole(value: unknown): InvitableRole | null {
  return typeof value === 'string' && (INVITABLE_ROLES as readonly string[]).includes(value)
    ? (value as InvitableRole)
    : null
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ workspaceId: string }> },
): Promise<Response> {
  // Next.js 15+ 에서 params 는 Promise 다.
  const { workspaceId: raw } = await ctx.params

  let workspaceId
  try {
    workspaceId = asWorkspaceId(raw)
  } catch {
    // uuid 형식이 아니면 존재 여부를 따질 것도 없다. 404.
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const session = await resolveSessionContext(await readSessionToken(), workspaceId)

  if (!session.ok) {
    // 멤버가 아니거나 워크스페이스가 없으면 **둘 다 404** 다.
    // 403 을 주면 "그 워크스페이스는 존재한다"를 알려주는 셈이 된다.
    if (session.reason === 'not_a_member' || session.reason === 'member_inactive') {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
    if (session.reason === 'sso_required') {
      return Response.json({ error: 'sso_required' }, { status: 403 })
    }
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  const email = parseEmail((body as { email?: unknown })?.email)
  const role = parseRole((body as { role?: unknown })?.role)
  if (email === null || role === null) {
    return Response.json({ error: 'invalid_input' }, { status: 400 })
  }

  const result = await createEmailInvite({
    workspaceId: session.context.workspaceId,
    inviterUserId: session.context.userId,
    inviterRole: session.context.role,
    email,
    role,
  })

  if (!result.ok) {
    const status = result.reason === 'forbidden' ? 403 : 409
    return Response.json({ error: result.reason }, { status })
  }

  const devLink = await sendWorkspaceInvite({
    to: email,
    token: result.token,
    workspaceName: null,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin,
  })

  return Response.json({
    ok: true,
    inviteId: result.inviteId,
    ...(process.env.NODE_ENV === 'production' ? {} : devLink ? { devLink } : {}),
  })
}
