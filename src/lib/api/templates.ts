/**
 * 공개 API 의 데이터 소스 템플릿 목록 — `GET /v1/data_sources/{data_source_id}/templates` (API-10 · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑭ ② · §3.6 `view.default_template_page_id`
 *
 * 앱의 목록(`listTemplates` — 소스의 `view` 문 · 살아 있는 템플릿 · 만든 차례)을 노션의 모양 `{ templates: [{ id, name, is_default }], has_more,
 * next_cursor }` 으로. 앱의 기본 템플릿은 **뷰마다**다 — `is_default` 는 이 소스를 가진 데이터베이스의 **공유 뷰** 하나라도 기본으로 둔 것
 * (개인 뷰 · 붙인 데이터베이스의 뷰는 보지 않는다 · 둘 이상일 수 있다). `name` 은 대소문자를 가리지 않는 부분 일치 · 쪽은 묶인 커서(⑩).
 * 템플릿의 이름은 내용이라 내보내기 정책 게이트를 지난다. 데이터베이스 id 는 404 에 바른 주소를 붙인다(⑧).
 */

import { listTemplates } from '../database/template.ts'
import { withReadTransaction } from '../db/tx.ts'
import { mistakenIdReply } from './data-sources.ts'
import { invalid, policyBlock } from './pages.ts'
import { v1Ok, type V1Handler } from './v1.ts'
import { API_MAX_PAGE_SIZE, decodeBoundCursor, encodeBoundCursor, invalidPathIdMessage, parseApiId, parsePageSize, shownValue } from './v1-protocol.ts'

/** 이 소스를 가진 데이터베이스의 공유 뷰가 기본으로 둔 템플릿들. */
async function defaultTemplateIds(dataSourceId: string): Promise<ReadonlySet<string>> {
  const rows = await withReadTransaction((tx) =>
    tx.query<{ id: string }>(
      `SELECT DISTINCT v.default_template_page_id AS id
         FROM view v JOIN data_source ds ON ds.id = v.data_source_id
        WHERE v.data_source_id = $1 AND v.database_id = ds.owner_database_id
          AND v.owner_kind = 'database_view' AND v.owner_user_id IS NULL AND v.default_template_page_id IS NOT NULL`,
      [dataSourceId],
    ),
  )
  return new Set(rows.map((r) => r.id))
}

/** `GET /v1/data_sources/{data_source_id}/templates` — `name` · `page_size`(≤ 100) · `start_cursor`. */
export const listApiTemplates: V1Handler = async ({ ctx, params, request }) => {
  const id = parseApiId(params.data_source_id)
  if (id === null) return invalid(invalidPathIdMessage('data_source_id', params.data_source_id))
  const query = new URL(request.url).searchParams
  const pageSize = parsePageSize(query.get('page_size'))
  if (pageSize === null) {
    return invalid(`query failed validation: query.page_size should be a number between 1 and ${API_MAX_PAGE_SIZE}, instead was ${shownValue(query.get('page_size'))}.`)
  }
  const name = (query.get('name') ?? '').trim().toLowerCase()
  const binding = `templates:${id}:${name}`
  const offset = decodeBoundCursor(binding, query.get('start_cursor'))
  if (offset === null) return invalid('query failed validation: query.start_cursor is not a valid cursor.')
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked

  const listed = await listTemplates(ctx, id)
  if (!listed.ok) return mistakenIdReply(ctx, 'data source', id)
  const defaults = await defaultTemplateIds(id)
  const all = listed.value.filter((t) => name === '' || t.title.toLowerCase().includes(name))
  const slice = all.slice(offset, offset + pageSize)
  const next = offset + pageSize < all.length ? encodeBoundCursor(binding, offset + pageSize) : null
  return v1Ok({
    templates: slice.map((t) => ({ id: t.id, name: t.title, is_default: defaults.has(t.id) })),
    has_more: next !== null,
    next_cursor: next,
  })
}
