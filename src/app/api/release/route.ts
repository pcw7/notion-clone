/**
 * GET /api/release — 지금 도는 배포의 표지 (플랫폼 잔여 10h-1 · F-12-17)
 *
 * 정본: 00-canonical-data-model.md §3.10 끝 [보강] 새 버전 알림 ②
 *
 *   200  `{ release: string | null }` — 세션 없이 · DB 없이 · 저장하지 않는다(`no-store`). 모르면(개발) null
 *
 * 워크스페이스 화면의 감시자가 화면이 다시 보일 때 · 10분마다 묻는다(`release-watcher.tsx`).
 */

import { currentRelease } from '@/lib/platform/release-server'

export function GET(): Response {
  return Response.json({ release: currentRelease() }, { headers: { 'cache-control': 'no-store' } })
}
