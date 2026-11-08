'use client'

/**
 * 행 페이지 머리의 검증 배지 — 검증됨 · 만료 · (편집하는 사람에게) 검증하기 (VF-2 · F-03-23 · 정본 §3.5 [보강 VF-1] ⑥ ⑦)
 *
 * 항상 받는 쪽이라 작게 둔다 — 고르개는 누를 때 받는다(`verification-lazy.tsx`). 머리말에 누가 · 언제 · 언제까지, 검증 뒤에 행을 고쳤으면
 * "검증 뒤 고침"(풀지는 않는다 · ⑦). 읽기만 하는 사람은 배지만 보고 단추는 없다 — 검증하지 않은 행이면 아무것도 그리지 않는다.
 */

import { useEffect, useRef, useState } from 'react'

import { verificationLabel, type VerificationCell } from '@/lib/database/verification-cell'
import { verificationBadgeTitle } from '@/lib/database/verification-ui'
import { containsAcrossLayers } from '../anchored-layer'
import { VerificationPickerLazy } from '../db/[databaseId]/verification-lazy'

export function VerificationBadge({
  workspaceId,
  rowId,
  propertyId,
  initial,
  names,
  lastEditedAt,
  canEdit,
}: {
  workspaceId: string
  rowId: string
  propertyId: string
  initial: VerificationCell | null
  names: Readonly<Record<string, string>>
  /** 행의 마지막 편집(ISO) — 검증 뒤 고침 비교용. */
  lastEditedAt: string
  canEdit: boolean
}) {
  const [cell, setCell] = useState(initial)
  const [known, setKnown] = useState(names)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current !== null && !containsAcrossLayers(box.current, e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  if (cell === null && !canEdit) return null

  const state = cell === null ? 'none' : cell.expired ? 'expired' : 'verified'
  const tone = cell?.expired ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'
  const title = cell === null ? undefined : verificationBadgeTitle(cell, known[cell.verified_by] ?? '구성원', lastEditedAt)
  const text = cell === null ? '검증하기' : verificationLabel(cell, new Date())

  return (
    <span ref={box} className="relative inline-flex" data-testid="row-verification" data-state={state}>
      {canEdit ? (
        <button
          type="button"
          data-testid={cell === null ? 'row-verification-verify' : 'row-verification-badge'}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={title}
          onClick={() => setOpen((v) => !v)}
          className={`rounded border border-neutral-200 px-2 py-0.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800 ${
            cell === null ? 'text-neutral-600 dark:text-neutral-300' : tone
          }`}
        >
          {text}
        </button>
      ) : (
        <span data-testid="row-verification-badge" title={title} className={`rounded border border-neutral-200 px-2 py-0.5 text-xs dark:border-neutral-700 ${tone}`}>
          {text}
        </span>
      )}
      {open && (
        <VerificationPickerLazy
          workspaceId={workspaceId}
          rowId={rowId}
          propertyId={propertyId}
          cell={cell}
          names={known}
          onChanged={(next, more) => {
            setCell(next)
            setKnown((current) => ({ ...current, ...more }))
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  )
}
