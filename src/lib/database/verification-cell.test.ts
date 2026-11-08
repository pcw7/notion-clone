import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toVerificationCell, verificationLabel, withVerificationExpiry } from './verification-cell.ts'

const NOW = new Date('2026-11-08T00:00:00Z')
const who = '3f2b8f0e-5d3a-4a77-9c1e-0d9d6f1b2a10'
const stored = (expires: string | null) => ({ type: 'verification', state: 'verified', verified_by: who, verified_at: '2026-11-01T00:00:00Z', expires_at: expires })

test('만료는 읽을 때 정한다 — expires_at <= 지금', () => {
  assert.equal(toVerificationCell(stored('2026-11-09T00:00:00Z'), NOW)?.expired, false)
  assert.equal(toVerificationCell(stored('2026-11-08T00:00:00Z'), NOW)?.expired, true, '같은 시각은 이미 만료')
  assert.equal(toVerificationCell(stored(null), NOW)?.expired, false, '무기한은 만료가 없다')
  assert.equal(toVerificationCell({ type: 'verification', state: 'nope' }, NOW), null)
})

test('칸의 글 — N일 남음 · 무기한 · 만료 · 빈 칸', () => {
  assert.equal(verificationLabel(toVerificationCell(stored('2026-11-18T00:00:00Z'), NOW), NOW), '✓ 검증됨 · 10일 남음')
  assert.equal(verificationLabel(toVerificationCell(stored(null), NOW), NOW), '✓ 검증됨 · 무기한')
  assert.equal(verificationLabel(toVerificationCell(stored('2026-11-07T00:00:00Z'), NOW), NOW), '만료')
  assert.equal(verificationLabel(null, NOW), '')
})

test('행의 칸 묶음 — 검증 칸에만 expired 를 더하고 나머지는 그대로', () => {
  const plain = { a: { type: 'number', number: 1 } }
  assert.equal(withVerificationExpiry(plain, NOW), plain, '검증 칸이 없으면 같은 객체')
  const out = withVerificationExpiry({ ...plain, v: stored('2026-11-07T00:00:00Z') }, NOW)
  assert.deepEqual(out.a, plain.a)
  assert.equal((out.v as { expired: boolean }).expired, true)
})
