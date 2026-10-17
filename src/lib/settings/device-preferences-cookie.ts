/**
 * 기기의 접근성 설정을 요청의 쿠키에서 읽는다 (플랫폼 잔여 10d-2 · F-12-13)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강] 설정 값 표 · 테마 ⑥
 *
 * 서버는 읽기만 한다(쓰는 것은 브라우저 — `device-preferences.ts` 머리말). next/headers 의 cookies() 는 요청 컨텍스트 안에서만 동작한다 —
 * 서버 컴포넌트(루트 레이아웃 · 설정 화면)에서만 import 한다.
 */

import { cookies } from 'next/headers'

import {
  CONTRAST_COOKIE,
  FONT_SCALE_COOKIE,
  MOTION_COOKIE,
  normalizeContrast,
  normalizeFontScale,
  normalizeMotion,
  type DevicePreferences,
} from './device-preferences.ts'

export async function readDevicePreferences(): Promise<DevicePreferences> {
  const jar = await cookies()
  return {
    contrast: normalizeContrast(jar.get(CONTRAST_COOKIE)?.value),
    motion: normalizeMotion(jar.get(MOTION_COOKIE)?.value),
    fontScale: normalizeFontScale(jar.get(FONT_SCALE_COOKIE)?.value),
  }
}
