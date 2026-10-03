/**
 * PATCH /api/workspaces/[workspaceId]/pages/[pageId] — 제목 · 아이콘 변경
 *
 * 본문(블록) 저장은 여기가 아니다 — 본문을 쓰는 길은 협업 서버 하나다(CRDT 6e).
 *
 * 몸체: `{ title?: string, icon?: { type: 'emoji', emoji } | { type: 'file', file_id } | { type: 'external', url } | null }` — 하나는
 * 있어야 한다(이미지 아이콘은 8c-4 — 올린 파일은 먼저 `POST …/files` 로 올린 id). 아이콘(8c-1)은 제목과 따로 쓴다 — DB 행은
 * 아이콘만 이 길로 고친다(행의 제목은 셀이다 · `renamePage`). 둘 다 오면 아이콘을 먼저 쓰고 제목을 쓴다(각자 트랜잭션 — 제목이 거부되면
 * 아이콘은 이미 바뀌었다. 화면은 둘을 함께 보내지 않는다).
 */

import { asBlockId } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { renamePage, setPageIcon, titleFromPlainText, PageError } from '@/lib/block/page'
import { parsePageIconInput, type PageIcon } from '@/lib/block/page-icon'

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]'>,
): Promise<Response> {
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
  // 객체가 아닌 몸체(문자열 · 숫자)에 `in` 을 쓰면 던진다 — 빈 몸체와 같이 다룬다.
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as { title?: unknown; icon?: unknown }

  if (body.title === undefined && !('icon' in body)) {
    return Response.json({ error: 'invalid_input', message: 'title 이나 icon 이 있어야 합니다' }, { status: 400 })
  }
  if (body.title !== undefined && typeof body.title !== 'string') {
    return Response.json({ error: 'invalid_input', message: 'title 은 문자열이어야 합니다' }, { status: 400 })
  }
  // 아이콘은 명령(`setPageIcon`)도 같은 함수로 다시 검사한다 — 여기서 먼저 거르는 것은 이중 방어다. ⚠ **증명하지 못한 방어** — 빼도
  // 명령의 `invalid_icon` 이 같은 400 이 된다(8c-1 반사실 s11). 이 길로 오는 몸체를 명령 전에 다른 곳에 쓰게 되면 그때 뜻이 생긴다.
  let icon: PageIcon | null | undefined
  if ('icon' in body) {
    icon = parsePageIconInput(body.icon)
    if (icon === undefined) {
      return Response.json(
        {
          error: 'invalid_icon',
          message: 'icon 은 이모지 한 글자({ type: "emoji", emoji }) · 올린 이미지({ type: "file", file_id }) · 이미지 주소({ type: "external", url }) 이거나 null 이어야 합니다',
        },
        { status: 400 },
      )
    }
  }

  try {
    const saved = icon === undefined ? undefined : await setPageIcon(session.ctx, pageId, icon)
    if (typeof body.title !== 'string') return Response.json({ ok: true, page: { id: pageId, icon: saved ?? null } })
    const page = await renamePage(session.ctx, pageId, titleFromPlainText(body.title))
    return Response.json({ ok: true, page: { id: page.id, title: page.plainTitle, icon: page.icon, version: page.version } })
  } catch (e) {
    if (e instanceof PageError) {
      // 볼 수 없으면 없는 페이지와 같다(404) · 볼 수만 있으면 403 · 잠겼으면 409(입력은 맞는데 지금 상태가 허락하지 않는다).
      const status = e.code === 'not_found' ? 404 : e.code === 'forbidden' ? 403 : e.code === 'locked' ? 409 : 400 // invalid_title · invalid_icon
      return Response.json({ error: e.code, message: e.message }, { status })
    }
    throw e
  }
}
