/**
 * 성능 계측 — 브라우저의 수집기 (10e-1b · F-12-18 · DOM 없음)
 *
 *   ① 표본 비율 — 0 이면 끈다 · 모르는 값은 기본(0.2) · 1 을 넘지 않는다
 *   ② ★ 표본 — 뽑히지 않았으면 아무것도 모으지 않는다 · 뽑혔으면 비율 · 이동을 싣고 경로는 틀로
 *   ③ 20개가 차면 보낸다 · 모르는 지표 · 음수는 버린다 · 빈 묶음은 보내지 않는다
 *   ④ ★ editor_ready — 첫 편집기만 · 쓸 수 있게 되면 끝남 · 그 전에 떠나면 끝나지 않음(completed=false) · 떠날 때 보낸다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_PERF_SAMPLE_RATE, createPerfReporter, normalizeSampleRate, type OutgoingPerfEvent } from './perf-reporter.ts'

const ID = '0190a3f1-1111-7000-8000-000000000001'
const PATH = `/w/${ID}/${ID}`

function make(options: { rate?: number; roll?: number; navigation?: string | null } = {}) {
  const sent: OutgoingPerfEvent[][] = []
  const reporter = createPerfReporter({
    sampleRate: options.rate ?? 0.5,
    random: () => options.roll ?? 0.1,
    navigation: options.navigation === undefined ? 'navigate' : options.navigation,
    send: (events) => sent.push(events),
  })
  return { reporter, sent }
}

test('① 표본 비율', () => {
  assert.equal(normalizeSampleRate('0.5'), 0.5)
  assert.equal(normalizeSampleRate('0'), 0, '0 이면 끈다')
  assert.equal(normalizeSampleRate(undefined), DEFAULT_PERF_SAMPLE_RATE)
  assert.equal(normalizeSampleRate('abc'), DEFAULT_PERF_SAMPLE_RATE)
  assert.equal(normalizeSampleRate('-1'), DEFAULT_PERF_SAMPLE_RATE)
  assert.equal(normalizeSampleRate('3'), 1, '1 을 넘지 않는다')
})

test('② ★ 표본', () => {
  const off = make({ rate: 0.5, roll: 0.9 })
  assert.equal(off.reporter.sampled, false)
  off.reporter.record('LCP', 100, PATH)
  off.reporter.flush()
  assert.deepEqual(off.sent, [], '뽑히지 않았으면 아무것도 모으지 않는다')
  assert.equal(make({ rate: 0 }).reporter.sampled, false, '0 이면 끈다')

  const on = make({ rate: 0.5, roll: 0.1, navigation: 'reload' })
  on.reporter.record('LCP', 100, `${PATH}?q=비밀`)
  on.reporter.flush()
  assert.deepEqual(on.sent, [[{ metric: 'LCP', value: 100, route: '/w/[id]/[id]', navigation: 'reload', completed: true, sampleRate: 0.5 }]])
  assert.equal(make({ navigation: 'teleport' }).reporter.sampled, true)
})

test('③ 20개 · 버리기 · 빈 묶음', () => {
  const { reporter, sent } = make()
  reporter.record('FID', 1, PATH)
  reporter.record('LCP', -1, PATH)
  reporter.flush()
  assert.deepEqual(sent, [], '모르는 지표 · 음수는 버리고 빈 묶음은 보내지 않는다')
  for (let i = 0; i < 21; i += 1) reporter.record('INP', i, PATH)
  assert.equal(sent.length, 1, '20개가 차면 보낸다')
  assert.equal(sent[0]!.length, 20)
  reporter.flush()
  assert.equal(sent[1]!.length, 1)
})

test('④ ★ editor_ready', () => {
  const done = make()
  done.reporter.editorStarted()
  done.reporter.editorReady(850, PATH)
  done.reporter.editorReady(999, PATH)
  done.reporter.pageHidden(5000, PATH)
  assert.deepEqual(done.sent.flat().map((e) => [e.metric, e.value, e.completed]), [['editor_ready', 850, true]], '첫 편집기만 · 떠날 때 보낸다')

  const left = make()
  left.reporter.editorStarted()
  left.reporter.pageHidden(4200, PATH)
  left.reporter.editorReady(9000, PATH)
  left.reporter.flush()
  assert.deepEqual(left.sent.flat().map((e) => [e.metric, e.value, e.completed]), [['editor_ready', 4200, false]], '쓸 수 있게 되기 전에 떠났다 — 끝나지 않음')

  const none = make()
  none.reporter.pageHidden(100, PATH)
  assert.deepEqual(none.sent, [], '편집기가 없던 화면은 남기지 않는다')
})
