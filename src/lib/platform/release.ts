/**
 * 새 버전 알림 — 배포의 표지 (플랫폼 잔여 10h-1 · F-12-17 · 정본 §3.10 끝 [보강] 새 버전 알림)
 *
 * 순수 — 표지의 모양 · 어디서 오는가 · 다른가 · 덮었는가. 서버가 표지를 읽는 곳은 `release-server.ts`, 브라우저의 감시자는
 * `app/w/[workspaceId]/release-watcher.tsx`.
 */

const RELEASE = /^[A-Za-z0-9._-]{1,64}$/

/** 화면이 보이는 동안 다시 묻는 간격(밀리초). 다시 보일 때는 곧바로 묻는다. */
export const RELEASE_CHECK_INTERVAL_MS = 10 * 60 * 1000

/** 청크를 못 받아 묻는 것의 최소 간격(밀리초 · 10h-2) — 여러 청크가 한꺼번에 실패해도 한 번 묻는다. */
export const ASSET_ERROR_CHECK_GAP_MS = 30 * 1000

/** 표지의 모양 — 영숫자 · `.` `_` `-` 64자까지. 앞뒤 공백은 걷는다(파일의 줄바꿈). 아니면 모른다(null). */
export function normalizeRelease(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return RELEASE.test(value) ? value : null
}

/** 지금 배포의 표지 — 배포가 준 값(`APP_RELEASE`) · 없으면(또는 모양이 틀리면) 빌드의 표지 · 그것도 없으면 모른다. */
export function resolveRelease(fromEnv: unknown, readBuildId: () => string | null): string | null {
  return normalizeRelease(fromEnv) ?? normalizeRelease(readBuildId())
}

/** 새 버전인가 — 둘 다 알고 다를 때만. 모르면 다르다고 하지 않는다(개발 서버 · 읽지 못한 응답). */
export function isNewRelease(loaded: string | null, current: string | null): boolean {
  return loaded !== null && current !== null && loaded !== current
}

/** 띠를 세우는가 — 새 버전이고 그 표지를 덮지 않았을 때("나중에" 는 그 표지만 덮는다). */
export function shouldShowBanner(loaded: string | null, current: string | null, dismissed: string | null): boolean {
  return isNewRelease(loaded, current) && current !== dismissed
}

/** 이 앱의 정적 자산인가(10h-2) — 같은 출처 · `/_next/static/`. 다른 출처 · 다른 경로(올린 그림 · 바깥 스크립트)는 배포와 상관없다. */
export function isAppAssetUrl(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url, origin)
    return parsed.origin === origin && parsed.pathname.startsWith('/_next/static/')
  } catch {
    return false
  }
}

/** 자산을 못 받았을 때 곧바로 묻는가(10h-2) — 이 앱의 자산이고 지난번 그렇게 물은 지 간격이 지났을 때. */
export function shouldCheckOnAssetError(url: string, origin: string, lastCheckAt: number | null, now: number): boolean {
  return isAppAssetUrl(url, origin) && (lastCheckAt === null || now - lastCheckAt >= ASSET_ERROR_CHECK_GAP_MS)
}
