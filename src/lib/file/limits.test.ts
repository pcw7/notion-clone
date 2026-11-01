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
  inlineExtensionFor,
  isAllowedMime,
  sniffImageMime,
  sniffVideoMime,
  storageKeyFor,
  storedMimeOf,
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

describe('sniffImageMime — 이름 없는 바이트의 형식(잔여 묶음 8m-2b)', () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0])
  test('★ 받는 넷은 머리로 가린다', () => {
    assert.equal(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png')
    assert.equal(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg')
    assert.equal(sniffImageMime(bytes(...Buffer.from('GIF89a'))), 'image/gif')
    assert.equal(sniffImageMime(bytes(...Buffer.from('GIF87a'))), 'image/gif')
    assert.equal(sniffImageMime(bytes(...Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 '))), 'image/webp')
  })

  test('★ 이름 · 확장자가 아니라 바이트다 — HTML · SVG · 빈 바이트 · 잘린 머리는 아니다', () => {
    assert.equal(sniffImageMime(new TextEncoder().encode('<html><script>alert(1)</script>')), null)
    assert.equal(sniffImageMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null)
    assert.equal(sniffImageMime(new Uint8Array()), null)
    assert.equal(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null)
    // RIFF 이지만 WEBP 가 아니다(WAV)
    assert.equal(sniffImageMime(bytes(...Buffer.from('RIFF\x10\x00\x00\x00WAVEfmt '))), null)
    assert.equal(sniffImageMime(bytes(...Buffer.from('GIF89b'))), null)
  })
})
// ── 비디오(F-2 · 정본 §3.4 [보강 F-2] ②) ─────────────────────────────
describe('비디오 — 머리 바이트 · 저장 MIME · 확장자 (F-2 · 정본 [보강 F-2])', () => {
  test('★ mp4 는 4~7 바이트의 ftyp · webm 은 EBML 머리 · 그 밖은 null', () => {
    assert.equal(sniffVideoMime(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0])), 'video/mp4')
    assert.equal(sniffVideoMime(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 2, 3, 4])), 'video/webm')
    assert.equal(sniffVideoMime(new TextEncoder().encode('<html>x</html>')), null)
    assert.equal(sniffVideoMime(new Uint8Array(3)), null)
  })

  test('kind=video 는 받는 둘을 말해야 하고 크기 한도는 같다', () => {
    assert.equal(validateUpload({ mime: 'video/mp4', size: 10, originalName: 'a.mp4' }, 'video'), null)
    assert.equal(validateUpload({ mime: 'video/quicktime', size: 10, originalName: 'a.mov' }, 'video'), 'unsupported_type')
    assert.equal(validateUpload({ mime: 'video/webm', size: MAX_UPLOAD_BYTES + 1, originalName: null }, 'video'), 'too_large')
  })

  test('★ 저장 MIME — 비디오 길은 가린 바이트의 것(아니면 거절) · 파일 길은 말한 이미지 · 비디오를 바이트로 확인한다', () => {
    assert.equal(storedMimeOf('video', 'video/mp4', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 2, 3, 4])), 'video/webm')
    assert.equal(storedMimeOf('video', 'video/mp4', new TextEncoder().encode('<html>x</html>')), null)
    assert.equal(storedMimeOf('file', 'video/mp4', new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0])), 'video/mp4')
    assert.equal(storedMimeOf('file', 'video/mp4', new TextEncoder().encode('<html>x</html>')), 'application/octet-stream')
    assert.equal(storedMimeOf('file', 'image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])), 'image/png')
    assert.equal(storedMimeOf('file', 'image/png', new TextEncoder().encode('<html>x</html>')), 'application/octet-stream')
    assert.equal(storedMimeOf('file', 'text/html', new TextEncoder().encode('<html>x</html>')), 'text/html')
    assert.equal(storedMimeOf('file', '', new TextEncoder().encode('<html>x</html>')), 'application/octet-stream')
    assert.equal(storedMimeOf('image', 'image/png', new TextEncoder().encode('<html>x</html>')), 'image/png', '이미지 길은 지금처럼 말한 4종(그림 MIME 은 실행되지 않는다)')
  })

  test('inline 목록의 확장자 — 이미지 · 비디오 · 그 밖은 null', () => {
    assert.equal(inlineExtensionFor('video/mp4'), 'mp4')
    assert.equal(inlineExtensionFor('video/webm'), 'webm')
    assert.equal(inlineExtensionFor('image/jpeg'), 'jpg')
    assert.equal(inlineExtensionFor('application/pdf'), null)
  })
})
