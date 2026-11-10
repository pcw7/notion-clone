'use client'

/**
 * 페이지의 "제안" 목록 — 걸린 제안 · 자리로 가기 · 수락 · 거절 · 모두 수락 · 모두 거절 (SG-3 · F-05-12 · 정본 [보강 SG-1] ⑤)
 *
 * 지연 로드다(`body-popups-lazy.tsx`). 페이지 메뉴의 "제안 n개" · 제안 모드 표시의 단추가 연다(`suggestion-mode-store.ts`) · 편집기가 그린다.
 * 목록은 **본문의 마크**에서 센다(`docSuggestions`) — 문서가 바뀌면 편집기가 `docVersion` 을 올려 다시 그린다(남의 편집 · 되돌리기도).
 * 이름 · 시각은 목록 API 에서(`suggestion-actions.ts`). 항목을 누르면 그 제안의 글을 고른다.
 *
 * 모두 수락 · 모두 거절은 지금 문서의 모든 sid 를 **한 트랜잭션**으로(S9) · 기록도 한 번에(`resolveInEditor`).
 * 단추는 본문을 고칠 수 있는 사람에게만(`canResolve`).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { docSuggestions, formatChangeLabel, type ResolveAction } from '@/lib/editor/suggestion-resolve'
import { KIND_LABEL, resolveInEditor, useSuggestionMeta } from './suggestion-actions'

/** 미리보기 길이 — 메타 표의 preview 와 같다(앞 80자). */
const PREVIEW_CHARS = 80

const ACTION_BUTTON =
  'rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'

/** 시각 — 1분 안 "방금" · 1시간 안 "N분 전" · 그 밖은 날짜와 시각. */
function stampOf(iso: string | null, now: number): string {
  if (iso === null) return ''
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const diff = now - at
  if (diff < 60_000) return '방금'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(at)
}

export function SuggestionPanel({
  view,
  workspaceId,
  pageId,
  docVersion,
  canResolve,
  onClose,
  onError,
}: {
  view: EditorView
  workspaceId: string
  pageId: string
  /** 문서가 바뀔 때마다 오른다 — 목록을 다시 센다. */
  docVersion: number
  canResolve: boolean
  onClose: () => void
  onError: (message: string) => void
}) {
  // 문서의 제안 — 편집기가 문서가 바뀌었다고 알릴 때(docVersion) 다시 센다
  const items = useMemo(() => docSuggestions(view.state.doc), [view, docVersion]) // eslint-disable-line react-hooks/exhaustive-deps -- docVersion 이 오르면 같은 view 의 새 문서를 읽는다
  const meta = useSuggestionMeta(workspaceId, pageId, items.map((s) => s.sid))
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    rootRef.current?.focus()
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const act = async (sids: readonly string[], action: ResolveAction) => {
    if (sids.length === 0) return
    setBusy(true)
    const failed = await resolveInEditor(view, workspaceId, pageId, sids, action)
    setBusy(false)
    if (failed !== null) onError(failed)
  }

  /** 그 제안의 글을 고른다 — 누른 때의 문서에서 다시 찾는다(그사이 남이 고쳤을 수 있다). */
  const jump = (sid: string) => {
    const found = docSuggestions(view.state.doc).find((s) => s.sid === sid)
    if (found === undefined) return
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found.from, found.to)).scrollIntoView())
    view.focus()
  }

  const all = items.map((s) => s.sid)
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="제안"
      tabIndex={-1}
      data-testid="suggestion-panel"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
        event.preventDefault()
        onClose()
      }}
      className="fixed right-4 top-16 z-40 flex max-h-[70vh] w-80 flex-col gap-2 popover-surface p-3 text-sm outline-none"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">제안 {items.length}개</h2>
        <button type="button" aria-label="제안 목록 닫기" onClick={onClose} className="rounded px-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          ✕
        </button>
      </div>
      {canResolve && items.length > 0 && (
        <div className="flex gap-1">
          <button type="button" data-testid="suggestion-accept-all" disabled={busy} onClick={() => void act(all, 'accept')} className={ACTION_BUTTON}>
            모두 수락
          </button>
          <button type="button" data-testid="suggestion-reject-all" disabled={busy} onClick={() => void act(all, 'reject')} className={ACTION_BUTTON}>
            모두 거절
          </button>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-neutral-500">걸린 제안이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-1 overflow-y-auto">
          {items.map((s) => {
            const preview = Array.from(s.text).slice(0, PREVIEW_CHARS).join('')
            return (
              <li key={s.sid} data-testid="suggestion-item" data-kind={s.kind} className="flex flex-col gap-1 rounded-md p-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                <button type="button" onClick={() => jump(s.sid)} className="flex flex-col gap-0.5 text-left">
                  <span className="flex items-baseline gap-1.5">
                    <span className="flex-none text-xs text-neutral-500">{KIND_LABEL[s.kind]}</span>
                    <span
                      data-testid="suggestion-item-preview"
                      className={`truncate ${s.kind === 'insert' ? 'text-green-700 underline dark:text-green-300' : s.kind === 'delete' ? 'text-red-700 line-through dark:text-red-300' : 'underline decoration-dotted'}`}
                    >
                      {preview === '' ? '(글 없음)' : preview}
                    </span>
                  </span>
                  {s.kind === 'format' && <span className="text-xs text-neutral-500">{formatChangeLabel(view.state.doc, s.sid) ?? ''}</span>}
                  <span className="text-xs text-neutral-500">
                    {meta.name(s.sid, s.authorId)}
                    {stampOf(meta.createdAt(s.sid), now) === '' ? '' : ` · ${stampOf(meta.createdAt(s.sid), now)}`}
                  </span>
                </button>
                {canResolve && (
                  <div className="flex gap-1">
                    <button type="button" disabled={busy} onClick={() => void act([s.sid], 'accept')} className={ACTION_BUTTON}>
                      수락
                    </button>
                    <button type="button" disabled={busy} onClick={() => void act([s.sid], 'reject')} className={ACTION_BUTTON}>
                      거절
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
