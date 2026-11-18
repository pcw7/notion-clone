/**
 * AI 응답 하나 — 게이트 → 공급자 → SSE 응답 (AI-1 · F-10-09 · F-10-12 · CLAUDE.md 절대 제약 2)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ① ② ④
 *
 * `POST /api/workspaces/{id}/ai/complete` 의 몸이다 — 라우트는 세션만 풀고 이것을 부른다(시험이 같은 길을 Next 없이 부른다).
 *
 * 거부는 JSON 이다(`{ ok: false, error }`): 공급자 없음 503 `ai_unavailable` · 꺼짐 403 `ai_disabled` · 게스트 403 `forbidden` · 볼 수 없는
 * 페이지 404 `not_found` · 한도 429 `ai_limit_reached` + `limit`(daily · window · month · trial) · `resetsAt`(ISO · 체험이면 null ·
 * `Retry-After` 도) · 모양 400 `invalid_input` · `input_too_long`. 공급자가 처음부터 거절하면 — 429(무료 등급의 요청 수 · 분당 토큰)는
 * 503 `ai_busy` + `retryAfter`(초 · 공급자가 말했으면 · `Retry-After` 도 — 화면: "AI 서비스가 잠시 바쁩니다 — N초 뒤 다시"), 그 밖은 502
 * `ai_provider_failed` + `reason`. 둘 다 예약은 `failed`(셈에서 빠진다 · 하루 카운터도 돌려준다 — 받은 답이 없다).
 *
 * 통과하면 **SSE**(`text/event-stream`) — 편집기는 `fetch` 의 본문을 `sse.ts` 의 같은 읽기로 읽는다(POST 라 EventSource 를 쓰지 않는다):
 *
 *   event: delta   data: {"text":"…"}                         글 조각(차례대로 이어 붙인다)
 *   event: done    data: {"status":"completed","truncated":bool,"usage":{"inputTokens","outputTokens"}|null,"remaining":n|null,"quota":{…}}
 *   event: error   data: {"error":"ai_provider_failed","reason":"rate_limited|provider_error|timeout|network"}   도중의 실패(셈에서 빠진다)
 *
 * 묻기(`ask` · AI-2)는 게이트를 지난 뒤 그 페이지의 원문을 읽어 서버가 프롬프트를 짓는다(`ask-context.ts` · `ask-prompt.ts`) — 읽을 수 없는
 * 페이지면 404 `not_found`(예약은 `failed`).
 *
 * 고치기(`edit` · AI-3)는 요청을 읽을 때 프리셋의 고정 틀로 메시지를 다 짓는다(`edit-prompt.ts` — 고른 글은 편집기의 것). 게이트가 그 페이지를
 * 고칠 수 있는지 본다 — 보기 · 코멘트 · 제안만 · 잠긴 페이지는 403 `cannot_edit`(예약하지 않는다 · 세지 않는다).
 *
 * 출력 상한(`AI_MAX_OUTPUT_TOKENS` — 공급자의 `max_tokens` · 글자 안전망 `maxOutputChars`)에 닿으면 스트림을 끊고 받은 데까지를 남긴다
 * (`truncated: true` · `completed`). 사람이 멈추면(연결을 닫는다 — `request.signal` · 스트림 취소) 공급자 연결도 닫고 `stopped`(셈에 든다).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { readAskPage } from './ask-context.ts'
import { buildAskMessages, type AskPage } from './ask-prompt.ts'
import { maxOutputChars, readAiConfig, type AiConfig } from './config.ts'
import { AiProviderError, openChatStream, type ChatStreamEvent } from './provider.ts'
import { aiFailureStatus, aiProviderFailureError, aiProviderFailureStatus, parseAiCompleteBody } from './request.ts'
import type { TokenUsage } from './sse.ts'
import { aiQuotaViewFor, finishAiResponse, reserveAiResponse, type AiOutcome } from './usage.ts'

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export type AiCompleteOptions = {
  /** 공급자 설정 — 주지 않으면 환경에서 읽는다(시험은 가짜 공급자를 준다). null 이면 `ai_unavailable`. */
  readonly config?: AiConfig | null
  /** 지금 — 시험이 창 · 달 · 날의 경계를 정한다. */
  readonly now?: () => Date
  readonly fetchImpl?: FetchLike
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const

const failureOf = (e: unknown): AiProviderError => (e instanceof AiProviderError ? e : new AiProviderError('network'))

export async function aiCompleteResponse(
  ctx: SessionContext,
  body: unknown,
  signal: AbortSignal,
  options: AiCompleteOptions = {},
): Promise<Response> {
  const config = options.config === undefined ? readAiConfig() : options.config
  const clock = options.now ?? (() => new Date())
  if (config === null) return Response.json({ ok: false, error: 'ai_unavailable' }, { status: aiFailureStatus('ai_unavailable') })

  const parsed = parseAiCompleteBody(body, config.maxInputChars)
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: aiFailureStatus(parsed.error) })

  const reserved = await reserveAiResponse(ctx, { feature: parsed.value.feature, pageId: parsed.value.pageId }, { config, now: clock() })
  if (!reserved.ok) {
    if (reserved.reason !== 'ai_limit_reached') return Response.json({ ok: false, error: reserved.reason }, { status: aiFailureStatus(reserved.reason) })
    const retryAfter = reserved.resetsAt === null ? null : Math.max(1, Math.ceil((Date.parse(reserved.resetsAt) - clock().getTime()) / 1000))
    return Response.json(
      { ok: false, error: 'ai_limit_reached', limit: reserved.limit, resetsAt: reserved.resetsAt },
      { status: 429, headers: retryAfter === null ? undefined : { 'retry-after': String(retryAfter) } },
    )
  }
  const reservationId = reserved.reservation.id

  // 멈추기 — 사람이 연결을 닫으면(요청의 신호) · 스트림을 취소하면 공급자 연결도 닫는다
  const stop = new AbortController()
  const onAbort = () => stop.abort()
  if (signal.aborted) stop.abort()
  else signal.addEventListener('abort', onAbort, { once: true })

  let finished = false
  const finish = async (outcome: AiOutcome, usage: TokenUsage | null) => {
    if (finished) return
    finished = true
    signal.removeEventListener('abort', onAbort)
    try {
      await finishAiResponse(reservationId, outcome, usage, clock())
    } catch (e) {
      // 닫지 못한 예약은 `reserved` 로 남아 셈에 든다(닫힌 쪽으로 실패한다)
      console.error(`[ai] 예약 ${reservationId} 을 닫지 못했다: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 묻기(AI-2) — 프롬프트는 서버가 짓는다: 그 페이지의 원문(볼 수 있는 것만 · 제안 마크 밖)을 읽어 넣을 자리 둘레를 싣는다. 게이트 뒤에
  // 읽는다(스위치 · 사람 · 권한이 먼저) — 읽지 못하면 그 예약은 셈에서 뺀다(받은 답이 없다)
  let messages = parsed.value.messages
  const ask = parsed.value.ask
  if (ask !== null) {
    let page: AskPage | null = null
    try {
      page = parsed.value.pageId === null ? null : await readAskPage(ctx, parsed.value.pageId)
    } catch (e) {
      await finish('failed', null)
      throw e
    }
    if (parsed.value.pageId !== null && page === null) {
      await finish('failed', null)
      return Response.json({ ok: false, error: 'not_found' }, { status: aiFailureStatus('not_found') })
    }
    const built = buildAskMessages({ question: ask.question, history: ask.history, anchorBlockId: ask.blockId, page }, config.maxInputChars)
    if (built.ok) messages = built.messages
  }

  let events: AsyncGenerator<ChatStreamEvent, void, undefined>
  try {
    events = await openChatStream(config, messages, stop.signal, options.fetchImpl)
  } catch (e) {
    const failure = failureOf(e)
    await finish(failure.reason === 'aborted' ? 'stopped' : 'failed', null)
    if (failure.reason !== 'aborted') console.warn(`[ai] 공급자가 거절했다: ${failure.reason}${failure.status === null ? '' : ` (${failure.status})`}`)
    const error = aiProviderFailureError(failure.reason)
    const retryAfter = failure.retryAfterSeconds
    return Response.json(
      error === 'ai_busy' ? { ok: false, error, retryAfter } : { ok: false, error, reason: failure.reason },
      { status: aiProviderFailureStatus(failure.reason), headers: retryAfter === null ? undefined : { 'retry-after': String(retryAfter) } },
    )
  }

  const encoder = new TextEncoder()
  const cap = maxOutputChars(config)
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const write = (event: string, data: unknown) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          open = false
        }
      }
      let written = 0
      let truncated = false
      let usage: TokenUsage | null = null
      try {
        for await (const event of events) {
          if (event.type === 'end') {
            usage = event.usage
            if (event.finishReason === 'length') truncated = true
            break
          }
          // 출력 상한 — 남은 자리만 보내고 끊는다(받은 데까지가 답이다)
          const room = cap - written
          const text = event.text.length > room ? event.text.slice(0, room) : event.text
          if (text !== '') {
            write('delta', { text })
            written += text.length
          }
          if (event.text.length > room) {
            truncated = true
            break
          }
        }
        await finish('completed', usage)
        const quota = await aiQuotaViewFor(ctx.workspaceId, clock()).catch(() => null)
        write('done', { status: 'completed', truncated, usage, remaining: quota?.remaining ?? null, quota })
      } catch (e) {
        const failure = failureOf(e)
        if (failure.reason === 'aborted') {
          await finish('stopped', usage)
        } else {
          await finish('failed', null)
          console.warn(`[ai] 공급자가 도중에 실패했다: ${failure.reason}`)
          write('error', { error: aiProviderFailureError(failure.reason), reason: failure.reason, retryAfter: failure.retryAfterSeconds })
        }
      } finally {
        open = false
        try {
          controller.close()
        } catch {
          // 이미 닫혔다(받는 쪽이 끊었다)
        }
      }
    },
    cancel() {
      stop.abort()
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
