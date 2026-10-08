/**
 * 갤러리 레이아웃 — 읽기 · 검증 · 합치기 (DB 심화 2f-2조각 · F-04-05 · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 읽기는 너그럽다 — 없거나 모르는 값은 그 키만 기본값
 *   ② 바꿀 키만 받는다 — 모르는 키 · 값 · 빈 객체는 거부
 *   ③ 합치기 — 바꾼 키만 바뀐다
 *   ④ 목록이 저장 CHECK(0057)과 같다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DEFAULT_GALLERY_LAYOUT,
  GALLERY_ASPECTS,
  GALLERY_COVERS,
  GALLERY_SIZES,
  mergeGalleryLayout,
  readGalleryLayout,
  validateGalleryPatch,
} from './gallery.ts'

describe('① 읽기', () => {
  test('없으면 기본값 · 모르는 값은 그 키만 기본값', () => {
    assert.deepEqual(readGalleryLayout({}), DEFAULT_GALLERY_LAYOUT)
    assert.deepEqual(readGalleryLayout(null), DEFAULT_GALLERY_LAYOUT)
    assert.deepEqual(readGalleryLayout({ gallery: { cover: 'none', cover_size: 'huge' } }), {
      cover: 'none',
      cover_size: DEFAULT_GALLERY_LAYOUT.cover_size,
      cover_aspect: DEFAULT_GALLERY_LAYOUT.cover_aspect,
    })
  })
})

describe('② 검증', () => {
  test('바꿀 키만 · 모르는 키 · 값 · 빈 객체는 거부', () => {
    assert.deepEqual(validateGalleryPatch({ cover_size: 'large' }), [])
    assert.deepEqual(validateGalleryPatch({ cover: 'none', cover_aspect: 'contain' }), [])
    assert.equal(validateGalleryPatch({ cover: 'page_cover' })[0]?.path, 'gallery.cover')
    assert.equal(validateGalleryPatch({ color: 'red' })[0]?.path, 'gallery.color')
    assert.equal(validateGalleryPatch({}).length, 1)
    assert.equal(validateGalleryPatch([]).length, 1)
    assert.equal(validateGalleryPatch(null).length, 1)
  })
})

describe('③ 합치기', () => {
  test('바꾼 키만 바뀐다', () => {
    assert.deepEqual(mergeGalleryLayout(DEFAULT_GALLERY_LAYOUT, { cover_size: 'small' }), { ...DEFAULT_GALLERY_LAYOUT, cover_size: 'small' })
  })
})

describe('④ 저장 CHECK 과 같은 목록', () => {
  test('0057 의 값들과 같다', () => {
    const sql = readFileSync(new URL('../../../db/migrations/0057_gallery_layout.sql', import.meta.url), 'utf8')
    const listOf = (key: string) => {
      const m = sql.match(new RegExp(`'${key}'\\) IN \\(([^)]*)\\)`))
      assert.ok(m, key)
      return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
    }
    assert.deepEqual(listOf('cover'), [...GALLERY_COVERS].sort())
    assert.deepEqual(listOf('cover_size'), [...GALLERY_SIZES].sort())
    assert.deepEqual(listOf('cover_aspect'), [...GALLERY_ASPECTS].sort())
  })
})
