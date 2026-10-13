/**
 * 이 앱의 주소(`window.location.origin`) — 클라이언트 화면이 공개 주소 · 사이트 주소를 그릴 때.
 *
 * 하이드레이션 동안은 서버와 같게 null 이고(서버는 브라우저의 주소를 모른다), 그 뒤에 채운다(`useSyncExternalStore` 의 서버 스냅샷).
 * `typeof window === 'undefined' ? … : window.location.origin` 으로 가르면 서버가 그린 HTML(빈 주소)과 브라우저의 첫 그림(주소 있음)이
 * 달라져 하이드레이션이 어긋난다(React #418) — 폼 편집 화면에서 7b-2 의 e2e 가 잡았다. null 이면 주소를 그리지 않는다.
 */

import { useSyncExternalStore } from 'react'

const noSubscribe = (): (() => void) => () => undefined
const browserOrigin = (): string | null => window.location.origin
const serverOrigin = (): string | null => null

export function useBrowserOrigin(): string | null {
  return useSyncExternalStore(noSubscribe, browserOrigin, serverOrigin)
}
