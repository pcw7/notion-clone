/**
 * 프로퍼티 타입 레지스트리 — W8-a (F-03-03 · F-03-04 · F-03-06 · F-03-16)
 *
 * 정본: 00-canonical-data-model.md §3.5 (`page_property_value` 의 `value` 는
 *       "타입별 판별 유니온(정본)", 사이드카는 "value 에서 파생")
 *       03-database-core.md 프로퍼티 전수표 · F-03-03 검증표
 *
 * ⚠ `src/lib/db/` 와 **다른 디렉터리**다. 그쪽은 커넥션 풀·트랜잭션(인프라)이고
 *   이쪽은 데이터베이스 **기능**이다. `src/lib/block/` · `permissions/` · `search/`
 *   와 같은 층이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 값은 판별 유니온으로 저장한다 — 자기 타입을 들고 있다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본이 `value jsonb` 를 "타입별 판별 유니온"이라고 했고, 03 문서의 예시가
 * `{"type":"select","select":{"id":"opt_…"}}` 다. 즉 **봉투에 `type` 이 들어간다.**
 *
 * 페이로드만 저장하면 `property.type` 과 셀을 항상 함께 읽어야 하고, 타입 변환
 * (F-03-09)이 일어나는 순간 "프로퍼티는 number 인데 셀에는 옛 문자열이 있는"
 * 상태를 구분할 수 없다. 봉투가 있으면 그 셀이 **무엇이었는지**가 남는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 사이드카는 파생이고, 파생 규칙이 이 파일에만 있다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `num_value` · `text_value` · `date_start` · `date_end` · `bool_value` 는
 * 정렬·필터가 **실제로 읽는** 컬럼이다(부분 인덱스가 거기 걸려 있다). `value` 에서
 * 파생되며 같은 트랜잭션에서 함께 쓴다.
 *
 * 파생 규칙이 쓰기 경로마다 흩어지면 "정렬은 맞는데 필터는 틀린" 구간이 생긴다.
 * 그래서 `deriveSidecars()` 하나만 있고, 셀을 쓰는 코드는 그것을 부른다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * select 의 사이드카는 **옵션 id** 다. 이름이 아니다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-03-04: *"옵션 이름 변경 시 그 옵션을 쓰는 모든 셀 표시가 함께 바뀐다.
 * (id 참조이므로 자동)"*
 *
 * 이름을 `text_value` 에 넣으면 그 자동이 깨진다 — 옵션 이름을 바꿀 때마다 그
 * 옵션을 쓰는 **모든 셀의 사이드카**를 다시 써야 하고, 한 번 놓치면 필터가
 * 조용히 0건을 돌려준다. id 를 넣으면 그 문제가 원천 소멸한다.
 *
 * 대가: **select 를 이름 순으로 정렬할 수 없다.** 그건 사이드카가 아니라
 * `select_option.order_idx` 조인이고, 정렬 순서의 정본도 그쪽이다(사용자가
 * 옵션 순서를 정한다 — 이름 가나다순이 아니다). 즉 대가가 아니라 올바른 분리다.
 */

import {
  toPlainText,
  validateRichText,
  type RichTextRun,
  type ValidationIssue,
} from '../contracts/rich-text.ts'

/** MVP 가 만드는 프로퍼티 타입. 스키마의 ENUM 은 24종이지만 여기가 실제 범위다. */
export const MVP_PROPERTY_TYPES = [
  'title',
  'rich_text',
  'number',
  'select',
  'checkbox',
  'date',
] as const
export type MvpPropertyType = (typeof MVP_PROPERTY_TYPES)[number]

const MVP_SET: ReadonlySet<string> = new Set(MVP_PROPERTY_TYPES)

export function isMvpPropertyType(t: unknown): t is MvpPropertyType {
  return typeof t === 'string' && MVP_SET.has(t)
}

/**
 * 신규 프로퍼티의 기본 타입.
 *
 * F-03-03 의 `[확인필요]` 였던 것을 `rich_text` 로 둔다 — 03 문서가 *"신규
 * 프로퍼티 기본 타입은 `rich_text`(텍스트)"* 라고 추정했고, 어떤 값이든 받아
 * 적을 수 있는 타입이 기본값으로 가장 덜 틀린다.
 */
export const DEFAULT_PROPERTY_TYPE: MvpPropertyType = 'rich_text'

// ── 값 계약 ───────────────────────────────────────────────────────────

/** 옵션 참조. 셀은 **옵션 id** 를 가리킨다(이름 문자열이 아니다). */
export type OptionRef = { readonly id: string }

/**
 * 날짜 값.
 *
 * `end` 가 없으면 단일 날짜다(정본 전수표). `time_zone` 은 IANA 이름이고
 * 없으면 사용자 로컬로 해석한다.
 */
export type DateValue = {
  readonly start: string
  readonly end?: string | null
  readonly time_zone?: string | null
}

export type CellValue =
  | { readonly type: 'title'; readonly title: readonly RichTextRun[] }
  | { readonly type: 'rich_text'; readonly rich_text: readonly RichTextRun[] }
  | { readonly type: 'number'; readonly number: number | null }
  | { readonly type: 'select'; readonly select: OptionRef | null }
  /** `checkbox` 에는 null 이 없다. 기본값은 `false` 다(전수표). */
  | { readonly type: 'checkbox'; readonly checkbox: boolean }
  | { readonly type: 'date'; readonly date: DateValue | null }

/** `page_property_value` 의 사이드카 컬럼. 한 셀은 보통 하나만 채운다. */
export type Sidecars = {
  readonly num: number | null
  readonly text: string | null
  readonly dateStart: Date | null
  readonly dateEnd: Date | null
  readonly bool: boolean | null
}

const NO_SIDECARS: Sidecars = Object.freeze({
  num: null,
  text: null,
  dateStart: null,
  dateEnd: null,
  bool: null,
})

/** 빈 값. 타입별로 "비어 있다"의 모양이 다르다(전수표의 "빈 값" 열). */
export function emptyValue(type: MvpPropertyType): CellValue {
  switch (type) {
    case 'title':
      return { type: 'title', title: [] }
    case 'rich_text':
      return { type: 'rich_text', rich_text: [] }
    case 'number':
      return { type: 'number', number: null }
    case 'select':
      return { type: 'select', select: null }
    case 'checkbox':
      // ★ `null` 이 아니다. 체크하지 않은 상태가 곧 `false` 다.
      return { type: 'checkbox', checkbox: false }
    case 'date':
      return { type: 'date', date: null }
  }
}

/** 이 값이 "비어 있는가". `is_empty` 필터(F-03-17)와 같은 판정이어야 한다. */
export function isEmptyValue(value: CellValue): boolean {
  switch (value.type) {
    case 'title':
      return toPlainText(value.title).length === 0
    case 'rich_text':
      return toPlainText(value.rich_text).length === 0
    case 'number':
      return value.number === null
    case 'select':
      return value.select === null
    case 'date':
      return value.date === null
    case 'checkbox':
      // `false` 는 "비어 있음"이 아니라 값이다 — 노션의 checkbox 필터에도
      // `is_empty` 가 없고 `equals false` 가 있다.
      return false
  }
}

// ── 검증 ─────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/

/** IANA 타임존 이름의 느슨한 형태. 목록을 들고 있지 않다(플랫폼이 안다). */
const TIME_ZONE = /^[A-Za-z]+(?:[/_+-][A-Za-z0-9_+-]+)*$/

/**
 * 날짜를 해석한다. **달력 유효성을 직접 본다.**
 *
 * `new Date()` 에 맡기면 안 되는 이유를 실측했다:
 *
 *   new Date('2026-02-30')  →  2026-03-02T00:00:00.000Z   ← 조용히 굴러간다
 *   new Date('2026-13-01')  →  Invalid Date
 *   new Date('2026-01-32')  →  Invalid Date
 *
 * 월·일이 1~12 / 1~31 범위 **안**이면서 그 달에 없는 날(2월 30일, 4월 31일)은
 * 다음 달로 굴러간다. 즉 사용자가 입력한 날짜와 저장되는 날짜가 달라진다 —
 * 가장 알아채기 어려운 종류의 데이터 손상이다.
 *
 * 그래서 Y-M-D 를 문자열에서 직접 꺼내 그 달의 일수와 비교한다. 타임존 오프셋이
 * 붙은 문자열에서도 안전하다 — UTC 컴포넌트와 비교하는 방식은 오프셋 때문에
 * 어긋나지만, 이 방식은 적힌 날짜 그대로를 본다.
 */
function parseDate(raw: string): Date | null {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (ymd === null) return null
  const year = Number(ymd[1])
  const month = Number(ymd[2])
  const day = Number(ymd[3])
  if (month < 1 || month > 12 || day < 1) return null
  // 0 일을 달라고 하면 전달의 마지막 날이 나온다 — 그것이 그 달의 일수다.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) return null

  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 값이 타입의 계약을 지키는가.
 *
 * **관대하게 고치지 않는다.** 셀 쓰기는 서버 명령 경로(V-5 경로 2)이고 클라이언트가
 * 보낸 값이므로, 모양이 틀리면 거부하는 쪽이 맞다 — 읽기(`readTitle`)와 반대다.
 *
 * @returns 빈 배열이면 통과.
 */
export function validateCellValue(
  type: MvpPropertyType,
  raw: unknown,
  path = 'value',
): ValidationIssue[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [{ path, message: '객체여야 합니다' }]
  }
  const v = raw as Record<string, unknown>

  // 봉투의 `type` 이 프로퍼티 타입과 달라서는 안 된다. 다르면 타입 변환이
  // 일어났거나 클라이언트가 낡은 스키마로 쓰는 것이고, 둘 다 거부가 맞다.
  if (v.type !== type) {
    return [{ path: `${path}.type`, message: `'${type}' 이어야 합니다 (받은 값: ${String(v.type)})` }]
  }

  switch (type) {
    case 'title':
    case 'rich_text': {
      const runs = v[type]
      if (!Array.isArray(runs)) return [{ path: `${path}.${type}`, message: '배열이어야 합니다' }]
      return validateRichText(runs, `${path}.${type}`)
    }

    case 'number': {
      const n = v.number
      if (n === null) return []
      if (typeof n !== 'number') return [{ path: `${path}.number`, message: '숫자여야 합니다' }]
      // NaN · Infinity 는 `numeric` 사이드카에 넣을 수 없고, 넣히면 정렬이 깨진다.
      if (!Number.isFinite(n)) {
        return [{ path: `${path}.number`, message: '유한한 숫자여야 합니다' }]
      }
      return []
    }

    case 'select': {
      const sel = v.select
      if (sel === null) return []
      if (typeof sel !== 'object' || sel === null || Array.isArray(sel)) {
        return [{ path: `${path}.select`, message: '객체 또는 null 이어야 합니다' }]
      }
      const id = (sel as Record<string, unknown>).id
      if (typeof id !== 'string' || id.length === 0) {
        return [{ path: `${path}.select.id`, message: '옵션 id 가 필요합니다' }]
      }
      return []
    }

    case 'checkbox': {
      if (typeof v.checkbox !== 'boolean') {
        // null 을 받아주면 "체크 안 함"과 "값 없음"이 둘이 된다.
        return [{ path: `${path}.checkbox`, message: 'true 또는 false 여야 합니다 (null 불가)' }]
      }
      return []
    }

    case 'date': {
      const d = v.date
      if (d === null) return []
      if (typeof d !== 'object' || d === null || Array.isArray(d)) {
        return [{ path: `${path}.date`, message: '객체 또는 null 이어야 합니다' }]
      }
      const obj = d as Record<string, unknown>
      const issues: ValidationIssue[] = []

      if (typeof obj.start !== 'string' || !ISO_DATE.test(obj.start)) {
        issues.push({ path: `${path}.date.start`, message: 'ISO 8601 날짜여야 합니다' })
      }
      if (obj.end !== undefined && obj.end !== null) {
        if (typeof obj.end !== 'string' || !ISO_DATE.test(obj.end)) {
          issues.push({ path: `${path}.date.end`, message: 'ISO 8601 날짜여야 합니다' })
        }
      }
      if (obj.time_zone !== undefined && obj.time_zone !== null) {
        if (typeof obj.time_zone !== 'string' || !TIME_ZONE.test(obj.time_zone)) {
          issues.push({ path: `${path}.date.time_zone`, message: 'IANA 타임존 이름이어야 합니다' })
        }
      }
      if (issues.length > 0) return issues

      // 범위가 거꾸로면 `ck_ppv_date_range` 가 INSERT 를 거부한다. 여기서 먼저
      // 잡아 "왜 저장이 안 되는지 모르는" 500 대신 필드별 오류를 준다.
      const start = parseDate(obj.start as string)
      const end = typeof obj.end === 'string' ? parseDate(obj.end) : null
      if (start === null) {
        return [{ path: `${path}.date.start`, message: '해석할 수 없는 날짜입니다' }]
      }
      if (typeof obj.end === 'string' && end === null) {
        return [{ path: `${path}.date.end`, message: '해석할 수 없는 날짜입니다' }]
      }
      if (end !== null && end.getTime() < start.getTime()) {
        return [{ path: `${path}.date`, message: '끝이 시작보다 앞설 수 없습니다' }]
      }
      return []
    }
  }
}

// ── 사이드카 파생 ─────────────────────────────────────────────────────

/**
 * `value` 에서 사이드카를 뽑는다. **셀을 쓰는 모든 경로가 이 함수를 쓴다.**
 *
 * 입력은 이미 `validateCellValue` 를 통과한 값이어야 한다. 통과하지 않은 값을
 * 넣으면 사이드카가 비거나 틀리고, 그건 "저장은 됐는데 검색·필터에 안 걸리는"
 * 상태다 — 사용자가 가장 알아채기 어려운 실패다.
 */
export function deriveSidecars(value: CellValue): Sidecars {
  switch (value.type) {
    case 'title':
      return { ...NO_SIDECARS, text: nullIfEmpty(toPlainText(value.title)) }

    case 'rich_text':
      return { ...NO_SIDECARS, text: nullIfEmpty(toPlainText(value.rich_text)) }

    case 'number':
      return { ...NO_SIDECARS, num: value.number }

    case 'select':
      // ★ 옵션 **id**. 이름이 아니다(머리말 참조).
      return { ...NO_SIDECARS, text: value.select?.id ?? null }

    case 'checkbox':
      return { ...NO_SIDECARS, bool: value.checkbox }

    case 'date': {
      if (value.date === null) return NO_SIDECARS
      const start = parseDate(value.date.start)
      const end = value.date.end ? parseDate(value.date.end) : null
      return { ...NO_SIDECARS, dateStart: start, dateEnd: end }
    }
  }
}

/**
 * 빈 문자열은 `NULL` 로 둔다.
 *
 * 사이드카 인덱스가 `WHERE text_value IS NOT NULL` 부분 인덱스이므로, 빈
 * 문자열을 넣으면 **아무 내용도 없는 셀이 전부 인덱스에 들어간다.** 그리고
 * `is_empty` 필터가 `IS NULL` 과 `= ''` 두 경우를 다 봐야 한다.
 */
function nullIfEmpty(s: string): string | null {
  return s.length === 0 ? null : s
}
