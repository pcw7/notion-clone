/**
 * 뷰 검색 — 도구줄의 검색어로 행을 좁힌다 (DB 심화 2e-1조각 · F-04-27 · DB 를 모르는 모듈)
 *
 * 정본: 04-database-views.md F-04-27 · 00-canonical-data-model.md §3.6 [보강] 뷰 검색
 *
 * ──────────────────────────────────────────────────────────────────────
 * 필터와 AND 로 붙는 술어 하나다 — 뷰에 저장하지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 04: *"쿼리 파이프라인 상 위치: `filter ∧ search_term` → sorts → group → page"* · *"검색은 임시 상태이며 뷰에 저장되지 않는다"*.
 * 그래서 이 파일은 술어 하나를 만들고, 행 질의(`query.ts`) · 열 집계(`calculate.ts`) · 보드(`group.ts`)가 필터 옆에 끼운다 — 세 곳이
 * 같은 행을 본다. 검색어는 요청이 들고 오고(`?q=`) 어디에도 쓰지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무엇을 찾는가 — 명시적 목록
 * ──────────────────────────────────────────────────────────────────────
 *
 * 04: *"검색 대상 컬럼 정의를 명시적 화이트리스트로 둔다(제목 + 텍스트류 프로퍼티). '모든 프로퍼티'로 두면 … 비용이 폭발한다."*
 *
 *   - 제목 · 글(`title` · `rich_text`) — 사이드카 `text_value` 가 사람이 쓴 글이다
 *   - 선택 · 상태(`select` · `status`) — 사이드카는 **옵션 id** 라(0014 머리말) 옵션 **이름**으로 찾는다
 *
 * 숫자 · 날짜 · 체크박스 · 관계형 · 롤업 · 고유 ID 는 찾지 않는다(§7). 본문 블록도 아니다(04 *"본문 블록은 검색 대상이 아니다"*).
 * 대소문자는 무시하고(필터의 글 비교와 같은 `lower()`), 부분 일치다 — 한국어도 조사를 넘는다(LIKE 는 글자 단위다). 사용자가 친
 * `%` · `_` · `\` 는 글자 그대로다(`escapeLike` — #211).
 *
 * 인덱스는 `lower(text_value)` 의 pg_bigm GIN(0056)이 받는다 — 04 *"`LIKE '%term%'` 는 인덱스를 못 쓴다 → trigram 또는 …"*. pg_trgm 이
 * 아니라 pg_bigm 인 것은 한국어가 2-gram 이라서다(0012 머리말의 실측).
 */

import { escapeLike, type ParamBag, type PropertyTypes } from './filter.ts'
import { isOptionType } from './property-types.ts'

/** 검색어의 길이 상한. 그보다 긴 글은 자른다(거부하지 않는다 — 붙여 넣은 글이 조금 길다고 검색이 멈추면 안 된다). */
export const MAX_SEARCH_LENGTH = 200

/** 검색어를 다듬는다 — 앞뒤 공백을 떼고 상한까지. 비었거나 글이 아니면 null(검색 없음). */
export function normalizeSearch(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const term = raw.trim().slice(0, MAX_SEARCH_LENGTH).trim()
  return term === '' ? null : term
}

/** 글로 찾는 타입(사이드카가 사람이 쓴 글). */
const TEXT_SEARCH_TYPES: ReadonlySet<string> = new Set(['title', 'rich_text'])

/**
 * 검색 술어 — 바깥 질의에 `page p` 가 있다고 전제한다. 살아 있는 프로퍼티(`types`)만 본다 — 지워진 프로퍼티의 칸으로는 찾지 않는다.
 *
 * `p.id IN (…)` 모양이다 — 상관 서브쿼리(`EXISTS … v.page_id = p.id`)로 쓰면 행마다 칸을 찾아 bigm 인덱스를 쓰지 못한다.
 * 맞는 칸의 행 id 를 인덱스로 한 번에 모으고 바깥 질의가 그것과 맞춘다.
 */
export function compileSearch(term: string, types: PropertyTypes, params: ParamBag): string {
  const textIds: string[] = []
  const optionIds: string[] = []
  for (const [id, type] of types) {
    if (TEXT_SEARCH_TYPES.has(type)) textIds.push(id)
    else if (isOptionType(type)) optionIds.push(id)
  }
  // 모든 표에 제목이 있다 — 그래도 찾을 칸이 없으면 아무 행도 맞지 않는다(검색어를 버리고 전부를 주지 않는다).
  if (textIds.length === 0 && optionIds.length === 0) return 'false'
  const pattern = params.bind(escapeLike(term))
  const parts: string[] = []
  if (textIds.length > 0) {
    parts.push(`SELECT sv.page_id FROM page_property_value sv
        WHERE sv.property_id = ANY(${params.bind(textIds)}::text[])
          AND lower(sv.text_value) LIKE '%' || lower(${pattern}) || '%'`)
  }
  if (optionIds.length > 0) {
    parts.push(`SELECT sv.page_id FROM page_property_value sv
         JOIN select_option so ON so.property_id = sv.property_id AND so.id::text = sv.text_value
        WHERE sv.property_id = ANY(${params.bind(optionIds)}::text[])
          AND lower(so.name) LIKE '%' || lower(${pattern}) || '%'`)
  }
  return `p.id IN (${parts.join('\n        UNION ALL\n        ')})`
}
