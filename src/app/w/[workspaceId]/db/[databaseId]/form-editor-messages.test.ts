/**
 * 폼 편집 화면의 문구 — 7a-3 (DOM · DB 없음)
 *
 *   ① 서버의 까닭마다 할 말 · 모르는 까닭 · 원형의 이름은 일반 문구
 *   ② 공개 주소의 모양
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { FormFailure } from '../../../../../lib/database/form.ts'
import {
  FORM_ACCESS_OPTIONS,
  closedBecauseText,
  formAccessNotice,
  formAccessState,
  formEditorFailureMessage,
  formUrlOf,
  isoOfLocalDateTime,
  limitOfDraft,
  localDateTimeOf,
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
