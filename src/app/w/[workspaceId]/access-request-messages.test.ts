/**
 * 접근 요청의 문구 — 7e-1조각 (DOM · DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EDIT_REQUEST_SENT,
  REQUEST_SENT,
  accessInboxLine,
  accessRequestFailureMessage,
  approveLevelOptions,
  approvedNotice,
  defaultApproveLevel,
  ignoredNotice,
  inboxHref,
  requestKindLabel,
  requesterLabel,
} from './access-request-messages.ts'

test('★ 허락할 레벨 — 좁은 것부터(기본은 읽기) · 게스트에게는 전체 권한이 없다', () => {
  assert.deepEqual(approveLevelOptions(false).map((o) => o.value), ['view', 'comment', 'edit', 'full_access'])
  assert.deepEqual(approveLevelOptions(true).map((o) => o.value), ['view', 'comment', 'edit'])
  assert.equal(approveLevelOptions(false)[0]?.label, '읽기')
})

test('요청 줄의 사람 · 끝난 뒤의 한 줄 — 무시는 요청한 사람에게 알리지 않는다고 말한다', () => {
  assert.equal(requesterLabel({ name: '앤', email: 'ann@example.com', guest: true }), '앤 (ann@example.com) · 게스트')
  assert.equal(requesterLabel({ name: '밥', email: null, guest: false }), '밥')
  assert.equal(approvedNotice('앤', 'edit'), '앤 님에게 편집 권한을 줬습니다.')
  assert.match(ignoredNotice('앤'), /알리지 않습니다/)
  assert.match(REQUEST_SENT, /인박스/)
})

test('★ 인박스 줄 — 요청의 지금 상태 · 이름이 없으면 누구인지 말하지 않는다 · 요청이 아니면 null', () => {
  assert.equal(accessInboxLine('access_requested', { requesterName: '앤', status: 'pending' }), '앤 님이 접근을 요청했습니다 — 공유에서 처리하세요')
  assert.match(accessInboxLine('access_requested', { requesterName: '앤', status: 'approved' }) ?? '', /허락됨$/)
  assert.match(accessInboxLine('access_requested', { requesterName: '앤', status: 'ignored' }) ?? '', /무시함$/)
  assert.equal(accessInboxLine('access_requested', { requesterName: null, status: 'pending' }), '접근 요청이 왔습니다 — 공유에서 처리하세요')
  assert.equal(accessInboxLine('access_granted', null), '요청한 권한을 받았습니다.')
  assert.equal(accessInboxLine('comment', null), null)
})

test('★ (7e-2) 편집 요청 — 인박스 줄 · 요청 줄의 종류 · 허락의 기본 레벨은 요청한 레벨(게스트도 편집까지는 고른다)', () => {
  assert.equal(
    accessInboxLine('access_requested', { requesterName: '앤', status: 'pending', kind: 'edit_access' }),
    '앤 님이 편집 권한을 요청했습니다 — 공유에서 처리하세요',
  )
  assert.equal(accessInboxLine('access_requested', { requesterName: null, status: 'pending', kind: 'edit_access' }), '편집 권한 요청이 왔습니다 — 공유에서 처리하세요')
  assert.equal(requestKindLabel('edit_access'), '편집 요청')
  assert.equal(requestKindLabel('page_access'), '접근 요청')
  assert.equal(defaultApproveLevel(approveLevelOptions(false), 'edit'), 'edit')
  assert.equal(defaultApproveLevel(approveLevelOptions(true), 'edit'), 'edit')
  assert.equal(defaultApproveLevel(approveLevelOptions(false), null), 'view')
  assert.equal(defaultApproveLevel(approveLevelOptions(true), 'full_access'), 'view', '고를 수 없는 레벨이면 가장 좁은 것')
  assert.match(EDIT_REQUEST_SENT, /편집 권한을 요청했습니다/)
})

test('인박스에서 요청을 누르면 공유 패널을 연 채로 · 나머지는 페이지로', () => {
  assert.equal(inboxHref('w', 'p', 'access_requested'), '/w/w/p?share=1')
  assert.equal(inboxHref('w', 'p', 'access_granted'), '/w/w/p')
  assert.equal(inboxHref('w', 'p', 'mention'), '/w/w/p')
})

test('거부 코드마다 할 말 · 모르는 코드는 일반 문구', () => {
  for (const code of ['not_found', 'forbidden', 'decided', 'invalid_level', 'guest_level', 'invalid_principal', 'has_access']) {
    assert.notEqual(accessRequestFailureMessage(code), '처리하지 못했습니다.', code)
  }
  assert.equal(accessRequestFailureMessage('something_new'), '처리하지 못했습니다.')
})
