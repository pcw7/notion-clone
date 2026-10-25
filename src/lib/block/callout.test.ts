import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { textRun } from '../contracts/rich-text.ts'
import {
  calloutEmojiOf,
  calloutGlyph,
  DEFAULT_CALLOUT_EMOJI,
  isCalloutIcon,
  liftCalloutIcon,
  splitLeadingEmoji,
  validateCalloutProperties,
  withCalloutIcon,
} from './callout.ts'

describe('콜아웃 아이콘 — 저장 모양 (디자인-4c · 정본 §3.4 [보강] 콜아웃 아이콘)', () => {
  it('이모지 한 글자 · type emoji · 다른 키 없음만 받는다', () => {
    assert.equal(isCalloutIcon({ type: 'emoji', emoji: '🔥' }), true)
    assert.equal(isCalloutIcon({ type: 'emoji', emoji: '👨‍👩‍👧' }), true, '가족도 한 글자')
    assert.equal(isCalloutIcon({ type: 'emoji', emoji: '🔥🔥' }), false, '두 글자')
    assert.equal(isCalloutIcon({ type: 'emoji', emoji: 'a' }), false, '글자는 이모지가 아니다')
    assert.equal(isCalloutIcon({ type: 'emoji', emoji: '🔥', extra: 1 }), false, '다른 키')
    assert.equal(isCalloutIcon({ type: 'file', file_id: 'x' }), false, 'v1 은 이모지만')
    assert.equal(isCalloutIcon('🔥'), false, '객체가 아니다')
    assert.equal(isCalloutIcon(null), false)
  })

  it('없거나 틀리면 화면은 기본 💡 — 저장된 것은 그대로', () => {
    assert.equal(calloutEmojiOf({}), null)
    assert.equal(calloutGlyph({}), DEFAULT_CALLOUT_EMOJI)
    assert.equal(calloutGlyph({ icon: { type: 'emoji', emoji: 'nope' } }), DEFAULT_CALLOUT_EMOJI)
    assert.equal(calloutGlyph({ icon: { type: 'emoji', emoji: '🌱' } }), '🌱')
    assert.equal(calloutGlyph(undefined), DEFAULT_CALLOUT_EMOJI)
  })
})

describe('콜아웃 아이콘 — 바꾸기', () => {
  it('고르면 키를 쓰고 · 같은 값이면 같은 객체 · 제거는 키를 지운다', () => {
    const base = { other: 1 }
    const set = withCalloutIcon(base, '🌱')
    assert.deepEqual(set, { other: 1, icon: { type: 'emoji', emoji: '🌱' } })
    assert.equal(withCalloutIcon(set, '🌱'), set, '같은 값이면 쓰지 않는다')
    assert.deepEqual(withCalloutIcon(set, null), { other: 1 })
    assert.equal(withCalloutIcon(base, null), base, '없는 것을 지우면 그대로')
  })

  it('틀린 저장값은 제거로 지운다 · 이모지가 아닌 값은 던진다', () => {
    assert.deepEqual(withCalloutIcon({ icon: 'broken' }, null), {})
    assert.throws(() => withCalloutIcon({}, 'abc'))
  })
})

describe('콜아웃 아이콘 — 검증 · 가져오기', () => {
  it('validateDoc — 있으면 모양이 맞아야 한다 · 없으면 통과', () => {
    assert.deepEqual(validateCalloutProperties({}, 'blocks[0].properties'), [])
    assert.deepEqual(validateCalloutProperties({ icon: { type: 'emoji', emoji: '💡' } }, 'p'), [])
    const issues = validateCalloutProperties({ icon: { type: 'emoji', emoji: 'x' } }, 'blocks[0].properties')
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.path, 'blocks[0].properties.icon')
  })

  it('첫 줄의 이모지 한 글자 + 공백만 아이콘이다', () => {
    assert.deepEqual(splitLeadingEmoji('💡 알아 두기'), { emoji: '💡', rest: '알아 두기' })
    assert.deepEqual(splitLeadingEmoji('🇰🇷 국기'), { emoji: '🇰🇷', rest: '국기' })
    assert.equal(splitLeadingEmoji('💡알아 두기'), null, '공백이 없다')
    assert.equal(splitLeadingEmoji('알아 두기'), null)
    assert.equal(splitLeadingEmoji(' 💡 앞 공백'), null)
    assert.equal(splitLeadingEmoji('💡💡 둘'), null)
    assert.deepEqual(splitLeadingEmoji('💡'), { emoji: '💡', rest: '' }, '글이 빈 콜아웃')
  })

  it('제목의 첫 런에서 떼어 낸다 — 링크 · 서식 있는 런의 나머지는 그대로', () => {
    const lifted = liftCalloutIcon([textRun('🌱 새싹'), textRun('굵게', { bold: true })])
    assert.equal(lifted.emoji, '🌱')
    assert.deepEqual(lifted.title.map((r) => r.plain_text), ['새싹', '굵게'])
    assert.equal(lifted.title[0]?.text?.content, '새싹')
    assert.deepEqual(liftCalloutIcon([textRun('💡')]).title, [], '이모지뿐이면 런을 뺀다')
    const linked = { ...textRun('🌱 링크'), text: { content: '🌱 링크', link: { url: 'https://example.com' } } }
    assert.equal(liftCalloutIcon([linked]).emoji, null, '링크 런은 떼지 않는다')
    assert.equal(liftCalloutIcon([textRun('그냥 글')]).emoji, null)
    assert.equal(liftCalloutIcon([]).emoji, null)
  })
})
