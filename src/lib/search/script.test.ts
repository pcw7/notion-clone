/**
 * 스크립트 판별 — W7 (F-07-02)
 *
 * 이 파일이 지키는 것 둘.
 *
 *   ① **한국어 쿼리 1자가 유효하다.** 최소 길이를 영문 기준으로 두면 한국어
 *      검색이 통째로 죽는다(F-07-02 가 명시한 실패).
 *   ② **섞인 쿼리는 CJK 축으로 간다.** 라틴으로 보내면 한국어 부분이 조사
 *      문제로 빠진다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { detectScript, detectLang, minQueryLength } from './script.ts'

describe('detectScript', () => {
  test('한글은 cjk', () => {
    assert.equal(detectScript('검색'), 'cjk')
    assert.equal(detectScript('가'), 'cjk')
  })

  test('라틴은 latin', () => {
    assert.equal(detectScript('search'), 'latin')
    assert.equal(detectScript('Q3 report 2026'), 'latin')
  })

  test('★ 섞이면 cjk — 라틴으로 보내면 한국어 부분이 조사 문제로 빠진다', () => {
    assert.equal(detectScript('Notion 클론'), 'cjk')
    assert.equal(detectScript('클론 roadmap'), 'cjk')
  })

  test('★ IME 조합 중간 상태(호환 자모)도 cjk', () => {
    // 사용자가 "ㄱ" 만 친 순간이다. latin 으로 판정하면 최소 길이 2자에 걸려
    // 검색이 안 되고, 한 글자 더 쳐서 음절이 완성되는 순간 갑자기 동작한다.
    assert.equal(detectScript('ㄱ'), 'cjk')
    assert.equal(detectScript('ㅎㅏ'), 'cjk')
  })

  test('한자 · 가나도 cjk', () => {
    assert.equal(detectScript('検索'), 'cjk')
    assert.equal(detectScript('ひらがな'), 'cjk')
    assert.equal(detectScript('カタカナ'), 'cjk')
  })

  test('숫자·기호만이면 latin (기본값)', () => {
    assert.equal(detectScript('2026'), 'latin')
    assert.equal(detectScript('---'), 'latin')
  })
})

describe('minQueryLength', () => {
  test('★ CJK 는 1자, 라틴은 2자 — F-07-02 가 지정한 분기', () => {
    assert.equal(minQueryLength('cjk'), 1)
    assert.equal(minQueryLength('latin'), 2)
  })

  test('★ 한국어 한 글자 쿼리가 유효하다', () => {
    const q = '책'
    assert.ok(q.length >= minQueryLength(detectScript(q)))
  })

  test('영문 한 글자 쿼리는 유효하지 않다', () => {
    const q = 'a'
    assert.ok(q.length < minQueryLength(detectScript(q)))
  })
})

describe('detectLang', () => {
  test('한글이 있으면 ko', () => {
    assert.equal(detectLang('검색 인덱스'), 'ko')
    assert.equal(detectLang('Notion 클론 프로젝트'), 'ko')
  })

  test('라틴만이면 en', () => {
    assert.equal(detectLang('search index'), 'en')
  })

  test('★ 한자·가나만이면 und — 못 하는 판별을 한 척하지 않는다', () => {
    // 일본어인지 중국어인지는 이 함수가 알 수 없다.
    assert.equal(detectLang('検索'), 'und')
    assert.equal(detectLang('ひらがな'), 'und')
  })

  test('글자가 없으면 und', () => {
    assert.equal(detectLang(''), 'und')
    assert.equal(detectLang('2026 ---'), 'und')
  })
})
