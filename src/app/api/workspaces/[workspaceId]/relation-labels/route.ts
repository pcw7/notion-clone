/**
 * 연결된 행들의 제목 — POST `/api/workspaces/[workspaceId]/relation-labels` (relation 5b-1조각)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] (캐시의 id 는 걸러지지 않았다) / 03-database-core.md F-03-10
 *
 * 본문 `{ ids: string[] }` → `{ labels: { [id]: string | null } }`. 제목 · `null`(볼 수 없다) · 키 없음(휴지통 · 없는 행)
 * 셋으로 갈린다 — 규칙은 `lib/database/relation.ts` `loadRelationLabels`.
 *
 * GET 이 아니라 POST 다: 표 한 화면의 id 가 수백 개라 쿼리 문자열에 실을 수 없다. 아무것도 바꾸지 않는다.
 *
 * 첫 화면의 제목은 서버 렌더가 함께 읽어 내려준다(`db/[databaseId]/page.tsx`). 이 라우트는 **그 뒤에 온 행**
 * ("더 보기" · 새 행)의 제목을 받는 길이다.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { loadRelationLabels, MAX_RELATION_LABELS } from '@/lib/database/relation'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/relation-labels'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const ids = (parsed.body as { ids?: unknown } | null)?.ids
  if (!Array.isArray(ids) || ids.length > MAX_RELATION_LABELS || ids.some((id) => typeof id !== 'string')) {
    return Response.json({ error: 'invalid_value' }, { status: 400 })
  }
  return Response.json({ ok: true, labels: await loadRelationLabels(session.ctx, ids as string[]) })
}
