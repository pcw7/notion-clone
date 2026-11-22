/**
 * AI 채팅 — 화면 쪽 스트림 읽기 (AI-6 · F-10-17 · DB 없음)
 *
 *   session → delta… → done(출처 · 남은 수) · 거부(JSON) · 도중의 error · 끊김 · 멈추기 · 출처 칩의 글
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { askFailureMessage } from './ask-client.ts'
import { chatFailureMessage, chatOpenedOf, sourceChipText, streamChat, type ChatOpened } from './chat-client.ts'

const PAGE = '11111111-2222-4333-8444-555555555555'
const sse = (...events: [string, unknown][]) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
const streamOf = (text: string, split = 7) => {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += split) c.enqueue(bytes.slice(i, i + split))
      c.close()
    },
  })
}
const fakeFetch = (res: Response) => async () => res

test('★ session → delta… → done — 대화가 먼저 서고 조각이 차례대로 · 끝에 출처(인용 여부) · 메시지 id', async () => {
  let opened: ChatOpened | null = null
  const pieces: string[] = []
  const body = sse(
    ['session', { sessionId: PAGE, title: '알파', created: true, messageId: 'm1', model: 'fake-model-large' }],
    ['delta', { text: '마감은 ' }],
    ['delta', { text: '12월 3일 [1]' }],
    ['done', { status: 'completed', truncated: false, quota: null, sources: [{ n: 1, pageId: PAGE, title: '계획', cited: true }], messageId: 'm2', model: 'fake-model-large' }],
  )
  let sent: { url: string; body: unknown } | null = null
  const outcome = await streamChat(
    'ws',
    { sessionId: null, message: '알파?', scope: { kind: 'workspace' }, model: 'fake-model-large' },
    new AbortController().signal,
    { onOpened: (o) => (opened = o), onDelta: (t) => pieces.push(t) },
    async (url, init) => {
      sent = { url, body: JSON.parse(String(init.body)) }
      return new Response(streamOf(body), { headers: { 'content-type': 'text/event-stream' } })
    },
  )
  assert.deepEqual(sent, { url: '/api/workspaces/ws/ai/chat', body: { sessionId: null, message: '알파?', scope: { kind: 'workspace' }, model: 'fake-model-large' } })
  assert.deepEqual(opened, { sessionId: PAGE, title: '알파', created: true, messageId: 'm1', model: 'fake-model-large' })
  assert.equal(pieces.join(''), '마감은 12월 3일 [1]')
  assert.deepEqual(outcome, {
    kind: 'done',
    truncated: false,
    quota: null,
    sources: [{ n: 1, pageId: PAGE, title: '계획', cited: true }],
    messageId: 'm2',
    model: 'fake-model-large',
  })
})

test('★ 허용 밖의 모델(AI-7) — 400 model_not_allowed 는 그 실패 · 말은 다른 모델을 고르라', async () => {
  const handlers = { onOpened: () => undefined, onDelta: () => undefined }
  const out = await streamChat('ws', { sessionId: null, message: 'q', scope: { kind: 'workspace' }, model: 'nope' }, new AbortController().signal, handlers,
    fakeFetch(Response.json({ ok: false, error: 'model_not_allowed' }, { status: 400 })))
  assert.deepEqual(out, { kind: 'failed', failure: { kind: 'model_not_allowed' } })
  assert.equal(chatFailureMessage({ kind: 'model_not_allowed' }), '그 모델은 이 워크스페이스에서 쓸 수 없습니다 — 다른 모델을 고르세요.')
  assert.equal(chatFailureMessage({ kind: 'not_found' }), askFailureMessage({ kind: 'not_found' }), '나머지는 AI-2 의 말')
})

test('★ 거부(JSON) — 한도 · 꺼짐 · 없는 대화는 AI-2 의 실패로 · 도중의 error · 끊김은 연결 실패', async () => {
  const handlers = { onOpened: () => undefined, onDelta: () => undefined }
  const limit = await streamChat('ws', { sessionId: null, message: 'q', scope: { kind: 'workspace' } }, new AbortController().signal, handlers,
    fakeFetch(Response.json({ ok: false, error: 'ai_limit_reached', limit: 'trial', resetsAt: null }, { status: 429 })))
  assert.deepEqual(limit, { kind: 'failed', failure: { kind: 'limit', limit: 'trial', resetsAt: null } })
  const gone = await streamChat('ws', { sessionId: PAGE, message: 'q', scope: { kind: 'workspace' } }, new AbortController().signal, handlers,
    fakeFetch(Response.json({ ok: false, error: 'not_found' }, { status: 404 })))
  assert.deepEqual(gone, { kind: 'failed', failure: { kind: 'not_found' } })
  const mid = await streamChat('ws', { sessionId: null, message: 'q', scope: { kind: 'workspace' } }, new AbortController().signal, handlers,
    fakeFetch(new Response(streamOf(sse(['delta', { text: 'a' }], ['error', { error: 'ai_provider_failed', reason: 'provider_error' }])))))
  assert.deepEqual(mid, { kind: 'failed', failure: { kind: 'provider' } })
  const cut = await streamChat('ws', { sessionId: null, message: 'q', scope: { kind: 'workspace' } }, new AbortController().signal, handlers,
    fakeFetch(new Response(streamOf(sse(['delta', { text: 'a' }])))))
  assert.deepEqual(cut, { kind: 'failed', failure: { kind: 'network' } })
})

test('멈추기 — 신호가 멎으면 aborted', async () => {
  const stop = new AbortController()
  stop.abort()
  const out = await streamChat('ws', { sessionId: null, message: 'q', scope: { kind: 'workspace' } }, stop.signal, { onOpened: () => undefined, onDelta: () => undefined }, async () => {
    throw new DOMException('aborted', 'AbortError')
  })
  assert.deepEqual(out, { kind: 'aborted' })
})

test('session 사건의 모양 · 출처 칩의 글', () => {
  assert.equal(chatOpenedOf({ sessionId: 'x' }), null)
  assert.deepEqual(chatOpenedOf({ sessionId: 's', title: 't', messageId: 'm' }), { sessionId: 's', title: 't', created: false, messageId: 'm', model: null })
  assert.equal(sourceChipText({ n: 2, title: '계획' }), '[2] 계획')
  assert.equal(sourceChipText({ n: 1, title: '(untitled)' }), '[1] 제목 없음')
  assert.equal(sourceChipText({ n: 1, title: ' ' }), '[1] 제목 없음')
})
