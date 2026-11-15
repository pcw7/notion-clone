'use client'

/**
 * "오프라인으로 쓰기" 스위치 — 이 기기에 페이지를 내려받고 지운다 (OF-2 · F-12-04 · 정본 §3.7 [보강 OF-1] ②)
 *
 * 페이지 메뉴를 열 때에야 받는 청크다(`offline-toggle.tsx`) — 페이지 화면의 첫 JS 를 늘리지 않는다.
 *
 *   - **켜기** — 라우트에서 본문 상태 · 제목 · 아이콘 · 커버 · 서버 판을 받아 IndexedDB 에 둔다(까닭 `toggled`) → 껍데기 안에서 오프라인
 *     편집기의 청크를 받아 둔다(`offline-warm.ts` — 받아 두지 않으면 네트워크 없이 열 수 없다). 진행은 아래 줄이 말한다
 *   - **끄기** — 까닭 `toggled` 를 뺀다 · 남은 까닭이 없으면 사본을 지운다(F-12-04 의 GC). 보존본(확인받지 못한 편집)은 지우지 않는다 —
 *     연결된 채 이 페이지를 열면 보낸다
 *   - 서버가 거부하면(정책 · 없는 페이지) 까닭을 말하고 꺼진 채 둔다. IndexedDB 를 못 쓰는 브라우저면 스위치를 끄고 그렇게 말한다
 */

import { useEffect, useRef, useState } from 'react'

import { openOfflineStore, offlineRecord, parseOfflinePayload } from '@/lib/offline/offline-store'
import { warmOfflineEditor } from '@/lib/offline/offline-warm'

import { offlineDownloadError } from './offline-messages'
import { MENU_ROW } from './page-menu'

type Phase = 'checking' | 'off' | 'on' | 'downloading' | 'removing' | 'unavailable'

export function OfflineSwitch({ workspaceId, pageId, userId }: { workspaceId: string; pageId: string; userId: string }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [status, setStatus] = useState('')
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void (async () => {
      const store = await openOfflineStore()
      if (store === null) {
        if (alive.current) setPhase('unavailable')
        return
      }
      try {
        const record = await store.get(userId, pageId)
        if (alive.current) setPhase(record?.reasons.includes('toggled') ? 'on' : 'off')
      } catch {
        if (alive.current) setPhase('unavailable')
      } finally {
        store.close()
      }
    })()
    return () => {
      alive.current = false
    }
  }, [userId, pageId])

  const say = (next: Phase, message: string): void => {
    if (!alive.current) return
    setPhase(next)
    setStatus(message)
  }

  const turnOn = async (): Promise<void> => {
    say('downloading', '내려받는 중…')
    const store = await openOfflineStore()
    if (store === null) return say('unavailable', '')
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/offline`, { cache: 'no-store' })
      const body: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null
        return say('off', offlineDownloadError(res.status, typeof error === 'string' ? error : null))
      }
      const payload = parseOfflinePayload(body)
      if (payload === null) return say('off', offlineDownloadError(res.status, null))
      const previous = await store.get(userId, pageId)
      await store.put(offlineRecord(payload, { userId, workspaceId, reason: 'toggled', now: Date.now(), previous }))
      say('downloading', '편집기를 받아 두는 중…')
      const warmed = await warmOfflineEditor()
      say(
        'on',
        warmed
          ? '이 기기에 내려받았습니다 — 네트워크 없이 열 수 있습니다.'
          : '이 기기에 내려받았습니다 — 다만 편집기를 받아 두지 못해 네트워크 없이는 열리지 않을 수 있습니다.',
      )
    } catch {
      say('off', '연결에 실패했습니다.')
    } finally {
      store.close()
    }
  }

  const turnOff = async (): Promise<void> => {
    say('removing', '지우는 중…')
    const store = await openOfflineStore()
    if (store === null) return say('unavailable', '')
    try {
      const left = await store.release(userId, pageId, 'toggled')
      say('off', left === null ? '이 기기에서 지웠습니다.' : '스위치를 껐습니다 — 자동 내려받기가 남겨 둔 사본은 그대로입니다.')
    } catch {
      say('on', '지우지 못했습니다.')
    } finally {
      store.close()
    }
  }

  const on = phase === 'on' || phase === 'removing'
  const busy = phase === 'checking' || phase === 'downloading' || phase === 'removing'
  return (
    <div className="flex flex-col">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-busy={busy}
        disabled={busy || phase === 'unavailable'}
        data-testid="offline-toggle"
        data-state={phase}
        onClick={() => void (on ? turnOff() : turnOn())}
        className={`${MENU_ROW} justify-between`}
      >
        오프라인으로 쓰기
        <span aria-hidden className={`relative h-3.5 w-6 rounded-full transition-colors ${on ? 'bg-green-600' : 'bg-neutral-300 dark:bg-neutral-600'}`}>
          <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${on ? 'left-3' : 'left-0.5'}`} />
        </span>
      </button>
      {(status !== '' || phase === 'unavailable') && (
        <p role="status" data-testid="offline-status" className="whitespace-normal px-2 pb-1 text-xs leading-snug text-neutral-500">
          {phase === 'unavailable' ? '이 브라우저에서는 오프라인으로 저장할 수 없습니다.' : status}
        </p>
      )}
    </div>
  )
}
