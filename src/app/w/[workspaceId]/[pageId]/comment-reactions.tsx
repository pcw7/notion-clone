/**
 * 코멘트 하나의 반응 — 칩 · 빠른 고르개 (인접 제품 7c-3d-1 · F-05-08)
 *
 * ⚠ `'use client'` 를 달지 않는다 — 부르는 쪽(`comment-panel.tsx`)이 클라이언트이고 함수 props 를 받는다.
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] 반응 화면
 *
 * 칩을 누르면 그 이모지를 토글한다(명령의 PK 가 곧 2P-Set). 고르개에서 고른 것도 토글이다 — 이미 눌렀던 것을 고르면 없어진다(같은
 * 명령 하나). 누를 수 있는가는 서버가 준 `canReact`(코멘트를 쓸 수 있는가) 하나로 — 볼 수만 있으면 칩은 보이되 누를 수 없다.
 */

import { useEffect, useRef, useState } from 'react'

import { QUICK_REACTIONS, reactionLabel, reactionTitle } from './reaction-labels'

export type ReactionView = { readonly emoji: string; readonly userIds: readonly string[] }

const CHIP =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs disabled:cursor-default disabled:opacity-70 aria-pressed:border-blue-400 aria-pressed:bg-blue-50 dark:aria-pressed:bg-blue-950'

export function CommentReactions({
  reactions,
  me,
  nameOf,
  canReact,
  busy,
  onToggle,
}: {
  reactions: readonly ReactionView[]
  me: string
  nameOf: (userId: string) => string | null
  canReact: boolean
  busy: boolean
  onToggle: (emoji: string) => void
}) {
  const [picking, setPicking] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // 바깥을 누르거나 Esc 면 고르개를 닫는다 — Esc 는 패널까지 닫지 않는다(고르개만).
  useEffect(() => {
    if (!picking) return
    const onDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setPicking(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setPicking(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [picking])

  if (reactions.length === 0 && !canReact) return null
  return (
    <div ref={rootRef} role="group" aria-label="반응" data-testid="comment-reactions" className="relative flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => {
        const mine = reaction.userIds.includes(me)
        return (
          <button
            key={reaction.emoji}
            type="button"
            data-testid="reaction-chip"
            data-emoji={reaction.emoji}
            aria-pressed={mine}
            aria-label={reactionLabel(reaction.emoji, reaction.userIds.length, mine)}
            title={reactionTitle(reaction.userIds, me, nameOf)}
            disabled={!canReact || busy}
            onClick={() => onToggle(reaction.emoji)}
            className={`${CHIP} border-neutral-200 dark:border-neutral-700`}
          >
            <span aria-hidden>{reaction.emoji}</span>
            <span aria-hidden>{reaction.userIds.length}</span>
          </button>
        )
      })}
      {canReact && (
        <button
          type="button"
          data-testid="reaction-add"
          aria-label="반응 추가"
          aria-haspopup="menu"
          aria-expanded={picking}
          disabled={busy}
          onClick={() => setPicking((v) => !v)}
          className="rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          ☺+
        </button>
      )}
      {picking && (
        <div
          role="menu"
          aria-label="반응 고르기"
          data-testid="reaction-picker"
          className="absolute left-0 top-full z-30 mt-1 flex gap-0.5 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              data-testid="reaction-option"
              data-emoji={emoji}
              aria-label={emoji}
              onClick={() => {
                setPicking(false)
                onToggle(emoji)
              }}
              className="rounded px-1.5 py-1 text-base hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
