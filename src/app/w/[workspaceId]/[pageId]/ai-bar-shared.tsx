'use client'

/**
 * AI 창이 함께 쓰는 것 — 단추 · 입력칸의 꼴 · 자리 재기 · 쓸 수 없을 때의 까닭 (AI-2 묻기 · AI-3 고치기)
 *
 * 두 창과 함께 지연 로드된다(`ai-ask-bar.tsx` 가 둘의 입구다 — 지연 로드 모듈은 하나).
 */

import Link from '@/app/link'
import type { KeyboardEvent } from 'react'
import type { EditorView } from '@tiptap/pm/view'

import { AI_ASK_DISABLED, AI_ASK_FORBIDDEN, AI_ASK_UNAVAILABLE } from '@/lib/ai/ask-client'
import type { AiEntry } from '@/lib/ai/usage'

export type Box = { readonly top: number; readonly left: number; readonly width: number }

export const BUTTON = 'rounded px-2 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800'
export const PRIMARY = 'rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-40'
export const INPUT =
  'min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-800 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200'

export const composing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229

/** 그 줄 바로 아래의 자리(프레임 좌표) — 줄이 없으면(지워졌다) null. */
export function boxBelow(view: EditorView, frame: HTMLElement, blockId: string, minWidth = 320): Box | null {
  const line = view.dom.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)?.firstElementChild ?? null
  if (line === null) return null
  const r = line.getBoundingClientRect()
  const f = frame.getBoundingClientRect()
  return { top: Math.round(r.bottom - f.top + 4), left: Math.round(r.left - f.left), width: Math.round(Math.max(minWidth, r.width)) }
}

/** AI 를 쓸 수 없는 까닭(꺼짐 · 공급자 없음 · 게스트) — 꺼져 있으면 소유자에게 설정 → AI 로 가는 링크. */
export function AiBlockedReason({ entry, workspaceId, testId, onClose }: { entry: AiEntry; workspaceId: string; testId: string; onClose: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p data-testid={`${testId}-reason`} role="status" className="flex-1">
        {entry.state === 'disabled' ? AI_ASK_DISABLED : entry.state === 'forbidden' ? AI_ASK_FORBIDDEN : AI_ASK_UNAVAILABLE}
      </p>
      {entry.state === 'disabled' && entry.canManage && (
        <Link data-testid={`${testId}-settings-link`} href={`/w/${workspaceId}/settings?s=workspace.ai`} className="text-blue-600 hover:underline dark:text-blue-400">
          설정 → AI 에서 켜기
        </Link>
      )}
      <button type="button" data-testid={`${testId}-close`} className={BUTTON} onClick={onClose}>
        닫기
      </button>
    </div>
  )
}
