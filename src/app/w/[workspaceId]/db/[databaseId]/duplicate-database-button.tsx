'use client'

/**
 * 데이터베이스의 "복제" — 내용과 함께 · 내용 없이 (29번 트랙 D-4 · 노션의 Duplicate · Duplicate without content)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 D-1]
 *
 * 누르면 두 갈래를 고르는 작은 목록이 열린다. 확인을 묻지 않는다 — 되돌릴 수 있다(사본을 지우면 된다 · 페이지 복제와 같은 판단). **말할 것이
 * 있으면 멈춰서 말한다**(한쪽이 된 관계 · 빠진 하위 페이지 — `duplicate-page.ts`). 없으면 사본의 데이터베이스 화면으로 옮겨 간다.
 */

import { startTransition, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { TOPBAR_BUTTON } from '../../topbar-style'
import { requestDatabaseDuplicate, type DuplicateNote } from '../../duplicate-page'

export function DuplicateDatabaseButton({ workspaceId, databaseId }: { workspaceId: string; databaseId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ readonly id: string; readonly note: DuplicateNote } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // 바깥을 누르면 목록을 닫는다
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open])

  async function duplicate(content: boolean) {
    setOpen(false)
    setBusy(true)
    setError(null)
    setDone(null)
    const result = await requestDatabaseDuplicate(workspaceId, databaseId, content)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    // 옮겨 가면 옮긴 뒤에 새로 읽는다(사이드바에 사본이 서야 한다 — 페이지 복제와 같은 순서)
    if (result.note.navigate) {
      startTransition(() => {
        router.push(`/w/${workspaceId}/db/${result.pageId}`)
        router.refresh()
      })
      return
    }
    router.refresh()
    setDone({ id: result.pageId, note: result.note })
  }

  return (
    <div ref={rootRef} className="relative flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="db-duplicate"
        className={TOPBAR_BUTTON}
      >
        {busy ? '복제 중…' : '복제'}
      </button>
      {open && (
        <div role="menu" aria-label="데이터베이스 복제" data-testid="db-duplicate-menu" className="absolute right-0 top-full z-30 mt-1 flex w-44 flex-col popover-surface p-1 text-sm">
          <button type="button" role="menuitem" data-testid="db-duplicate-with" onClick={() => void duplicate(true)}
            className="rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">
            복제
          </button>
          <button type="button" role="menuitem" data-testid="db-duplicate-without" onClick={() => void duplicate(false)}
            className="rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">
            내용 없이 복제
          </button>
        </div>
      )}
      {done?.note.text && (
        <p role="status" data-testid="db-duplicate-note" className="max-w-64 text-right text-xs text-neutral-500">
          {done.note.text}{' '}
          <button type="button" onClick={() => router.push(`/w/${workspaceId}/db/${done.id}`)} data-testid="db-duplicate-open" className="underline underline-offset-2">
            사본 열기
          </button>
        </p>
      )}
      {error && (
        <p role="alert" data-testid="db-duplicate-error" className="max-w-64 text-right text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
