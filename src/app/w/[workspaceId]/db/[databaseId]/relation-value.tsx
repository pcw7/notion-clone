'use client'

/**
 * 필터 규칙의 relation 값 — 대상 표의 행 하나를 제목으로 고른다 (10n-45 · F-04-09 · F-03-10)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] `relation_edge` 의 규칙 — [보강 10n-45] ② ③
 *
 * 사람 값(`people-value.tsx`)과 같은 모양이다: 단추가 고른 행의 제목을 말하고, 누르면 찾기 칸과 후보가 뜬다. 다른 행을 고르면 그 행으로
 * 바꾸고 닫힌다 · 고른 행을 다시 고르면 값이 빈다(빈 값의 규칙은 저장 트리에서 빠진다). 후보는 행이 없는 자리의 라우트
 * (`data-sources/{id}/relations/{propertyId}/candidates` — 이어진 것을 빼지 않는다)에서 온다. 고른 행의 제목은 `onKnown` 으로 도구막대의
 * 지도에 넣는다 — 저장 뒤 서버가 제목 맵을 주기 전까지 칩이 그것으로 그린다. 닫기는 Esc(필터 패널까지 닫지 않는다) · 바깥.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { rowTitleLabel, type RowTitleMap } from '@/lib/database/filter-draft'
import * as api from './table-api'
import { AnchoredLayer, containsAcrossLayers } from '../../anchored-layer'
import { PageIconView } from '../../page-icon-view'

export function RelationValue({
  workspaceId,
  dataSourceId,
  propertyId,
  value,
  titles,
  disabled,
  className,
  onKnown,
  onChange,
}: {
  workspaceId: string
  /** 규칙이 걸린 표 — 후보는 이 표의 relation 속성이 가리키는 표에서 온다. */
  dataSourceId: string
  propertyId: string
  value: unknown
  titles: RowTitleMap
  disabled: boolean
  className: string
  onKnown: (known: RowTitleMap) => void
  /** `undefined` 는 "값 없음"이다. */
  onChange: (value: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const id = typeof value === 'string' && value !== '' ? value : null

  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (open && e.key === 'Escape' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
        }
      }}
      onBlur={(e) => {
        // 고르개는 몸으로 내보낸 층이다(10j-3b) — DOM 의 contains 는 포털을 모른다
        if (!containsAcrossLayers(e.currentTarget, e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        type="button"
        aria-label="필터 값"
        aria-expanded={open}
        data-testid="db-filter-value"
        data-row={id ?? undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`${className} text-left`}
      >
        {id === null ? '행 선택…' : rowTitleLabel(id, titles)}
      </button>
      {open && (
        <RowPicker
          workspaceId={workspaceId}
          dataSourceId={dataSourceId}
          propertyId={propertyId}
          current={id}
          onPick={(row) => {
            onKnown({ [row.id]: row.title })
            // 한 행 — 다른 행이면 그것으로 · 고른 행을 다시 고르면 비운다
            onChange(row.id === id ? undefined : row.id)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

function RowPicker({
  workspaceId,
  dataSourceId,
  propertyId,
  current,
  onPick,
}: {
  workspaceId: string
  dataSourceId: string
  propertyId: string
  current: string | null
  onPick: (row: api.RelatedRow) => void
}) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<api.RelatedRow[] | null>(null)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 후보 — 칠 때마다 다시 묻는다(대상 표 · 권한은 서버가 정한다). 늦게 온 옛 답은 버린다.
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      void api.searchFilterRows(workspaceId, dataSourceId, propertyId, query.trim()).then((result) => {
        if (live) setCandidates(result.ok ? result.value : [])
      })
    }, 120)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [workspaceId, dataSourceId, propertyId, query])

  const list = candidates ?? []
  const active = list.length === 0 ? -1 : Math.min(index, list.length - 1)

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (list.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setIndex((active + step + list.length) % list.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (active >= 0) onPick(list[active]!)
    }
  }

  return (
    <AnchoredLayer align="start">
      <div
        data-testid="db-filter-row-picker"
        className="w-72 popover-surface p-1"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="제목으로 찾기"
          aria-label="행 찾기"
          data-testid="db-filter-row-input"
          autoComplete="off"
          className="mb-1 w-full rounded border border-neutral-200 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700"
        />
        <ul role="listbox" aria-label="행" className="max-h-56 overflow-auto">
          {candidates !== null && list.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-neutral-400" data-testid="db-filter-row-empty">
              찾은 행이 없습니다
            </li>
          )}
          {list.map((row, i) => {
            const picked = row.id === current
            return (
              <li
                key={row.id}
                role="option"
                aria-selected={i === active}
                data-testid="db-filter-row-option"
                data-row={row.id}
                data-picked={picked || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setIndex(i)}
                onClick={() => onPick(row)}
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm ${i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''}`}
              >
                <span className="w-3 text-xs text-blue-600" aria-hidden>
                  {picked ? '✓' : ''}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <PageIconView icon={row.icon} className="mr-1" />
                  {row.title === '' ? '제목 없음' : row.title}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </AnchoredLayer>
  )
}
