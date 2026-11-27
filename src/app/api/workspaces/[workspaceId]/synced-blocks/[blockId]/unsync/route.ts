/**
 * POST /api/workspaces/[workspaceId]/synced-blocks/[blockId]/unsync — 원본의 "모두 해제" (SB-4 · F-01-11 · 정본 [보강 SB-0] ⑫ⓑ [SB-4 고침])
 *
 * 본문: `{ pageId }` — 원본 X 가 든 페이지 A(화면이 안다 · X 의 행은 투영 전일 수 있다).
 *
 *   200 `{ state: 'done', expanded, left }`  고칠 수 있는 사본 페이지에 X 의 내용을 펴고 X 의 껍데기를 벗겼다(페이지 수)
 *   200 `{ state: 'no_copies' }`             사본이 없다 — 아무것도 쓰지 않았다(편집기가 벗긴다 · ⑫ⓒ)
 *   404  A 를 볼 수 없다 · A 의 문서에 X(원본)가 없다    403  A 를 고칠 수 없다(잠김 포함)    413  사본 페이지가 200곳을 넘는다
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { unsyncAllSyncedCopies } from '@/lib/block/synced-block-lifecycle'

const STATUS = { not_found: 404, forbidden: 403, too_many: 413 } as const

export async function POST(request: Request, ctx: RouteContext<'/api/workspaces/[workspaceId]/synced-blocks/[blockId]/unsync'>): Promise<Response> {
  const { workspaceId, blockId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const pageId = (parsed.body as { pageId?: unknown } | null)?.pageId
  if (typeof pageId !== 'string') return Response.json({ error: 'not_found' }, { status: 404 })
  const result = await unsyncAllSyncedCopies(session.ctx, pageId, blockId)
  if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
  return Response.json(result.value)
}
