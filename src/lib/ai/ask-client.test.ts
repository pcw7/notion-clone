/**
 * AI 에게 묻기 — 편집기 쪽 상태 기계 · 스트림 읽기 · 문구 (AI-2 · F-10-01 · F-10-09 · DB 없음 · 진짜 공급자를 부르지 않는다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AI_DISABLED, AI_UNAVAILABLE } from '../../app/w/[workspaceId]/settings/ai-messages.ts'
import {
  AI_ASK_DISABLED,
  AI_ASK_UNAVAILABLE,
  askFailureMessage,
  askFailureOf,
  askReducer,
  canRetry,
  clockText,
  initialAskState,
  remainingText,
  streamAsk,
  type AskState,
} from './ask-client.ts'
import type { AiQuotaView } from './quota.ts'

const quota = (over: Partial<AiQuotaView>): AiQuotaView => ({ kind: 'trial', window: null, month: null, trial: { used: 3, limit: 20 }, grantsLeft: 0, grantsExpireAt: null, remaining: 17, ...over })

test('★ ① 상태 기계 — idle → streaming → done · 멈추면 받은 데까지 · 실패 · 늦은 조각은 버린다 · 두 번 누르기는 무시', () => {
  let s: AskState = askReducer(initialAskState, { type: 'ask', question: '  ' })
  assert.equal(s.phase, 'idle', '빈 질문은 보내지 않는다')
  s = askReducer(s, { type: 'ask', question: ' 요약 ' })
  assert.deepEqual([s.phase, s.question, s.seq], ['streaming', '요약', 1])
  assert.equal(askReducer(s, { type: 'ask', question: '또' }), s, '흐르는 중에 다시 묻지 않는다')
  assert.equal(askReducer(s, { type: 'retry' }), s)
  s = askReducer(s, { type: 'delta', seq: 1, text: '가' })
  s = askReducer(s, { type: 'delta', seq: 1, text: '나' })
  s = askReducer(s, { type: 'done', seq: 1, truncated: false, quota: quota({}) })
  assert.deepEqual([s.phase, s.answer, s.quota?.remaining], ['done', '가나', 17])
  assert.equal(askReducer(s, { type: 'delta', seq: 1, text: '늦음' }).answer, '가나', '끝난 뒤의 조각은 버린다')

  // 다시 — 같은 질문 · 새 응답
  let r = askReducer(s, { type: 'retry' })
  assert.deepEqual([r.phase, r.question, r.answer, r.seq, r.history.length], ['streaming', '요약', '', 2, 0])
  r = askReducer(r, { type: 'delta', seq: 1, text: '옛 응답' })
  assert.equal(r.answer, '', '옛 차례의 조각은 버린다')
  r = askReducer(r, { type: 'delta', seq: 2, text: '부분' })
  r = askReducer(r, { type: 'stopped', seq: 2 })
  assert.deepEqual([r.phase, r.answer], ['stopped', '부분'], '멈추면 받은 데까지 남는다')

  // 이어서 묻기 — 앞선 문답을 싣는다
  const f = askReducer(r, { type: 'followUp', question: '더 짧게' })
  assert.deepEqual([f.phase, f.question, f.history], ['streaming', '더 짧게', [{ question: '요약', answer: '부분' }]])

  // 실패 — 되는 것만 다시
  const busy = askReducer(f, { type: 'failed', seq: f.seq, failure: { kind: 'busy', retryAfter: 7 } })
  assert.equal(busy.phase, 'error')
  assert.equal(askReducer(busy, { type: 'retry' }).phase, 'streaming')
  const limited = askReducer(f, { type: 'failed', seq: f.seq, failure: { kind: 'limit', limit: 'window', resetsAt: '2032-01-01T06:20:00Z' } })
  assert.equal(askReducer(limited, { type: 'retry' }), limited, '한도는 풀릴 때까지 다시 하지 않는다')
})

test('★ ② 실패의 말 — 어느 한도 · 언제(그 사람의 시각) · 바쁨 N초 · 꺼짐 · 공급자 없음 · 다시 할 수 있는가', () => {
  const now = new Date('2032-01-01T03:00:00Z')
  const f = (body: unknown) => askFailureMessage(askFailureOf(body), now, 'UTC')
  assert.equal(f({ error: 'ai_limit_reached', limit: 'window', resetsAt: '2032-01-01T15:20:00Z' }), '6시간 한도에 닿았습니다 — 오후 3:20 에 다시 쓸 수 있습니다.')
  assert.equal(f({ error: 'ai_limit_reached', limit: 'month', resetsAt: '2032-02-01T00:00:00Z' }), '이번 달 한도에 닿았습니다 — 2월 1일 오전 12:00 에 다시 쓸 수 있습니다.')
  assert.equal(f({ error: 'ai_limit_reached', limit: 'trial', resetsAt: null }), '체험 응답을 모두 썼습니다 — 운영자에게 보충을 요청하세요.')
  assert.match(f({ error: 'ai_limit_reached', limit: 'daily', resetsAt: '2032-01-02T00:00:00Z' }), /^오늘 이 앱의 AI 사용량이 모두 찼습니다 — 1월 2일/)
  assert.equal(f({ error: 'ai_busy', retryAfter: 7 }), 'AI 서비스가 잠시 바쁩니다 — 7초 뒤 다시 시도하세요.')
  assert.equal(f({ error: 'ai_disabled' }), AI_DISABLED, '설정 화면과 같은 말')
  assert.equal(f({ error: 'ai_unavailable' }), AI_UNAVAILABLE)
  assert.equal(AI_ASK_DISABLED, AI_DISABLED)
  assert.equal(AI_ASK_UNAVAILABLE, AI_UNAVAILABLE)
  assert.deepEqual(askFailureOf({ error: 'ai_provider_failed', reason: 'timeout' }), { kind: 'provider' })
  assert.deepEqual(
    ['busy', 'provider', 'network', 'limit', 'disabled', 'too_long'].map((kind) => canRetry({ kind, limit: '', resetsAt: null, retryAfter: null } as never)),
    [true, true, true, false, false, false],
  )
  assert.equal(clockText('2032-01-01T15:20:00Z', now, 'Asia/Seoul'), '1월 2일 오전 12:20')
})

test('③ 남은 응답 — 체험 · 이번 달 · 6시간이 먼저 막으면 그것 · 무제한은 말하지 않는다', () => {
  assert.equal(remainingText(quota({})), '남은 체험 응답 17')
  const plan = { kind: 'plan' as const, trial: null }
  assert.equal(remainingText(quota({ ...plan, window: { used: 10, limit: 100, resetsAt: null }, month: { used: 950, limit: 1000, resetsAt: 'x' }, remaining: 50 })), '이번 달 남은 응답 50')
  assert.equal(remainingText(quota({ ...plan, window: { used: 99, limit: 100, resetsAt: null }, month: { used: 10, limit: 1000, resetsAt: 'x' }, remaining: 1 })), '6시간 안에 남은 응답 1')
  assert.equal(remainingText(quota({ remaining: null })), null)
  assert.equal(remainingText(null), null)
})

/** 우리 라우트의 SSE 를 흉내 내는 응답 — 조각을 나눠 보낸다(사건이 조각 사이에서 끊겨도 된다). */
function sseResponse(text: string, pieces = 4): Response {
  const bytes = new TextEncoder().encode(text)
  const size = Math.ceil(bytes.length / pieces)
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size))
        c.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

test('★ ④ 스트림 — 조각 · 끝(남은 수) · 도중의 오류 · 거부 JSON · 연결 실패 · 멈추기 · 보내는 몸(질문 · 자리 · 앞선 문답)', async () => {
  const sent: unknown[] = []
  const ok = async (input: string, init: RequestInit) => {
    sent.push({ input, body: JSON.parse(String(init.body)) })
    return sseResponse('event: delta\ndata: {"text":"안녕"}\n\nevent: delta\ndata: {"text":"하세요"}\n\nevent: done\ndata: {"status":"completed","truncated":false,"quota":{"kind":"trial","remaining":4}}\n\n')
  }
  const got: string[] = []
  const body = { pageId: 'p', blockId: 'b', question: '인사', history: [{ question: 'q', answer: 'a' }] }
  const done = await streamAsk('ws', body, new AbortController().signal, (t) => got.push(t), ok)
  assert.deepEqual(got, ['안녕', '하세요'])
  assert.equal(done.kind, 'done')
  assert.deepEqual(sent[0], { input: '/api/workspaces/ws/ai/complete', body: { feature: 'ask', prompt: '인사', pageId: 'p', blockId: 'b', history: [{ question: 'q', answer: 'a' }] } })

  const mid = await streamAsk('ws', body, new AbortController().signal, () => undefined, async () => sseResponse('event: delta\ndata: {"text":"x"}\n\nevent: error\ndata: {"error":"ai_busy","retryAfter":3}\n\n'))
  assert.deepEqual(mid, { kind: 'failed', failure: { kind: 'busy', retryAfter: 3 } })

  const refused = await streamAsk('ws', body, new AbortController().signal, () => undefined, async () =>
    Response.json({ ok: false, error: 'ai_limit_reached', limit: 'trial', resetsAt: null }, { status: 429 }))
  assert.deepEqual(refused, { kind: 'failed', failure: { kind: 'limit', limit: 'trial', resetsAt: null } })

  const offline = await streamAsk('ws', body, new AbortController().signal, () => undefined, async () => {
    throw new TypeError('Failed to fetch')
  })
  assert.deepEqual(offline, { kind: 'failed', failure: { kind: 'network' } })

  const cut = await streamAsk('ws', body, new AbortController().signal, () => undefined, async () => sseResponse('event: delta\ndata: {"text":"x"}\n\n'))
  assert.deepEqual(cut, { kind: 'failed', failure: { kind: 'network' } }, '끝 사건 없이 닫혔다')

  const stop = new AbortController()
  const stopped = await streamAsk('ws', body, stop.signal, () => stop.abort(), async (_i, init) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"x"}\n\n'))
          init.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
        },
      }),
    ))
  assert.deepEqual(stopped, { kind: 'aborted' }, '멈추면 aborted — 받은 조각은 이미 넘겼다')
})
