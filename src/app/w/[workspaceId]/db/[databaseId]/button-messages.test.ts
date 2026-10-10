/**
 * 버튼 속성의 글자 (5a-3 · F-03-15)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buttonActionProblemMessage, buttonDisabledMessage, buttonRunMessage } from './button-messages.ts'

test('★ 실행 결과 한 줄 — 완료 · 할 일 없음 · 일부 건너뜀 · 실패와 까닭 · 거절', () => {
  assert.deepEqual(buttonRunMessage({ status: 'success', steps: [{ status: 'done' }] }), { text: '완료', tone: 'ok' })
  assert.equal(buttonRunMessage({ status: 'success', steps: [] }).tone, 'warn')
  assert.deepEqual(buttonRunMessage({ status: 'partial', steps: [{ status: 'done' }, { status: 'skipped', reason: 'locked' }] }), {
    text: '일부를 건너뛰었습니다 — 1개(권한 · 잠금)',
    tone: 'warn',
  })
  assert.deepEqual(buttonRunMessage({ status: 'failed', steps: [{ status: 'done' }, { status: 'failed', reason: 'unknown_property' }] }), {
    text: '실행하지 못했습니다 — 고칠 속성이 사라졌습니다. 아무것도 바뀌지 않았습니다.',
    tone: 'error',
  })
  assert.equal(buttonRunMessage(null, 'forbidden').text, '이 표의 값을 고칠 권한이 없습니다.')
  assert.equal(buttonRunMessage(null, '모름').text, '실행하지 못했습니다.')
})

test('버튼 설정의 거절 — 몇 번째 액션의 무엇', () => {
  assert.equal(buttonActionProblemMessage('invalid_value', 1), '2번째 액션: 값이 그 속성에 맞지 않습니다.')
  assert.equal(buttonActionProblemMessage('invalid', undefined), '액션의 모양이 맞지 않습니다.')
  assert.equal(buttonActionProblemMessage(undefined, undefined), '버튼을 저장하지 못했습니다.')
})

test('★ 웹훅 액션의 거절 — 주소 · 헤더 · 다섯 개 · 옮길 것 없음 · 요금제(몇 번째 액션인지)', () => {
  assert.equal(buttonActionProblemMessage('plan_required', 1), '2번째 액션: 이 요금제에서는 웹훅을 보낼 수 없습니다.')
  for (const problem of ['invalid_url', 'invalid_header', 'too_many_webhooks', 'unknown_ref', 'invalid_dynamic', 'invalid_blocks', 'unsupported_here']) {
    const text = buttonActionProblemMessage(problem, 0)
    assert.ok(text.startsWith('1번째 액션: ') && !text.includes('저장하지 못했습니다'), `${problem} — ${text}`)
  }
})

test('꺼진 버튼의 까닭 — 웹훅 실패 · 사람이 끔 · 모르는 까닭', () => {
  assert.match(buttonDisabledMessage('webhook_failed'), /웹훅을 네 번 보내지 못해/)
  assert.equal(buttonDisabledMessage(null), '꺼진 버튼입니다.')
  assert.equal(buttonDisabledMessage('tired'), '꺼진 버튼입니다.')
})
