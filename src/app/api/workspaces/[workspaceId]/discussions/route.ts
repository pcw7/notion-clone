/**
 * 이미 있는 스레드 · 코멘트를 고친다 — POST `/api/workspaces/[workspaceId]/discussions` (F-05-08 · 코멘트 4조각)
 *
 * ──────────────────────────────────────────────────────────────────────
 * URL 에 페이지가 없다 — 대상의 페이지는 **서버가 행에서 읽는다**
 * ──────────────────────────────────────────────────────────────────────
 *
 * 답글 · 해결 · 수정 · 삭제 · 반응은 전부 "이 스레드/코멘트"가 대상이고, 그것이 어느 페이지의 것인지는 행이 안다
 * (`discussion.page_id` — 정본 보강 2h). URL 에 페이지 id 를 받아 그것으로 권한을 보면, **볼 수 있는 페이지 id 를
 * 붙여 남의 스레드를 건드리는 길**이 생긴다. 그래서 받지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * POST 하나에 `action` 을 싣는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 공유 라우트와 같은 이유다(`pages/[pageId]/access`). 이것들은 리소스 하나를 CRUD 하는 일이 아니다 — 답글은 스레드를
 * **다시 열 수도** 있고(§3.3-127), 삭제는 마지막 글이면 스레드까지 지운다(§3.3-126). 계약을 동작 이름으로 드러낸다.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import {
  deleteComment,
  editComment,
  replyToDiscussion,
  setDiscussionResolved,
  toggleReaction,
  REACTION_TARGETS,
  type ReactionTarget,
} from '@/lib/comment/discussion'
import { commentResponse } from '../pages/[pageId]/discussions/route'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/discussions'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body as {
    action?: unknown
    discussionId?: unknown
    commentId?: unknown
    richText?: unknown
    targetKind?: unknown
    targetId?: unknown
    emoji?: unknown
  }

  const discussionId = typeof body.discussionId === 'string' ? body.discussionId : ''
  const commentId = typeof body.commentId === 'string' ? body.commentId : ''

  switch (body.action) {
    case 'reply':
      return commentResponse(await replyToDiscussion(session.ctx, discussionId, body.richText))
    case 'resolve':
      return commentResponse(await setDiscussionResolved(session.ctx, discussionId, true))
    case 'reopen':
      return commentResponse(await setDiscussionResolved(session.ctx, discussionId, false))
    case 'edit':
      return commentResponse(await editComment(session.ctx, commentId, body.richText))
    case 'delete':
      return commentResponse(await deleteComment(session.ctx, commentId))
    case 'react': {
      if (!REACTION_TARGETS.includes(body.targetKind as ReactionTarget)) {
        return Response.json({ error: 'invalid_emoji' }, { status: 400 })
      }
      return commentResponse(
        await toggleReaction(session.ctx, {
          targetKind: body.targetKind as ReactionTarget,
          targetId: typeof body.targetId === 'string' ? body.targetId : '',
          emoji: typeof body.emoji === 'string' ? body.emoji : '',
        }),
      )
    }
    default:
      return Response.json({ error: 'unknown_action' }, { status: 400 })
  }
}
