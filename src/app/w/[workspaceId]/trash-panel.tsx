'use client'

/**
 * 휴지통 패널 — F-11-05.
 *
 * 목록에는 **삭제 루트만** 나온다(서버가 그렇게 준다). 각 행에서 복원 또는
 * 영구 삭제를 한다.
 *
 * F-11-05 가 짚은 빈 상태 규칙을 지킨다: *"휴지통이 비어 있을 때와 검색 결과
 * 0건을 **구분해** 표시할 것(같은 문구를 쓰면 사용자가 검색어를 의심하지 않는다)."*
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

export type TrashRow = {
  id: string
  title: string
  trashedAt: string
  purgeAfter: string | null
  descendantCount: number
}

const UNTITLED = '제목 없음'

/** 남은 보관 일수. 지났으면 0. */
function daysLeft(purgeAfter: string | null): number | null {
  if (purgeAfter === null) return null
  const ms = new Date(purgeAfter).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

export function TrashPanel({
  workspaceId,
  entries,
}: {
  workspaceId: string
  entries: TrashRow[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (q === '') return entries
    return entries.filter((e) => (e.title || UNTITLED).toLowerCase().includes(q))
  }, [entries, filter])

  async function act(id: string, kind: 'restore' | 'purge') {
    if (kind === 'purge') {
      // 영구 삭제는 되돌릴 수 없다 — 여기만 확인을 받는다.
      const okToGo = window.confirm('영구 삭제하면 목록에서 사라집니다. 계속할까요?')
      if (!okToGo) return
    }

    setBusyId(id)
    setMessage(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages/${id}/trash`, {
        method: kind === 'restore' ? 'DELETE' : 'PUT',
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.message ?? '처리하지 못했습니다.')
        return
      }
      if (kind === 'restore') {
        setMessage(
          data.reparented === true
            ? '원래 위치가 사라져 최상위로 복원했습니다.'
            : '복원했습니다.',
        )
      }
      router.refresh()
    } catch {
      setMessage('연결에 실패했습니다.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="self-start text-sm font-medium text-neutral-500 hover:underline underline-offset-4"
      >
        휴지통 {entries.length > 0 && `(${entries.length})`}
      </button>

      {open && (
        <div className="rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
          {entries.length > 0 && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="삭제된 페이지 검색"
              aria-label="휴지통 검색"
              className="mb-2 w-full rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300"
            />
          )}

          {entries.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-neutral-400">
              휴지통이 비어 있습니다
            </p>
          ) : rows.length === 0 ? (
            // ★ 빈 휴지통과 다른 문구여야 한다 — 같으면 사용자가 검색어를 의심하지 않는다.
            <p className="px-2 py-4 text-center text-sm text-neutral-400">
              검색 결과가 없습니다
            </p>
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {rows.map((e) => {
                const left = daysLeft(e.purgeAfter)
                return (
                  <li key={e.id} className="flex items-center justify-between gap-2 px-1 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{e.title || UNTITLED}</p>
                      <p className="text-xs text-neutral-400">
                        {e.descendantCount > 0 && `하위 ${e.descendantCount}개 포함 · `}
                        {left === null ? '보관 기한 없음' : `${left}일 남음`}
                      </p>
                    </div>
                    <div className="flex flex-none gap-1">
                      <button
                        type="button"
                        disabled={busyId === e.id}
                        onClick={() => void act(e.id, 'restore')}
                        className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700"
                      >
                        복원
                      </button>
                      <button
                        type="button"
                        disabled={busyId === e.id}
                        onClick={() => void act(e.id, 'purge')}
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 disabled:opacity-40 dark:border-red-900"
                      >
                        영구 삭제
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {message && (
            <p role="status" className="mt-2 px-1 text-xs text-neutral-500">
              {message}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
