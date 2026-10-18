/**
 * 웹 앱 매니페스트 — 플랫폼 잔여 10m-3 (F-12-12 · 정본 §3.10 끝 [보강] 좁은 화면 ⑩ⓐ)
 *
 * 홈 화면 · 앱 목록에 설치할 수 있게 한다(`/manifest.webmanifest`). 아이콘은 코드로 그린다(`icon.tsx` — 192 · 512). 512 는 가장자리까지 채워
 * 그렸으므로 maskable 로도 낸다(안드로이드가 자기 모양으로 자른다 — 글자는 가운데 안전 구역 안이다). 색은 밝은 테마의 배경(`globals.css`).
 *
 * 서비스 워커(오프라인 셸)는 없다 — 정본 ⑩ⓑ: 로그인한 사람의 화면을 캐시하면 로그아웃 · 권한을 잃은 뒤에도 남는다.
 */
import type { MetadataRoute } from 'next'

import { APP_NAME } from '@/lib/nav/screen-title'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: APP_NAME,
    short_name: APP_NAME,
    description: '문서 · 데이터베이스 · 위키를 한곳에서 — 노션과 같은 워크스페이스',
    lang: 'ko',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    categories: ['productivity'],
    icons: [
      { src: '/icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
