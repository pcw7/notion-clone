'use client'

/**
 * 필터 규칙의 사람 값 — 한 사람을 이름으로 고른다 (게시 · 공유 6g-2b · F-03-07 · F-04-09)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 사람 속성 ⑩
 *
 * 칸의 고르개(`PeopleEditor` — 같은 후보 · 게스트에게는 없다)를 한 사람 모양으로 쓴다: 다른 사람을 고르면 그 사람으로 바꾸고 닫힌다.
 * 고른 사람을 다시 고르거나 × 로 빼면 값이 빈다(빈 값의 규칙은 저장 트리에서 빠진다 — `toFilter`). 닫기는 Esc · 바깥(포커스가 이
 * 부품을 떠나면). **Esc 는 여기서 멈춘다** — 필터 패널(`Popover`)까지 닫지 않게.
 */

import { useState } from 'react'

import { LEFT_USER } from '@/lib/database/cell-format'
import type { PeopleNames } from './cell-view'
import { PeopleEditor } from './people-editor'

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
  /** `undefined` 는 "값 없음"이다. */
  onChange: (value: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const id = typeof value === 'string' && value !== '' ? value : null
  const label = id === null ? '사람 선택…' : Object.hasOwn(names, id) ? names[id]! : LEFT_USER

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
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
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
