/**
 * 페이지의 코멘트 스레드 — GET/POST `/api/workspaces/[workspaceId]/pages/[pageId]/discussions` (F-05-08 · 코멘트 4조각)
 *
 * 판정과 저장은 전부 서버 명령에 있다(`src/lib/comment/discussion.ts`). 이 파일은 **옮기기만** 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이 라우트는 **페이지에 걸린 것**만 받는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 목록 · 새 스레드 · 구독 레벨은 페이지가 대상이다. 이미 있는 스레드 · 코멘트를 고치는 것(답글 · 해결 · 수정 · 삭제 ·
 * 반응)은 `/discussions` 가 받는다 — 그쪽은 URL 에 페이지가 없다. **대상이 어느 페이지인지는 서버가 행에서 읽는다.**
 * URL 의 페이지 id 를 믿고 권한을 보면, 볼 수 있는 페이지 id 를 붙여 남의 스레드를 건드리는 길이 생긴다.
 *
 * 화면이 무엇을 그릴지 정할 수 있게 capability 두 개를 함께 준다 — 쓸 수 있는가(`comment`) · 접을 수 있는가
 * (`edit_content`). 판정은 여기서 하지 않고 `effectiveCaps` 에 묻는다(§3.3 권한 코드 규칙).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import {
  createDiscussion,
  listDiscussions,
  type CommentFailure,
  type CommentResult,
} from '@/lib/comment/discussion'
import { withReadTransaction } from '@/lib/db/tx'
import { asBlockId } from '@/lib/ids'
import { PAGE_LEVELS, setSubscription, subscriptionOf, type PageSubscriptionLevel } from '@/lib/notification/subscription'
import { effectiveCaps } from '@/lib/permissions/effective'
import { can } from '@/lib/permissions/levels'
import { listMembers } from '@/lib/workspace/list'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/discussions'>

/** 볼 수 없는 페이지는 없는 페이지다 — 404 와 403 을 가르지 않는다(§3.2-18). */
export const COMMENT_STATUS: Readonly<Record<CommentFailure, number>> = {
  not_found: 404,
  forbidden: 403,
  block_not_found: 404,
  invalid_anchor: 400,
  empty: 400,
  too_long: 400,
  invalid_rich_text: 400,
  invalid_emoji: 400,
}

export function commentResponse(result: CommentResult<object>): Response {
  if (result.ok) return Response.json(result)
  return Response.json(
    { error: result.reason, message: result.message },
    { status: COMMENT_STATUS[result.reason] },
  )
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(raw)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const filter = new URL(request.url).searchParams.get('resolved')
  const listed = await listDiscussions(session.ctx, pageId, {
    resolved: filter === null ? undefined : filter === 'true',
  })
  if (!listed.ok) return commentResponse(listed)

  const caps = await withReadTransaction((tx) => effectiveCaps(tx, session.ctx, pageId))
  // 이름은 알림 · 코멘트가 복사해 두지 않는다(§3.3-133) — 화면이 그릴 때 워크스페이스 멤버 목록과 맞춘다.
  const members = await listMembers(workspaceId)
  return Response.json({
    ok: true,
    discussions: listed.discussions,
    canComment: can(caps, 'comment'),
    canResolve: can(caps, 'edit_content'),
    subscription: await subscriptionOf(session.ctx, pageId),
    me: session.ctx.userId,
    members: members.map((m) => ({ userId: m.userId, name: m.name })),
  })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(raw)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body as {
    action?: unknown
    blockId?: unknown
    anchor?: unknown
    richText?: unknown
    level?: unknown
  }

  if (body.action === 'subscribe') {
    if (typeof body.level !== 'string' || !PAGE_LEVELS.includes(body.level as PageSubscriptionLevel)) {
      return Response.json({ error: 'invalid_level' }, { status: 400 })
    }
    const done = await setSubscription(session.ctx, pageId, body.level as PageSubscriptionLevel)
    if (!done.ok) {
      return Response.json({ error: done.reason }, { status: done.reason === 'not_found' ? 404 : 400 })
    }
    return Response.json({ ok: true, level: done.level })
  }

  if (body.action !== 'open') return Response.json({ error: 'unknown_action' }, { status: 400 })

  return commentResponse(
    await createDiscussion(session.ctx, {
      pageId,
      blockId: typeof body.blockId === 'string' ? body.blockId : null,
      anchor: body.anchor,
      richText: body.richText,
    }),
  )
}
