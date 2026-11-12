'use client'

/**
 * 장소 칸 편집기 — 장소 속성 MP-1 (F-03-04)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 MP-1] ② ③
 *
 * 찾기 칸에 쓰고 **Enter 로 한 번 찾는다**(치는 대로 찾지 않는다 — Nominatim 의 이용 규칙이 자동완성을 막는다). 찾기는 앱 서버가 대신 묻는다
 * (`GET …/places/search?q=` — 브라우저가 외부에 직접 묻지 않는다). 좌표(`37.5665, 126.978`)로 쓰면 묻지 않고 그 자리로 바로 고른다.
 * 결과 목록(5개)에서 누르거나 ↑↓ · Enter 로 고르면 칸이 그 장소가 되고 닫힌다. "지우기" 는 칸을 비운다. 찾지 못하면 그렇게 말하고
 * 좌표 쓰기를 권한다. Esc · Tab 은 표에 맡긴다(`relation-editor.tsx` 와 같은 규칙).
 *
 * 이 파일은 칸을 처음 편집할 때 받는다(`editors-lazy.tsx`) — 읽기 전용 표시(`cell-view.tsx`)는 먼저 온다.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { parseCoordinates, readPlace } from '@/lib/database/place'
import type { PlaceRef } from '@/lib/database/property-types'
import { AnchoredLayer } from '../../anchored-layer'

const NOT_FOUND = '찾지 못했습니다. 좌표(예: 37.5665, 126.978)를 직접 입력할 수도 있습니다.'

type Status = 'idle' | 'loading' | 'done' | 'error'

export function PlaceEditor({
  workspaceId,
  current,
  align = 'left',
  onChange,
}: {
  workspaceId: string
  /** 칸에 든 장소 — 없으면 null. */
  current: PlaceRef | null
  align?: 'left' | 'right'
  /** 고른 장소 · 지우기(null). 부른 뒤 표가 편집을 닫는다. */
  onChange: (next: PlaceRef | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly PlaceRef[]>([])
  // 결과가 어느 글의 것인가 — 글을 고치면 목록은 낡은 것이다(Enter 는 다시 찾는다)
  const [resultsFor, setResultsFor] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const text = query.trim()
  const fresh = resultsFor === text && status === 'done'
  const active = fresh && results.length > 0 ? Math.min(index, results.length - 1) : -1

  const search = async () => {
    if (text === '') return
    // 좌표는 묻지 않는다 — 바로 그 자리를 고른다
    const typed = parseCoordinates(text)
    if (typed !== null) {
      onChange(typed)
      return
    }
    setStatus('loading')
    setMessage(null)
    setIndex(0)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/places/search?q=${encodeURIComponent(text)}`, { credentials: 'same-origin' })
      const body = (await response.json().catch(() => null)) as { places?: unknown; message?: unknown } | null
      if (!response.ok) {
        setResults([])
        setResultsFor(text)
        setStatus('error')
        setMessage(response.status === 429 ? '잠시 뒤에 다시 시도해 주세요.' : NOT_FOUND)
        return
      }
      const places = (Array.isArray(body?.places) ? body.places : []).flatMap((p) => readPlace({ place: p }) ?? [])
      setResults(places)
      setResultsFor(text)
      setStatus('done')
      setMessage(places.length === 0 ? NOT_FOUND : null)
    } catch {
      setResults([])
      setResultsFor(text)
      setStatus('error')
      setMessage(NOT_FOUND)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || composing.current) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length === 0) return
      setIndex((active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
    } else if (event.key === 'Enter') {
      // ★ 표의 Enter(저장하고 아래 칸)가 아니라 이 칸의 Enter 다
      event.preventDefault()
      // 이 글의 결과가 떠 있으면 고르고, 아니면 한 번 찾는다
      if (active >= 0) {
        const picked = results[active]
        if (picked !== undefined) onChange(picked)
      } else if (status !== 'loading') void search()
    }
  }

  return (
    <AnchoredLayer align={align === 'right' ? 'end' : 'start'}>
      <div role="dialog" aria-label="장소 고르기" data-testid="db-place-editor" className="flex w-80 flex-col gap-1 popover-surface p-1.5">
        {current !== null && (
          <div className="flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-1 text-sm dark:bg-neutral-800" data-testid="db-place-current">
            <span className="min-w-0 flex-1 truncate" {...(current.address === '' ? {} : { title: current.address })}>
              {current.name}
            </span>
            <button
              type="button"
              data-testid="db-place-clear"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(null)}
              className="flex-none rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
            >
              지우기
            </button>
          </div>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
          }}
          onKeyDown={onKeyDown}
          placeholder="장소 이름 · 주소 — Enter 로 찾기"
          aria-label="장소 찾기"
          data-testid="db-place-input"
          autoComplete="off"
          className="w-full rounded border border-neutral-200 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700"
        />
        {status === 'loading' && (
          <p role="status" data-testid="db-place-busy" className="px-1.5 text-xs text-neutral-500">
            찾는 중…
          </p>
        )}
        {fresh && results.length > 0 && (
          <ul role="listbox" aria-label="찾은 장소" className="max-h-56 overflow-auto">
            {results.map((place, i) => (
              <li
                key={`${place.lat},${place.lng},${i}`}
                role="option"
                aria-selected={i === active}
                data-testid="db-place-result"
                onMouseEnter={() => setIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(place)}
                className={`cursor-pointer rounded px-2 py-1 ${i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''}`}
              >
                <span className="block truncate text-sm">{place.name}</span>
                {place.address !== '' && <span className="block truncate text-xs text-neutral-500">{place.address}</span>}
              </li>
            ))}
          </ul>
        )}
        {message !== null && (
          <p role="alert" data-testid="db-place-message" className="px-1.5 text-xs text-red-600 dark:text-red-400">
            {message}
          </p>
        )}
      </div>
    </AnchoredLayer>
  )
}
