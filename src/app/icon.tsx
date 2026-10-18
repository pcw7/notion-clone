/**
 * 앱 아이콘 — 192 · 512 (플랫폼 잔여 10m-3 · F-12-12 · 정본 §3.10 끝 [보강] 좁은 화면 ⑩ⓐ)
 *
 * 주소는 `/icon/192` · `/icon/512` 다(`generateImageMetadata` 의 id) — 매니페스트(`manifest.ts`)가 그 주소를 싣는다. 빌드 때 한 번 그려 둔다.
 */
import { appIcon } from '@/lib/platform/app-icon'

const SIZES = [192, 512] as const

export function generateImageMetadata() {
  return SIZES.map((s) => ({ id: String(s), contentType: 'image/png', size: { width: s, height: s } }))
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const size = Number(await id)
  return appIcon(SIZES.includes(size as (typeof SIZES)[number]) ? size : 192)
}
