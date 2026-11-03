// 편집 이력 표시의 순수 부분(37번 트랙 ED-1 · F-11-15 · 정본 §3.4 [보강 ED-1]).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { editorLabel, formatEditStamp } from './edit-info.ts'

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
