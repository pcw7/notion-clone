/**
 * 가짜 AI 공급자 — OpenAI 호환 `POST …/chat/completions` 의 스트리밍만 (AI-1 · 시험 · e2e)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ① *"시험 · CI 는 진짜 공급자를 부르지 않는다(같은 모양의 가짜 서버)"*
 *
 * DB 시험 · 라우트 시험 · e2e 러너가 같은 것을 띄운다. 답의 모양은 마지막 user 메시지에 든 표지가 고른다:
 *
 *   [slow]     0.1초마다 한 조각 · 100조각(멈추기를 볼 때 — 끊기면 `closedEarly`)
 *   [429]      429 + `Retry-After: 7` · [429reset] 429 + `x-ratelimit-reset-*` 만 · [500] 500 — 본문에 키 같은 글을 싣는다(새지 않는지 본다)
 *   [midfail]  조각 둘 뒤 스트림 안의 `error`
 *   [long]     2,000자(출력 상한을 볼 때 — `max_tokens` 를 듣지 않는다)
 *   [nodone]   `[DONE]` 없이 닫는다
 *   [md]       정해 둔 마크다운 답(`FAKE_AI_MARKDOWN` — 헤딩 · 문단 · 글머리표 · 할 일 · AI-2 의 받아들이기) — 0.06초마다 한 조각
 *   [echo]     받은 메시지들을 JSON 으로 되돌려 준다(서버가 무엇을 보냈는지 — 문맥 · 제안 글 · 자르기를 볼 때)
 *   고치기     마지막 user 메시지에 `<selection>` 이 있으면(AI-3) — 고른 글(이어서 다듬기면 `<result>` 의 앞선 결과)의 줄마다 꼴(헤딩 · 목록 ·
 *              할 일 · 인용 · 들여쓰기)을 두고 글 앞에 "고친 " 을 붙인다(코드 울타리 안은 그대로). 지시가 할 일 뽑기면 줄마다 `- [ ] 할 일: …`.
 *              0.12초마다 한 조각 · 여덟 조각(흐르는 동안을 볼 수 있게)
 *   번역       시스템 프롬프트가 번역 엔진이면(AI-4) — user 의 JSON 값마다 `[EN] ` 같은 언어 머리를 붙여 같은 열쇠의 JSON 으로(표지는
 *              그대로). 값에 `[dropkey]` 가 있으면 그 열쇠를 빼고 · `[badtag]` 면 꼬리표를 지운다(틀린 표지) · user 에 `[badjson]` 이면 JSON 이
 *              아닌 말. 0.05초마다 한 조각 · 네 조각(진행을 볼 수 있게)
 *   [429once]  처음 보는 그 요청만 429 + `Retry-After: 1`(같은 요청을 다시 보내면 답한다 — 바쁨 뒤 다시 시도를 볼 때)
 *   그 밖      `가짜 답: <질문>` — 세 조각 + (요청했으면) 사용량 조각 + `[DONE]`
 *
 * 키가 `Bearer ${FAKE_AI_KEY}` 가 아니면 401. 받은 요청은 `requests` 에 쌓인다(키 · 본문 · 도중에 끊겼는가).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const FAKE_AI_KEY = 'fake-ai-key-for-tests'
export const FAKE_AI_MODEL = 'fake-model'
/** 실패 응답의 본문에 싣는 글 — 이것이 사람에게 닿으면 공급자의 말이 샌 것이다. */
export const FAKE_AI_SECRET_BODY = 'provider-secret-detail sk-live-should-not-leak'

export type FakeAiRequest = {
  readonly authorization: string | null
  readonly body: Record<string, unknown>
  /** 다 보내기 전에 연결이 닫혔다(멈추기 · 출력 상한). */
  closedEarly: boolean
}

export type FakeAiProvider = {
  /** `AI_BASE_URL` 에 넣을 주소 — `http://127.0.0.1:<port>/v1`. */
  readonly baseUrl: string
  readonly requests: FakeAiRequest[]
  close(): Promise<void>
}

/** 보통의 답 — 질문을 되돌려 준다. */
export const fakeAnswer = (prompt: string): string => `가짜 답: ${prompt}`

/** `[md]` 의 답 — 블록으로 옮기면 heading_2 · paragraph · bulleted ×2 · paragraph · to_do 다. */
export const FAKE_AI_MARKDOWN = '## 회의 요약\n\n오늘 정한 것입니다.\n\n- 첫째 안건\n- 둘째 안건\n\n다음 할 일:\n\n- [ ] 다음 회의 잡기\n'

/** 고치기(AI-3)의 답 — 줄마다 꼴을 두고 글 앞에 "고친 "(할 일 뽑기면 `- [ ] 할 일: …`). 코드 울타리 안 · 빈 줄은 그대로. */
export function fakeEditAnswer(source: string, actionItems: boolean): string {
  const MARK = /^(\s*(?:#{1,3} |- \[[ x]\] |- |\d+\. |> )?)(.*)$/
  let inCode = false
  const out: string[] = []
  for (const line of source.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inCode = !inCode
      if (!actionItems) out.push(line)
      continue
    }
    if (actionItems) {
      const text = inCode ? line.trim() : (MARK.exec(line)?.[2] ?? line).trim()
      if (text !== '') out.push(`- [ ] 할 일: ${text}`)
      continue
    }
    const m = MARK.exec(line)
    out.push(inCode || line.trim() === '' || m === null ? line : `${m[1]}고친 ${m[2]}`)
  }
  return out.join('\n')
}

/** 마지막 user 메시지의 고치기 — 고른 글(이어서 다듬기면 앞선 결과). 아니면 null. */
function editSourceOf(prompt: string): string | null {
  const result = /<result>\n([\s\S]*?)\n<\/result>/.exec(prompt)
  if (result) return result[1]!
  return /<selection>\n([\s\S]*?)\n<\/selection>/.exec(prompt)?.[1] ?? null
}

/** 번역(AI-4)의 언어 머리 — 프롬프트의 언어 이름 → `[EN] ` 같은 머리. */
const TRANSLATE_PREFIX: Readonly<Record<string, string>> = {
  English: 'EN',
  Korean: 'KO',
  Japanese: 'JA',
  'Simplified Chinese': 'ZH',
  Spanish: 'ES',
  French: 'FR',
  German: 'DE',
}

/** 번역의 답 — 값마다 언어 머리를 붙인 같은 열쇠의 JSON(머리말의 표지). */
export function fakeTranslateAnswer(user: string, system: string): string {
  const name = /Translate every value into ([^.\n]+)\./.exec(system)?.[1] ?? 'English'
  const head = `[${TRANSLATE_PREFIX[name] ?? name}] `
  if (user.includes('[badjson]')) return '번역할 수 없습니다.'
  let values: unknown
  try {
    values = JSON.parse(user)
  } catch {
    return '{}'
  }
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(typeof values === 'object' && values !== null ? values : {})) {
    if (typeof value !== 'string' || value.includes('[dropkey]')) continue
    out[key] = head + (value.includes('[badtag]') ? value.replace(/<\/?t\d+>/g, '') : value)
  }
  return JSON.stringify(out)
}

/** `[429once]` 가 이미 한 번 막은 요청. */
const refusedOnce = new Set<string>()

function systemTextOf(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const m = messages[0] as { role?: unknown; content?: unknown } | undefined
  return m?.role === 'system' && typeof m.content === 'string' ? m.content : ''
}

/** 글을 n 조각으로(글자 단위). */
function piecesOf(text: string, n: number): string[] {
  const size = Math.ceil(text.length / n)
  return Array.from({ length: n }, (_, i) => text.slice(i * size, (i + 1) * size)).filter((s) => s !== '')
}

/** 답을 세 조각으로(가운데에서 한국어 글자가 갈려도 된다 — 조각은 글자 단위다). */
export function fakeChunks(text: string): string[] {
  const a = Math.ceil(text.length / 3)
  return [text.slice(0, a), text.slice(a, a * 2), text.slice(a * 2)].filter((s) => s !== '')
}

const chunkJson = (model: string, delta: Record<string, unknown>, finishReason: string | null) =>
  JSON.stringify({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta, finish_reason: finishReason }] })

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []
  for await (const part of req) parts.push(part as Buffer)
  try {
    const json = JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown
    return typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function lastUserText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as { role?: unknown; content?: unknown }
    if (m?.role === 'user' && typeof m.content === 'string') return m.content
  }
  return ''
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function handle(req: IncomingMessage, res: ServerResponse, record: FakeAiRequest): Promise<void> {
  if (record.authorization !== `Bearer ${FAKE_AI_KEY}`) {
    res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: FAKE_AI_SECRET_BODY } }))
    return
  }
  const prompt = lastUserText(record.body)
  const model = typeof record.body.model === 'string' ? record.body.model : FAKE_AI_MODEL
  // Groq 무료 등급의 429 머리 — Retry-After(초) 와 계속 차오르는 양동이의 reset(`1m26.4s`). [429reset] 은 Retry-After 없이
  const limitHeaders: Record<string, Record<string, string>> = {
    '[429reset]': { 'x-ratelimit-reset-requests': '1m26.4s', 'x-ratelimit-reset-tokens': '7.66s' },
    '[429]': { 'retry-after': '7', 'x-ratelimit-reset-requests': '1m26.4s' },
    '[500]': {},
  }
  if (prompt.includes('[429once]') && !refusedOnce.has(prompt)) {
    refusedOnce.add(prompt)
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' }).end(JSON.stringify({ error: { message: FAKE_AI_SECRET_BODY } }))
    return
  }
  for (const [mark, extra] of Object.entries(limitHeaders)) {
    if (prompt.includes(mark)) {
      res.writeHead(mark === '[500]' ? 500 : 429, { 'content-type': 'application/json', ...extra }).end(JSON.stringify({ error: { message: FAKE_AI_SECRET_BODY } }))
      return
    }
  }

  res.on('close', () => {
    if (!res.writableEnded) record.closedEarly = true
  })
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const send = (data: string) => {
    if (!res.destroyed) res.write(`data: ${data}\n\n`)
  }

  let pieces: string[]
  let delay = 0
  if (prompt.includes('[slow]')) {
    pieces = Array.from({ length: 100 }, (_, i) => `조각${i} `)
    delay = 100
  } else if (prompt.includes('[long]')) {
    pieces = Array.from({ length: 20 }, (_, i) => String(i % 10).repeat(100))
  } else if (prompt.includes('[md]')) {
    pieces = piecesOf(FAKE_AI_MARKDOWN, 8)
    delay = 60
  } else if (/^You are a translation engine/.test(systemTextOf(record.body))) {
    pieces = piecesOf(fakeTranslateAnswer(prompt, systemTextOf(record.body)), 4)
    delay = 50
  } else if (prompt.includes('[echo]')) {
    pieces = piecesOf(JSON.stringify(record.body.messages ?? null), 3)
  } else if (editSourceOf(prompt) !== null) {
    pieces = piecesOf(fakeEditAnswer(editSourceOf(prompt)!, /action items/i.test(systemTextOf(record.body))), 8)
    delay = 120
  } else {
    pieces = fakeChunks(fakeAnswer(prompt))
  }

  for (const [i, piece] of pieces.entries()) {
    if (res.destroyed) return
    if (prompt.includes('[midfail]') && i === 2) {
      send(JSON.stringify({ error: { message: FAKE_AI_SECRET_BODY } }))
      res.end()
      return
    }
    send(chunkJson(model, i === 0 ? { role: 'assistant', content: piece } : { content: piece }, null))
    if (delay > 0) await sleep(delay)
  }
  if (res.destroyed) return
  send(chunkJson(model, {}, 'stop'))
  const options = record.body.stream_options as { include_usage?: unknown } | undefined
  if (options?.include_usage === true) {
    const input = Math.ceil(prompt.length / 4)
    send(JSON.stringify({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: input, completion_tokens: pieces.length, total_tokens: input + pieces.length } }))
  }
  if (!prompt.includes('[nodone]')) send('[DONE]')
  res.end()
}

/** 띄운다 — 포트를 주지 않으면 빈 포트. */
export async function startFakeAiProvider(options: { readonly port?: number } = {}): Promise<FakeAiProvider> {
  const requests: FakeAiRequest[] = []
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !(req.url ?? '').endsWith('/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    void (async () => {
      const record: FakeAiRequest = { authorization: req.headers.authorization ?? null, body: await readBody(req), closedEarly: false }
      requests.push(record)
      await handle(req, res, record)
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
