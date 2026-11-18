'use client'

/**
 * AI 에게 묻기의 입력창 · 미리보기 · 받아들이기 (AI-2 · F-10-01 · F-10-09) — 지연 로드(`body-popups-lazy.tsx`)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑤ ⑥ · 10-ai-features.md F-10-01 · F-10-09
 *
 * 빈 줄의 스페이스 · `/ai` 가 그 줄 아래에 연다(편집기 밖 · 프레임 좌표). 답은 **이 미리보기에만** 흐른다 — Y.Doc 에 들지 않아 같이 보는
 * 사람에게 보이지 않는다. 받아들이면 그때 한 트랜잭션으로 블록이 된다(그 사람의 편집 · 출처 editor · Ctrl+Z 한 번에 빠진다).
 *
 *   · 멈추기(버튼 · Esc) — 연결을 닫는다(서버가 stopped — 셈에 든다) · 받은 데까지 미리보기에 남는다
 *   · 끝나면 받아들이기(빈 줄을 바꾼다) · 아래에 넣기(줄을 둔다) · 다시(새 응답 하나) · 버리기 · 이어서 묻기(앞선 문답을 싣는다)
 *   · 한도 · 바쁨 · 연결 — 까닭과 언제(한도는 풀릴 때까지 다시 단추가 없다)
 *   · 떠나면(이 컴포넌트가 내려가면) 흐르던 응답을 멈춘다 · 응답은 한 번에 하나(상태 기계가 두 번 누르기를 막는다)
 *   · AI 를 쓸 수 없으면(꺼짐 · 공급자 없음 · 게스트) 까닭만 — 꺼져 있으면 소유자에게 설정 → AI 로 가는 링크
 */

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent } from 'react'
import type { EditorView } from '@tiptap/pm/view'

import { askFailureMessage, askReducer, canRetry, initialAskState, remainingText, streamAsk } from '@/lib/ai/ask-client'
import type { AiEntry } from '@/lib/ai/usage'
import { aiAnswerBlocks, insertAiBlocksCommand, type AiInsertMode } from '@/lib/editor/ai-insert'
import { AiBlockedReason, BUTTON, INPUT, PRIMARY, boxBelow, composing, type Box } from './ai-bar-shared'

// AI 로 고치기(AI-3)의 창 — 같은 지연 로드 모듈로 받는다(`body-popups-lazy.tsx` 의 `AiEditBarLazy`)
export { AiEditBar } from './ai-edit-bar'

export function AiAskBar({
  view,
  frame,
  workspaceId,
  pageId,
  blockId,
  entry,
  onClose,
}: {
  view: EditorView
  frame: HTMLElement
  workspaceId: string
  pageId: string
  /** 넣을 자리 — 연 줄의 블록. */
  blockId: string
  entry: AiEntry
  /** 닫는다 — 편집기로 포커스를 돌려준다. */
  onClose: () => void
}) {
  const [state, dispatch] = useReducer(askReducer, initialAskState)
  const [question, setQuestion] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  // 첫 자리는 그리기 전에 잰다 — 숨긴 채 그리면(visibility) 포커스가 들어가지 않아 친 글이 본문으로 간다
  const [box, setBox] = useState<Box | null>(() => boxBelow(view, frame, blockId))
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stopRef = useRef<HTMLButtonElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const ready = entry.state === 'ready'

  // ── 자리 — 그 줄 바로 아래(문서가 바뀌면 · 크기가 바뀌면 다시 잰다) ──
  const measure = useCallback(() => {
    const next = boxBelow(view, frame, blockId)
    if (next === null) return
    setBox((prev) => (prev !== null && prev.top === next.top && prev.left === next.left && prev.width === next.width ? prev : next))
  }, [view, frame, blockId])

  useLayoutEffect(() => {
    // 줄이 아직 없었으면(드문 경우) 다음 프레임에 다시 잰다 — 효과 안에서 곧바로 상태를 바꾸지 않는다
    const first = requestAnimationFrame(measure)
    const mutations = new MutationObserver(measure)
    mutations.observe(view.dom, { childList: true, subtree: true, characterData: true })
    const sizes = new ResizeObserver(measure)
    sizes.observe(view.dom)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(first)
      mutations.disconnect()
      sizes.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, view])

  // ── 응답 하나 — 차례(seq)가 바뀔 때마다 하나를 연다 · 내려가면(떠나면) 멈춘다 ──
  useEffect(() => {
    if (state.phase !== 'streaming') return
    const seq = state.seq
    const controller = new AbortController()
    abortRef.current = controller
    void streamAsk(workspaceId, { pageId, blockId, question: state.question, history: state.history }, controller.signal, (text) =>
      dispatch({ type: 'delta', seq, text }),
    ).then((outcome) => {
      if (outcome.kind === 'done') dispatch({ type: 'done', seq, truncated: outcome.truncated, quota: outcome.quota })
      else if (outcome.kind === 'aborted') dispatch({ type: 'stopped', seq })
      else dispatch({ type: 'failed', seq, failure: outcome.failure })
    })
    return () => controller.abort()
    // 차례가 곧 응답이다 — 질문 · 앞선 문답은 그 차례에 정해졌다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.seq])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  // 포커스 — 처음엔 질문 칸 · 흐르는 동안 멈추기 · 끝나면 이어서 묻기 칸 · 칸이 없으면(까닭 · 실패) 창 자신(Esc 를 받는다)
  const placed = box !== null
  useEffect(() => {
    if (!placed) return
    const target = state.phase === 'streaming' ? stopRef.current : (inputRef.current ?? rootRef.current)
    target?.focus({ preventScroll: true })
  }, [state.phase, placed])

  // 흐르는 동안의 Esc 는 어디에 포커스가 있든 멈춘다(편집기를 눌렀어도)
  useEffect(() => {
    if (state.phase !== 'streaming') return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      e.preventDefault()
      e.stopPropagation()
      stop()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [state.phase, stop])

  // 빈 입력창은 바깥을 누르면 닫힌다
  const emptyRef = useRef(true)
  useEffect(() => {
    emptyRef.current = state.phase === 'idle' && question.trim() === ''
  }, [state.phase, question])
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      if (emptyRef.current || !ready) onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [onClose, ready])

  const submit = () => {
    const q = question.trim()
    if (q === '') return
    setNotice(null)
    dispatch(state.phase === 'idle' ? { type: 'ask', question: q } : { type: 'followUp', question: q })
    setQuestion('')
  }

  const insert = (mode: AiInsertMode) => {
    if (!view.editable) {
      setNotice('이 페이지를 고칠 수 없게 되었습니다 — 넣지 못했습니다.')
      return
    }
    const blocks = aiAnswerBlocks(state.answer)
    if (blocks.length === 0) {
      setNotice('넣을 내용이 없습니다.')
      return
    }
    if (!insertAiBlocksCommand(blockId, blocks, mode)(view.state, view.dispatch.bind(view))) {
      setNotice('넣을 자리가 사라졌습니다 — 다른 사람이 그 줄을 지웠습니다.')
      return
    }
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || composing(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (state.phase === 'streaming') stop()
    else onClose()
  }

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || composing(e)) return
    e.preventDefault()
    submit()
  }

  const settled = state.phase === 'done' || state.phase === 'stopped'
  const remaining = state.phase === 'done' ? remainingText(state.quota) : null

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="AI 에게 묻기"
      data-testid="ai-ask-bar"
      data-phase={ready ? state.phase : 'blocked'}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={box === null ? { visibility: 'hidden' } : { top: box.top, left: box.left, width: box.width }}
      className="absolute z-20 flex flex-col gap-2 popover-surface p-2 text-sm text-neutral-800 outline-none dark:text-neutral-200"
    >
      {!ready && <AiBlockedReason entry={entry} workspaceId={workspaceId} testId="ai-ask" onClose={onClose} />}

      {ready && state.phase !== 'idle' && (
        <div
          data-testid="ai-ask-preview"
          aria-busy={state.phase === 'streaming'}
          className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 px-2 py-1 dark:bg-neutral-900"
        >
          {state.answer === '' && state.phase === 'streaming' ? <span className="text-neutral-400">…</span> : state.answer}
        </div>
      )}

      {ready && state.phase === 'streaming' && (
        <div className="flex items-center gap-2">
          <span data-testid="ai-ask-progress" role="status" className="flex-1 text-xs text-neutral-500">
            AI 가 쓰는 중…
          </span>
          <button ref={stopRef} type="button" data-testid="ai-ask-stop" className={BUTTON} onClick={stop}>
            멈추기
          </button>
        </div>
      )}

      {ready && state.phase === 'error' && state.failure !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <p data-testid="ai-ask-error" role="alert" className="flex-1 text-red-600 dark:text-red-400">
            {askFailureMessage(state.failure)}
          </p>
          {canRetry(state.failure) && (
            <button type="button" data-testid="ai-ask-retry" className={BUTTON} onClick={() => dispatch({ type: 'retry' })}>
              다시
            </button>
          )}
          <button type="button" data-testid="ai-ask-discard" className={BUTTON} onClick={onClose}>
            닫기
          </button>
        </div>
      )}

      {ready && settled && (
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" data-testid="ai-ask-accept" className={PRIMARY} disabled={state.answer.trim() === ''} onClick={() => insert('replace')}>
            받아들이기
          </button>
          <button type="button" data-testid="ai-ask-below" className={BUTTON} disabled={state.answer.trim() === ''} onClick={() => insert('below')}>
            아래에 넣기
          </button>
          <button type="button" data-testid="ai-ask-retry" className={BUTTON} onClick={() => dispatch({ type: 'retry' })}>
            다시
          </button>
          <button type="button" data-testid="ai-ask-discard" className={BUTTON} onClick={onClose}>
            버리기
          </button>
          <span className="ml-auto text-xs text-neutral-500">
            {state.phase === 'stopped' ? '멈췄습니다' : state.truncated ? '답이 길어 잘렸습니다' : ''}
            {remaining !== null && (
              <span data-testid="ai-ask-remaining" className="ml-2">
                {remaining}
              </span>
            )}
          </span>
        </div>
      )}

      {notice !== null && (
        <p data-testid="ai-ask-notice" role="status" className="text-xs text-red-600 dark:text-red-400">
          {notice}
        </p>
      )}

      {ready && (state.phase === 'idle' || settled) && (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            data-testid={state.phase === 'idle' ? 'ai-ask-input' : 'ai-ask-followup'}
            aria-label={state.phase === 'idle' ? 'AI 에게 물을 것' : 'AI 에게 이어서 물을 것'}
            placeholder={state.phase === 'idle' ? 'AI 에게 무엇이든 물어보세요…' : '이어서 묻기…'}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onInputKey}
            className={INPUT}
          />
          <button type="button" data-testid="ai-ask-submit" className={PRIMARY} disabled={question.trim() === ''} onClick={submit}>
            묻기
          </button>
        </div>
      )}
    </div>
  )
}
