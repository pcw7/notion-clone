'use client'

/**
 * AI 채팅 화면 — 이전 대화 목록 · 대화 · 입력(범위 고르개) (AI-6 · F-10-17 · F-10-22)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑪
 *
 * 첫 목록 · 연 대화는 서버가 그려서 준다(`page.tsx`). 한 턴은 `POST …/ai/chat` 의 SSE 를 읽는다(`chat-client.ts`) — `session` 사건이 오면 새
 * 대화를 목록 맨 위에 올리고 주소를 `?s=<id>` 로 바꾼다(다시 불러도 그 대화가 열린다). 거부 · 처음부터의 실패면 질문을 입력창에 되돌린다
 * (서버는 아무것도 적지 않았다). 흐르는 동안에는 대화를 바꾸지 않는다.
 *
 * 답은 평문으로 보인다(줄바꿈 유지) — 마크다운을 그리지 않는다(편집기를 이 화면에 싣지 않는다 · 번들).
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import Link from '@/app/link'
import { AI_ASK_DISABLED, AI_ASK_UNAVAILABLE, askFailureMessage, remainingText, type AskFailure } from '@/lib/ai/ask-client'
import { sourceChipText, streamChat } from '@/lib/ai/chat-client'
import {
  CHAT_DEFAULT_TITLE,
  CHAT_QUESTION_MAX,
  WORKSPACE_SCOPE,
  type ChatMessageView,
  type ChatScope,
  type ChatSessionSummary,
  type ChatSessionView,
  type ChatSourceView,
} from '@/lib/ai/chat-shared'
import { PagePicker } from './page-picker'

const BUTTON = 'rounded px-2 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800'
const PRIMARY = 'rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40'
const NOTE = 'text-xs text-neutral-500'
const SMALL = 'rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700'

export type ChatEntry = { readonly state: 'ready' | 'disabled' | 'unavailable'; readonly canManage: boolean }
export type ChatInstructionsBadge = { readonly title: string | null; readonly state: 'none' | 'ok' | 'unavailable' }

const composing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229

export function ChatView({
  workspaceId,
  entry,
  initialSessions,
  opened,
  initialScope,
  initialScopeTitle,
  instructions,
}: {
  workspaceId: string
  entry: ChatEntry
  initialSessions: ChatSessionSummary[]
  opened: ChatSessionView | null
  initialScope: ChatScope
  initialScopeTitle: string | null
  instructions: ChatInstructionsBadge
}) {
  const [sessions, setSessions] = useState(initialSessions)
  const [sessionId, setSessionId] = useState<string | null>(opened?.id ?? null)
  const [title, setTitle] = useState<string | null>(opened?.title ?? null)
  const [messages, setMessages] = useState<ChatMessageView[]>(opened === null ? [] : [...opened.messages])
  const [scope, setScope] = useState<ChatScope>(initialScope)
  const [scopeTitle, setScopeTitle] = useState<string | null>(initialScopeTitle)
  const [picking, setPicking] = useState(false)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [failure, setFailure] = useState<AskFailure | null>(null)
  /** 도중에 실패한 답의 말 — 메시지 id 마다. */
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [footnote, setFootnote] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const stopRef = useRef<AbortController | null>(null)
  const rootRef = useRef<HTMLElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const ready = entry.state === 'ready'

  // 새 글이 오면 맨 아래로
  useEffect(() => {
    const el = threadRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [messages])

  // 붙었다는 표지(시험이 입력 전에 기다린다) · 화면을 떠나면 흐르던 답을 멈춘다(서버는 stopped 로 적는다)
  useEffect(() => {
    rootRef.current?.setAttribute('data-hydrated', 'true')
    return () => stopRef.current?.abort()
  }, [])

  const syncUrl = (id: string | null) => {
    window.history.replaceState(null, '', id === null ? `/w/${workspaceId}/ai` : `/w/${workspaceId}/ai?s=${id}`)
  }

  const startNew = () => {
    if (streaming) return
    setSessionId(null)
    setTitle(null)
    setMessages([])
    setFailures({})
    setFailure(null)
    setFootnote(null)
    setNotice(null)
    syncUrl(null)
    inputRef.current?.focus()
  }

  const openSession = async (id: string) => {
    if (streaming || id === sessionId) return
    setNotice(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/ai/chat/sessions/${id}`)
      const body = (await res.json().catch(() => null)) as { session?: ChatSessionView } | null
      if (!res.ok || body?.session === undefined) {
        setNotice(res.status === 404 ? '그 대화가 없습니다 — 지워졌습니다.' : '대화를 열지 못했습니다.')
        if (res.status === 404) setSessions((list) => list.filter((s) => s.id !== id))
        return
      }
      const s = body.session
      setSessionId(s.id)
      setTitle(s.title)
      setMessages([...s.messages])
      setFailures({})
      setFailure(null)
      setFootnote(null)
      if (s.scope.kind === 'page' && s.scopeTitle !== null) {
        setScope(s.scope)
        setScopeTitle(s.scopeTitle)
      } else {
        setScope(WORKSPACE_SCOPE)
        setScopeTitle(null)
      }
      syncUrl(s.id)
    } catch {
      setNotice('연결에 실패했습니다.')
    }
  }

  const send = async () => {
    const text = input.trim()
    if (text === '' || streaming || !ready) return
    setFailure(null)
    setNotice(null)
    setFootnote(null)
    const stamp = Date.now()
    const userId = `pending-user-${stamp}`
    const answerId = `pending-ai-${stamp}`
    setMessages((m) => [...m, { id: userId, role: 'user', content: text, status: null, sources: [] }, { id: answerId, role: 'assistant', content: '', status: null, sources: [] }])
    setInput('')
    setStreaming(true)
    const stop = new AbortController()
    stopRef.current = stop
    let openedTurn = false
    const turnScope = scope
    const outcome = await streamChat(
      workspaceId,
      { sessionId, message: text, scope: turnScope },
      stop.signal,
      {
        onOpened: (o) => {
          openedTurn = true
          setSessionId(o.sessionId)
          setTitle(o.title)
          setSessions((list) => [{ id: o.sessionId, title: o.title, scope: turnScope, updatedAt: new Date().toISOString() }, ...list.filter((s) => s.id !== o.sessionId)])
          syncUrl(o.sessionId)
        },
        onDelta: (t) => setMessages((m) => m.map((x) => (x.id === answerId ? { ...x, content: x.content + t } : x))),
      },
    )
    stopRef.current = null
    setStreaming(false)
    const settle = (patch: Partial<ChatMessageView>) => setMessages((m) => m.map((x) => (x.id === answerId ? { ...x, ...patch } : x)))
    if (outcome.kind === 'done') {
      const sources: ChatSourceView[] = outcome.sources.map((s) => ({ ...s, viewable: true }))
      settle({ id: outcome.messageId ?? answerId, status: 'completed', sources })
      const left = remainingText(outcome.quota)
      setFootnote([outcome.truncated ? '답이 길어 잘렸습니다' : null, left].filter((s) => s !== null).join(' · ') || null)
      return
    }
    if (!openedTurn) {
      // 서버는 아무것도 적지 않았다 — 질문을 입력창에 되돌린다
      setMessages((m) => m.filter((x) => x.id !== userId && x.id !== answerId))
      setInput(text)
      if (outcome.kind === 'failed') setFailure(outcome.failure)
      return
    }
    if (outcome.kind === 'aborted') {
      settle({ status: 'stopped' })
      return
    }
    settle({ status: 'failed' })
    setFailures((f) => ({ ...f, [answerId]: askFailureMessage(outcome.failure) }))
  }

  const stopNow = () => stopRef.current?.abort()

  const onInputKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || composing(e)) return
    e.preventDefault()
    void send()
  }

  const rename = async (id: string) => {
    const next = renameText.trim()
    setRenaming(null)
    if (next === '') return
    const res = await fetch(`/api/workspaces/${workspaceId}/ai/chat/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: next }),
    }).catch(() => null)
    const body = (await res?.json().catch(() => null)) as { session?: ChatSessionSummary } | null
    if (!res?.ok || body?.session === undefined) {
      setNotice(res?.status === 400 ? '이름은 1~60자로 쓰세요.' : '이름을 바꾸지 못했습니다.')
      return
    }
    const renamed = body.session
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, title: renamed.title } : s)))
    if (id === sessionId) setTitle(renamed.title)
  }

  const remove = async (id: string) => {
    setDeleting(null)
    const res = await fetch(`/api/workspaces/${workspaceId}/ai/chat/sessions/${id}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok && res?.status !== 404) {
      setNotice('대화를 지우지 못했습니다.')
      return
    }
    setSessions((list) => list.filter((s) => s.id !== id))
    if (id === sessionId) startNew()
  }

  const copy = async (m: ChatMessageView) => {
    try {
      await navigator.clipboard.writeText(m.content)
      setCopied(m.id)
      setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 1500)
    } catch {
      setNotice('복사하지 못했습니다.')
    }
  }

  const pickWorkspace = () => {
    setScope(WORKSPACE_SCOPE)
    setScopeTitle(null)
    setPicking(false)
  }

  return (
    <main ref={rootRef} data-testid="ai-chat" data-session-id={sessionId ?? ''} className="flex h-dvh min-h-0 flex-col text-neutral-800 md:flex-row dark:text-neutral-200">
      {/* 이전 대화 — 그 사람의 것만 · 최근 것부터 */}
      <aside aria-label="이전 대화" className="flex max-h-48 shrink-0 flex-col gap-1 overflow-y-auto border-b border-neutral-200 p-3 md:max-h-none md:w-64 md:border-r md:border-b-0 dark:border-neutral-800">
        <button type="button" data-testid="ai-chat-new" className={`${BUTTON} text-left font-medium`} disabled={streaming} onClick={startNew}>
          + 새 대화
        </button>
        <h2 className="mt-2 px-2 text-xs font-medium text-neutral-500">이전 대화</h2>
        {sessions.length === 0 && <p className="px-2 text-xs text-neutral-400">아직 대화가 없습니다</p>}
        <ul data-testid="ai-chat-sessions" className="flex flex-col gap-0.5">
          {sessions.map((s) => (
            <li key={s.id} data-testid="ai-chat-session" data-session-id={s.id} className="group flex flex-col">
              {renaming === s.id ? (
                <input
                  data-testid="ai-chat-rename-input"
                  aria-label="대화 이름"
                  autoFocus
                  maxLength={60}
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => {
                    if (composing(e)) return
                    if (e.key === 'Enter') void rename(s.id)
                    else if (e.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={() => setRenaming(null)}
                  className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
                />
              ) : (
                <div className={`flex items-center rounded ${s.id === sessionId ? 'bg-neutral-100 dark:bg-neutral-800' : ''}`}>
                  <button
                    type="button"
                    data-testid="ai-chat-session-open"
                    aria-current={s.id === sessionId ? 'page' : undefined}
                    disabled={streaming}
                    className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-sm hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800"
                    onClick={() => void openSession(s.id)}
                  >
                    {s.title}
                  </button>
                  <span className="flex shrink-0 opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                    <button
                      type="button"
                      data-testid="ai-chat-rename"
                      aria-label={`"${s.title}" 이름 바꾸기`}
                      title="이름 바꾸기"
                      disabled={streaming}
                      className={SMALL}
                      onClick={() => {
                        setRenameText(s.title)
                        setRenaming(s.id)
                      }}
                    >
                      이름
                    </button>
                    <button type="button" data-testid="ai-chat-delete" aria-label={`"${s.title}" 지우기`} title="지우기" disabled={streaming} className={SMALL} onClick={() => setDeleting(s.id)}>
                      지우기
                    </button>
                  </span>
                </div>
              )}
              {deleting === s.id && (
                <div role="alertdialog" aria-label="대화 지우기" className="mt-1 flex items-center gap-1 rounded bg-neutral-50 px-2 py-1 text-xs dark:bg-neutral-900">
                  <span className="flex-1">이 대화를 지울까요? 되돌릴 수 없습니다.</span>
                  <button type="button" data-testid="ai-chat-delete-confirm" className="rounded px-1.5 py-0.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950" onClick={() => void remove(s.id)}>
                    지우기
                  </button>
                  <button type="button" className={SMALL} onClick={() => setDeleting(null)}>
                    취소
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </aside>

      <section aria-label="AI 대화" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h1 data-testid="ai-chat-title" className="min-w-0 flex-1 truncate text-base font-semibold">
            {title ?? CHAT_DEFAULT_TITLE}
          </h1>
          <Link
            href={`/w/${workspaceId}/settings?s=workspace.ai`}
            data-testid="ai-chat-instructions"
            data-state={instructions.state}
            className="text-xs text-neutral-500 hover:underline"
          >
            {instructions.state === 'ok'
              ? `내 AI 지시 적용 중 · ${instructions.title?.trim() || '제목 없음'}`
              : instructions.state === 'unavailable'
                ? '내 AI 지시 페이지를 볼 수 없습니다'
                : '내 AI 지시 정하기'}
          </Link>
        </header>

        {!ready && (
          <div data-testid="ai-chat-blocked" role="status" className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded bg-neutral-50 px-3 py-2 text-sm dark:bg-neutral-900">
            <span className="flex-1">{entry.state === 'disabled' ? AI_ASK_DISABLED : AI_ASK_UNAVAILABLE}</span>
            {entry.state === 'disabled' && entry.canManage && (
              <Link data-testid="ai-chat-settings-link" href={`/w/${workspaceId}/settings?s=workspace.ai`} className="text-blue-600 hover:underline dark:text-blue-400">
                설정 → AI 에서 켜기
              </Link>
            )}
          </div>
        )}

        <div ref={threadRef} data-testid="ai-chat-thread" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <p className="mx-auto mt-10 max-w-md text-center text-sm text-neutral-500">
              워크스페이스의 페이지에 대해 물어보세요. 답에는 찾은 페이지가 출처로 붙습니다.
            </p>
          )}
          <ol className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((m) =>
              m.role === 'user' ? (
                <li key={m.id} data-testid="ai-chat-message" data-role="user" className="self-end max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-800">
                  {m.content}
                </li>
              ) : (
                <li key={m.id} data-testid="ai-chat-message" data-role="assistant" data-status={m.status ?? 'streaming'} className="flex flex-col gap-1.5">
                  <div data-testid="ai-chat-answer" aria-busy={m.status === null} className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {m.content === '' && m.status === null ? <span className="text-neutral-400">AI 가 쓰는 중…</span> : m.content}
                  </div>
                  {m.sources.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={NOTE}>출처</span>
                      {m.sources.map((s) =>
                        s.viewable ? (
                          <Link
                            key={s.n}
                            href={`/w/${workspaceId}/${s.pageId}`}
                            data-testid="ai-chat-source"
                            data-page-id={s.pageId}
                            data-cited={s.cited ? 'true' : 'false'}
                            className={`max-w-[16rem] truncate rounded border px-1.5 py-0.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 ${s.cited ? 'border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300' : 'border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400'}`}
                          >
                            {sourceChipText(s)}
                          </Link>
                        ) : (
                          <span key={s.n} data-testid="ai-chat-source-gone" className="rounded border border-dashed border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-400 dark:border-neutral-700">
                            [{s.n}] 볼 수 없는 페이지
                          </span>
                        ),
                      )}
                    </div>
                  )}
                  {m.status !== null && (
                    <div className="flex items-center gap-2">
                      {m.status === 'stopped' && <span className={NOTE}>멈췄습니다</span>}
                      {m.status === 'failed' && (
                        <span data-testid="ai-chat-failed" role="alert" className="text-xs text-red-600 dark:text-red-400">
                          {failures[m.id] ?? 'AI 가 답하지 못했습니다.'}
                        </span>
                      )}
                      {m.content !== '' && (
                        <button type="button" data-testid="ai-chat-copy" className={SMALL} onClick={() => void copy(m)}>
                          {copied === m.id ? '복사했습니다' : '복사'}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ),
            )}
          </ol>
        </div>

        {/* 입력 — 범위(워크스페이스 전체 · 특정 페이지) · 질문 · 보내기 / 멈추기 */}
        <div className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-neutral-500">범위</span>
              <button
                type="button"
                data-testid="ai-chat-scope-workspace"
                aria-pressed={scope.kind === 'workspace'}
                disabled={streaming}
                className={`rounded px-2 py-0.5 ${scope.kind === 'workspace' ? 'bg-neutral-200 dark:bg-neutral-700' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
                onClick={pickWorkspace}
              >
                워크스페이스 전체
              </button>
              <button
                type="button"
                data-testid="ai-chat-scope-page"
                aria-pressed={scope.kind === 'page'}
                disabled={streaming}
                className={`max-w-[16rem] truncate rounded px-2 py-0.5 ${scope.kind === 'page' ? 'bg-neutral-200 dark:bg-neutral-700' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
                onClick={() => setPicking((p) => !p)}
              >
                {scope.kind === 'page' ? (
                  <span data-testid="ai-chat-scope-title">{scopeTitle?.trim() || '제목 없음'}</span>
                ) : (
                  '특정 페이지…'
                )}
              </button>
            </div>
            {picking && (
              <PagePicker
                workspaceId={workspaceId}
                testId="ai-chat-page-picker"
                onPick={(p) => {
                  setScope({ kind: 'page', pageId: p.id })
                  setScopeTitle(p.title)
                  setPicking(false)
                  inputRef.current?.focus()
                }}
                onCancel={() => setPicking(false)}
              />
            )}
            {failure !== null && (
              <p data-testid="ai-chat-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
                {askFailureMessage(failure)}
              </p>
            )}
            {notice !== null && (
              <p data-testid="ai-chat-notice" role="status" className="text-xs text-red-600 dark:text-red-400">
                {notice}
              </p>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                data-testid="ai-chat-input"
                aria-label="AI 에게 물을 것"
                placeholder={ready ? 'AI 에게 무엇이든 물어보세요… (Shift+Enter 줄바꿈)' : 'AI 를 쓸 수 없습니다'}
                rows={2}
                maxLength={CHAT_QUESTION_MAX}
                disabled={!ready}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onInputKey}
                className="min-h-[2.75rem] min-w-0 flex-1 resize-y rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800 outline-none focus:border-neutral-500 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
              />
              {streaming ? (
                <button type="button" data-testid="ai-chat-stop" className={BUTTON} onClick={stopNow}>
                  멈추기
                </button>
              ) : (
                <button type="button" data-testid="ai-chat-send" className={PRIMARY} disabled={!ready || input.trim() === ''} onClick={() => void send()}>
                  보내기
                </button>
              )}
            </div>
            {footnote !== null && (
              <p data-testid="ai-chat-remaining" className={NOTE}>
                {footnote}
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
