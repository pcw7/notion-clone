/**
 * GET /api/workspaces/[workspaceId]/search — 전문 검색 (F-07-01 · F-07-07)
 *
 * 쿼리 파라미터: `q` (필수) · `limit` · `cursor`
 *
 * ──────────────────────────────────────────────────────────────────────
 * 짧은 쿼리는 200 + `tooShort` 로 돌려준다. 400 이 아니다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 검색창은 **한 글자씩 타이핑할 때마다** 이 라우트를 부른다(search-as-you-type).
 * 그 과정에서 쿼리가 짧은 구간을 반드시 지나가므로, 그걸 오류로 만들면
 * 정상 입력이 콘솔을 에러로 채우고 클라이언트의 오류 처리가 매번 깜빡인다.
 *
 * 0건과도 **구분해서** 돌려준다. F-07-01 의 빈 상태(최근 방문)와 "검색 결과
 * 없음"은 다른 화면이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 권한은 `searchPages` 안에 있다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 이 라우트는 결과를 **걸러내지 않는다.** 거르는 것은 SQL 의 `WHERE` 이고
 * (F-07-07: post-filter 면 페이지네이션이 깨진다), 라우트가 하는 일은
 * 세션 게이트 통과와 직렬화뿐이다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { searchPages, MAX_SEARCH_LIMIT } from '@/lib/search/search'

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/search'>,
): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const params = new URL(request.url).searchParams
  const rawLimit = params.get('limit')
  const parsedLimit = rawLimit === null ? undefined : Number(rawLimit)

  const outcome = await searchPages(session.ctx, {
    query: params.get('q') ?? '',
    // 범위를 넘는 값은 `searchPages` 가 잘라낸다(400 을 내지 않는다 —
    // `pagination.ts` 의 `normalizePageSize` 와 같은 태도다).
    ...(parsedLimit !== undefined && Number.isFinite(parsedLimit)
      ? { limit: parsedLimit }
      : {}),
    cursor: params.get('cursor'),
  })

  if (!outcome.ok) {
    return Response.json({
      ok: true,
      tooShort: true,
      minLength: outcome.minLength,
      script: outcome.script,
      results: [],
      hasMore: false,
      nextCursor: null,
    })
  }

  const { results } = outcome
  return Response.json({
    ok: true,
    tooShort: false,
    maxLimit: MAX_SEARCH_LIMIT,
    results: results.results.map((hit) => ({
      pageId: hit.pageId,
      title: hit.title,
      snippet: hit.snippet,
      breadcrumb: hit.breadcrumb,
      lastEditedAt: hit.lastEditedAt.toISOString(),
      titleHit: hit.titleHit,
    })),
    hasMore: results.has_more,
    nextCursor: results.next_cursor,
    // 커서 순회가 상한에 걸려 끊겼는지. `hasMore:false` 만 보고 "끝까지
    // 읽었다"고 판단하면 안 된다는 것이 `pagination.ts` 계약의 핵심이다.
    requestStatus: results.request_status,
  })
}
