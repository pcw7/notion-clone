/**
 * GET /api/workspaces/[workspaceId]/emoji/[emojiId]/image — 커스텀 이모지의 그림 (인접 제품 7c-2a · F-13-16)
 *
 * 아이콘(`{type:'custom_emoji', custom_emoji:{id}}`)이 `<img>` 로 부르는 주소다(`pageIconSrc`). 워크스페이스의 누구나(세션) ·
 * 살아 있는 이모지만 — 지운 것 · 없는 것 · 다른 워크스페이스의 것은 모두 404(구분하지 않는다). 화면은 없을 때의 표시로 바꾼다.
 *
 * 캐시는 파일 경로처럼 `immutable` 이 아니다 — 이모지 id 가 가리키는 그림은 바뀌지 않지만 **지울 수 있다.** 5분이면 지운 이모지가
 * 모두의 화면에서 내려간다(정본 §3.4 [보강] 커스텀 이모지 ⑤).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { readCustomEmojiImage } from '@/lib/emoji/custom-emoji'

export async function GET(
  _request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/emoji/[emojiId]/image'>,
): Promise<Response> {
  const { workspaceId, emojiId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const found = await readCustomEmojiImage(session.ctx, emojiId)
  if (found === null) return new Response(null, { status: 404 })

  return new Response(found.bytes as BodyInit, {
    headers: {
      'content-type': found.mime,
      'content-length': String(found.sizeBytes),
      'cache-control': 'private, max-age=300',
      // 파일 경로와 같다 — 이미지라고 하고 HTML 을 흘려보내는 경로를 막는다
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
    },
  })
}
