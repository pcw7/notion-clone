/**
 * 익명 쓰기 경로의 출처 검사 (10n-78 · F-17-10)
 *
 *   ① 요청이 닿은 주소의 출처 · 설정한 공개 주소 · 더 받을 출처(쉼표)를 합친다 — 겹치면 하나
 *   ② ★ 프록시 뒤 — 서버가 받은 주소(내부)와 브라우저의 공개 주소가 달라도 공개 주소의 출처를 받는다
 *   ③ 출처로 읽히지 않는 값 · http(s) 가 아닌 값은 버린다 · 경로 · 끝의 / 는 출처만 남는다
 *   ④ `Origin` 이 없으면 받고(브라우저가 아니다) · 목록 밖이면 받지 않는다 · "null" 이라는 글자도 받지 않는다
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { allowedOrigins, isAllowedOrigin } from './allowed-origins.ts'

test('① 셋을 합친다 — 겹치면 하나', () => {
  assert.deepEqual(allowedOrigins('http://localhost:3000/p/x/report/submit', { NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }), ['http://localhost:3000'])
  assert.deepEqual(
    allowedOrigins('http://10.0.0.5:3000/f/t/submit', { NEXT_PUBLIC_APP_URL: 'https://notes.example.com', APP_ALLOWED_ORIGINS: 'https://www.notes.example.com, https://notes.example.com' }),
    ['http://10.0.0.5:3000', 'https://notes.example.com', 'https://www.notes.example.com'],
  )
})

test('② ★ 프록시 뒤 — 공개 주소의 출처를 받는다', () => {
  const allowed = allowedOrigins('http://127.0.0.1:3000/p/tok/report/submit', { NEXT_PUBLIC_APP_URL: 'https://notes.example.com/' })
  assert.equal(isAllowedOrigin('https://notes.example.com', allowed), true)
  assert.equal(isAllowedOrigin('https://evil.example', allowed), false)
})

test('③ 출처로 읽히지 않는 값은 버린다 · 경로는 떼고 출처만', () => {
  assert.deepEqual(allowedOrigins('http://localhost:3000/x', { NEXT_PUBLIC_APP_URL: 'not a url', APP_ALLOWED_ORIGINS: ' , ftp://files.example, javascript:alert(1), https://ok.example/path/' }), [
    'http://localhost:3000',
    'https://ok.example',
  ])
})

test('④ Origin 이 없으면 받고 · 목록 밖 · "null" 은 받지 않는다', () => {
  const allowed = allowedOrigins('http://localhost:3000/x', {})
  assert.equal(isAllowedOrigin(null, allowed), true)
  assert.equal(isAllowedOrigin('http://localhost:3000', allowed), true)
  assert.equal(isAllowedOrigin('null', allowed), false)
  assert.equal(isAllowedOrigin('http://localhost:3001', allowed), false)
})
