/**
 * 프로퍼티 타입 바꾸기의 규칙 — 칸 하나를 새 타입으로 (DB 심화 2c-1조각 · F-03-14 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 프로퍼티 타입 바꾸기 ② ③ ④
 *
 * ──────────────────────────────────────────────────────────────────────
 * 글을 거친다 — 칸을 글로 읽고, 그 글을 새 타입으로 읽는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 03 F-03-14 의 *"텍스트 경유 허브 패턴이면 충분하다: X → text → Y"*. 쌍마다 변환기를 따로 두면 다섯 타입에 스무 개가 되고 그 사이의
 * 규칙이 어긋난다(숫자 → 선택과 글 → 선택이 같은 글에서 다른 옵션을 만드는 식). 글로 읽는 규칙이 하나, 글에서 읽는 규칙이 하나다.
 *
 *   글로 읽기   글 · 제목 → 평문 / 숫자 → 그대로 / 선택 → 옵션 이름 / 체크박스 → `Yes` 또는 빈 글 / 날짜 → ISO(범위는 `시작 → 끝`)
 *   글에서 읽기 글 → 한 덩어리 / 숫자 → 읽히는 수만(천 단위 쉼표는 뗀다) / 선택 → 이름이 곧 옵션 / 체크박스 → `Yes` · `true` · `1` 이면
 *               체크(`No` · `false` · `0` · 빈 글이면 체크 안 함) / 날짜 → ISO 날짜 · 날짜시간, 범위
 *
 * 이 규칙이 CSV 내보내기(`export/csv.ts`)의 글과 같은 모양이라 "내보낸 CSV 를 보고 짐작한 값"으로 바뀐다(체크박스 `Yes` · 날짜 범위 ` → `).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 손실 = 값이 있던 칸이 빈 칸이 되는 것
 * ──────────────────────────────────────────────────────────────────────
 *
 * 글로 읽은 것이 비어 있지 않은데 새 타입이 그것을 받지 못하면 손실이다(`"약 3개"` → 숫자). 체크박스는 빈 값이 없으므로(false) 받지 못한
 * 글(`"abc"`)은 체크 안 함이 되고 손실로 센다. 서식(굵게 · 멘션)이 글로 접히는 것은 세지 않는다 — 사람이 "값이 사라졌다"고 느끼는 것을 센다.
 */

import { textRun, toPlainText } from '../contracts/rich-text.ts'
import type { CellValue, DateValue, MvpPropertyType } from './property-types.ts'

/** 서로 바꿀 수 있는 타입(정본 ②). 제목은 바꿀 수도 바꿔 올 수도 없다 · 상태 · relation · rollup · 고유 ID 는 아직. */
export const CONVERTIBLE_TYPES = ['rich_text', 'number', 'select', 'checkbox', 'date'] as const
export type ConvertibleType = (typeof CONVERTIBLE_TYPES)[number]

export function isConvertibleType(t: unknown): t is ConvertibleType {
  return typeof t === 'string' && (CONVERTIBLE_TYPES as readonly string[]).includes(t)
}

/** 칸 → 글(허브). `optionName` 은 선택 칸의 옵션 id → 이름(지워진 옵션은 null — 빈 글). */
export function cellToText(value: CellValue, optionName: (id: string) => string | null): string {
  switch (value.type) {
    case 'title':
      return toPlainText(value.title)
    case 'rich_text':
      return toPlainText(value.rich_text)
    case 'number':
      return value.number === null ? '' : String(value.number)
    case 'select':
      return value.select === null ? '' : (optionName(value.select.id) ?? '')
    case 'status':
      return value.status === null ? '' : (optionName(value.status.id) ?? '')
    case 'checkbox':
      return value.checkbox ? 'Yes' : ''
    case 'date':
      if (value.date === null) return ''
      return value.date.end ? `${value.date.start} → ${value.date.end}` : value.date.start
  }
}

export type Converted = {
  /** 새 칸. null 이면 칸이 없다(빈 값). */
  readonly value: CellValue | null
  /** 값이 있던 칸이 비게 됐다(정본 ④). */
  readonly lost: boolean
}

const TRUE_WORDS = new Set(['yes', 'true', '1', 'y', '✓', '✔', '예', '체크'])
const FALSE_WORDS = new Set(['no', 'false', '0', 'n', '아니오', ''])

/**
 * 글 → 새 타입의 칸. 선택은 `optionIdFor(이름)` 이 옵션 id 를 준다(없으면 만들어 줄 쪽이 정한다 — 명령의 일이다).
 */
export function textToCell(raw: string, to: ConvertibleType, optionIdFor: (name: string) => string): Converted {
  const text = raw.replace(/\s+/g, ' ').trim()
  const empty = text === ''
  switch (to) {
    case 'rich_text':
      return { value: empty ? null : { type: 'rich_text', rich_text: [textRun(raw.trim())] }, lost: false }
    case 'number': {
      if (empty) return { value: null, lost: false }
      const n = parseNumber(text)
      return n === null ? { value: null, lost: true } : { value: { type: 'number', number: n }, lost: false }
    }
    case 'select': {
      if (empty) return { value: null, lost: false }
      // 옵션 이름은 프로퍼티 이름과 같은 상한(200자) — 넘으면 잘라 이름으로 쓴다(값이 사라지지 않는다).
      return { value: { type: 'select', select: { id: optionIdFor(text.slice(0, 200)) } }, lost: false }
    }
    case 'checkbox': {
      const word = text.toLowerCase()
      if (TRUE_WORDS.has(word)) return { value: { type: 'checkbox', checkbox: true }, lost: false }
      // 체크 안 함은 칸을 두지 않는다(빈 값이 곧 false). 받지 못한 글은 손실이다.
      return { value: null, lost: !FALSE_WORDS.has(word) }
    }
    case 'date': {
      if (empty) return { value: null, lost: false }
      const date = parseDateText(text)
      return date === null ? { value: null, lost: true } : { value: { type: 'date', date }, lost: false }
    }
  }
}

/** 칸 하나를 바꾼다 — 글로 읽고 글에서 읽는다. */
export function convertCell(
  value: CellValue,
  to: ConvertibleType,
  options: { readonly optionName: (id: string) => string | null; readonly optionIdFor: (name: string) => string },
): Converted {
  return textToCell(cellToText(value, options.optionName), to, options.optionIdFor)
}

/** 읽히는 수만. 천 단위 쉼표는 뗀다(`1,234`). 무한 · NaN · 빈 글은 null. */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/,(?=\d{3}(\D|$))/g, '').trim()
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

const DATE_PART = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

/** ISO 날짜 · 날짜시간, 또는 `시작 → 끝`. 달력에 없는 날(2월 30일)은 받지 않는다. */
export function parseDateText(text: string): DateValue | null {
  const [startRaw, endRaw, ...rest] = text.split('→').map((part) => part.trim())
  if (rest.length > 0 || startRaw === undefined) return null
  const valid = (part: string): boolean => {
    if (!DATE_PART.test(part)) return false
    const day = part.slice(0, 10)
    const parsed = new Date(`${day}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
  }
  if (!valid(startRaw)) return null
  if (endRaw === undefined) return { start: startRaw }
  if (!valid(endRaw) || endRaw < startRaw) return null
  return { start: startRaw, end: endRaw }
}

/** 이 칸이 빈 값인가 — 타입별 빈 모양(`emptyValue`)과 같은 뜻. 명령이 "바꿀 칸 수"를 셀 때 쓴다. */
export function isBlank(value: CellValue): boolean {
  switch (value.type) {
    case 'title':
      return value.title.length === 0
    case 'rich_text':
      return value.rich_text.length === 0
    case 'number':
      return value.number === null
    case 'select':
      return value.select === null
    case 'status':
      return value.status === null
    case 'checkbox':
      return !value.checkbox
    case 'date':
      return value.date === null
  }
}

/** 이 타입에서 저 타입으로 바꿀 수 있는가(같은 타입은 바꾸는 것이 아니다). */
export function canConvert(from: MvpPropertyType | string, to: unknown): to is ConvertibleType {
  return isConvertibleType(from) && isConvertibleType(to) && from !== to
}
