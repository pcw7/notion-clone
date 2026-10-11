/**
 * 사이트 주소의 문구 — 6c-2 (DOM · DB 없음)
 *
 *   ① 서버의 까닭마다 할 말 · 모르는 까닭 · 원형의 이름은 일반 문구
 *   ② 사이트 주소의 모양 — 앱 주소 끝의 / 를 한 번만 · 슬러그가 없으면 …
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { siteDomainFailureMessage, siteUrlOf } from './site-messages.ts'

test('① 까닭마다 할 말 · 모르는 까닭 · 원형의 이름', () => {
  for (const reason of ['forbidden', 'invalid_name', 'reserved', 'taken']) {
    assert.notEqual(siteDomainFailureMessage(reason), '바꾸지 못했습니다.', reason)
  }
  assert.equal(siteDomainFailureMessage('constructor'), '바꾸지 못했습니다.')
  assert.equal(siteDomainFailureMessage(undefined), '바꾸지 못했습니다.')
})

test('② 사이트 주소의 모양', () => {
  assert.equal(siteUrlOf('https://example.com/', 'acme', 'about'), 'https://example.com/s/acme/about')
  assert.equal(siteUrlOf('https://example.com', 'acme', null), 'https://example.com/s/acme/…')
})
