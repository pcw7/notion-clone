/**
 * 기기의 접근성 설정 — 고대비 · 움직임 줄이기 (플랫폼 잔여 10d-2 · F-12-13 · F-12-03 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강] 설정 값 표 · 테마 ⑥
 *       12-platform-ux.md F-12-13 *"고대비 모드(디바이스별 저장)"* · *"a11y_preference — contrast(system | standard | high) · reduce_motion
 *       (prefers-reduced-motion 오버라이드)"*
 *
 * 기기마다의 값이다 — 계정의 설정 표가 아니라 **이 브라우저의 쿠키**가 정본이다(다른 기기로 번지지 않는다). 브라우저가 쓰고, 서버는 읽기만
 * 해서 첫 HTML 의 `<html data-contrast data-motion>` 에 싣는다(테마와 같이 첫 페인트 전 — 화면이 바뀌며 깜빡이지 않는다). 민감하지 않은
 * 기기의 값이라 라우트를 두지 않는다. `system` 은 OS 의 설정을 따른다(판정은 CSS 의 미디어 쿼리 — 서버는 OS 를 모른다).
 */

export const CONTRASTS = ['system', 'standard', 'high'] as const
export type Contrast = (typeof CONTRASTS)[number]
export const MOTIONS = ['system', 'reduce', 'full'] as const
export type Motion = (typeof MOTIONS)[number]

export const CONTRAST_COOKIE = 'nc_contrast'
export const MOTION_COOKIE = 'nc_motion'
/** 쿠키의 수명 — 브라우저가 받아 주는 가장 긴 것(400일). */
export const DEVICE_PREFERENCE_MAX_AGE = 60 * 60 * 24 * 400

export type DevicePreferences = { readonly contrast: Contrast; readonly motion: Motion }
export const DEFAULT_DEVICE_PREFERENCES: DevicePreferences = { contrast: 'system', motion: 'system' }

export const CONTRAST_LABEL: Readonly<Record<Contrast, string>> = {
  system: '기기 설정을 따름',
  standard: '보통',
  high: '높게',
}
export const MOTION_LABEL: Readonly<Record<Motion, string>> = {
  system: '기기 설정을 따름',
  reduce: '줄이기',
  full: '줄이지 않음',
}

/** 모르는 값은 기본(`system`). */
export function normalizeContrast(raw: unknown): Contrast {
  return typeof raw === 'string' && (CONTRASTS as readonly string[]).includes(raw) ? (raw as Contrast) : 'system'
}

export function normalizeMotion(raw: unknown): Motion {
  return typeof raw === 'string' && (MOTIONS as readonly string[]).includes(raw) ? (raw as Motion) : 'system'
}

/** 브라우저가 쓰는 쿠키 한 줄 — 모든 경로 · 400일 · 다른 사이트의 요청에는 싣지 않는다. 값은 다듬은 것만. */
export function devicePreferenceCookie(name: typeof CONTRAST_COOKIE | typeof MOTION_COOKIE, value: string): string {
  const safe = name === CONTRAST_COOKIE ? normalizeContrast(value) : normalizeMotion(value)
  return `${name}=${safe}; Path=/; Max-Age=${DEVICE_PREFERENCE_MAX_AGE}; SameSite=Lax`
}

/**
 * 움직임을 줄이는가 — 기기의 값이 이기고(`reduce` · `full`), `system` 이면 OS(`prefers-reduced-motion`). 스크립트가 굴리는 곳(부드러운
 * 스크롤)이 묻는다 — CSS 의 전이 · 애니메이션은 `globals.css` 가 같은 규칙으로 끈다.
 */
export function reducesMotion(motion: string | undefined, osPrefersReduced: boolean): boolean {
  const value = normalizeMotion(motion)
  if (value === 'reduce') return true
  if (value === 'full') return false
  return osPrefersReduced
}
