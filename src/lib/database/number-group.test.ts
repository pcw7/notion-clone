/**
 * 숫자 구간으로 묶기 — 버킷 규칙 (그룹 버킷 트랙 B-2 · F-04-11)
 *
 *   ① ★ 구간 키 — 정규 글자 · 크기의 배수 · 소수 크기 · 음수 · 정규가 아닌 글자는 아니다
 *   ② 크기 — 0 보다 크고 소수 여섯 자리까지
 *   ③ ★ 옮기면 구간 차이만큼 더한다 — 소수 오차가 없다
 *   ④ 머리의 이름
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { isNumberBucketKey, isNumberSize, numberGroupLabel, shiftNumber } from './number-group.ts'

describe('숫자 구간으로 묶기 (B-2)', () => {
  test('★ ① 구간 키', () => {
    assert.equal(isNumberBucketKey('20', 10), true)
    assert.equal(isNumberBucketKey('-10', 10), true)
    assert.equal(isNumberBucketKey('0', 10), true)
    assert.equal(isNumberBucketKey('25', 10), false, '크기의 배수가 아니다')
    assert.equal(isNumberBucketKey('0.3', 0.1), true, '소수 크기 — 0.3 / 0.1 의 부동소수 오차에 걸리지 않는다')
    assert.equal(isNumberBucketKey('99.5', 0.5), true)
    assert.equal(isNumberBucketKey('7.5', 2.5), true)
    assert.equal(isNumberBucketKey('20.0', 10), false, '정규 글자가 아니다(trim_scale 의 글자는 20)')
    assert.equal(isNumberBucketKey('020', 10), false)
    assert.equal(isNumberBucketKey('-0', 10), false)
    assert.equal(isNumberBucketKey('', 10), false, '값 없음은 부르는 쪽이 따로 본다')
    assert.equal(isNumberBucketKey('스물', 10), false)
  })

  test('② 크기', () => {
    assert.equal(isNumberSize(10), true)
    assert.equal(isNumberSize(0.000001), true)
    assert.equal(isNumberSize(0.0000001), false, '소수 일곱 자리')
    assert.equal(isNumberSize(0), false)
    assert.equal(isNumberSize(-5), false)
    assert.equal(isNumberSize(Number.POSITIVE_INFINITY), false)
    assert.equal(isNumberSize('10'), false)
  })

  test('★ ③ 옮기면 구간 차이만큼 더한다', () => {
    assert.equal(shiftNumber(23, '20', '50'), 53)
    assert.equal(shiftNumber(23, '20', '-10'), -7)
    assert.equal(shiftNumber(0.2, '0.2', '0.3'), 0.3, '0.2 + 0.1 이 0.30000000000000004 가 아니다')
    assert.equal(shiftNumber(1.25, '0', '2.5'), 3.75)
  })

  test('④ 머리의 이름', () => {
    assert.equal(numberGroupLabel('20', 10), '20 ~ 30')
    assert.equal(numberGroupLabel('-10', 10), '-10 ~ 0')
    assert.equal(numberGroupLabel('0.2', 0.1), '0.2 ~ 0.3')
  })
})
