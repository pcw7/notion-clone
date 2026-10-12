/**
 * 폼 편집 화면의 문구 — 7a-3 (DOM · DB 없음)
 *
 *   ① 서버의 까닭마다 할 말 · 모르는 까닭 · 원형의 이름은 일반 문구
 *   ② 공개 주소의 모양
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { FormFailure } from '../../../../../lib/database/form.ts'
import { formEditorFailureMessage, formUrlOf } from './form-editor-messages.ts'

test('① 까닭마다 할 말 · 모르는 까닭 · 원형의 이름', () => {
  const reasons: FormFailure[] = ['not_found', 'forbidden', 'locked', 'invalid_input', 'unsupported_type', 'policy_disabled']
  for (const reason of reasons) assert.notEqual(formEditorFailureMessage(reason), '저장하지 못했습니다.', reason)
  assert.equal(formEditorFailureMessage('constructor'), '저장하지 못했습니다.')
  assert.equal(formEditorFailureMessage(undefined), '저장하지 못했습니다.')
})

test('② 공개 주소', () => {
  assert.equal(formUrlOf('https://example.com/', 'abc'), 'https://example.com/f/abc')
})
