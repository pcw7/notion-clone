/**
 * 이모지 고르개의 목록 · 검색 · 무작위 — 잔여 묶음 8c-1 (F-02-05 · 순수 · 실제 데이터 `emojibase-data` 한국어 판)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 고르개가 보여 주는 것은 **서버가 모두 받는다**(`isSingleEmoji` — 데이터 전체로) · 구성 요소 · 지역 지표 · Emoji 15.0 보다
 *      새것은 없다 · 그룹 순서 · 빈 그룹 없음
 *   ② ★ 검색 — 한국어 이름 · 태그 · 이모지 글자 · 띄어쓰기 무시 · 순서(같은 이름 → 시작 → 포함 → 태그)
 *   ③ ★ 무작위 — 깃발은 뽑지 않는다(Windows 는 국기를 두 글자로 그린다) · 지금 아이콘은 고르지 않는다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { isSingleEmoji } from '../contracts/emoji.ts'
import { buildEmojiCatalog, EMOJI_GROUP_LABELS, FLAGS_GROUP, MAX_EMOJI_VERSION, randomEmoji, searchEmoji, type RawEmoji } from './catalog.ts'

const raw = createRequire(import.meta.url)('emojibase-data/ko/data.json') as RawEmoji[]
const catalog = buildEmojiCatalog(raw)
const emojis = (list: readonly { emoji: string }[]) => list.map((e) => e.emoji)

describe('① 목록', () => {
  test('★ 고르개에 들 후보를 서버가 모두 받는다 — 거르기(`isSingleEmoji`)가 숨기는 것이 없다', () => {
    // 목록은 이미 그 규칙으로 걸렀으므로 목록을 보면 늘 참이다 — 거르기 **전의** 후보(그룹 · 버전만 본 것)를 본다.
    const candidates = raw.filter((e) => e.group !== undefined && EMOJI_GROUP_LABELS.has(e.group) && e.version <= MAX_EMOJI_VERSION)
    assert.deepEqual(candidates.filter((e) => !isSingleEmoji(e.emoji)).map((e) => e.emoji), [])
    assert.equal(catalog.all.length, candidates.length)
    assert.ok(catalog.all.length > 1800, String(catalog.all.length))
  })

  test('★ 구성 요소 · 지역 지표 · 새 버전은 없다 — 그룹은 정한 순서 · 빈 그룹 없음 · 같은 이모지 두 번 없음', () => {
    const versionOf = new Map(raw.map((e) => [e.emoji, e.version]))
    assert.ok(catalog.all.every((e) => (versionOf.get(e.emoji) ?? 99) <= MAX_EMOJI_VERSION))
    assert.ok(raw.some((e) => e.version > MAX_EMOJI_VERSION), '전제 — 데이터에 새 버전이 있다')
    for (const hidden of ['🏻', '🦰', '🇦']) assert.ok(!emojis(catalog.all).includes(hidden), hidden)
    assert.deepEqual(catalog.groups.map((g) => g.id), [...EMOJI_GROUP_LABELS.keys()])
    assert.ok(catalog.groups.every((g) => g.entries.length > 0))
    assert.equal(new Set(emojis(catalog.all)).size, catalog.all.length)
    assert.equal(catalog.all[0]?.emoji, '😀', '첫 그룹(웃는 얼굴)의 첫 이모지')
  })
})

describe('② 검색', () => {
  test('★ 한국어 이름 · 태그로 찾는다 — 이름이 같은 것이 맨 앞', () => {
    assert.equal(searchEmoji(catalog, '하트')[0]?.emoji, '♥️')
    assert.equal(searchEmoji(catalog, '빨간색 하트')[0]?.emoji, '❤️')
    assert.equal(searchEmoji(catalog, '빨간색하트')[0]?.emoji, '❤️', '띄어쓰기 무시')
    assert.equal(searchEmoji(catalog, '새싹')[0]?.emoji, '🌱')
    assert.ok(emojis(searchEmoji(catalog, '고양이')).includes('🐱'))
    assert.ok(emojis(searchEmoji(catalog, '행복')).includes('😀'), '태그(행복)로도')
    assert.equal(searchEmoji(catalog, '🌱')[0]?.emoji, '🌱', '이모지 글자 그대로')
  })

  test('★ 순서 — 같은 이름 · 이름이 시작 · 이름에 듦 · 태그에만', () => {
    const tiny = buildEmojiCatalog([
      { emoji: '😺', label: '웃는 고양이', tags: [], group: 0, order: 1, version: 1 },
      { emoji: '🐈', label: '고양이', tags: [], group: 3, order: 3, version: 1 },
      { emoji: '🐱', label: '고양이 얼굴', tags: [], group: 3, order: 2, version: 1 },
      { emoji: '🧶', label: '실', tags: ['고양이 장난감'], group: 7, order: 4, version: 1 },
      { emoji: '🐶', label: '강아지', tags: ['멍멍'], group: 3, order: 5, version: 1 },
    ])
    assert.deepEqual(emojis(searchEmoji(tiny, '고양이')), ['🐈', '🐱', '😺', '🧶'])
    assert.deepEqual(searchEmoji(tiny, '   '), [], '빈 검색어는 빈 결과(부르는 쪽이 그룹 목록을 보인다)')
    assert.deepEqual(searchEmoji(tiny, '없는 말'), [])
  })
})

describe('③ 무작위', () => {
  test('★ 깃발은 뽑지 않는다 — 목록의 처음부터 끝까지 훑어도', () => {
    assert.ok(catalog.all.some((e) => e.group === FLAGS_GROUP), '전제 — 고르개에는 깃발이 있다')
    const pool = catalog.all.filter((e) => e.group !== FLAGS_GROUP)
    const steps = catalog.all.length * 2
    for (let i = 0; i < steps; i += 1) {
      const picked = randomEmoji(catalog, null, () => i / steps)
      assert.ok(picked !== null && picked.group !== FLAGS_GROUP, `${i}: ${picked?.emoji}`)
    }
    assert.equal(randomEmoji(catalog, null, () => 0.999999)?.emoji, pool.at(-1)?.emoji)
  })

  test('지금 아이콘은 고르지 않는다 · 뽑을 것이 없으면 null', () => {
    const pool = catalog.all.filter((e) => e.group !== FLAGS_GROUP)
    const first = pool[0].emoji
    assert.equal(randomEmoji(catalog, null, () => 0)?.emoji, first)
    assert.equal(randomEmoji(catalog, first, () => 0)?.emoji, pool[1].emoji)
    const last = pool.at(-1)!.emoji
    assert.equal(randomEmoji(catalog, last, () => 0.999999)?.emoji, first, '마지막이 지금 아이콘이면 처음으로 돈다')
    assert.equal(randomEmoji({ groups: [], all: [] }), null)
    const onlyFlags = buildEmojiCatalog([{ emoji: '🇰🇷', label: '깃발: 대한민국', group: FLAGS_GROUP, order: 1, version: 2 }])
    assert.equal(randomEmoji(onlyFlags), null)
  })
})
