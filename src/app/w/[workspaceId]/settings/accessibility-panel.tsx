'use client'

/**
 * 접근성 — 이 기기의 고대비 · 움직임 줄이기 (플랫폼 잔여 10d-2 · F-12-13)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강] 설정 값 표 · 테마 ⑥
 *
 * 기기의 값이다 — 고르면 이 브라우저의 쿠키에 쓰고(`devicePreferenceCookie`) 곧바로 `<html>` 의 속성을 바꾼다(다시 읽기를 기다리지 않는다).
 * 그다음 화면을 다시 그리게 해 서버가 그리는 `<html>` 도 같은 값이 된다. 계정의 설정 표에 쓰지 않는다(다른 기기로 번지지 않는다).
 */

import { useRouter } from 'next/navigation'
import { startTransition, useState } from 'react'

import {
  CONTRASTS,
  CONTRAST_COOKIE,
  CONTRAST_LABEL,
  MOTIONS,
  MOTION_COOKIE,
  MOTION_LABEL,
  devicePreferenceCookie,
  type Contrast,
  type DevicePreferences,
  type Motion,
} from '@/lib/settings/device-preferences'

export function AccessibilityPanel({ initial }: { initial: DevicePreferences }) {
  const router = useRouter()
  const [contrast, setContrast] = useState<Contrast>(initial.contrast)
  const [motion, setMotion] = useState<Motion>(initial.motion)

  const apply = (name: typeof CONTRAST_COOKIE | typeof MOTION_COOKIE, value: string) => {
    document.cookie = devicePreferenceCookie(name, value)
    document.documentElement.dataset[name === CONTRAST_COOKIE ? 'contrast' : 'motion'] = value
    startTransition(() => router.refresh())
  }

  return (
    <section data-testid="a11y-panel" className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">접근성</h3>
        <p className="mt-1 text-xs text-neutral-500">이 기기에만 적용됩니다 — 다른 기기 · 브라우저에서는 따로 정합니다.</p>
      </div>
      <fieldset data-testid="a11y-contrast" className="flex flex-col gap-1">
        <legend className="mb-1 text-sm">고대비 — 글자 · 테두리 · 포커스 표시를 더 짙게</legend>
        {CONTRASTS.map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="a11y-contrast"
              value={value}
              checked={contrast === value}
              onChange={() => {
                setContrast(value)
                apply(CONTRAST_COOKIE, value)
              }}
            />
            {CONTRAST_LABEL[value]}
          </label>
        ))}
      </fieldset>
      <fieldset data-testid="a11y-motion" className="flex flex-col gap-1">
        <legend className="mb-1 text-sm">움직임 — 전환 · 애니메이션 · 부드러운 스크롤</legend>
        {MOTIONS.map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="a11y-motion"
              value={value}
              checked={motion === value}
              onChange={() => {
                setMotion(value)
                apply(MOTION_COOKIE, value)
              }}
            />
            {MOTION_LABEL[value]}
          </label>
        ))}
      </fieldset>
    </section>
  )
}
