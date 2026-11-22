/**
 * AI 채팅 — 화면 쪽: 한 턴의 스트림 읽기 (AI-6 · F-10-17 · 브라우저 · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑪
 *
 * `POST …/ai/chat` 의 SSE(`session` → `delta`… → `done` | `error` — `chat-http.ts` 머리말)를 읽는다. 거부(JSON) · 실패의 말은 AI-2 의
 * 것을 그대로 쓴다(`askFailureOf` · `askFailureMessage`). 던지지 않는다.
 */

import { askFailureMessage, askFailureOf, type AskFailure } from './ask-client.ts'
import { readChatSources, type ChatScope, type ChatSource } from './chat-shared.ts'
import type { AiQuotaView } from './quota.ts'
import { createSseParser } from './sse.ts'

/** 한 턴의 본문 — `model` 은 고른 모델(AI-7 · null = 자동 · 없으면 대화의 것). */
export type ChatTurnRequest = { readonly sessionId: string | null; readonly message: string; readonly scope: ChatScope; readonly model?: string | null }

/** 맨 먼저 오는 사건 — 대화가 섰다(첫 턴이면 새로 만들었다) · 이 턴을 쓰는 모델. */
export type ChatOpened = { readonly sessionId: string; readonly title: string; readonly created: boolean; readonly messageId: string; readonly model: string | null }

/** 채팅의 실패 — AI-2 의 것 + 허용 밖의 모델(AI-7 · 400 `model_not_allowed`). */
export type ChatFailure = AskFailure | { readonly kind: 'model_not_allowed' }

export type ChatOutcome =
  | {
      readonly kind: 'done'
      readonly truncated: boolean
      readonly quota: AiQuotaView | null
      readonly sources: ChatSource[]
      readonly messageId: string | null
      readonly model: string | null
    }
  | { readonly kind: 'failed'; readonly failure: ChatFailure }
  | { readonly kind: 'aborted' }

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** 거부의 JSON → 채팅의 실패. */
export function chatFailureOf(body: unknown): ChatFailure {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  return b.error === 'model_not_allowed' ? { kind: 'model_not_allowed' } : askFailureOf(body)
}

/** 실패의 말 — 모델이 허용 밖이면 그 말 · 나머지는 AI-2 의 것. */
export function chatFailureMessage(f: ChatFailure): string {
  return f.kind === 'model_not_allowed' ? '그 모델은 이 워크스페이스에서 쓸 수 없습니다 — 다른 모델을 고르세요.' : askFailureMessage(f)
}

/** 사건 하나를 읽는다 — `session` 이면 그 모양 · 아니면 null. */
export function chatOpenedOf(data: unknown): ChatOpened | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (typeof d.sessionId !== 'string' || typeof d.title !== 'string' || typeof d.messageId !== 'string') return null
  return { sessionId: d.sessionId, title: d.title, created: d.created === true, messageId: d.messageId, model: typeof d.model === 'string' ? d.model : null }
}

/**
 * 한 턴을 보내고 답을 읽는다 — `session` 이면 `onOpened` · 조각마다 `onDelta`. 멈추면(`signal`) 연결을 닫는다(서버가 stopped 로 적는다).
 */
export async function streamChat(
  workspaceId: string,
  body: ChatTurnRequest,
  signal: AbortSignal,
  handlers: { readonly onOpened: (opened: ChatOpened) => void; readonly onDelta: (text: string) => void },
  fetchImpl: FetchLike = fetch,
): Promise<ChatOutcome> {
  let res: Response
  try {
    res = await fetchImpl(`/api/workspaces/${workspaceId}/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    return signal.aborted ? { kind: 'aborted' } : { kind: 'failed', failure: { kind: 'network' } }
  }
  if (!res.ok || res.body === null) {
    const json = await res.json().catch(() => null)
    return { kind: 'failed', failure: json === null ? { kind: res.status >= 500 ? 'provider' : 'network' } : chatFailureOf(json) }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  try {
    for (;;) {
      const chunk = await reader.read()
      const events = chunk.done ? [...parser.push(decoder.decode()), ...parser.end()] : parser.push(decoder.decode(chunk.value, { stream: true }))
      for (const event of events) {
        let data: Record<string, unknown>
        try {
          data = JSON.parse(event.data) as Record<string, unknown>
        } catch {
          continue
        }
        if (event.event === 'session') {
          const opened = chatOpenedOf(data)
          if (opened !== null) handlers.onOpened(opened)
        } else if (event.event === 'delta' && typeof data.text === 'string') handlers.onDelta(data.text)
        else if (event.event === 'done') {
          return {
            kind: 'done',
            truncated: data.truncated === true,
            quota: (data.quota as AiQuotaView | null | undefined) ?? null,
            sources: readChatSources(data.sources),
            messageId: typeof data.messageId === 'string' ? data.messageId : null,
            model: typeof data.model === 'string' ? data.model : null,
          }
        } else if (event.event === 'error') return { kind: 'failed', failure: askFailureOf(data) }
      }
      if (chunk.done) return signal.aborted ? { kind: 'aborted' } : { kind: 'failed', failure: { kind: 'network' } }
    }
  } catch {
    return signal.aborted ? { kind: 'aborted' } : { kind: 'failed', failure: { kind: 'network' } }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

/** 출처 칩의 글 — `[n] 제목`(비면 "제목 없음"). */
export const sourceChipText = (s: Pick<ChatSource, 'n' | 'title'>): string => `[${s.n}] ${s.title.trim() === '' || s.title === '(untitled)' ? '제목 없음' : s.title}`
