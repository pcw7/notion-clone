/**
 * AI 블록 만들기 · 다시 만들기 — 판정 → 예약 → 공급자 → SSE → 서버가 결과를 본문에 쓴다 (AI-5 · F-10-04 · F-10-12)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ② ④ ⑥ ⑩ · CLAUDE.md 절대 제약 2 · 10-ai-features.md F-10-04
 *
 * `POST /api/workspaces/{id}/ai/block` `{ pageId, blockId }` — 라우트는 세션만 풀고 이것을 부른다(시험이 같은 길을 Next 없이).
 *
 * 거부는 JSON(`{ ok: false, error }`) — 공급자 없음 503 `ai_unavailable` · 꺼짐 403 `ai_disabled` · 게스트 403 `forbidden` · 볼 수 없는 페이지 ·
 * 그 페이지에 없는 블록 404 `not_found` · 보기 · 코멘트 · 제안만 · 잠긴 페이지 403 `cannot_edit` · 직접 지시가 비었다 400 `instruction_missing` ·
 * 원문이 모자라다 400 `not_enough_content` · 틀만으로 넘친다 400 `input_too_long` · 모양 400 `invalid_input` · 한도 429 `ai_limit_reached`(+ `limit` ·
 * `resetsAt`) · 공급자가 처음부터 거절 503 `ai_busy` / 502 `ai_provider_failed`. **한도 말고는 모두 예약 전 · 공급자 전이다**(세지 않는다).
 *
 * 종류 · 지시는 **서버 본문의 그 블록에서** 읽는다(편집기가 보낸 것을 믿지 않는다). 문맥은 그 페이지의 원문에서 AI 블록을 모두 뺀 것이다
 * (`block-source.ts` — 자기 · 다른 AI 블록 · 그 결과).
 *
 * 통과하면 SSE — AI-2 와 같은 사건이다:
 *
 *   event: delta  data: {"text":"…"}                      글 조각(편집기는 블록 안의 미리보기에만 — 문서 밖)
 *   event: done   data: {"status":"completed","truncated","generatedAt","usage","remaining","quota"}   결과를 쓴 뒤
 *   event: error  data: {"error":"ai_provider_failed"|"ai_busy","reason"} 도중의 실패(셈에서 빠진다 · 쓰지 않는다)
 *                 data: {"error":"block_gone"|"cannot_edit"|"write_failed"}   다 받았지만 쓰지 못했다(응답은 셈에 든다)
 *
 * 다 받으면 **서버가 쓴다** — 본문 세션(경로 ②) 하나 · `doc_update.origin = 'ai'` · 행위자는 부른 사람: 그 블록의 자식을 답(마크다운 → 블록 ·
 * 가져오기의 변환기)으로 갈고 `generatedAt` · `sourceHash`(읽은 원문) · `resultHash`(쓴 자식을 다시 읽은 글)를 적는다. 할 일 뽑기는 할 일만 남긴다.
 * 사람이 멈추면(연결을 닫는다) `stopped`(셈에 든다) · 아무것도 쓰지 않는다(전의 결과가 그대로다). 출력 상한에 닿으면 받은 데까지 쓴다.
 */

import { readBodyIn } from '../api/block-body.ts'
import { AI_BLOCK_TYPE, type AiBlockKind } from '../block/ai-block.ts'
import type { SessionContext } from '../auth/session-context.ts'
import { openPageBody } from '../block/body-write.ts'
import { plainTitleOf } from '../block/page.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import type { EditorBlock } from '../editor/document.ts'
import { containerFor } from '../editor/pm-adapter.ts'
import { findContainerById } from '../editor/pm-blocks.ts'
import { blockSchema } from '../editor/schema.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { isLocked } from '../permissions/lock.ts'
import { AI_BLOCK_MIN_SOURCE, aiBlockResultBlocks, buildAiBlockMessages } from './block-prompt.ts'
import { aiResultText, aiSourceLines, aiTextHash, findBlockIn, readAiBlock } from './block-source.ts'
import { expandSyncedForReader } from './synced-source.ts'
import type { AiCompleteOptions } from './complete-http.ts'
import { maxOutputChars, readAiConfig, type AiConfig } from './config.ts'
import { AiProviderError, openChatStream, type ChatMessage, type ChatStreamEvent } from './provider.ts'
import { aiFailureStatus, aiProviderFailureError, aiProviderFailureStatus } from './request.ts'
import type { TokenUsage } from './sse.ts'
import { aiEntryFor, aiQuotaViewFor, finishAiResponse, reserveAiResponse, type AiOutcome } from './usage.ts'

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const

export type AiBlockRefusal =
  | 'ai_unavailable'
  | 'ai_disabled'
  | 'forbidden'
  | 'not_found'
  | 'cannot_edit'
  | 'instruction_missing'
  | 'not_enough_content'
  | 'input_too_long'
  | 'invalid_input'

const refuse = (error: AiBlockRefusal) => Response.json({ ok: false, error }, { status: aiFailureStatus(error) })

/** 요청의 모양 — 페이지 · 블록(uuid). 틀리면 null. 종류 · 지시는 받지 않는다(서버 본문에서 읽는다). */
export function parseAiBlockInput(raw: unknown): { readonly pageId: string; readonly blockId: string } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const b = raw as Record<string, unknown>
  if (typeof b.pageId !== 'string' || !isUuid(b.pageId) || typeof b.blockId !== 'string' || !isUuid(b.blockId)) return null
  return { pageId: b.pageId.toLowerCase(), blockId: b.blockId.toLowerCase() }
}

type Prepared = { readonly kind: AiBlockKind; readonly messages: readonly ChatMessage[]; readonly sourceHash: string }

/** 부르기 전의 판정과 문맥 — 스위치 · 그 사람 · 볼 수 있는가 · 고칠 수 있는가 · 그 블록 · 지시 · 원문의 양. 아무것도 쓰지 않는다. */
async function prepare(
  ctx: SessionContext,
  pageId: string,
  blockId: string,
  config: AiConfig,
): Promise<{ readonly ok: true; readonly value: Prepared } | { readonly ok: false; readonly error: AiBlockRefusal }> {
  const entry = await aiEntryFor(ctx, config)
  if (entry.state !== 'ready') {
    return { ok: false, error: entry.state === 'disabled' ? 'ai_disabled' : entry.state === 'forbidden' ? 'forbidden' : 'ai_unavailable' }
  }
  return withReadTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ properties: { title?: unknown } | null }>(
      `SELECT properties FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
      [pageId, ctx.workspaceId],
    )
    if (row === null) return { ok: false, error: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, pageId)
    if (!can(caps, 'view')) return { ok: false, error: 'not_found' } as const
    // 결과가 그 페이지의 본문에 든다 — 고치기(AI-3)와 같은 판정(게이트가 예약할 때 다시 본다)
    if (!can(caps, 'edit_content') || (await isLocked(tx, pageId))) return { ok: false, error: 'cannot_edit' } as const
    const doc = await readBodyIn(tx, ctx, pageId)
    const block = findBlockIn(doc.blocks, blockId)
    if (block === null || block.type !== AI_BLOCK_TYPE) return { ok: false, error: 'not_found' } as const
    const props = readAiBlock(block.properties)
    if (props.kind === 'custom' && props.instruction.trim() === '') return { ok: false, error: 'instruction_missing' } as const
    // 프롬프트는 동기화 블록 사본을 편 원문(요청자가 원본을 볼 수 있을 때만 — SB-5 · ⑲) · 해시는 펴기 전의 원문(편집기가 같은 값을 짓는다)
    const lines = aiSourceLines((await expandSyncedForReader(tx, ctx, doc)).blocks)
    const source = lines.join('\n')
    if (source.trim().length < AI_BLOCK_MIN_SOURCE) return { ok: false, error: 'not_enough_content' } as const
    const built = buildAiBlockMessages({ kind: props.kind, instruction: props.instruction, title: plainTitleOf(row.properties), lines }, config.maxInputChars)
    if (!built.ok) return { ok: false, error: built.error } as const
    return { ok: true, value: { kind: props.kind, messages: built.messages, sourceHash: aiTextHash(aiSourceLines(doc.blocks).join('\n')) } } as const
  })
}

type WriteOutcome = 'ok' | 'block_gone' | 'cannot_edit'

/**
 * 결과를 쓴다 — 본문 세션 하나(경로 ② · 출처 `ai`): 그 블록의 자식을 갈고 시각 · 원문 해시를 적은 뒤, **쓴 자식을 다시 읽어** 결과 해시를 적는다
 * (편집기가 같은 Y.Doc 에서 짓는 해시와 같게 — 정규화 · 원문 읽기를 지난 글). 그사이 페이지 · 블록이 사라졌거나 고칠 수 없게 됐으면 쓰지 않는다.
 */
async function writeResult(
  ctx: SessionContext,
  pageId: string,
  blockId: string,
  blocks: readonly EditorBlock[],
  stamp: { readonly generatedAt: string; readonly sourceHash: string },
): Promise<WriteOutcome> {
  return withTransaction(async (tx): Promise<WriteOutcome> => {
    // 잠금 순서 — 본문을 가진 페이지 행 → 스냅샷(`body-write.ts` ①)
    const row = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live' FOR UPDATE`,
      [pageId, ctx.workspaceId],
    )
    if (row === null) return 'block_gone'
    if (!can(await effectiveCaps(tx, ctx, pageId), 'edit_content') || (await isLocked(tx, pageId))) return 'cannot_edit'
    const body = await openPageBody(tx, ctx, pageId, 'ai')
    let props: Record<string, unknown> | null = null
    body.change((tr) => {
      const info = findContainerById(tr.doc, blockId)
      if (info === null || info.contentNode.type.name !== AI_BLOCK_TYPE) return
      props = { ...(info.contentNode.attrs.props as Record<string, unknown>), generatedAt: stamp.generatedAt, sourceHash: stamp.sourceHash, resultHash: null }
      const head = info.contentNode.type.create({ ...info.contentNode.attrs, props })
      const kids = blocks.map((b) => containerFor(b))
      const content = kids.length > 0 ? [head, blockSchema.nodes.blockGroup!.create(null, kids)] : [head]
      tr.replaceWith(info.pos, info.pos + info.node.nodeSize, info.node.type.create(info.node.attrs, content))
    })
    const base = props as Record<string, unknown> | null
    if (base === null) return 'block_gone'
    const written = findBlockIn(body.read().blocks, blockId)
    const resultHash = aiTextHash(aiResultText(written?.children ?? []))
    body.change((tr) => {
      const info = findContainerById(tr.doc, blockId)
      if (info === null) return
      tr.setNodeMarkup(info.contentPos, undefined, { ...info.contentNode.attrs, props: { ...base, resultHash } })
    })
    const result = await body.finish({ origin: 'ai' })
    if (!result.ok) throw new Error(`AI 블록의 투영이 거부됐다(${result.reason}): ${pageId}`)
    return 'ok'
  })
}

const failureOf = (e: unknown): AiProviderError => (e instanceof AiProviderError ? e : new AiProviderError('network'))

/** 만든다(머리말) — 거부는 JSON · 통과하면 SSE. */
export async function aiBlockResponse(ctx: SessionContext, raw: unknown, signal: AbortSignal, options: AiCompleteOptions = {}): Promise<Response> {
  const config = options.config === undefined ? readAiConfig() : options.config
  const clock = options.now ?? (() => new Date())
  if (config === null) return refuse('ai_unavailable')
  const input = parseAiBlockInput(raw)
  if (input === null) return refuse('invalid_input')
  const prepared = await prepare(ctx, input.pageId, input.blockId, config)
  if (!prepared.ok) return refuse(prepared.error)
  const { kind, messages, sourceHash } = prepared.value

  // 예약 — 공급자를 부르기 전에(절대 제약 2 · 게이트가 스위치 · 권한 · 잠금 · 한도를 한 트랜잭션에서 다시 본다)
  const reserved = await reserveAiResponse(ctx, { feature: 'block', pageId: input.pageId }, { config, now: clock() })
  if (!reserved.ok) {
    if (reserved.reason !== 'ai_limit_reached') return Response.json({ ok: false, error: reserved.reason }, { status: aiFailureStatus(reserved.reason) })
    const retryAfter = reserved.resetsAt === null ? null : Math.max(1, Math.ceil((Date.parse(reserved.resetsAt) - clock().getTime()) / 1000))
    return Response.json(
      { ok: false, error: 'ai_limit_reached', limit: reserved.limit, resetsAt: reserved.resetsAt },
      { status: 429, headers: retryAfter === null ? undefined : { 'retry-after': String(retryAfter) } },
    )
  }
  const reservationId = reserved.reservation.id

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
      console.error(`[ai] AI 블록 예약 ${reservationId} 을 닫지 못했다: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  let events: AsyncGenerator<ChatStreamEvent, void, undefined>
  try {
    // 모델은 게이트가 고른 것(워크스페이스 기본 · AI-7)
    events = await openChatStream({ ...config, model: reserved.reservation.model }, messages, stop.signal, options.fetchImpl)
  } catch (e) {
    const failure = failureOf(e)
    await finish(failure.reason === 'aborted' ? 'stopped' : 'failed', null)
    if (failure.reason !== 'aborted') console.warn(`[ai] 공급자가 거절했다(AI 블록): ${failure.reason}${failure.status === null ? '' : ` (${failure.status})`}`)
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
      let answer = ''
      let truncated = false
      let usage: TokenUsage | null = null
      try {
        let received = false
        try {
          for await (const event of events) {
            if (event.type === 'end') {
              usage = event.usage
              if (event.finishReason === 'length') truncated = true
              break
            }
            // 출력 상한 — 남은 자리만 받고 끊는다(받은 데까지가 답이다)
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
          received = true
        } catch (e) {
          const failure = failureOf(e)
          if (failure.reason === 'aborted') {
            await finish('stopped', usage)
          } else {
            await finish('failed', null)
            console.warn(`[ai] 공급자가 도중에 실패했다(AI 블록): ${failure.reason}`)
            write('error', { error: aiProviderFailureError(failure.reason), reason: failure.reason, retryAfter: failure.retryAfterSeconds })
          }
        }
        if (!received) return
        await finish('completed', usage)

        // 다 받았다 — 서버가 쓴다(사람이 그사이 끊어도 받은 답은 쓴다 · 셈에 들었다)
        const generatedAt = clock().toISOString()
        let outcome: WriteOutcome
        try {
          outcome = await writeResult(ctx, input.pageId, input.blockId, aiBlockResultBlocks(answer, kind), { generatedAt, sourceHash })
        } catch (e) {
          console.error(`[ai] AI 블록의 결과를 쓰지 못했다: ${e instanceof Error ? e.message : String(e)}`)
          write('error', { error: 'write_failed' })
          return
        }
        if (outcome !== 'ok') {
          write('error', { error: outcome })
          return
        }
        const quota = await aiQuotaViewFor(ctx.workspaceId, clock()).catch(() => null)
        write('done', { status: 'completed', truncated, generatedAt, usage, remaining: quota?.remaining ?? null, quota })
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
