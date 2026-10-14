/**
 * 검색 필터 — 값 다듬기 (10a-1 · F-07-03 · 순수)
 *
 *   ① 받는 값 — 제목만(참 · '1' · 'true') · 내가 만든('me') · 기간(넷) · 이 페이지 아래(uuid — 소문자로)
 *   ② 틀린 값은 그 필터가 없는 것 — 400 을 내지 않는다
 *   ③ 검색어 없이 찾을 수 있는가 — 좁히는 필터가 있을 때만(제목만은 세지 않는다)
 *   ④ 덮개(10a-2) — 걸린 필터의 수 · 라우트의 쿼리(걸린 것만) · 페이지 화면의 페이지 id
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EDITED_RANGE_DAYS,
  NO_SEARCH_FILTERS,
  activeFilterCount,
  narrowsWithoutQuery,
  normalizeSearchFilters,
  pageIdInPath,
  searchFilterParams,
} from './search-filters.ts'

const PAGE = '0190A3F1-1111-7000-8000-000000000001'

test('① 받는 값', () => {
  assert.deepEqual(normalizeSearchFilters({ titleOnly: '1', createdBy: 'me', edited: 'week', within: PAGE }), {
    titleOnly: true,
    createdBy: 'me',
    edited: 'week',
    within: PAGE.toLowerCase(),
  })
  assert.equal(normalizeSearchFilters({ titleOnly: true }).titleOnly, true)
  assert.equal(normalizeSearchFilters({ titleOnly: 'true' }).titleOnly, true)
  assert.deepEqual(EDITED_RANGE_DAYS, { day: 1, week: 7, month: 30, year: 365 })
})

test('② 틀린 값은 그 필터가 없는 것', () => {
  assert.deepEqual(normalizeSearchFilters({}), NO_SEARCH_FILTERS)
  assert.deepEqual(
    normalizeSearchFilters({ titleOnly: '0', createdBy: 'someone', edited: 'decade', within: 'not-a-uuid' }),
    NO_SEARCH_FILTERS,
  )
  assert.equal(normalizeSearchFilters({ within: `${PAGE}' OR 1=1 --` }).within, null, '주입처럼 보이는 값도 그대로 버린다')
})

test('③ 검색어 없이 찾을 수 있는가', () => {
  assert.equal(narrowsWithoutQuery(NO_SEARCH_FILTERS), false)
  assert.equal(narrowsWithoutQuery({ ...NO_SEARCH_FILTERS, titleOnly: true }), false, '제목만은 검색어가 있어야 뜻이 있다')
  for (const patch of [{ createdBy: 'me' as const }, { edited: 'day' as const }, { within: PAGE }]) {
    assert.equal(narrowsWithoutQuery({ ...NO_SEARCH_FILTERS, ...patch }), true, JSON.stringify(patch))
  }
})

test('④ 덮개(10a-2) — 걸린 필터의 수 · 라우트의 쿼리 · 페이지 화면의 페이지 id', () => {
  const all = normalizeSearchFilters({ titleOnly: true, createdBy: 'me', edited: 'month', within: PAGE })
  assert.equal(activeFilterCount(NO_SEARCH_FILTERS), 0)
  assert.equal(activeFilterCount(all), 4)
  assert.deepEqual(searchFilterParams(NO_SEARCH_FILTERS), [], '걸린 것만')
  assert.deepEqual(searchFilterParams(all), [['titleOnly', '1'], ['createdBy', 'me'], ['edited', 'month'], ['within', PAGE.toLowerCase()]])
  assert.deepEqual(normalizeSearchFilters(Object.fromEntries(searchFilterParams(all))), all, '라우트가 같은 값으로 다시 읽는다')
  assert.equal(pageIdInPath(`/w/ws/${PAGE}`), PAGE.toLowerCase())
  for (const path of ['/w/ws', `/w/ws/db/${PAGE}`, `/w/ws/${PAGE}/x`, '/w/ws/settings', null]) assert.equal(pageIdInPath(path), null, String(path))
})
