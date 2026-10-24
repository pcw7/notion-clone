import assert from 'node:assert/strict'
import { test } from 'node:test'

import { retryableStatus } from './upload-client.ts'

test('★ 다시 해 볼 만한 실패 — 서버가 넘어졌거나(5xx) 기다리라고 했다(408 · 429) · 4xx 거절은 아니다 (10n-73)', () => {
  for (const status of [500, 502, 503, 504, 408, 429]) assert.equal(retryableStatus(status), true, String(status))
  for (const status of [400, 401, 403, 404, 413, 415, 422, 200]) assert.equal(retryableStatus(status), false, String(status))
})
