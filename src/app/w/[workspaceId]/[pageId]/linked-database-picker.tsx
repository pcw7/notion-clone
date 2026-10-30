/**
 * 본문의 `/연결된 데이터베이스` — 원본 고르개 (27번 트랙 L-2 · F-04-13)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 L-1] ⑤
 *
 * ⚠ `'use client'` 를 달지 않는다 — `code-language-menu.tsx` 와 같은 이유(이미 클라이언트 그래프 안이고, 함수 props 는 경계를 넘지 못한다).
 *
 * **편집기 밖에 그린다** — 언어 목록과 같다(입력칸이 포커스를 가지고, 노드 뷰가 다시 만들어져도 목록이 남는다). 후보는 이 사람이 볼 수
 * 있는 데이터베이스의 소스다(`GET /databases?q=` — 서버가 이름으로 거른다 · 목록에는 상한이 있다). 고르면 서버가 원본을 다시 묻는다.
 *
 * 키: ↑↓ 순환 · Enter 고르기 · Esc 닫고 편집기로 · Tab 닫기 · 한글 조합 중에는 손대지 않는다. 바깥을 누르면 닫는다.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { DATABASE_GLYPH } from '@/lib/block/page-icon'
import type { DatabaseListItem } from '@/lib/database/database'
import { linkedSourceLabel } from '@/lib/database/linked-picker'
import { PageIconView } from '../page-icon-view'

/** 검색어를 친 뒤 서버에 묻기까지 — 글자마다 묻지 않는다. */
const SEARCH_DEBOUNCE_MS = 150

export type LinkedDatabasePickerProps = {
  /** 프레임 기준 좌표. */
  top: number
  left: number
  /** 후보 읽기 — 검색어(비면 전부 · 상한까지). 못 읽으면 null. */
  load: (query: string) => Promise<DatabaseListItem[] | null>
  onPick: (item: DatabaseListItem) => void
  /** `restoreFocus`: 편집기로 포커스를 돌려줄 것인가. `outside`: 바깥을 눌러 닫았으면 누른 곳. */
  onClose: (restoreFocus: boolean, outside?: EventTarget | null) => void
}

export function LinkedDatabasePicker({ top, left, load, onPick, onClose }: LinkedDatabasePickerProps) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<DatabaseListItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listId = useId()
  const optionId = (i: number) => `${listId}-option-${i}`

  // 검색어가 바뀌면 잠시 뒤 묻는다 — 늦게 온 앞의 답은 버린다
  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      void load(query).then((found) => {
        if (!alive) return
        setFailed(found === null)
        setItems(found ?? [])
        setActive(0)
      })
    }, query === '' ? 0 : SEARCH_DEBOUNCE_MS)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query, load])

  // 바깥을 누르면 닫는다 — capture 로 받아야 편집기가 선택을 옮기기 전에 본다
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      if (!rootRef.current || rootRef.current.contains(event.target as Node)) return
      onClose(false, event.target)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [onClose])

  const options = items ?? []
  const pick = (index: number): void => {
    const item = options[index]
    if (item) onPick(item)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    const count = Math.max(options.length, 1)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (i + 1) % count)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (i - 1 + count) % count)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose(true)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      onClose(true)
    }
  }

  return (
    <div
      ref={rootRef}
      onMouseDown={(e) => {
        if (e.target !== inputRef.current) e.preventDefault()
      }}
      role="dialog"
      aria-label="연결할 데이터베이스"
      data-testid="linked-database-picker"
      className="absolute z-30 flex w-72 flex-col popover-surface"
      style={{ top, left }}
    >
      <input
        ref={inputRef}
        data-testid="linked-database-search"
        role="combobox"
        aria-label="데이터베이스 검색"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={options.length > 0 ? optionId(active) : undefined}
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="연결할 데이터베이스 검색"
        className="m-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
      />
      <ul id={listId} role="listbox" aria-label="데이터베이스" className="max-h-64 overflow-auto py-1">
        {items === null && <li className="px-3 py-1.5 text-sm text-neutral-500">불러오는 중…</li>}
        {items !== null && failed && <li className="px-3 py-1.5 text-sm text-neutral-500">목록을 불러오지 못했습니다</li>}
        {items !== null && !failed && options.length === 0 && (
          <li className="px-3 py-1.5 text-sm text-neutral-500" data-testid="linked-database-empty">
            연결할 수 있는 데이터베이스가 없습니다
          </li>
        )}
        {options.map((item, i) => (
          <li
            key={item.dataSourceId}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            data-testid="linked-database-option"
            data-data-source-id={item.dataSourceId}
            onClick={() => pick(i)}
            onMouseMove={() => {
              if (active !== i) setActive(i)
            }}
            className={`flex cursor-pointer items-center gap-1 px-3 py-1.5 text-sm ${i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''}`}
          >
            <PageIconView icon={item.icon} fallback glyph={DATABASE_GLYPH} className="shrink-0" />
            <span className="truncate">{linkedSourceLabel(item)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
