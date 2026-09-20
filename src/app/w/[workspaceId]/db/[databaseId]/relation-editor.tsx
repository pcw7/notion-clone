'use client'

/**
 * relation 칸 편집기 — 행 고르기 (relation 5b-2조각 · F-03-10 시나리오 4)
 *
 *   *"셀 클릭 → 대상 DB 페이지 검색 팝오버 → 선택. 칩 hover 시 `x`."*
 *
 * 위쪽은 지금 연결(제목 + ×), 아래쪽은 검색과 후보다. `select-editor.tsx` 와 같은 자리(칸 안)에 열리고 같은 규칙을 따른다:
 * ↑↓ · Enter 는 여기서 쓰고 `preventDefault()` 한다(표의 키 처리기는 `defaultPrevented` 를 건너뛴다). Esc · Tab 은 표에
 * 맡긴다. 목록을 누를 때 `mousedown` 의 기본 동작을 막는다 — 안 막으면 입력칸이 포커스를 잃고 표가 편집기를 닫는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 값은 집합이다 — 고를 때마다 하나를 더하고, × 마다 하나를 뺀다
 * ──────────────────────────────────────────────────────────────────────
 *
 * "이 목록으로 저장"이 없다. 그런 요청은 내가 팝오버를 열어 둔 사이 남이 더한 연결을 지운다(`relation.ts` 머리말). 고르는
 * 순간 `{ add: [id] }`, × 를 누르는 순간 `{ remove: [id] }` 가 나간다 — 저장 버튼이 없는 이유다.
 *
 * `limit: 'one'` 인 칸은 하나를 고르면 서버가 있던 연결을 그것으로 바꾼다. 그래서 **고르는 즉시 닫는다** — 더 고를 것이 없다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 제목은 서버가 거른 것만 그린다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 열 때 `GET …/relations/{propertyId}` 로 지금 연결을 **다시** 읽는다 — 칸의 칩은 캐시의 앞 25개뿐이고(그 뒤의 연결은
 * 여기서만 보인다), 볼 수 없는 연결은 제목 없이 개수만 온다(`hidden`). 방금 고른 행의 제목은 후보 목록이 갖고 있었으므로
 * 부모의 제목 맵에 바로 넣는다(`onChange` 의 둘째 인자) — 다시 묻지 않는다.
 *
 * 한글 조합 중에는 찾지 않는다 — 조합이 끝난 글자로 찾는다(멘션 메뉴와 같은 규칙 · HANDOFF §3.3-144).
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { RowJson } from '@/lib/database/http'
import * as api from './table-api'

const SEARCH_DEBOUNCE_MS = 150
const UNTITLED = '제목 없음'

export function RelationEditor({
  workspaceId,
  rowId,
  propertyId,
  propertyName,
  limit,
  align,
  onChange,
  onDone,
}: {
  workspaceId: string
  rowId: string
  propertyId: string
  propertyName: string
  limit: 'one' | 'none'
  /** 팝오버를 칸의 어느 쪽에 맞춰 여는가. List 의 속성 칸은 오른쪽에 붙어 있다. */
  align: 'left' | 'right'
  /** 연결이 바뀌었다 — 서버가 준 행과, 새로 알게 된 제목들. */
  onChange: (row: RowJson, labels: Readonly<Record<string, string>>) => void
  /** 더 고를 것이 없다(`limit: 'one'`) — 편집을 닫는다. */
  onDone: () => void
}) {
  const [linked, setLinked] = useState<readonly api.RelatedRow[] | null>(null)
  const [hidden, setHidden] = useState(0)
  const [candidates, setCandidates] = useState<readonly api.RelatedRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  /** 늦게 온 검색 응답을 버린다 — "가" 의 답이 "가나" 의 답 뒤에 오면 목록이 옛것으로 돌아간다. */
  const searchSeq = useRef(0)

  const search = async (text: string) => {
    const seq = (searchSeq.current += 1)
    const result = await api.searchCandidates(workspaceId, rowId, propertyId, text)
    if (seq !== searchSeq.current) return
    if (!result.ok) {
      setError(result.message)
      setCandidates([])
      return
    }
    setCandidates(result.value)
    setIndex(0)
  }

  // 열 때: 지금 연결. 첫 후보는 아래 효과가 읽는다(빈 검색어).
  useEffect(() => {
    inputRef.current?.focus()
    let alive = true
    void api.readRelation(workspaceId, rowId, propertyId).then((result) => {
      if (!alive) return
      if (!result.ok) {
        setError(result.message)
        setLinked([])
        return
      }
      setLinked(result.value.items)
      setHidden(result.value.hidden)
    })
    return () => {
      alive = false
    }
    // 칸이 바뀌면 부모가 key 로 새로 마운트한다 — 여기서는 열 때 한 번이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 검색어가 바뀌면 조금 기다렸다 찾는다. 조합 중에는 찾지 않는다(머리말). 빈 검색어(열 때 · 다 지웠을 때)는 기다릴
  // 이유가 없다 — 더 칠 글자를 기다리는 것이 아니다.
  useEffect(() => {
    if (composing.current) return
    const timer = setTimeout(() => void search(query), query === '' ? 0 : SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const pick = async (candidate: api.RelatedRow) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await api.linkRows(workspaceId, rowId, propertyId, { add: [candidate.id] })
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onChange(result.value, { [candidate.id]: candidate.title })
    if (limit === 'one') {
      onDone()
      return
    }
    setLinked((current) => [...(current ?? []), candidate])
    setCandidates((current) => (current ?? []).filter((c) => c.id !== candidate.id))
    inputRef.current?.focus()
  }

  const unlink = async (item: api.RelatedRow) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await api.linkRows(workspaceId, rowId, propertyId, { remove: [item.id] })
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onChange(result.value, {})
    setLinked((current) => (current ?? []).filter((l) => l.id !== item.id))
    // 뺀 행은 다시 고를 수 있는 후보다.
    void search(query)
    inputRef.current?.focus()
  }

  const list = candidates ?? []
  const active = list.length === 0 ? -1 : Math.min(index, list.length - 1)

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (list.length === 0) return
      setIndex((active + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length)
    } else if (event.key === 'Enter') {
      // ★ 표의 Enter(저장하고 아래 칸)가 아니라 이 목록의 Enter 다(`select-editor.tsx` 머리말).
      event.preventDefault()
      if (active >= 0) void pick(list[active])
    }
  }

  return (
    <div
      role="dialog"
      aria-label={`${propertyName} 연결`}
      data-testid="db-relation-editor"
      className={`absolute top-full z-20 mt-1 flex w-72 flex-col gap-1 rounded-md border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 ${
        align === 'right' ? 'right-0' : 'left-0'
      }`}
    >
      {linked !== null && (linked.length > 0 || hidden > 0) && (
        <ul aria-label="지금 연결" className="flex max-h-40 flex-col gap-0.5 overflow-auto">
          {linked.map((item) => (
            <li
              key={item.id}
              data-testid="db-relation-linked"
              className="flex items-center justify-between gap-2 rounded px-1.5 py-0.5 text-sm"
            >
              <span className="min-w-0 truncate">
                <span aria-hidden className="mr-1 text-neutral-400">
                  ↗
                </span>
                {item.title || UNTITLED}
              </span>
              <button
                type="button"
                aria-label={`${item.title || UNTITLED} 연결 끊기`}
                data-testid="db-relation-unlink"
                disabled={busy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void unlink(item)}
                className="flex-none rounded px-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                ×
              </button>
            </li>
          ))}
          {hidden > 0 && (
            <li data-testid="db-relation-editor-hidden" className="px-1.5 py-0.5 text-xs text-neutral-400">
              볼 수 없는 연결 {hidden}개
            </li>
          )}
        </ul>
      )}

      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={(e) => {
          composing.current = false
          void search(e.currentTarget.value)
        }}
        onKeyDown={onKeyDown}
        placeholder={limit === 'one' ? '행 검색 — 고르면 바뀝니다' : '행 검색'}
        aria-label="연결할 행 검색"
        data-testid="db-relation-input"
        autoComplete="off"
        className="w-full rounded border border-neutral-200 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700"
      />

      <ul role="listbox" aria-label="연결할 행" className="max-h-56 overflow-auto">
        {list.map((candidate, i) => (
          <li
            key={candidate.id}
            role="option"
            aria-selected={i === active}
            data-testid="db-relation-candidate"
            data-row-id={candidate.id}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void pick(candidate)}
            className={`cursor-pointer truncate rounded px-2 py-1 text-sm ${
              i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''
            }`}
          >
            {candidate.title || UNTITLED}
          </li>
        ))}
        {candidates !== null && list.length === 0 && (
          <li className="px-2 py-1 text-sm text-neutral-400" data-testid="db-relation-empty">
            {query.trim() === '' ? '연결할 수 있는 행이 없습니다' : '일치하는 행이 없습니다'}
          </li>
        )}
      </ul>

      {error && (
        <p role="alert" data-testid="db-relation-error" className="px-1.5 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
