'use client'

/**
 * "삭제" — 휴지통으로 보낸다 (F-11-05).
 *
 * 확인 대화상자를 띄우지 않는다. 삭제가 **되돌릴 수 있기 때문**이다 —
 * 30일간 휴지통에 남는다. 대신 하위 페이지가 함께 딸려가는 경우에만 개수를
 * 먼저 알려준다(그건 사용자가 모르고 있을 수 있는 정보다).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function DeletePageButton({
  workspaceId,
  pageId,
  childCount,
  parentPageId,
}: {
  workspaceId: string
  pageId: string
  /** 직접 하위 페이지 수. 0이면 경고 없이 바로 보낸다. */
  childCount: number
  /** 삭제 후 돌아갈 곳. 루트 페이지면 null → 워크스페이스 홈. */
  parentPageId: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    if (childCount > 0) {
      const okToGo = window.confirm(
        `하위 페이지 ${childCount}개도 함께 휴지통으로 이동합니다. 계속할까요?`,
      )
      if (!okToGo) return
    }

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/trash`, {
        method: 'POST',
      })
      if (!res.ok) {
        setError('삭제하지 못했습니다.')
        return
      }
      // 삭제한 페이지에 그대로 머무르면 404 가 뜬다. 부모로 돌려보낸다.
      router.push(parentPageId ? `/w/${workspaceId}/${parentPageId}` : `/w/${workspaceId}`)
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void remove()}
        disabled={busy}
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {busy ? '삭제 중…' : '삭제'}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
