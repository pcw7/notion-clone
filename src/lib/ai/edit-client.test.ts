/**
 * AI 로 고치기의 편집기 쪽 — 상태 기계 · 요청의 몸 (AI-3 · F-10-02 · DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { askFailureMessage, askFailureOf } from './ask-client.ts'
import { editReducer, editRequestBody, initialEditState, type EditState } from './edit-client.ts'
import type { EditSelection } from './edit-prompt.ts'

const PAGE = '0b6f4f9e-8a2c-4c1d-9e57-3f1a2b3c4d5e'
const selection: EditSelection = { inline: true, blocks: [{ kind: 'paragraph', text: '고른 글', depth: 0, language: null, checked: false }] }

test('★ 상태 기계 — 메뉴 → 흐름 → 끝 · 이어서 다듬기는 지금 결과와 새 지시 · 다시는 같은 후속 지시 · 늦은 조각은 버린다', () => {
  let s: EditState = editReducer(initialEditState, { type: 'start' })
  assert.deepEqual([s.phase, s.seq, s.followUp], ['streaming', 1, null])
  assert.equal(editReducer(s, { type: 'start' }), s, '흐르는 동안의 시작은 무시')
  s = editReducer(s, { type: 'delta', seq: 1, text: '짧은 ' })
  s = editReducer(s, { type: 'delta', seq: 1, text: '글' })
  s = editReducer(s, { type: 'done', seq: 1, truncated: false, quota: null })
  assert.deepEqual([s.phase, s.answer], ['done', '짧은 글'])
  assert.equal(editReducer(s, { type: 'followUp', instruction: '  ' }), s, '빈 지시는 무시')
  s = editReducer(s, { type: 'followUp', instruction: ' 더 부드럽게 ' })
  assert.deepEqual([s.phase, s.seq, s.answer, s.followUp], ['streaming', 2, '', { result: '짧은 글', instruction: '더 부드럽게' }])
  assert.equal(editReducer(s, { type: 'delta', seq: 1, text: '늦은 조각' }).answer, '', '늦은 조각')
  s = editReducer(s, { type: 'failed', seq: 2, failure: { kind: 'busy', retryAfter: 3 } })
  s = editReducer(s, { type: 'retry' })
  assert.deepEqual([s.phase, s.seq, s.followUp?.instruction], ['streaming', 3, '더 부드럽게'], '다시는 같은 후속 지시')
  const limited = editReducer(s, { type: 'failed', seq: 3, failure: { kind: 'limit', limit: 'trial', resetsAt: null } })
  assert.equal(editReducer(limited, { type: 'retry' }), limited, '한도는 다시 할 수 없다')
})

test('요청의 몸 — 프리셋의 값만 싣는다 · 후속 지시는 있을 때만 · 고칠 수 없는 페이지의 거부 문구', () => {
  assert.deepEqual(editRequestBody(PAGE, { preset: 'shorter', tone: 'casual', language: 'en', instruction: 'x' }, selection, null), {
    feature: 'edit',
    pageId: PAGE,
    preset: 'shorter',
    selection,
  })
  assert.deepEqual(editRequestBody(PAGE, { preset: 'tone', tone: 'casual', language: null, instruction: null }, selection, { result: 'r', instruction: 'i' }), {
    feature: 'edit',
    pageId: PAGE,
    preset: 'tone',
    tone: 'casual',
    selection,
    followUp: { result: 'r', instruction: 'i' },
  })
  assert.equal(editRequestBody(PAGE, { preset: 'translate', tone: null, language: 'ja', instruction: null }, selection, null).language, 'ja')
  assert.equal(editRequestBody(PAGE, { preset: 'custom', tone: null, language: null, instruction: '존댓말로' }, selection, null).instruction, '존댓말로')
  assert.deepEqual(askFailureOf({ error: 'cannot_edit' }), { kind: 'cannot_edit' })
  assert.match(askFailureMessage({ kind: 'cannot_edit' }), /편집 권한/)
})
