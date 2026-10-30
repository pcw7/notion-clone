/**
 * 데이터베이스 복제 — POST `/api/workspaces/[workspaceId]/databases/[databaseId]/duplicate` (29번 트랙 D-1)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 D-1]
 *
 * `{ content: false }` — 내용 없이(스키마 · 뷰 · 폼 · 레이아웃 · 행 규칙 · 버튼). 내용과 함께(행 · 행의 본문 · 템플릿)는 D-2 · D-3 이 연다 —
 * 그 전까지 `content` 가 `false` 가 아니면 400 이다(반쯤 복제한 사본을 "내용과 함께" 라고 내주지 않는다).
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
  if (body.content !== false) return Response.json({ error: 'invalid_value' }, { status: 400 })
  const copied = await duplicateDatabase(session.ctx, databaseId, { content: false })
  if (!copied.ok) return Response.json({ error: copied.reason }, { status: copied.reason === 'too_deep' ? 400 : 404 })
  return Response.json({ ok: true, database: copied.value }, { status: 201 })
}
