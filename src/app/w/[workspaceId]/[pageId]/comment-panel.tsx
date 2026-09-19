'use client'

/**
 * 코멘트 패널 — F-05-08 (코멘트 4조각)
 *
 * 판정과 저장은 전부 서버 명령에 있다(`src/lib/comment/`). 이 파일은 **목록과 호출만** 한다 — 공유 패널과 같은 규칙이다.
 * 화면이 권한 규칙을 한 줄이라도 갖기 시작하면 서버와 어긋나고, 어긋난 쪽이 더 관대하면 그게 사고다. 그래서 무엇을
 * 그릴지는 서버가 준 `canComment` · `canResolve` 만 보고 정한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 열림 / 해결됨을 **서버에 물어** 가른다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 05 F-05-08: *"해결된 코멘트는 공개 API로 조회할 수 없다 — Retrieve comments는 open 스레드만 반환한다. 즉 `resolved`가
 * 조회 필터의 1급 축이다."* 받아 온 목록을 화면에서 거르지 않고 `?resolved=` 로 다시 읽는다 — 거르는 규칙이 두 벌이
 * 되면 "해결했는데 아직 보인다"가 생긴다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 지운 코멘트는 **자리만** 남는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 서버가 내용을 비우고 행만 남긴다(불변식 D3 · §3.3-126). 화면은 그 자리를 "삭제된 코멘트"로 그린다 — 스레드의 순서와
 * 맥락이 그 자리에 있기 때문이다. 마지막 살아 있는 코멘트를 지우면 스레드째 사라진다(서버가 한다).
 */

import { useCallback, useEffect, useState } from 'react'

type Run = { plain_text?: string }

type CommentView = {
  id: string
  authorId: string
  richText: Run[]
  deleted: boolean
  createdAt: string
  editedAt: string | null
}

type DiscussionView = {
  id: string
  blockId: string
  onPage: boolean
  orphaned: boolean
  resolved: boolean
  createdBy: string
  createdAt: string
  anchor: { quotedText: string; range: { start: number; end: number; text: string } | null } | null
  comments: CommentView[]
}

type PanelState = {
  discussions: DiscussionView[]
  canComment: boolean
  canResolve: boolean
  subscription: { level: string; source: string | null }
  me: string
  members: { userId: string; name: string }[]
}

const LEVELS: readonly { value: string; label: string }[] = [
  { value: 'all_comments', label: '모든 코멘트' },
  { value: 'replies_and_mentions', label: '답글만' },
  { value: 'none', label: '받지 않기' },
]

const textOf = (runs: readonly Run[]): string => runs.map((r) => r.plain_text ?? '').join('')

const when = (iso: string): string => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })

export function CommentPanel({
  workspaceId,
  pageId,
  initialOpenCount,
}: {
  workspaceId: string
  pageId: string
  /** 열린 스레드 수 — **서버가 그려서 준다.** 버튼에 수를 띄우려고 열기 전에 한 번 읽는 것을 없앤다. */
  initialOpenCount: number
}) {
  const [open, setOpen] = useState(false)
  const [resolved, setResolved] = useState(false)
  const [state, setState] = useState<PanelState | null>(null)
  const [openCount, setOpenCount] = useState(initialOpenCount)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)

  const pageUrl = `/api/workspaces/${workspaceId}/pages/${pageId}/discussions`
  const actionUrl = `/api/workspaces/${workspaceId}/discussions`

  /**
   * 목록을 다시 읽는다.
   *
   * ⚠ **여기서 오류를 지우지 않는다** — 공유 패널이 같은 실수를 했다. 실패한 조작 뒤에도 목록은 새로 읽어야 하는데,
   * 그때 오류까지 지우면 방금 뜬 문구가 즉시 사라져 아무 일도 안 일어난 것처럼 보인다.
   */
  const load = useCallback(
    async (wantResolved: boolean) => {
      try {
        const res = await fetch(`${pageUrl}?resolved=${wantResolved}`)
        if (!res.ok) {
          setError('코멘트를 불러오지 못했습니다.')
          return
        }
        const data = (await res.json()) as PanelState
        setState(data)
        if (!wantResolved) setOpenCount(data.discussions.length)
      } catch {
        setError('연결에 실패했습니다.')
      }
    },
    [pageUrl],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const send = useCallback(
    async (url: string, body: unknown, method = 'POST'): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
          setError(data.message ?? MESSAGES[data.error ?? ''] ?? '처리하지 못했습니다.')
          await load(resolved)
          return false
        }
        await load(resolved)
        return true
      } catch {
        setError('연결에 실패했습니다.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [load, resolved],
  )

  const nameOf = (userId: string): string =>
    state?.members.find((m) => m.userId === userId)?.name ?? '알 수 없는 사용자'

  const showFilter = async (wantResolved: boolean) => {
    setResolved(wantResolved)
    setReplyTo(null)
    setEditing(null)
    await load(wantResolved)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) {
            setError(null)
            void load(resolved)
          }
        }}
        aria-expanded={open}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        코멘트{openCount > 0 ? ` ${openCount}` : ''}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="코멘트"
          className="absolute right-0 z-20 mt-2 flex max-h-[32rem] w-96 flex-col gap-3 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1" role="group" aria-label="코멘트 필터">
              {[
                { value: false, label: '열림' },
                { value: true, label: '해결됨' },
              ].map((tab) => (
                <button
                  key={tab.label}
                  type="button"
                  aria-pressed={resolved === tab.value}
                  onClick={() => void showFilter(tab.value)}
                  className={`rounded px-2 py-1 text-xs ${
                    resolved === tab.value
                      ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                      : 'border border-neutral-300 dark:border-neutral-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {state !== null && (
              <label className="flex items-center gap-1 text-xs text-neutral-500">
                알림
                <select
                  aria-label="이 페이지의 알림 받기"
                  value={state.subscription.level}
                  disabled={busy}
                  onChange={(e) => void send(pageUrl, { action: 'subscribe', level: e.target.value })}
                  className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                >
                  {LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {error !== null && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          {state === null && error === null && <p className="text-sm text-neutral-500">불러오는 중…</p>}

          {state !== null && state.discussions.length === 0 && (
            <p className="text-sm text-neutral-500">{resolved ? '해결된 스레드가 없습니다.' : '아직 코멘트가 없습니다.'}</p>
          )}

          {state !== null &&
            state.discussions.map((thread) => (
              <article
                key={thread.id}
                aria-label="코멘트 스레드"
                className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
              >
                {thread.anchor !== null && (
                  <p className="text-xs text-neutral-500">
                    {/* 앵커를 풀지 못하면 만들 때의 원문을 보여준다 — 05 F-05-07 이 "반드시 저장한다"고 한 값이다. */}
                    <span className={thread.orphaned ? 'line-through' : ''}>“{thread.anchor.range?.text || thread.anchor.quotedText}”</span>
                    {thread.orphaned && <span className="ml-1">(원본 없음)</span>}
                  </p>
                )}

                {thread.comments.map((comment) => (
                  <div key={comment.id} className="flex flex-col gap-1">
                    <p className="text-xs text-neutral-500">
                      {nameOf(comment.authorId)} · {when(comment.createdAt)}
                      {comment.editedAt !== null && <span className="ml-1">(수정됨)</span>}
                    </p>

                    {comment.deleted ? (
                      <p className="text-sm text-neutral-400">삭제된 코멘트</p>
                    ) : editing?.id === comment.id ? (
                      <form
                        className="flex flex-col gap-1"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void send(actionUrl, {
                            action: 'edit',
                            commentId: comment.id,
                            richText: [{ type: 'text', plain_text: editing.text, text: { content: editing.text, link: null }, href: null, annotations: ANNOTATIONS }],
                          }).then((done) => {
                            if (done) setEditing(null)
                          })
                        }}
                      >
                        <textarea
                          aria-label="코멘트 고치기"
                          value={editing.text}
                          onChange={(e) => setEditing({ id: comment.id, text: e.target.value })}
                          rows={2}
                          className="rounded border border-neutral-300 bg-transparent p-2 text-sm dark:border-neutral-700"
                        />
                        <div className="flex gap-1">
                          <button type="submit" disabled={busy} className={SMALL_BUTTON}>
                            저장
                          </button>
                          <button type="button" onClick={() => setEditing(null)} className={SMALL_BUTTON}>
                            취소
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap text-sm">{textOf(comment.richText)}</p>
                        {comment.authorId === state.me && (
                          <div className="flex gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setEditing({ id: comment.id, text: textOf(comment.richText) })}
                              className={SMALL_BUTTON}
                            >
                              고치기
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void send(actionUrl, { action: 'delete', commentId: comment.id })}
                              className={SMALL_BUTTON}
                            >
                              지우기
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}

                <div className="flex items-center gap-1">
                  {state.canComment && replyTo !== thread.id && (
                    <button type="button" onClick={() => setReplyTo(thread.id)} className={SMALL_BUTTON}>
                      답글
                    </button>
                  )}
                  {state.canResolve && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void send(actionUrl, {
                          action: thread.resolved ? 'reopen' : 'resolve',
                          discussionId: thread.id,
                        })
                      }
                      className={SMALL_BUTTON}
                    >
                      {thread.resolved ? '다시 열기' : '해결'}
                    </button>
                  )}
                </div>

                {replyTo === thread.id && (
                  <form
                    className="flex flex-col gap-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void send(actionUrl, {
                        action: 'reply',
                        discussionId: thread.id,
                        richText: [{ type: 'text', plain_text: replyDraft, text: { content: replyDraft, link: null }, href: null, annotations: ANNOTATIONS }],
                      }).then((done) => {
                        if (done) {
                          setReplyDraft('')
                          setReplyTo(null)
                        }
                      })
                    }}
                  >
                    <textarea
                      aria-label="답글"
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      rows={2}
                      className="rounded border border-neutral-300 bg-transparent p-2 text-sm dark:border-neutral-700"
                    />
                    <button type="submit" disabled={busy} className={SMALL_BUTTON}>
                      답글 남기기
                    </button>
                  </form>
                )}
              </article>
            ))}

          {state !== null && state.canComment && !resolved && (
            <form
              className="flex flex-col gap-1 border-t border-neutral-200 pt-3 dark:border-neutral-800"
              onSubmit={(e) => {
                e.preventDefault()
                void send(pageUrl, {
                  action: 'open',
                  richText: [{ type: 'text', plain_text: draft, text: { content: draft, link: null }, href: null, annotations: ANNOTATIONS }],
                }).then((done) => {
                  if (done) setDraft('')
                })
              }}
            >
              <textarea
                aria-label="새 코멘트"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder="이 페이지에 코멘트 남기기"
                className="rounded border border-neutral-300 bg-transparent p-2 text-sm dark:border-neutral-700"
              />
              <button type="submit" disabled={busy} className={SMALL_BUTTON}>
                코멘트 남기기
              </button>
            </form>
          )}

          {state !== null && !state.canComment && (
            <p className="border-t border-neutral-200 pt-3 text-xs text-neutral-500 dark:border-neutral-800">
              이 페이지에 코멘트를 쓸 권한이 없습니다.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const SMALL_BUTTON =
  'rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'

/** RichText 계약의 기본 서식. 패널은 아직 평문만 쓴다 — 서식 있는 코멘트는 멘션(5조각)과 함께 온다. */
const ANNOTATIONS = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: 'default',
} as const

const MESSAGES: Readonly<Record<string, string>> = {
  empty: '빈 코멘트는 남길 수 없습니다.',
  forbidden: '권한이 없습니다.',
  not_found: '대상을 찾을 수 없습니다.',
  too_long: '코멘트가 너무 깁니다.',
}
