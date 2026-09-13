'use client'

/**
 * 표 이름 — F-04-14 (*"풀페이지: … 페이지 아이콘·커버·제목을 그대로 사용한다"*)
 *
 * `page-title.tsx` 와 같은 규칙이다. 저장은 **blur 와 Enter** 에서만 한다 — 이름이
 * 두 곳에 쓰이므로(`renameDatabase` 머리말) 타이핑마다 보내면 두 행을 글자 수만큼
 * 고친다.
 *
 * 고칠 수 없는 사람에게는 입력칸을 주지 않는다. F-04-01: *"비활성 표시보다
 * 미노출이 안전."*
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { renameDatabase } from './table-api'

export function DatabaseTitle({
  workspaceId,
  databaseId,
  initialName,
  canEdit,
}: {
  workspaceId: string
  databaseId: string
  initialName: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  /** 마지막으로 서버에 반영된 값. 같으면 보내지 않는다. */
  const saved = useRef(initialName)

  // 다른 곳에서 이름이 바뀌어 서버 렌더가 새 값을 주면 따라간다. 편집 중인 값을
  // 덮어쓰지 않도록 저장된 값이 달라졌을 때만 반영한다.
  useEffect(() => {
    if (initialName !== saved.current) {
      saved.current = initialName
      setName(initialName)
    }
  }, [initialName])

  if (!canEdit) {
    return (
      <h1 className="text-4xl font-bold tracking-tight">
        {initialName || <span className="text-neutral-300 dark:text-neutral-700">제목 없음</span>}
      </h1>
    )
  }

  async function save() {
    const next = name.replace(/\s+/g, ' ').trim()
    if (next === saved.current) return
    setError(null)
    const result = await renameDatabase(workspaceId, databaseId, next)
    if (!result.ok) {
      setError(result.message)
      return
    }
    saved.current = next
    // 사이드바·breadcrumb 이 서버 렌더다.
    router.refresh()
  }

  return (
    <div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          // IME 조합 중 Enter 는 조합 확정이다. 가로채면 마지막 글자가 사라진다.
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            setName(saved.current)
            e.currentTarget.blur()
          }
        }}
        placeholder="제목 없음"
        maxLength={200}
        aria-label="데이터베이스 이름"
        className="w-full bg-transparent text-4xl font-bold tracking-tight outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-700"
      />
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
