import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decodeInboxCursor, encodeInboxCursor } from './inbox-cursor.ts'

const PAGE = '0b6f5a2e-8c1d-4f3a-9e2b-7d4c1a0f9e8b'

test('★ ① 되돌려 보낸 커서는 그대로 — 마이크로초 · 한글 묶음 열쇠까지', () => {
  for (const at of ['2026-10-25 06:18:00.123456+00', '2026-10-25 15:18:00+09', '2026-01-02 03:04:05.1-05:30']) {
    const cursor = { at, groupKey: `discussion:가나다:${at.length}`, pageId: PAGE }
    assert.deepEqual(decodeInboxCursor(encodeInboxCursor(cursor)), cursor)
  }
  assert.match(encodeInboxCursor({ at: '2026-10-25 06:18:00+00', groupKey: 'k', pageId: PAGE }), /^[A-Za-z0-9_-]+$/, '주소에 그대로 싣는 글자')
})

test('② 망가진 커서는 null — 모양 · 시각 · 페이지 id · 길이', () => {
  const enc = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  const bad = [
    '',
    '!!!',
    enc({ at: '2026-10-25 06:18:00+00', groupKey: 'k', pageId: PAGE }),
    enc(['2026-10-25 06:18:00+00', 'k']),
    enc(['2026-10-25T06:18:00.000Z', 'k', PAGE]),
    enc(['어제', 'k', PAGE]),
    enc(['2026-10-25 06:18:00+00', '', PAGE]),
    enc(['2026-10-25 06:18:00+00', 'k'.repeat(513), PAGE]),
    enc(['2026-10-25 06:18:00+00', 'k', 'not-a-uuid']),
    enc(['2026-10-25 06:18:00+00', 7, PAGE]),
    'a'.repeat(1025),
  ]
  for (const raw of bad) assert.equal(decodeInboxCursor(raw), null, raw.slice(0, 40))
})
