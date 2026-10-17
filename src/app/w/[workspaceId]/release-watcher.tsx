'use client'

/**
 * 새 버전 알림 — 워크스페이스 화면의 감시자 (플랫폼 잔여 10h-1 · F-12-17)
 *
 * 정본: 00-canonical-data-model.md §3.10 끝 [보강] 새 버전 알림 ③~⑤
 *
 * 문서가 실려 온 표지를 쥐고 — **처음 받은 것만**(나중의 렌더가 새 서버의 값을 넘겨도 돌고 있는 JS 는 처음 문서의 것이다) — 화면이 다시
 * 보일 때 · 10분마다 `/api/release` 에 묻는다. 다르면 띠 — 새로고침 · 나중에(그 표지를 덮는다). 강제로 새로고침하지 않는다.
 *
 * 이 앱의 청크를 못 받으면 곧바로 묻는다(10h-2 · 정본 ⑥) — 지연 로드는 `<script>` · `<link>` 를 붙여 받으므로 창의 포착 단계 `error` 로
 * 그 실패를 한곳에서 본다(자원의 `error` 는 거품이 일지 않는다 — 포착 단계에서만 창에 닿는다). 30초에 한 번.
 */

import { useEffect, useState } from 'react'

import { RELEASE_CHECK_INTERVAL_MS, normalizeRelease, shouldCheckOnAssetError, shouldShowBanner } from '@/lib/platform/release'

/** 이 문서가 실려 온 표지 — 브라우저에서 처음 받은 것을 문서가 끝날 때까지 쥔다(모듈은 서버에서도 돌므로 효과 안에서만 정한다). */
let loaded: string | null | undefined

export function ReleaseWatcher({ release }: { release: string | null }) {
  const [current, setCurrent] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    loaded ??= release
  }, [release])

  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const res = await fetch('/api/release', { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { release?: unknown }
        if (alive) setCurrent(normalizeRelease(body.release))
      } catch {
        // 오프라인 · 서버가 바뀌는 중 — 다음에 다시 묻는다
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(() => void check(), RELEASE_CHECK_INTERVAL_MS)
    // 앱의 청크를 못 받았다(10h-2) — 배포 뒤 옛 청크가 지워졌을 수 있다
    let lastAssetCheck: number | null = null
    const onResourceError = (event: Event) => {
      const target = event.target
      const url = target instanceof HTMLScriptElement ? target.src : target instanceof HTMLLinkElement ? target.href : null
      const now = Date.now()
      if (url === null || !shouldCheckOnAssetError(url, window.location.origin, lastAssetCheck, now)) return
      lastAssetCheck = now
      void check()
    }
    window.addEventListener('error', onResourceError, true)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timer)
      window.removeEventListener('error', onResourceError, true)
    }
  }, [])

  if (!shouldShowBanner(loaded ?? null, current, dismissed)) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="release-banner"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    >
      <span>새 버전이 있습니다 — 새로고침하면 받습니다</span>
      <button
        type="button"
        data-testid="release-reload"
        className="rounded bg-neutral-900 px-2 py-1 text-white dark:bg-neutral-100 dark:text-neutral-900"
        onClick={() => window.location.reload()}
      >
        새로고침
      </button>
      <button type="button" data-testid="release-later" className="text-neutral-500" onClick={() => setDismissed(current)}>
        나중에
      </button>
    </div>
  )
}
