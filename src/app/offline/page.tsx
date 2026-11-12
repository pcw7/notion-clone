/**
 * 오프라인 껍데기 (OF-1 · F-12-04 · 정본 §3.7 [보강 OF-1] ①)
 *
 * 서비스 워커(`public/sw.js`)가 설치 때 받아 두었다가, 페이지 이동이 네트워크에 닿지 않으면 이 화면을 보인다(주소는 그대로).
 * **로그인 정보가 없는 정적 화면**이다 — 빌드 때 한 번 그린다(`force-static` — 루트 레이아웃의 쿠키 읽기도 빈 값을 받아 테마 · 이 기기의
 * 설정은 기본값). 캐시에 남아 누가 보아도 되는 것만 싣는다 · API 를 부르지 않는다. 내려받은 페이지의 목록은 OF-2 가 여기에 채운다.
 */
import type { Metadata } from 'next'

import { SCREEN_TITLES } from '@/lib/nav/screen-title'

export const dynamic = 'force-static'

export const metadata: Metadata = { title: SCREEN_TITLES.offline }

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6" data-testid="offline-shell">
      <h1 className="text-xl font-semibold">오프라인입니다</h1>
      <p className="text-sm text-neutral-500">네트워크에 연결되어 있지 않습니다. 연결되면 페이지를 새로 고쳐 주세요.</p>
      <section aria-labelledby="offline-pages-title" className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 id="offline-pages-title" className="text-sm font-medium">
          내려받은 페이지
        </h2>
        <p className="mt-1 text-sm text-neutral-500">오프라인으로 쓰려고 내려받은 페이지가 여기에 보입니다.</p>
      </section>
    </main>
  )
}
