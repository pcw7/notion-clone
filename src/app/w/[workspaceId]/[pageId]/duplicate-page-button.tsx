'use client'

/**
 * "복제" — 페이지와 하위 트리 전체를 사본으로 (복제 6b조각 · F-02-09)
 *
 * 누르면 한 번에 끝난다. 확인을 묻지 않는다 — **되돌릴 수 있기 때문**이다(사본을 지우면 된다 · `delete-page-button.tsx`
 * 와 같은 판단). 대신 **빠진 것이 있으면 말하고 멈춘다**(`duplicate-page.ts` 머리말).
 *
 * 볼 수만 있는 사람도 누를 수 있다 — 복제는 원본을 고치지 않는다. 사본이 들어갈 자리를 만들 수 없으면 서버가 거부하고
 * 그 이유가 여기 뜬다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { requestDuplicate, type DuplicateNote } from '../duplicate-page'

export function DuplicatePageButton({ workspaceId, pageId }: { workspaceId: string; pageId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ readonly pageId: string; readonly note: DuplicateNote } | null>(null)

  async function duplicate() {
    setBusy(true)
    setError(null)
    setDone(null)
    const result = await requestDuplicate(workspaceId, pageId)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    // 사이드바의 트리에 사본이 서야 한다 — 옮겨 가지 않는 경우에도.
    router.refresh()
    if (result.note.navigate) {
      router.push(`/w/${workspaceId}/${result.pageId}`)
      return
    }
    setDone(result)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void duplicate()}
        disabled={busy}
        data-testid="page-duplicate"
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {busy ? '복제 중…' : '복제'}
      </button>
      {done?.note.text && (
        <p role="status" data-testid="page-duplicate-note" className="max-w-64 text-right text-xs text-neutral-500">
          {done.note.text}{' '}
          <button
            type="button"
            onClick={() => router.push(`/w/${workspaceId}/${done.pageId}`)}
            data-testid="page-duplicate-open"
            className="underline underline-offset-2"
          >
            사본 열기
          </button>
        </p>
      )}
      {error && (
        <p role="alert" data-testid="page-duplicate-error" className="max-w-64 text-right text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
