'use client'

/**
 * 템플릿 이름 — 템플릿 6c-3조각 (F-08-02: *"제목(= 템플릿 이름) 입력"*)
 *
 * `database-title.tsx` 와 같은 규칙이다(blur · Enter 에서만 저장 · 고칠 수 없으면 입력칸을 주지 않는다).
 * **다른 것은 쓰는 길 하나**다: 템플릿은 DB 행이므로 제목의 정본이 `title` 프로퍼티의 **셀**이고,
 * `renamePage` 는 행을 거부한다(`page.ts` 의 가드 — 투영이 한쪽 방향뿐이라서다). 그래서 셀을 쓴다.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { textRun } from '@/lib/contracts/rich-text'
import { updateCell } from '../../table-api'

export function TemplateTitle({
  workspaceId,
  templateId,
  titlePropertyId,
  initialTitle,
  canEdit,
}: {
  workspaceId: string
  templateId: string
  /** 이 표의 `title` 프로퍼티. 없으면 이름을 고칠 수 없다(그런 표는 만들어지지 않는다). */
  titlePropertyId: string | null
  initialTitle: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle)
  const [error, setError] = useState<string | null>(null)
  const saved = useRef(initialTitle)

  useEffect(() => {
    if (initialTitle !== saved.current) {
      saved.current = initialTitle
      setTitle(initialTitle)
    }
  }, [initialTitle])

  if (!canEdit || titlePropertyId === null) {
    return (
      <h1 className="text-3xl font-bold tracking-tight" data-testid="template-title">
        {initialTitle || <span className="text-neutral-300 dark:text-neutral-700">제목 없음</span>}
      </h1>
    )
  }

  async function save() {
    const next = title.replace(/\s+/g, ' ').trim()
    if (next === saved.current) return
    setError(null)
    // 빈 제목은 **빈 rich text** 다(`[textRun('')]` 이 아니다) — 런 하나에 빈 글자를 담으면 계약 검증이 거부한다.
    const result = await updateCell(workspaceId, templateId, titlePropertyId as string, {
      type: 'title',
      title: next === '' ? [] : [textRun(next)],
    })
    if (!result.ok) {
      setError(result.message)
      return
    }
    saved.current = next
    // 템플릿 목록 · breadcrumb 이 서버 렌더다.
    router.refresh()
  }

  return (
    <div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          // IME 조합 중 Enter 는 조합 확정이다. 가로채면 마지막 글자가 사라진다.
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            setTitle(saved.current)
            e.currentTarget.blur()
          }
        }}
        placeholder="제목 없음"
        maxLength={200}
        aria-label="템플릿 이름"
        data-testid="template-title"
        className="w-full bg-transparent text-3xl font-bold tracking-tight outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-700"
      />
      {error && (
        <p role="alert" data-testid="template-title-error" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
