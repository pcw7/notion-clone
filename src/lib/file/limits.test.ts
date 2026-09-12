/**
 * 업로드 한도 — F-12-09 / F-09-08
 *
 * 한도는 하나가 아니라 4개 축이고(저장·렌더·임포트·전송), 여기서 거는 것은 **저장**
 * 축이다. 그 구분을 잃으면 "5GB 라면서 왜 5MB 에서 막히나"가 된다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  ALLOWED_IMAGE_MIME,
  MAX_FILENAME_BYTES,
  MAX_UPLOAD_BYTES,
  extensionFor,
  isAllowedMime,
  storageKeyFor,
  validateUpload,
} from './limits.ts'

const ok = { mime: 'image/png', size: 100, originalName: 'a.png' }

describe('validateUpload — 무엇을 받고 무엇을 막는가', () => {
  test('허용 목록의 이미지는 받는다', () => {
    for (const mime of ALLOWED_IMAGE_MIME) {
      assert.equal(validateUpload({ ...ok, mime }), null, mime)
    }
  })

  test('★ SVG 는 받지 않는다 — 이미지처럼 보이지만 스크립트를 품을 수 있다', () => {
    assert.equal(validateUpload({ ...ok, mime: 'image/svg+xml' }), 'unsupported_type')
  })

  test('MVP 는 이미지만이다 — PDF · 비디오 · 임의 바이너리는 아직', () => {
    for (const mime of ['application/pdf', 'video/mp4', 'application/octet-stream', 'text/html']) {
      assert.equal(validateUpload({ ...ok, mime }), 'unsupported_type', mime)
    }
  })

  test('0바이트는 거부한다 (정본 엣지 케이스: 400)', () => {
    assert.equal(validateUpload({ ...ok, size: 0 }), 'empty_file')
  })

  test('저장 축 상한은 5 MiB — 경계에서 갈린다', () => {
    assert.equal(MAX_UPLOAD_BYTES, 5 * 1024 * 1024)
    assert.equal(validateUpload({ ...ok, size: MAX_UPLOAD_BYTES }), null)
    assert.equal(validateUpload({ ...ok, size: MAX_UPLOAD_BYTES + 1 }), 'too_large')
  })

  test('★ 파일명은 글자 수가 아니라 바이트로 센다', () => {
    // 한글은 글자당 3바이트. 300자=900바이트는 통과, 301자=903바이트는 거부.
    assert.equal(validateUpload({ ...ok, originalName: '가'.repeat(300) }), null)
    assert.equal(validateUpload({ ...ok, originalName: '가'.repeat(301) }), 'name_too_long')
    // 글자 수로 셌다면 900자까지 통과했을 것이다 — DB 의 CHECK 에서 터진다.
    assert.equal(MAX_FILENAME_BYTES, 900)
  })

  test('이름이 없어도 된다 — 클립보드 이미지에는 이름이 없다', () => {
    assert.equal(validateUpload({ ...ok, originalName: null }), null)
  })
})

describe('저장 키 — 확장자는 MIME 에서 정한다', () => {
  test('사용자가 준 파일명의 확장자를 쓰지 않는다 (F-09-08: content_type 기준 보정)', () => {
    const key = storageKeyFor('ws1', 'f1', 'image/png')
    assert.equal(key, 'ws1/f1.png')
    assert.equal(extensionFor('image/jpeg'), 'jpg')
  })

  test('원본 파일명은 키에 들어가지 않는다 — 경로 주입·길이 문제를 없앤다', () => {
    const key = storageKeyFor('ws1', 'f1', 'image/webp')
    assert.ok(!key.includes('..') && key.split('/').length === 2)
  })

  test('워크스페이스로 접두어를 준다 — 옮기는 단위가 워크스페이스다', () => {
    assert.ok(storageKeyFor('ws-a', 'f1', 'image/gif').startsWith('ws-a/'))
  })

  test('isAllowedMime 은 타입 좁히기다', () => {
    const value: string = 'image/png'
    assert.equal(isAllowedMime(value), true)
    assert.equal(isAllowedMime('image/bmp'), false)
  })
})
