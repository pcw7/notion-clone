'use client'

/**
 * 사람 칸 편집기 — 게시 · 공유 6g-2 (F-03-07)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 사람 속성
 *       03 F-03-07 *"셀 클릭 → 멤버 검색 팝오버 → 이름/이메일 검색 → 선택"*
 *
 * 고르는 순간마다 저장한다(관계형 편집기와 같다 — 초안이 없다). 맨 위는 칸에 든 사람(× 로 뺀다), 아래는 이 워크스페이스의 활동 중인
 * 사람 후보(`GET /people?q=` — 게스트에게는 없다 · 7d-2). 후보를 고르면 넣고, 이미 든 사람을 고르면 뺀다. 닫는 것은 표다(Esc · 칸 밖).
 *
 * 키는 `select-editor.tsx` 와 같은 규칙이다 — ↑↓ · Enter 는 여기서 쓰고 `preventDefault()`(표의 Enter 가 "편집 시작" 으로 다시 열지
 * 않게) · 항목을 누를 때 `mousedown` 의 기본 동작을 막는다(입력칸이 포커스를 잃으면 표가 편집을 닫는다).
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { LEFT_USER } from '@/lib/database/cell-format'
import { MAX_PEOPLE } from '@/lib/database/property-types'
import type { PeopleNames } from './cell-view'
import * as api from './table-api'

export function PeopleEditor({
  workspaceId,
  current,
  names,
  align = 'left',
  leading,
  onChange,
}: {
  workspaceId: string
  /** 칸에 든 사람(순서대로). */
  current: readonly string[]
  names: PeopleNames
  align?: 'left' | 'right'
  /** 찾기 칸 위에 끼우는 것 — 필터의 "나"(6g-2c · `people-value.tsx`). 칸의 고르개는 주지 않는다. */
  leading?: ReactNode
  /** 새 목록 · 방금 이름을 안 사람(칩이 깜빡이지 않게 이름 지도에 넣는다). */
  onChange: (ids: readonly string[], known: PeopleNames) => void
}) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<api.PersonCandidateJson[] | null>(null)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 후보 — 칠 때마다 다시 묻는다(멤버 목록은 서버가 거른다). 늦게 온 옛 답은 버린다.
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      void api.searchPeople(workspaceId, query.trim()).then((result) => {
        if (live) setCandidates(result.ok ? result.value : [])
      })
    }, 120)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [workspaceId, query])

  const nameOf = (id: string): string => (Object.hasOwn(names, id) ? names[id]! : LEFT_USER)
  const list = candidates ?? []
  const active = list.length === 0 ? -1 : Math.min(index, list.length - 1)

  const toggle = (person: api.PersonCandidateJson) => {
    const has = current.includes(person.id)
    // 50명을 넘기면 서버가 거부한다 — 고르개가 먼저 막는다
    if (!has && current.length >= MAX_PEOPLE) return
    onChange(has ? current.filter((id) => id !== person.id) : [...current, person.id], { [person.id]: person.name })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (list.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setIndex((active + step + list.length) % list.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (active >= 0) toggle(list[active]!)
    }
  }

  return (
    <div
      data-testid="db-people-editor"
      className={`absolute top-full z-20 mt-1 w-72 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 ${
        align === 'right' ? 'right-0' : 'left-0'
      }`}
    >
      {leading}
      {current.length > 0 && (
        <ul aria-label="칸에 든 사람" className="mb-1 flex flex-wrap gap-1 px-1 pt-1" data-testid="db-people-current">
          {current.map((id) => (
            <li key={id} className="flex items-center gap-0.5 rounded bg-neutral-100 pl-1.5 text-xs dark:bg-neutral-800">
              {nameOf(id)}
              <button
                type="button"
                aria-label={`${nameOf(id)} 빼기`}
                data-testid="db-people-remove"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(current.filter((x) => x !== id), {})}
                className="rounded px-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setIndex(0)
        }}
        onKeyDown={onKeyDown}
        placeholder="이름 · 메일로 찾기"
        aria-label="사람 찾기"
        data-testid="db-people-input"
        autoComplete="off"
        className="mb-1 w-full rounded border border-neutral-200 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700"
      />
      <ul role="listbox" aria-label="사람" className="max-h-56 overflow-auto">
        {candidates !== null && list.length === 0 && (
          <li className="px-2 py-1.5 text-xs text-neutral-400" data-testid="db-people-empty">
            찾은 사람이 없습니다
          </li>
        )}
        {list.map((person, i) => {
          const picked = current.includes(person.id)
          return (
            <li
              key={person.id}
              role="option"
              aria-selected={i === active}
              data-testid="db-people-option"
              data-picked={picked || undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setIndex(i)}
              onClick={() => toggle(person)}
              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm ${i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''}`}
            >
              <span className="w-3 text-xs text-blue-600" aria-hidden>
                {picked ? '✓' : ''}
              </span>
              <span className="min-w-0 flex-1 truncate">{person.name}</span>
              {person.guest && <span className="text-[10px] text-neutral-400">게스트</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
