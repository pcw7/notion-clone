/**
 * 공개 API 의 검색 요청 — 본문 · 커서 (API-5 · F-09-06 · F-09-04 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑩
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { encodeCursor as encodeAppCursor } from '../contracts/pagination.ts'
import { decodeSearchCursor, encodeSearchCursor, parseSearchBody, searchEnvelope, searchFingerprint } from './search-request.ts'

const ok = (body: unknown) => {
  const r = parseSearchBody(body)
  assert.ok(r.ok, r.ok ? '' : r.message)
  return r.value
}
const fails = (body: unknown, pattern: RegExp) => {
  const r = parseSearchBody(body)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.message, pattern)
}

test('★ 본문 — 없으면 모두 · 기본은 가장 잘 맞는 순 · 100 · 종류 없음', () => {
  assert.deepEqual(ok(undefined), { query: '', kind: null, sort: 'best', pageSize: 100, cursor: null })
  assert.deepEqual(ok({}), { query: '', kind: null, sort: 'best', pageSize: 100, cursor: null })
  assert.equal(ok({ query: '회의록' }).query, '회의록')
})

test('★ filter — object 의 page · data_source 만 · in_trash:false 는 받고 true 는 400(휴지통은 검색되지 않는다)', () => {
  assert.equal(ok({ filter: { property: 'object', value: 'page' } }).kind, 'page')
  assert.equal(ok({ filter: { property: 'object', value: 'data_source' } }).kind, 'data_source')
  assert.equal(ok({ filter: { in_trash: false } }).kind, null)
  fails({ filter: { property: 'object', value: 'database' } }, /body\.filter\.value should be "page" or "data_source"/)
  fails({ filter: { property: 'title', value: 'page' } }, /body\.filter\.property should be "object"/)
  fails({ filter: { property: 'object', value: 'page', in_trash: true } }, /searching the trash is not supported/)
  fails({ filter: { property: 'object', value: 'page', extra: 1 } }, /body\.filter\.extra should be not present/)
  fails({ filter: 'page' }, /body\.filter should be an object/)
})

test('★ sort — last_edited_time 의 오름 · 내림만', () => {
  assert.equal(ok({ sort: { timestamp: 'last_edited_time', direction: 'ascending' } }).sort, 'edited_asc')
  assert.equal(ok({ sort: { timestamp: 'last_edited_time', direction: 'descending' } }).sort, 'edited_desc')
  fails({ sort: { timestamp: 'created_time', direction: 'ascending' } }, /body\.sort\.timestamp should be "last_edited_time"/)
  fails({ sort: { timestamp: 'last_edited_time', direction: 'up' } }, /body\.sort\.direction/)
})

test('본문의 모양 — 받지 않는 키 · 문자열이 아닌 query · page_size 범위 · 객체가 아닌 본문', () => {
  fails({ queryx: 'a' }, /body\.queryx should be not present/)
  fails({ query: 3 }, /body\.query should be a string/)
  fails({ page_size: 0 }, /page_size should be a number between 1 and 100/)
  fails({ page_size: 101 }, /page_size/)
  fails({ page_size: 2.5 }, /page_size/)
  fails([1], /body should be an object/)
  assert.equal(ok({ page_size: 7 }).pageSize, 7)
})

test('★ 커서 — 왕복 · 질의의 지문에 묶인다(검색어 · 종류 · 정렬이 다르면 지문이 다르다) · 모양이 틀리면 400', () => {
  const fp = searchFingerprint('회의록', 'page', 'best')
  assert.notEqual(fp, searchFingerprint('회의록', null, 'best'))
  assert.notEqual(fp, searchFingerprint('회의록', 'page', 'edited_desc'))
  assert.notEqual(fp, searchFingerprint('회의', 'page', 'best'))
  const app = encodeAppCursor({ sortKey: 'best:3020261117010203000000', id: '1f2e3d4c-5b6a-4789-8abc-def012345678' })
  const cursor = { fingerprint: fp, app, hit: 3, part: 1 }
  const raw = encodeSearchCursor(cursor)
  assert.deepEqual(decodeSearchCursor(raw), cursor)
  assert.deepEqual(ok({ start_cursor: raw }).cursor, cursor)
  assert.deepEqual(decodeSearchCursor(encodeSearchCursor({ fingerprint: fp, app: null, hit: 0, part: 2 })), { fingerprint: fp, app: null, hit: 0, part: 2 })
  // 앱의 커서 안의 id 가 uuid 가 아니면 받지 않는다 — 질의의 uuid 자리로 가 500 이 되지 않게
  const forged = encodeSearchCursor({ fingerprint: fp, app: encodeAppCursor({ sortKey: 'best:1', id: 'x' }), hit: 0, part: 0 })
  assert.equal(decodeSearchCursor(forged), null)
  assert.equal(decodeSearchCursor('nope!'), null)
  assert.equal(decodeSearchCursor(Buffer.from('{"h":"zz"}').toString('base64url')), null)
  fails({ start_cursor: 'nope!' }, /body\.start_cursor should be a cursor from a previous response/)
})

test('봉투 — 노션의 page_or_data_source 목록', () => {
  assert.deepEqual(searchEnvelope([], null), {
    object: 'list', results: [], next_cursor: null, has_more: false, type: 'page_or_data_source', page_or_data_source: {},
  })
  assert.equal(searchEnvelope([{}], 'c').has_more, true)
})
