/**
 * SSE 읽기 · 공급자 조각 해석 — AI-1 (F-10-09 · 순수 · 브라우저에서도 쓴다)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ① (`fetch` + SSE — 공급자 SDK 를 두지 않는다)
 *
 * 둘 다 같은 읽기를 쓴다 — 서버가 공급자(OpenAI 호환 `stream: true`)의 응답을 읽을 때, 편집기가 우리 라우트
 * (`POST …/ai/complete` 의 `event: delta|done|error`)를 읽을 때. 그래서 DB · 노드 모듈을 부르지 않는다.
 */

export type SseEvent = { readonly event: string; readonly data: string }

export type SseParser = {
  /** 받은 조각을 넣고 그 조각으로 끝난 사건들을 받는다 — 줄 · 사건이 조각 사이에서 끊겨도 된다. */
  push(chunk: string): SseEvent[]
  /** 스트림이 끝났다 — 빈 줄 없이 끝난 마지막 사건도 낸다(규격보다 너그럽다 — `data: [DONE]` 로 끝나는 공급자). */
  end(): SseEvent[]
}

const LINE_END = /\r\n|\r|\n/

/** SSE 규격의 줄 읽기 — `\r\n` · `\r` · `\n` 이 줄 끝 · `:` 로 시작하는 줄은 주석 · `data` 가 여러 줄이면 `\n` 으로 잇는다. */
export function createSseParser(): SseParser {
  let buffer = ''
  let data: string[] = []
  let event = ''

  const dispatch = (out: SseEvent[]) => {
    if (data.length > 0) out.push({ event: event === '' ? 'message' : event, data: data.join('\n') })
    data = []
    event = ''
  }
  const takeLine = (line: string, out: SseEvent[]) => {
    if (line === '') return dispatch(out)
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
  }

  return {
    push(chunk) {
      buffer += chunk
      const out: SseEvent[] = []
      for (;;) {
        const m = LINE_END.exec(buffer)
        if (m === null) break
        // `\r` 로 끝난 조각 — 다음 조각이 `\n` 으로 시작할 수 있다(한 줄 끝을 두 번 세지 않는다)
        if (m[0] === '\r' && m.index === buffer.length - 1) break
        takeLine(buffer.slice(0, m.index), out)
        buffer = buffer.slice(m.index + m[0].length)
      }
      return out
    },
    end() {
      const out: SseEvent[] = []
      if (buffer !== '') takeLine(buffer.replace(/\r$/, ''), out)
      buffer = ''
      dispatch(out)
      return out
    },
  }
}

export type TokenUsage = { readonly inputTokens: number | null; readonly outputTokens: number | null }

/** 공급자 조각 하나(`data:` 의 값)가 말하는 것. */
export type ChatChunk =
  | { readonly kind: 'done' }
  | { readonly kind: 'data'; readonly text: string; readonly finishReason: string | null; readonly usage: TokenUsage | null }
  /** 스트림 안의 오류 — 내용은 사람에게 보이지 않는다(공급자의 말을 흘리지 않는다). */
  | { readonly kind: 'error' }
  /** 읽을 수 없는 조각 — 건너뛴다(공급자의 진행 신호 따위). */
  | { readonly kind: 'ignore' }

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)

/** 사용량 — OpenAI 의 `usage`(마지막 조각) · Groq 의 `x_groq.usage`. 둘 다 없으면 null. */
function usageOf(json: Record<string, unknown>): TokenUsage | null {
  const groq = json.x_groq
  const raw = json.usage ?? (typeof groq === 'object' && groq !== null ? (groq as Record<string, unknown>).usage : undefined)
  if (typeof raw !== 'object' || raw === null) return null
  const u = raw as Record<string, unknown>
  const usage = { inputTokens: count(u.prompt_tokens), outputTokens: count(u.completion_tokens) }
  return usage.inputTokens === null && usage.outputTokens === null ? null : usage
}

/** OpenAI 호환 스트림의 조각 하나를 읽는다 — `[DONE]` · 글 조각 · 끝난 까닭 · 사용량 · 오류. */
export function readChatChunk(data: string): ChatChunk {
  if (data.trim() === '[DONE]') return { kind: 'done' }
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return { kind: 'ignore' }
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return { kind: 'ignore' }
  const obj = json as Record<string, unknown>
  if (obj.error !== undefined && obj.error !== null) return { kind: 'error' }
  const choices = Array.isArray(obj.choices) ? obj.choices : []
  let text = ''
  let finishReason: string | null = null
  for (const choice of choices) {
    if (typeof choice !== 'object' || choice === null) continue
    const c = choice as Record<string, unknown>
    const delta = c.delta
    if (typeof delta === 'object' && delta !== null) {
      const content = (delta as Record<string, unknown>).content
      if (typeof content === 'string') text += content
    }
    if (typeof c.finish_reason === 'string') finishReason = c.finish_reason
  }
  return { kind: 'data', text, finishReason, usage: usageOf(obj) }
}
