/**
 * 되돌아간 열기의 방문 기록 — POST `/api/workspaces/[workspaceId]/pages/[pageId]/visit` (59번 트랙 NV-2 · F-07-12)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강 NV-0] ⑨ [NV-2]
 *
 * 화면이 라우터가 받아 둔 렌더를 다시 그렸을 때(뒤로 · 앞으로) · 브라우저가 문서째 되살렸을 때만 부른다(`visit-mark.tsx`). 처음 여는 것은 서버
 * 렌더가 이미 남겼다. 볼 수 있으면 남기고 `{ ok: true }` · 없거나 볼 수 없으면 둘 다 같은 404 — 이 라우트로 존재를 확인할 수 없다. 404 를 받은
 * 화면은 서버에 다시 묻는다(그 사이 잃은 페이지의 받아 둔 화면을 계속 보이지 않게).
 */

import { asBlockId } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { recordVisitIfViewable } from '@/lib/nav/return-visit'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/visit'>

const NOT_FOUND = () => Response.json({ error: 'not_found' }, { status: 404 })

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(raw)
  } catch {
    return NOT_FOUND()
  }
  if (!(await recordVisitIfViewable(session.ctx, pageId))) return NOT_FOUND()
  return Response.json({ ok: true })
}
