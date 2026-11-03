/**
 * GET /api/workspaces/[workspaceId]/pages/[pageId]/edit-info?block= — 본문 블록 하나의 마지막 편집 (37번 트랙 ED-2 · F-11-15)
 *
 * 블록 메뉴 맨 아래가 읽는다. 볼 수 없거나 없는 페이지면 404 · 이 페이지의 본문이 아니거나 아직 저장되지 않은 블록이면 `edited: null`.
 * 시각은 열람자의 시간대로 서버가 적는다(페이지 메뉴의 편집 이력과 같은 글 — 정본 §3.4 [보강 ED-1] ③).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { formatEditStamp, readBlockEditInfo } from '@/lib/block/edit-info'
import { readViewerTimeZone } from '@/lib/settings/time-zone-cookie'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/edit-info'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const read = await readBlockEditInfo(session.ctx, pageId, new URL(request.url).searchParams.get('block') ?? '')
  if (!read.ok) return Response.json({ error: read.reason }, { status: 404 })
  if (read.edited === null) return Response.json({ ok: true, edited: null })
  const timeZone = await readViewerTimeZone()
  return Response.json({
    ok: true,
    edited: { label: read.edited.label, at: read.edited.at.toISOString(), stamp: formatEditStamp(read.edited.at, timeZone) },
  })
}
