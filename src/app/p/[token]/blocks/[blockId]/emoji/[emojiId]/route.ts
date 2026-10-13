/**
 * GET /p/[token]/blocks/[blockId]/emoji/[emojiId] — 공개 화면의 인라인 커스텀 이모지 그림 (인접 제품 7c-3c · F-13-16)
 *
 * 세션이 없다 — 블록 id 로 연다(이모지 id 만으로 열지 않는다). 그 블록이 든 페이지가 이 토큰으로 열리고, 그 블록의 제목에 그 이모지가
 * 지금 있고, 이모지가 살아 있을 때만 준다 — 판정은 `publish/public-file.ts` 의 `readPublicEmojiFile`(정본 §3.4 [보강] 커스텀 이모지 ⑨).
 * 열 수 없으면 이유 없이 404. 응답 머리는 공개 파일(`../[kind]`)과 같다.
 */

import { readPublicEmojiFile, robotsHeaderOf } from '@/lib/publish/public-file'

export async function GET(_request: Request, ctx: RouteContext<'/p/[token]/blocks/[blockId]/emoji/[emojiId]'>): Promise<Response> {
  const { token, blockId, emojiId } = await ctx.params
  const file = await readPublicEmojiFile(token, blockId, emojiId)
  if (file === null) return new Response(null, { status: 404, headers: { 'x-robots-tag': 'noindex, nofollow' } })
  return new Response(file.bytes as BodyInit, {
    headers: {
      'content-type': file.mime,
      'content-length': String(file.sizeBytes),
      'cache-control': 'private, max-age=60',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'x-robots-tag': robotsHeaderOf(file),
      'referrer-policy': 'no-referrer',
    },
  })
}
