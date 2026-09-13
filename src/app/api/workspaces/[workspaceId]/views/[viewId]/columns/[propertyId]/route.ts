/**
 * 뷰의 컬럼 설정 — PATCH `/api/workspaces/[workspaceId]/views/[viewId]/columns/[propertyId]`
 *
 * 정본: 00-canonical-data-model.md §3.6 불변식 V1
 *   *"순서 변경은 반드시 **단일 행 UPDATE**. 배열이면 'A는 폭, B는 순서'가 전체
 *   LWW 로 충돌한다."*
 *
 * 그래서 이 라우트는 **컬럼 하나**를 주소로 갖는다. 한 번에 여러 컬럼을 보내는
 * 엔드포인트를 두면 그 순간 배열 LWW 가 되고, 두 사람이 다른 컬럼을 각각 고친
 * 것이 서로를 지운다.
 *
 * `beforeId` 를 주면 순서 이동, 나머지 필드는 표시 설정이다. 둘을 한 요청에서
 * 함께 보낼 수 있지만 각각 단일 행 UPDATE 로 처리된다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { moveViewColumn, setViewColumn, type ViewFailure } from '@/lib/database/view'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]/columns/[propertyId]'>

function statusOf(reason: ViewFailure): number {
  if (reason === 'not_found') return 404
  if (reason === 'forbidden') return 403
  return 400
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const body = (await request.json().catch(() => ({}))) as {
    visible?: unknown
    width?: unknown
    wrap?: unknown
    /** `null` 이면 맨 뒤로. 키가 없으면 순서를 건드리지 않는다. */
    beforeId?: unknown
  }

  // 표시 설정을 먼저 적용한다. 순서만 보낸 요청에서는 건너뛴다.
  const hasDisplay = 'visible' in body || 'width' in body || 'wrap' in body
  let result = hasDisplay
    ? await setViewColumn(session.ctx, viewId, propertyId, {
        ...(typeof body.visible === 'boolean' ? { visible: body.visible } : {}),
        ...('width' in body ? { width: body.width as number | null } : {}),
        ...(typeof body.wrap === 'boolean' ? { wrap: body.wrap } : {}),
      })
    : null

  if (result !== null && !result.ok) {
    return Response.json(
      { error: result.reason, ...(result.issues ? { issues: result.issues } : {}) },
      { status: statusOf(result.reason) },
    )
  }

  if ('beforeId' in body) {
    const before = body.beforeId
    if (before !== null && typeof before !== 'string') {
      return Response.json({ error: 'invalid_name' }, { status: 400 })
    }
    result = await moveViewColumn(session.ctx, viewId, propertyId, before)
    if (!result.ok) {
      return Response.json({ error: result.reason }, { status: statusOf(result.reason) })
    }
  }

  if (result === null) {
    // 아무 필드도 오지 않았다. 고칠 것이 없으므로 400 이다 — 조용히 200 을 주면
    // 클라이언트가 "보냈는데 안 먹었다"를 성공으로 읽는다.
    return Response.json({ error: 'invalid_name' }, { status: 400 })
  }
  return Response.json({ ok: true, view: result.value })
}
