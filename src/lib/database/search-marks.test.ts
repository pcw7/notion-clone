/**
 * 맞은 글자 강조 — 뷰 검색의 나머지 트랙 V-3
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 뷰 검색 ⑦
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { searchMarks } from './search-marks.ts'

const shown = (text: string, term: string | null) => searchMarks(text, term).map((p) => (p.hit ? `[${p.text}]` : p.text)).join('')

describe('맞은 조각', () => {
  test('★ 대소문자 무시 · 왼쪽부터 겹치지 않게 · 원래 글자 그대로', () => {
    assert.equal(shown('주간 보고서를 보고', '보고'), '주간 [보고]서를 [보고]')
    assert.equal(shown('Alpha alpha ALPHA', 'alpha'), '[Alpha] [alpha] [ALPHA]')
    assert.equal(shown('aaaa', 'aa'), '[aa][aa]', '겹치지 않는다')
    assert.equal(shown('50% 할인', '%'), '50[%] 할인', '% 는 글자 그대로')
  })

  test('검색어가 없거나 맞지 않으면 통째로 · 빈 글은 조각이 없다', () => {
    assert.deepEqual(searchMarks('보고서', null), [{ text: '보고서', hit: false }])
    assert.deepEqual(searchMarks('보고서', '  '), [{ text: '보고서', hit: false }])
    assert.deepEqual(searchMarks('보고서', '회의'), [{ text: '보고서', hit: false }])
    assert.deepEqual(searchMarks('', '보고'), [])
    assert.equal(shown('보고서', ' 보고 '), '[보고]서', '앞뒤 공백은 뗀다(서버의 다듬기와 같다)')
  })
})
