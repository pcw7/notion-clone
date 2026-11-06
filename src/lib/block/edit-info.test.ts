// 편집 이력 표시의 순수 부분(37번 트랙 ED-1 · F-11-15 · 정본 §3.4 [보강 ED-1]).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { editorLabel, formatEditStamp, formatEditStampRelative } from './edit-info.ts'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'

describe('이름표 · 시각', () => {
  test('★ 이름이 있으면 그 이름 · 게스트에게는 "멤버" · 찾지 못하거나 비면 "알 수 없는 사람"', () => {
    const names = new Map([[A, '가람']])
    assert.equal(editorLabel(A, names, true), '가람')
    assert.equal(editorLabel(A, names, false), '멤버')
    assert.equal(editorLabel('bbbbbbbb-0000-4000-8000-000000000002', names, true), '알 수 없는 사람')
    assert.equal(editorLabel(null, names, true), '알 수 없는 사람')
    assert.equal(editorLabel(A, new Map([[A, '  ']]), true), '알 수 없는 사람')
  })

  test('시각은 열람자의 시간대로 — 같은 순간이 서울과 UTC 에서 다른 시각', () => {
    const at = new Date('2026-11-03T15:30:00Z')
    const seoul = formatEditStamp(at, 'Asia/Seoul')
    const utc = formatEditStamp(at, 'UTC')
    assert.ok(seoul.includes('2026'), seoul)
    assert.notEqual(seoul, utc)
    assert.ok(/12:30|오전 12:30/.test(seoul), seoul)
  })
})

describe('상대 시각 (ED-3)', () => {
  const now = new Date('2026-11-07T06:00:00Z') // 서울 15:00 · UTC 06:00
  const ago = (ms: number) => new Date(now.getTime() - ms)
  const S = 'Asia/Seoul'

  test('★ 1분 안은 "방금" — 59초까지 · 60초부터 "1분 전"', () => {
    assert.equal(formatEditStampRelative(ago(0), now, S), '방금')
    assert.equal(formatEditStampRelative(ago(59_000), now, S), '방금')
    assert.equal(formatEditStampRelative(ago(60_000), now, S), '1분 전')
  })

  test('★ 1시간 안은 "N분 전" — 59분까지 · 60분부터는 오늘', () => {
    assert.equal(formatEditStampRelative(ago(59 * 60_000 + 59_000), now, S), '59분 전')
    assert.equal(formatEditStampRelative(ago(60 * 60_000), now, S), '오늘 오후 2:00')
  })

  test('★ 앞날(시계가 어긋남)은 "방금"', () => {
    assert.equal(formatEditStampRelative(new Date(now.getTime() + 5 * 3_600_000), now, S), '방금')
  })

  test('★ 열람자 시간대의 날짜로 오늘 · 어제를 가른다 — 같은 순간이 서울에선 오늘, UTC 에선 어제', () => {
    const n = new Date('2026-11-07T00:30:00Z') // 서울 09:30 (11-07) · UTC 00:30 (11-07)
    const at = new Date('2026-11-06T16:00:00Z') // 서울 01:00 (11-07) · UTC 16:00 (11-06)
    assert.equal(formatEditStampRelative(at, n, 'Asia/Seoul'), '오늘 오전 1:00')
    assert.equal(formatEditStampRelative(at, n, 'UTC'), '어제 오후 4:00')
  })

  test('★ 자정을 넘기면 한 시간 안이 아닌 어제', () => {
    const n = new Date('2026-11-06T15:10:00Z') // 서울 11-07 00:10
    const at = new Date('2026-11-06T14:00:00Z') // 서울 11-06 23:00
    assert.equal(formatEditStampRelative(at, n, 'Asia/Seoul'), '어제 오후 11:00')
  })

  test('★ 어제보다 오래면 절대 시각 그대로', () => {
    const at = new Date('2026-11-05T03:00:00Z')
    assert.equal(formatEditStampRelative(at, now, S), formatEditStamp(at, S))
    assert.ok(formatEditStampRelative(at, now, S).includes('2026'))
  })
})
