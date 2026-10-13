/**
 * 멘션이 그릴 글자 — 커스텀 이모지(인접 제품 7c-3a · F-13-16 · 순수 · DOM 없음)
 *
 * 이 파일이 지키는 것(정본 §3.4 [보강] 커스텀 이모지 ⑦).
 *
 *   ① 멘션 attr 에서 커스텀 이모지 id 를 꺼낸다(소문자로) · 사람 · 페이지 멘션은 아니다 · 사람 · 페이지 대상도 커스텀 이모지를 모른다
 *   ② ★ 글자로 그릴 때 — 이름을 알면 `:이름:`(지운 것도) · 이 워크스페이스에 없으면 "이모지" · 아직 모르면 `:…:`
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { customEmojiIdOf, customEmojiText, mentionTargetOf } from './mention-label.ts'

const ID = '0A1B2C3D-0000-4000-8000-00000000E0E0'

describe('① id 꺼내기', () => {
  test('커스텀 이모지 attr 이면 id(소문자) · 아니면 null · 사람 · 페이지 대상과 섞이지 않는다', () => {
    const attrs = { type: 'custom_emoji', custom_emoji: { id: ID } }
    assert.equal(customEmojiIdOf(attrs), ID.toLowerCase())
    assert.equal(mentionTargetOf(attrs), null)
    for (const other of [{ type: 'user', user: { id: ID } }, { type: 'custom_emoji' }, { type: 'custom_emoji', custom_emoji: { id: 7 } }, null, {}]) {
      assert.equal(customEmojiIdOf(other), null, JSON.stringify(other))
    }
  })
})

describe('② ★ 글자로 그릴 때', () => {
  test('이름을 알면 :이름: — 지운 것도 · 없으면 이모지 · 모르면 :…:', () => {
    assert.equal(customEmojiText({ name: 'party', deleted: false }), ':party:')
    assert.equal(customEmojiText({ name: 'gone', deleted: true }), ':gone:')
    assert.equal(customEmojiText(null), '이모지')
    assert.equal(customEmojiText(undefined), ':…:')
  })
})
