'use client'

/**
 * Updates 패널 — 머리의 "업데이트" 단추와 그 페이지의 활동 목록 (히스토리 · 활동 4d-3 · F-11-04)
 *
 * 노션의 `···` → Updates & analytics 의 Updates 탭이다(Analytics 는 두지 않는다 — 정본 §3.8 [보강] Updates 패널). 열 때 읽는다 —
 * 실시간으로 따라오지 않고, 다시 열면 다시 읽는다(⑦). 최신순 30개씩, "더 보기"로 이어 읽는다(③).
 *
 * 판정은 전부 서버에 있다 — 무엇이 보이고 이름 · 목적지를 줄지는 서버가 정했다(① ② ④ ⑤). 이 파일은 목록과 호출만 한다(코멘트 패널과
 * 같은 규칙). 여러 번 열고 닫으면 **마지막 요청의 답만** 받는다(인박스와 같은 번호 매기기 — 4c-3).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { PageActivityType } from '@/lib/notification/page-activity'
import { formatVersionTime } from '@/lib/history/format'
import { ACTIVITY_ERRORS, activityActorLabel, activityLine } from './activity-messages'

type Item = {
  readonly id: string
  readonly type: PageActivityType
  readonly at: string
  readonly actor: { readonly id: string; readonly name: string; readonly deleted: boolean } | null
  readonly movedTo: { readonly id: string; readonly title: string } | null
}

type Listed = { readonly items: readonly Item[]; readonly nextCursor: string | null }

export function PageUpdatesButton({ workspaceId, pageId }: { workspaceId: string; pageId: string }) {
  const [open, setOpen] = useState(false)
  const [listed, setListed] = useState<Listed | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ticket = useRef(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const load = useCallback(
    async (cursor: string | null) => {
      const mine = ++ticket.current
      setLoading(true)
      setError(null)
      try {
        const url = `/api/workspaces/${workspaceId}/pages/${pageId}/activity${cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`}`
        const res = await fetch(url)
        const body = (await res.json().catch(() => ({}))) as Partial<Listed> & { error?: string }
        if (mine !== ticket.current) return
        if (!res.ok || !Array.isArray(body.items)) {
          setError(ACTIVITY_ERRORS[body.error ?? ''] ?? '업데이트를 읽지 못했습니다.')
          return
        }
        const items = body.items
        setListed((prev) => ({
          items: cursor === null || prev === null ? items : [...prev.items, ...items],
          nextCursor: body.nextCursor ?? null,
        }))
      } catch {
        if (mine === ticket.current) setError('업데이트를 읽지 못했습니다.')
      } finally {
        if (mine === ticket.current) setLoading(false)
      }
    },
    [workspaceId, pageId],
  )

  const close = useCallback(() => {
    ticket.current++
    setOpen(false)
    setLoading(false)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="page-updates-open"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            close()
            return
          }
          setOpen(true)
          setListed(null)
          void load(null)
        }}
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        업데이트
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="업데이트"
          data-testid="page-updates"
          className="absolute right-0 z-20 mt-2 flex max-h-[32rem] w-80 flex-col gap-2 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <h2 className="text-sm font-semibold">업데이트</h2>
          {error !== null && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {listed !== null && listed.items.length === 0 && (
            <p data-testid="page-updates-empty" className="text-xs text-neutral-500">
              아직 활동이 없습니다.
            </p>
          )}
          {listed !== null && listed.items.length > 0 && (
            <ol className="flex flex-col gap-2" aria-label="활동">
              {listed.items.map((item) => (
                <li key={item.id} data-testid="page-update-item" data-type={item.type} className="text-xs">
                  <span className="font-medium">{activityActorLabel(item.actor)}</span>
                  <span className="text-neutral-700 dark:text-neutral-300"> — {activityLine(item)}</span>
                  <time dateTime={item.at} className="block text-neutral-500">
                    {formatVersionTime(item.at)}
                  </time>
                </li>
              ))}
            </ol>
          )}
          {loading && <p className="text-xs text-neutral-500">읽는 중…</p>}
          {!loading && listed?.nextCursor && (
            <button
              type="button"
              data-testid="page-updates-more"
              onClick={() => void load(listed.nextCursor)}
              className="self-start rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              더 보기
            </button>
          )}
        </div>
      )}
    </div>
  )
}
