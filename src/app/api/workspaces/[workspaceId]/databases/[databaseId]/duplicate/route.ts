/**
 * 데이터베이스 복제 — POST `/api/workspaces/[workspaceId]/databases/[databaseId]/duplicate` (29번 트랙 D-1)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 D-1]
 *
 * `{ content?: boolean }` — 기본은 내용과 함께(노션의 "복제" — 행 · 칸 · relation · 행의 본문 · 하위 페이지 · 템플릿 · D-2 · D-3) ·
 * `false` 면 내용 없이(모양 · 템플릿 — D-1). 행이 상한(1,000)을 넘거나 한 행의 본문이 복제 상한을 넘으면 413 `too_large`.
 *
 * 원본을 볼 수 없거나 그 자리에 만들 수 없으면 없는 것과 같은 404 · 인라인의 깊이 상한이면 400 `too_deep`.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { duplicateDatabase } from '@/lib/database/duplicate-database'

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/databases/[databaseId]/duplicate'>,
): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(databaseId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const body = (await request.json().catch(() => ({}))) as { content?: unknown }
  if (body.content != null && typeof body.content !== 'boolean') return Response.json({ error: 'invalid_value' }, { status: 400 })
  const copied = await duplicateDatabase(session.ctx, databaseId, { content: body.content !== false })
  if (!copied.ok) {
    const status = copied.reason === 'too_deep' ? 400 : copied.reason === 'too_large' ? 413 : 404
    return Response.json({ error: copied.reason }, { status })
  }
  return Response.json({ ok: true, database: copied.value }, { status: 201 })
}
