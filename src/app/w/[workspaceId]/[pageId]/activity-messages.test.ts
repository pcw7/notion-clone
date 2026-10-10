/**
 * Updates 패널의 글자 (4d-3 · F-11-04)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { activityActorLabel, activityLine } from './activity-messages.ts'
import { PAGE_ACTIVITY_TYPES } from '../../../../lib/notification/page-activity.ts'

test('★ 행위자 — 시스템 · 삭제된 사용자 · 이름 없음 · 이름', () => {
  assert.equal(activityActorLabel(null), '시스템')
  assert.equal(activityActorLabel({ name: '', deleted: true }), '삭제된 사용자')
  assert.equal(activityActorLabel({ name: '홍길동', deleted: true }), '삭제된 사용자', '탈퇴했으면 이름이 있어도 말하지 않는다')
  assert.equal(activityActorLabel({ name: '', deleted: false }), '이름 없음')
  assert.equal(activityActorLabel({ name: '홍길동', deleted: false }), '홍길동')
})

test('★ 옮기기 — 목적지가 있으면 그 제목 · 없으면 말하지 않는다', () => {
  assert.equal(activityLine({ type: 'page.moved', movedTo: { title: '회의록' } }), '‘회의록’ 아래로 옮겼습니다')
  assert.equal(activityLine({ type: 'page.moved', movedTo: { title: '' } }), '‘제목 없음’ 아래로 옮겼습니다')
  assert.equal(activityLine({ type: 'page.moved', movedTo: null }), '이 페이지를 옮겼습니다')
})

test('보이는 종류마다 한 줄이 있다 — 빈 글이 없다', () => {
  for (const type of PAGE_ACTIVITY_TYPES) {
    const line = activityLine({ type, movedTo: null })
    assert.ok(typeof line === 'string' && line.length > 0, type)
  }
})
