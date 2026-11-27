/**
 * 없거나 볼 수 없는 곳 — 워크스페이스 안의 404 (59번 트랙 NV-2 · F-07-12)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강 NV-0] ⑥ [NV-2]
 *
 * 이 구간 아래의 화면이 `notFound()` 를 부르면 여기서 그린다 — 워크스페이스의 틀(사이드바) 안에서. 없는 페이지 · 휴지통 · 다른 워크스페이스의
 * 페이지 · 접근 요청을 할 수 없는 페이지가 **같은 화면**이다(무엇이 없는지 · 왜 못 보는지 말하지 않는다). 상태도 그대로 404 다. 워크스페이스
 * 자체가 없거나 멤버가 아니면 레이아웃이 부른 것이라 여기가 아니라 루트의 404 다(그 사람에게는 워크스페이스의 틀을 싣지 않는다).
 *
 * "뒤로"(⑥) — 앞 항목이 있으면 한 칸 뒤로, 없으면 워크스페이스 홈(`notice-back.tsx`).
 */

import { SCREEN_TITLES } from '@/lib/nav/screen-title'
import { DocumentTitle } from './document-title'
import { NoticeBack } from './notice-back'

export default function WorkspaceNotFound() {
  return (
    <main
      data-testid="not-found"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 py-12 text-center"
    >
      {/* 탭 제목(10d-7b) — 클라이언트 이동으로도 닿는다(앞 화면의 제목이 남지 않게) */}
      <DocumentTitle title={SCREEN_TITLES.notFound} />
      <h1 className="text-lg font-semibold">페이지를 찾을 수 없습니다</h1>
      <p className="text-sm text-neutral-500">없는 주소이거나 볼 수 없는 곳입니다.</p>
      <NoticeBack />
    </main>
  )
}
