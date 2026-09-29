/**
 * POST /api/invites/accept — 초대 수락 (F-14-10)
 *
 * 로그인이 되어 있어야 한다. 초대받은 주소가 이 계정의 **검증된** 이메일인지는
 * acceptInvite 가 확인한다 — 링크만으로는 부족하다.
 */

import { getCurrentUser } from '@/lib/auth/current-user'
import { acceptInvite } from '@/lib/workspace/invite'

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  const token = (body as { token?: unknown })?.token
  if (typeof token !== 'string' || token.length === 0 || token.length > 200) {
    return Response.json({ error: 'invalid' }, { status: 400 })
  }

  const result = await acceptInvite(token, user.userId)

  if (!result.ok) {
    // 사유별 상태 코드. email_mismatch 는 "당신 계정으로는 이 초대를 쓸 수 없다"를
    // 알려줘야 사용자가 계정을 바꿔 로그인할 수 있다.
    // page_unavailable(7g-1)은 좌석처럼 지금 상태가 허락하지 않는 것이다 — 페이지가 지워졌거나 초대한 사람이 더는 공유할 수 없다.
    const status =
      result.reason === 'invalid'
        ? 404
        : result.reason === 'seat_limit' || result.reason === 'page_unavailable'
          ? 409
          : 403
    return Response.json({ error: result.reason }, { status })
  }

  return Response.json({
    ok: true,
    workspaceId: result.workspaceId,
    role: result.role,
    ...(result.pageId === undefined ? {} : { pageId: result.pageId }),
  })
}
