/**
 * 데이터에서 나온 그룹의 버킷 — 설정 읽기 · 키 식 · 차례 (그룹 버킷 B-1 · B-2 · B-2b · B-3 · S-1 · 공개 화면 PV-6 · DB 를 모르는 순수 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 B-1] ~ [보강 B-3] · [보강 S-1] · [보강 PV-1] ⑦
 *
 * 날짜 · 숫자 · 글로 묶으면 그룹이 옵션이 아니라 데이터에서 나온다. 앱의 보드 · 차트(`group.ts`)와 공개 화면의 보드 · 차트
 * (`publish/public-database.ts` — 자기 질의)가 **같은 키 식 · 같은 차례**로 나누게 여기 하나로 둔다. 세션을 받지 않는다 — SQL 조각은
 * 값을 `ParamBag` 으로 묶을 뿐이다. 키 · 이름의 규칙 자체는 `date-group.ts` · `number-group.ts` · `text-group.ts` 에 있다.
 */

import type { ParamBag } from './filter.ts'
import { DEFAULT_DATE_UNIT, DEFAULT_WEEK_START, RELATIVE_KEYS, isDateUnit, isWeekStart, type DateUnit, type WeekStart } from './date-group.ts'
import { DEFAULT_NUMBER_SIZE, isNumberSize } from './number-group.ts'
import { DEFAULT_TEXT_MODE, FOLDED_CHOSEONG, OTHER_INITIAL, compareTextKeys, isTextMode, type TextMode } from './text-group.ts'

/** 값이 없는 행의 버킷 — `group.ts` 의 `NO_VALUE_KEY` 와 같다. */
const NO_VALUE = ''

/** 순서를 고를 수 있는 그룹 — 그룹이 옵션이 아니라 데이터에서 나오는 타입(B-1 · B-2 · B-2b). */
export const SORTABLE_GROUP_TYPES: readonly string[] = ['date', 'number', 'rich_text']

/**
 * 버킷 설정 — 그 타입의 것만 산다(날짜면 `dateUnit` · 숫자면 `numberSize` · 글이면 `textMode` · 그 밖은 셋 다 null). 앱의 그룹 축
 * (`GroupAxis`)이 이 모양을 그대로 갖는다.
 */
export type DataBucket = {
  readonly dateUnit: DateUnit | null
  readonly numberSize: number | null
  readonly textMode: TextMode | null
  /** 상대 날짜(B-3)의 오늘(`YYYY-MM-DD`) — 앱은 보는 사람의 오늘 · 공개 화면은 서버의 UTC 오늘(`publicToday`). */
  readonly today: string
  readonly weekStart: WeekStart
  /** 그룹의 순서(S-1) — 데이터에서 나온 그룹만 내림이 될 수 있다. */
  readonly sort: 'ascending' | 'descending'
}

/** 저장된 `group_by` 의 버킷 키들 — 모양을 믿지 않는다(읽기 경로는 너그럽다). */
export type StoredBucketKeys = {
  readonly date_unit?: unknown
  readonly week_start?: unknown
  readonly number_size?: unknown
  readonly text_by?: unknown
  readonly sort?: unknown
}

/**
 * 저장된 `group_by` 에서 버킷 설정을 읽는다 — 지금 타입의 키만(타입을 바꾼 뒤의 저장값은 읽지 않는다) · 없거나 틀리면 기본값(월 · 10 ·
 * 글 그대로 · 월요일 · 오름).
 */
export function readDataBucket(groupBy: StoredBucketKeys, propertyType: string, today: string): DataBucket {
  return {
    dateUnit: propertyType === 'date' ? (isDateUnit(groupBy.date_unit) ? groupBy.date_unit : DEFAULT_DATE_UNIT) : null,
    numberSize: propertyType === 'number' ? (isNumberSize(groupBy.number_size) ? groupBy.number_size : DEFAULT_NUMBER_SIZE) : null,
    textMode: propertyType === 'rich_text' ? (isTextMode(groupBy.text_by) ? groupBy.text_by : DEFAULT_TEXT_MODE) : null,
    today,
    weekStart: isWeekStart(groupBy.week_start) ? groupBy.week_start : DEFAULT_WEEK_START,
    // 그룹의 순서(S-1) — 데이터에서 나온 그룹만(타입을 바꾼 뒤의 저장값은 오름으로 읽는다)
    sort: SORTABLE_GROUP_TYPES.includes(propertyType) && groupBy.sort === 'descending' ? 'descending' : 'ascending',
  }
}

/** 데이터에서 나온 버킷인가(날짜 · 숫자 · 글). */
export function isDataBucket(bucket: Pick<DataBucket, 'dateUnit' | 'numberSize' | 'textMode'>): boolean {
  return bucket.dateUnit !== null || bucket.numberSize !== null || bucket.textMode !== null
}

/**
 * 행의 버킷 키를 계산하는 SQL 식 — `alias` 는 그 속성의 셀(`page_property_value` · LEFT JOIN — 없으면 NULL · 값 없음은 `''`). 데이터
 * 버킷이 아니면 null.
 *
 * 날짜(B-1) — 값에 적힌 달력 날짜(`start` 의 앞 열 자)가 든 버킷의 첫 날(시간대로 옮기지 않는다 — `date-group.ts`)
 * 상대 날짜(B-3) — 적힌 날짜가 오늘에서 며칠 떨어졌나(`date - date` 는 날수) · 이름은 `date-group.ts` 의 `relativeOf` 와 같은 경계
 * 숫자(B-2) — 구간의 아래 끝을 numeric 으로 정확히 · 글자는 trim_scale 의 것(`number-group.ts`)
 * 글(B-2b) — 글 그대로는 사이드카 그대로 · 첫 글자는 첫 비공백 글자의 머리(한글은 초성 — 표는 `text-group.ts` 의 것 · 음절은 코드
 * 포인트로 가른다 — ko 콜레이션의 BETWEEN 은 자음 낱자를 음절 사이에 넣는다)
 */
export function bucketKeySql(bucket: DataBucket, params: ParamBag, alias = 'gv'): string | null {
  if (bucket.dateUnit === 'relative') {
    const today = params.bind(bucket.today)
    return `(SELECT CASE WHEN r.n IS NULL THEN ''
                     WHEN r.n = 0 THEN 'today' WHEN r.n = 1 THEN 'tomorrow' WHEN r.n = -1 THEN 'yesterday'
                     WHEN r.n BETWEEN 2 AND 7 THEN 'next_7' WHEN r.n BETWEEN -7 AND -2 THEN 'last_7'
                     WHEN r.n BETWEEN 8 AND 30 THEN 'next_30' WHEN r.n BETWEEN -30 AND -8 THEN 'last_30'
                     WHEN r.n > 30 THEN 'later' ELSE 'earlier' END
               FROM (SELECT (left(${alias}.value -> 'date' ->> 'start', 10))::date - ${today}::date AS n) r)`
  }
  if (bucket.dateUnit !== null) {
    const date = `(left(${alias}.value -> 'date' ->> 'start', 10))::date`
    // 일요일 시작의 주(B-3b) — 그 주의 일요일(`dow` 는 일요일 = 0). 월요일 시작은 date_trunc('week')(ISO)
    const start =
      bucket.dateUnit === 'day'
        ? date
        : bucket.dateUnit === 'week' && bucket.weekStart === 'sunday'
          ? `(${date} - extract(dow from ${date})::int)`
          : `date_trunc('${bucket.dateUnit}', ${date})`
    return `coalesce(to_char(${start}, 'YYYY-MM-DD'), '')`
  }
  if (bucket.textMode === 'exact') return `coalesce(${alias}.text_value, '')`
  if (bucket.textMode === 'first') {
    const table = params.bind(FOLDED_CHOSEONG)
    const other = params.bind(OTHER_INITIAL)
    return `(SELECT CASE WHEN f.c IS NULL THEN ''
                     WHEN ascii(f.c) BETWEEN 44032 AND 55203 THEN substr(${table}::text, (ascii(f.c) - 44032) / 588 + 1, 1)
                     WHEN f.c ~ '^[A-Za-z]$' THEN upper(f.c)
                     ELSE ${other}::text END
               FROM (SELECT substring(${alias}.text_value from '\\S') AS c) f)`
  }
  if (bucket.numberSize !== null) {
    const size = params.bind(String(bucket.numberSize))
    return `coalesce(trim_scale(floor(${alias}.num_value / ${size}::numeric) * ${size}::numeric)::text, '')`
  }
  return null
}

/**
 * 버킷의 차례 — 값 없음(`''`)은 뺀다(부르는 쪽이 맨 앞에 둔다). 숫자는 **수 오름차순**(글자 순이면 -10 · 100 · 20) · 글 그대로는 한국어
 * 순서 · 첫 글자는 ㄱ ~ ㅎ · A ~ Z · # · 상대 날짜는 날짜 차례 · 날짜는 키(첫 날) 순. 내림(S-1)이면 뒤집는다.
 */
export function orderBuckets(keys: Iterable<string>, bucket: DataBucket): string[] {
  const list = [...keys].filter((k) => k !== NO_VALUE)
  const { textMode } = bucket
  const relativeOrder: readonly string[] = RELATIVE_KEYS
  const ordered =
    bucket.numberSize !== null
      ? list.sort((a, b) => Number(a) - Number(b))
      : textMode !== null
        ? list.sort((a, b) => compareTextKeys(a, b, textMode))
        : bucket.dateUnit === 'relative'
          ? list.sort((a, b) => relativeOrder.indexOf(a) - relativeOrder.indexOf(b))
          : list.sort()
  if (bucket.sort === 'descending') ordered.reverse()
  return ordered
}
