/**
 * 셀 값 ↔ 화면 — W8-b (F-03-16 의 UI 몫)
 *
 * 값 계약은 `property-types.ts` 가 갖고 있다. 이 파일은 그 계약과 **사람이 보는
 * 문자열** 사이를 오간다: 칸에 그릴 글자, 편집을 시작할 때 입력칸에 넣을 초안,
 * 입력칸의 글자를 다시 값으로.
 *
 * DOM 을 모른다. 화면은 이 함수들을 부르기만 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 읽기는 관대하게, 쓰기는 서버와 같은 함수로
 * ──────────────────────────────────────────────────────────────────────
 *
 * `properties_cache` 에서 온 값은 계약을 어겼을 수 있다 — 타입 변환(F-03-09)
 * 이전의 옛 셀은 봉투의 `type` 이 프로퍼티와 다르다. 그런 셀 하나 때문에 표가
 * 그려지지 않으면 안 되므로 **빈 값으로 읽는다**(`readTitle` 과 같은 태도).
 *
 * 반대로 입력칸의 글자를 값으로 바꿀 때는 보내기 전에 `validateCellValue` 로
 * 검사한다. **서버가 쓰는 바로 그 함수다** — 화면에서만 다른 규칙으로 검사하면
 * "화면은 받아줬는데 저장은 거부되는" 입력이 생긴다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 날짜는 적힌 그대로 보여준다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `2026-09-13T23:30:00+09:00` 을 `Date` 로 바꿔 로컬 시각으로 그리면 보는 사람의
 * 시간대에 따라 날짜가 하루 밀린다. `property-types.ts` 의 `parseDate` 가 달력
 * 유효성을 **적힌 날짜 그대로** 보는 것과 같은 이유로, 여기서도 문자열의 연·월·일·
 * 시·분을 그대로 쓴다. 시간대 표시(`time_zone`)는 MVP 에 없다.
 */

import { MAX_RUN_CONTENT, textRun, toPlainText } from '../contracts/rich-text.ts'
import {
  emptyValue,
  validateCellValue,
  optionIdOf,
  type CellValue,
  type DateValue,
  type MvpPropertyType,
  type SelectOption,
} from './property-types.ts'

// ── 읽기 ──────────────────────────────────────────────────────────────

/**
 * `properties_cache` 의 한 칸을 값으로 읽는다. 없거나 계약을 어기면 타입별 빈 값이다.
 *
 * ⚠ `checkbox` 의 빈 값은 `null` 이 아니라 `false` 다(`emptyValue`).
 */
export function readCell(type: MvpPropertyType, raw: unknown): CellValue {
  if (raw === undefined || raw === null) return emptyValue(type)
  return validateCellValue(type, raw).length === 0 ? (raw as CellValue) : emptyValue(type)
}

/**
 * 칸에 그릴 글자.
 *
 * select 는 **옵션 id 로 이름을 찾는다.** 없는 id(지워진 옵션)면 빈 칸이다 —
 * F-03-04: *"옵션 삭제 시 그 옵션을 쓰던 셀은 빈 값이 된다."* id 를 그대로 그리면
 * 사용자가 알아볼 수 없는 문자열이 칸에 박힌다.
 *
 * checkbox 는 화면이 체크박스로 그린다. 여기서 주는 글자는 접근성 이름이다.
 */
export function cellText(value: CellValue, options: readonly SelectOption[] = []): string {
  switch (value.type) {
    case 'title':
      return toPlainText(value.title)
    case 'rich_text':
      return toPlainText(value.rich_text)
    case 'number':
      return value.number === null ? '' : String(value.number)
    case 'select':
    case 'status': {
      const id = optionIdOf(value)
      return id === null ? '' : (options.find((o) => o.id === id)?.name ?? '')
    }
    case 'checkbox':
      return value.checkbox ? '체크됨' : '체크 안 됨'
    case 'date':
      return value.date === null ? '' : formatDate(value.date)
  }
}

const DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/

/** `2026-09-13` → `2026년 9월 13일`. 시각이 적혀 있으면 붙인다. 범위는 `→` 로 잇는다. */
export function formatDate(date: DateValue): string {
  const one = (raw: string): string => {
    const m = DATE_PARTS.exec(raw)
    if (m === null) return raw
    const day = `${Number(m[1])}년 ${Number(m[2])}월 ${Number(m[3])}일`
    return m[4] === undefined ? day : `${day} ${m[4]}:${m[5]}`
  }
  return date.end ? `${one(date.start)} → ${one(date.end)}` : one(date.start)
}

// ── 편집 ──────────────────────────────────────────────────────────────

/** 편집을 시작할 때 입력칸에 넣을 글자. select · checkbox 는 입력칸으로 고치지 않는다. */
export function draftOf(value: CellValue): string {
  switch (value.type) {
    case 'title':
      return toPlainText(value.title)
    case 'rich_text':
      return toPlainText(value.rich_text)
    case 'number':
      return value.number === null ? '' : String(value.number)
    case 'date':
      // `<input type="date">` 가 받는 모양. 시각은 이 입력칸이 고치지 않는다.
      return value.date === null ? '' : value.date.start.slice(0, 10)
    case 'select':
    case 'status':
    case 'checkbox':
      return ''
  }
}

export type ParseResult =
  | { readonly ok: true; readonly value: CellValue }
  | { readonly ok: false; readonly message: string }

/** 소수·지수를 받는다. `0x10` · `Infinity` 처럼 `Number()` 는 받지만 사람이 뜻하지 않은 모양은 받지 않는다. */
const NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i

/**
 * 입력칸의 글자를 값으로. 보내기 전에 서버와 같은 함수로 검사한다(머리말).
 *
 * @param previous 편집을 시작할 때의 값. 텍스트의 서식을 지키고 날짜의 끝을 잇는 데 쓴다.
 */
export function parseDraft(type: MvpPropertyType, draft: string, previous: CellValue): ParseResult {
  switch (type) {
    case 'title':
    case 'rich_text': {
      // ★ 글자가 그대로면 **이전 값을 그대로 돌려준다.** 평문 입력칸은 서식을 모르므로,
      //   새로 만들면 굵게·링크가 붙어 있던 칸이 열었다 닫는 것만으로 서식을 잃는다.
      if (previous.type === type && draftOf(previous) === draft) return { ok: true, value: previous }
      // 한 줄 입력칸이지만 붙여넣기로 줄바꿈이 들어올 수 있다. 제목에는 줄바꿈이
      // 없다(`titleFromPlainText` 와 같은 규칙).
      const text = draft.replace(/\r?\n/g, ' ')
      if (text.length > MAX_RUN_CONTENT) {
        return { ok: false, message: `${MAX_RUN_CONTENT}자를 넘을 수 없습니다` }
      }
      const runs = text === '' ? [] : [textRun(text)]
      return checked(type === 'title' ? { type: 'title', title: runs } : { type: 'rich_text', rich_text: runs })
    }

    case 'number': {
      // 천 단위 쉼표는 사람이 흔히 친다. 받아준다.
      const s = draft.trim().replace(/,/g, '')
      if (s === '') return checked({ type: 'number', number: null })
      if (!NUMBER.test(s)) return { ok: false, message: '숫자가 아닙니다' }
      const n = Number(s)
      if (!Number.isFinite(n)) return { ok: false, message: '너무 큰 숫자입니다' }
      return checked({ type: 'number', number: n })
    }

    case 'date': {
      const s = draft.trim()
      if (s === '') return checked({ type: 'date', date: null })
      // 끝 날짜는 이 입력칸이 고치지 않으므로 이어 붙인다. 단 새 시작이 끝보다 뒤면
      // 범위가 거꾸로가 되어 서버가 거부한다 — 그때만 끝을 버린다. 거부하게 두면
      // 사용자는 시작 날짜를 옮길 방법이 없다.
      const prev = previous.type === 'date' ? previous.date : null
      const end = prev?.end && prev.end.slice(0, 10) >= s ? prev.end : null
      const date: DateValue = {
        start: s,
        ...(end ? { end } : {}),
        ...(prev?.time_zone ? { time_zone: prev.time_zone } : {}),
      }
      return checked({ type: 'date', date })
    }

    case 'select':
    case 'status':
    case 'checkbox':
      return { ok: false, message: '입력칸으로 고치는 타입이 아닙니다' }
  }
}

function checked(value: CellValue): ParseResult {
  const issues = validateCellValue(value.type, value)
  return issues.length === 0 ? { ok: true, value } : { ok: false, message: issues[0].message }
}

/**
 * 두 값이 같은가. 같으면 저장하지 않는다 — 셀 쓰기마다 `block.version` 이 오른다(X-6).
 *
 * 키 순서를 보지 않는다. 서버가 돌려준 값은 jsonb 를 거쳐 키 순서가 바뀌어 있다.
 * 값이 `null` 인 키와 없는 키를 같게 본다 — 날짜의 `end: null` 과 `end` 없음은 같은 뜻이다.
 */
export function sameValue(a: CellValue, b: CellValue): boolean {
  return canonical(a) === canonical(b)
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v !== null && typeof v === 'object') {
    const obj = v as Record<string, unknown>
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined && obj[k] !== null)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

// ── 표시 ──────────────────────────────────────────────────────────────

/**
 * 폭이 저장되지 않은 컬럼의 폭(px).
 *
 * F-04-12: *"`width` 미설정 → NULL 유지 + 렌더 시 타입별 기본 폭 계산. **기본값을
 * 물리적으로 써 넣지 말 것.**"* 써 넣으면 기본 폭 정책을 나중에 바꿀 수 없다.
 */
export function defaultColumnWidth(type: MvpPropertyType): number {
  switch (type) {
    case 'title':
      return 280
    case 'rich_text':
      return 220
    case 'number':
    case 'select':
    case 'status':
    case 'date':
      return 160
    case 'checkbox':
      return 90
  }
}
