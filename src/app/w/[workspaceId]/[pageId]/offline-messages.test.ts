/**
 * "오프라인으로 쓰기" 의 거부 문구 — OF-2 (순수)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { offlineDownloadError } from './offline-messages.ts'

test('정책 거부는 까닭을 말한다 — 내보내기와 같은 게이트 · 소유자만', () => {
  const message = offlineDownloadError(403, 'policy_disabled')
  assert.ok(message.includes('정책') && message.includes('소유자'), message)
})

test('그 밖 — 로그인 · 없는 페이지 · 일반 문구', () => {
  assert.equal(offlineDownloadError(401, 'unauthenticated'), '로그인이 만료됐습니다. 다시 로그인해 주세요.')
  assert.ok(offlineDownloadError(404, 'not_found').includes('찾을 수 없습니다'))
  assert.equal(offlineDownloadError(500, null), '내려받지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  assert.equal(offlineDownloadError(403, 'constructor'), '내려받지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
})
