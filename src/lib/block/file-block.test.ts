// 파일 블록의 순수 함수(F-1a · 정본 §3.4 [보강 F-1]).
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test } from 'node:test'

import { textRun } from '../contracts/rich-text.ts'
import {
  attachmentExtensionOf,
  externalFileName,
  fileDisplayName,
  formatFileSize,
  readFileSource,
  validateFileProperties,
} from './file-block.ts'

describe('파일 블록 — 출처 · 검증은 이미지와 같은 모양', () => {
  test('올린 파일 · 바깥 주소를 읽는다 · 모양이 틀리면 null', () => {
    const id = randomUUID()
    assert.deepEqual(readFileSource({ source: { type: 'file', file_id: id } }), { kind: 'file', fileId: id })
    assert.deepEqual(readFileSource({ source: { type: 'external', url: 'https://a.test/x.pdf' } }), { kind: 'external', url: 'https://a.test/x.pdf' })
    assert.equal(readFileSource({ source: { type: 'external', url: 'javascript:alert(1)' } }), null)
    assert.equal(readFileSource({}), null)
  })

  test('★ 검증 — 틀린 source 는 거부 · 캡션은 RichText', () => {
    assert.equal(validateFileProperties({ source: { type: 'file', file_id: randomUUID() }, caption: [textRun('캡션')] }, 'p').length, 0)
    assert.equal(validateFileProperties({ source: { type: 'file', file_id: 'nope' } }, 'p').length, 1)
    assert.ok(validateFileProperties({ caption: 'not runs' }, 'p').length >= 1)
  })
})

describe('이름 · 크기 · 확장자', () => {
  test('바깥 주소의 이름 — 마지막 조각(디코드) · 없으면 호스트', () => {
    assert.equal(externalFileName('https://a.test/docs/%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf?x=1'), '보고서.pdf')
    assert.equal(externalFileName('https://a.test/'), 'a.test')
    assert.equal(externalFileName('not a url'), '파일')
  })

  test('보이는 이름 — 올린 파일은 원본 이름 · 비면 "파일" · 바깥 주소는 주소의 이름', () => {
    assert.equal(fileDisplayName({ kind: 'file', fileId: randomUUID() }, '  회의록.docx '), '회의록.docx')
    assert.equal(fileDisplayName({ kind: 'file', fileId: randomUUID() }, null), '파일')
    assert.equal(fileDisplayName({ kind: 'external', url: 'https://a.test/a.zip' }, '무시'), 'a.zip')
    assert.equal(fileDisplayName(null, null), '파일')
  })

  test('크기 글자', () => {
    assert.equal(formatFileSize(0), '0 B')
    assert.equal(formatFileSize(512), '512 B')
    assert.equal(formatFileSize(1536), '1.5 KB')
    assert.equal(formatFileSize(2 * 1024 * 1024), '2.0 MB')
    assert.equal(formatFileSize(-1), '')
  })

  test('★ 내보내기 확장자 — 원본 이름의 것(영숫자 1~10 · 소문자) · 없으면 bin', () => {
    assert.equal(attachmentExtensionOf('보고서.PDF'), 'pdf')
    assert.equal(attachmentExtensionOf('archive.tar.gz'), 'gz')
    assert.equal(attachmentExtensionOf('noext'), 'bin')
    assert.equal(attachmentExtensionOf('.hidden'), 'bin')
    assert.equal(attachmentExtensionOf('trailing.'), 'bin')
    assert.equal(attachmentExtensionOf('weird.ex-t'), 'bin')
    assert.equal(attachmentExtensionOf(null), 'bin')
  })
})
