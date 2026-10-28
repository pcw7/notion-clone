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
import { compileSearch, MAX_SEARCH_LENGTH, normalizeSearch, uniqueIdTerm } from './search.ts'

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
  test('제목 · 글은 글로, 선택 · 상태는 옵션 이름으로 — 수가 아닌 검색어는 숫자 칸을 보지 않는다 · 날짜 · 체크박스는 아니다', () => {
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

describe('⑤ relation 의 제목 (V-2)', () => {
  test('★ 읽기 범위를 넘기면 이어진 대상 행의 제목을 본다 — 살아 있고 템플릿이 아니고 그 범위 안 · 범위가 없으면 보지 않는다', () => {
    const withRelation = new Map([...TYPES, ['pRel', 'relation']])
    const params = new ParamBag(2)
    const sql = compileSearch('엑스', withRelation, params, ['00000000-0000-0000-0000-00000000000a'])
    assert.match(sql, /FROM relation_edge e/)
    assert.match(sql, /tb\.perm_scope_id = ANY\(\$\d+::uuid\[\]\)/)
    assert.match(sql, /tb\.lifecycle = 'live' AND tp\.is_template = false/)
    assert.match(sql, /NOT \(rp\.config \? 'sub_items'\) AND NOT \(rp\.config \? 'dependencies'\)/, '하위 항목 · 종속 관계의 짝은 아니다')
    assert.ok(params.values.some((v) => Array.isArray(v) && v[0] === 'pRel'), JSON.stringify(params.values))
    assert.ok(!compileSearch('엑스', withRelation, new ParamBag(2)).includes('relation_edge'), '범위가 없으면 relation 을 보지 않는다')
    assert.ok(compileSearch('엑스', new Map([['pRel', 'relation']]), new ParamBag(2), []).includes('relation_edge'), 'relation 만 있어도')
  })
})

describe('④ 고유 ID · 숫자 (V-1)', () => {
  test('★ 수인 검색어는 숫자 칸의 같은 값도 — 글 찾기와 OR · 부분 일치가 아니다', () => {
    const { sql, values } = compile('42')
    assert.deepEqual(values.filter(Array.isArray), [['pTitle', 'pText'], ['pSel', 'pStat'], ['pNum']])
    assert.match(sql, /sv\.num_value = \$\d+::numeric/)
    assert.equal(compile('42', new Map([['pNum', 'number']])).sql.includes('num_value'), true, '숫자 칸만 있어도')
    for (const notNumber of ['4 2', '1e3', '42원', '.5']) assert.ok(!compile(notNumber).sql.includes('num_value'), notNumber)
  })

  test('★ 고유 ID — 접두사-번호 · 번호 · 그 표에 고유 ID 가 있을 때만 · 행 자신의 열로', () => {
    assert.deepEqual(uniqueIdTerm('TASK-12'), { prefix: 'TASK', seq: 12 })
    assert.deepEqual(uniqueIdTerm('task-12'), { prefix: 'TASK', seq: 12 }, '대소문자 무시')
    assert.deepEqual(uniqueIdTerm('12'), { prefix: null, seq: 12 })
    for (const no of ['T-12', 'TOOLONGX-1', 'TASK-', 'TASK-0', '0', 'TASK 12']) assert.equal(uniqueIdTerm(no), null, no)
    const withId = new Map([...TYPES, ['pId', 'unique_id']])
    const prefixed = compile('TASK-12', withId)
    assert.match(prefixed.sql, /p\.unique_seq = \$\d+ AND EXISTS \(SELECT 1 FROM data_source uds/)
    assert.ok(prefixed.values.includes(12) && prefixed.values.includes('TASK'), JSON.stringify(prefixed.values))
    assert.ok(!compile('TASK-12').sql.includes('unique_seq'), '고유 ID 속성이 없으면 보지 않는다')
    assert.ok(compile('12', withId).sql.includes('p.unique_seq') && !compile('12', withId).sql.includes('uds'), '번호만이면 접두사를 묻지 않는다')
  })
})
