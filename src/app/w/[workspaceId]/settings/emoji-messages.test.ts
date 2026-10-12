/**
 * 설정의 이모지 절 — 문구 · 올리기 전 검사 (인접 제품 7c-2b · F-13-16 · 순수)
 *
 * 이 파일이 지키는 것(정본 §3.4 [보강] 커스텀 이모지 ⑥).
 *
 *   ① 거부 코드마다 말이 있다 · 권한의 말은 무엇을 하다 막혔는가에 따라 다르다 · 모르는 코드는 일반 문장
 *   ② ★ 올리기 전 — 이미지 형식 · 빈 파일 · 1MB(경계 포함)를 파일보다 먼저 거른다 · 이름은 받는 모양으로 바꾸거나 말한다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_EMOJI_BYTES } from '../../../../lib/emoji/custom-emoji-rules.ts'
import { emojiFailureMessage, emojiFileProblem, emojiNameOrProblem } from './emoji-messages.ts'

describe('① 거부 코드의 말', () => {
  test('코드마다 다른 말 · 권한은 올리기와 바꾸기가 다르다 · 모르는 코드는 일반 문장', () => {
    const codes = ['invalid_name', 'duplicate_name', 'too_many', 'invalid_file', 'too_large', 'not_found']
    const said = codes.map((code) => emojiFailureMessage(code, 'create'))
    assert.equal(new Set(said).size, codes.length, JSON.stringify(said))
    assert.ok(said.every((m) => m !== emojiFailureMessage('???', 'create')))
    assert.match(emojiFailureMessage('too_many', 'create'), /500/)
    assert.match(emojiFailureMessage('too_large', 'create'), /1MB/)
    assert.notEqual(emojiFailureMessage('forbidden', 'create'), emojiFailureMessage('forbidden', 'manage'))
    assert.equal(emojiFailureMessage(undefined, 'manage'), '이모지를 저장하지 못했습니다.')
  })
})

describe('② ★ 올리기 전', () => {
  test('이미지 형식 · 빈 파일 · 1MB — 경계까지는 받는다', () => {
    assert.equal(emojiFileProblem({ type: 'image/png', size: MAX_EMOJI_BYTES }), null)
    assert.equal(emojiFileProblem({ type: 'image/webp', size: 10 }), null)
    assert.match(emojiFileProblem({ type: 'image/png', size: MAX_EMOJI_BYTES + 1 }) ?? '', /1MB/)
    assert.match(emojiFileProblem({ type: 'image/svg+xml', size: 10 }) ?? '', /PNG/)
    assert.match(emojiFileProblem({ type: '', size: 10 }) ?? '', /PNG/)
    assert.match(emojiFileProblem({ type: 'image/gif', size: 0 }) ?? '', /빈 파일/)
  })

  test('이름 — 받는 모양으로 바꾸거나(소문자 · 양 끝의 :) 이름의 규칙을 말한다', () => {
    assert.deepEqual(emojiNameOrProblem(' :Party: '), { name: 'party' })
    const bad = emojiNameOrProblem('has space')
    assert.ok('problem' in bad && bad.problem === emojiFailureMessage('invalid_name', 'create'))
  })
})
