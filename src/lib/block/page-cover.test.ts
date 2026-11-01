// 페이지 커버의 순수 함수(34번 트랙 PC-1 · F-02-06 · 정본 §3.4 [보강 PC-1]).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  COVER_FALLBACK_BACKGROUND,
  COVER_GALLERY,
  coverBackground,
  pageCoverJson,
  pageCoverKey,
  pageCoverOfFormat,
  parsePageCoverInput,
  randomGalleryCover,
  readPageCover,
  samePageCover,
} from './page-cover.ts'

const FILE = '11111111-1111-4111-8111-111111111111'

describe('받기(parsePageCoverInput) — 라우트와 명령이 같은 규칙', () => {
  test('★ 내장 커버는 지금 표에 있는 id 만 · 외부 주소는 http(s) · 공백을 벗긴다 · null 은 지우기', () => {
    assert.deepEqual(parsePageCoverInput({ type: 'gallery', gallery: 'gradient_3' }), { type: 'gallery', gallery: 'gradient_3' })
    assert.equal(parsePageCoverInput({ type: 'gallery', gallery: 'gradient_99' }), undefined, '표에 없는 id')
    assert.deepEqual(parsePageCoverInput({ type: 'external', url: '  https://example.com/c.png  ' }), { type: 'external', url: 'https://example.com/c.png' })
    assert.equal(parsePageCoverInput(null), null)
  })

  test('모양이 아니면 undefined — javascript: · 상대 주소 · 공백 · 긴 주소 · 모르는 종류 · 배열', () => {
    for (const bad of [
      { type: 'external', url: 'javascript:alert(1)' },
      { type: 'external', url: '/a.png' },
      { type: 'external', url: 'https://example.com/a b.png' },
      { type: 'external', url: `https://example.com/${'a'.repeat(2048)}` },
      { type: 'emoji', emoji: '🌱' },
      { type: 'file', file_id: 'nope' },
      [],
      'gradient_1',
    ]) {
      assert.equal(parsePageCoverInput(bad), undefined, JSON.stringify(bad))
    }
    assert.deepEqual(parsePageCoverInput({ type: 'file', file_id: FILE.toUpperCase() }), { type: 'file', file_id: FILE }, '파일 id 는 소문자로')
  })
})

describe('읽기(readPageCover) — 관대하게', () => {
  test('★ 표에서 빠진 내장 커버도 커버다(회색 판으로 그린다) · 모양이 아니면 없는 것', () => {
    assert.deepEqual(readPageCover({ type: 'gallery', gallery: 'retired_one' }), { type: 'gallery', gallery: 'retired_one' })
    assert.equal(coverBackground({ type: 'gallery', gallery: 'retired_one' }), COVER_FALLBACK_BACKGROUND)
    assert.equal(readPageCover({ type: 'gallery', gallery: 'Has Space' }), null)
    assert.equal(readPageCover('gradient_1'), null)
    assert.deepEqual(pageCoverOfFormat({ page_icon: { type: 'emoji', emoji: '🌱' }, page_cover: { type: 'gallery', gallery: 'solid_red' } }), {
      type: 'gallery',
      gallery: 'solid_red',
    })
    assert.equal(pageCoverOfFormat(null), null)
  })
})

describe('같은가 · 저장 모양 · 무작위', () => {
  test('같은 커버는 같다 · 저장할 JSON 은 정해진 키만', () => {
    assert.equal(samePageCover({ type: 'gallery', gallery: 'solid_red' }, { type: 'gallery', gallery: 'solid_red' }), true)
    assert.equal(samePageCover({ type: 'gallery', gallery: 'solid_red' }, null), false)
    assert.equal(samePageCover(null, null), true)
    assert.equal(pageCoverKey({ type: 'external', url: 'https://e.com/a.png' }), 'external:https://e.com/a.png')
    const sneaky = { type: 'gallery', gallery: 'solid_red', extra: 1 } as unknown as Parameters<typeof pageCoverJson>[0]
    assert.deepEqual(pageCoverJson(sneaky), { type: 'gallery', gallery: 'solid_red' })
  })

  test('무작위 커버는 표에 있는 것 · 지금 커버는 고르지 않는다', () => {
    assert.equal(COVER_GALLERY.length, 12)
    assert.equal(new Set(COVER_GALLERY.map((e) => e.id)).size, 12, 'id 가 겹치지 않는다')
    for (let i = 0; i < 50; i += 1) {
      const cover = randomGalleryCover('solid_red')
      assert.ok(COVER_GALLERY.some((e) => e.id === cover.gallery))
      assert.notEqual(cover.gallery, 'solid_red')
    }
    assert.equal(randomGalleryCover(null, () => 0.999999).gallery, COVER_GALLERY[COVER_GALLERY.length - 1]?.id)
  })
})
