/**
 * 검색 결과의 정렬 — 잔여 묶음 8l-2 (순수)
 *
 *   ① 다섯 · 모르는 값은 가장 잘 맞는 순
 *   ② 오름차순은 _asc 둘
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_SEARCH_SORT, SEARCH_SORTS, isAscending, normalizeSearchSort } from './sort.ts'

test('① 다섯 · 모르는 값은 가장 잘 맞는 순', () => {
  assert.equal(SEARCH_SORTS.length, 5)
  for (const sort of SEARCH_SORTS) assert.equal(normalizeSearchSort(sort), sort)
  for (const bad of ['', 'BEST', null, undefined, 3, 'relevance']) assert.equal(normalizeSearchSort(bad), DEFAULT_SEARCH_SORT)
  assert.equal(DEFAULT_SEARCH_SORT, 'best')
})

test('② 오름차순은 _asc 둘', () => {
  assert.deepEqual(SEARCH_SORTS.filter(isAscending), ['edited_asc', 'created_asc'])
})
