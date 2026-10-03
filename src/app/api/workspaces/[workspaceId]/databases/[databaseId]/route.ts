/**
 * 데이터베이스 이름 · 아이콘 변경 — PATCH `/api/workspaces/[workspaceId]/databases/[databaseId]`
 *
 * 정본: 00-canonical-data-model.md §3.5 `database.title_rich` · `database.icon`([보강] 데이터베이스 아이콘 · 8c-3b)
 *
 * 페이지 제목 라우트(`pages/[pageId]`)를 쓰지 않는다. 그쪽은 `type='page'` 만 받고
 * 검색 색인을 함께 쓴다 — 데이터베이스는 이름이 두 곳(`block.properties.title` ·
 * `database.title_rich`)에 있고 `search_document` 에 행이 없다(`renameDatabase` 머리말).
 *
 * 몸체: `{ name?: string, icon?: { type: 'emoji', emoji } | null }` — 하나는 있어야 한다(페이지 라우트와 같은 모양). 둘 다 오면 아이콘을
 * 먼저 쓰고 이름을 쓴다(각자 트랜잭션 — 화면은 둘을 함께 보내지 않는다). 아이콘의 검사는 명령(`setDatabaseIcon`)이 한다 — 라우트가
 * 먼저 거르지 않는다(페이지 라우트의 같은 검사는 증명하지 못한 방어로 남았다 · 8c-1 반사실 s11).
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { renameDatabase, setDatabaseIcon } from '@/lib/database/database'
import { databaseFailureStatus, failureResponse } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/databases/[databaseId]'>

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(databaseId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  // 객체가 아닌 몸체(문자열 · 숫자)에 `in` 을 쓰면 던진다 — 빈 몸체와 같이 다룬다.
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as { name?: unknown; icon?: unknown }

  if ('icon' in body) {
    const saved = await setDatabaseIcon(session.ctx, databaseId, body.icon)
    if (!saved.ok) return failureResponse(databaseFailureStatus(saved.reason), saved)
    if (body.name === undefined) return Response.json({ ok: true, database: { id: databaseId, icon: saved.value } })
  }

  const renamed = await renameDatabase(session.ctx, databaseId, body.name)
  if (!renamed.ok) return failureResponse(databaseFailureStatus(renamed.reason), renamed)
  return Response.json({ ok: true, database: renamed.value })
}
