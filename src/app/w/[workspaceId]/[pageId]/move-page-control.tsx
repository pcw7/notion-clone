'use client'

/**
 * "이동" — F-02-08 의 목적지 피커.
 *
 * 사이드바 드래그 앤 드롭(W5-b)이 같은 연산의 다른 진입점이 된다. 그래서
 * 이 컴포넌트는 **목록과 호출만** 하고, 어디로 옮길 수 있는지는 서버가 정한다
 * (`listMovableTargets`). 자손 제외 규칙이 화면과 서버 양쪽에 있으면
 * 언젠가 어긋나고, 그때 화면은 고를 수 있는데 서버는 거부하는 상태가 된다.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

export type MoveTargetOption = {
  id: string
  title: string
  ancestors: string[]
}

const UNTITLED = '제목 없음'

export function MovePageControl({
  workspaceId,
  pageId,
  currentParentId,
  targets,
}: {
  workspaceId: string
  pageId: string
  currentParentId: string | null
  targets: MoveTargetOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** id → 제목. 경로 라벨을 만들 때 쓴다. */
  const titleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of targets) map.set(t.id, t.title || UNTITLED)
    return map
  }, [targets])

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const withPath = targets.map((t) => ({
      ...t,
      label: t.title || UNTITLED,
      // 후보의 조상은 전부 후보 안에 있다(listMovableTargets 주석 참조).
      path: t.ancestors.map((a) => titleById.get(a) ?? UNTITLED).join(' / '),
    }))
    if (q === '') return withPath
    return withPath.filter(
      (t) => t.label.toLowerCase().includes(q) || t.path.toLowerCase().includes(q),
    )
  }, [targets, filter, titleById])

  async function move(targetParentId: string | null) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetParentId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(
          data.error === 'too_deep' ? '그 위치로 옮기면 깊이 제한을 넘습니다.'
          : data.error === 'cycle' ? '자기 하위 페이지 안으로는 옮길 수 없습니다.'
          : '옮기지 못했습니다.',
        )
        return
      }
      setOpen(false)
      setFilter('')
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        이동
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="페이지 검색"
            aria-label="이동할 위치 검색"
            className="mb-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300"
          />

          <ul className="max-h-64 overflow-auto">
            {currentParentId !== null && (
              <li>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void move(null)}
                  className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
                >
                  최상위로 꺼내기
                </button>
              </li>
            )}

            {rows.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={busy || t.id === currentParentId}
                  onClick={() => void move(t.id)}
                  className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
                >
                  {t.label}
                  {t.id === currentParentId && (
                    <span className="ml-2 text-xs text-neutral-400">현재 위치</span>
                  )}
                  {t.path !== '' && (
                    <span className="block truncate text-xs text-neutral-400">{t.path}</span>
                  )}
                </button>
              </li>
            ))}

            {rows.length === 0 && (
              <li className="px-2 py-3 text-center text-sm text-neutral-400">
                옮길 수 있는 페이지가 없습니다
              </li>
            )}
          </ul>

          {error && (
            <p role="alert" className="mt-1 px-2 text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
