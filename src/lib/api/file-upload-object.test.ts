/**
 * 공개 API 의 파일 업로드 객체 · 요청 (API-7 · F-09-08 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑪
 *
 *   ★ 상태 — 붙지 않고 지나면 expired · 붙은 것은 만료가 없다 · 객체의 키(SDK 의 FileUploadObjectResponse) · 보내기 주소는 pending 만
 *   ★ 만들기 — single_part(기본) · multi_part · external_url 은 까닭과 함께 거부 · 모르는 키 · 이름(900바이트 · 제어 문자) · content_type 의 모양
 *     · 이름의 확장자로 형식
 *   ★ 보내기 — 형식 · 이름의 차례(말한 것 → 부분 → 확장자 → octet-stream · SDK Blob 의 "blob") · 이미지 · 비디오라 말하고 다른 바이트
 *   목록의 status 값
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  contentMismatch,
  contentTypeFromName,
  fileUploadStatus,
  fileUploadToApi,
  normalizeContentType,
  parseCreateFileUpload,
  parseListStatus,
  resolveSendInput,
  type FileUploadRow,
} from './file-upload-object.ts'

const ID = '5a2e3d4c-5b6a-4789-8abc-def012345678'
const USER = '6a2e3d4c-5b6a-4789-8abc-def012345678'
const CREATED = new Date('2026-11-22T00:00:00.000Z')
const EXPIRES = new Date('2026-11-22T01:00:00.000Z')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const MP4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])

const row = (over: Partial<FileUploadRow> = {}): FileUploadRow => ({
  id: ID,
  user_id: USER,
  status: 'pending',
  filename: '사진.png',
  content_type: 'image/png',
  content_length: null,
  created_at: CREATED,
  last_edited_at: CREATED,
  expires_at: EXPIRES,
  attached_at: null,
  ...over,
})

test('★ 상태 — pending · uploaded · 붙지 않고 지나면 expired · 붙은 것은 만료가 없다', () => {
  const before = new Date('2026-11-22T00:59:59.000Z')
  assert.equal(fileUploadStatus(row(), before), 'pending')
  assert.equal(fileUploadStatus(row(), EXPIRES), 'expired', '만료 그 순간')
  assert.equal(fileUploadStatus(row({ status: 'uploaded' }), before), 'uploaded')
  assert.equal(fileUploadStatus(row({ status: 'uploaded' }), EXPIRES), 'expired', '올렸어도 붙이지 않고 지나면')
  assert.equal(fileUploadStatus(row({ status: 'uploaded', expires_at: null, attached_at: CREATED }), new Date('2030-01-01')), 'uploaded')
})

test('★ 객체 — SDK 의 FileUploadObjectResponse 의 키 · 보내기 주소는 pending 만 · 길이는 숫자 · created_by 는 person', () => {
  const pending = fileUploadToApi(row(), CREATED, 'https://app.test', 'req-1')
  assert.deepEqual(pending, {
    object: 'file_upload',
    id: ID,
    created_time: '2026-11-22T00:00:00.000Z',
    last_edited_time: '2026-11-22T00:00:00.000Z',
    expiry_time: '2026-11-22T01:00:00.000Z',
    upload_url: `https://app.test/v1/file_uploads/${ID}/send`,
    archived: false,
    in_trash: false,
    status: 'pending',
    filename: '사진.png',
    content_type: 'image/png',
    content_length: null,
    created_by: { id: USER, type: 'person' },
    request_id: 'req-1',
  })
  const attached = fileUploadToApi(row({ status: 'uploaded', content_length: '4096', expires_at: null, attached_at: CREATED }), CREATED, 'https://app.test', 'req-2')
  assert.equal(attached.status, 'uploaded')
  assert.equal(attached.content_length, 4096)
  assert.equal(attached.expiry_time, null)
  assert.equal('upload_url' in attached, false, '보낸 뒤에는 보내기 주소가 없다')
  assert.equal('upload_url' in fileUploadToApi(row(), EXPIRES, 'https://app.test', 'r'), false, '지난 것도')
})

test('★ 만들기 — 기본은 single_part · 이름 · 형식(매개변수를 뗀다 · 없으면 확장자)', () => {
  assert.deepEqual(parseCreateFileUpload(undefined), { ok: true, value: { filename: null, contentType: null } })
  assert.deepEqual(parseCreateFileUpload({ mode: 'single_part', filename: ' 보고서.PDF ', content_type: null }), {
    ok: true,
    value: { filename: '보고서.PDF', contentType: 'application/pdf' },
  })
  assert.deepEqual(parseCreateFileUpload({ filename: 'a.png', content_type: 'Image/WebP; q=1' }), { ok: true, value: { filename: 'a.png', contentType: 'image/webp' } })
  assert.deepEqual(parseCreateFileUpload({ filename: '메모' }), { ok: true, value: { filename: '메모', contentType: null } })
  assert.deepEqual(parseCreateFileUpload({ content_type: 'image/svg+xml' }), { ok: true, value: { filename: null, contentType: 'image/svg+xml' } }, '형식은 막지 않는다 — 앱의 파일 블록처럼 내려받기')
})

test('★ 만들기의 거부 — multi_part · external_url 은 까닭과 · 모르는 키 · 이름 · 형식의 모양', () => {
  const fails = (body: unknown, pattern: RegExp) => {
    const r = parseCreateFileUpload(body)
    assert.ok(!r.ok, JSON.stringify(body))
    if (!r.ok) assert.match(r.message, pattern)
  }
  fails({ mode: 'multi_part', number_of_parts: 3 }, /mode "multi_part" is not supported — a file can be at most 5MB/)
  fails({ mode: 'external_url', external_url: 'https://x.test/a.png' }, /mode "external_url" is not supported — this API does not download files/)
  fails({ mode: 'stream' }, /body\.mode should be "single_part"/)
  fails({ number_of_parts: 2 }, /number_of_parts should be not present/)
  fails({ external_url: 'https://x.test' }, /external_url should be not present/)
  fails({ parent: {} }, /body\.parent should be not present/)
  fails([], /body should be an object/)
  fails({ filename: 3 }, /body\.filename should be a string/)
  fails({ filename: '  ' }, /body\.filename should be a non-empty string/)
  fails({ filename: '가'.repeat(301) }, /body\.filename should be at most 900 bytes, instead was 903 bytes/)
  fails({ filename: 'a\nb.png' }, /control characters/)
  fails({ content_type: 'png' }, /body\.content_type should be a MIME type/)
  fails({ content_type: 'image/' }, /body\.content_type should be a MIME type/)
  fails({ content_type: 7 }, /body\.content_type should be a string/)
  assert.ok(parseCreateFileUpload({ filename: '가'.repeat(300) }).ok, '900바이트까지')
})

test('형식의 모양 · 확장자 · 목록의 status', () => {
  assert.equal(normalizeContentType(' TEXT/Plain ; charset=utf-8'), 'text/plain')
  assert.equal(normalizeContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  for (const bad of ['', 'image', '/png', 'image/png/x', 'image /png', '이미지/png']) assert.equal(normalizeContentType(bad), null, bad)
  assert.equal(contentTypeFromName('a.JPG'), 'image/jpeg')
  assert.equal(contentTypeFromName('clip.webm'), 'video/webm')
  assert.equal(contentTypeFromName('README'), null)
  assert.equal(contentTypeFromName('a.exe'), null)
  assert.equal(contentTypeFromName(null), null)
  assert.equal(parseListStatus(null), undefined)
  assert.equal(parseListStatus('expired'), 'expired')
  assert.equal(parseListStatus('done'), null)
})

test('★ 보내기 — 형식 · 이름의 차례 · SDK Blob 의 "blob" 은 이름이 없는 것', () => {
  assert.deepEqual(resolveSendInput({ declaredType: 'image/png', declaredName: '사진.png', partType: 'text/plain', partName: 'x.txt' }), { mime: 'image/png', originalName: '사진.png' }, '만들 때 말한 것이 먼저')
  assert.deepEqual(resolveSendInput({ declaredType: null, declaredName: null, partType: 'image/gif', partName: 'a.gif' }), { mime: 'image/gif', originalName: 'a.gif' })
  assert.deepEqual(resolveSendInput({ declaredType: null, declaredName: null, partType: 'application/octet-stream', partName: 'a.webp' }), { mime: 'image/webp', originalName: 'a.webp' }, 'octet-stream 은 말하지 않은 것')
  assert.deepEqual(resolveSendInput({ declaredType: null, declaredName: null, partType: '', partName: 'blob' }), { mime: 'application/octet-stream', originalName: null })
  assert.deepEqual(resolveSendInput({ declaredType: null, declaredName: '메모.txt', partType: '', partName: 'blob' }), { mime: 'text/plain', originalName: '메모.txt' })
})

test('★ 이미지 · 비디오라 말하고 다른 바이트 — 거부할 것 · 그 밖의 형식은 보지 않는다', () => {
  assert.equal(contentMismatch('image/png', PNG), false)
  assert.equal(contentMismatch('image/jpeg', PNG), true, '다른 이미지')
  assert.equal(contentMismatch('image/png', new TextEncoder().encode('<html>')), true)
  assert.equal(contentMismatch('video/mp4', MP4), false)
  assert.equal(contentMismatch('video/webm', MP4), true)
  assert.equal(contentMismatch('text/plain', PNG), false)
  assert.equal(contentMismatch('application/octet-stream', PNG), false)
})
