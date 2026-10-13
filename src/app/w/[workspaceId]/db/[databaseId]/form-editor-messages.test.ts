/**
 * 폼 편집 화면의 문구 — 7a-3 (DOM · DB 없음)
 *
 *   ① 서버의 까닭마다 할 말 · 모르는 까닭 · 원형의 이름은 일반 문구
 *   ② 공개 주소의 모양
 *   ⑤ 한 사람당 한 번(7b-3) — 켰을 때의 말이 공유에 따라 다르다(막는 것은 워크스페이스 멤버만의 폼뿐)
 *   ⑥ 응답자에게 줄 권한(7b-4) — 넷(전체 권한 없음) · 고른 레벨의 말 · 웹 공개면 주지 않는다고
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { FormFailure } from '../../../../../lib/database/form.ts'
import {
  FORM_ACCESS_OPTIONS,
  ONE_PER_RESPONDENT_LABEL,
  RESPONDENT_ACCESS_OPTIONS,
  closedBecauseText,
  formAccessNotice,
  formAccessState,
  formEditorFailureMessage,
  formUrlOf,
  isoOfLocalDateTime,
  limitOfDraft,
  localDateTimeOf,
  onePerRespondentNote,
  respondentAccessNote,
  responseCountText,
} from './form-editor-messages.ts'

test('① 까닭마다 할 말 · 모르는 까닭 · 원형의 이름', () => {
  const reasons: FormFailure[] = ['not_found', 'forbidden', 'locked', 'invalid_input', 'unsupported_type', 'policy_disabled']
  for (const reason of reasons) assert.notEqual(formEditorFailureMessage(reason), '저장하지 못했습니다.', reason)
  assert.equal(formEditorFailureMessage('constructor'), '저장하지 못했습니다.')
  assert.equal(formEditorFailureMessage(undefined), '저장하지 못했습니다.')
})

test('② 공개 주소', () => {
  assert.equal(formUrlOf('https://example.com/', 'abc'), 'https://example.com/f/abc')
})

test('③ 공유의 셋(7b-1) — 순서 · 바꾼 뒤의 말 · 바꿀 수 없는 사람에게 보이는 상태(닫혔으면 없다)', () => {
  assert.deepEqual(FORM_ACCESS_OPTIONS.map((o) => o.access), ['closed', 'workspace', 'public'])
  const notices = FORM_ACCESS_OPTIONS.map((o) => formAccessNotice(o.access))
  assert.equal(new Set(notices).size, 3)
  assert.equal(formAccessState('closed'), null)
  assert.notEqual(formAccessState('workspace'), formAccessState('public'))
  assert.match(FORM_ACCESS_OPTIONS.find((o) => o.access === 'workspace')!.hint, /게스트/)
})

test('④ 응답 받기(7b-2) — 받은 수 · 닫힌 까닭 · 상한 칸 · 마감 시각 칸(이 브라우저의 시간대로 왕복)', () => {
  assert.equal(responseCountText(3, null), '받은 응답 3개')
  assert.equal(responseCountText(3, 10), '받은 응답 3개 / 상한 10개')
  assert.notEqual(closedBecauseText('limit'), closedBecauseText('time'))
  assert.equal(limitOfDraft(null), null)
  assert.equal(limitOfDraft('  '), null)
  assert.equal(limitOfDraft(' 25 '), 25)
  for (const bad of ['0', '1.5', '100001', 'many']) assert.equal(limitOfDraft(bad), undefined, bad)
  const iso = '2026-11-01T00:00:00.000Z'
  assert.equal(isoOfLocalDateTime(localDateTimeOf(iso)), iso, '분 단위 시각은 왕복한다')
  assert.equal(localDateTimeOf(null), '')
  assert.equal(isoOfLocalDateTime(''), null)
  assert.equal(isoOfLocalDateTime('2026-11-01'), undefined)
})

test('⑤ 한 사람당 한 번(7b-3) — 워크스페이스 멤버만이면 무엇이 보이는지 · 아니면 막지 않는다고', () => {
  assert.equal(ONE_PER_RESPONDENT_LABEL, '한 사람당 한 번만 받기')
  assert.match(onePerRespondentNote('workspace'), /이미 응답했습니다/)
  assert.match(onePerRespondentNote('public'), /워크스페이스 멤버만의 폼에서만/)
  assert.equal(onePerRespondentNote('closed'), onePerRespondentNote('public'), '닫힌 폼도 — 열 때 무엇을 고르느냐에 달렸다')
})

test('⑥ 응답자에게 줄 권한(7b-4) — 넷 · 고른 레벨의 말 · 웹 공개면 주지 않는다고', () => {
  assert.deepEqual(RESPONDENT_ACCESS_OPTIONS.map((o) => o.value), ['', 'view', 'comment', 'edit'], '전체 권한은 없다')
  assert.equal(respondentAccessNote('workspace', null), null)
  assert.equal(respondentAccessNote('workspace', 'full_access'), null, '모르는 레벨은 말하지 않는다')
  assert.match(respondentAccessNote('workspace', 'comment')!, /댓글 권한으로 줍니다/)
  assert.match(respondentAccessNote('workspace', 'view')!, /이미 준 권한은 그대로/)
  assert.match(respondentAccessNote('public', 'edit')!, /익명이라 줄 사람이 없습니다/)
  assert.equal(respondentAccessNote('closed', 'edit'), respondentAccessNote('public', 'edit'))
})
