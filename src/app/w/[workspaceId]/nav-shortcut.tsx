'use client'

/**
 * 이동 단축키 (59번 트랙 NV-1 · F-07-12) — 그리는 것이 없다
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강 NV-0] ① ② ③ ④
 *
 *   · `NavShortcut`(레이아웃 — 워크스페이스 안 어디서나) — `Ctrl/Cmd + [` 뒤로 · `Ctrl/Cmd + ]` 앞으로. 히스토리는 브라우저의 것 하나다(앱의
 *     스택이 없다 — 브라우저 뒤로 단추와 늘 같다). 이 탭의 첫 앱 항목이면 아무것도 하지 않는다(③ — 앱 밖으로 나가지 않게). 키는 끝에서도
 *     막는다(맥의 브라우저는 `Cmd+[` 를 스스로 뒤로 보낸다).
 *   · `NavUpShortcut`(경로가 있는 화면 — 페이지 · 데이터베이스 · 템플릿) — `Ctrl/Cmd + Shift + U` 가 경로 줄의 바로 위 칸으로(④). 갈 곳은 서버가
 *     권한으로 거른 줄에서 나온다 — 여기서 새로 판정하지 않는다.
 *
 * 링크 복사(`Ctrl/Cmd + L` · ⑤)는 팔레트의 "링크 복사"와 같은 일이라 그 알림과 함께 검색 오버레이에 있다(`search-overlay.tsx`).
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { mayStep, navKeyOf, type HistoryReach } from '@/lib/nav/nav-keys'

/** Navigation API(TypeScript 의 DOM 타입에 아직 없다) — 읽는 것만. */
type NavigationLike = { readonly canGoBack: boolean; readonly canGoForward: boolean }

/** 이 탭의 같은 출처 히스토리가 어디까지 닿는가 — API 가 없는 브라우저면 null. 안내 화면의 "뒤로"(NV-2 · `notice-back.tsx`)도 쓴다. */
export function historyReach(): HistoryReach {
  const navigation = (window as { navigation?: NavigationLike }).navigation
  return navigation === undefined ? null : { canGoBack: navigation.canGoBack, canGoForward: navigation.canGoForward }
}

export function NavShortcut() {
  const router = useRouter()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = navKeyOf(e)
      if (key !== 'back' && key !== 'forward') return
      e.preventDefault()
      if (!mayStep(key, historyReach())) return
      if (key === 'back') router.back()
      else router.forward()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router])

  return null
}

export function NavUpShortcut({ href }: { href: string | null }) {
  const router = useRouter()

  useEffect(() => {
    if (href === null) return
    const onKey = (e: KeyboardEvent) => {
      if (navKeyOf(e) !== 'up') return
      e.preventDefault()
      router.push(href)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [href, router])

  return null
}
