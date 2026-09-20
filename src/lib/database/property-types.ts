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

/**
 * 앱이 만드는 프로퍼티 타입. 스키마의 ENUM 은 24종이지만 여기가 실제 범위다.
 *
 * MVP 는 6종이었고(HANDOFF §3.2-7) 보드 4c-1 이 `status` 를 더했다 — F-03-05 의 현실적 대안 그대로
 * **"그룹이 강제되는 select"** 다. 옵션 레지스트리 · 사이드카(옵션 id) · 필터 연산자가 select 와 같고, 다른 것은
 * 옵션마다 그룹이 붙는다는 것과 새 행이 받는 기본 옵션(`config.default_option_id`)뿐이다.
 */
export const MVP_PROPERTY_TYPES = [
  'title',
  'rich_text',
  'number',
  'select',
  'status',
  'checkbox',
  'date',
] as const
export type MvpPropertyType = (typeof MVP_PROPERTY_TYPES)[number]

const MVP_SET: ReadonlySet<string> = new Set(MVP_PROPERTY_TYPES)

export function isMvpPropertyType(t: unknown): t is MvpPropertyType {
  return typeof t === 'string' && MVP_SET.has(t)
}

/**
 * **엣지 타입** — 값이 셀(`page_property_value`)이 아니라 `relation_edge` 에 있는 타입 (relation 5a · 불변식 C2).
 *
 * `MVP_PROPERTY_TYPES` 에 넣지 않는다. 그 목록은 "셀 값 계약이 있는 타입"이고(`CellValue` · 사이드카 · 필터 축 · 표시가
 * 전부 그것을 키로 삼는다), relation 은 그 어느 것도 아니다 — 값은 엣지이고, 쓰는 길은 `relation.ts` 의 연결 명령
 * 하나이며, 셀 쓰기 경로(`row.ts` `prepareCells`)는 `isMvpPropertyType` 으로 relation 을 **거부한다**(C2 의 집행 지점).
 * 읽기 모델(`properties_cache`)에는 렌더용 배열로 투영된다(마이그레이션 0024).
 */
export const EDGE_PROPERTY_TYPES = ['relation'] as const
export type EdgePropertyType = (typeof EDGE_PROPERTY_TYPES)[number]

/** 앱이 만드는 프로퍼티 타입 전부 — 셀 타입 + 엣지 타입. 스키마(`PropertySummary.type`)가 이것이다. */
export const APP_PROPERTY_TYPES = [...MVP_PROPERTY_TYPES, ...EDGE_PROPERTY_TYPES] as const
export type AppPropertyType = (typeof APP_PROPERTY_TYPES)[number]

export function isAppPropertyType(t: unknown): t is AppPropertyType {
  return typeof t === 'string' && (APP_PROPERTY_TYPES as readonly string[]).includes(t)
}

/** 한 칸에 몇 개까지 연결할 수 있는가. F-03-10: *"`1 페이지` 또는 `제한 없음`"*. */
export type RelationLimit = 'one' | 'none'

/**
 * `property.config` — relation. snake_case 로 저장한다(정본 E1 의 키 이름 그대로).
 *
 * 여기(계약 모듈)에 두는 이유: 뷰의 컬럼(`view.ts`)이 이것을 읽어 화면에 넘기는데, `relation.ts` 는 `property.ts` 를,
 * `property.ts` 는 `view.ts` 를 끌어온다 — 거기 두면 값 import 가 순환한다.
 */
export type RelationConfig = {
  readonly target_data_source_id: string
  /** 양방향의 짝. 자기 자신일 수 있다(같은 표 · 프로퍼티 하나). 없으면 단방향. */
  readonly synced_property_id?: string
  readonly limit?: RelationLimit
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 저장된 config 를 읽는다. relation 의 모양이 아니면 null. */
export function readRelationConfig(raw: unknown): RelationConfig | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const c = raw as Record<string, unknown>
  if (typeof c.target_data_source_id !== 'string' || !UUID.test(c.target_data_source_id)) return null
  return {
    target_data_source_id: c.target_data_source_id,
    ...(typeof c.synced_property_id === 'string' ? { synced_property_id: c.synced_property_id } : {}),
    ...(c.limit === 'one' ? { limit: 'one' as const } : {}),
  }
}

/** 캐시가 싣는 relation 칸의 앞쪽 개수. 마이그레이션 0024 의 `rn <= 25` 와 **같은 수**여야 한다. */
export const RELATION_CACHE_LIMIT = 25

/**
 * `properties_cache` 에 투영된 relation 칸 (마이그레이션 0024). **`CellValue` 가 아니다** — 셀로 쓸 수 없다.
 *
 * `relation` 은 `order_idx` 순 앞 25개, `count` 는 전체 개수다. ★ id 는 **걸러지지 않았다** — 볼 수 없는 행 · 휴지통에
 * 간 행이 섞여 있다. 제목을 붙이며 거르는 것은 `relation.ts` `readRelation` 이다.
 */
export type RelationValue = {
  readonly type: 'relation'
  readonly relation: readonly OptionRef[]
  readonly count: number
}

const EMPTY_RELATION: RelationValue = Object.freeze({ type: 'relation', relation: Object.freeze([]), count: 0 })

/** 캐시의 한 칸을 relation 값으로 읽는다. 없거나 모양이 틀리면 빈 값(읽기는 관대하게). */
export function readRelationValue(raw: unknown): RelationValue {
  if (typeof raw !== 'object' || raw === null) return EMPTY_RELATION
  const v = raw as Record<string, unknown>
  if (v.type !== 'relation' || !Array.isArray(v.relation)) return EMPTY_RELATION
  const relation = v.relation
    .filter((r): r is { id: string } => typeof r === 'object' && r !== null && typeof (r as { id?: unknown }).id === 'string')
    .map((r) => ({ id: r.id }))
  return { type: 'relation', relation, count: typeof v.count === 'number' ? v.count : relation.length }
}

/**
 * 그룹(보드)으로 묶을 수 있는 타입. F-04-11 의 9종 중 셋 — 규칙은 `group.ts` 머리말.
 *
 * 여기(클라이언트에서도 읽는 계약 모듈)에 두는 이유: 도구줄의 "그룹" 패널이 고를 수 있는 속성을 거르는데, `group.ts` 는
 * DB 모듈을 끌어오므로 클라이언트 번들이 가져갈 수 없다.
 */
export const GROUPABLE_TYPES = ['select', 'status', 'checkbox'] as const
export type GroupableType = (typeof GROUPABLE_TYPES)[number]

export function isGroupableType(t: unknown): t is GroupableType {
  return t === 'select' || t === 'status' || t === 'checkbox'
}

/**
 * 옵션 레지스트리(`select_option`)를 쓰는 타입. 셀이 **옵션 id 하나**를 가리킨다.
 *
 * select 와 status 가 갈라지는 곳은 셋뿐이다 — 값 봉투의 키(`select` / `status`), 옵션의 그룹, 기본 옵션.
 * 그 밖의 분기(사이드카 · 필터 · 표시 · 보드의 그룹 키)는 전부 이 술어 하나로 묻는다. 타입마다 `case` 를 늘리면
 * "select 에서는 되는데 status 에서는 안 되는" 구간이 생긴다.
 */
export const OPTION_TYPES = ['select', 'status'] as const
export type OptionType = (typeof OPTION_TYPES)[number]

export function isOptionType(t: unknown): t is OptionType {
  return t === 'select' || t === 'status'
}

/**
 * status 의 세 범주. **고정이다** — F-03-05: *"You can't change the three main categories."*
 *
 * 이름 · 색은 `kind` 의 함수라 DB 에 없다(마이그레이션 0023 머리말). "완료인가"는 `kind === 'complete'` 로 묻는다 —
 * 이름으로 묻지 않는다(진행률 · 자동화가 이름에 기대면 번역이 규칙을 깬다).
 */
export const STATUS_GROUP_KINDS = ['todo', 'in_progress', 'complete'] as const
export type StatusGroupKind = (typeof STATUS_GROUP_KINDS)[number]

export function isStatusGroupKind(v: unknown): v is StatusGroupKind {
  return typeof v === 'string' && (STATUS_GROUP_KINDS as readonly string[]).includes(v)
}

export const STATUS_GROUP_LABEL: Readonly<Record<StatusGroupKind, string>> = Object.freeze({
  todo: '할 일',
  in_progress: '진행 중',
  complete: '완료',
})

/**
 * status 프로퍼티를 만들 때 함께 생기는 옵션 — F-03-05 시나리오 1: `Not started`(To-do) · `In progress` · `Done`.
 * 첫째가 기본 옵션이 된다.
 */
export const STATUS_DEFAULT_OPTIONS: readonly {
  readonly name: string
  readonly color: 'gray' | 'blue' | 'green'
  readonly group: StatusGroupKind
}[] = Object.freeze([
  { name: '시작 전', color: 'gray', group: 'todo' },
  { name: '진행 중', color: 'blue', group: 'in_progress' },
  { name: '완료', color: 'green', group: 'complete' },
])

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
 * 옵션 색. 마이그레이션 0013 의 `option_color` ENUM 과 **같은 순서**다.
 *
 * 새 옵션의 색은 이 순서로 돌아가며 준다(F-03-04 현실적 대안: "고정 10색
 * 팔레트 라운드로빈"). 순서가 ENUM 과 어긋나도 동작은 하지만, 같게 두면
 * `ORDER BY color` 와 화면의 팔레트가 같은 순서로 보인다.
 */
export const OPTION_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const
export type OptionColor = (typeof OPTION_COLORS)[number]

export function isOptionColor(v: unknown): v is OptionColor {
  return typeof v === 'string' && (OPTION_COLORS as readonly string[]).includes(v)
}

/** 화면이 셀을 그릴 때 필요한 옵션 모양. 셀은 id 만 들고 있으므로 이것으로 이름을 찾는다. */
export type SelectOption = {
  readonly id: string
  readonly name: string
  readonly color: OptionColor
  /** status 옵션의 범주. select 옵션에는 없다(불변식 SG3 — 마이그레이션 0023). */
  readonly group?: StatusGroupKind
}

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
  | { readonly type: 'status'; readonly status: OptionRef | null }
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
    case 'status':
      return { type: 'status', status: null }
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
    case 'status':
      return value.status === null
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

    case 'select':
    case 'status': {
      // 봉투의 키가 타입 이름이다(`{type:'status', status:{id}}`) — 모양은 같다.
      const sel = v[type]
      if (sel === null) return []
      if (typeof sel !== 'object' || sel === null || Array.isArray(sel)) {
        return [{ path: `${path}.${type}`, message: '객체 또는 null 이어야 합니다' }]
      }
      const id = (sel as Record<string, unknown>).id
      if (typeof id !== 'string' || id.length === 0) {
        return [{ path: `${path}.${type}.id`, message: '옵션 id 가 필요합니다' }]
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
    case 'status':
      // ★ 옵션 **id**. 이름이 아니다(머리말 참조). status 도 같은 축이다 — 필터 · 보드의 그룹 키가 한 규칙을 본다.
      return { ...NO_SIDECARS, text: optionIdOf(value) }

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

// ── 옵션 값 ───────────────────────────────────────────────────────────

/** 셀이 가리키는 옵션 id. 옵션 타입이 아니거나 비어 있으면 null. */
export function optionIdOf(value: CellValue): string | null {
  if (value.type === 'select') return value.select?.id ?? null
  if (value.type === 'status') return value.status?.id ?? null
  return null
}

/** 옵션 id 로 그 타입의 값을 만든다. `null` 이면 빈 값. 봉투의 키를 아는 곳은 여기 하나다. */
export function optionValue(type: OptionType, optionId: string | null): CellValue {
  const ref = optionId === null ? null : { id: optionId }
  return type === 'status' ? { type: 'status', status: ref } : { type: 'select', select: ref }
}

/**
 * 새 옵션을 목록의 **제자리**에 끼운다 — 서버가 읽어 주는 순서(`options.ts`: 그룹 순서 → 만든 순서)와 같게.
 *
 * 화면은 옵션을 만든 뒤 목록을 다시 읽지 않는다(불러온 행을 버리지 않으려고). 그냥 맨 뒤에 붙이면 status 의 "할 일"
 * 그룹에 만든 옵션이 `완료` 뒤에 서 있다가 새로고침하면 자리를 옮긴다. select 옵션은 그룹이 없어 늘 맨 뒤다.
 * 이미 있는 id 면 그대로 돌려준다(같은 이름은 서버가 기존 옵션으로 수렴시킨다).
 */
export function insertOption(options: readonly SelectOption[], option: SelectOption): SelectOption[] {
  if (options.some((o) => o.id === option.id)) return [...options]
  if (option.group === undefined) return [...options, option]
  const rank = (o: SelectOption): number => (o.group === undefined ? -1 : STATUS_GROUP_KINDS.indexOf(o.group))
  const mine = rank(option)
  // 자기 그룹보다 뒤 그룹의 첫 옵션 앞. 없으면 맨 뒤.
  const at = options.findIndex((o) => rank(o) > mine)
  return at < 0 ? [...options, option] : [...options.slice(0, at), option, ...options.slice(at)]
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
