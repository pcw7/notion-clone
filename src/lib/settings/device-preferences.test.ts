/**
 * 기기의 접근성 설정 — 값 · 쿠키 · 움직임 판정 (10d-2 · F-12-13 · 순수)
 *
 *   ① 값 — 셋씩 · 모르는 값은 system · 이름이 모두 다르다
 *   ② 쿠키 한 줄 — 모든 경로 · 400일 · SameSite=Lax · 모르는 값은 system 으로 다듬어 쓴다(주입처럼 보이는 값도)
 *   ③ ★ 움직임 판정 — 기기의 값이 OS 를 이긴다 · system 이면 OS
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTRASTS,
  CONTRAST_COOKIE,
  CONTRAST_LABEL,
  DEVICE_PREFERENCE_MAX_AGE,
  MOTIONS,
  MOTION_COOKIE,
  MOTION_LABEL,
  devicePreferenceCookie,
  normalizeContrast,
  normalizeMotion,
  reducesMotion,
} from './device-preferences.ts'

test('① 값', () => {
  for (const value of CONTRASTS) assert.equal(normalizeContrast(value), value)
  for (const value of MOTIONS) assert.equal(normalizeMotion(value), value)
  for (const raw of ['', 'HIGH', null, undefined, 1]) {
    assert.equal(normalizeContrast(raw), 'system', String(raw))
    assert.equal(normalizeMotion(raw), 'system', String(raw))
  }
  assert.equal(new Set(CONTRASTS.map((c) => CONTRAST_LABEL[c])).size, CONTRASTS.length)
  assert.equal(new Set(MOTIONS.map((m) => MOTION_LABEL[m])).size, MOTIONS.length)
})

test('② 쿠키 한 줄', () => {
  assert.equal(devicePreferenceCookie(CONTRAST_COOKIE, 'high'), `nc_contrast=high; Path=/; Max-Age=${DEVICE_PREFERENCE_MAX_AGE}; SameSite=Lax`)
  assert.equal(devicePreferenceCookie(MOTION_COOKIE, 'reduce'), `nc_motion=reduce; Path=/; Max-Age=${DEVICE_PREFERENCE_MAX_AGE}; SameSite=Lax`)
  assert.ok(devicePreferenceCookie(CONTRAST_COOKIE, 'x; Domain=evil.example').startsWith('nc_contrast=system;'), '모르는 값은 system 으로')
  assert.equal(DEVICE_PREFERENCE_MAX_AGE, 400 * 24 * 60 * 60)
})

test('③ ★ 움직임 판정 — 기기의 값이 OS 를 이긴다', () => {
  assert.equal(reducesMotion('reduce', false), true)
  assert.equal(reducesMotion('full', true), false, '줄이지 않음은 OS 가 줄여도 그대로')
  assert.equal(reducesMotion('system', true), true)
  assert.equal(reducesMotion('system', false), false)
  assert.equal(reducesMotion(undefined, true), true, '속성이 없으면 system')
})
