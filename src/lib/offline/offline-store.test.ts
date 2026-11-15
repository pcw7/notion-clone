/**
 * 오프라인 사본의 기록 — OF-2 (F-12-04 · 정본 §3.7 [보강 OF-1] ② · 순수)
 *
 *   ① 기록의 모양 — 열쇠는 `{사용자}:{페이지}` · 받은 것 그대로 · 크기는 상태의 바이트 수
 *   ② ★ 남기는 까닭의 집합 — 같은 까닭은 한 번 · 다시 받아도 다른 까닭이 남는다 · 마지막 까닭을 빼면 지운다(GC)
 *   ③ base64 — 서버의 `Buffer` 인코딩을 브라우저 쪽이 그대로 푼다(모든 바이트 값)
 *   ④ 라우트의 답 읽기 — 모양이 아니면 저장하지 않는다
 *   ⑤ 받아 두기 틀의 약속 — 해시 · 답의 모양
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeBase64,
  offlinePageKey,
  offlineRecord,
  parseOfflinePayload,
  withoutReason,
  withState,
  type OfflinePagePayload,
} from './offline-store.ts'
import { isWarmFrame, isWarmReply, WARM_HASH, WARM_MESSAGE } from './offline-warm.ts'

const USER = '11111111-1111-4111-8111-111111111111'
const WS = '22222222-2222-4222-8222-222222222222'
const PAGE = '33333333-3333-4333-8333-333333333333'

const payload = (state: Uint8Array, over: Partial<OfflinePagePayload> = {}): OfflinePagePayload => ({
  pageId: PAGE,
  title: '여행 계획',
  icon: { type: 'emoji', emoji: '🧳' },
  cover: { type: 'gallery', gallery: 'gradient_1' },
  seq: '7',
  state: Buffer.from(state).toString('base64'),
  ...over,
})

test('① 기록의 모양 — 열쇠 · 받은 것 · 까닭 · 받은 때 · 크기', () => {
  const state = new Uint8Array([1, 2, 3, 250])
  const record = offlineRecord(payload(state), { userId: USER, workspaceId: WS, reason: 'toggled', now: 1_700_000_000_000, previous: null })
  assert.equal(offlinePageKey(USER, PAGE), `${USER}:${PAGE}`)
  assert.deepEqual(
    { ...record, state: [...record.state] },
    {
      key: `${USER}:${PAGE}`,
      userId: USER,
      workspaceId: WS,
      pageId: PAGE,
      title: '여행 계획',
      icon: { type: 'emoji', emoji: '🧳' },
      cover: { type: 'gallery', gallery: 'gradient_1' },
      state: [1, 2, 3, 250],
      seq: '7',
      reasons: ['toggled'],
      savedAt: 1_700_000_000_000,
      bytes: 4,
    },
  )
})

test('② ★ 남기는 까닭 — 같은 까닭은 한 번 · 다시 받아도 다른 까닭이 남는다 · 마지막 까닭을 빼면 지운다', () => {
  const opts = { userId: USER, workspaceId: WS, now: 1 }
  const auto = offlineRecord(payload(new Uint8Array([1])), { ...opts, reason: 'favorited', previous: null })
  const toggled = offlineRecord(payload(new Uint8Array([1, 2]), { title: '바뀐 제목', seq: '9' }), { ...opts, reason: 'toggled', previous: auto })
  assert.deepEqual(toggled.reasons, ['favorited', 'toggled'])
  assert.equal(toggled.title, '바뀐 제목', '다시 받으면 내용은 받은 것으로')
  assert.equal(toggled.seq, '9')
  const again = offlineRecord(payload(new Uint8Array([1])), { ...opts, reason: 'toggled', previous: toggled })
  assert.deepEqual(again.reasons, ['favorited', 'toggled'], '같은 까닭은 한 번')

  const off = withoutReason(again, 'toggled')
  assert.deepEqual(off?.reasons, ['favorited'], '스위치를 꺼도 자동 내려받기의 까닭이 남으면 남는다')
  assert.equal(withoutReason(off!, 'favorited'), null, '마지막 까닭을 빼면 지운다(GC)')
  assert.equal(withoutReason(offlineRecord(payload(new Uint8Array([1])), { ...opts, reason: 'toggled', previous: null }), 'toggled'), null)
  assert.deepEqual(withoutReason(again, 'recent')?.reasons, ['favorited', 'toggled'], '없는 까닭을 빼면 그대로')
})

test('오프라인 편집을 더한 상태 — 크기만 따라 바뀌고 서버 판 · 받은 때는 그대로', () => {
  const record = offlineRecord(payload(new Uint8Array([1])), { userId: USER, workspaceId: WS, reason: 'toggled', now: 5, previous: null })
  const next = withState(record, new Uint8Array([1, 2, 3]))
  assert.equal(next.bytes, 3)
  assert.equal(next.seq, record.seq)
  assert.equal(next.savedAt, record.savedAt)
  assert.deepEqual(next.reasons, record.reasons)
})

test('③ base64 — 서버의 Buffer 인코딩을 그대로 푼다(모든 바이트 값 · 빈 것)', () => {
  const every = Uint8Array.from({ length: 256 * 3 + 1 }, (_, i) => (i * 7) % 256)
  assert.deepEqual([...decodeBase64(Buffer.from(every).toString('base64'))], [...every])
  assert.deepEqual([...decodeBase64('')], [])
  for (const n of [1, 2, 3]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => 255 - i)
    assert.deepEqual([...decodeBase64(Buffer.from(bytes).toString('base64'))], [...bytes], `${n}바이트(덧붙임 ${3 - n})`)
  }
})

test('④ 라우트의 답 읽기 — 모양이 아니면 null', () => {
  const ok = payload(new Uint8Array([1, 2]))
  assert.deepEqual(parseOfflinePayload(ok), ok)
  assert.deepEqual(parseOfflinePayload({ ...ok, icon: null, cover: null }), { ...ok, icon: null, cover: null })
  assert.deepEqual(parseOfflinePayload({ ...ok, icon: 'x', cover: [] }), { ...ok, icon: null, cover: null }, '아이콘 · 커버가 모양이 아니면 없는 것')
  for (const bad of [null, [], 'x', { ...ok, pageId: 1 }, { ...ok, seq: 7 }, { ...ok, seq: '7a' }, { ...ok, state: '%%%' }, { ...ok, title: null }]) {
    assert.equal(parseOfflinePayload(bad), null, JSON.stringify(bad))
  }
})

test('⑤ 받아 두기 틀 — 다른 화면 안에 열린 #warm 만 · 답의 모양', () => {
  assert.equal(isWarmFrame(WARM_HASH, true), true)
  assert.equal(isWarmFrame(WARM_HASH, false), false, '틀이 아니면(사람이 연 껍데기) 받아 두지 않는다')
  assert.equal(isWarmFrame('', true), false)
  assert.equal(isWarmReply({ type: WARM_MESSAGE, ok: true }), true)
  assert.equal(isWarmReply({ type: WARM_MESSAGE, ok: false }), true)
  assert.equal(isWarmReply({ type: WARM_MESSAGE }), false)
  assert.equal(isWarmReply({ type: 'other', ok: true }), false)
  assert.equal(isWarmReply(null), false)
})
