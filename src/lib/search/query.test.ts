/**
 * 검색 쿼리 파서 — 잔여 묶음 8l-1 (F-07-02 · 순수)
 *
 *   ① 공백은 AND — 말마다 절 하나
 *   ② 따옴표는 구절 — 공백을 접는다 · 닫지 않으면 끝까지 · 빈 따옴표는 버린다
 *   ③ OR 는 바로 앞뒤를 대안으로 — 앞이나 뒤가 없으면 버린다 · 소문자 or 는 말이다
 *   ④ `-` 는 제외 — 말 · 구절 · `-` 홀로와 말 사이의 `-` 는 그대로
 *   ⑤ 찾는 말(긴 것부터) · 스니펫의 닻(첫 말)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseQuery, positiveTerms, snippetAnchor } from './query.ts'

test('★ ① 공백은 AND', () => {
  assert.deepEqual(parseQuery('회의록 2024'), { clauses: [['회의록'], ['2024']], exclude: [] })
  assert.deepEqual(parseQuery('  하나   둘  '), { clauses: [['하나'], ['둘']], exclude: [] })
  assert.deepEqual(parseQuery(''), { clauses: [], exclude: [] })
})

test('★ ② 따옴표는 구절', () => {
  assert.deepEqual(parseQuery('"주간  보고" 팀'), { clauses: [['주간 보고'], ['팀']], exclude: [] })
  assert.deepEqual(parseQuery('팀 "닫지 않은 구절'), { clauses: [['팀'], ['닫지 않은 구절']], exclude: [] })
  assert.deepEqual(parseQuery('"" 말'), { clauses: [['말']], exclude: [] })
  assert.deepEqual(parseQuery('앞"구절"뒤'), { clauses: [['앞'], ['구절'], ['뒤']], exclude: [] })
})

test('★ ③ OR 는 바로 앞뒤를 대안으로', () => {
  assert.deepEqual(parseQuery('a OR b c'), { clauses: [['a', 'b'], ['c']], exclude: [] })
  assert.deepEqual(parseQuery('2024 OR 2025 OR 2026'), { clauses: [['2024', '2025', '2026']], exclude: [] })
  assert.deepEqual(parseQuery('OR 회의'), { clauses: [['회의']], exclude: [] }, '앞이 없으면 버린다')
  assert.deepEqual(parseQuery('회의 OR'), { clauses: [['회의']], exclude: [] }, '뒤가 없으면 버린다')
  assert.deepEqual(parseQuery('cats or dogs'), { clauses: [['cats'], ['or'], ['dogs']], exclude: [] }, '소문자는 말이다')
  assert.deepEqual(parseQuery('a OR -b'), { clauses: [['a']], exclude: ['b'] }, '제외와는 묶지 않는다')
  assert.deepEqual(parseQuery('a OR a'), { clauses: [['a']], exclude: [] })
})

test('★ ④ - 는 제외', () => {
  assert.deepEqual(parseQuery('회의록 -초안 -"지난 주"'), { clauses: [['회의록']], exclude: ['초안', '지난 주'] })
  assert.deepEqual(parseQuery('- 회의'), { clauses: [['회의']], exclude: [] }, '- 홀로는 버린다')
  assert.deepEqual(parseQuery('e-mail'), { clauses: [['e-mail']], exclude: [] }, '말 사이의 - 는 그대로')
  assert.deepEqual(parseQuery('-초안'), { clauses: [], exclude: ['초안'] })
})

test('⑤ 찾는 말 · 스니펫의 닻', () => {
  const parsed = parseQuery('보고 "주간 보고서" OR 회의 -초안')
  assert.deepEqual(positiveTerms(parsed), ['주간 보고서', '보고', '회의'])
  assert.equal(snippetAnchor(parsed), '보고')
  assert.equal(snippetAnchor(parseQuery('-초안')), null)
})
