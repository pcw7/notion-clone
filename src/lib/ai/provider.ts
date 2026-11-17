/**
 * AI 공급자 — OpenAI 호환 Chat Completions 의 스트리밍 하나 (AI-1 · F-10-09 · F-10-12)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ① ② ④
 *
 * `fetch` + SSE 뿐이다(공급자 SDK 를 의존성으로 두지 않는다). Groq · OpenRouter · Gemini 는 같은 모양이라 주소 · 키 · 모델만 바뀐다.
 *
 *   · 여는 것(`openChatStream`)과 읽는 것(돌려준 생성기)을 나눈다 — 공급자가 처음부터 거절하면(429 · 5xx · 연결 실패) 스트림을 열기 전에
 *     알아 라우트가 JSON 오류로 답한다
 *   · 실패는 까닭 하나(`AiProviderError.reason`)로만 — **키 · 공급자의 응답 본문은 어디에도 싣지 않는다**(사람에게도 로그에도)
 *   · 멈추기 · 시간 상한은 `AbortSignal` 하나로 — 부른 쪽이 멈추면 `aborted` · 시간이 다 되면 `timeout`
 *   · 사용량은 공급자가 줄 때만(`stream_options.include_usage` · Groq 의 `x_groq.usage`) — 없으면 null
 *   · 읽기를 도중에 그만두면(출력 상한 · 멈추기) 연결을 닫는다(생성기의 `finally`)
 */

import type { AiConfig } from './config.ts'
import { createSseParser, readChatChunk, type TokenUsage } from './sse.ts'

export type ChatMessage = { readonly role: 'system' | 'user'; readonly content: string }

export type AiProviderFailure =
  /** 공급자가 요청 수 · 분당 토큰을 막았다(429 — 무료 등급의 한도 · 잠시 뒤 풀린다 · 화면은 `ai_busy`). */
  | 'rate_limited'
  /** 공급자가 실패했다(4xx · 5xx · 스트림 안의 오류 · 키가 틀렸다). */
  | 'provider_error'
  /** 시간 상한(`AI_TIMEOUT_MS`)에 닿았다. */
  | 'timeout'
  /** 연결하지 못했다 · 도중에 끊겼다. */
  | 'network'
  /** 부른 쪽이 멈췄다(사람이 멈추기 · 연결을 닫았다). */
  | 'aborted'

export class AiProviderError extends Error {
  readonly reason: AiProviderFailure
  readonly status: number | null
  /** 요청 수 한도(429)면 공급자가 말한 "몇 초 뒤" — 말하지 않았으면 null. */
  readonly retryAfterSeconds: number | null
  constructor(reason: AiProviderFailure, status: number | null = null, retryAfterSeconds: number | null = null) {
    super(`AI 공급자 실패: ${reason}${status === null ? '' : ` (${status})`}`)
    this.name = 'AiProviderError'
    this.reason = reason
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** Groq 의 기간 글 — `1m26.4s` · `7.66s` · `120ms` · `2h3m` → 초. 읽을 수 없으면 null. */
export function parseProviderDuration(raw: string): number | null {
  const text = raw.trim()
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/gy
  let total = 0
  let matched = 0
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const n = Number(m[1])
    total += m[2] === 'h' ? n * 3600 : m[2] === 'm' ? n * 60 : m[2] === 's' ? n : n / 1000
    matched = re.lastIndex
  }
  return matched > 0 && matched === text.length ? total : null
}

/**
 * 429 의 "몇 초 뒤" — `Retry-After`(초 · HTTP 날짜) 가 먼저, 없으면 `x-ratelimit-reset-requests` · `x-ratelimit-reset-tokens` 중 이른 것
 * (요청 수는 계속 차오르는 양동이라 하나가 찰 때까지가 짧다). 1초 ~ 1시간으로 올림 · 아무것도 없으면 null.
 */
export function retryAfterSeconds(headers: Headers, now: Date = new Date()): number | null {
  const clamp = (s: number) => Math.min(3600, Math.max(1, Math.ceil(s)))
  const retry = headers.get('retry-after')
  if (retry !== null) {
    const n = parseProviderDuration(retry)
    if (n !== null) return clamp(n)
    const at = Date.parse(retry)
    if (!Number.isNaN(at)) return clamp((at - now.getTime()) / 1000)
  }
  const resets = ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens']
    .map((name) => headers.get(name))
    .flatMap((v) => (v === null ? [] : [parseProviderDuration(v)]))
    .filter((v): v is number => v !== null)
  return resets.length === 0 ? null : clamp(Math.min(...resets))
}

export type ChatStreamEvent =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'end'; readonly finishReason: string | null; readonly usage: TokenUsage | null }

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** 공급자에 보내는 본문 — 모델 · 메시지 · 스트리밍 · 출력 상한(· 사용량을 달라는 요청 · 설정했으면 추론의 세기). */
export function chatRequestBody(config: AiConfig, messages: readonly ChatMessage[]): Record<string, unknown> {
  return {
    model: config.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
    max_tokens: config.maxOutputTokens,
    ...(config.streamUsage ? { stream_options: { include_usage: true } } : {}),
    // 받지 않는 공급자가 있다 — 설정했을 때만 싣는다(AI-2 · `AI_REASONING_EFFORT`)
    ...(config.reasoningEffort === null ? {} : { reasoning_effort: config.reasoningEffort }),
  }
}

/**
 * 공급자에 묻고 스트림을 연다 — 답의 머리가 오면 읽을 생성기를 돌려준다. 열지 못하면 `AiProviderError` 를 던진다.
 *
 * @param signal 부른 쪽의 멈추기(사람이 멈춤 · 연결이 닫힘). 시간 상한은 여기서 더한다.
 */
export async function openChatStream(
  config: AiConfig,
  messages: readonly ChatMessage[],
  signal: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<AsyncGenerator<ChatStreamEvent, void, undefined>> {
  const timeout = AbortSignal.timeout(config.timeoutMs)
  const combined = AbortSignal.any([signal, timeout])
  const failureOf = (e: unknown): AiProviderError => {
    if (e instanceof AiProviderError) return e
    if (signal.aborted) return new AiProviderError('aborted')
    if (timeout.aborted) return new AiProviderError('timeout')
    return new AiProviderError('network')
  }

  let res: Response
  try {
    res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(chatRequestBody(config, messages)),
      signal: combined,
    })
  } catch (e) {
    throw failureOf(e)
  }
  if (!res.ok || res.body === null) {
    // 본문은 읽지 않고 버린다 — 공급자의 말(키의 일부 · 계정 정보)을 흘리지 않는다
    await res.body?.cancel().catch(() => undefined)
    if (res.status === 429) throw new AiProviderError('rate_limited', 429, retryAfterSeconds(res.headers))
    throw new AiProviderError('provider_error', res.status)
  }
  return readChatStream(res.body, failureOf)
}

async function* readChatStream(
  body: ReadableStream<Uint8Array>,
  failureOf: (e: unknown) => AiProviderError,
): AsyncGenerator<ChatStreamEvent, void, undefined> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  let usage: TokenUsage | null = null
  let finishReason: string | null = null
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (e) {
        throw failureOf(e)
      }
      const events = chunk.done ? [...parser.push(decoder.decode()), ...parser.end()] : parser.push(decoder.decode(chunk.value, { stream: true }))
      for (const event of events) {
        const c = readChatChunk(event.data)
        if (c.kind === 'done') {
          yield { type: 'end', finishReason, usage }
          return
        }
        if (c.kind === 'error') throw new AiProviderError('provider_error')
        if (c.kind !== 'data') continue
        if (c.usage !== null) usage = c.usage
        if (c.finishReason !== null) finishReason = c.finishReason
        if (c.text !== '') yield { type: 'delta', text: c.text }
      }
      if (chunk.done) {
        // `[DONE]` 없이 닫혔다 — 받은 데까지가 답이다(끝난 까닭이 없어도 끊긴 것으로 보지 않는다 — 공급자마다 다르다)
        yield { type: 'end', finishReason, usage }
        return
      }
    }
  } finally {
    // 다 읽지 않고 그만뒀을 수 있다(출력 상한 · 멈추기 · 오류) — 연결을 닫는다(다 읽은 스트림에는 아무 일도 없다)
    await reader.cancel().catch(() => undefined)
  }
}
