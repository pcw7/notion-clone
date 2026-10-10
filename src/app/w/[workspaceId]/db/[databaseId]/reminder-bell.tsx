'use client'

/**
 * 날짜 칸의 종 — 리마인더를 보이고 · 걸고 · 바꾸고 · 푼다 (히스토리 · 활동 4c-3 · F-11-10)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 리마인더 ⑥ · ⑨
 *
 *   · 종은 리마인더가 있으면 늘 선다 — 칸을 보는 모두에게(리마인더는 날짜 값의 일부다 · 알림은 건 사람에게만 간다). 지난 것(울렸거나
 *     "지남")은 빨갛다. 없으면 고칠 수 있는 사람에게만, 날짜가 있을 때, 칸에 마우스를 올리면 선다
 *   · 누르면 메뉴 — 값의 모양에 맞는 리드만(`leadsFor` — 서버가 거부하는 것을 세우지 않는다) · 걸려 있으면 "알림 없음"
 *   · 칸을 고르는 누르기로 번지지 않게 막는다(제목 칸의 "열기"와 같다). Esc · 바깥을 누르면 닫는다
 */

import { useEffect, useRef, useState } from 'react'

import type { DateReminderJson } from '@/lib/database/reminder'
import { isDateOnlyStart, leadLabel, leadsFor } from '@/lib/database/reminder-leads'
import * as api from './table-api'

export function ReminderBell(props: {
  workspaceId: string
  rowId: string
  propertyId: string
  propertyName: string
  /** 칸의 날짜 시작 — 비었으면 null(걸 수 없다). */
  start: string | null
  reminder: DateReminderJson | null
  canEdit: boolean
  align: 'left' | 'right'
  onChange: (next: DateReminderJson | null) => void
}) {
  const { reminder, start } = props
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  if (reminder === null && (!props.canEdit || start === null)) return null

  const dateOnly = start === null || isDateOnlyStart(start)
  const passed = reminder !== null && reminder.firedAt !== null
  const label = reminder === null ? null : leadLabel(reminder.leadMinutes, dateOnly)
  const title = reminder === null ? '알림 걸기' : `알림 — ${label}${passed ? ' · 지남' : ''}`

  const choose = async (lead: number | null) => {
    setBusy(true)
    setError(null)
    const result =
      lead === null
        ? await api.clearReminder(props.workspaceId, props.rowId, props.propertyId)
        : await api.setReminder(props.workspaceId, props.rowId, props.propertyId, lead)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    props.onChange(lead === null ? null : (result.value as DateReminderJson))
    setOpen(false)
  }

  return (
    <span ref={box} className="relative flex-none">
      <button
        type="button"
        data-testid="db-reminder-bell"
        data-state={reminder === null ? 'none' : passed ? 'passed' : 'armed'}
        aria-label={`${props.propertyName} ${title}`}
        aria-haspopup={props.canEdit ? 'menu' : undefined}
        aria-expanded={props.canEdit ? open : undefined}
        title={title}
        tabIndex={-1}
        disabled={!props.canEdit && reminder === null}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => {
          if (props.canEdit) setOpen((v) => !v)
        }}
        className={`flex items-center rounded px-0.5 ${
          reminder === null
            ? 'text-neutral-400 opacity-0 hover:text-neutral-700 group-hover/date:opacity-100 focus-visible:opacity-100'
            : passed
              ? 'text-red-500'
              : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
        } ${props.canEdit ? '' : 'cursor-default'}`}
      >
        <svg aria-hidden viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 2.5a3.5 3.5 0 0 0-3.5 3.5v2.5L3 10.5h10l-1.5-2V6A3.5 3.5 0 0 0 8 2.5Z" strokeLinejoin="round" />
          <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`${props.propertyName} 알림`}
          data-testid="db-reminder-menu"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setOpen(false)
            }
          }}
          className={`absolute top-full z-20 mt-1 w-44 rounded-md border border-neutral-200 bg-white p-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900 ${
            props.align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <p className="px-2 py-1 text-xs text-neutral-500">알림</p>
          {start !== null &&
            leadsFor(start).map((lead) => (
              <button
                key={lead}
                type="button"
                role="menuitemradio"
                aria-checked={reminder?.leadMinutes === lead}
                data-testid="db-reminder-option"
                data-lead={lead}
                disabled={busy}
                onClick={() => void choose(lead)}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
              >
                {leadLabel(lead, dateOnly)}
                {reminder?.leadMinutes === lead && <span aria-hidden>✓</span>}
              </button>
            ))}
          {reminder !== null && (
            <button
              type="button"
              role="menuitem"
              data-testid="db-reminder-off"
              disabled={busy}
              onClick={() => void choose(null)}
              className="mt-1 w-full rounded border-t border-neutral-100 px-2 py-1 text-left text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
            >
              알림 없음
            </button>
          )}
          {error !== null && (
            <p role="alert" data-testid="db-reminder-error" className="px-2 py-1 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </span>
  )
}
