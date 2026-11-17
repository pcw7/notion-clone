/**
 * 공개 API 의 검색 — `POST /v1/search` (API-5 · F-09-06 · F-09-04)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑤ ⑩ · 09-api-integrations.md F-09-06
 *
 * **앱의 검색 그대로다** — `searchPages`(권한 스코프가 `WHERE` 안 · pg_bigm · 휴지통 · 템플릿 행 제외)를 "제목만" 으로 부른다. 권한 SQL 을
 * 여기서 쓰지 않는다. 그래서 결과는 그 사람이 앱의 검색에서 제목으로 찾는 것과 같다:
 *   · `query` 를 생략하면 볼 수 있는 것을 모두(앱 검색의 `matchAll` — 필터로만의 검색과 같은 길) · 짧은 검색어(라틴 1자)는 빈 목록(앱도
 *     질의하지 않는다) · 맞는 것이 없으면 앱처럼 제목의 낱말 유사도로 한 쪽(오타 대체 — 다음 쪽이 없다)
 *   · `filter.value` 는 앱 검색의 종류(`kind`) — 같은 `WHERE` 에 든다(후처리가 아니다)
 *   · 정렬 — 기본은 앱의 "가장 잘 맞는 순" · `last_edited_time` 은 앱의 편집 순(오름 · 내림)
 *
 * 결과마다 객체를 다시 읽는다 — 페이지는 API-2 의 페이지 객체(`readApiPage` — 볼 수 있어야 한다), 데이터베이스는 그것이 소유한 소스들의
 * 데이터 소스 객체(API-4). 다시 읽어 못 보는 것은 소리 없이 빠진다(쪽은 다음 결과로 채운다 — 개수가 새지 않는다).
 *
 * 쪽 — 앱 검색의 쪽은 50 까지라, 노션의 `page_size`(100 까지)를 채울 때까지 앱의 keyset 커서로 이어 읽는다. 데이터베이스 하나가 객체
 * 여럿을 내므로 커서는 (앱의 쪽 · 그 안의 결과 · 그 안의 객체) 자리다(`search-request.ts`). 내보내기 정책을 끄면 소유자만(내용을 돌려준다).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { MAX_SEARCH_LIMIT, normalizeQuery, searchPages, type SearchHit } from '../search/search.ts'
import { dataSourceObjectsOfDatabase } from './data-sources.ts'
import { readApiPage } from './page-object.ts'
import { apiLinks, bodyInvalid, invalid, policyBlock } from './pages.ts'
import type { ApiLinks } from './rich-text.ts'
import { encodeSearchCursor, parseSearchBody, searchEnvelope, searchFingerprint } from './search-request.ts'
import { v1Ok, type V1Handler } from './v1.ts'

/** 결과 하나가 내는 객체들 — 페이지 하나 또는 데이터베이스의 소스들. 다시 읽어 못 보면 빈 배열. */
async function objectsOf(ctx: SessionContext, hit: SearchHit, links: ApiLinks): Promise<Record<string, unknown>[]> {
  if (hit.kind === 'database') return dataSourceObjectsOfDatabase(ctx, hit.pageId, links)
  const page = await readApiPage(ctx, hit.pageId, links)
  return page === null ? [] : [page]
}

/** `POST /v1/search` */
export const searchApi: V1Handler = async ({ ctx, body, request }) => {
  const parsed = parseSearchBody(body)
  if (!parsed.ok) return invalid(parsed.message)
  const { kind, sort, pageSize, cursor } = parsed.value
  const query = normalizeQuery(parsed.value.query)
  const fingerprint = searchFingerprint(query, kind, sort)
  if (cursor !== null && cursor.fingerprint !== fingerprint) {
    return bodyInvalid('body.start_cursor does not belong to this search. Send the same query, filter and sort as the request that returned it.')
  }

  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked

  const links = apiLinks(ctx, request)
  const results: Record<string, unknown>[] = []
  let app = cursor?.app ?? null
  let hit = cursor?.hit ?? 0
  let part = cursor?.part ?? 0
  let next: string | null = null

  for (;;) {
    // 남은 자리만큼 — 결과 하나는 객체를 0개 이상 낸다. 같은 커서에서 같은 차례라 자리(hit)는 한도가 달라도 같은 결과를 가리킨다.
    const outcome = await searchPages(ctx, {
      query,
      sort,
      limit: Math.min(MAX_SEARCH_LIMIT, hit + pageSize - results.length),
      cursor: app,
      filters: { titleOnly: true },
      matchAll: query === '',
      kind: kind === null ? null : kind === 'data_source' ? 'database' : 'page',
    })
    if (!outcome.ok) break
    const hits = outcome.results.results
    let full = false
    for (; hit < hits.length && !full; hit += 1) {
      if (results.length === pageSize) {
        next = encodeSearchCursor({ fingerprint, app, hit, part: 0 })
        full = true
        break
      }
      const objects = await objectsOf(ctx, hits[hit], links)
      for (; part < objects.length; part += 1) {
        if (results.length === pageSize) {
          next = encodeSearchCursor({ fingerprint, app, hit, part })
          full = true
          break
        }
        results.push(objects[part])
      }
      if (!full) part = 0
    }
    if (full) break
    const after = outcome.results.next_cursor
    if (after === null) break
    if (results.length === pageSize) {
      next = encodeSearchCursor({ fingerprint, app: after, hit: 0, part: 0 })
      break
    }
    app = after
    hit = 0
    part = 0
  }
  return v1Ok(searchEnvelope(results, next))
}
