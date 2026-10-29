/**
 * 인라인 데이터베이스 만들기 — POST `/api/workspaces/[workspaceId]/pages/[pageId]/databases` (26번 트랙 I-2 · F-04-14)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 I-1] ① ⑥
 *
 * 그 페이지 **본문 안에** 데이터베이스를 만든다(`createInlineDatabase` — 데이터베이스 블록 · 소스 · 제목 속성 · 기본 뷰와 부모 본문의
 * 참조 노드를 한 트랜잭션에서). `{ name?, at? }` — `at` 은 편집기에서 캐럿이 있던 블록 id 다(비었으면 그 블록을 대체 · 아니면 바로
 * 뒤 · 본문에 없으면 맨 뒤 — 하위 페이지의 `at` 과 같다). 편집기는 참조를 로컬에 넣지 않는다 — 서버가 넣은 것이 동기화로 온다.
 *
 * 부모 페이지를 볼 수 없거나 그 밑에 만들 권한이 없으면 없는 것과 같은 404 다(존재를 알리지 않는다 · 하위 페이지와 같다).
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { createInlineDatabase } from '@/lib/database/database'
import { databaseFailureStatus } from '@/lib/database/http'

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/databases'>,
): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(pageId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const body = (await request.json().catch(() => ({}))) as { name?: unknown; at?: unknown; linkedDataSourceId?: unknown }
  if (body.at != null && (typeof body.at !== 'string' || !isUuid(body.at))) {
    return Response.json({ error: 'invalid_value' }, { status: 400 })
  }
  // 본문 안의 연결된 데이터베이스(L-1 · 정본 [보강 L-1] ②) — 붙일 소스. 글이 아니면 형식이 틀렸다 · 없거나 볼 수 없으면 404(명령이 답한다)
  if (body.linkedDataSourceId != null && typeof body.linkedDataSourceId !== 'string') {
    return Response.json({ error: 'invalid_value' }, { status: 400 })
  }
  const created = await createInlineDatabase(session.ctx, {
    parentPageId: pageId,
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
    ...(typeof body.at === 'string' ? { at: body.at } : {}),
    ...(typeof body.linkedDataSourceId === 'string' ? { linkedDataSourceId: body.linkedDataSourceId } : {}),
  })
  if (!created.ok) return Response.json({ error: created.reason }, { status: databaseFailureStatus(created.reason) })
  return Response.json({ ok: true, database: created.value }, { status: 201 })
}
