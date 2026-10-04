'use client'

/**
 * 설정 한 줄 — 설정 정보구조 8g-1조각 (F-17-12)
 *
 * 레지스트리의 컨트롤 종류로 그린다(제네릭 — 항목마다 화면을 짓지 않는다). [이름 · 설명 · 컨트롤 · 상태] 한 줄이다.
 *
 *   · 글자 — Enter 나 포커스를 잃을 때 저장 · Esc 는 저장된 값으로 되돌린다. 거부되면 쓴 글자를 남기고 이유를 말한다
 *   · 켜고 끄기 — 누르는 즉시 저장. 거부되면 되돌린다
 *   · 읽기 전용 — 값만 보이고 누가 바꿀 수 있는지 말한다
 *
 * 저장하면 서버가 화면을 다시 그린다(`router.refresh`) — 이름은 사이드바 · 내비에도 선다.
 *
 * ★ 저장하는 동안 컨트롤을 `disabled` 로 막지 않는다 — 막는 순간 브라우저가 포커스를 빼앗아 Enter 뒤의 Esc · 다음 입력이 칸에 닿지
 *   않는다(e2e 가 찾았다). 겹친 저장은 핸들러가 거른다(`saving`).
 */

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'

import type { SettingControl, SettingValue } from '@/lib/settings/registry'
import { SETTING_OFFLINE, SETTING_SAVED, settingFailureMessage } from './settings-messages'

type Status = { readonly kind: 'saved' | 'error'; readonly text: string }

export function SettingRow(props: {
  workspaceId: string
  settingKey: string
  label: string
  description: string
  control: SettingControl
  value: SettingValue
  editable: boolean
  /** 읽기 전용일 때 — 누가 바꿀 수 있는지. */
  readOnlyNote: string | null
}) {
  const { control } = props
  const router = useRouter()
  const id = useId()
  const [value, setValue] = useState<SettingValue>(props.value)
  const [draft, setDraft] = useState(typeof props.value === 'string' ? props.value : '')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  /** 저장하고, 서버가 돌려준 값을 쥔다. 실패하면 false. */
  const save = async (next: SettingValue): Promise<boolean> => {
    setSaving(true)
    setStatus(null)
    let res: Response | null = null
    let body: { value?: SettingValue; error?: string } | null = null
    try {
      res = await fetch(`/api/workspaces/${props.workspaceId}/settings/${encodeURIComponent(props.settingKey)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: next }),
      })
      body = await res.json().catch(() => null)
    } catch {
      res = null
    }
    setSaving(false)
    if (res === null || !res.ok || body?.value === undefined) {
      setStatus({ kind: 'error', text: res === null ? SETTING_OFFLINE : settingFailureMessage(body?.error, control) })
      return false
    }
    setValue(body.value)
    if (typeof body.value === 'string') setDraft(body.value)
    setStatus({ kind: 'saved', text: SETTING_SAVED })
    router.refresh()
    return true
  }

  const commitText = () => {
    if (saving || draft === value) return
    void save(draft)
  }

  const toggle = (next: boolean) => {
    if (saving) return
    // 먼저 칠하고, 거부되면 되돌린다.
    setValue(next)
    void save(next).then((saved) => {
      if (!saved) setValue(!next)
    })
  }

  return (
    <div
      data-testid="setting-row"
      data-setting-key={props.settingKey}
      className="flex flex-col gap-1.5 border-b border-neutral-100 py-4 last:border-b-0 dark:border-neutral-900"
    >
      <div className="flex items-center justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor={id} className="text-sm font-medium">
            {props.label}
          </label>
          <p id={`${id}-description`} className="text-xs text-neutral-500">
            {props.description}
          </p>
        </div>
        {control.kind === 'toggle' ? (
          <input
            id={id}
            type="checkbox"
            role="switch"
            data-testid="setting-control"
            aria-describedby={`${id}-description`}
            checked={value === true}
            aria-busy={saving || undefined}
            disabled={!props.editable}
            onChange={(e) => toggle(e.target.checked)}
            className="h-4 w-4 flex-none"
          />
        ) : props.editable ? (
          <input
            id={id}
            type="text"
            data-testid="setting-control"
            aria-describedby={`${id}-description`}
            value={draft}
            aria-busy={saving || undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitText()
              }
              if (e.key === 'Escape') {
                setDraft(typeof value === 'string' ? value : '')
                setStatus(null)
              }
            }}
            className="w-64 flex-none rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        ) : (
          <span id={id} data-testid="setting-control" className="max-w-64 flex-none truncate text-sm text-neutral-700 dark:text-neutral-300">
            {value}
          </span>
        )}
      </div>
      {!props.editable && props.readOnlyNote !== null && (
        <p data-testid="setting-readonly-note" className="text-xs text-neutral-400">
          {props.readOnlyNote}
        </p>
      )}
      {status !== null && (
        <p
          role={status.kind === 'error' ? 'alert' : 'status'}
          data-testid="setting-status"
          className={`text-xs ${status.kind === 'error' ? 'text-red-600' : 'text-neutral-500'}`}
        >
          {status.text}
        </p>
      )}
    </div>
  )
}
