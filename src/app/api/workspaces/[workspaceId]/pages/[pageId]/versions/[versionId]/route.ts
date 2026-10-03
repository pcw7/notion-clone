/**
 * GET /api/workspaces/[workspaceId]/pages/[pageId]/versions/[versionId] — 버전 하나의 본문 (잔여 묶음 8d-1 · F-11-01)
 *
 * 읽기 전용 미리보기의 재료 — 그 버전의 본문(정규화한 `EditorDoc`)과, 본문의 하위 페이지 · 멘션이 그릴 이름 · 아이콘(지금의 권한으로
 * 거른 맵 · 본문 GET 과 같은 모양). 보관 기간이 지난 버전은 410(F-11-02 *"410 + 이 버전은 더 이상 사용할 수 없습니다"*).
 *
 * 고칠 수 있는 사람만 — 볼 수만 있으면 403, 볼 수 없거나 없는 페이지 · 버전이면 404.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { readVersion } from '@/lib/history/version'
import { versionFailureStatus } from '@/lib/history/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/versions/[versionId]'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId, versionId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const read = await readVersion(session.ctx, pageId, versionId)
  if (!read.ok) return Response.json({ error: read.reason }, { status: versionFailureStatus(read.reason) })
  const { version, doc, labels } = read.value
  return Response.json({ ok: true, version, doc, users: labels.users, pages: labels.pages, pageIcons: labels.pageIcons })
}
