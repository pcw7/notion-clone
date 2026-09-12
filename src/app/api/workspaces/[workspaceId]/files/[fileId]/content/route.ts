/**
 * GET /api/workspaces/[workspaceId]/files/[fileId]/content — 파일 내용 (F-12-09)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 문서에는 이 **안정적인 경로**가 들어간다. 서명 URL 이 아니다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본 §3.10: *"서명 URL 은 저장하지 않고 조회 시점에 생성한다(저장하면 만료 관리가
 * 불가능)."* F-12-09 는 그 이유를 못박는다 — 노션의 서명 URL 은 1시간 뒤 죽고,
 * *"정적 사이트 생성기·캐시·이메일 알림에 URL 을 박아 넣으면 반드시 깨진다."*
 *
 * 그래서 블록에는 **파일 id** 만 두고 화면은 이 경로를 가리킨다. 이 경로는 만료되지
 * 않고, 인증은 URL 에 실린 서명이 아니라 **세션**이 한다 — 유출된 링크가 한 시간 동안
 * 유효한 bearer 가 되는 문제(F-09-08 엣지 케이스)가 아예 생기지 않는다.
 *
 * R2 드라이버가 들어오면 여기서 바이트를 흘리는 대신 **그 자리에서 만든 서명 URL 로
 * 302** 한다. 문서에 들어가는 값은 그대로다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { readFile } from '@/lib/file/file'

export async function GET(
  _request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/files/[fileId]/content'>,
): Promise<Response> {
  const { workspaceId, fileId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const found = await readFile(session.ctx, fileId)
  // 다른 워크스페이스의 파일과 "없는 파일"을 구분하지 않는다 — id 를 찍어보는 것으로
  // 존재를 알아낼 수 없어야 한다.
  if (found === null) return new Response(null, { status: 404 })

  return new Response(found.bytes as BodyInit, {
    headers: {
      'content-type': found.file.mime,
      'content-length': String(found.file.sizeBytes),
      // 같은 id 의 내용은 바뀌지 않는다. `private` — 공용 캐시에는 두지 않는다.
      'cache-control': 'private, max-age=31536000, immutable',
      // 이미지라고 하고 HTML 을 흘려보내는 경로를 막는다. SVG 를 받지 않는 것과 한 쌍이다.
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
    },
  })
}
