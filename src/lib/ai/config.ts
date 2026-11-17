/**
 * AI 공급자 설정 — 서버 환경 변수 (AI-1 · F-10-12 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ① ② ③
 *
 * OpenAI 호환 Chat Completions 하나 — `AI_BASE_URL` · `AI_API_KEY` · `AI_MODEL`. 셋 중 하나라도 없으면 AI 는 꺼진 것과 같다(`null` →
 * `ai_unavailable`). 숫자 칸은 모양이 틀리거나 범위 밖이면 기본값이다(상한을 조용히 크게 잡지 않는다).
 *
 *   AI_MAX_OUTPUT_TOKENS  한 응답의 출력 상한(공급자에 `max_tokens` · 넘으면 스트림을 끊는다) — 기본 1,500
 *   AI_MAX_INPUT_CHARS    보내는 글의 상한(메시지 글자 합) — 기본 6,000
 *
 *   두 기본값은 Groq 무료 등급(openai/gpt-oss-120b)의 **분당 8,000 토큰(입력 + 출력)** 안에 응답 하나가 넉넉히 들게 정했다 — 한국어는
 *   글자 하나가 토큰 하나 안팎으로 빽빽하다(6,000자 ≈ 6,000 토큰 이하 + 출력 1,500). 요청 수(하루 1,000 · 계속 차오르는 양동이)는
 *   `AI_DAILY_CAP` 900 이 먼저 막는다.
 *   AI_DAILY_CAP          앱 전체의 UTC 하루 응답 수 — 기본 900(공급자 무료 한도보다 낮게 · 0 이면 닫는다)
 *   AI_TIMEOUT_MS         한 응답의 전체 시간 상한 — 기본 60초
 *   AI_STREAM_USAGE       `0` 이면 `stream_options.include_usage` 를 보내지 않는다(받지 않는 공급자) — 기본 보낸다
 */

export type AiConfig = {
  /** 끝의 `/` 를 뗀 주소 — `${baseUrl}/chat/completions` 로 보낸다. */
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly maxOutputTokens: number
  readonly maxInputChars: number
  readonly dailyCap: number
  readonly timeoutMs: number
  readonly streamUsage: boolean
}

export const AI_DEFAULTS = {
  maxOutputTokens: 1500,
  maxInputChars: 6000,
  dailyCap: 900,
  timeoutMs: 60_000,
} as const

type Env = Readonly<Record<string, string | undefined>>

/** 0 이상의 정수 하나 — 범위 밖 · 모양이 아니면 기본값. */
function intIn(raw: string | undefined, min: number, max: number, fallback: number): number {
  const text = (raw ?? '').trim()
  if (!/^\d{1,9}$/.test(text)) return fallback
  const n = Number(text)
  return n >= min && n <= max ? n : fallback
}

/** 환경에서 공급자 설정을 읽는다 — 주소 · 키 · 모델 중 하나라도 없거나 주소가 http(s) 가 아니면 null(`ai_unavailable`). */
export function readAiConfig(env: Env = process.env): AiConfig | null {
  const baseUrl = (env.AI_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const apiKey = (env.AI_API_KEY ?? '').trim()
  const model = (env.AI_MODEL ?? '').trim()
  if (baseUrl === '' || apiKey === '' || model === '' || model.length > 200) return null
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return {
    baseUrl,
    apiKey,
    model,
    maxOutputTokens: intIn(env.AI_MAX_OUTPUT_TOKENS, 1, 32_768, AI_DEFAULTS.maxOutputTokens),
    maxInputChars: intIn(env.AI_MAX_INPUT_CHARS, 1, 1_000_000, AI_DEFAULTS.maxInputChars),
    dailyCap: intIn(env.AI_DAILY_CAP, 0, 10_000_000, AI_DEFAULTS.dailyCap),
    timeoutMs: intIn(env.AI_TIMEOUT_MS, 1000, 600_000, AI_DEFAULTS.timeoutMs),
    streamUsage: (env.AI_STREAM_USAGE ?? '').trim() !== '0',
  }
}

/** 화면에 보일 공급자 이름 — 주소의 host(키 · 경로는 보이지 않는다). */
export function aiProviderHost(config: Pick<AiConfig, 'baseUrl'>): string {
  return new URL(config.baseUrl).host
}

/**
 * 출력 글자의 상한 — 공급자가 `max_tokens` 를 지키지 않을 때의 안전망. 토큰 하나는 글자 넷을 넘는 일이 드물다(영어 평균 ~4 · 한국어는
 * 더 적다) — 그래서 토큰 상한의 네 배에서 끊는다.
 */
export function maxOutputChars(config: Pick<AiConfig, 'maxOutputTokens'>): number {
  return config.maxOutputTokens * 4
}
