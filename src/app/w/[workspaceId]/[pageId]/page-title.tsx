'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 페이지 제목 편집.
 *
 * **아직 Tiptap 이 아니다.** 제목도 rich text 이지만(정본: `properties.title` 은
 * RichText[]) MVP 의 제목에 서식을 넣는 UI 는 없다. 그래서 평문 input 으로 두고
 * 서버에서 `titleFromPlainText()` 로 감싼다 — 저장 포맷은 처음부터 RichText[] 다.
 * 나중에 제목에 서식이 필요해지면 화면만 바꾸면 되고 데이터는 그대로다.
 *
 * 저장은 **blur 와 Enter** 에서만 한다. 타이핑마다 PATCH 를 보내면 `version` 이
 * 글자 수만큼 올라가고(X-6: 검색 인덱스의 external version) 인덱서가 같은
 * 페이지를 수십 번 다시 읽는다.
 */
export function PageTitle({
  workspaceId,
  pageId,
  initialTitle,
}: {
  workspaceId: string
  pageId: string
  initialTitle: string
}) {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle)
  const [error, setError] = useState<string | null>(null)
  /** 마지막으로 서버에 반영된 값. 같으면 PATCH 를 보내지 않는다. */
  const saved = useRef(initialTitle)

  // 다른 곳에서 제목이 바뀌어 서버 렌더가 새 값을 주면 따라간다.
  // 단 편집 중인 값을 덮어쓰지 않도록 저장된 값이 달라졌을 때만 반영한다.
  useEffect(() => {
    if (initialTitle !== saved.current) {
      saved.current = initialTitle
      setTitle(initialTitle)
    }
  }, [initialTitle])

  async function save() {
    const next = title.trim()
    if (next === saved.current) return
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: next }),
      })
      if (!res.ok) {
        setError('제목을 저장하지 못했습니다.')
        return
      }
      saved.current = next
      // 사이드바·breadcrumb 이 서버 렌더이므로 갱신이 필요하다.
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    }
  }

  return (
    <div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          // IME 조합 중 Enter 는 IME 가 먼저 소비해야 한다 — 조합 확정 전에
          // 우리가 가로채면 한글 마지막 글자가 사라진다(F-01-19 · F-12-01).
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
        maxLength={2000}
        aria-label="페이지 제목"
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
