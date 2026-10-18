/**
 * iOS 홈 화면 아이콘 — 180 (플랫폼 잔여 10m-3 · F-12-12 · 정본 §3.10 끝 [보강] 좁은 화면 ⑩ⓐ). iOS 는 매니페스트의 아이콘 대신
 * `apple-touch-icon` 을 쓴다.
 */
import { appIcon } from '@/lib/platform/app-icon'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return appIcon(size.width)
}
