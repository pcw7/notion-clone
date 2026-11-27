'use client'

/**
 * 독립 창의 뒤로 · 앞으로 (59번 트랙 NV-3 · F-07-12) — 브라우저의 단추가 없는 창에서만 상단 바의 경로 앞에 선다
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강 NV-0] ⑪ [NV-3 고침] ⓒ
 *
 *   · 보이기 — CSS 의 미디어 질의(`standalone:` — globals.css 의 `display-mode: standalone`)가 가른다. 서버가 그린 그대로 · 수화 전에도
 *     깜빡이지 않는다 · 브라우저 탭에서는 숨는다(브라우저의 단추가 있다 — 두 벌 두지 않는다).
 *   · 누르기 — 단축키(NV-1 `Ctrl/Cmd + [ · ]`)와 같은 일: 브라우저 히스토리를 한 칸(앱의 스택이 없다 · ①). 끝이면 꺼진다 — Navigation API 의
 *     `canGoBack · canGoForward`(③ — 이 탭의 첫 앱 항목에서 앱 밖으로 나가지 않는다). 항목이 바뀔 때마다(`currententrychange`) 다시 읽는다.
 *     API 가 없는 브라우저는 켜 둔다(브라우저에 맡긴다 — ③ 과 같다).
 */

import { useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'

import { mayStep } from '@/lib/nav/nav-keys'
import { historyReach } from './nav-shortcut'

/** Navigation API 의 항목 바뀜만 — TypeScript 의 DOM 타입에 아직 없다. */
type NavigationEvents = {
  addEventListener: (type: 'currententrychange', listener: () => void) => void
  removeEventListener: (type: 'currententrychange', listener: () => void) => void
}

function subscribe(onChange: () => void): () => void {
  const navigation = (window as { navigation?: NavigationEvents }).navigation
  if (navigation === undefined) return () => undefined
  navigation.addEventListener('currententrychange', onChange)
  return () => navigation.removeEventListener('currententrychange', onChange)
}

const canBack = (): boolean => mayStep('back', historyReach())
const canForward = (): boolean => mayStep('forward', historyReach())
// 서버는 히스토리를 모른다 — 켜 둔 채 그리고 수화한 뒤 맞춘다(단추는 독립 창에서만 보인다)
const serverReach = (): boolean => true

const BUTTON =
  'grid h-7 w-7 place-items-center rounded-md text-base text-neutral-500 hover:bg-[rgba(33,27,23,0.05)] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-white/5'

export function StandaloneNav() {
  const router = useRouter()
  const back = useSyncExternalStore(subscribe, canBack, serverReach)
  const forward = useSyncExternalStore(subscribe, canForward, serverReach)
  const step = (direction: 'back' | 'forward'): void => {
    // 누르는 순간 다시 묻는다 — 그린 뒤에 항목이 바뀌었을 수 있다
    if (!mayStep(direction, historyReach())) return
    if (direction === 'back') router.back()
    else router.forward()
  }
  return (
    <div role="group" aria-label="뒤로 · 앞으로" data-testid="standalone-nav" className="hidden flex-none items-center standalone:flex">
      <button type="button" data-testid="standalone-back" aria-label="뒤로" title="뒤로 (Ctrl/Cmd + [)" disabled={!back} onClick={() => step('back')} className={BUTTON}>
        <span aria-hidden>←</span>
      </button>
      <button type="button" data-testid="standalone-forward" aria-label="앞으로" title="앞으로 (Ctrl/Cmd + ])" disabled={!forward} onClick={() => step('forward')} className={BUTTON}>
        <span aria-hidden>→</span>
      </button>
    </div>
  )
}
