/**
 * 성능 계측 — 다듬기 · 경로의 틀 · 백분위 (10e-1a · F-12-18 · 순수)
 *
 *   ① ★ 경로의 틀 — uuid 는 [id] · 정적 조각은 그대로 · 나머지(토큰 · 이름 · 제목)는 [x] · 쿼리 · 조각은 버린다 · 8조각까지
 *   ② 측정값 — 닫힌 목록 · 범위 · 표본 비율 (0, 1] · 끝났는가(기본 참) · 이동은 아는 것만 · 경로는 다시 틀로
 *   ③ 묶음 — 배열만 · 상한 · 틀린 것만 빠진다
 *   ④ 백분위 — 가장 가까운 순위 · 비면 null
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_PERF_BATCH, MAX_PERF_VALUE, normalizePerfBatch, normalizePerfEvent, percentile, routeTemplate } from './perf-events.ts'

const ID = '0190a3f1-1111-7000-8000-000000000001'
const ok = { metric: 'LCP', value: 1234.5, route: `/w/${ID}/${ID}`, navigation: 'navigate', sampleRate: 0.2 }

test('① ★ 경로의 틀', () => {
  assert.equal(routeTemplate(`/w/${ID}/${ID}`), '/w/[id]/[id]')
  assert.equal(routeTemplate(`/w/${ID}/db/${ID}?v=1&q=비밀#x`), '/w/[id]/db/[id]', '쿼리 · 조각은 버린다')
  assert.equal(routeTemplate(`/w/${ID}/settings`), '/w/[id]/settings')
  assert.equal(routeTemplate('/p/AbCdEfGhIjKlMnOpQrStUv'), '/p/[x]', '공개 토큰은 남기지 않는다')
  assert.equal(routeTemplate('/s/우리팀/회의록'), '/s/[x]/[x]', '사이트 이름 · 제목은 남기지 않는다')
  assert.equal(routeTemplate('/'), '/')
  assert.equal(routeTemplate(''), '/')
  assert.equal(routeTemplate('/w/a/b/c/d/e/f/g/h/i/j').split('/').length - 1, 8, '8조각까지')
})

test('② 측정값', () => {
  assert.deepEqual(normalizePerfEvent(ok), { metric: 'LCP', value: 1234.5, route: '/w/[id]/[id]', navigation: 'navigate', completed: true, sampleRate: 0.2 })
  assert.equal(normalizePerfEvent({ ...ok, metric: 'FID' }), null, '닫힌 목록')
  assert.equal(normalizePerfEvent({ ...ok, value: -1 }), null)
  assert.equal(normalizePerfEvent({ ...ok, value: MAX_PERF_VALUE }), null, '10분 이상은 잘못 잰 것')
  assert.equal(normalizePerfEvent({ ...ok, value: Number.NaN }), null)
  assert.equal(normalizePerfEvent({ ...ok, sampleRate: 0 }), null)
  assert.equal(normalizePerfEvent({ ...ok, sampleRate: 1.5 }), null)
  assert.equal(normalizePerfEvent({ ...ok, completed: false })?.completed, false)
  assert.equal(normalizePerfEvent({ ...ok, navigation: 'teleport' })?.navigation, null, '모르는 이동은 비운다')
  assert.equal(normalizePerfEvent({ ...ok, route: '/s/제목' })?.route, '/s/[x]', '경로는 다시 틀로')
  assert.equal(normalizePerfEvent(null), null)
})

test('③ 묶음', () => {
  assert.deepEqual(normalizePerfBatch('x'), [])
  assert.equal(normalizePerfBatch([ok, { ...ok, metric: 'nope' }, ok]).length, 2, '틀린 것만 빠진다')
  assert.equal(normalizePerfBatch(Array.from({ length: MAX_PERF_BATCH + 5 }, () => ok)).length, MAX_PERF_BATCH)
})

test('④ 백분위', () => {
  assert.equal(percentile([], 95), null)
  const values = Array.from({ length: 100 }, (_, i) => i + 1)
  assert.equal(percentile(values, 50), 50)
  assert.equal(percentile(values, 95), 95)
  assert.equal(percentile(values, 100), 100)
  assert.equal(percentile([7], 95), 7)
  assert.equal(percentile([3, 1, 2], 50), 2, '정렬해서 본다')
})
