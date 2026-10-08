/**
 * 뷰 검색의 술어 — 다듬기 · 컴파일 (DB 심화 2e-1조각 · F-04-27 · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 검색어 다듬기 — 앞뒤 공백 · 상한 · 빈 글과 글이 아닌 것은 null
 *   ② ★ 사용자 입력이 SQL 에 들어가지 않는다 — 검색어는 탈출한 뒤 바인딩되고, 프로퍼티 id 도 파라미터다
 *   ③ 찾는 칸의 목록 — 제목 · 글은 글로, 선택 · 상태는 옵션 이름으로. 숫자 · 날짜 · 체크박스는 아니다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { ParamBag } from './filter.ts'
import { compileSearch, MAX_SEARCH_LENGTH, normalizeSearch } from './search.ts'

const TYPES = new Map<string, string>([
  ['pTitle', 'title'],
  ['pText', 'rich_text'],
  ['pNum', 'number'],
  ['pSel', 'select'],
  ['pStat', 'status'],
  ['pChk', 'checkbox'],
  ['pDate', 'date'],
])

const compile = (term: string, types: ReadonlyMap<string, string> = TYPES) => {
  const params = new ParamBag(2)
  const sql = compileSearch(term, types, params)
  return { sql, values: params.values }
}

describe('① 다듬기', () => {
  test('앞뒤 공백 · 상한 · 빈 글 · 글이 아닌 것', () => {
    assert.equal(normalizeSearch('  보고서 '), '보고서')
    assert.equal(normalizeSearch(''), null)
    assert.equal(normalizeSearch('   '), null)
    assert.equal(normalizeSearch(null), null)
    assert.equal(normalizeSearch(3), null)
    assert.equal(normalizeSearch('가'.repeat(MAX_SEARCH_LENGTH + 50))?.length, MAX_SEARCH_LENGTH)
  })
})

describe('② 사용자 입력이 SQL 에 들어가지 않는다', () => {
  test("★ 검색어 · 프로퍼티 id 는 파라미터다 — % · _ · \\ 는 탈출해 바인딩한다", () => {
    const bs = String.fromCharCode(92)
    const { sql, values } = compile(`'); DROP TABLE page; --50%_${bs}`)
    assert.ok(!sql.includes('DROP'), sql)
    assert.ok(!sql.includes('pTitle') && !sql.includes('pSel'), 'property_id 가 SQL 에 박혔다')
    assert.ok(values.includes(`'); DROP TABLE page; --50${bs}%${bs}_${bs}${bs}`), JSON.stringify(values))
    const literals = [...sql.matchAll(/'([^']*)'/g)].map((m) => m[1])
    assert.deepEqual([...new Set(literals)], ['%'])
  })
})

describe('③ 찾는 칸', () => {
  test('제목 · 글은 글로, 선택 · 상태는 옵션 이름으로 — 숫자 · 날짜 · 체크박스는 아니다', () => {
    const { sql, values } = compile('x')
    const ids = values.filter(Array.isArray) as string[][]
    assert.deepEqual(ids, [['pTitle', 'pText'], ['pSel', 'pStat']])
    assert.ok(sql.includes('select_option'), '옵션 이름을 본다')
  })

  test('옵션 타입이 없으면 옵션 이름을 보지 않는다 · 찾을 칸이 없으면 아무 행도 맞지 않는다', () => {
    const onlyTitle = compile('x', new Map([['pTitle', 'title']]))
    assert.ok(!onlyTitle.sql.includes('select_option'))
    assert.equal(compile('x', new Map([['pNum', 'number']])).sql, 'false')
  })
})
