'use client'

/**
 * AI 로 고치기의 메뉴 · 미리보기 · 바꾸기 (AI-3 · F-10-02) — 지연 로드(묻기와 같은 모듈 · `ai-ask-bar.tsx` 가 내보낸다)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑤ ⑥ · 10-ai-features.md F-10-02
 *
 * 서식 툴바의 AI 단추 · 글을 고른 Ctrl/Cmd+J 가 고른 글 아래에 연다(편집기 밖 · 프레임 좌표). 여는 순간의 선택을 읽어 둔다(`editSnapshot`).
 *
 *   · 메뉴 — 맨 위 "직접 지시" 칸(Enter 로 보낸다) + 프리셋(위아래 화살표 · Enter · 어조 ▸ · 번역 ▸ 은 오른쪽 화살표로 들어가고 왼쪽 · Esc 로 나온다)
 *   · 결과는 **이 미리보기에만** 흐른다(Y.Doc 밖) · 멈추기(단추 · Esc) · 한도 · 바쁨 · 실패는 묻기와 같다
 *   · 끝나면 바꾸기(글을 바꾸는 프리셋의 기본) · 아래에 넣기(요약 · 설명 · 할 일 뽑기의 기본) · 다시 · 버리기 · 이어서 다듬기(지금 결과 + 새 지시)
 *   · 바꾸기 직전에 고른 글을 다시 찾는다 — 그사이 바뀌었으면 바꾸지 않고 아래에 넣기를 권한다. 글 아닌 블록이 섞였으면 바꾸기가 없다
 *   · 할 일 뽑기는 할 일 블록으로만 넣는다(바꾸기 없음 — 원문을 지우지 않는다)
 */

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent } from 'react'
import type { EditorView } from '@tiptap/pm/view'

import { askFailureMessage, canRetry, remainingText, streamAi } from '@/lib/ai/ask-client'
import {
  AI_EDIT_CHANGED,
  AI_EDIT_NOTHING,
  AI_EDIT_NOT_REPLACEABLE,
  AI_EDIT_TOO_LONG,
  AI_EDIT_TOO_SHORT,
  editReducer,
  editRequestBody,
  initialEditState,
} from '@/lib/ai/edit-client'
import {
  EDIT_INSERT_FIRST,
  EDIT_INSTRUCTION_MAX,
  EDIT_LANGUAGES,
  EDIT_LANGUAGE_LABEL,
  EDIT_MIN_CHARS,
  EDIT_PRESET_LABEL,
  EDIT_TONES,
  EDIT_TONE_LABEL,
  type EditParams,
  type EditPreset,
} from '@/lib/ai/edit-prompt'
import type { AiEntry } from '@/lib/ai/usage'
import { editAnswerBlocks, editSnapshot, replaceSelectionCommand } from '@/lib/editor/ai-edit'
import { insertAiBlocksCommand } from '@/lib/editor/ai-insert'
import { containerAt } from '@/lib/editor/pm-blocks'
import { AiBlockedReason, BUTTON, INPUT, PRIMARY, boxBelow, composing, type Box } from './ai-bar-shared'

/** 메뉴 줄 — 블록 메뉴의 줄과 같은 크기(높이 28 · 둥글기 6 · 14px). */
const ITEM = 'flex min-h-7 w-full items-center rounded-md px-2 text-left text-sm'

type Submenu = 'tone' | 'translate'
type MenuItem = { readonly id: string; readonly label: string; readonly params?: EditParams; readonly submenu?: Submenu }

const MAIN: readonly EditPreset[] = ['improve', 'fix', 'shorter', 'longer', 'tone', 'simplify', 'summarize', 'translate', 'explain', 'action_items']
const plain = (preset: EditPreset): EditParams => ({ preset, tone: null, language: null, instruction: null })

function menuItems(sub: Submenu | null): readonly MenuItem[] {
  if (sub === 'tone') return EDIT_TONES.map((tone) => ({ id: `tone:${tone}`, label: EDIT_TONE_LABEL[tone], params: { ...plain('tone'), tone } }))
  if (sub === 'translate') {
    return EDIT_LANGUAGES.map((language) => ({ id: `translate:${language}`, label: EDIT_LANGUAGE_LABEL[language], params: { ...plain('translate'), language } }))
  }
  return MAIN.map((p) => (p === 'tone' || p === 'translate' ? { id: p, label: EDIT_PRESET_LABEL[p], submenu: p } : { id: p, label: EDIT_PRESET_LABEL[p], params: plain(p) }))
}

export function AiEditBar({
  view,
  frame,
  workspaceId,
  pageId,
  entry,
  onClose,
}: {
  view: EditorView
  frame: HTMLElement
  workspaceId: string
  pageId: string
  entry: AiEntry
  /** 닫는다 — 편집기로 포커스를 돌려준다. */
  onClose: () => void
}) {
  // 여는 순간의 고른 글 — 이것을 보내고 · 이 자리를 바꾼다(바꾸기 직전에 다시 찾는다)
  const [snapshot] = useState(() => editSnapshot(view.state))
  const [anchorId] = useState(() => snapshot?.anchorId ?? containerAt(view.state.selection.$to)?.id ?? null)
  const [state, dispatch] = useReducer(editReducer, initialEditState)
  const [params, setParams] = useState<EditParams | null>(null)
  const paramsRef = useRef<EditParams | null>(null)
  const [sub, setSub] = useState<Submenu | null>(null)
  const [active, setActive] = useState(0)
  const [instruction, setInstruction] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [box, setBox] = useState<Box | null>(() => (anchorId === null ? null : boxBelow(view, frame, anchorId, 360)))
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stopRef = useRef<HTMLButtonElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const ready = entry.state === 'ready'

  // ── 자리 — 고른 마지막 블록 바로 아래(문서 · 크기가 바뀌면 다시 잰다) ──
  const measure = useCallback(() => {
    if (anchorId === null) return
    const next = boxBelow(view, frame, anchorId, 360)
    if (next === null) return
    setBox((prev) => (prev !== null && prev.top === next.top && prev.left === next.left && prev.width === next.width ? prev : next))
  }, [view, frame, anchorId])

  useLayoutEffect(() => {
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

  // ── 응답 하나 — 차례(seq)마다 하나를 연다 · 내려가면(떠나면) 멈춘다 ──
  useEffect(() => {
    const p = paramsRef.current
    if (state.phase !== 'streaming' || p === null || snapshot === null) return
    const seq = state.seq
    const controller = new AbortController()
    abortRef.current = controller
    void streamAi(workspaceId, editRequestBody(pageId, p, snapshot.selection, state.followUp), controller.signal, (text) =>
      dispatch({ type: 'delta', seq, text }),
    ).then((outcome) => {
      if (outcome.kind === 'done') dispatch({ type: 'done', seq, truncated: outcome.truncated, quota: outcome.quota })
      else if (outcome.kind === 'aborted') dispatch({ type: 'stopped', seq })
      else dispatch({ type: 'failed', seq, failure: outcome.failure })
    })
    return () => controller.abort()
    // 차례가 곧 응답이다 — 프리셋 · 후속 지시는 그 차례에 정해졌다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.seq])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  // 포커스 — 메뉴는 지시 칸 · 흐르는 동안 멈추기 · 끝나면 이어서 다듬기 칸 · 칸이 없으면 창 자신(Esc 를 받는다)
  const placed = box !== null
  useEffect(() => {
    if (!placed) return
    const target = state.phase === 'streaming' ? stopRef.current : (inputRef.current ?? rootRef.current)
    target?.focus({ preventScroll: true })
  }, [state.phase, placed, sub])

  // 흐르는 동안의 Esc 는 어디에 포커스가 있든 멈춘다
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

  // 메뉴(지시 칸이 비었을 때) · 까닭 · 고를 글이 없을 때는 바깥을 누르면 닫힌다
  const looseRef = useRef(true)
  useEffect(() => {
    looseRef.current = !ready || snapshot === null || (state.phase === 'idle' && instruction.trim() === '')
  }, [ready, snapshot, state.phase, instruction])
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      if (looseRef.current) onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [onClose])

  const choose = (p: EditParams) => {
    if (snapshot === null) return setNotice(AI_EDIT_NOTHING)
    if (snapshot.chars < EDIT_MIN_CHARS) return setNotice(AI_EDIT_TOO_SHORT)
    setNotice(null)
    paramsRef.current = p
    setParams(p)
    dispatch({ type: 'start' })
  }

  const items = menuItems(sub)
  const openSub = (next: Submenu | null) => {
    setSub(next)
    setActive(0)
  }
  const pick = (item: MenuItem | undefined) => {
    if (item === undefined) return
    if (item.submenu) openSub(item.submenu)
    else if (item.params) choose(item.params)
  }

  const apply = (mode: 'replace' | 'below') => {
    if (snapshot === null || params === null) return
    if (!view.editable) return setNotice('이 페이지를 고칠 수 없게 되었습니다 — 넣지 못했습니다.')
    if (state.answer.trim() === '') return setNotice('넣을 내용이 없습니다.')
    const run = view.dispatch.bind(view)
    if (mode === 'replace') {
      if (!replaceSelectionCommand(snapshot.target, state.answer, params.preset)(view.state, run)) {
        setRefused(true)
        return setNotice(AI_EDIT_CHANGED)
      }
      return onClose()
    }
    const blocks = editAnswerBlocks(state.answer, params.preset)
    if (blocks.length === 0) return setNotice('넣을 내용이 없습니다.')
    if (!insertAiBlocksCommand(snapshot.anchorId, blocks, 'below')(view.state, run)) return setNotice('넣을 자리가 사라졌습니다 — 다른 사람이 그 줄을 지웠습니다.')
    onClose()
  }

  const onRootKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || composing(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (state.phase === 'streaming') stop()
    else if (state.phase === 'idle' && sub !== null) openSub(null)
    else onClose()
  }

  const onMenuKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (composing(e)) return
    const empty = instruction === ''
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (a + step + items.length) % items.length)
    } else if (e.key === 'ArrowRight' && empty && items[active]?.submenu) {
      e.preventDefault()
      openSub(items[active]!.submenu!)
    } else if (e.key === 'ArrowLeft' && empty && sub !== null) {
      e.preventDefault()
      openSub(null)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const text = instruction.trim()
      if (text !== '') choose({ ...plain('custom'), instruction: text })
      else pick(items[active])
    }
  }

  const submitFollowUp = () => {
    if (followUp.trim() === '') return
    setNotice(null)
    setRefused(false)
    dispatch({ type: 'followUp', instruction: followUp })
    setFollowUp('')
  }

  const settled = state.phase === 'done' || state.phase === 'stopped'
  const remaining = state.phase === 'done' ? remainingText(state.quota) : null
  const insertFirst = params !== null && EDIT_INSERT_FIRST.has(params.preset)
  const offersReplace = params !== null && params.preset !== 'action_items'
  const canReplace = offersReplace && snapshot !== null && snapshot.replaceable && !refused
  const replaceDefault = canReplace && !insertFirst
  const empty = state.answer.trim() === ''
  const phase = !ready ? 'blocked' : snapshot === null ? 'empty' : state.phase === 'idle' ? 'menu' : state.phase

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="AI 로 고치기"
      data-testid="ai-edit-bar"
      data-phase={phase}
      data-preset={params?.preset}
      tabIndex={-1}
      onKeyDown={onRootKey}
      style={box === null ? { visibility: 'hidden' } : { top: box.top, left: box.left, width: box.width }}
      className="absolute z-20 flex flex-col gap-2 popover-surface p-2 text-sm text-neutral-800 outline-none dark:text-neutral-200"
    >
      {!ready && <AiBlockedReason entry={entry} workspaceId={workspaceId} testId="ai-edit" onClose={onClose} />}

      {ready && snapshot === null && (
        <div className="flex items-center gap-2">
          <p data-testid="ai-edit-empty" role="status" className="flex-1">
            {AI_EDIT_NOTHING}
          </p>
          <button type="button" className={BUTTON} onClick={onClose}>
            닫기
          </button>
        </div>
      )}

      {ready && snapshot !== null && state.phase === 'idle' && (
        <>
          <input
            ref={inputRef}
            data-testid="ai-edit-instruction"
            aria-label="직접 지시"
            placeholder="AI 에게 어떻게 고칠지 말하세요…"
            maxLength={EDIT_INSTRUCTION_MAX}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={onMenuKey}
            className={INPUT}
          />
          <div role="menu" aria-label={sub === null ? 'AI 로 고치기' : EDIT_PRESET_LABEL[sub]} className="flex flex-col">
            {sub !== null && (
              <button
                type="button"
                tabIndex={-1}
                data-testid="ai-edit-back"
                className={`${ITEM} text-neutral-500`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => openSub(null)}
              >
                ‹ {EDIT_PRESET_LABEL[sub]}
              </button>
            )}
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                data-testid="ai-edit-item"
                data-item={item.id}
                data-active={i === active ? 'true' : undefined}
                aria-haspopup={item.submenu ? 'menu' : undefined}
                className={`${ITEM} justify-between ${i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(item)}
              >
                <span>{item.label}</span>
                {item.submenu && <span aria-hidden>▸</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {ready && state.phase !== 'idle' && (
        <div
          data-testid="ai-edit-preview"
          aria-busy={state.phase === 'streaming'}
          className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 px-2 py-1 dark:bg-neutral-900"
        >
          {state.answer === '' && state.phase === 'streaming' ? <span className="text-neutral-400">…</span> : state.answer}
        </div>
      )}

      {ready && state.phase === 'streaming' && (
        <div className="flex items-center gap-2">
          <span data-testid="ai-edit-progress" role="status" className="flex-1 text-xs text-neutral-500">
            AI 가 고치는 중…
          </span>
          <button ref={stopRef} type="button" data-testid="ai-edit-stop" className={BUTTON} onClick={stop}>
            멈추기
          </button>
        </div>
      )}

      {ready && state.phase === 'error' && state.failure !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <p data-testid="ai-edit-error" role="alert" className="flex-1 text-red-600 dark:text-red-400">
            {state.failure.kind === 'too_long' ? AI_EDIT_TOO_LONG : askFailureMessage(state.failure)}
          </p>
          {canRetry(state.failure) && (
            <button type="button" data-testid="ai-edit-retry" className={BUTTON} onClick={() => dispatch({ type: 'retry' })}>
              다시
            </button>
          )}
          <button type="button" data-testid="ai-edit-discard" className={BUTTON} onClick={onClose}>
            닫기
          </button>
        </div>
      )}

      {ready && settled && (
        <div className="flex flex-wrap items-center gap-1">
          {offersReplace && (
            <button
              type="button"
              data-testid="ai-edit-replace"
              data-default={replaceDefault ? 'true' : undefined}
              className={replaceDefault ? PRIMARY : BUTTON}
              disabled={!canReplace || empty}
              onClick={() => apply('replace')}
            >
              바꾸기
            </button>
          )}
          <button
            type="button"
            data-testid="ai-edit-below"
            data-default={replaceDefault ? undefined : 'true'}
            className={replaceDefault ? BUTTON : PRIMARY}
            disabled={empty}
            onClick={() => apply('below')}
          >
            아래에 넣기
          </button>
          <button type="button" data-testid="ai-edit-retry" className={BUTTON} onClick={() => dispatch({ type: 'retry' })}>
            다시
          </button>
          <button type="button" data-testid="ai-edit-discard" className={BUTTON} onClick={onClose}>
            버리기
          </button>
          <span className="ml-auto text-xs text-neutral-500">
            {state.phase === 'stopped' ? '멈췄습니다' : state.truncated ? '결과가 길어 잘렸습니다' : ''}
            {remaining !== null && (
              <span data-testid="ai-edit-remaining" className="ml-2">
                {remaining}
              </span>
            )}
          </span>
        </div>
      )}

      {ready && settled && offersReplace && snapshot !== null && !snapshot.replaceable && (
        <p data-testid="ai-edit-not-replaceable" role="status" className="text-xs text-neutral-500">
          {AI_EDIT_NOT_REPLACEABLE}
        </p>
      )}

      {notice !== null && (
        <p data-testid="ai-edit-notice" role="status" className="text-xs text-red-600 dark:text-red-400">
          {notice}
        </p>
      )}

      {ready && settled && (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            data-testid="ai-edit-followup"
            aria-label="이어서 다듬기"
            placeholder="이어서 다듬기 — 예: 조금 더 부드럽게"
            maxLength={EDIT_INSTRUCTION_MAX}
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || composing(e)) return
              e.preventDefault()
              submitFollowUp()
            }}
            className={INPUT}
          />
          <button type="button" data-testid="ai-edit-followup-submit" className={PRIMARY} disabled={followUp.trim() === ''} onClick={submitFollowUp}>
            다듬기
          </button>
        </div>
      )}
    </div>
  )
}
