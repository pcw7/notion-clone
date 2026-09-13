/**
 * 칸의 읽기 모양 · 타입 표시 — 표 화면이 쓴다.
 *
 * 글자를 만드는 규칙은 `cell-format.ts` 에 있다. 여기는 그 글자에 모양만 입힌다.
 */

import { cellText } from '@/lib/database/cell-format'
import type { CellValue, MvpPropertyType, OptionColor, SelectOption } from '@/lib/database/property-types'

export const TYPE_LABEL: Readonly<Record<MvpPropertyType, string>> = {
  title: '제목',
  rich_text: '텍스트',
  number: '숫자',
  select: '선택',
  checkbox: '체크박스',
  date: '날짜',
}

/** 헤더의 타입 아이콘. 장식이다 — 스크린리더에는 `TYPE_LABEL` 이 간다. */
export const TYPE_ICON: Readonly<Record<MvpPropertyType, string>> = {
  title: 'Aa',
  rich_text: '≡',
  number: '#',
  select: '▾',
  checkbox: '☑',
  date: '◷',
}

/**
 * 옵션 색 → 칩 모양. 키가 `option_color` ENUM 과 같다(`OPTION_COLORS`).
 *
 * Tailwind 가 소스에서 클래스 이름을 찾으므로 **문자열 전체를 적는다** — 조립하면
 * (`bg-${color}-100`) 스타일이 빌드에 들어가지 않는다.
 */
const OPTION_CLASS: Readonly<Record<OptionColor, string>> = {
  default: 'bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200',
  gray: 'bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100',
  brown: 'bg-stone-200 text-stone-800 dark:bg-stone-700 dark:text-stone-100',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-100',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/60 dark:text-yellow-100',
  green: 'bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-100',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-100',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-100',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-900/60 dark:text-pink-100',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-100',
}

export function OptionChip({ option }: { option: SelectOption }) {
  return (
    <span
      data-testid="db-option-chip"
      className={`inline-block max-w-full truncate rounded px-1.5 py-0.5 text-xs ${OPTION_CLASS[option.color]}`}
    >
      {option.name}
    </span>
  )
}

export function CellDisplay({ value, options }: { value: CellValue; options: readonly SelectOption[] }) {
  switch (value.type) {
    case 'checkbox':
      return (
        <span
          role="img"
          aria-label={cellText(value)}
          className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none ${
            value.checkbox
              ? 'border-blue-500 bg-blue-500 text-white'
              : 'border-neutral-300 dark:border-neutral-600'
          }`}
        >
          {value.checkbox ? '✓' : ''}
        </span>
      )
    case 'select': {
      const option = options.find((o) => o.id === value.select?.id)
      return option ? <OptionChip option={option} /> : null
    }
    case 'number':
      return <span className="block truncate text-right tabular-nums">{cellText(value)}</span>
    default:
      return <span className="block truncate">{cellText(value, options)}</span>
  }
}
