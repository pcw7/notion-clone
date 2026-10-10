/**
 * GET /p/[token]/blocks/[blockId]/[kind] — 공개 화면의 파일 (게시 · 공유 6a-2b · F-06-08 · F-17-11)
 *
 *   kind = image — 본문 이미지 블록의 파일 · icon — 페이지의 이미지 아이콘
 *
 * 세션이 없다 — 블록 id 로 연다(파일 id 로 열지 않는다). 판정은 `publish/public-file.ts` 가 한다(정본 [보강] 공개 화면 ⑨).
 * 열 수 없으면 이유 없이 404.
 *
 *   · 캐시는 짧고 개인적이다 — 해제 · 정책 · 휴지통이 곧 닿아야 한다(앱의 파일은 id 로 불변이라 1년이지만 공개 여부는 바뀐다)
 *   · `X-Robots-Tag` 는 링크의 색인 설정 · `Referrer-Policy: no-referrer` · `nosniff`(이미지라 하고 HTML 을 흘리지 않게)
 */

import { isPublicFileKind, readPublicBlockFile, robotsHeaderOf } from '@/lib/publish/public-file'

export async function GET(_request: Request, ctx: RouteContext<'/p/[token]/blocks/[blockId]/[kind]'>): Promise<Response> {
  const { token, blockId, kind } = await ctx.params
  if (!isPublicFileKind(kind)) return new Response(null, { status: 404 })
  const file = await readPublicBlockFile(token, blockId, kind)
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
