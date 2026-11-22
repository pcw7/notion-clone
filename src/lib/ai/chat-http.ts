/**
 * AI 채팅의 한 턴 — 게이트 → 문맥 → 공급자 → 저장 · SSE (AI-6 · F-10-17 · F-10-22 · F-10-12)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑪ · ④ · ⑥
 *
 * `POST /api/workspaces/{id}/ai/chat` 의 몸이다 — 본문 `{ sessionId?, message, scope?, model? }`(범위 `{kind:'workspace'}` 기본 |
 * `{kind:'page', pageId}` · 모델은 AI-7 — 없으면 대화의 것 · null 은 자동). 라우트는 세션만 풀고 이것을 부른다(시험이 같은 길을 Next 없이 부른다).
 *
 * 거부는 JSON — AI-2 와 같다(`complete-http.ts` 머리말): 503 `ai_unavailable` · 403 `ai_disabled` · `forbidden`(게스트) · 404 `not_found`
 * (남의 대화 · 볼 수 없는 범위의 페이지) · 429 `ai_limit_reached` · 400 `invalid_input` · `input_too_long` · `model_not_allowed`(허용 밖의
 * 모델 · AI-7) · 공급자가 처음부터 거절하면 503 `ai_busy` · 502 `ai_provider_failed`. **거부면 아무것도 적지 않는다**(대화 · 질문 — 질문은
 * 화면의 입력창에 남는다). `session` · `done` 은 이 턴을 쓴 모델(`model`)을 싣는다.
 *
 * 한 턴 = 응답 하나(기능 `chat` · 호출 전에 예약 — 페이지 범위면 그 페이지로). 공급자가 흐르기 시작하면 대화(첫 턴이면 만든다 · 제목 = 첫
 * 질문) · 질문을 적고 SSE 로:
 *
 *   event: session  data: {"sessionId","title","created":bool,"messageId"}      맨 먼저 — 화면이 새 대화를 목록에 올린다
 *   event: delta    data: {"text":"…"}
 *   event: done     data: {"status":"completed","truncated","usage","remaining","quota","sources":[{n,pageId,title,cited}],"messageId"}
 *   event: error    data: {"error":"ai_provider_failed","reason",…}             도중의 실패(셈에서 빠진다 · 답은 failed 로 받은 데까지)
 *
 * 멈추면(연결을 닫는다) 답은 `stopped` 로 받은 데까지 남는다(셈에 든다). 문맥은 `chat-prompt.ts` 가 짓는다 — 범위의 글 · 출처 · 내 AI 지시는
 * 그 사람이 지금 볼 수 있는 것만(`chat-store.ts`).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { readAskPage } from './ask-context.ts'
import { buildChatMessages, parseChatBody, type ChatBuild, type ChatContext } from './chat-prompt.ts'
import { markCited, type ChatMessageStatus } from './chat-shared.ts'
import { findChatSources, findOwnChatSession, finishChatTurn, loadChatHistory, readChatInstructions, startChatTurn } from './chat-store.ts'
import type { AiCompleteOptions } from './complete-http.ts'
import { maxOutputChars, readAiConfig } from './config.ts'
import { AiProviderError, openChatStream, type ChatStreamEvent } from './provider.ts'
import { aiFailureStatus, aiProviderFailureError, aiProviderFailureStatus } from './request.ts'
import type { TokenUsage } from './sse.ts'
import { aiQuotaViewFor, canUseAi, finishAiResponse, reserveAiResponse, type AiOutcome } from './usage.ts'

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const

const failureOf = (e: unknown): AiProviderError => (e instanceof AiProviderError ? e : new AiProviderError('network'))
const refuse = (error: string) => Response.json({ ok: false, error }, { status: aiFailureStatus(error) })

export async function aiChatResponse(ctx: SessionContext, body: unknown, signal: AbortSignal, options: AiCompleteOptions = {}): Promise<Response> {
  const config = options.config === undefined ? readAiConfig() : options.config
  const clock = options.now ?? (() => new Date())
  if (config === null) return refuse('ai_unavailable')

  const parsed = parseChatBody(body, config.maxInputChars)
  if (!parsed.ok) return refuse(parsed.error)
  const { sessionId, question, scope, model } = parsed.value

  // 이어 가는 대화 — 그 사람의 것만(남의 것은 없는 것과 같다 · 예약 전). 게스트는 게이트가 `forbidden` 으로 말한다
  let storedModel: string | null = null
  if (sessionId !== null && canUseAi(ctx)) {
    const own = await findOwnChatSession(ctx, sessionId)
    if (own === null) return refuse('not_found')
    storedModel = own.model
  }

  // 모델(AI-7) — 본문의 것(null = 자동 · 허용 밖이면 400 model_not_allowed) · 없으면 대화의 것(회수됐으면 기본으로)
  const requested = model !== undefined ? model : storedModel
  const pageId = scope.kind === 'page' ? scope.pageId : null
  const reserved = await reserveAiResponse(ctx, { feature: 'chat', pageId, model: requested, modelFallback: model === undefined }, { config, now: clock() })
  if (!reserved.ok) {
    if (reserved.reason !== 'ai_limit_reached') return refuse(reserved.reason)
    const retryAfter = reserved.resetsAt === null ? null : Math.max(1, Math.ceil((Date.parse(reserved.resetsAt) - clock().getTime()) / 1000))
    return Response.json(
      { ok: false, error: 'ai_limit_reached', limit: reserved.limit, resetsAt: reserved.resetsAt },
      { status: 429, headers: retryAfter === null ? undefined : { 'retry-after': String(retryAfter) } },
    )
  }
  const reservationId = reserved.reservation.id
  const usedModel = reserved.reservation.model
  // 대화에 남길 모델 — 고른 것 · 아니면 대화의 것(기본으로 돌아갔으면 자동)
  const sessionModel = model !== undefined ? model : usedModel === requested ? storedModel : null

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
      console.error(`[ai] 예약 ${reservationId} 을 닫지 못했다: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 문맥 — 게이트 뒤에(스위치 · 사람 · 권한이 먼저). 읽지 못하면 그 예약은 셈에서 뺀다(받은 답이 없다)
  let build: ChatBuild
  try {
    const instructions = await readChatInstructions(ctx)
    let context: ChatContext
    if (scope.kind === 'page') {
      const page = await readAskPage(ctx, scope.pageId)
      if (page === null) {
        await finish('failed', null)
        return refuse('not_found')
      }
      context = { kind: 'page', page }
    } else {
      const { terms, found } = await findChatSources(ctx, question, instructions === null ? [] : [instructions.pageId])
      context = { kind: 'workspace', terms, found }
    }
    const history = sessionId === null ? [] : await loadChatHistory(ctx, sessionId)
    build = buildChatMessages(
      { question, instructions: instructions === null ? null : { title: instructions.title, text: instructions.text }, context, history },
      config.maxInputChars,
    )
  } catch (e) {
    await finish('failed', null)
    throw e
  }
  if (!build.ok) {
    await finish('failed', null)
    return refuse(build.error)
  }

  // 공급자를 연다 — 처음부터 거절하면 아무것도 적지 않는다
  let events: AsyncGenerator<ChatStreamEvent, void, undefined>
  try {
    events = await openChatStream({ ...config, model: usedModel }, build.messages, stop.signal, options.fetchImpl)
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

  // 턴을 연다 — 대화(첫 턴이면 만든다) · 질문. 그사이 대화가 지워졌으면 404(그 응답은 셈에서 뺀다)
  let turn: Awaited<ReturnType<typeof startChatTurn>>
  try {
    turn = await startChatTurn(ctx, { sessionId, question, scope, model: sessionModel })
  } catch (e) {
    stop.abort()
    await finish('failed', null)
    throw e
  }
  if (turn === null) {
    stop.abort()
    await finish('failed', null)
    return refuse('not_found')
  }
  const opened = turn

  const encoder = new TextEncoder()
  const cap = maxOutputChars(config)
  const sources = build.sources
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
      let answer = ''
      let truncated = false
      let usage: TokenUsage | null = null
      /** 답을 적는다 — 실패해도 스트림은 닫는다(원장은 이미 닫혔다). */
      const store = async (status: ChatMessageStatus) => {
        try {
          return await finishChatTurn(ctx, { sessionId: opened.sessionId, usageId: reservationId, status, content: answer, sources: markCited(answer, sources), usage })
        } catch (e) {
          console.error(`[ai] 채팅 답을 적지 못했다(${opened.sessionId}): ${e instanceof Error ? e.message : String(e)}`)
          return null
        }
      }
      write('session', { sessionId: opened.sessionId, title: opened.title, created: opened.created, messageId: opened.messageId, model: usedModel })
      try {
        for await (const event of events) {
          if (event.type === 'end') {
            usage = event.usage
            if (event.finishReason === 'length') truncated = true
            break
          }
          const room = cap - answer.length
          const text = event.text.length > room ? event.text.slice(0, room) : event.text
          if (text !== '') {
            write('delta', { text })
            answer += text
          }
          if (event.text.length > room) {
            truncated = true
            break
          }
        }
        await finish('completed', usage)
        const messageId = await store('completed')
        const quota = await aiQuotaViewFor(ctx.workspaceId, clock()).catch(() => null)
        write('done', {
          status: 'completed',
          truncated,
          usage,
          remaining: quota?.remaining ?? null,
          quota,
          sources: markCited(answer, sources),
          sessionId: opened.sessionId,
          messageId,
          model: usedModel,
        })
      } catch (e) {
        const failure = failureOf(e)
        if (failure.reason === 'aborted') {
          await finish('stopped', usage)
          await store('stopped')
        } else {
          await finish('failed', null)
          await store('failed')
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
