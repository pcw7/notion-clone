'use client'

/**
 * 검증 고르개 — 기간을 골라 검증하고 · 다시 검증하고 · 푼다 (VF-2 · F-03-23)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 VF-1] ③ ④ ⑥
 *
 * 표의 칸(편집 중)과 행 페이지의 머리 배지가 함께 쓴다. **지연 로드한다** — 행 페이지의 첫 JS 예산을 아끼려고 `verification-lazy.tsx` 가
 * `next/dynamic` 으로 부른다. 프리셋은 지금 + N×24시간, 날짜는 보는 사람의 시간대로 그날의 끝(`verification-ui.ts`). 서버가 다시 묻는다
 * (편집 권한 · 플랜 · 지난 시각) — 거절은 말로 보인다(`plan_required` 는 `table-api.ts` 의 플랜 문구 그대로).
 * 일하는 동안에도 단추를 막지 않는다(disabled 로 바꾸면 포커스가 body 로 빠져 표가 편집을 닫는다 — 거절 문구가 사라진다) · 겹침은 `busy` 가드로 막는다. 닫는 것은 부르는 쪽이다(Esc · 칸 밖 — 표는 편집 모드, 배지는 바깥 누르기).
 */

import { useEffect, useRef, useState } from 'react'

import { verificationTitle, type VerificationCell } from '@/lib/database/verification-cell'
import { VERIFY_PRESET_DAYS, endOfDayExpiresAt, presetExpiresAt } from '@/lib/database/verification-ui'
import { AnchoredLayer } from '../../anchored-layer'
import * as api from './table-api'
import type { PeopleNames } from './cell-view'

const OPTION = 'w-full rounded px-2 py-1 text-left hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800'

/** 오늘(보는 사람의 시간대) `YYYY-MM-DD` — 날짜 고르기의 가장 이른 날. */
function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function VerificationPicker({
  workspaceId,
  rowId,
  propertyId,
  cell,
  names,
  align = 'left',
  onChanged,
  onClose,
}: {
  workspaceId: string
  rowId: string
  propertyId: string
  /** 지금 칸 — 비었으면 null. */
  cell: VerificationCell | null
  names: PeopleNames
  align?: 'left' | 'right'
  /** 바뀐 칸(풀었으면 null) · 방금 이름을 안 사람. */
  onChanged: (next: VerificationCell | null, known: PeopleNames) => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [known, setKnown] = useState<PeopleNames>(names)
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    first.current?.focus()
  }, [])

  // 누가 검증했는지 이름을 모르면 한 번 묻는다
  const verifier = cell?.verified_by ?? null
  useEffect(() => {
    if (verifier === null || known[verifier] !== undefined) return
    let live = true
    void api.loadPeopleNames(workspaceId, [verifier]).then((r) => {
      if (live && r.ok) setKnown((current) => ({ ...current, ...r.value }))
    })
    return () => {
      live = false
    }
  }, [verifier, known, workspaceId])

  const verify = async (expiresAt: string | null) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await api.verifyRowCell(workspaceId, rowId, propertyId, expiresAt)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onChanged(result.value, known)
    onClose()
  }

  const unverify = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await api.unverifyRowCell(workspaceId, rowId, propertyId)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onChanged(null, known)
    onClose()
  }

  const pickDate = () => {
    const iso = endOfDayExpiresAt(date, Intl.DateTimeFormat().resolvedOptions().timeZone)
    if (iso === null) {
      setError('날짜를 확인하세요.')
      return
    }
    void verify(iso)
  }

  return (
    <AnchoredLayer align={align === 'right' ? 'end' : 'start'}>
      <div
        role="dialog"
        aria-label="검증"
        data-testid="db-verification-picker"
        // 표의 칸 선택 · 편집 모드 규칙으로 번지지 않게
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
            return
          }
          // 표의 키 규칙(Enter · 화살표)이 고르개 안의 키를 가져가지 않게
          e.stopPropagation()
        }}
        className="w-60 popover-surface p-1 text-sm"
      >
        {cell !== null && (
          <p data-testid="db-verification-info" className="px-2 py-1 text-xs text-neutral-500">
            {verificationTitle(cell, known[cell.verified_by] ?? '구성원')}
          </p>
        )}
        <p className="px-2 py-1 text-xs font-medium text-neutral-500">{cell === null ? '검증하기' : '다시 검증'}</p>
        {VERIFY_PRESET_DAYS.map((days, i) => (
          <button
            key={days}
            ref={i === 0 ? first : undefined}
            type="button"
            data-testid="db-verification-duration"
            data-days={days}
            onClick={() => void verify(presetExpiresAt(days, new Date()))}
            className={OPTION}
          >
            {days}일
          </button>
        ))}
        <div className="flex items-center gap-1 px-1 py-1">
          <input
            type="date"
            value={date}
            min={todayLocal()}
            onChange={(e) => setDate(e.target.value)}
            aria-label="날짜 고르기"
            data-testid="db-verification-date"
            className="min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-sm dark:border-neutral-700"
          />
          <button
            type="button"
            data-testid="db-verification-date-apply"
            disabled={date === ''}
            onClick={pickDate}
            className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            적용
          </button>
        </div>
        <button
          type="button"
          data-testid="db-verification-duration"
          data-days="forever"
          aria-busy={busy}
          onClick={() => void verify(null)}
          className={OPTION}
        >
          무기한
        </button>
        {cell !== null && (
          <button
            type="button"
            data-testid="db-verification-off"
            onClick={() => void unverify()}
            className="mt-1 w-full rounded border-t border-neutral-100 px-2 py-1 text-left text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
          >
            검증 해제
          </button>
        )}
        {error !== null && (
          <p role="alert" data-testid="db-verification-error" className="px-2 py-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    </AnchoredLayer>
  )
}
