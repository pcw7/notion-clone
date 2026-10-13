/**
 * 코멘트 하나의 반응 — 칩 · 빠른 고르개 (인접 제품 7c-3d-1 · 7c-3d-2 · F-05-08 · F-13-16)
 *
 * ⚠ `'use client'` 를 달지 않는다 — 부르는 쪽(`comment-panel.tsx`)이 클라이언트이고 함수 props 를 받는다.
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] 반응 화면 · §3.4 [보강] 커스텀 이모지 ⑩
 *
 * 칩을 누르면 그 이모지를 토글한다(명령의 PK 가 곧 2P-Set). 고르개에서 고른 것도 토글이다 — 이미 눌렀던 것을 고르면 없어진다(같은
 * 명령 하나). 누를 수 있는가는 서버가 준 `canReact`(코멘트를 쓸 수 있는가) 하나로 — 볼 수만 있으면 칩은 보이되 누를 수 없다.
 *
 * 커스텀 이모지(7c-3d-2)의 키는 `custom_emoji:{id}` 다. 칩은 살아 있으면 그림(alt `:이름:`) · 지웠으면 `:이름:` 글자 · 모르면 "이모지" —
 * 이름은 코멘트 목록이 함께 준 맵(`emojiLabel`)에서 읽는다. 고르개의 커스텀 줄은 열 때 목록을 읽고 이름으로 찾는다(24개까지).
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { customEmojiImagePath } from '@/lib/block/page-icon'
import { customEmojiIdOfReaction, customEmojiReactionKey, searchCustomEmoji } from '@/lib/emoji/custom-emoji-rules'
import { QUICK_REACTIONS, reactionLabel, reactionTitle } from './reaction-labels'

export type ReactionView = { readonly emoji: string; readonly userIds: readonly string[] }

export type EmojiLabel = { readonly name: string; readonly deleted: boolean }

type ListedEmoji = { readonly id: string; readonly name: string }

/** 고르개의 커스텀 줄이 보일 수 — 정본 ⑩. */
const CUSTOM_LIMIT = 24

const CHIP =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs disabled:cursor-default disabled:opacity-70 aria-pressed:border-blue-400 aria-pressed:bg-blue-50 dark:aria-pressed:bg-blue-950'

/** 칩의 얼굴 · 읽는 이름에 쓸 글자 — 유니코드는 그 글자, 커스텀은 `:이름:`(모르면 "이모지"). */
function faceText(emoji: string, emojiLabel: (id: string) => EmojiLabel | null | undefined): string {
  const id = customEmojiIdOfReaction(emoji)
  if (id === null) return emoji
  const label = emojiLabel(id)
  return label === null || label === undefined ? '이모지' : `:${label.name}:`
}

export function CommentReactions({
  workspaceId,
  reactions,
  me,
  nameOf,
  emojiLabel,
  canReact,
  busy,
  onToggle,
}: {
  workspaceId: string
  reactions: readonly ReactionView[]
  me: string
  nameOf: (userId: string) => string | null
  /** 커스텀 이모지의 이름 — 코멘트 목록이 함께 준 맵(지운 것도). 없으면 null · 모르면 undefined. */
  emojiLabel: (id: string) => EmojiLabel | null | undefined
  canReact: boolean
  busy: boolean
  onToggle: (emoji: string) => void
}) {
  const [picking, setPicking] = useState(false)
  const [custom, setCustom] = useState<readonly ListedEmoji[] | null>(null)
  const [query, setQuery] = useState('')
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

  // 고르개를 열 때마다 커스텀 이모지 목록을 읽는다(다른 사람이 방금 올린 것도). 못 읽으면 커스텀 줄이 없다.
  useEffect(() => {
    if (!picking) return
    let alive = true
    fetch(`/api/workspaces/${workspaceId}/emoji`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { emoji?: ListedEmoji[] } | null
        if (alive) setCustom(res.ok && Array.isArray(body?.emoji) ? body.emoji.map((e) => ({ id: e.id, name: e.name })) : [])
      })
      .catch(() => {
        if (alive) setCustom([])
      })
    return () => {
      alive = false
    }
  }, [picking, workspaceId])

  const shown = useMemo(() => (custom === null ? [] : searchCustomEmoji(custom, query).slice(0, CUSTOM_LIMIT)), [custom, query])

  if (reactions.length === 0 && !canReact) return null
  return (
    <div ref={rootRef} role="group" aria-label="반응" data-testid="comment-reactions" className="relative flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => {
        const mine = reaction.userIds.includes(me)
        const customId = customEmojiIdOfReaction(reaction.emoji)
        const label = customId === null ? undefined : emojiLabel(customId)
        const text = faceText(reaction.emoji, emojiLabel)
        return (
          <button
            key={reaction.emoji}
            type="button"
            data-testid="reaction-chip"
            data-emoji={reaction.emoji}
            aria-pressed={mine}
            aria-label={reactionLabel(text, reaction.userIds.length, mine)}
            title={reactionTitle(reaction.userIds, me, nameOf)}
            disabled={!canReact || busy}
            onClick={() => onToggle(reaction.emoji)}
            className={`${CHIP} border-neutral-200 dark:border-neutral-700`}
          >
            {customId !== null && label !== null && label !== undefined && !label.deleted ? (
              // eslint-disable-next-line @next/next/no-img-element -- 세션으로 인증되는 우리 경로(아이콘 · 본문의 이모지와 같다)
              <img src={customEmojiImagePath(workspaceId, customId)} alt="" aria-hidden className="h-4 w-4 object-contain" />
            ) : (
              <span aria-hidden className={customId !== null ? 'font-mono text-neutral-500' : undefined}>
                {text}
              </span>
            )}
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
          onClick={() => {
            setQuery('')
            setPicking((v) => !v)
          }}
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
          className="absolute left-0 top-full z-30 mt-1 flex w-72 flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="flex gap-0.5">
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
          {custom !== null && custom.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-neutral-200 pt-1 dark:border-neutral-800">
              <input
                data-testid="reaction-custom-search"
                aria-label="커스텀 이모지 찾기"
                placeholder="커스텀 이모지 찾기"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 rounded border border-neutral-300 bg-transparent px-2 py-0.5 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700"
              />
              <div className="flex flex-wrap gap-0.5">
                {shown.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    data-testid="reaction-custom-option"
                    data-emoji-id={entry.id}
                    aria-label={`:${entry.name}:`}
                    title={`:${entry.name}:`}
                    onClick={() => {
                      setPicking(false)
                      onToggle(customEmojiReactionKey(entry.id))
                    }}
                    className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- 세션으로 인증되는 우리 경로 */}
                    <img src={customEmojiImagePath(workspaceId, entry.id)} alt="" className="h-5 w-5 object-contain" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
