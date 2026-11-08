'use client'

/**
 * 도구줄 패널들이 함께 쓰는 조각 — 팝오버 틀 · 버킷 고르개 · 하위 그룹 세부 고르개.
 * 그룹 패널(`view-toolbar.tsx`)과 지연 로드되는 차트 패널(`chart-panel.tsx` · CH-6)이 같은 말을 쓰도록 한곳에 둔다.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  DATE_UNITS,
  DATE_UNIT_LABEL,
  DEFAULT_DATE_UNIT,
  DEFAULT_WEEK_START,
  WEEK_STARTS,
  WEEK_START_LABEL,
  type DateUnit,
  type WeekStart,
} from '@/lib/database/date-group'
import type { GroupBy } from '@/lib/database/group'
import { DEFAULT_NUMBER_SIZE, isNumberSize } from '@/lib/database/number-group'
import { DEFAULT_TEXT_MODE, TEXT_MODES, TEXT_MODE_LABEL, type TextMode } from '@/lib/database/text-group'

export const FIELD =
  'rounded border border-neutral-300 bg-transparent px-1.5 py-1 text-sm disabled:opacity-60 dark:border-neutral-700'

export function Popover({
  label,
  testId,
  onClose,
  children,
}: {
  label: string
  testId: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // 열리면 안의 첫 조작 요소로 포커스를 옮긴다(10n-28 · ARIA 대화상자 · WCAG 2.4.3) — 단추로 연 직후의 Esc 가 닿는다(전에는 포커스가 단추에
  // 남아 Esc 가 이 요소의 onKeyDown 에 닿지 않았다). 조작할 것이 없으면(잠긴 패널) 대화상자 자체로. 한 번만 — 다시 그려도 포커스를 빼앗지 않는다
  useEffect(() => {
    const root = ref.current
    if (root === null) return
    const first = root.querySelector<HTMLElement>('select:not([disabled]), input:not([disabled]), textarea:not([disabled]), button:not([disabled])')
    ;(first ?? root).focus()
  }, [])
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={label}
      data-testid={testId}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onClose()
        }
      }}
      className="absolute left-0 top-full z-30 mt-1 flex w-[36rem] max-w-[90vw] flex-col gap-2 popover-surface p-3"
    >
      {children}
    </div>
  )
}

/**
 * 축 하나의 버킷 고르개(B-4c) — 묶는 단위(상태) · 날짜의 단위 · 주의 시작 · 글의 방식 · 숫자의 구간. 열과 가로줄이 같이 쓴다. 부르는 쪽은 바뀐
 * 키(`patch`)를 지금 설정에 얹어 저장한다 — 숨김 목록은 싣지 않는다(키 공간이 달라진다).
 */
export function BucketControls({
  type,
  value,
  locked,
  testPrefix,
  axisLabel,
  onChange,
}: {
  type: string | undefined
  value: GroupBy
  locked: boolean
  /** testid 의 앞(`db-group` · `db-sub-group`). */
  testPrefix: string
  /** 접근성 이름의 앞(열은 `''` · 가로줄은 `가로줄의 `). */
  axisLabel: string
  onChange: (patch: Partial<GroupBy>) => void
}) {
  // 순서(S-1)는 단위 · 방식 · 구간을 바꿔도 남긴다 — 방향은 키 공간과 상관없다
  const change = (patch: Partial<GroupBy>) => onChange({ ...(value.sort === 'descending' ? { sort: 'descending' as const } : {}), ...patch })
  // 순서를 바꾸면 키 공간이 그대로다 — 지금의 단위 · 방식 · 구간 · 숨김을 그대로 싣는다
  const order = (
    <label className="flex items-center gap-2 text-sm">
      순서
      <select
        aria-label={`${axisLabel}그룹 순서`}
        data-testid={`${testPrefix}-sort`}
        value={value.sort === 'descending' ? 'descending' : 'ascending'}
        disabled={locked}
        onChange={(e) =>
          onChange({
            ...(value.hidden && value.hidden.length > 0 ? { hidden: value.hidden } : {}),
            ...(value.date_unit ? { date_unit: value.date_unit } : {}),
            ...(value.week_start ? { week_start: value.week_start } : {}),
            ...(value.number_size !== undefined ? { number_size: value.number_size } : {}),
            ...(value.text_by ? { text_by: value.text_by } : {}),
            ...(e.target.value === 'descending' ? { sort: 'descending' as const } : {}),
          })
        }
        className={FIELD}
      >
        <option value="ascending">오름차순</option>
        <option value="descending">내림차순</option>
      </select>
    </label>
  )
  if (type === 'status') {
    return (
      <label className="flex items-center gap-2 text-sm">
        묶는 단위
        <select
          aria-label={`${axisLabel}묶는 단위`}
          data-testid={`${testPrefix}-status-by`}
          value={value.status_by === 'group' ? 'group' : 'option'}
          disabled={locked}
          onChange={(e) => onChange(e.target.value === 'group' ? { status_by: 'group' } : {})}
          className={FIELD}
        >
          <option value="option">옵션별</option>
          <option value="group">그룹별(할 일 · 진행 중 · 완료)</option>
        </select>
      </label>
    )
  }
  if (type === 'date') {
    return (
      <>
        <label className="flex items-center gap-2 text-sm">
          묶는 단위
          <select
            aria-label={`${axisLabel}날짜를 묶는 단위`}
            data-testid={`${testPrefix}-date-unit`}
            value={value.date_unit ?? DEFAULT_DATE_UNIT}
            disabled={locked}
            // 주의 시작 요일은 단위를 바꿔도 남긴다 — 주로 다시 돌아오면 그대로
            onChange={(e) => change({ date_unit: e.target.value as DateUnit, ...(value.week_start ? { week_start: value.week_start } : {}) })}
            className={FIELD}
          >
            {DATE_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {DATE_UNIT_LABEL[unit]}
              </option>
            ))}
          </select>
        </label>
        {value.date_unit === 'week' && (
          <label className="flex items-center gap-2 text-sm">
            주의 시작
            <select
              aria-label={`${axisLabel}주의 시작 요일`}
              data-testid={`${testPrefix}-week-start`}
              value={value.week_start ?? DEFAULT_WEEK_START}
              disabled={locked}
              onChange={(e) => change({ date_unit: 'week', week_start: e.target.value as WeekStart })}
              className={FIELD}
            >
              {WEEK_STARTS.map((start) => (
                <option key={start} value={start}>
                  {WEEK_START_LABEL[start]}
                </option>
              ))}
            </select>
          </label>
        )}
        {order}
      </>
    )
  }
  if (type === 'rich_text') {
    return (
      <>
      <label className="flex items-center gap-2 text-sm">
        묶는 방식
        <select
          aria-label={`${axisLabel}글을 묶는 방식`}
          data-testid={`${testPrefix}-text-by`}
          value={value.text_by ?? DEFAULT_TEXT_MODE}
          disabled={locked}
          onChange={(e) => change({ text_by: e.target.value as TextMode })}
          className={FIELD}
        >
          {TEXT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {TEXT_MODE_LABEL[mode]}
            </option>
          ))}
        </select>
      </label>
      {order}
      </>
    )
  }
  if (type === 'number') {
    return (
      <>
      {/* 칸을 떠나거나 Enter 로 저장한다 */}
      <NumberSizeField
        key={value.number_size ?? DEFAULT_NUMBER_SIZE}
        size={value.number_size ?? DEFAULT_NUMBER_SIZE}
        disabled={locked}
        testId={`${testPrefix}-number-size`}
        label={`${axisLabel}숫자를 묶는 구간 크기`}
        onCommit={(size) => change({ number_size: size })}
      />
      {order}
      </>
    )
  }
  return null
}

/** 숫자 그룹의 구간 크기(B-2) — 고치는 동안은 칸의 글자, 떠나거나 Enter 면 맞는 크기일 때만 저장한다(아니면 되돌린다). */
export function NumberSizeField({
  size,
  disabled,
  testId = 'db-group-number-size',
  label = '숫자를 묶는 구간 크기',
  onCommit,
}: {
  size: number
  disabled: boolean
  testId?: string
  label?: string
  onCommit: (size: number) => void
}) {
  const [draft, setDraft] = useState(String(size))
  const commit = () => {
    const next = Number(draft)
    if (draft.trim() !== '' && isNumberSize(next) && next !== size) onCommit(next)
    else setDraft(String(size))
  }
  return (
    <label className="flex items-center gap-2 text-sm">
      구간 크기
      <input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        aria-label={label}
        data-testid={testId}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        className={`${FIELD} w-24`}
      />
    </label>
  )
}

/**
 * 하위 그룹의 세부 고르개(B-4c · CH-6) — 버킷 고르개(날짜 단위 · 숫자 구간 · 글의 방식 · 순서) · 빈 줄 숨기기 · 줄마다 보이기.
 * 보드의 가로줄(`db-sub-group-*`)과 차트의 쌓기(`chart-stack-*`)가 같이 쓴다. 저장하는 것은 둘 다 뷰의 `subGroupBy` 다.
 */
export function SubGroupDetail({
  type,
  now,
  lanes,
  locked,
  testPrefix,
  axisLabel,
  hideEmptyLabel,
  listLabel,
  onSave,
}: {
  type: string | undefined
  now: GroupBy
  lanes: readonly { readonly key: string; readonly label: string; readonly count: number; readonly hidden: boolean }[]
  locked: boolean
  /** testid 의 앞(`db-sub-group` · `chart-stack`). */
  testPrefix: string
  axisLabel: string
  hideEmptyLabel: string
  listLabel: string
  onSave: (next: GroupBy | null) => Promise<boolean>
}) {
  const toggleHidden = (key: string, hidden: boolean) => {
    const next = new Set(now.hidden ?? [])
    if (hidden) next.add(key)
    else next.delete(key)
    void onSave({ ...now, hidden: [...next] })
  }
  return (
    <>
      <BucketControls
        type={type}
        value={now}
        locked={locked}
        testPrefix={testPrefix}
        axisLabel={axisLabel}
        onChange={(patch) => void onSave({ property_id: now.property_id, ...(now.hide_empty ? { hide_empty: true } : {}), ...patch })}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid={`${testPrefix}-hide-empty`}
          checked={now.hide_empty === true}
          disabled={locked}
          onChange={(e) => void onSave({ ...now, hide_empty: e.target.checked })}
        />
        {hideEmptyLabel}
      </label>
      <ul aria-label={listLabel} className="flex flex-col gap-1">
        {lanes.map((l) => (
          <li key={l.key}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid={`${testPrefix}-visible`}
                data-lane-key={l.key}
                checked={!l.hidden}
                disabled={locked}
                onChange={(e) => toggleHidden(l.key, !e.target.checked)}
              />
              {l.label}
              <span className="text-xs tabular-nums text-neutral-400">{l.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </>
  )
}
