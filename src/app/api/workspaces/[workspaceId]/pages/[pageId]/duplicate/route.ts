/**
 * 페이지 복제 — POST `/api/workspaces/[workspaceId]/pages/[pageId]/duplicate` (복제 6a조각)
 *
 * 정본: 02-page-workspace.md F-02-09 · 08-templates-automation.md F-08-01
 *
 * 본문(둘 다 생략 가능): `{ parentPageId?: string | null, title?: RichText[] }`
 *
 *   `parentPageId` 없음   원본과 **같은 자리**(원본 바로 뒤 형제) — 사이드바의 "복제"가 쓰는 길이다
 *   `parentPageId: null`  워크스페이스 최상위
 *   `title` 없음          원본 제목 + 꼬리표(`duplicateTitle`)
 *
 * 볼 수 없는 페이지는 없는 페이지와 같은 답이다(404). 복제는 **읽을 수 있으면 된다** — 원본을 고치지 않는다. 쓸 수
 * 있어야 하는 것은 **사본이 들어갈 자리**이고 그 검사는 `createPageIn` 이 한다(`target_not_found`).
 */

import { asBlockId, type BlockId } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { duplicatePage, DuplicateError } from '@/lib/block/duplicate'
import { validateRichText, type RichTextRun } from '@/lib/contracts/rich-text'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/duplicate'>

/** DuplicateError 를 HTTP 로. 존재를 유출하지 않는 쪽으로 고른다(`move` 라우트와 같은 매핑). */
function statusFor(code: DuplicateError['code']): number {
  switch (code) {
    case 'not_found':
    case 'target_not_found':
      return 404
    case 'cycle':
    case 'too_deep':
      return 400
    // 상한은 "지금은 못 한다"다 — 고칠 수 있는 요청이 아니라 크기의 문제다.
    case 'too_large':
      return 413
  }
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: rawPageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(rawPageId)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { parentPageId?: unknown; title?: unknown }

  // 키가 **없는 것**과 `null` 은 다르다 — 없으면 원본 옆, null 이면 최상위다(머리말).
  let parent: { readonly parentPageId?: BlockId | null } = {}
  if ('parentPageId' in body) {
    if (body.parentPageId === null) {
      parent = { parentPageId: null }
    } else {
      try {
        parent = { parentPageId: asBlockId(body.parentPageId) }
      } catch {
        // uuid 가 아니면 "그런 대상은 없다"와 구분할 이유가 없다.
        return Response.json({ error: 'target_not_found' }, { status: 404 })
      }
    }
  }

  let title: { readonly title?: readonly RichTextRun[] } = {}
  if (body.title !== undefined) {
    const issues = validateRichText(body.title, 'title')
    if (issues.length > 0) return Response.json({ error: 'invalid_title', issues }, { status: 400 })
    title = { title: body.title as RichTextRun[] }
  }

  try {
    const result = await duplicatePage(session.ctx, pageId, { ...parent, ...title })
    return Response.json(
      { ok: true, page: result.page, pages: result.pages, skipped: result.skipped },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof DuplicateError) {
      return Response.json({ error: error.code, message: error.message }, { status: statusFor(error.code) })
    }
    throw error
  }
}
