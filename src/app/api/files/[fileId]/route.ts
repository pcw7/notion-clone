/**
 * GET /api/files/[fileId]?expires=…&signature=… — 공개 API 가 내준 1시간짜리 파일 주소 (API-7 · F-09-08)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑪. **세션 없이** 연다 — 서명이 권한이다. 틀리거나 지난 서명 403 · 없는 파일 404 ·
 * 머리는 앱의 파일 경로와 같다. 일은 `lib/api/signed-file.ts`.
 */

import { serveSignedFile } from '@/lib/api/signed-file'

export async function GET(request: Request, ctx: RouteContext<'/api/files/[fileId]'>): Promise<Response> {
  const { fileId } = await ctx.params
  return serveSignedFile(request, fileId)
}
