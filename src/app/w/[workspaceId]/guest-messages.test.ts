/**
 * 게스트 관리의 문구 — 7d-3조각 (DOM · DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PROMOTE_NOTICE,
  REMOVE_NOTICE,
  guestManageFailureMessage,
  guestPagesLabel,
  promotedNotice,
  removedNotice,
} from './guest-messages.ts'

test('받은 페이지 수 — 0 이면 "받은 페이지 없음"(정리할 사람을 찾는 줄)', () => {
  assert.equal(guestPagesLabel(0), '받은 페이지 없음')
  assert.equal(guestPagesLabel(3), '페이지 3개')
})

test('★ 누르기 전의 한 줄 — 올리면 좌석을 쓰고 공유는 그대로 · 빼면 공유가 모두 걷히고 다시 초대해도 돌아오지 않는다', () => {
  assert.match(PROMOTE_NOTICE, /좌석/)
  assert.match(PROMOTE_NOTICE, /그대로/)
  assert.match(REMOVE_NOTICE, /모두 걷힙니다/)
  assert.match(REMOVE_NOTICE, /돌아오지 않습니다/)
})

test('끝난 뒤의 한 줄 · 거부 코드마다 할 말', () => {
  assert.match(promotedNotice('앤', 2), /기본 teamspace 2곳/)
  assert.doesNotMatch(promotedNotice('앤', 0), /teamspace/)
  assert.match(removedNotice('앤', 3), /공유 3건/)
  for (const code of ['forbidden', 'not_found', 'would_orphan']) {
    assert.notEqual(guestManageFailureMessage(code), '처리하지 못했습니다.', code)
  }
  assert.equal(guestManageFailureMessage('something_new'), '처리하지 못했습니다.')
})
