/**
 * 공개 화면의 신고 문구 — 게시 · 공유 6b-1b (순수)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { REPORT_REASONS } from '../../lib/moderation/report.ts'
import { REPORT_REASON_OPTIONS, reportFailureMessage } from './report-messages.ts'

test('사유는 서버의 넷과 같다 — 순서는 화면의 것', () => {
  assert.deepEqual(REPORT_REASON_OPTIONS.map((o) => o.value).sort(), [...REPORT_REASONS].sort())
  assert.equal(REPORT_REASON_OPTIONS.length, 4)
})

test('실패 까닭 — 아는 것은 문구 · 모르는 것 · 원형의 이름은 null', () => {
  assert.equal(reportFailureMessage('rate_limited'), '신고가 너무 잦습니다. 잠시 뒤에 다시 시도하세요.')
  assert.equal(reportFailureMessage('bad_origin'), '이 화면에서 보낸 신고만 받습니다.')
  assert.equal(reportFailureMessage('not_found'), null, '없는 페이지는 화면이 404 로 그린다')
  assert.equal(reportFailureMessage('constructor'), null)
  assert.equal(reportFailureMessage(undefined), null)
  assert.equal(reportFailureMessage(['rate_limited']), null)
})
