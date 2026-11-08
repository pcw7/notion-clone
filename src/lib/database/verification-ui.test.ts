import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { editedAfterVerified, endOfDayExpiresAt, presetExpiresAt, verificationBadgeTitle } from './verification-ui.ts'
import type { VerificationCell } from './verification-cell.ts'

const cell = (over: Partial<VerificationCell> = {}): VerificationCell => ({
  type: 'verification',
  state: 'verified',
  verified_by: 'u1',
  verified_at: '2026-11-08T00:00:00.000Z',
  expires_at: '2026-12-08T00:00:00.000Z',
  expired: false,
  ...over,
})

describe('presetExpiresAt', () => {
  it('지금 + N×24시간', () => {
    const now = new Date('2026-11-08T03:00:00.000Z')
    assert.equal(presetExpiresAt(7, now), '2026-11-15T03:00:00.000Z')
    assert.equal(presetExpiresAt(30, now), '2026-12-08T03:00:00.000Z')
    assert.equal(presetExpiresAt(90, now), '2027-02-06T03:00:00.000Z')
  })
})

describe('endOfDayExpiresAt', () => {
  it('보는 사람의 시간대로 그날의 끝', () => {
    assert.equal(endOfDayExpiresAt('2026-12-01', 'Asia/Seoul'), '2026-12-01T14:59:59.999Z')
    assert.equal(endOfDayExpiresAt('2026-12-01', 'UTC'), '2026-12-01T23:59:59.999Z')
    assert.equal(endOfDayExpiresAt('2026-12-01', 'America/Los_Angeles'), '2026-12-02T07:59:59.999Z')
  })
  it('서머타임이 있는 날도 그날의 끝', () => {
    // 2026-03-08 미국 서머타임 시작 — 그날 끝은 PDT(-7)
    assert.equal(endOfDayExpiresAt('2026-03-08', 'America/Los_Angeles'), '2026-03-09T06:59:59.999Z')
  })
  it('날짜가 아니면 null', () => {
    assert.equal(endOfDayExpiresAt('2026-02-31', 'UTC'), null)
    assert.equal(endOfDayExpiresAt('', 'UTC'), null)
    assert.equal(endOfDayExpiresAt('2026-12-01', 'Nowhere/Zone'), null)
  })
})

describe('검증 뒤 고침', () => {
  it('마지막 편집이 검증보다 뒤일 때만', () => {
    assert.equal(editedAfterVerified('2026-11-08T00:00:01.000Z', cell()), true)
    assert.equal(editedAfterVerified('2026-11-07T23:00:00.000Z', cell()), false)
    assert.equal(editedAfterVerified('2026-11-08T00:00:00.000Z', cell()), false)
  })
  it('머리말에 덧붙인다', () => {
    const edited = verificationBadgeTitle(cell(), '홍길동', '2026-11-09T00:00:00.000Z')
    assert.match(edited, /^홍길동 · 2026-11-08 검증 · 2026-12-08 까지 · 검증 뒤 고침$/)
    const clean = verificationBadgeTitle(cell(), '홍길동', '2026-11-07T00:00:00.000Z')
    assert.equal(clean.includes('검증 뒤 고침'), false)
  })
})
