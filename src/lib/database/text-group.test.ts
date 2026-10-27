/**
 * 글자로 묶기 — 버킷 규칙 (그룹 버킷 트랙 B-2b · F-04-11)
 *
 *   ① ★ 첫 글자의 머리 — 한글은 초성(된소리는 예사소리로) · 로마자는 대문자 · 그 밖은 # · 앞 공백은 건너뛴다 · 빈 글은 ''
 *   ② 첫 글자 키인가 · 그룹 순서(ㄱ ~ ㅎ · A ~ Z · #) · 글 그대로는 한국어 순서
 *   ③ 머리의 이름
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { FOLDED_CHOSEONG, compareTextKeys, initialOf, isInitialKey, isTextMode, textGroupLabel } from './text-group.ts'

describe('글자로 묶기 (B-2b)', () => {
  test('★ ① 첫 글자의 머리', () => {
    assert.equal(initialOf('사과'), 'ㅅ')
    assert.equal(initialOf('가'), 'ㄱ')
    assert.equal(initialOf('힣'), 'ㅎ', '마지막 음절')
    assert.equal(initialOf('까치'), 'ㄱ', '된소리는 예사소리로')
    assert.equal(initialOf('쌀'), 'ㅅ')
    assert.equal(initialOf('  짜장'), 'ㅈ', '앞 공백은 건너뛴다')
    assert.equal(initialOf('apple'), 'A')
    assert.equal(initialOf('Zoo'), 'Z')
    assert.equal(initialOf('3번'), '#')
    assert.equal(initialOf('ㄱ 자음만'), '#', '자음 낱자는 음절이 아니다')
    assert.equal(initialOf('😀 웃음'), '#', '그림 문자 — 서로게이트를 반으로 자르지 않는다')
    assert.equal(initialOf(''), '')
    assert.equal(initialOf('   '), '')
    assert.equal(FOLDED_CHOSEONG.length, 19)
  })

  test('② 키 · 순서', () => {
    assert.equal(isInitialKey('ㄱ'), true)
    assert.equal(isInitialKey('ㄲ'), false, '접힌 키만')
    assert.equal(isInitialKey('A'), true)
    assert.equal(isInitialKey('a'), false)
    assert.equal(isInitialKey('#'), true)
    assert.equal(isInitialKey(''), false)
    assert.deepEqual(['#', 'Z', 'ㅅ', 'A', 'ㄱ'].sort((a, b) => compareTextKeys(a, b, 'first')), ['ㄱ', 'ㅅ', 'A', 'Z', '#'])
    assert.deepEqual(['사과', '가지', '바나나'].sort((a, b) => compareTextKeys(a, b, 'exact')), ['가지', '바나나', '사과'])
    assert.equal(isTextMode('first'), true)
    assert.equal(isTextMode('alphabet_prefix'), false)
  })

  test('③ 머리의 이름', () => {
    assert.equal(textGroupLabel('#', 'first'), '그 밖')
    assert.equal(textGroupLabel('ㅅ', 'first'), 'ㅅ')
    assert.equal(textGroupLabel('#', 'exact'), '#', '글 그대로면 그 글')
  })
})
