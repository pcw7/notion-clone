'use client'

/**
 * 설정 한 줄 — 설정 정보구조 8g-1조각 (F-17-12)
 *
 * 레지스트리의 컨트롤 종류로 그린다(제네릭 — 항목마다 화면을 짓지 않는다). [이름 · 설명 · 컨트롤 · 상태] 한 줄이다.
 *
 *   · 글자 — Enter 나 포커스를 잃을 때 저장 · Esc 는 저장된 값으로 되돌린다. 거부되면 쓴 글자를 남기고 이유를 말한다
 *   · 숫자(4b-3) — 글자와 같이 저장한다. 정수로 읽히면 수로 보내고, 아니면 쓴 그대로 보내 서버가 거부한다(규칙은 서버 하나다)
 *   · 켜고 끄기 · 고르기(8h) — 바꾸는 즉시 저장. 거부되면 되돌린다
 *   · 읽기 전용 — 값만 보이고 누가 바꿀 수 있는지 말한다. 요금제가 막으면 "요금제 필요"를 붙이고 그렇게 말한다(4b-3 — 표시일 뿐,
 *     서버가 `plan_required` 로 다시 묻는다)
 *
 * 저장하면 서버가 화면을 다시 그린다(`router.refresh`) — 이름은 사이드바 · 내비에도 선다.
 *
 * ★ 저장하는 동안 컨트롤을 `disabled` 로 막지 않는다 — 막는 순간 브라우저가 포커스를 빼앗아 Enter 뒤의 Esc · 다음 입력이 칸에 닿지
 *   않는다(e2e 가 찾았다). 겹친 저장은 핸들러가 거른다(`saving`).
 */

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'

import type { SettingControl, SettingValue } from '@/lib/settings/registry'
import { PLAN_REQUIRED_BADGE } from '../teamspace-messages'
import { SETTING_OFFLINE, SETTING_SAVED, settingFailureMessage } from './settings-messages'

type Status = { readonly kind: 'saved' | 'error'; readonly text: string }

/** 칸에 쓰는 글자 — 켜고 끄기는 글자가 없다. */
const textOf = (value: SettingValue): string => (typeof value === 'boolean' ? '' : String(value))
/** 숫자 칸의 글자를 보낼 값으로 — 정수로 읽히면 수, 아니면 쓴 그대로(서버가 거부한다). */
const numberOrText = (draft: string): SettingValue => (/^\s*-?\d+\s*$/.test(draft) ? Number(draft) : draft)

export function SettingRow(props: {
  workspaceId: string
  settingKey: string
  label: string
  description: string
  control: SettingControl
  value: SettingValue
  editable: boolean
  /** 요금제가 막는다(4b-3) — "요금제 필요"를 붙인다. 그때 `readOnlyNote` 는 요금제의 안내다. */
  planRequired: boolean
  /** 읽기 전용일 때 — 누가 바꿀 수 있는지(요금제가 막으면 그 안내). */
  readOnlyNote: string | null
}) {
  const { control } = props
  const router = useRouter()
  const id = useId()
  const [value, setValue] = useState<SettingValue>(props.value)
  const [draft, setDraft] = useState(textOf(props.value))
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
    setDraft(textOf(body.value))
    setStatus({ kind: 'saved', text: SETTING_SAVED })
    router.refresh()
    return true
  }

  const commitText = () => {
    if (saving || draft === textOf(value)) return
    void save(control.kind === 'number' ? numberOrText(draft) : draft)
  }

  const textKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitText()
    }
    if (e.key === 'Escape') {
      setDraft(textOf(value))
      setStatus(null)
    }
  }

  /** 켜고 끄기 · 고르기 — 먼저 칠하고, 거부되면 되돌린다. */
  const choose = (next: SettingValue) => {
    if (saving) return
    const before = value
    setValue(next)
    void save(next).then((saved) => {
      if (!saved) setValue(before)
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
          <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
            {props.label}
            {props.planRequired && (
              <span
                data-testid="setting-plan-badge"
                className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-normal text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              >
                {PLAN_REQUIRED_BADGE}
              </span>
            )}
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
            onChange={(e) => choose(e.target.checked)}
            className="h-4 w-4 flex-none"
          />
        ) : control.kind === 'choice' ? (
          <select
            id={id}
            data-testid="setting-control"
            aria-describedby={`${id}-description`}
            aria-busy={saving || undefined}
            value={String(value)}
            disabled={!props.editable}
            onChange={(e) => choose(e.target.value)}
            className="w-48 flex-none rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
          >
            {control.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : props.editable && control.kind === 'number' ? (
          <span className="flex flex-none items-center gap-1.5 text-sm">
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={control.min}
              max={control.max}
              step={1}
              data-testid="setting-control"
              aria-describedby={`${id}-description`}
              value={draft}
              aria-busy={saving || undefined}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitText}
              onKeyDown={textKeys}
              className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-right text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <span data-testid="setting-unit" className="text-neutral-500">
              {control.unit}
            </span>
          </span>
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
            onKeyDown={textKeys}
            className="w-64 flex-none rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        ) : (
          <span id={id} data-testid="setting-control" className="max-w-64 flex-none truncate text-sm text-neutral-700 dark:text-neutral-300">
            {value}
            {control.kind === 'number' ? control.unit : ''}
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
