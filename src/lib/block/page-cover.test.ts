// 페이지 커버의 순수 함수(34번 트랙 PC-1 · F-02-06 · 정본 §3.4 [보강 PC-1]).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  COVER_FALLBACK_BACKGROUND,
  COVER_GALLERY,
  coverBackground,
  coverOverflow,
  coverPositionOfFormat,
  dragCoverPosition,
  isRepositionable,
  parseCoverPosition,
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

describe('위치(PC-3) — 0~1 · 끌기', () => {
  test('★ 받기는 0~1 의 유한한 수(넷째 자리) · 읽기는 관대하게(아니면 가운데) · 그림 커버만 위치가 있다', () => {
    assert.equal(parseCoverPosition(0.123456), 0.1235)
    assert.equal(parseCoverPosition(0), 0)
    assert.equal(parseCoverPosition(1), 1)
    for (const bad of [-0.01, 1.01, Number.NaN, Infinity, '0.5', null]) assert.equal(parseCoverPosition(bad), undefined, String(bad))
    assert.equal(coverPositionOfFormat({ page_cover_position: 0.2 }), 0.2)
    assert.equal(coverPositionOfFormat({ page_cover_position: 7 }), 0.5)
    assert.equal(coverPositionOfFormat(null), 0.5)
    assert.equal(isRepositionable({ type: 'external', url: 'https://e.com/a.png' }), true)
    assert.equal(isRepositionable({ type: 'file', file_id: FILE }), true)
    assert.equal(isRepositionable({ type: 'gallery', gallery: 'solid_red' }), false)
    assert.equal(isRepositionable(null), false)
  })

  test('넘치는 높이 · 끌기 — 아래로 끌면 위가 드러난다(위치가 준다) · 0~1 로 자른다 · 넘치지 않으면 그대로', () => {
    // 1000×2000 그림을 폭 1000 · 높이 280 배너에 — 가로를 채우면 높이 2000 · 넘치는 1720
    assert.equal(coverOverflow(1000, 2000, 1000, 280), 1720)
    // 납작한 그림 — 세로를 채우고 가로가 넘친다 · 세로로 옮길 것이 없다
    assert.equal(coverOverflow(4000, 500, 1000, 280), 0)
    assert.equal(coverOverflow(0, 0, 1000, 280), 0)
    assert.equal(dragCoverPosition(0.5, 172, 1720), 0.4)
    assert.equal(dragCoverPosition(0.5, -172, 1720), 0.6)
    assert.equal(dragCoverPosition(0.1, 10_000, 1720), 0)
    assert.equal(dragCoverPosition(0.9, -10_000, 1720), 1)
    assert.equal(dragCoverPosition(0.3, 50, 0), 0.3)
  })
})
