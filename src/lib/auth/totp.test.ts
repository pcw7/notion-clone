/**
 * TOTP · 봉인 · 백업 코드 — 잔여 묶음 8i-2a (F-14-05, DB 없음)
 *
 *   ① RFC 6238 의 시험 벡터(SHA-1 · 59초 → 287082)와 RFC 4648 의 base32
 *   ② ±1 창을 받고 그 밖은 받지 않는다 · **쓴 창과 그 앞은 다시 받지 않는다**
 *   ③ 봉인 — 되돌리면 같다 · 손대면 null · 다른 키면 null
 *   ④ 백업 코드 — 모양 · 대소문자와 하이픈을 가리지 않는다 · 서로 다르다
 *   ⑤ otpauth 주소
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  base32Decode,
  base32Encode,
  hashBackupCode,
  matchTotp,
  newBackupCodes,
  normalizeBackupCode,
  otpauthUri,
  totpAt,
  totpStepAt,
} from './totp.ts'
import { sealTotpSecret, unsealTotpSecret } from './mfa-seal.ts'

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

const RFC_SECRET = Buffer.from('12345678901234567890')

test('★ ① RFC 6238 시험 벡터 · RFC 4648 base32', () => {
  // RFC 6238 부록 B — SHA-1 · T=59 → 94287082(8자리) — 6자리는 끝 여섯
  assert.equal(totpAt(RFC_SECRET, totpStepAt(59_000)), '287082')
  assert.equal(totpAt(RFC_SECRET, totpStepAt(1_111_111_109_000)), '081804')
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI')
  assert.deepEqual(base32Decode('MZXW6YTBOI'), Buffer.from('foobar'))
  assert.deepEqual(base32Decode('mzxw 6ytb-oi'), Buffer.from('foobar'), '공백 · 하이픈 · 소문자를 가리지 않는다')
  assert.equal(base32Decode('MZXW1'), null, 'base32 가 아닌 글자')
})

test('★ ② ±1 창을 받고 · 쓴 창과 그 앞은 다시 받지 않는다', () => {
  const now = 1_700_000_000_000
  const step = totpStepAt(now)
  const code = (s: number) => totpAt(RFC_SECRET, s)
  assert.equal(matchTotp(RFC_SECRET, code(step), now, null), step)
  assert.equal(matchTotp(RFC_SECRET, code(step - 1), now, null), step - 1)
  assert.equal(matchTotp(RFC_SECRET, code(step + 1), now, null), step + 1)
  assert.equal(matchTotp(RFC_SECRET, code(step - 2), now, null), null, '두 창 전')
  assert.equal(matchTotp(RFC_SECRET, code(step), now, step), null, '쓴 창을 다시 냈다')
  assert.equal(matchTotp(RFC_SECRET, code(step - 1), now, step), null, '쓴 창의 앞을 냈다')
  assert.equal(matchTotp(RFC_SECRET, code(step + 1), now, step), step + 1, '쓴 창의 다음은 받는다')
  for (const bad of ['12345', '1234567', 'abcdef', 123456, null]) assert.equal(matchTotp(RFC_SECRET, bad, now, null), null, String(bad))
  assert.equal(matchTotp(RFC_SECRET, `${code(step).slice(0, 3)} ${code(step).slice(3)}`, now, null), step, '가운데 공백은 받는다')
})

test('③ 봉인 — 되돌리면 같다 · 손대면 null · 다른 키면 null', () => {
  const secret = Buffer.from('a 20 byte secret!!!!')
  const sealed = sealTotpSecret(secret)
  assert.ok(!sealed.includes(secret), '평문이 봉인 안에 그대로 있다')
  assert.deepEqual(unsealTotpSecret(sealed), secret)
  const tampered = Buffer.from(sealed)
  tampered[tampered.length - 1] ^= 1
  assert.equal(unsealTotpSecret(tampered), null)
  const before = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = 'another-secret'
  try {
    assert.equal(unsealTotpSecret(sealed), null)
  } finally {
    process.env.AUTH_SECRET = before
  }
})

test('④ 백업 코드 — 모양 · 가리지 않는 입력 · 서로 다르다', () => {
  const codes = newBackupCodes(6)
  assert.equal(codes.length, 6)
  assert.equal(new Set(codes).size, 6)
  for (const c of codes) assert.match(c, /^[a-z2-7]{5}-[a-z2-7]{5}$/)
  const one = codes[0]!
  assert.equal(normalizeBackupCode(one.toUpperCase().replace('-', ' ')), one.replace('-', ''))
  assert.equal(hashBackupCode(normalizeBackupCode(one)!), hashBackupCode(normalizeBackupCode(one.toUpperCase())!))
  for (const bad of ['short', 'abcde-fghi1', 123, null]) assert.equal(normalizeBackupCode(bad), null, String(bad))
})

test('⑤ otpauth 주소', () => {
  const uri = otpauthUri(Buffer.from('foobar'), 'me@example.com')
  assert.ok(uri.startsWith('otpauth://totp/notion-clone:me%40example.com?'))
  const params = new URL(uri).searchParams
  assert.equal(params.get('secret'), 'MZXW6YTBOI')
  assert.equal(params.get('digits'), '6')
  assert.equal(params.get('period'), '30')
})
