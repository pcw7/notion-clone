// 파일 응답의 머리 — 이미지만 inline · 그 밖은 내려받기(F-1a · 정본 §3.4 [보강 F-1] ③).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { attachmentDisposition, fileResponseHeaders, servesInline } from './serve.ts'

describe('파일 응답의 머리', () => {
  test('받는 이미지 4종만 inline', () => {
    assert.equal(servesInline('image/png'), true)
    assert.equal(servesInline('image/webp'), true)
    assert.equal(servesInline('image/svg+xml'), false)
    assert.equal(servesInline('text/html'), false)
    assert.equal(servesInline('application/pdf'), false)
  })

  test('★ 이미지가 아니면 octet-stream + attachment — text/html 이라고 해도 내려받기다', () => {
    const headers = fileResponseHeaders({ mime: 'text/html', originalName: '악성.html' })
    assert.equal(headers['content-type'], 'application/octet-stream')
    assert.ok(headers['content-disposition'].startsWith('attachment;'))
    assert.equal(headers['x-content-type-options'], 'nosniff')
    const image = fileResponseHeaders({ mime: 'image/png', originalName: 'a.png' })
    assert.equal(image['content-type'], 'image/png')
    assert.equal(image['content-disposition'], 'inline')
  })

  test('이름 — UTF-8 은 filename* 에 percent-encoding · ASCII 폴백 · 따옴표 · 줄바꿈은 뺀다 · 없으면 file', () => {
    const d = attachmentDisposition('회의 "록".pdf')
    assert.ok(d.includes(`filename*=UTF-8''%ED%9A%8C%EC%9D%98%20%22%EB%A1%9D%22.pdf`), d)
    assert.ok(d.includes('filename="__ "_".pdf"') === false, d)
    assert.ok(/filename="[^"\r\n]*"/.test(d), d)
    assert.equal(attachmentDisposition(null), `attachment; filename="file"; filename*=UTF-8''file`)
    assert.ok(!attachmentDisposition('a\r\nb.txt').includes('\n'))
  })
})
