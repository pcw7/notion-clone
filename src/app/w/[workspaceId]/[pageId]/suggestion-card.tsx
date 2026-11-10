'use client'

/**
 * 제안 마크의 카드 — 제안한 사람 · 종류 · 수락 · 거절 (SG-3 · F-05-12 · 정본 [보강 SG-1] ⑤)
 *
 * 지연 로드다(`body-popups-lazy.tsx`). 편집기가 띄운다 — 마크에 마우스를 올리거나(떠나면 잠깐 뒤 접는다 · 카드 위에 있으면 둔다) 캐럿이
 * 제안 안에 들어오면(`suggestion-trigger.ts`). 글자 하나에 두 제안이 서면(남이 넣자는 글을 지우자고 했다) 둘 다 보인다.
 *
 * 서식 제안은 바꾼 것을 한 줄로 더 보인다("굵게 · 기울임 더함" — SG-5a · `formatChangeLabel`).
 *
 * 수락 · 거절 단추는 본문을 고칠 수 있는 사람에게만(`canResolve` — 편집기가 고칠 수 있을 때). 보기 · 코멘트만이면 카드만 선다.
 * 키보드 — 캐럿으로 카드를 띄운 채 `Alt+Enter` 면 카드의 첫 단추로 · 카드에서 `Escape` 면 편집기로.
 */

import { useEffect, useRef, useState } from 'react'
import type { EditorView } from '@tiptap/pm/view'

import { formatChangeLabel, type ResolveAction } from '@/lib/editor/suggestion-resolve'
import { KIND_LABEL, resolveInEditor, useSuggestionMeta } from './suggestion-actions'
import type { SuggestionCardAt } from './suggestion-trigger'

const KIND_TONE = {
  insert: 'text-green-700 dark:text-green-300',
  delete: 'text-red-700 dark:text-red-300',
  format: 'text-neutral-500',
} as const

const ACTION_BUTTON =
  'rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'

export function SuggestionCard({
  view,
  workspaceId,
  pageId,
  at,
  canResolve,
  onHold,
  onClose,
  onError,
}: {
  view: EditorView
  workspaceId: string
  pageId: string
  at: SuggestionCardAt
  canResolve: boolean
  /** 마우스가 카드 위에 있는가 — 있는 동안 편집기가 마우스 카드를 접지 않는다. */
  onHold: (held: boolean) => void
  onClose: () => void
  onError: (message: string) => void
}) {
  const meta = useSuggestionMeta(workspaceId, pageId, at.items.map((i) => i.sid))
  const rootRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)

  // Alt+Enter — 편집기에서 카드로(캐럿으로 연 카드에 키보드로 들어온다)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.key !== 'Enter' || !event.altKey) return
      event.preventDefault()
      event.stopPropagation()
      const root = rootRef.current
      ;(root?.querySelector<HTMLElement>('button') ?? root)?.focus()
    }
    view.dom.addEventListener('keydown', onKey, true)
    return () => view.dom.removeEventListener('keydown', onKey, true)
  }, [view])

  // 카드가 사라지면 붙잡음도 푼다 — 단추를 누른 뒤 카드가 접혀 mouseleave 가 오지 않는다
  useEffect(() => () => onHold(false), [onHold])

  const act = async (sid: string, action: ResolveAction) => {
    setBusy(true)
    const failed = await resolveInEditor(view, workspaceId, pageId, [sid], action)
    if (failed !== null) onError(failed)
    onClose()
    view.focus()
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="제안"
      aria-keyshortcuts="Alt+Enter"
      tabIndex={-1}
      data-testid="suggestion-card"
      onMouseEnter={() => onHold(true)}
      onMouseLeave={() => onHold(false)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
        event.preventDefault()
        onClose()
        view.focus()
      }}
      style={{ top: at.top, left: at.left }}
      className="absolute z-30 flex w-60 flex-col gap-2 popover-surface p-2 text-sm"
    >
      {at.items.map((item) => (
        <div key={item.sid} data-card-sid={item.sid} className="flex flex-col gap-1.5">
          <p className="flex items-baseline gap-1.5">
            <span data-testid="suggestion-card-author" className="truncate font-medium">
              {meta.name(item.sid, item.authorId)}
            </span>
            <span className={`flex-none text-xs ${KIND_TONE[item.kind]}`}>{KIND_LABEL[item.kind]} 제안</span>
          </p>
          {item.kind === 'format' && (
            <p data-testid="suggestion-card-change" className="text-xs text-neutral-500">
              {formatChangeLabel(view.state.doc, item.sid) ?? ''}
            </p>
          )}
          {canResolve && (
            <div className="flex gap-1">
              <button
                type="button"
                data-testid="suggestion-accept"
                disabled={busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void act(item.sid, 'accept')}
                className={ACTION_BUTTON}
              >
                수락
              </button>
              <button
                type="button"
                data-testid="suggestion-reject"
                disabled={busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void act(item.sid, 'reject')}
                className={ACTION_BUTTON}
              >
                거절
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
