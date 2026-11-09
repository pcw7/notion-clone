/**
 * 사람 칸 — GET `/api/workspaces/[workspaceId]/people?q=` (고르개 후보) · `?ids=a,b` (이름) (게시 · 공유 6g-2 · F-03-07)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 사람 속성 ②⑥
 *
 *   `?q=`   이 워크스페이스의 활동 중인 사람을 이름 · 메일로(게스트에게는 빈 목록 — 7d-2)  →  `{ people: [{ id, name, guest }] }`
 *   `?ids=` 칸에 든 사람의 이름 — 활동 중인 사람만(떠난 사람은 없다)                       →  `{ names: { id: name } }`
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { loadAutoMetaLabels, loadPeopleNames, searchPeople } from '@/lib/database/people'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/people'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const params = new URL(request.url).searchParams
  const ids = params.get('ids')
  if (ids !== null) {
    const list = ids.split(',').map((s) => s.trim()).filter((s) => s !== '')
    // `meta=1` — 만든 · 고친 사람 칸(PT-3): 모든 id 에 이름표를 준다(게스트에게는 "멤버")
    const names = params.get('meta') === '1' ? await loadAutoMetaLabels(session.ctx, list) : await loadPeopleNames(session.ctx, list)
    return Response.json({ ok: true, names })
  }
  const q = (params.get('q') ?? '').slice(0, 100)
  return Response.json({ ok: true, people: await searchPeople(session.ctx, q) })
}
