'use client'

/**
 * 볼 수 없는 페이지의 화면 — 접근 요청 (7e-1 · F-06-15)
 *
 * 서버가 "요청할 수 있는 페이지"라고 정한 뒤에만 온다(`page.tsx` — `noAccessState`). 제목도 경로도 싣지 않는다 — 이 화면이
 * 알려 주는 것은 "그 주소의 페이지가 있다"뿐이다(정본 §3.3 [보강] 접근 요청 ②).
 *
 * 이미 요청했으면(대기 중 · 하루 안에 무시됨) 버튼 대신 "보냈습니다"다 — 무시를 드러내지 않는다(같은 [보강] ③).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { NO_ACCESS_HINT, NO_ACCESS_TITLE, REQUEST_SENT, accessRequestFailureMessage } from '../access-request-messages'

export function NoAccess({
  workspaceId,
  pageId,
  requested,
}: {
  workspaceId: string
  pageId: string
  requested: boolean
}) {
  const router = useRouter()
  const [sent, setSent] = useState(requested)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function request(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/access-requests`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown }
      if (res.ok) {
        setSent(true)
        return
      }
      // 그 사이에 볼 수 있게 됐다 — 페이지를 다시 그린다.
      if (data.error === 'has_access') {
        router.refresh()
        return
      }
      setError(accessRequestFailureMessage(data.error))
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      data-testid="no-access"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 py-12 text-center"
    >
      <h1 className="text-lg font-semibold">{NO_ACCESS_TITLE}</h1>
      {sent ? (
        <p data-testid="access-requested" role="status" className="text-sm text-neutral-500">
          {REQUEST_SENT}
        </p>
      ) : (
        <>
          <p className="text-sm text-neutral-500">{NO_ACCESS_HINT}</p>
          <button
            type="button"
            data-testid="access-request"
            disabled={busy}
            onClick={() => void request()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            접근 요청
          </button>
        </>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </main>
  )
}
