'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 페이지를 만들고 바로 그 페이지로 이동한다.
 *
 * 노션도 그렇게 동작한다 — "새 페이지"는 목록에 항목을 추가하는 것이 아니라
 * 빈 페이지를 열어 제목 입력에 캐럿을 두는 것이다. 제목을 미리 묻지 않는다.
 */
export function NewPageButton({
  workspaceId,
  parentPageId = null,
  label = '새 페이지',
}: {
  workspaceId: string
  parentPageId?: string | null
  label?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentPageId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(
          data.error === 'too_deep'
            ? '더 깊은 하위 페이지를 만들 수 없습니다.'
            : '만들지 못했습니다.',
        )
        return
      }
      startTransition(() => {
        router.push(`/w/${workspaceId}/${data.page.id}`)
        router.refresh()
      })
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={create}
        disabled={busy || pending}
        className="self-start rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        {busy || pending ? '만드는 중…' : `+ ${label}`}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
