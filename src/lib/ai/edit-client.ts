/**
 * AI 로 고치기 — 편집기 쪽: 상태 기계 · 요청의 몸 · 문구 (AI-3 · F-10-02 · 브라우저 · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑤ ⑥ · 10-ai-features.md F-10-02
 *
 * 창(`ai-edit-bar.tsx`)과 함께 지연 로드된다. 묻기(`ask-client.ts`)의 상태 기계와 같은 모양이다 — 첫 상태가 메뉴(idle)다:
 *
 *   idle(메뉴) ─프리셋→ streaming ─delta…→ streaming ─done→ done
 *                         ├─멈추기→ stopped(받은 데까지 · 셈에 든다)   └─실패→ error
 *   done · stopped ─다시→ streaming(같은 프리셋 · 같은 후속 지시) · ─이어서 다듬기→ streaming(지금 결과 + 새 지시)
 *   error ─다시(되는 실패만)→ streaming
 *
 * 응답은 한 번에 하나 — streaming 중의 프리셋 · 다시는 무시한다. 차례 번호(`seq`)가 늦게 온 조각을 버린다.
 */

import { canRetry, type AskFailure, type AskPhase } from './ask-client.ts'
import type { EditFollowUp, EditParams, EditSelection } from './edit-prompt.ts'
import type { AiQuotaView } from './quota.ts'

export const AI_EDIT_TOO_LONG = '고른 글이 너무 깁니다 — 덜 골라서 다시 해 보세요.'
export const AI_EDIT_TOO_SHORT = '고칠 글을 두 글자 이상 골라 주세요.'
export const AI_EDIT_NOTHING = '고칠 수 있는 글이 없습니다 — 글을 골라 다시 해 보세요.'
/** 바꾸려는 사이에 고른 글이 바뀌었다(같이 쓰는 사람 · 내 편집) — 바꾸지 않는다(F-10-02 엣지 케이스 — 아래에 넣기로). */
export const AI_EDIT_CHANGED = '고른 글이 그사이 바뀌었습니다 — 바꾸지 않았습니다. 아래에 넣을 수는 있습니다.'
/** 글이 아닌 블록이 섞였거나 구조가 맞지 않다 — 바꾸면 그 블록이 사라진다. */
export const AI_EDIT_NOT_REPLACEABLE = '이미지 · 표 같은 블록이 섞여 있어 바꿀 수 없습니다 — 아래에 넣을 수 있습니다.'

export type EditState = {
  readonly phase: AskPhase
  /** 받은 데까지의 결과(미리보기 · 문서에 들지 않는다). */
  readonly answer: string
  /** 지금 응답의 후속 지시 — 없으면 처음 결과다. */
  readonly followUp: EditFollowUp | null
  readonly failure: AskFailure | null
  readonly quota: AiQuotaView | null
  readonly truncated: boolean
  readonly seq: number
}

export type EditEvent =
  | { readonly type: 'start' }
  | { readonly type: 'followUp'; readonly instruction: string }
  | { readonly type: 'retry' }
  | { readonly type: 'delta'; readonly seq: number; readonly text: string }
  | { readonly type: 'done'; readonly seq: number; readonly truncated: boolean; readonly quota: AiQuotaView | null }
  | { readonly type: 'stopped'; readonly seq: number }
  | { readonly type: 'failed'; readonly seq: number; readonly failure: AskFailure }

export const initialEditState: EditState = { phase: 'idle', answer: '', followUp: null, failure: null, quota: null, truncated: false, seq: 0 }

const start = (s: EditState, followUp: EditFollowUp | null): EditState => ({
  ...s,
  phase: 'streaming',
  answer: '',
  followUp,
  failure: null,
  truncated: false,
  seq: s.seq + 1,
})

export function editReducer(s: EditState, e: EditEvent): EditState {
  switch (e.type) {
    case 'start':
      return s.phase === 'idle' ? start(s, null) : s
    case 'followUp': {
      const instruction = e.instruction.trim()
      if ((s.phase !== 'done' && s.phase !== 'stopped') || instruction === '' || s.answer.trim() === '') return s
      return start(s, { result: s.answer, instruction })
    }
    case 'retry':
      if (s.phase === 'done' || s.phase === 'stopped' || (s.phase === 'error' && s.failure !== null && canRetry(s.failure))) return start(s, s.followUp)
      return s
    case 'delta':
      return s.phase === 'streaming' && e.seq === s.seq ? { ...s, answer: s.answer + e.text } : s
    case 'done':
      return s.phase === 'streaming' && e.seq === s.seq ? { ...s, phase: 'done', truncated: e.truncated, quota: e.quota ?? s.quota } : s
    case 'stopped':
      return s.phase === 'streaming' && e.seq === s.seq ? { ...s, phase: 'stopped' } : s
    case 'failed':
      return s.phase === 'streaming' && e.seq === s.seq ? { ...s, phase: 'error', failure: e.failure } : s
  }
}

/** 요청의 몸 — 프리셋과 그 값 · 고른 글 · 후속 지시. 시스템 프롬프트는 서버가 짓는다(`edit-prompt.ts`). */
export function editRequestBody(
  pageId: string,
  params: EditParams,
  selection: EditSelection,
  followUp: EditFollowUp | null,
): Record<string, unknown> {
  return {
    feature: 'edit',
    pageId,
    preset: params.preset,
    ...(params.preset === 'tone' ? { tone: params.tone } : {}),
    ...(params.preset === 'translate' ? { language: params.language } : {}),
    ...(params.preset === 'custom' ? { instruction: params.instruction } : {}),
    selection,
    ...(followUp === null ? {} : { followUp }),
  }
}
