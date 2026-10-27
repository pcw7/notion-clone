/**
 * 보는 사람의 시간대 쿠키 (그룹 버킷 트랙 B-3 · 정본 [보강 B-3] ①)
 *
 *   ① 쓸 수 있는 시간대만 — 틀리거나 이상한 모양이면 UTC
 *   ② 쿠키 한 줄 · 쿠키 머리에서 읽기(인코딩된 / 를 푼다)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { TIME_ZONE_COOKIE, normalizeTimeZone, timeZoneCookie, timeZoneFromCookieHeader } from './time-zone.ts'

describe('시간대 쿠키 (B-3)', () => {
  test('① 쓸 수 있는 시간대만', () => {
    assert.equal(normalizeTimeZone('Asia/Seoul'), 'Asia/Seoul')
    assert.equal(normalizeTimeZone('America/Argentina/Buenos_Aires'), 'America/Argentina/Buenos_Aires')
    assert.equal(normalizeTimeZone('UTC'), 'UTC')
    assert.equal(normalizeTimeZone('Nowhere/Fake'), 'UTC', 'Intl 이 모르는 이름')
    assert.equal(normalizeTimeZone('Asia/Seoul; path=/'), 'UTC', '쿠키를 끊는 글자')
    assert.equal(normalizeTimeZone(undefined), 'UTC')
    assert.equal(normalizeTimeZone(''), 'UTC')
  })

  test('② 쿠키 한 줄 · 읽기', () => {
    const line = timeZoneCookie('Asia/Seoul')
    assert.ok(line.startsWith(`${TIME_ZONE_COOKIE}=Asia%2FSeoul;`), line)
    assert.match(line, /SameSite=Lax/)
    assert.equal(timeZoneFromCookieHeader(`a=1; ${TIME_ZONE_COOKIE}=Asia%2FSeoul; b=2`), 'Asia/Seoul')
    assert.equal(timeZoneFromCookieHeader('a=1'), null)
    assert.equal(timeZoneFromCookieHeader(`${TIME_ZONE_COOKIE}=%E0%A4%A`), null, '깨진 인코딩')
  })
})
