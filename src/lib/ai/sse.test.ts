/**
 * SSE 읽기 · 공급자 조각 해석 — AI-1 (DB 없음)
 *
 *   ① 조각이 줄 가운데서 갈려도 · `\r\n` 이 두 조각에 갈려도 사건은 하나
 *   ② 주석 · 여러 줄 data · event 이름 · 빈 줄 없이 끝난 마지막 사건
 *   ③ 공급자 조각 — `[DONE]` · 글 · 끝난 까닭 · 사용량(OpenAI · Groq) · 스트림 안의 오류 · 읽을 수 없는 조각
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createSseParser, readChatChunk } from './sse.ts'

test('★ ① 조각이 줄 가운데 · \\r\\n 사이에서 갈려도 사건은 그대로', () => {
  const whole = 'data: {"a":1}\r\n\r\nevent: done\r\ndata: 끝\r\n\r\n'
  // 모든 자리에서 둘로 가른다
  for (let i = 0; i <= whole.length; i += 1) {
    const p = createSseParser()
    const got = [...p.push(whole.slice(0, i)), ...p.push(whole.slice(i)), ...p.end()]
    assert.deepEqual(got, [{ event: 'message', data: '{"a":1}' }, { event: 'done', data: '끝' }], `${i} 에서 갈랐다`)
  }
  // 한 글자씩
  const p = createSseParser()
  const got = [...whole].flatMap((ch) => p.push(ch))
  assert.equal(got.length, 2)
})

test('② 주석 · 여러 줄 data · 콜론 뒤 공백 하나만 뗀다 · \\r 만의 줄 끝 · 빈 줄 없이 끝난 마지막 사건', () => {
  const p = createSseParser()
  const got = p.push(': ping\n\ndata: 첫 줄\ndata:  둘째 줄\n\nevent: x\rdata: 셋\r\r')
  assert.deepEqual(got, [{ event: 'message', data: '첫 줄\n 둘째 줄' }])
  // 끝의 `\r` 은 다음 조각이 `\n` 일 수 있어 기다린다 — 다음 조각이 오면 낸다 · 그 조각의 줄은 줄 끝이 올 때까지 기다린다
  assert.deepEqual(p.push('data: [DONE]'), [{ event: 'x', data: '셋' }])
  assert.deepEqual(p.end(), [{ event: 'message', data: '[DONE]' }])
  // data 없는 사건은 내지 않는다
  const q = createSseParser()
  assert.deepEqual(q.push('event: only\n\n'), [])
})

test('★ ③ 공급자 조각 — [DONE] · 글 · 끝난 까닭 · 사용량 · 오류 · 읽을 수 없는 것', () => {
  assert.deepEqual(readChatChunk('[DONE]'), { kind: 'done' })
  assert.deepEqual(readChatChunk(' [DONE] '), { kind: 'done' })
  assert.deepEqual(
    readChatChunk('{"choices":[{"index":0,"delta":{"role":"assistant","content":"안녕"},"finish_reason":null}]}'),
    { kind: 'data', text: '안녕', finishReason: null, usage: null },
  )
  assert.deepEqual(readChatChunk('{"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}'), {
    kind: 'data',
    text: '',
    finishReason: 'length',
    usage: null,
  })
  // OpenAI — 사용량 조각은 choices 가 비어 있다
  assert.deepEqual(readChatChunk('{"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":34,"total_tokens":46}}'), {
    kind: 'data',
    text: '',
    finishReason: null,
    usage: { inputTokens: 12, outputTokens: 34 },
  })
  // Groq — x_groq.usage
  assert.deepEqual(readChatChunk('{"choices":[{"delta":{},"finish_reason":"stop"}],"x_groq":{"usage":{"prompt_tokens":5,"completion_tokens":7}}}'), {
    kind: 'data',
    text: '',
    finishReason: 'stop',
    usage: { inputTokens: 5, outputTokens: 7 },
  })
  // 모양이 틀린 사용량은 없는 것
  assert.equal((readChatChunk('{"choices":[],"usage":{"prompt_tokens":-1,"completion_tokens":"x"}}') as { usage: unknown }).usage, null)
  assert.deepEqual(readChatChunk('{"error":{"message":"rate limit","type":"x"}}'), { kind: 'error' })
  assert.deepEqual(readChatChunk('OPENROUTER PROCESSING'), { kind: 'ignore' })
  assert.deepEqual(readChatChunk('[1,2]'), { kind: 'ignore' })
})
