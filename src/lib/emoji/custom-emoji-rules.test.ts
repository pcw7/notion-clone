/**
 * 커스텀 이모지의 규칙 — 인접 제품 7c-2b조각 (F-13-16 · 순수)
 *
 * 이 파일이 지키는 것(정본 §3.4 [보강] 커스텀 이모지 ① · ⑥).
 *
 *   ① 이름 받기 — 앞뒤 공백 · 양 끝의 `:` 를 걷고 소문자로 · 모양이 아니면 null
 *   ② ★ 파일 이름에서 이름 제안 — 확장자를 떼고 소문자로 · 받을 수 없는 글자는 하이픈 하나 · 40자 · 비면 `emoji` · **늘 받는 모양이다**
 *   ③ ★ 이름으로 찾기 — 앞에서 맞는 것 먼저 · 부분 일치 · `:` · 대소문자 · 앞뒤 공백 무시 · 빈 검색어면 그대로
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { EMOJI_NAME_PATTERN, MAX_EMOJI_NAME_LENGTH, normalizeEmojiName, searchCustomEmoji, suggestEmojiName } from './custom-emoji-rules.ts'

describe('① 이름 받기', () => {
  test('앞뒤 공백 · 양 끝의 : 를 걷고 소문자로 · 모양이 아니면 null', () => {
    assert.equal(normalizeEmojiName('  :Party_Parrot-2:  '), 'party_parrot-2')
    assert.equal(normalizeEmojiName('x'.repeat(MAX_EMOJI_NAME_LENGTH)), 'x'.repeat(MAX_EMOJI_NAME_LENGTH))
    for (const bad of ['', '::', 'has space', '한글', 'a.b', 'x'.repeat(MAX_EMOJI_NAME_LENGTH + 1), 7, null, undefined]) {
      assert.equal(normalizeEmojiName(bad), null, JSON.stringify(bad))
    }
  })
})

describe('② ★ 파일 이름에서 이름 제안', () => {
  test('확장자를 떼고 소문자로 · 받을 수 없는 글자의 덩어리는 하이픈 하나 · 양 끝 하이픈은 걷는다', () => {
    assert.equal(suggestEmojiName('Party Parrot.PNG'), 'party-parrot')
    assert.equal(suggestEmojiName('my_emoji-1.webp'), 'my_emoji-1')
    assert.equal(suggestEmojiName('a.b.c.gif'), 'a-b-c')
    assert.equal(suggestEmojiName('  --cool!!  cat--.jpeg'), 'cool-cat')
    assert.equal(suggestEmojiName('no-extension'), 'no-extension')
    assert.equal(suggestEmojiName('고양이 cat.png'), 'cat')
  })

  test('남는 것이 없으면 emoji · 40자로 자르고 잘린 끝의 하이픈도 걷는다', () => {
    assert.equal(suggestEmojiName('고양이.png'), 'emoji')
    assert.equal(suggestEmojiName('.png'), 'emoji')
    assert.equal(suggestEmojiName(''), 'emoji')
    assert.equal(suggestEmojiName(`${'a'.repeat(50)}.png`), 'a'.repeat(MAX_EMOJI_NAME_LENGTH))
    assert.equal(suggestEmojiName(`${'a'.repeat(39)} b.png`), 'a'.repeat(39), '40번째가 하이픈이면 걷는다')
  })

  test('★ 제안은 늘 받는 모양이다 — 저장하기 전에 다시 고칠 일이 없다', () => {
    for (const name of ['Party Parrot.PNG', '고양이.png', '.png', `${'a'.repeat(39)} b.png`, '😀 smile.gif', 'A__B--C.png', '-_-.png']) {
      const suggested = suggestEmojiName(name)
      assert.ok(EMOJI_NAME_PATTERN.test(suggested), `${name} → ${suggested}`)
      assert.equal(normalizeEmojiName(suggested), suggested)
    }
  })
})

describe('③ ★ 이름으로 찾기', () => {
  // `apart` 는 이름 순으로 앞이지만 가운데서 맞는다 — 앞에서 맞는 것이 먼저인지를 가린다.
  const list = [{ name: 'cat' }, { name: 'party' }, { name: 'sparkle' }, { name: 'apart' }, { name: 'party-parrot' }].sort((a, b) => (a.name < b.name ? -1 : 1))

  test('앞에서 맞는 것 먼저 · 그다음 가운데서 맞는 것 · 목록의 순서를 지킨다', () => {
    assert.deepEqual(searchCustomEmoji(list, 'par').map((e) => e.name), ['party', 'party-parrot', 'apart', 'sparkle'])
    assert.deepEqual(searchCustomEmoji(list, 'rot').map((e) => e.name), ['party-parrot'])
  })

  test(': · 대소문자 · 앞뒤 공백을 무시한다 · 빈 검색어면 그대로 · 맞는 것이 없으면 빈 목록', () => {
    assert.deepEqual(searchCustomEmoji(list, ' :CAT: ').map((e) => e.name), ['cat'])
    assert.deepEqual(searchCustomEmoji(list, '  ').map((e) => e.name), list.map((e) => e.name))
    assert.deepEqual(searchCustomEmoji(list, '::'), list)
    assert.deepEqual(searchCustomEmoji(list, 'dog'), [])
  })
})
