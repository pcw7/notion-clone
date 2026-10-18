'use client'

/**
 * 앱의 링크 — 보이는 링크마다 미리받지 않고, 사용자가 뜻을 보일 때(올려 두기 · 누르기 시작 · 포커스) 미리받는다 (10n-7 · F-12-18)
 *
 * 정본: HANDOFF §3.2-271 · Next 16 안내서 `guides/prefetching.md` 의 "Disabled Prefetch" · hover prefetch 모양
 *
 * Next 는 링크가 화면에 들어올 때마다 그 경로를 미리받는다. 이 앱의 경로는 모두 동적이라 내용은 미리받지 않고(안내서: *"a dynamic route
 * is skipped unless it has a loading.js"*) **경로 정보(`next-router-segment-prefetch: /_tree`)만** 받는데, 그것도 서버 요청이다. 화면이 다시
 * 그려질 때마다(표 변경 신호의 `router.refresh()` 포함) 사이드바의 링크마다 다시 나가 — 갤러리 절 한 판에 77번 — 그 사이 다른 곳으로 떠나면
 * 서버가 그 렌더를 "The destination stream closed early" 로 끊고 오류를 찍었다(HANDOFF §7 · 전체 판의 갤러리 2f-1). 미리받아 얻는 것은 경로
 * 정보뿐이라 뜻을 보인 링크만 받아도 잃는 것이 없다.
 *
 * `next/link` 를 직접 쓰지 않는다 — 린트가 막는다(`eslint.config.mjs`). 미리받기를 꼭 해야 하는 링크는 `prefetch` 를 넘기면 그것이 이긴다.
 */

import NextLink from 'next/link'
import { useState, type ComponentProps } from 'react'

export default function Link({ prefetch, onMouseEnter, onTouchStart, onFocus, ...props }: ComponentProps<typeof NextLink>) {
  const [intent, setIntent] = useState(false)
  return (
    <NextLink
      {...props}
      // 뜻을 보이면 기본(null — 정적 경로는 통째로 · 동적 경로는 경로 정보)으로 돌아간다
      prefetch={prefetch ?? (intent ? null : false)}
      onMouseEnter={(event) => {
        setIntent(true)
        onMouseEnter?.(event)
      }}
      onTouchStart={(event) => {
        setIntent(true)
        onTouchStart?.(event)
      }}
      onFocus={(event) => {
        setIntent(true)
        onFocus?.(event)
      }}
    />
  )
}
