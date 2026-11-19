/**
 * 페이지 번역의 화면 쪽 — 언어 차례 · 상태 기계 · 문구 · 스트림 읽기 (AI-4 · F-10-03 · 브라우저 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { EDIT_LANGUAGES } from './edit-prompt.ts'
import {
  costText,
  fetchTranslateEstimate,
  inCard,
  inToast,
  initialTranslateState,
  orderLanguages,
  readRecentLanguages,
  rememberLanguage,
  resultText,
  streamTranslate,
  translateFailureMessage,
  translateFailureOf,
  translateReducer,
  writeRecentLanguages,
  type TranslateEvent,
  type TranslateResult,
  type TranslateState,
} from './translate-client.ts'

test('★ 언어 — 최근 쓴 것이 위 · 나머지는 고치기의 일곱 언어 차례 · 모르는 값은 버린다', () => {
  assert.deepEqual(orderLanguages([]), [...EDIT_LANGUAGES])
  assert.deepEqual(orderLanguages(['ja', 'klingon', 'en', 'ja']), ['ja', 'en', 'ko', 'zh', 'es', 'fr', 'de'])
  assert.deepEqual(rememberLanguage(['ja', 'en'], 'de'), ['de', 'ja', 'en'])
  assert.deepEqual(rememberLanguage(['ja', 'en', 'fr'], 'en'), ['en', 'ja', 'fr'], '최근 셋 · 겹치지 않는다')
  const store = new Map<string, string>()
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
  writeRecentLanguages(storage, ['fr'])
  assert.deepEqual(readRecentLanguages(storage), ['fr'])
  assert.deepEqual(readRecentLanguages(null), [])
  assert.deepEqual(readRecentLanguages({ getItem: () => '{broken' }), [])
  writeRecentLanguages({ setItem: () => { throw new Error('막힘') } }, ['en'])
})

const run = (events: TranslateEvent[], from: TranslateState = initialTranslateState) => events.reduce(translateReducer, from)

test('★ 상태 기계 — 열기 → 언어 → 미리 보기 → 확인 → 번역 → 진행 → 끝 · 카드와 토스트', () => {
  let s = run([{ type: 'open' }])
  assert.equal(s.phase, 'pick')
  assert.ok(inCard(s))
  s = run([{ type: 'pick', language: 'en' }], s)
  assert.deepEqual([s.phase, s.language], ['estimating', 'en'])
  s = run([{ type: 'estimated', seq: s.seq - 1, chunks: 9, remaining: 9 }], s)
  assert.equal(s.phase, 'estimating', '늦게 온 미리 보기는 버린다')
  s = run([{ type: 'estimated', seq: s.seq, chunks: 3, remaining: 10 }], s)
  assert.deepEqual([s.phase, s.chunks, s.remaining], ['confirm', 3, 10])
  s = run([{ type: 'start' }], s)
  assert.deepEqual([s.phase, s.done, s.total], ['running', 0, 3])
  assert.ok(inToast(s) && !inCard(s))
  s = run([{ type: 'close' }, { type: 'open' }, { type: 'dismiss' }], s)
  assert.equal(s.phase, 'running', '흐르는 동안은 메뉴의 닫기 · 열기 · 토스트 닫기가 멈추지 않는다')
  s = run([{ type: 'progress', seq: s.seq, done: 1, total: 3, pageId: 'p1' }, { type: 'wait', seq: s.seq, seconds: 7 }], s)
  assert.deepEqual([s.done, s.pageId, s.waiting], [1, 'p1', 7])
  s = run([{ type: 'progress', seq: s.seq, done: 2, total: 3, pageId: 'p1' }], s)
  assert.equal(s.waiting, null, '진행이 오면 기다림은 끝')
  const result: TranslateResult = { status: 'completed', pageId: 'p1', translated: 5, skipped: 0, done: 3, total: 3, reason: null, limit: null, resetsAt: null }
  s = run([{ type: 'finished', seq: s.seq, result }], s)
  assert.equal(s.phase, 'done')
  s = run([{ type: 'close' }], s)
  assert.equal(s.phase, 'done', '메뉴의 닫기는 결과 토스트를 닫지 않는다')
  s = run([{ type: 'dismiss' }], s)
  assert.equal(s.phase, 'closed')
})

test('★ 남은 응답이 모자라면 번역을 시작하지 않는다 · 무제한이면 시작한다', () => {
  const confirm = (remaining: number | null): TranslateState => {
    const s = run([{ type: 'open' }, { type: 'pick', language: 'ko' }])
    return run([{ type: 'estimated', seq: s.seq, chunks: 4, remaining }], s)
  }
  assert.equal(run([{ type: 'start' }], confirm(3)).phase, 'confirm')
  assert.equal(run([{ type: 'start' }], confirm(4)).phase, 'running')
  assert.equal(run([{ type: 'start' }], confirm(null)).phase, 'running')
})

test('취소 · 실패 · 다시 — 다시는 같은 언어로 새로 미리 본다(새 번역본) · 다시 해도 같은 실패는 다시가 없다', () => {
  const s0 = run([{ type: 'open' }, { type: 'pick', language: 'fr' }])
  const s1 = run([{ type: 'estimated', seq: s0.seq, chunks: 2, remaining: 5 }, { type: 'start' }], s0)
  const cancelling = run([{ type: 'cancel' }], s1)
  assert.ok(cancelling.cancelling)
  const failed = run([{ type: 'failed', seq: s1.seq, failure: { kind: 'busy', retryAfter: 3 } }], s1)
  assert.ok(inToast(failed))
  const again = run([{ type: 'retry' }], failed)
  assert.deepEqual([again.phase, again.language, again.total], ['estimating', 'fr', 0])
  const notRetryable = run([{ type: 'failed', seq: s1.seq, failure: { kind: 'page_gone' } }], s1)
  assert.equal(run([{ type: 'retry' }], notRetryable).phase, 'error')
  const early = run([{ type: 'failed', seq: s0.seq, failure: { kind: 'cannot_create' } }], s0)
  assert.ok(inCard(early), '시작 전의 실패는 카드에')
  assert.equal(run([{ type: 'back' }], early).phase, 'pick')
})

test('★ 문구 — 거부 · 모자람 · 비용 · 끝 · 멈춤(한도면 어느 한도와 언제)', () => {
  assert.deepEqual(translateFailureOf({ error: 'not_enough_quota', needed: 5, remaining: 2 }), { kind: 'not_enough', needed: 5, remaining: 2 })
  assert.equal(translateFailureMessage(translateFailureOf({ error: 'not_enough_quota', needed: 5, remaining: 2 })), 'AI 응답이 5회 필요한데 2회 남았습니다 — 시작하지 않습니다.')
  assert.match(translateFailureMessage(translateFailureOf({ error: 'cannot_create' })), /하위 페이지를 만들 권한/)
  assert.equal(translateFailureMessage(translateFailureOf({ error: 'ai_disabled' })), '워크스페이스 소유자가 AI 를 켜야 합니다.')
  assert.equal(translateFailureMessage(translateFailureOf({ error: 'ai_busy', retryAfter: 7 })), 'AI 서비스가 잠시 바쁩니다 — 7초 뒤 다시 시도하세요.')
  assert.equal(costText(3, 17), 'AI 응답 3회를 씁니다 · 남은 응답 17회.')
  assert.equal(costText(1, null), 'AI 응답 1회를 씁니다.')
  const base: TranslateResult = { status: 'completed', pageId: 'p', translated: 9, skipped: 2, done: 3, total: 3, reason: null, limit: null, resetsAt: null }
  assert.equal(resultText(base), '번역을 마쳤습니다 · 2개는 원문 그대로 두었습니다.')
  assert.equal(resultText({ ...base, skipped: 0 }), '번역을 마쳤습니다.')
  assert.equal(resultText({ ...base, status: 'partial', done: 1, reason: 'stopped' }), '번역이 1/3 에서 멈췄습니다 — 번역을 취소했습니다. 나머지는 원문 그대로입니다.')
  assert.equal(
    resultText({ ...base, status: 'partial', done: 2, reason: 'limit', limit: 'trial' }),
    '번역이 2/3 에서 멈췄습니다 — AI 한도에 닿았습니다. 나머지는 원문 그대로입니다. 체험 응답을 모두 썼습니다 — 운영자에게 보충을 요청하세요.',
  )
})

const sse = (events: [string, unknown][]) =>
  new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })

test('스트림 — 진행 · 기다림을 차례로 · 끝은 결과 · error 사건 · 거부의 JSON · 연결 실패', async () => {
  const seen: unknown[] = []
  const ok = await streamTranslate('w', { pageId: 'p', language: 'en' }, new AbortController().signal, (e) => seen.push(e), async () =>
    sse([
      ['progress', { pageId: 'n', done: 0, total: 2 }],
      ['wait', { seconds: 4 }],
      ['progress', { pageId: 'n', done: 1, total: 2 }],
      ['done', { status: 'partial', pageId: 'n', translated: 3, skipped: 1, done: 1, total: 2, reason: 'limit', limit: 'window', resetsAt: '2030-01-01T00:00:00Z' }],
    ]),
  )
  assert.deepEqual(seen, [
    { kind: 'progress', done: 0, total: 2, pageId: 'n' },
    { kind: 'wait', seconds: 4 },
    { kind: 'progress', done: 1, total: 2, pageId: 'n' },
  ])
  assert.deepEqual(ok, {
    kind: 'done',
    result: { status: 'partial', pageId: 'n', translated: 3, skipped: 1, done: 1, total: 2, reason: 'limit', limit: 'window', resetsAt: '2030-01-01T00:00:00Z' },
  })
  const gone = await streamTranslate('w', { pageId: 'p', language: 'en' }, new AbortController().signal, () => {}, async () => sse([['error', { error: 'page_gone', pageId: 'n' }]]))
  assert.deepEqual(gone, { kind: 'failed', failure: { kind: 'page_gone' } })
  const refused = await streamTranslate('w', { pageId: 'p', language: 'en' }, new AbortController().signal, () => {}, async () =>
    Response.json({ ok: false, error: 'empty_page' }, { status: 400 }),
  )
  assert.deepEqual(refused, { kind: 'failed', failure: { kind: 'empty_page' } })
  const offline = await streamTranslate('w', { pageId: 'p', language: 'en' }, new AbortController().signal, () => {}, async () => {
    throw new Error('offline')
  })
  assert.deepEqual(offline, { kind: 'failed', failure: { kind: 'network' } })
})

test('미리 보기 — 청크 · 남은 응답 · 거부', async () => {
  let asked = ''
  const ok = await fetchTranslateEstimate('w', 'p', 'ja', async (url) => {
    asked = url
    return Response.json({ ok: true, chunks: 3, units: 9, remaining: null, quota: null })
  })
  assert.equal(asked, '/api/workspaces/w/ai/translate?pageId=p&language=ja')
  assert.deepEqual(ok, { kind: 'ok', chunks: 3, remaining: null, quota: null })
  const no = await fetchTranslateEstimate('w', 'p', 'ja', async () => Response.json({ ok: false, error: 'ai_limit_reached', limit: 'month', resetsAt: null }, { status: 429 }))
  assert.deepEqual(no, { kind: 'failed', failure: { kind: 'limit', limit: 'month', resetsAt: null } })
})
