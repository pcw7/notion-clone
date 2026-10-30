/**
 * 연결할 원본 고르기 — 검색어 다듬기 · 항목 이름 (27번 트랙 L-2 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 L-1] ⑤
 *
 *   ① 검색어 — 공백만이면 거르지 않는다(null) · 앞뒤 공백을 뗀다 · NFC · 상한 · 글이 아니면 null
 *   ② 항목 이름 — 소스가 하나면 데이터베이스 이름 · 여럿이면 "이름 · 소스" · 이름이 없으면 "제목 없는 데이터베이스"
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DATABASE_QUERY_MAX, linkedSourceLabel, normalizeDatabaseQuery } from './linked-picker.ts'

test('① 검색어 — 비면 null · 다듬기 · NFC · 상한 · 글이 아니면 null', () => {
  assert.equal(normalizeDatabaseQuery('   '), null)
  assert.equal(normalizeDatabaseQuery(''), null)
  assert.equal(normalizeDatabaseQuery('  할 일  '), '할 일')
  assert.equal(normalizeDatabaseQuery('한'), '한', '조합형은 완성형으로')
  assert.equal(normalizeDatabaseQuery('가'.repeat(DATABASE_QUERY_MAX + 20))?.length, DATABASE_QUERY_MAX)
  assert.equal(normalizeDatabaseQuery(42), null)
  assert.equal(normalizeDatabaseQuery(undefined), null)
})

test('② 항목 이름 — 하나면 이름 · 여럿이면 "이름 · 소스" · 비면 "제목 없는 데이터베이스"', () => {
  assert.equal(linkedSourceLabel({ name: '업무', sourceName: null }), '업무')
  assert.equal(linkedSourceLabel({ name: '업무', sourceName: '버그' }), '업무 · 버그')
  assert.equal(linkedSourceLabel({ name: '  ', sourceName: null }), '제목 없는 데이터베이스')
  assert.equal(linkedSourceLabel({ name: '', sourceName: '버그' }), '제목 없는 데이터베이스 · 버그')
})
