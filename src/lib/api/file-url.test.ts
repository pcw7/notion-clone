/**
 * 올린 파일의 서명 주소 (API-7 · F-09-08 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑪
 *
 *   ★ 주소의 모양 · 1시간 · 같은 키 · 같은 시각이면 같은 주소
 *   ★ 서명 — 맞으면 ok · 한 글자라도 바꾸면(끝 글자의 남는 비트까지) · 다른 파일 · 다른 만료 · 다른 키면 bad_signature · 모양이 틀려도
 *   ★ 만료 — 지나면 expired(서명을 먼저 본다 — 틀린 서명의 지난 주소는 bad_signature) · `now` 없이 보면(왕복) 만료를 보지 않는다
 *   ★ 왕복 — 우리 주소면 파일 id · 바깥 주소 · 모양이 다른 주소 · 서명이 틀린 주소는 null
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checkFileSignature, fileIdOfSignedUrl, fileUrlKey, FILE_URL_TTL_SECONDS, readFileUrl, signedFileUrl, signFile } from './file-url.ts'

const KEY = Buffer.alloc(32, 7)
const OTHER_KEY = Buffer.alloc(32, 8)
const FILE = '3a2e3d4c-5b6a-4789-8abc-def012345678'
const OTHER = '4a2e3d4c-5b6a-4789-8abc-def012345678'
const NOW = new Date('2026-11-22T00:00:00.000Z')
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000)

function partsOf(url: string) {
  const parts = readFileUrl(url)
  assert.ok(parts !== null, url)
  return parts
}

test('★ 주소의 모양 — 출처의 /api/files/{id}?expires&signature · 1시간 · 같은 시각이면 같은 주소', () => {
  const made = signedFileUrl('https://app.test', KEY, FILE.toUpperCase(), NOW)
  const expires = Math.floor(NOW.getTime() / 1000) + FILE_URL_TTL_SECONDS
  assert.match(made.url, new RegExp(`^https://app\\.test/api/files/${FILE}\\?expires=${expires}&signature=[A-Za-z0-9_-]{43}$`), '파일 id 는 소문자')
  assert.equal(made.expiry_time, '2026-11-22T01:00:00.000Z')
  assert.deepEqual(signedFileUrl('https://app.test', KEY, FILE, NOW), made)
  assert.notEqual(signedFileUrl('https://app.test', OTHER_KEY, FILE, NOW).url, made.url, '키가 다르면 서명이 다르다')
})

test('★ 서명 — 맞으면 ok · 바꾼 서명 · 다른 파일 · 다른 만료 · 다른 키 · 모양이 틀린 값은 bad_signature', () => {
  const { fileId, expires, signature } = partsOf(signedFileUrl('https://app.test', KEY, FILE, NOW).url)
  assert.equal(checkFileSignature(KEY, fileId, expires, signature, NOW), 'ok')
  assert.equal(checkFileSignature(KEY, fileId, expires, signature, later(FILE_URL_TTL_SECONDS - 1)), 'ok', '만료 1초 전')
  // 끝 글자 — base64url 43자의 마지막 글자는 남는 비트를 품는다. 바이트로 풀어 견주면 이 바꿈을 놓친다
  for (const at of [0, 20, 42]) {
    const c = signature[at]!
    const swapped = `${signature.slice(0, at)}${c === 'A' ? 'B' : 'A'}${signature.slice(at + 1)}`
    assert.equal(checkFileSignature(KEY, fileId, expires, swapped, NOW), 'bad_signature', `${at}번째 글자를 바꿨다`)
  }
  assert.equal(checkFileSignature(KEY, OTHER, expires, signature, NOW), 'bad_signature', '다른 파일')
  assert.equal(checkFileSignature(KEY, fileId, String(Number(expires) + 3600), signature, NOW), 'bad_signature', '만료를 늘렸다')
  assert.equal(checkFileSignature(OTHER_KEY, fileId, expires, signature, NOW), 'bad_signature', '다른 키')
  for (const [id, exp, sig] of [
    [fileId, null, signature],
    [fileId, expires, null],
    [fileId, '-1', signature],
    [fileId, '1e9', signature],
    [fileId, expires, `${signature}=`],
    [fileId, expires, signature.slice(1)],
    [FILE.toUpperCase(), expires, signature],
    ['../secret', expires, signature],
  ] as const) {
    assert.equal(checkFileSignature(KEY, id, exp, sig, NOW), 'bad_signature', JSON.stringify([id, exp, sig]))
  }
})

test('★ 만료 — 지나면 expired · 틀린 서명이 먼저 · now 없이(왕복)는 만료를 보지 않는다', () => {
  const { fileId, expires, signature } = partsOf(signedFileUrl('https://app.test', KEY, FILE, NOW).url)
  assert.equal(checkFileSignature(KEY, fileId, expires, signature, later(FILE_URL_TTL_SECONDS)), 'expired', '만료 그 순간')
  assert.equal(checkFileSignature(KEY, fileId, expires, signature, later(FILE_URL_TTL_SECONDS * 24)), 'expired')
  assert.equal(checkFileSignature(KEY, fileId, expires, 'A'.repeat(43), later(FILE_URL_TTL_SECONDS * 24)), 'bad_signature', '틀린 서명은 만료보다 먼저')
  assert.equal(checkFileSignature(KEY, fileId, expires, signature, null), 'ok')
})

test('★ 왕복 — 우리 서명 주소면 파일 id(지난 것도) · 바깥 · 모양이 다른 · 서명이 틀린 주소는 null', () => {
  const old = signedFileUrl('https://app.test', KEY, FILE, new Date('2020-01-01T00:00:00Z')).url
  assert.equal(fileIdOfSignedUrl(KEY, old), FILE, '만료가 지나도 같은 파일')
  assert.equal(fileIdOfSignedUrl(KEY, old.replace('https://app.test', 'http://localhost:3000')), FILE, '출처는 보지 않는다 — 서명이 증명한다')
  assert.equal(fileIdOfSignedUrl(OTHER_KEY, old), null)
  assert.equal(fileIdOfSignedUrl(KEY, `https://cdn.test/a.png`), null)
  assert.equal(fileIdOfSignedUrl(KEY, old.replace('/api/files/', '/api/file/')), null)
  assert.equal(fileIdOfSignedUrl(KEY, old.replace(/signature=[^&]+/, `signature=${signFile(KEY, OTHER, 1)}`)), null)
  assert.equal(fileIdOfSignedUrl(KEY, 'not a url'), null)
  assert.equal(fileIdOfSignedUrl(KEY, old.replace('https:', 'javascript:')), null)
})

test('키 — AUTH_SECRET 에서 유도(32바이트 · 같은 비밀이면 같은 키) · 없으면 던진다', () => {
  const saved = process.env.AUTH_SECRET
  try {
    process.env.AUTH_SECRET = 'test-secret-only-for-unit-tests'
    const a = fileUrlKey()
    assert.equal(a.length, 32)
    assert.deepEqual(fileUrlKey(), a)
    process.env.AUTH_SECRET = 'another-secret'
    assert.notDeepEqual(fileUrlKey(), a)
    delete process.env.AUTH_SECRET
    assert.throws(() => fileUrlKey(), /AUTH_SECRET/)
  } finally {
    if (saved === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = saved
  }
})
