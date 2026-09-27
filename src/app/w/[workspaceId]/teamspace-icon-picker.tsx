'use client'

/**
 * teamspace 아이콘 고르개 — 이모지 한 글자 · 없음 (7c-14조각 · F-06-04)
 *
 * 만들기 폼(사이드바 — 좁다)과 설정 절이 함께 쓴다. 고르는 것만 하고 저장은 부르는 쪽이 한다. 첫 칸은 "아이콘 없음"이고 기본
 * 표시(▣)로 그린다 — 없으면 사이드바에 그 글자가 서기 때문이다.
 *
 * 지금 값이 목록 밖의 이모지면(API 로 둔 것) 그 값을 맨 앞에 한 칸 더 세운다 — 고르개가 지금 값을 모르는 것처럼 보이면 안 된다.
 */

import { DEFAULT_TEAMSPACE_ICON, TEAMSPACE_ICON_CHOICES } from './teamspace-messages'

const CELL =
  'flex h-6 w-6 items-center justify-center rounded text-sm hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800'
const PICKED = 'bg-neutral-200 ring-1 ring-neutral-500 dark:bg-neutral-700'

export function TeamspaceIconPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null
  onChange: (icon: string | null) => void
  disabled?: boolean
}) {
  const choices = value !== null && !TEAMSPACE_ICON_CHOICES.includes(value) ? [value, ...TEAMSPACE_ICON_CHOICES] : TEAMSPACE_ICON_CHOICES
  return (
    <div role="group" aria-label="teamspace 아이콘" data-testid="teamspace-icon-picker" className="flex flex-wrap gap-0.5">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={value === null}
        aria-label="아이콘 없음"
        title="아이콘 없음"
        data-testid="teamspace-icon-none"
        onClick={() => onChange(null)}
        className={`${CELL} text-neutral-400 ${value === null ? PICKED : ''}`}
      >
        {DEFAULT_TEAMSPACE_ICON}
      </button>
      {choices.map((icon) => (
        <button
          key={icon}
          type="button"
          disabled={disabled}
          aria-pressed={value === icon}
          aria-label={`아이콘 ${icon}`}
          data-testid="teamspace-icon-choice"
          data-icon={icon}
          onClick={() => onChange(icon)}
          className={`${CELL} ${value === icon ? PICKED : ''}`}
        >
          {icon}
        </button>
      ))}
    </div>
  )
}
