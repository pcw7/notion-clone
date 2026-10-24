/**
 * Proxy(옛 Middleware · Next 16) — 지금 하는 일은 하나: `/w/` 주소의 id 정규화(10n-58 · F-07-17 · HANDOFF §3.2-295).
 *
 * 하이픈 없는 32자리 hex · `제목-32자리 hex` 로 들어온 워크스페이스 주소를 하이픈 있는 uuid 의 주소로 보낸다(308 — 쿼리는 그대로 ·
 * 조각(`#`)은 브라우저가 이어 붙인다). 규칙은 `lib/nav/id-url.ts`. 권한 · 세션은 보지 않는다 — 옮긴 주소에서 페이지가 다시 묻는다.
 * API(`/api/…`)는 옮기지 않는다 — 하이픈 있는 uuid 만 받는 지금 계약 그대로다.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { canonicalWorkspacePath } from '@/lib/nav/id-url'

export function proxy(request: NextRequest): NextResponse {
  const pathname = canonicalWorkspacePath(request.nextUrl.pathname)
  if (pathname === null) return NextResponse.next()
  const url = request.nextUrl.clone()
  url.pathname = pathname
  return NextResponse.redirect(url, 308)
}

export const config = {
  matcher: '/w/:path*',
}
