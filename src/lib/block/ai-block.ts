/**
 * AI 블록의 저장 모양 — AI-5 (정본 §3.10 [보강 AI-1] ⑩ · §3.4 [보강] AI 블록 · F-10-04 · DOM · DB 없음)
 *
 * 블록 하나(`type='ai_block'`)가 지시를 들고, **결과는 그 블록의 자식**(보통의 블록 — 문단 · 목록 · 할 일 …)이다. 내용 노드는 글이 없는
 * 원자다(편집기에서는 머리 줄 · 단추만 그린다). `properties`:
 *
 *   kind         'summary' | 'action_items' | 'custom'(모르는 값 · 없으면 custom 으로 읽는다)
 *   instruction  custom 의 지시(≤ 300자) — 다른 kind 는 쓰지 않는다
 *   generatedAt  마지막으로 만든 시각(ISO) — 없으면 아직 만들지 않았다
 *   sourceHash   만들 때 읽은 페이지 원문(AI 블록을 모두 뺀 것)의 해시 — 지금 것과 다르면 "페이지가 바뀌었습니다"
 *   resultHash   만들어 쓴 자식의 글의 해시 — 지금 자식과 다르면 사람이 고쳤다(다시 만들면 사라진다고 묻는다)
 *
 * 이 파일은 처음 받는 번들에 든다(정규화 · 검증) — 읽기(`readAiBlock`) · 해시 · 직렬화는 `ai/block-source.ts`(서버 · 지연 로드).
 */

import { isPlainRecord } from '../contracts/json-safe.ts'

export const AI_BLOCK_TYPE = 'ai_block' as const

export const AI_BLOCK_KINDS = ['summary', 'action_items', 'custom'] as const
export type AiBlockKind = (typeof AI_BLOCK_KINDS)[number]
export const isAiBlockKind = (v: unknown): v is AiBlockKind => typeof v === 'string' && (AI_BLOCK_KINDS as readonly string[]).includes(v)

/** 직접 지시의 상한(글자). */
export const AI_BLOCK_INSTRUCTION_MAX = 300
/** 시각 · 해시 칸의 상한 — 넘으면 모양이 틀린 값이다. */
export const AI_BLOCK_STAMP_MAX = 64

/** 시각 · 해시 칸 — 빈 문자열이 아니고 상한 안의 문자열(아니면 null). */
export const aiBlockStamp = (v: unknown): string | null => (typeof v === 'string' && v !== '' && v.length <= AI_BLOCK_STAMP_MAX ? v : null)

const STAMPS = ['generatedAt', 'sourceHash', 'resultHash'] as const

/**
 * 읽을 때의 정화(`block/props.ts` — 협업 참여자는 검증 없이 쓴다) — 모르는 종류 · 문자열이 아닌 지시 · 모양이 틀린 시각 · 해시(null 은 둔다)를
 * 지우고 긴 지시는 자른다. 바뀐 것이 없으면 **같은 객체**를 돌려준다.
 */
export function sanitizeAiBlockProps(props: Record<string, unknown>): Record<string, unknown> {
  let out = props
  const edit = (): Record<string, unknown> => (out === props ? (out = { ...props }) : out)
  if ('kind' in props && !isAiBlockKind(props.kind)) delete edit().kind
  const instruction = props.instruction
  if ('instruction' in props && typeof instruction !== 'string') delete edit().instruction
  else if (typeof instruction === 'string' && instruction.length > AI_BLOCK_INSTRUCTION_MAX) edit().instruction = instruction.slice(0, AI_BLOCK_INSTRUCTION_MAX)
  for (const key of STAMPS) if (key in props && props[key] !== null && aiBlockStamp(props[key]) === null) delete edit()[key]
  return out
}

/** 본문 저장의 검증(`validateDoc`) — 정화가 고칠 칸은 모양이 틀린 칸이다. */
export function validateAiBlockProperties(props: unknown, path: string): { path: string; message: string }[] {
  if (!isPlainRecord(props)) return []
  const clean = sanitizeAiBlockProps(props)
  return ['kind', 'instruction', ...STAMPS]
    .filter((key) => key in props && clean[key] !== props[key])
    .map((key) => ({ path: `${path}.${key}`, message: '모양이 틀렸습니다(종류 · 300자 이하의 지시 · 시각 · 해시 문자열)' }))
}
