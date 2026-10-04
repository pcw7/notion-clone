/**
 * 비밀번호 정책 — 잔여 묶음 8i-1a (F-14-03, DOM · DB 없음)
 *
 *   ① 8자 이상 · 서로 다른 글자 4개 이상
 *   ② 14자까지는 글자와 숫자가 하나씩 — **15자부터 그 요구가 풀린다**(규칙이 "걸리지 않는다"로 바뀐다)
 *   ③ 256자까지 · 글자가 아니면 거부
 *   ④ 글자 수는 코드 포인트로 — 한글 · 이모지도 한 글자
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isAcceptablePassword, passwordRules } from './password-policy.ts'

const ruleOf = (password: string, id: string) => passwordRules(password).find((r) => r.id === id)!

test('① 8자 이상 · 서로 다른 글자 4개 이상', () => {
  assert.equal(isAcceptablePassword('abc1234'), false, '7자')
  assert.equal(isAcceptablePassword('abcd1234'), true)
  assert.equal(isAcceptablePassword('aaaa1111'), false, '서로 다른 글자 2개')
  assert.equal(isAcceptablePassword('aaa11221'), false, '서로 다른 글자 3개')
  assert.equal(isAcceptablePassword('abc11221'), true, '서로 다른 글자 4개')
})

test('★ ② 14자까지는 글자와 숫자 · 15자부터 풀린다', () => {
  assert.equal(isAcceptablePassword('abcdefghijklmn'), false, '14자 글자만')
  assert.equal(isAcceptablePassword('12345678901234'), false, '14자 숫자만')
  assert.equal(isAcceptablePassword('abcdefghijklmno'), true, '15자 글자만 — 풀린다')
  assert.deepEqual(ruleOf('abcdefghijklmn', 'letter_and_digit'), { id: 'letter_and_digit', applies: true, met: false })
  assert.deepEqual(ruleOf('abcdefghijklmno', 'letter_and_digit'), { id: 'letter_and_digit', applies: false, met: true })
  assert.equal(isAcceptablePassword('correct horse battery staple'), true, '띄어 쓴 긴 문장')
})

test('③ 256자까지 · 글자가 아니면 거부', () => {
  assert.equal(isAcceptablePassword('ab12'.repeat(64)), true, '256자')
  assert.equal(isAcceptablePassword('ab12'.repeat(64) + 'c'), false, '257자')
  for (const bad of [undefined, null, 12345678, ['abcd1234']]) assert.equal(isAcceptablePassword(bad), false, JSON.stringify(bad))
})

test('④ 글자 수는 코드 포인트로 — 한글 · 이모지도 한 글자', () => {
  assert.equal(isAcceptablePassword('비밀번호1234'), true, '한글도 글자다')
  assert.equal(ruleOf('😀😀😀😀😀😀😀', 'length').met, false, '이모지 7개는 7자')
  assert.equal(ruleOf('😀😀😀😀😀😀😀😀', 'length').met, true)
})
