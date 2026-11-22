/**
 * 페이지 번역 — 미리 보기 · 게이트 → 새 하위 페이지 → 청크마다 예약 · 공급자 · 끝 → 번역본의 본문 (AI-4 · F-10-03 · F-10-12)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ② ④ ⑥ ⑨ · CLAUDE.md 절대 제약 2 · 10-ai-features.md F-10-03
 *
 * `GET  /api/workspaces/{id}/ai/translate?pageId&language` — 미리 보기(부르지 않는다 · 예약하지 않는다): `{ ok, chunks, units, remaining, quota }`.
 * `POST /api/workspaces/{id}/ai/translate` `{ pageId, language }` — 번역. 라우트는 세션만 풀고 이것을 부른다(시험이 같은 길을 Next 없이).
 *
 * 거부는 JSON(`{ ok: false, error }`) — 공급자 없음 503 `ai_unavailable` · 꺼짐 403 `ai_disabled` · 게스트 403 `forbidden` · 볼 수 없는 페이지 404
 * `not_found` · 그 아래에 페이지를 만들 수 없다 403 `cannot_create`(`create_child` · `edit_content` · 깊이 — 잠금은 하위 페이지 만들기를 막지
 * 않는다 · 정본 [보강] 잠금 ③) · 본문에 번역할 글이 없다 400 `empty_page`(부르지 않는다) · 모든 단위가 너무 길다 400 `input_too_long` · 모양 400
 * `invalid_input` · **남은 응답이 청크 수보다 적다 429 `not_enough_quota` + `needed` · `remaining`**(시작하지 않는다 — 닫힌 쪽으로). 이 거부들은
 * 공급자를 부르기 전이고 아무것도 쓰지 않는다.
 *
 * 통과하면 **번역본 페이지를 먼저 만들고**(원본의 하위 · 제목 `원래 제목 (언어)` · 앱의 페이지 만들기 명령) SSE 로 흐른다:
 *
 *   event: progress  data: {"pageId","done","total","translated","skipped"}     청크 하나가 끝날 때마다(처음은 done 0)
 *   event: wait      data: {"seconds"}                                         공급자가 바빠(429) 기다린다(청크마다 두 번까지)
 *   event: done      data: {"status":"completed"|"partial","pageId","translated","skipped","untranslated","done","total",
 *                          "failedFrom"?,"reason"?,"limit"?,"resetsAt"?,"remaining","quota"}
 *   event: error     data: {"error":"page_gone"|"write_failed","pageId"}            번역본을 쓰지 못했다
 *
 * **청크마다 예약한다**(`reserveAiResponse` · 기능 `translate` · 원본 페이지 — 볼 수 있는지 다시 본다) → 공급자 → `finishAiResponse`. 한도에 닿으면
 * 멈춘다(`limit`) · 공급자가 바쁘면 `retryAfter`(최대 20초)를 기다려 같은 청크를 두 번까지 다시(그래도 바쁘면 `busy`) · 그 밖의 실패는 멈춘다
 * (`provider` — 그 예약은 `failed` · 셈에서 빠진다). 사람이 끊으면(요청의 신호 · 스트림 취소) 흐르던 청크는 `stopped`(셈에 든다)이고 거기서
 * 멈춘다.
 *
 * 다 끝나면(멈췄어도) **본문을 한 번에 쓴다** — 번역본 페이지의 본문 세션(경로 ②) · `doc_update.origin = 'ai'` · 행위자는 부른 사람. 같은
 * 구조 · 종류 · 속성 · 새 블록 id(`buildTranslatedDoc`) — 멈췄으면 번역한 데까지 + 나머지는 원문 + 맨 위에 "번역이 N/M 에서 멈췄습니다" 콜아웃.
 * 제목은 번역한 제목 + ` (언어)`. 원본은 하위 페이지 참조 한 줄 말고는 바뀌지 않는다.
 */

import { randomUUID } from 'node:crypto'

import { readBodyIn } from '../api/block-body.ts'
import type { SessionContext } from '../auth/session-context.ts'
import { openPageBody } from '../block/body-write.ts'
import { MAX_TITLE_LENGTH, PageError, createPage, readTitle, renamePageIn, titleFromPlainText } from '../block/page.ts'
import { MAX_TREE_DEPTH } from '../block/types.ts'
import { toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import { wrapUnknownTypes, type EditorDoc } from '../editor/document.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import { asBlockId, isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { isLocked } from '../permissions/lock.ts'
import type { AiCompleteOptions } from './complete-http.ts'
import { maxOutputChars, readAiConfig, type AiConfig } from './config.ts'
import { EDIT_LANGUAGE_LABEL, isEditLanguage, type EditLanguage } from './edit-prompt.ts'
import { AiProviderError, openChatStream } from './provider.ts'
import { aiFailureStatus } from './request.ts'
import type { TokenUsage } from './sse.ts'
import {
  buildTranslatedDoc,
  collectUnits,
  hasBodyUnits,
  planChunks,
  readTranslation,
  stopNotice,
  translateMessages,
  translatedTitle,
  type TranslatePlan,
  type TranslateStop,
  type TranslateUnit,
} from './translate-plan.ts'
import { aiEntryFor, aiQuotaViewFor, finishAiResponse, reserveAiResponse, type AiOutcome } from './usage.ts'

/** 공급자가 바쁠 때 한 청크를 다시 보내는 횟수 · 한 번 기다리는 최대 초. */
export const TRANSLATE_BUSY_RETRIES = 2
export const TRANSLATE_BUSY_WAIT_MAX = 20
const BUSY_WAIT_DEFAULT = 5

export type AiTranslateOptions = AiCompleteOptions & {
  /** 기다리기 — 시험은 기다리지 않는다. 멈추면(신호) false. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<boolean>
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const

export type TranslateRefusal =
  | 'ai_unavailable'
  | 'ai_disabled'
  | 'forbidden'
  | 'not_found'
  | 'cannot_create'
  | 'empty_page'
  | 'input_too_long'
  | 'invalid_input'

export const translateFailureStatus = (error: string): number =>
  error === 'cannot_create' ? 403 : error === 'not_enough_quota' ? 429 : aiFailureStatus(error)

const refuse = (error: TranslateRefusal) => Response.json({ ok: false, error }, { status: translateFailureStatus(error) })

/** 요청의 모양 — 페이지(uuid) · 언어(고치기의 일곱 언어). 틀리면 null. */
export function parseTranslateInput(raw: unknown): { readonly pageId: string; readonly language: EditLanguage } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const b = raw as Record<string, unknown>
  if (typeof b.pageId !== 'string' || !isUuid(b.pageId) || !isEditLanguage(b.language)) return null
  return { pageId: b.pageId.toLowerCase(), language: b.language }
}

type Prepared = { readonly title: RichTextRun[]; readonly doc: EditorDoc; readonly units: TranslateUnit[]; readonly plan: TranslatePlan }

/** 부르기 전의 판정과 원문 — 스위치 · 그 사람 · 원본을 볼 수 있는가 · 그 아래에 만들 수 있는가 · 번역할 글. */
async function prepare(
  ctx: SessionContext,
  pageId: string,
  language: EditLanguage,
  config: AiConfig,
): Promise<{ readonly ok: true; readonly value: Prepared } | { readonly ok: false; readonly error: TranslateRefusal }> {
  const entry = await aiEntryFor(ctx, config)
  if (entry.state !== 'ready') {
    return { ok: false, error: entry.state === 'disabled' ? 'ai_disabled' : entry.state === 'forbidden' ? 'forbidden' : 'ai_unavailable' }
  }
  return withReadTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ properties: { title?: unknown } | null; ancestor_path: string[] }>(
      `SELECT properties, ancestor_path FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
      [pageId, ctx.workspaceId],
    )
    if (row === null) return { ok: false, error: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, pageId)
    if (!can(caps, 'view')) return { ok: false, error: 'not_found' } as const
    // 번역본은 그 아래의 새 페이지다 — 만들 수 있고(하위 페이지 만들기와 같은 규칙 · 깊이) 그 본문을 쓸 수 있어야 한다(상속 · 같은 권한)
    if (!can(caps, 'create_child') || !can(caps, 'edit_content') || row.ancestor_path.length + 1 >= MAX_TREE_DEPTH) {
      return { ok: false, error: 'cannot_create' } as const
    }
    const title = readTitle(row.properties)
    const doc = await readBodyIn(tx, ctx, pageId)
    const units = collectUnits(title, doc)
    if (!hasBodyUnits(units)) return { ok: false, error: 'empty_page' } as const
    const plan = planChunks(units, language, config)
    if (plan.chunks.length === 0) return { ok: false, error: 'input_too_long' } as const
    return { ok: true, value: { title, doc, units, plan } } as const
  })
}

/** 미리 보기 — 청크 수(= 쓸 응답 수) · 남은 응답. 부르지 않고 예약하지 않는다. */
export async function aiTranslateEstimate(ctx: SessionContext, raw: unknown, options: AiTranslateOptions = {}): Promise<Response> {
  const config = options.config === undefined ? readAiConfig() : options.config
  if (config === null) return refuse('ai_unavailable')
  const input = parseTranslateInput(raw)
  if (input === null) return refuse('invalid_input')
  const prepared = await prepare(ctx, input.pageId, input.language, config)
  if (!prepared.ok) return refuse(prepared.error)
  const quota = await aiQuotaViewFor(ctx.workspaceId, (options.now ?? (() => new Date()))())
  return Response.json({ ok: true, chunks: prepared.value.plan.chunks.length, units: prepared.value.units.length, remaining: quota.remaining, quota })
}

/** 제목의 상한 — 넘으면 원래 글을 줄이고 언어 꼬리표는 남긴다. */
function titleWithin(runs: RichTextRun[], language: EditLanguage): RichTextRun[] {
  const plain = toPlainText(runs)
  if (plain.length <= MAX_TITLE_LENGTH) return runs
  const tail = ` (${EDIT_LANGUAGE_LABEL[language]})`
  return titleFromPlainText(`${plain.slice(0, MAX_TITLE_LENGTH - tail.length)}${tail}`)
}

const abortableSleep = (ms: number, signal: AbortSignal): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve(false)
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })

const failureOf = (e: unknown): AiProviderError => (e instanceof AiProviderError ? e : new AiProviderError('network'))

type StopInfo = {
  readonly reason: TranslateStop
  readonly limit?: string
  readonly resetsAt?: string | null
  readonly retryAfter?: number | null
}

/** 번역본을 쓴다 — 본문 세션(출처 `ai`) · 제목. 그사이 페이지가 사라졌거나 고칠 수 없게 됐으면 false. */
async function writeTranslation(ctx: SessionContext, pageId: string, doc: EditorDoc, title: RichTextRun[]): Promise<boolean> {
  return withTransaction(async (tx) => {
    // 잠금 순서 — 본문을 가진 페이지 행 → 스냅샷(`body-write.ts` ①)
    const row = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live' FOR UPDATE`,
      [pageId, ctx.workspaceId],
    )
    if (row === null || !can(await effectiveCaps(tx, ctx, pageId), 'edit_content') || (await isLocked(tx, pageId))) return false
    const body = await openPageBody(tx, ctx, pageId, 'ai')
    const next = docToPm(wrapUnknownTypes(doc))
    body.change((tr) => {
      tr.replaceWith(0, tr.doc.content.size, next.content)
    })
    const result = await body.finish({ origin: 'ai' })
    if (!result.ok) throw new Error(`번역본의 투영이 거부됐다(${result.reason}): ${pageId}`)
    await renamePageIn(tx, ctx, asBlockId(pageId), title)
    return true
  })
}

/**
 * 번역한다 — 거부는 JSON · 통과하면 번역본 페이지를 만들고 SSE(머리말).
 *
 * @param signal 요청의 신호 — 사람이 끊으면 흐르던 청크를 멈추고(`stopped`) 거기까지로 번역본을 쓴다
 */
export async function aiTranslateResponse(ctx: SessionContext, raw: unknown, signal: AbortSignal, options: AiTranslateOptions = {}): Promise<Response> {
  const config = options.config === undefined ? readAiConfig() : options.config
  const clock = options.now ?? (() => new Date())
  const sleep = options.sleep ?? abortableSleep
  if (config === null) return refuse('ai_unavailable')
  const input = parseTranslateInput(raw)
  if (input === null) return refuse('invalid_input')
  const prepared = await prepare(ctx, input.pageId, input.language, config)
  if (!prepared.ok) return refuse(prepared.error)
  const { title, doc, units, plan } = prepared.value
  const { language } = input
  const total = plan.chunks.length

  // 남은 응답이 모자라면 시작하지 않는다(닫힌 쪽으로) — 청크마다 다시 예약한다(그사이 다른 사람이 쓸 수 있다)
  const before = await aiQuotaViewFor(ctx.workspaceId, clock())
  if (before.remaining !== null && before.remaining < total) {
    return Response.json({ ok: false, error: 'not_enough_quota', needed: total, remaining: before.remaining }, { status: 429 })
  }

  // 번역본 페이지를 먼저 — 번역하는 동안에도 사이드바 · 원본 본문에 선다(앱의 페이지 만들기 명령 · 원본 본문에 참조 한 줄)
  let pageId: string
  try {
    pageId = (await createPage(ctx, { parentPageId: asBlockId(input.pageId), title: titleWithin(translatedTitle(title, null, language), language) })).id
  } catch (e) {
    if (e instanceof PageError) return refuse('cannot_create')
    throw e
  }

  const stop = new AbortController()
  const onAbort = () => stop.abort()
  if (signal.aborted) stop.abort()
  else signal.addEventListener('abort', onAbort, { once: true })
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
      const finish = async (reservationId: string, outcome: AiOutcome, usage: TokenUsage | null) => {
        try {
          await finishAiResponse(reservationId, outcome, usage, clock())
        } catch (e) {
          // 닫지 못한 예약은 `reserved` 로 남아 셈에 든다(닫힌 쪽으로 실패한다)
          console.error(`[ai] 번역 예약 ${reservationId} 을 닫지 못했다: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      /** 공급자에 한 번 — 답(받은 데까지) 또는 실패. */
      const callOnce = async (
        chunk: readonly TranslateUnit[],
        model: string,
      ): Promise<{ readonly ok: true; readonly text: string; readonly usage: TokenUsage | null } | { readonly ok: false; readonly failure: AiProviderError; readonly usage: TokenUsage | null }> => {
        let usage: TokenUsage | null = null
        try {
          // 모델은 청크의 예약이 고른 것(워크스페이스 기본 · AI-7)
          const events = await openChatStream({ ...config, model }, translateMessages(language, chunk), stop.signal, options.fetchImpl)
          let text = ''
          for await (const event of events) {
            if (event.type === 'end') {
              usage = event.usage
              break
            }
            text += event.text
            // 출력 상한의 안전망 — 넘으면 끊는다(잘린 JSON 이라 그 청크는 원문으로 남는다)
            if (text.length > cap) break
          }
          return { ok: true, text, usage }
        } catch (e) {
          return { ok: false, failure: failureOf(e), usage }
        }
      }

      /** 청크 하나 — 예약 → 공급자 → 끝. 바쁘면 기다려 다시(두 번까지). */
      const translateChunk = async (
        chunk: readonly TranslateUnit[],
      ): Promise<{ readonly ok: true; readonly runs: Map<number, RichTextRun[]> } | { readonly ok: false; readonly stop: StopInfo }> => {
        for (let attempt = 0; ; attempt += 1) {
          if (stop.signal.aborted) return { ok: false, stop: { reason: 'stopped' } }
          const reserved = await reserveAiResponse(ctx, { feature: 'translate', pageId: input.pageId }, { config, now: clock() })
          if (!reserved.ok) {
            if (reserved.reason === 'ai_limit_reached') return { ok: false, stop: { reason: 'limit', limit: reserved.limit, resetsAt: reserved.resetsAt } }
            return { ok: false, stop: { reason: 'unavailable' } }
          }
          const id = reserved.reservation.id
          const answer = await callOnce(chunk, reserved.reservation.model)
          if (answer.ok) {
            await finish(id, 'completed', answer.usage)
            return { ok: true, runs: readTranslation(answer.text, chunk) }
          }
          if (answer.failure.reason === 'aborted') {
            await finish(id, 'stopped', answer.usage)
            return { ok: false, stop: { reason: 'stopped' } }
          }
          await finish(id, 'failed', null)
          const busy = answer.failure.reason === 'rate_limited'
          if (!busy || attempt >= TRANSLATE_BUSY_RETRIES) {
            if (!busy) console.warn(`[ai] 번역 청크가 실패했다: ${answer.failure.reason}`)
            return { ok: false, stop: { reason: busy ? 'busy' : 'provider', retryAfter: answer.failure.retryAfterSeconds } }
          }
          const seconds = Math.min(answer.failure.retryAfterSeconds ?? BUSY_WAIT_DEFAULT, TRANSLATE_BUSY_WAIT_MAX)
          write('wait', { seconds })
          if (!(await sleep(seconds * 1000, stop.signal))) return { ok: false, stop: { reason: 'stopped' } }
        }
      }

      const translations = new Map<number, RichTextRun[]>()
      let done = 0
      let skipped = plan.tooLong.length
      let stopped: StopInfo | null = null
      write('progress', { pageId, done: 0, total, translated: 0, skipped })
      try {
        for (const chunk of plan.chunks) {
          const outcome = await translateChunk(chunk)
          if (!outcome.ok) {
            stopped = outcome.stop
            break
          }
          for (const [key, runs] of outcome.runs) translations.set(key, runs)
          skipped += chunk.length - outcome.runs.size
          done += 1
          write('progress', { pageId, done, total, translated: translations.size, skipped })
        }
      } catch (e) {
        // DB · 예기치 않은 오류 — 거기까지로 쓴다
        console.error(`[ai] 번역이 도중에 멈췄다: ${e instanceof Error ? e.message : String(e)}`)
        stopped ??= { reason: 'provider' }
      } finally {
        signal.removeEventListener('abort', onAbort)
      }

      try {
        const titleUnit = units.find((u) => u.target.kind === 'title')
        const translatedTitleRuns = titleUnit === undefined ? null : (translations.get(titleUnit.key) ?? null)
        const body = buildTranslatedDoc(doc, units, translations, randomUUID)
        const blocks = stopped === null ? body.blocks : [stopNotice(randomUUID(), done, total, stopped.reason), ...body.blocks]
        const written = await writeTranslation(ctx, pageId, { blocks }, titleWithin(translatedTitle(title, translatedTitleRuns, language), language))
        if (!written) {
          write('error', { error: 'page_gone', pageId })
        } else {
          const quota = await aiQuotaViewFor(ctx.workspaceId, clock()).catch(() => null)
          const untranslated = plan.chunks.slice(done).reduce((n, c) => n + c.length, 0)
          write('done', {
            status: stopped === null ? 'completed' : 'partial',
            pageId,
            translated: translations.size,
            skipped,
            untranslated,
            done,
            total,
            ...(stopped === null ? {} : { failedFrom: done, ...stopped }),
            remaining: quota?.remaining ?? null,
            quota,
          })
        }
      } catch (e) {
        console.error(`[ai] 번역본을 쓰지 못했다: ${e instanceof Error ? e.message : String(e)}`)
        write('error', { error: 'write_failed', pageId })
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
