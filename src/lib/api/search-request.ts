/**
 * 공개 API 의 검색 요청 — `POST /v1/search` 의 본문 · 커서 (API-5 · F-09-06 · F-09-04 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑩ · 09-api-integrations.md F-09-06
 *
 * 받는 것(노션 `2025-09-03`): `query`(제목 — 앱 검색의 "제목만") · `filter: {property:'object', value:'page'|'data_source'}`(`in_trash:false`
 * 도 받는다 — 휴지통은 검색되지 않는다) · `sort: {timestamp:'last_edited_time', direction}`(없으면 앱의 "가장 잘 맞는 순") · `start_cursor` ·
 * `page_size`(1~100). 그 밖의 키는 400.
 *
 * 커서 — 앱 검색의 keyset 커서(그 쪽의 처음) · 그 쪽 안의 결과 자리(hit) · 결과 하나가 낸 객체 안의 자리(part — 데이터베이스 하나가 소스
 * 여럿을 낸다) · 질의의 지문. 다른 질의의 커서는 400(API-4 의 질의 커서와 같다 · 서명은 하지 않는다 — 권한은 읽을 때 다시 본다).
 */

import { createHash } from 'node:crypto'

import { decodeCursor as decodeAppCursor } from '../contracts/pagination.ts'
import type { SearchSort } from '../search/sort.ts'
import { API_MAX_PAGE_SIZE, shownValue } from './v1-protocol.ts'

/** 노션의 `filter.value` — 우리 색인의 종류로는 `page` · `database`(데이터베이스 하나가 그 소스들을 낸다). */
export type SearchObjectKind = 'page' | 'data_source'

export type SearchCursor = {
  /** 질의의 지문. */
  readonly fingerprint: string
  /** 앱 검색의 커서 — 그 쪽의 처음. null 이면 첫 쪽. */
  readonly app: string | null
  /** 그 쪽 안의 결과 자리. */
  readonly hit: number
  /** 그 결과가 낸 객체 안의 자리. */
  readonly part: number
}

export type SearchRequest = {
  /** 받은 그대로(다듬기는 앱 검색의 `normalizeQuery`). 없으면 ''. */
  readonly query: string
  readonly kind: SearchObjectKind | null
  readonly sort: SearchSort
  readonly pageSize: number
  readonly cursor: SearchCursor | null
}

export type SearchParse = { readonly ok: true; readonly value: SearchRequest } | { readonly ok: false; readonly message: string }

const KEYS = ['query', 'sort', 'filter', 'start_cursor', 'page_size']

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const bad = (clause: string): SearchParse => ({ ok: false, message: `body failed validation: ${clause}` })

/** 본문 → 요청. 틀리면 그 자리를 노션의 말투로. */
export function parseSearchBody(body: unknown): SearchParse {
  const input = body === undefined ? {} : body
  if (!isObject(input)) return bad(`body should be an object, instead was ${shownValue(input)}.`)
  const extra = Object.keys(input).find((k) => !KEYS.includes(k))
  if (extra !== undefined) return bad(`body.${extra} should be not present, instead was ${shownValue(input[extra])}.`)

  const query = input.query ?? ''
  if (typeof query !== 'string') return bad(`body.query should be a string, instead was ${shownValue(input.query)}.`)

  let kind: SearchObjectKind | null = null
  if (input.filter !== undefined && input.filter !== null) {
    const f = input.filter
    if (!isObject(f)) return bad(`body.filter should be an object, instead was ${shownValue(f)}.`)
    const fx = Object.keys(f).find((k) => !['property', 'value', 'in_trash'].includes(k))
    if (fx !== undefined) return bad(`body.filter.${fx} should be not present, instead was ${shownValue(f[fx])}.`)
    if (f.in_trash !== undefined && f.in_trash !== false) {
      if (f.in_trash === true) return bad('body.filter.in_trash — searching the trash is not supported. Retrieve trashed pages by ID instead.')
      return bad(`body.filter.in_trash should be a boolean, instead was ${shownValue(f.in_trash)}.`)
    }
    if (f.property !== undefined || f.value !== undefined) {
      if (f.property !== 'object') return bad(`body.filter.property should be "object", instead was ${shownValue(f.property)}.`)
      if (f.value !== 'page' && f.value !== 'data_source') {
        return bad(`body.filter.value should be "page" or "data_source", instead was ${shownValue(f.value)}.`)
      }
      kind = f.value
    }
  }

  let sort: SearchSort = 'best'
  if (input.sort !== undefined && input.sort !== null) {
    const s = input.sort
    if (!isObject(s)) return bad(`body.sort should be an object, instead was ${shownValue(s)}.`)
    const sx = Object.keys(s).find((k) => !['timestamp', 'direction'].includes(k))
    if (sx !== undefined) return bad(`body.sort.${sx} should be not present, instead was ${shownValue(s[sx])}.`)
    if (s.timestamp !== 'last_edited_time') return bad(`body.sort.timestamp should be "last_edited_time", instead was ${shownValue(s.timestamp)}.`)
    if (s.direction !== 'ascending' && s.direction !== 'descending') {
      return bad(`body.sort.direction should be "ascending" or "descending", instead was ${shownValue(s.direction)}.`)
    }
    sort = s.direction === 'ascending' ? 'edited_asc' : 'edited_desc'
  }

  const pageSize = input.page_size ?? API_MAX_PAGE_SIZE
  if (typeof pageSize !== 'number' || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > API_MAX_PAGE_SIZE) {
    return bad(`body.page_size should be a number between 1 and ${API_MAX_PAGE_SIZE}, instead was ${shownValue(input.page_size)}.`)
  }

  let cursor: SearchCursor | null = null
  if (input.start_cursor !== undefined && input.start_cursor !== null) {
    cursor = decodeSearchCursor(input.start_cursor)
    if (cursor === null) return bad(`body.start_cursor should be a cursor from a previous response, instead was ${shownValue(input.start_cursor)}.`)
  }
  return { ok: true, value: { query, kind, sort, pageSize, cursor } }
}

/** 질의의 지문 — 다듬은 검색어 · 종류 · 정렬. */
export function searchFingerprint(query: string, kind: SearchObjectKind | null, sort: SearchSort): string {
  return createHash('sha256').update(JSON.stringify(['search', query, kind, sort])).digest('hex').slice(0, 24)
}

export function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify({ h: cursor.fingerprint, a: cursor.app, i: cursor.hit, j: cursor.part }), 'utf8').toString('base64url')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** 모양이 아니면 null(400). 앱의 커서도 모양을 본다 — 그 id 는 질의의 uuid 자리로 간다(틀린 것이 500 이 되지 않게). 지문은 부르는 쪽이 견준다. */
export function decodeSearchCursor(raw: unknown): SearchCursor | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!isObject(parsed)) return null
    const { h, a, i, j } = parsed
    if (typeof h !== 'string' || !/^[0-9a-f]{24}$/.test(h)) return null
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i > 1000) return null
    if (typeof j !== 'number' || !Number.isInteger(j) || j < 0 || j > 1000) return null
    if (a !== null) {
      const app = typeof a === 'string' ? decodeAppCursor(a) : null
      if (app === null || !UUID.test(app.id) || !/^[a-z_]{1,20}:\d{1,40}$/.test(app.sortKey)) return null
    }
    return { fingerprint: h, app: a as string | null, hit: i, part: j }
  } catch {
    return null
  }
}

/** 노션의 검색 결과 봉투. */
export function searchEnvelope(results: readonly unknown[], next: string | null): Record<string, unknown> {
  return { object: 'list', results, next_cursor: next, has_more: next !== null, type: 'page_or_data_source', page_or_data_source: {} }
}
