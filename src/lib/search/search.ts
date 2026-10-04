/**
 * 검색 질의 — W7 (F-07-01 · F-07-07)
 *
 * 정본: 00-canonical-data-model.md §3.9 "검색 쿼리 형태"
 *       07-search-navigation.md F-07-01 · F-07-02 · F-07-07
 *       마스터 문서 §5.2 W7: *"`WHERE perm_scope_id = ANY(scopes)` **쿼리 필터**.
 *       랭킹은 최근 수정순"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 권한은 필터 절 안에 있다. 후처리가 아니다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-07-07 엣지 케이스: *"페이지네이션: 권한 필터가 post-filter면 '10건 요청 →
 * 3건 반환'이 되어 페이징이 깨진다."* 정본 §3.9 도 같은 말을 쿼리 형태로 못박았다.
 *
 * 그래서 `readableScopes` 가 만든 스코프 배열이 **SQL 의 `WHERE` 에** 들어간다.
 * 25건을 뽑아서 거르는 경로는 이 파일에 없다. 있다면 그건 버그다.
 *
 * 같은 함수를 사이드바·휴지통·최근 방문이 이미 쓴다 — 목록 질의의 권한 축이
 * 한 곳이라는 뜻이고, 한 곳이면 빠뜨릴 곳도 한 곳이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 축이 둘이다 — 쿼리의 스크립트가 고른다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 마이그레이션 0012 머리말의 실측: PostgreSQL 에 한국어 text search config 가
 * 없어서 `'검색'` 이 `'검색이'` 를 찾지 못한다. pg_bigm 은 찾는다.
 *
 *   CJK 쿼리   → `LIKE likequery(q)` (pg_bigm 2-gram GIN)
 *   라틴 쿼리  → `tsv @@ websearch_to_tsquery('simple', q)`
 *
 * **섞인 쿼리는 CJK 로 간다**(`detectScript`). bigm 은 라틴도 부분 문자열로
 * 찾으므로 손실이 없고, 반대로 가면 한국어 부분이 조사 문제로 통째로 빠진다.
 *
 * **두 축은 같은 문법을 같은 뜻으로 읽는다**(8l-1 · `query.ts`) — 공백은 AND · `"…"` 는 구절 · `OR` 는 대안 · `-` 는 제외. 라틴 축은
 * `websearch_to_tsquery` 가 그대로 안다. CJK 축은 파서가 푼 절마다 LIKE 를 하나씩 건다(찾는 말은 맨 컬럼에 — bigm GIN 이 쓰인다 · 제외는
 * `coalesce` 로 NULL 을 다룬다 — 인덱스가 필요 없다). W7 은 쿼리 전체를 부분 문자열 하나로 찾아 "회의록 2024" 가 붙어 있는 문서만 걸렸다.
 *
 * 인덱스가 실제로 쓰이는지 실측했다(5만 행): 선택적 쿼리는 Bitmap 인덱스 스캔
 * (0.0ms), 거의 모든 행에 걸리는 쿼리는 Seq Scan 이다. 후자는 플래너가 **옳게**
 * 고른 것이다 — `enable_seqscan=off` 로 인덱스를 강제하면 오히려 느렸다.
 * 스코프 필터가 먼저 좁히므로 그 스캔의 크기는 워크스페이스 하나로 묶인다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 랭킹: 제목 우선 → 최근 수정순
 * ──────────────────────────────────────────────────────────────────────
 *
 * 마스터 문서 W7 이 "랭킹은 최근 수정순"으로 범위를 정했다. 거기에 **제목 일치
 * 우선** 하나만 더한다 — "회의록"을 검색했을 때 *제목이* 회의록인 페이지가
 * 본문에 그 말이 있는 최근 페이지보다 뒤에 오면 검색이 쓸모없다. F-07-02 가
 * 확실하다고 한 신호가 정확히 이것이다(*"`Title only` 필터가 별도 존재 → 필드
 * 분리 인덱싱은 확실"*).
 *
 * **`ts_rank_cd` 를 쓰지 않는다.** 라틴 축에서는 거의 공짜지만 CJK 축에는 대응물이
 * 없어서, 쓰는 순간 **같은 제품의 한국어 검색과 영어 검색이 다른 규칙으로 정렬**
 * 된다. 이 프로젝트의 주 언어가 한국어이므로 일관성을 고른다. BM25 계열 관련도는
 * F-07-02 의 P0-랭킹이고 마스터 문서가 W7 밖으로 미뤘다.
 *
 * **8l-2 — 정렬 다섯과 "가장 잘 맞는 순"의 단계**(F-07-02 *"Best Matches (default, with recently edited pages ranked
 * higher)"*). 점수는 여전히 사전식이다(두 축이 같은 규칙으로 — 위의 이유 그대로):
 *
 *   단계(제목이 쿼리와 **정확히 같다** 3 · 모든 절이 제목에 2 · 본문만 0) → **내가 30일 안에 연 페이지** → 최근 편집
 *
 * 개인화는 F-07-02 의 클론 대안 *"최근 30일 내 본인이 방문한 페이지에 고정 보너스 점수"* 그대로 — 단계 안에서만 앞선다(본문만 걸린 페이지가
 * 방문했다고 제목이 걸린 페이지를 넘지 않는다). 나머지 넷은 시각만 본다(편집 · 만든 때 · 오름 · 내림).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 커서는 keyset 이고, 정렬 키는 합성 텍스트다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `pagination.ts` 의 계약(W2 — "이 주에 고친 계약은 이후 못 고친다")을 그대로
 * 쓴다. `Cursor.sortKey` 는 문자열이므로 두 정렬 축을 **고정 폭 문자열 하나로**
 * 합친다:
 *
 *   sort_key = (제목 일치 ? '1' : '0') || to_char(edited_at, 'YYYYMMDDHH24MISSUS')
 *
 * 21자 ASCII 숫자라 내림차순 문자열 비교가 곧 "제목 우선, 그다음 최신"이다.
 * `COLLATE "C"` 를 붙인다 — 실측으로는 ICU 와 이진 순서가 **일치하지만**(고정 폭
 * 숫자열이므로), 마이그레이션 0008 에서 형제 37개째에 터진 것이 바로 이 가정이다.
 * 계산된 키라 인덱스가 없으므로 명시 비용이 0이다.
 *
 * (8l-2) 정렬마다 키의 모양이 다르다 — 커서의 키에 **정렬 이름을 앞에 붙여** 실어 보내고, 다른 정렬의 커서가 오면 처음부터 읽는다(정렬을
 * 바꾼 화면이 옛 커서를 보내도 이상한 자리에서 시작하지 않게).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import { readableScopes } from '../permissions/effective.ts'
import { plainTitleOf } from '../block/page.ts'
import { readPageIcon, type PageIcon } from '../block/page-icon.ts'
import {
  listEnvelope,
  encodeCursor,
  decodeCursor,
  type ListEnvelope,
} from '../contracts/pagination.ts'
import { exactTitleTarget, parseQuery, snippetAnchor, type ParsedQuery } from './query.ts'
import { DEFAULT_SEARCH_SORT, isAscending, normalizeSearchSort, type SearchSort } from './sort.ts'
import { detectScript, minQueryLength, type Script } from './script.ts'

/**
 * 기본 결과 수.
 *
 * `pagination.ts` 의 `DEFAULT_PAGE_SIZE`(100)를 쓰지 않는다. F-07-01 이 검색
 * 표면의 상한을 따로 적어 뒀다 — MCP 의 `notion-search`·`notion-ai-search` 가
 * *"up to 50 results"*, REST `/v1/search` 권고가 *"Lowering page_size from the
 * default of 100 can accelerate results"*. 빠른 이동 오버레이가 화면에 25건
 * 이상을 보여줄 일이 없고, 검색은 **완전 열거를 보장하지 않는다**(공식 문구).
 */
export const DEFAULT_SEARCH_LIMIT = 25
export const MAX_SEARCH_LIMIT = 50

/** 쿼리 길이 상한. 이보다 긴 입력은 잘라서 질의한다(거부하지 않는다). */
export const MAX_QUERY_LENGTH = 200

/** 스니펫 길이와 일치 지점 앞 여백. */
const SNIPPET_LENGTH = 160
const SNIPPET_LEAD = 40

export type BreadcrumbEntry = {
  readonly id: string
  readonly title: string
}

export type SearchHit = {
  readonly pageId: string
  readonly title: string
  /** 페이지 아이콘(8c-2) — 없으면 null. 결과는 이미 볼 수 있는 페이지뿐이다. */
  readonly icon: PageIcon | null
  /** 본문에서 뽑은 1~2줄. 일치 지점이 없으면 본문 앞부분. */
  readonly snippet: string
  /** 루트→부모 순. 루트 페이지면 빈 배열. */
  readonly breadcrumb: readonly BreadcrumbEntry[]
  readonly lastEditedAt: Date
  /** 제목이 걸렸는가. 정렬의 1차 축이고, 화면이 강조에 쓸 수 있다. */
  readonly titleHit: boolean
}

export type SearchInput = {
  readonly query: string
  /** 정렬(8l-2) — 기본은 가장 잘 맞는 순. 모르는 값도 기본. */
  readonly sort?: SearchSort | string | null
  readonly limit?: number
  /** 이전 응답의 `next_cursor`. */
  readonly cursor?: string | null
}

export type SearchOutcome =
  | { readonly ok: true; readonly results: ListEnvelope<SearchHit> }
  /**
   * 쿼리가 짧아 질의하지 않았다.
   *
   * 0건과 **구분해서** 돌려준다 — F-07-01 의 빈 상태와 "검색 결과 없음"은 다른
   * 화면이고(전자는 최근 방문, 후자는 필터 해제 제안), F-07-02 는
   * *"공백/특수문자만 입력 → 질의 전송하지 않고 이전 결과 유지"* 를 요구한다.
   * 둘을 같은 값으로 돌려주면 화면이 그 둘을 구분할 수 없다.
   */
  | {
      readonly ok: false
      readonly reason: 'query_too_short'
      readonly minLength: number
      readonly script: Script
    }

// ── 축별 술어 ─────────────────────────────────────────────────────────
//
// `$7` 부터가 쿼리다. **두 경로 모두 파라미터**이므로 사용자 입력이 SQL 로 들어가지
// 않는다. `likequery()` 는 pg_bigm 이 주는 이스케이프 함수로 `%` · `_` 를
// 막는다(실측: `likequery('50%')` → `%50\%%`). `websearch_to_tsquery` 는
// 쓰레기 입력에 던지지 않고 빈 tsquery 를 돌려준다(실측) — `to_tsquery` 와
// 다른 점이고, 그래서 이쪽을 쓴다.

/**
 * 첫 쿼리 파라미터의 번호 — $1 워크스페이스 · $2 스코프 · $3 스니펫의 닻 · $4 · $5 커서 · $6 한도 · $7 찾는 사람(방문 가산 · 8l-2) ·
 * $8 제목이 정확히 같아야 할 말(없으면 NULL · 8l-2).
 */
const FIRST_QUERY_PARAM = 9

/** 방문 가산의 창 — F-07-02 클론 대안 *"최근 30일 내 본인이 방문한 페이지"*. */
const VISIT_BONUS_DAYS = 30


/** 정렬마다의 키 — 고정 폭 ASCII 숫자열(사전식 비교가 곧 그 정렬이다). */
const SORT_KEY: Readonly<Record<SearchSort, string>> = {
  best: `(CASE WHEN m.exact_title THEN '3' WHEN m.title_hit THEN '2' ELSE '0' END)
         || (CASE WHEN m.visited THEN '1' ELSE '0' END)
         || to_char(m.edited_at, 'YYYYMMDDHH24MISSUS')`,
  edited_desc: `to_char(m.edited_at, 'YYYYMMDDHH24MISSUS')`,
  edited_asc: `to_char(m.edited_at, 'YYYYMMDDHH24MISSUS')`,
  created_desc: `to_char(m.created, 'YYYYMMDDHH24MISSUS')`,
  created_asc: `to_char(m.created, 'YYYYMMDDHH24MISSUS')`,
}

/** 커서의 키에 정렬 이름을 붙인다 · 떼어 낸다(다른 정렬의 커서면 null — 처음부터). */
const cursorKeyOf = (sort: SearchSort, key: string): string => `${sort}:${key}`
function keyFromCursor(sort: SearchSort, cursorKey: string | undefined): string | null {
  if (cursorKey === undefined) return null
  const prefix = `${sort}:`
  return cursorKey.startsWith(prefix) ? cursorKey.slice(prefix.length) : null
}

type Axis = { readonly match: string; readonly titleHit: string; readonly params: readonly string[] }

/**
 * 축의 술어와 그 파라미터. 라틴은 쿼리 그대로 `websearch_to_tsquery` 에. CJK 는 파서가 푼 절마다 — 절은 대안 중 하나가 제목이나 본문에
 * 있으면 되고, 제외는 제목과 본문 어디에도 없어야 한다. 제목이 걸렸다 = 모든 절이 제목에 있다.
 */
function axisOf(script: Script, query: string, parsed: ParsedQuery): Axis {
  if (script === 'latin') {
    const q = `$${FIRST_QUERY_PARAM}`
    return {
      // GENERATED 컬럼이라 제목 weight A · 본문 weight B 가 이미 들어 있다.
      match: `s.tsv @@ websearch_to_tsquery('simple', ${q})`,
      // 제목만 따로 본다. `tsv` 에서 weight A 만 걸러내려면 어차피 재계산이고,
      // 여기 오는 행은 이미 매칭된 것뿐이라 건수가 작다.
      titleHit: `to_tsvector('simple', coalesce(s.title_text, '')) @@ websearch_to_tsquery('simple', ${q})`,
      params: [query],
    }
  }
  const params: string[] = []
  const param = (term: string): string => {
    params.push(term)
    return `likequery($${FIRST_QUERY_PARAM + params.length - 1})`
  }
  const clauses = parsed.clauses.map((alternatives) => alternatives.map((term) => ({ term, p: param(term) })))
  // 찾는 말은 맨 컬럼에 건다 — pg_bigm 의 GIN(ix_search_title_bigm · ix_search_body_bigm)이 쓰인다.
  const match = clauses.map((alts) => `(${alts.map((a) => `s.title_text LIKE ${a.p} OR s.body_text LIKE ${a.p}`).join(' OR ')})`)
  const excluded = parsed.exclude.map((term) => {
    const p = param(term)
    return `NOT (coalesce(s.title_text, '') LIKE ${p} OR coalesce(s.body_text, '') LIKE ${p})`
  })
  const titleHit = clauses.map((alts) => `(${alts.map((a) => `coalesce(s.title_text, '') LIKE ${a.p}`).join(' OR ')})`)
  return { match: [...match, ...excluded].join(' AND '), titleHit: titleHit.join(' AND '), params }
}

type HitRow = {
  doc_id: string
  title_text: string | null
  page_icon: unknown
  ancestor_ids: string[]
  edited_at: Date
  title_hit: boolean
  sort_key: string
  snippet: string
}

function buildSql(axis: Axis, sort: SearchSort): string {
  const ascending = isAscending(sort)
  return `
    WITH matched AS (
      SELECT s.doc_id, s.title_text, s.body_text, s.ancestor_ids,
             -- 두 감사 컬럼이 모두 NULL 이면 정렬 키가 NULL 이 되고 그 행이
             -- 결과에서 조용히 빠진다. 바닥값을 둔다.
             coalesce(s.last_edited_at, s.created_at, 'epoch'::timestamptz) AS edited_at,
             coalesce(s.created_at, s.last_edited_at, 'epoch'::timestamptz) AS created,
             ${axis.titleHit} AS title_hit,
             -- 제목이 쿼리와 정확히 같다(8l-2 · 가장 잘 맞는 순의 첫 단계). 다른 정렬도 여기서 $8 을 읽는다 — 안 읽으면 그 파라미터의 타입을
             -- 정하지 못해 질의가 던진다.
             ($8::text IS NOT NULL AND lower(btrim(coalesce(s.title_text, ''))) = lower($8::text)) AS exact_title,
             -- 내가 최근에 연 페이지(8l-2 · 가장 잘 맞는 순의 단계 안 가산) — 다른 사람의 방문은 세지 않는다.
             EXISTS (SELECT 1 FROM recent_visit rv
                      WHERE rv.user_id = $7::uuid AND rv.block_id = s.doc_id
                        AND rv.last_visited_at > now() - interval '${VISIT_BONUS_DAYS} days') AS visited
        FROM search_document s
       WHERE s.workspace_id = $1
         AND s.perm_scope_id = ANY($2::uuid[])   -- ★ 권한. 후처리가 아니다
         AND s.in_trash = false
         AND ${axis.match}
    ), keyed AS (
      SELECT m.*, ${SORT_KEY[sort]} AS sort_key
        FROM matched m
    )
    SELECT k.doc_id, k.title_text, k.ancestor_ids, k.edited_at, k.title_hit, k.sort_key,
           (SELECT b.format -> 'page_icon' FROM block b WHERE b.id = k.doc_id) AS page_icon,
           CASE
             WHEN k.body_text IS NULL OR k.body_text = '' THEN ''
             -- 일치 지점 주변을 자른다. 닻($3)은 쿼리의 첫 말이다(8l-1 — 쿼리 전체로
             -- 찾으면 여러 말의 쿼리는 늘 본문 앞부분으로 떨어졌다). 라틴 축은 토큰
             -- 매칭이라 그 말이 본문에 그대로 없을 수 있고, 그때는 앞부분이다.
             WHEN strpos(lower(k.body_text), lower($3)) > 0
               THEN substring(k.body_text
                      from greatest(1, strpos(lower(k.body_text), lower($3)) - ${SNIPPET_LEAD})
                      for ${SNIPPET_LENGTH})
             ELSE left(k.body_text, ${SNIPPET_LENGTH})
           END AS snippet
      FROM keyed k
     WHERE $4::text IS NULL
        OR (k.sort_key COLLATE "C", k.doc_id) ${ascending ? '>' : '<'} ($4::text COLLATE "C", $5::uuid)
     ORDER BY k.sort_key COLLATE "C" ${ascending ? 'ASC' : 'DESC'}, k.doc_id ${ascending ? 'ASC' : 'DESC'}
     LIMIT $6`
}

/**
 * breadcrumb 을 조상 제목 조인으로 만든다.
 *
 * `search_document.ancestor_titles` 를 채우지 않은 이유가 이 함수다 — 제목을
 * 복사해 두면 조상 이름이 바뀔 때마다 서브트리 전체의 색인이 낡는다(F-07-04 가
 * `recent_visit` 에 대해 경고한 함정과 같다). 결과가 25건이라 조상 전체를
 * 한 번의 `= ANY` 로 읽으면 끝난다.
 *
 * **볼 수 없는 조상은 건너뛴다** — 머리의 경로(`listAncestors`)와 같은 규칙이다(HANDOFF §3.3-100 · 검색 자체와 같은 스코프
 * 필터). 8c-2 전에는 권한을 묻지 않아, 개인 페이지 아래에서 따로 공유받은 페이지를 찾은 사람에게 **조상의 제목이 경로로
 * 샜다**(#76 은 머리의 경로만 막았다). 조상 하나가 빠진다고 결과를 숨기지는 않는다 — 결과는 그 사람이 볼 수 있는 페이지다.
 */
async function loadBreadcrumbs(
  tx: Tx,
  ctx: SessionContext,
  rows: readonly HitRow[],
  scopes: readonly string[],
): Promise<Map<string, BreadcrumbEntry[]>> {
  const ids = new Set<string>()
  for (const row of rows) for (const id of row.ancestor_ids) ids.add(id)
  if (ids.size === 0) return new Map()

  const titles = await tx.query<{ id: string; properties: { title?: unknown } | null }>(
    `SELECT id, properties FROM live_block
      WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND type = 'page'
        AND perm_scope_id = ANY($3::uuid[])   -- ★ 권한(8c-2) — 머리의 경로와 같은 규칙`,
    [[...ids], ctx.workspaceId, scopes],
  )
  const byId = new Map(titles.map((t) => [t.id, plainTitleOf(t.properties)]))

  const out = new Map<string, BreadcrumbEntry[]>()
  for (const row of rows) {
    const trail: BreadcrumbEntry[] = []
    // `ancestor_ids` 는 루트→부모 순이다. 그대로 쓴다.
    for (const id of row.ancestor_ids) {
      const title = byId.get(id)
      if (title !== undefined) trail.push({ id, title })
    }
    out.set(row.doc_id, trail)
  }
  return out
}

/** 쿼리 정규화. 공백을 접고 상한으로 자른다. */
export function normalizeQuery(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH)
}

function normalizeLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return DEFAULT_SEARCH_LIMIT
  return Math.min(Math.floor(raw), MAX_SEARCH_LIMIT)
}

/**
 * 워크스페이스 전문 검색.
 *
 * 볼 수 없는 페이지는 **결과에도, 건수에도, 제목 미리보기에도 나타나지 않는다**
 * (F-07-07). 그것이 스코프 필터가 `WHERE` 에 있는 이유다.
 */
export async function searchPages(
  ctx: SessionContext,
  input: SearchInput,
): Promise<SearchOutcome> {
  const query = normalizeQuery(input.query)
  const script = detectScript(query)
  const min = minQueryLength(script)
  const parsed = parseQuery(query)

  // 길이 미달은 질의하지 않는다. 빈 문자열도 여기서 걸린다 —
  // `likequery('')` 가 NULL 을 돌려주므로(실측) SQL 까지 가면 조용히 0건이 되고,
  // 화면은 "검색 결과 없음"을 띄운다. 빈 상태는 최근 방문이어야 한다.
  // 찾는 말이 하나도 없는 쿼리(`-초안` · `"" OR`)도 같다 — 무엇을 찾을지 없다(8l-1).
  if (query.length < min || parsed.clauses.length === 0) {
    return { ok: false, reason: 'query_too_short', minLength: min, script }
  }
  const axis = axisOf(script, query, parsed)
  const sort = normalizeSearchSort(input.sort ?? DEFAULT_SEARCH_SORT)

  const limit = normalizeLimit(input.limit)
  const cursor = input.cursor ? decodeCursor(input.cursor) : null

  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    // 볼 수 있는 스코프가 없으면 질의 자체가 무의미하다. `= ANY('{}')` 는
    // 어차피 0건이지만, 한 왕복을 아낀다.
    if (scopes.length === 0) return { ok: true, results: listEnvelope<SearchHit>([]) }

    // 한 건 더 읽어 "다음 페이지가 있는가"를 판단한다. 전체 개수를 세지 않는다 —
    // F-07-01: *"결과 상한이 존재하고 완전 열거는 보장되지 않는다."*
    const cursorKey = keyFromCursor(sort, cursor?.sortKey)
    const rows = await tx.query<HitRow>(buildSql(axis, sort), [
      ctx.workspaceId,
      scopes,
      snippetAnchor(parsed) ?? query,
      cursorKey,
      cursorKey === null ? null : (cursor?.id ?? null),
      limit + 1,
      ctx.userId,
      exactTitleTarget(parsed),
      ...axis.params,
    ])

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const breadcrumbs = await loadBreadcrumbs(tx, ctx, page, scopes)

    const results: SearchHit[] = page.map((row) => ({
      pageId: row.doc_id,
      title: row.title_text ?? '',
      icon: readPageIcon(row.page_icon),
      snippet: row.snippet,
      breadcrumb: breadcrumbs.get(row.doc_id) ?? [],
      lastEditedAt: row.edited_at,
      titleHit: row.title_hit,
    }))

    const last = page[page.length - 1]
    return {
      ok: true,
      results: listEnvelope(results, {
        nextCursor:
          hasMore && last ? encodeCursor({ sortKey: cursorKeyOf(sort, last.sort_key), id: last.doc_id }) : null,
      }),
    }
  })
}
