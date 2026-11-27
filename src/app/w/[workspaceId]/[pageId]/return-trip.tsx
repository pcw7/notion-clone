'use client'

/**
 * 되돌아간 자리 — 방문 기록 · 스크롤 복원 (59번 트랙 NV-2 · F-07-12) — 그리는 것이 없다
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강 NV-0] ⑦ [NV-2 고침] · ⑨ [NV-2]
 *
 *   · `VisitMark`(페이지 화면 · 피크) — 서버 렌더의 표지를 붙인다. 같은 표지를 두 번째로 붙이면 라우터가 받아 둔 렌더(뒤로 · 앞으로)를 다시 그린
 *     것이라 방문 라우트를 부른다 — 서버는 그 열기를 보지 못했다. 브라우저가 문서째 되살려도(`pageshow` 의 `persisted`) 부른다. 404(그 사이 지워졌거나
 *     볼 수 없게 됐다)면 화면을 서버에 다시 물어 안내 화면에서 멈춘다(⑥).
 *   · `ScrollRestore`(페이지 화면만) — 히스토리 항목마다 스크롤 자리를 적고, 같은 항목으로 돌아오면 본문(협업 편집기 — 늦게 붙는다)이 자라는 동안
 *     그 자리로 맞춘다. 사람이 먼저 움직이면 · 5초가 지나면 멈춘다. Navigation API 가 없는 브라우저는 브라우저에 맡긴다.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

import { createRenderMarks, createScrollMemory, restoreTarget, restoreY } from '@/lib/nav/return-trip'

/** 이 탭에서 붙인 렌더 표지 · 항목마다의 스크롤 자리 — 화면이 내려가도 남는다(돌아왔을 때 읽는다). */
const renderMarks = createRenderMarks()
const scrollMemory = createScrollMemory()

/** 복원을 지키는 시간 — 그 뒤에 자란 문서는 따라가지 않는다(늦게 뜬 그림이 사람의 자리를 옮기지 않게). */
const RESTORE_MS = 5000

/** 사람이 움직였다는 신호 — 하나라도 오면 복원을 멈춘다(사람이 이긴다). */
const HUMAN_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

/**
 * Navigation API(TypeScript 의 DOM 타입에 아직 없다) — 읽는 것만. `key` 를 쓴다 — Next 가 라우터 상태마다 `replaceState` 를 불러 `id` 는 바뀐다.
 */
type NavigationLike = { readonly currentEntry: { readonly key: string } | null }

export function VisitMark({ workspaceId, pageId, render }: { workspaceId: string; pageId: string; render: string }) {
  const router = useRouter()
  /** 이 부품이 이미 본 표지 — 개발 모드(Strict)의 두 번째 effect 를 "다시 그림" 으로 세지 않는다. */
  const handled = useRef<string | null>(null)

  useEffect(() => {
    const record = (): void => {
      void fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/visit`, { method: 'POST' })
        .then((res) => {
          // 없거나 볼 수 없다 — 받아 둔 화면을 걷고 서버의 판정(404 · 접근 요청)을 그린다
          if (res.status === 404) router.refresh()
        })
        // 기록은 편의 기능이다 — 실패해도 화면을 건드리지 않는다(`recordVisit` 머리말)
        .catch(() => undefined)
    }
    if (handled.current !== render) {
      handled.current = render
      // 처음 붙는 표지면 서버가 그 렌더에서 이미 남겼다
      if (!renderMarks.firstMount(render)) record()
    }
    const onShow = (event: PageTransitionEvent): void => {
      if (event.persisted) record()
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [workspaceId, pageId, render, router])

  return null
}

export function ScrollRestore() {
  // 레이아웃 효과 — 커밋 안에서 적어 둔 자리를 읽는다(그 뒤에 오는 브라우저의 잘린 복원 · 스크롤 사건보다 먼저)
  useLayoutEffect(() => {
    const navigation = (window as { navigation?: NavigationLike }).navigation
    const entryKey = navigation?.currentEntry?.key
    if (navigation === undefined || entryKey === undefined) return
    const path = window.location.pathname
    const target = restoreTarget(scrollMemory.recall(entryKey), path, window.location.hash)
    let restoring = target !== null

    const remember = (): void => {
      // 이 항목 · 이 화면에 있는 동안만 적는다 — 떠나는 사이의 사건이 다음 항목의 자리를 이 항목에 적지 않게
      if (!restoring && navigation.currentEntry?.key === entryKey && window.location.pathname === path) {
        scrollMemory.remember(entryKey, { y: window.scrollY, path })
      }
    }
    let observer: ResizeObserver | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const stop = (): void => {
      if (!restoring) return
      restoring = false
      observer?.disconnect()
      if (timer !== null) clearTimeout(timer)
      for (const type of HUMAN_INPUT) window.removeEventListener(type, stop, true)
      remember()
    }
    const apply = (): void => {
      if (!restoring || target === null) return
      window.scrollTo(0, restoreY(target, document.documentElement.scrollHeight, window.innerHeight))
    }

    if (restoring) {
      for (const type of HUMAN_INPUT) window.addEventListener(type, stop, { capture: true, passive: true })
      // 관찰을 걸면 다음 프레임에 한 번 오고(브라우저의 복원 뒤) · 본문이 붙어 문서가 자랄 때마다 다시 온다
      observer = new ResizeObserver(apply)
      observer.observe(document.body)
      timer = setTimeout(stop, RESTORE_MS)
      apply()
    }
    window.addEventListener('scroll', remember, { passive: true })
    return () => {
      stop()
      window.removeEventListener('scroll', remember)
    }
  }, [])

  return null
}
