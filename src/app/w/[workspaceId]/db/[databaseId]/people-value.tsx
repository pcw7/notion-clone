'use client'

/**
 * 필터 규칙의 사람 값 — 한 사람을 이름으로 고른다 (게시 · 공유 6g-2b · F-03-07 · F-04-09)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 사람 속성 ⑩
 *
 * 칸의 고르개(`PeopleEditor` — 같은 후보 · 게스트에게는 없다)를 한 사람 모양으로 쓴다: 다른 사람을 고르면 그 사람으로 바꾸고 닫힌다.
 * 고른 사람을 다시 고르거나 × 로 빼면 값이 빈다(빈 값의 규칙은 저장 트리에서 빠진다 — `toFilter`). 닫기는 Esc · 바깥(포커스가 이
 * 부품을 떠나면). **Esc 는 여기서 멈춘다** — 필터 패널(`Popover`)까지 닫지 않게.
 *
 * 맨 위의 **"나"**(6g-2c · 정본 [보강] 사람 속성 ⑪)는 사람 id 가 아니라 컨텍스트 노드(`ME_NODE`)를 값으로 둔다 — 보는 사람마다 다른 행이다.
 * 게스트도 고를 수 있다(후보 목록이 아니다). 다시 누르면 값이 빈다.
 */

import { useState } from 'react'

import { LEFT_USER } from '@/lib/database/cell-format'
import { ME_NODE, isMeNode } from '@/lib/database/filter'
import type { PeopleNames } from './cell-view'
import { PeopleEditor } from './people-editor'
import { containsAcrossLayers } from '../../anchored-layer'

/** "나" 의 이름 — 칩의 요약(`describeRule`)과 같은 말. */
const ME_LABEL = '나'

export function PeopleValue({
  workspaceId,
  value,
  names,
  disabled,
  className,
  onKnown,
  onChange,
}: {
  workspaceId: string
  value: unknown
  names: PeopleNames
  disabled: boolean
  className: string
  /** 고르개가 이름을 아는 사람 — 칩이 곧바로 이름으로 그리게 도구막대의 지도에 넣는다. */
  onKnown: (known: PeopleNames) => void
  /** `undefined` 는 "값 없음"이다. "나" 는 `ME_NODE`. */
  onChange: (value: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const me = isMeNode(value)
  const id = typeof value === 'string' && value !== '' ? value : null
  const label = me ? ME_LABEL : id === null ? '사람 선택…' : Object.hasOwn(names, id) ? names[id]! : LEFT_USER

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
        // 편집기는 몸으로 내보낸 층이다(10j-3b) — DOM 의 contains 는 포털을 모른다
        if (!containsAcrossLayers(e.currentTarget, e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        type="button"
        aria-label="필터 값"
        aria-expanded={open}
        data-testid="db-filter-value"
        data-person={id ?? undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`${className} text-left`}
      >
        {label}
      </button>
      {open && (
        <PeopleEditor
          workspaceId={workspaceId}
          current={id === null ? [] : [id]}
          names={names}
          leading={
            <button
              type="button"
              data-testid="db-filter-me"
              data-picked={me || undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(me ? undefined : ME_NODE)
                setOpen(false)
              }}
              className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800`}
            >
              <span className="w-3 text-xs text-blue-600" aria-hidden>
                {me ? '✓' : ''}
              </span>
              <span className="flex-1">{ME_LABEL}</span>
              <span className="text-[10px] text-neutral-400">보는 사람</span>
            </button>
          }
          onChange={(ids, known) => {
            onKnown(known)
            // 한 사람 — 새로 든 사람이 값이다. 고른 사람을 다시 고르거나 빼면 비운다.
            onChange(ids.find((x) => x !== id))
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
