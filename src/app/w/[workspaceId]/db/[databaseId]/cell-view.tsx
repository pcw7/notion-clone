/**
 * 칸의 읽기 모양 · 타입 표시 — 표 화면이 쓴다.
 *
 * 글자를 만드는 규칙은 `cell-format.ts` 에 있다. 여기는 그 글자에 모양만 입힌다.
 */

import { cellText } from '@/lib/database/cell-format'
import { optionIdOf } from '@/lib/database/property-types'
import type { RollupCell, RollupColumnInfo } from '@/lib/database/rollup-functions'
import type { AppPropertyType, CellValue, OptionColor, RelationValue, SelectOption } from '@/lib/database/property-types'

export const TYPE_LABEL: Readonly<Record<AppPropertyType, string>> = {
  title: '제목',
  rich_text: '텍스트',
  number: '숫자',
  select: '선택',
  status: '상태',
  checkbox: '체크박스',
  date: '날짜',
  relation: '관계형',
  rollup: '롤업',
}

/** 헤더의 타입 아이콘. 장식이다 — 스크린리더에는 `TYPE_LABEL` 이 간다. */
export const TYPE_ICON: Readonly<Record<AppPropertyType, string>> = {
  title: 'Aa',
  rich_text: '≡',
  number: '#',
  select: '▾',
  status: '◔',
  checkbox: '☑',
  date: '◷',
  relation: '↗',
  rollup: '∑',
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

/** status 칩의 점. 칩 배경과 같은 색 계열의 진한 쪽이다. */
const DOT_CLASS: Readonly<Record<OptionColor, string>> = {
  default: 'bg-neutral-400',
  gray: 'bg-neutral-500',
  brown: 'bg-stone-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  red: 'bg-red-500',
}

/**
 * 옵션 칩. **status 옵션(그룹이 있다)은 색 점 + 둥근 알약**으로 그린다 — F-03-05: *"셀에는 색 점 + 이름 표시
 * (select 의 알약형 칩과 시각적으로 구분)."* 칩을 쓰는 곳(칸 · 편집기 목록 · 보드 열 머리 · 카드 배지)이 옵션만
 * 넘기면 모양이 따라온다.
 */
export function OptionChip({ option }: { option: SelectOption }) {
  if (option.group !== undefined) {
    return (
      <span
        data-testid="db-option-chip"
        data-status-group={option.group}
        className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs ${OPTION_CLASS[option.color]}`}
      >
        <span aria-hidden className={`h-1.5 w-1.5 flex-none rounded-full ${DOT_CLASS[option.color]}`} />
        <span className="truncate">{option.name}</span>
      </span>
    )
  }
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
    case 'select':
    case 'status': {
      const id = optionIdOf(value)
      const option = id === null ? undefined : options.find((o) => o.id === id)
      return option ? <OptionChip option={option} /> : null
    }
    case 'number':
      return <span className="block truncate text-right tabular-nums">{cellText(value)}</span>
    default:
      return <span className="block truncate">{cellText(value, options)}</span>
  }
}

/** 연결된 행의 제목 맵 — `relation.ts` `loadRelationLabels` 의 답. 제목 · `null`(볼 수 없다) · 키 없음(휴지통). */
export type RelationLabels = Readonly<Record<string, string | null>>

/**
 * relation 칸 (relation 5b-1) — 캐시의 id(`RelationValue`)에 제목 맵을 입혀 그린다.
 *
 *   제목이 있는 id    칩
 *   `null`            칩을 그리지 않고 "볼 수 없는 연결 N개"로 센다 — 제목도 id 도 화면에 없다
 *   맵에 없는 id      그리지 않는다(휴지통 · 아직 제목을 못 받았다)
 *   캐시 밖(25개 뒤)  `+N`
 *
 * ★ 캐시의 id 로 제목을 **직접** 읽는 경로를 만들지 않는다 — 권한과 휴지통을 거르는 곳은 서버의 제목 맵 하나다.
 */
export function RelationChips({ value, labels }: { value: RelationValue; labels: RelationLabels }) {
  const titled = value.relation.filter((ref) => typeof labels[ref.id] === 'string')
  const hidden = value.relation.filter((ref) => labels[ref.id] === null).length
  const beyond = Math.max(0, value.count - value.relation.length)
  if (titled.length === 0 && hidden === 0 && beyond === 0) return null
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden" data-testid="db-relation">
      {titled.map((ref) => (
        <span
          key={ref.id}
          data-testid="db-relation-chip"
          className="max-w-[10rem] flex-none truncate rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
        >
          <span aria-hidden className="mr-1 text-neutral-400">
            ↗
          </span>
          {labels[ref.id] || '제목 없음'}
        </span>
      ))}
      {beyond > 0 && (
        <span data-testid="db-relation-more" className="flex-none text-xs text-neutral-400">
          +{beyond}
        </span>
      )}
      {hidden > 0 && (
        <span data-testid="db-relation-hidden" className="flex-none text-xs text-neutral-400">
          볼 수 없는 연결 {hidden}개
        </span>
      )}
    </span>
  )
}

// ── rollup (5c-2) ────────────────────────────────────────────────────

const NOTE = 'flex-none text-xs text-neutral-400'

/**
 * rollup 칸 — 읽기 전용이다.
 *
 * 값은 행에 없다(읽을 때 계산한다 · `use-rollup-values.ts`). 그래서 받지 못한 칸(`undefined`)은 **빈 칸**이지 0 이 아니다 —
 * 숫자 `null` 도 마찬가지다(연결이 0개인 평균 · 최소 · 최대 · 진행률 · 날짜 · `rollup-functions.ts` 머리말). 0 을 그리면
 * "작업이 없는 프로젝트의 진행률 0%" 가 되어 "아무것도 안 끝났다"로 읽힌다.
 *
 * 그릴 수 없는 세 가지는 **말한다.** 조용히 비워 두면 "값이 없다"와 구분되지 않는다:
 *
 *   설정이 끊겼다    관계형 · 대상 속성이 지워졌다(복원하면 돌아온다)
 *   너무 많다        한 칸의 연결이 상한을 넘었다 — 앞의 것만 더한 틀린 합 대신 그렇다고 말한다
 *   볼 수 없는 항목  집계에서 뺀 연결의 수(정본: "N개 항목 접근 불가"). 값이 아니라 **개수만** 말한다
 */
export function RollupDisplay({ cell, info }: { cell: RollupCell | undefined; info: RollupColumnInfo | undefined }) {
  if (info !== undefined && info.state !== 'ok') {
    return (
      <span
        data-testid="db-rollup-broken"
        title={info.state === 'relation_missing' ? '관계형 속성이 지워졌습니다' : '대상 속성이 지워졌습니다'}
        className={NOTE}
      >
        설정이 끊겼습니다
      </span>
    )
  }
  if (cell === undefined) return null
  if (cell.state === 'too_many') {
    return (
      <span data-testid="db-rollup-many" title="연결이 너무 많아 계산하지 않습니다" className={NOTE}>
        연결이 너무 많습니다
      </span>
    )
  }

  const { result } = cell
  const hidden =
    cell.hidden > 0 ? (
      <span data-testid="db-rollup-hidden" className={NOTE}>
        볼 수 없는 항목 {cell.hidden}개
      </span>
    ) : null

  // 값 목록(show_original)은 칩으로. 옵션 id 는 대상 표의 이름으로 그린다(볼 수 있는 표일 때만 옵션이 온다).
  if (result.kind === 'values') {
    const beyond = result.count - result.values.length
    return (
      <span className="flex min-w-0 items-center gap-1 overflow-hidden" data-testid="db-rollup">
        {result.values.map((value, at) => (
          <span
            key={at}
            data-testid="db-rollup-chip"
            className="max-w-[10rem] flex-none truncate rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
          >
            <CellDisplay value={value} options={info?.state === 'ok' ? info.targetOptions : []} />
          </span>
        ))}
        {beyond > 0 && (
          <span data-testid="db-rollup-more" className={NOTE}>
            +{beyond}
          </span>
        )}
        {hidden}
      </span>
    )
  }

  const text =
    result.kind === 'number'
      ? result.number === null
        ? ''
        : String(result.number)
      : result.kind === 'percent'
        ? result.percent === null
          ? ''
          : `${Math.round(result.percent * 1000) / 10}%`
        : result.date === null
          ? ''
          : cellText({ type: 'date', date: { start: result.date } })

  if (text === '' && hidden === null) return null
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden" data-testid="db-rollup">
      {text !== '' && (
        <span
          data-testid="db-rollup-value"
          className={`min-w-0 truncate ${result.kind === 'date' ? '' : 'tabular-nums'}`}
        >
          {text}
        </span>
      )}
      {hidden}
    </span>
  )
}
