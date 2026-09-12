/**
 * 일치 구간 강조 — W7 (F-07-02)
 *
 * 이 파일이 지키는 것 셋.
 *
 *   ① **조각을 이어 붙이면 원문과 정확히 같다.** 한 글자라도 잃으면 화면에서
 *      사용자 본문이 조용히 사라진다
 *   ② 한국어가 강조된다 — `ts_headline` 을 쓰지 않은 이유가 이것이다
 *   ③ 연산자(`OR` · `-제외` · 따옴표)는 강조 대상이 아니다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { splitHighlight } from './highlight.ts'

/** 모든 경우에 성립해야 하는 불변식. */
const assertLossless = (text: string, query: string): void => {
  const joined = splitHighlight(text, query)
    .map((p) => p.text)
    .join('')
  assert.equal(joined, text, `조각을 이어 붙인 것이 원문과 다르다 (쿼리 ${JSON.stringify(query)})`)
}

const hits = (text: string, query: string): string[] =>
  splitHighlight(text, query)
    .filter((p) => p.hit)
    .map((p) => p.text)

describe('splitHighlight', () => {
  test('한국어를 강조한다', () => {
    assert.deepEqual(splitHighlight('검색 기능', '검색'), [
      { text: '검색', hit: true },
      { text: ' 기능', hit: false },
    ])
  })

  test('★ 조사가 붙어 있어도 어근만 강조한다 — 서버가 그렇게 찾았다', () => {
    // pg_bigm 이 '검색' 으로 '검색이' 를 찾으므로, 화면도 그 부분을 강조해야
    // 사용자가 왜 걸렸는지 알 수 있다.
    assert.deepEqual(hits('검색이 빠르다', '검색'), ['검색'])
  })

  test('대소문자를 무시한다', () => {
    assert.deepEqual(hits('Quarterly Report', 'quarterly'), ['Quarterly'])
    assert.deepEqual(hits('quarterly report', 'REPORT'), ['report'])
  })

  test('여러 번 나오면 전부 강조한다', () => {
    assert.deepEqual(hits('검색 그리고 또 검색', '검색'), ['검색', '검색'])
  })

  test('토큰이 여러 개면 각각 강조한다', () => {
    assert.deepEqual(hits('알파와 베타', '알파 베타'), ['알파', '베타'])
  })

  test('★ 긴 토큰을 먼저 본다 — 짧은 것이 먼저면 조각이 쪼개져 보인다', () => {
    // '검색' 이 먼저 걸리면 '검색' + '엔진'(평문) 이 되어 강조가 끊긴다.
    assert.deepEqual(hits('검색엔진을 만든다', '검색 검색엔진'), ['검색엔진'])
  })

  test('없으면 한 조각이고 hit 이 없다', () => {
    assert.deepEqual(splitHighlight('아무 상관 없는 글', '검색'), [
      { text: '아무 상관 없는 글', hit: false },
    ])
  })

  test('빈 텍스트는 빈 배열 — 화면이 빈 조각을 그리지 않는다', () => {
    assert.deepEqual(splitHighlight('', '검색'), [])
  })

  test('빈 쿼리면 전체가 평문이다', () => {
    assert.deepEqual(splitHighlight('본문', ''), [{ text: '본문', hit: false }])
    assert.deepEqual(splitHighlight('본문', '   '), [{ text: '본문', hit: false }])
  })
})

describe('연산자는 강조 대상이 아니다', () => {
  test('★ OR 은 연산자다 — 본문의 "or" 가 강조되면 안 된다', () => {
    assert.deepEqual(hits('alpha or beta', 'alpha OR beta'), ['alpha', 'beta'])
  })

  test('★ 제외 토큰(-)은 강조하지 않는다 — 없는 말이 있는 것처럼 보인다', () => {
    assert.deepEqual(hits('알파 베타', '알파 -베타'), ['알파'])
  })

  test('따옴표를 벗기고 안의 말을 강조한다', () => {
    assert.deepEqual(hits('my projects here', '"my projects"'), ['my', 'projects'])
  })

  test('연산자만 있는 쿼리면 강조가 없다', () => {
    assert.deepEqual(hits('본문', 'OR'), [])
    assert.deepEqual(hits('본문', '-제외'), [])
  })
})

describe('★ 무손실 — 어떤 입력에도 원문을 잃지 않는다', () => {
  const texts = [
    '검색 기능을 만든다',
    'Quarterly Report 2026',
    '검색검색검색',
    '  앞뒤 공백  ',
    '특수문자 !@#$%^&*() 포함',
    '',
    '한 글자',
  ]
  const queries = ['검색', '', '   ', 'OR', '-빼기', '"구문 검색"', '검색 검색 검색', '!@#', '글자']

  for (const text of texts) {
    for (const query of queries) {
      test(`${JSON.stringify(text.slice(0, 12))} × ${JSON.stringify(query)}`, () => {
        assertLossless(text, query)
      })
    }
  }
})

describe('겹치는 일치', () => {
  test('겹치면 앞에서부터 한 번만 센다', () => {
    // 'aa' 가 'aaa' 안에서 두 번 겹칠 수 있다. 앞에서부터 소비한다.
    const parts = splitHighlight('aaa', 'aa')
    assert.equal(parts.map((p) => p.text).join(''), 'aaa')
    assert.deepEqual(parts, [
      { text: 'aa', hit: true },
      { text: 'a', hit: false },
    ])
  })
})
