'use client'

/**
 * 데이터베이스의 "오프라인으로 쓰기" 스위치 — 첫 뷰의 처음 50행을 이 기기에 읽기 전용으로 내려받고 지운다 (OF-4 · F-12-04 · 정본 §3.7 [보강 OF-1] ⑤)
 *
 * 머리의 "오프라인" 창을 열 때에야 받는 청크다(`offline-database-button.tsx`) — 데이터베이스 화면의 첫 JS 를 늘리지 않는다.
 *
 *   - **켜기** — 라우트(`GET …/databases/{id}/offline`)에서 첫 뷰의 이름 · 보이는 열 · 처음 50행의 글자를 받아 IndexedDB 에 둔다(까닭
 *     `toggled` · 페이지와 같은 저장소 · `kind: 'database'`). 껍데기의 표는 껍데기의 첫 청크에 있어 따로 받아 둘 것이 없다(페이지의 편집기와 다르다)
 *   - **끄기** — 까닭 `toggled` 를 뺀다 · 남은 까닭이 없으면 사본을 지운다(F-12-04 의 GC)
 *   - 서버가 거부하면(정책 · 없는 데이터베이스) 까닭을 말하고 꺼진 채 둔다. IndexedDB 를 못 쓰는 브라우저면 스위치를 끄고 그렇게 말한다
 */

import { useEffect, useRef, useState } from 'react'

import { offlineDatabaseRecord, openOfflineStore, parseOfflineDatabasePayload } from '@/lib/offline/offline-store'
import { OFFLINE_DATABASE_ROWS } from '@/lib/offline/offline-table'

import { offlineDownloadError } from '../../[pageId]/offline-messages'
import { MENU_ROW } from '../../[pageId]/page-menu'

type Phase = 'checking' | 'off' | 'on' | 'downloading' | 'removing' | 'unavailable'

export function OfflineDatabaseSwitch({ workspaceId, databaseId, userId }: { workspaceId: string; databaseId: string; userId: string }) {
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
        const record = await store.getDatabase(userId, databaseId)
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
  }, [userId, databaseId])

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
      const res = await fetch(`/api/workspaces/${workspaceId}/databases/${databaseId}/offline`, { cache: 'no-store' })
      const body: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null
        return say('off', offlineDownloadError(res.status, typeof error === 'string' ? error : null, '데이터베이스'))
      }
      const payload = parseOfflineDatabasePayload(body)
      if (payload === null || payload.databaseId !== databaseId) return say('off', offlineDownloadError(res.status, null, '데이터베이스'))
      const previous = await store.getDatabase(userId, databaseId)
      await store.put(offlineDatabaseRecord(payload, { userId, workspaceId, reason: 'toggled', now: Date.now(), previous }))
      say(
        'on',
        payload.truncated
          ? `처음 ${OFFLINE_DATABASE_ROWS}행을 내려받았습니다 — 네트워크 없이 볼 수 있습니다(읽기만).`
          : '이 기기에 내려받았습니다 — 네트워크 없이 볼 수 있습니다(읽기만).',
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
      const left = await store.release(userId, databaseId, 'toggled')
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
