'use client'

/**
 * 페이지 번역의 패널 — 언어 피커 · 확인 · 진행 토스트 (AI-4 · F-10-03)
 *
 * "···" 의 "번역" 이 처음 눌릴 때 지연 로드한다(`translate-page-button.tsx` · 첫 JS 예산). 상태는 `translate-client.ts` 의 상태 기계 하나다.
 *
 *   - **카드**(메뉴 자리 · `hold`) — 언어(최근 쓴 것이 위) → 미리 보기(쓸 응답 수 · 남은 응답) → 확인. 남은 응답이 모자라면 말하고 번역 단추를
 *     끈다(서버도 막는다). AI 를 쓸 수 없으면(꺼짐 · 공급자 없음) 까닭과 켜는 길.
 *   - **토스트**(화면 오른쪽 아래 · 포털 — 메뉴를 닫아도 남는다) — "번역 중 3/8" · 취소 → 끝나면 "번역본을 열기" · 멈췄으면 어디서 왜 · 다시.
 *     취소는 연결을 끊는다 — 서버가 흐르던 청크를 멈추고 거기까지로 번역본을 쓴다(그 페이지는 시작할 때 이미 만들었다).
 */

import { useEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'

import { EDIT_LANGUAGE_LABEL, type EditLanguage } from '@/lib/ai/edit-prompt'
import {
  costText,
  enoughQuota,
  fetchTranslateEstimate,
  inCard,
  inToast,
  initialTranslateState,
  notEnoughText,
  orderLanguages,
  readRecentLanguages,
  rememberLanguage,
  resultText,
  streamTranslate,
  translateCanRetry,
  translateFailureMessage,
  translateReducer,
  writeRecentLanguages,
} from '@/lib/ai/translate-client'
import type { AiEntry } from '@/lib/ai/usage'
import { AiBlockedReason, BUTTON, PRIMARY } from './ai-bar-shared'
import { MENU_PANEL_PLACE, MENU_ROW, usePageMenu } from './page-menu'

const TOAST =
  'fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200'

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function TranslatePanel({ workspaceId, pageId, ai, opens }: { workspaceId: string; pageId: string; ai: AiEntry; opens: number }) {
  const menu = usePageMenu()
  const router = useRouter()
  const [s, dispatch] = useReducer(translateReducer, initialTranslateState)
  const [recent, setRecent] = useState<EditLanguage[]>(() => readRecentLanguages(storage()))
  const [seenOpens, setSeenOpens] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  // 줄을 누를 때마다 연다 — 렌더 중에 고친다(효과 안의 setState 는 렌더를 연쇄시킨다)
  if (opens !== seenOpens) {
    setSeenOpens(opens)
    dispatch({ type: 'open' })
  }

  const cardOpen = inCard(s)
  useEffect(() => menu?.register('translate', () => dispatch({ type: 'close' })), [menu])
  useEffect(() => {
    menu?.hold('translate', cardOpen)
  }, [menu, cardOpen])
  useEffect(() => () => menu?.hold('translate', false), [menu])

  // 미리 보기 — 쓸 응답 수 · 남은 응답(부르지 않는다)
  useEffect(() => {
    if (s.phase !== 'estimating' || s.language === null) return
    const seq = s.seq
    let live = true
    void fetchTranslateEstimate(workspaceId, pageId, s.language).then((out) => {
      if (!live) return
      dispatch(out.kind === 'ok' ? { type: 'estimated', seq, chunks: out.chunks, remaining: out.remaining } : { type: 'failed', seq, failure: out.failure })
    })
    return () => {
      live = false
    }
  }, [s.phase, s.seq, s.language, workspaceId, pageId])

  // 번역 — 화면을 떠나도 끊지 않는다(서버가 끝까지 쓴다) · 취소만 끊는다
  useEffect(() => {
    if (s.phase !== 'running' || s.language === null) return
    const seq = s.seq
    const abort = new AbortController()
    abortRef.current = abort
    let made: string | null = null
    let last = { done: 0, total: 0 }
    void streamTranslate(workspaceId, { pageId, language: s.language }, abort.signal, (e) => {
      if (e.kind === 'wait') return dispatch({ type: 'wait', seq, seconds: e.seconds })
      last = { done: e.done, total: e.total }
      if (made === null && e.pageId !== null) {
        made = e.pageId
        // 번역본은 시작할 때 만들었다 — 사이드바에 세운다
        router.refresh()
      }
      dispatch({ type: 'progress', seq, done: e.done, total: e.total, pageId: e.pageId })
    }).then((out) => {
      if (out.kind === 'done') {
        dispatch({ type: 'finished', seq, result: out.result })
        router.refresh()
      } else if (abort.signal.aborted && made !== null) {
        // 취소 — 서버가 거기까지로 번역본을 쓴다(그 끝은 끊긴 연결로 오지 않는다)
        dispatch({
          type: 'finished',
          seq,
          result: { status: 'partial', pageId: made, translated: 0, skipped: 0, done: last.done, total: last.total, reason: 'stopped', limit: null, resetsAt: null },
        })
      } else {
        dispatch({ type: 'failed', seq, failure: out.failure })
      }
    })
  }, [s.phase, s.seq, s.language, workspaceId, pageId, router])

  const pick = (language: EditLanguage) => {
    const next = rememberLanguage(recent, language)
    setRecent(next)
    writeRecentLanguages(storage(), next)
    dispatch({ type: 'pick', language })
  }
  const close = () => {
    dispatch({ type: 'close' })
    menu?.focusTrigger()
  }
  const start = () => {
    dispatch({ type: 'start' })
    menu?.close()
  }
  const cancel = () => {
    abortRef.current?.abort()
    dispatch({ type: 'cancel' })
  }
  const openTranslation = (id: string) => {
    dispatch({ type: 'dismiss' })
    router.push(`/w/${workspaceId}/${id}`)
  }

  const label = s.language === null ? '' : EDIT_LANGUAGE_LABEL[s.language]
  const card = cardOpen && (
    <div data-testid="translate-panel" data-phase={s.phase} role="dialog" aria-label="페이지 번역" className={`${MENU_PANEL_PLACE} flex w-64 flex-col gap-1 popover-surface p-1 text-sm`}>
      {ai.state !== 'ready' ? (
        <div className="p-2 text-xs text-neutral-600 dark:text-neutral-300">
          <AiBlockedReason entry={ai} workspaceId={workspaceId} testId="translate" onClose={close} />
        </div>
      ) : s.phase === 'pick' ? (
        <>
          <p className="px-2 pb-0.5 pt-1.5 text-xs text-neutral-500 dark:text-neutral-400">번역할 언어 — 새 하위 페이지로 만듭니다</p>
          {orderLanguages(recent).map((language) => (
            <button key={language} type="button" data-testid="translate-language" data-language={language} className={`${MENU_ROW} justify-between`} onClick={() => pick(language)}>
              {EDIT_LANGUAGE_LABEL[language]}
              {recent.includes(language) && <span className="text-xs text-neutral-400">최근</span>}
            </button>
          ))}
        </>
      ) : s.phase === 'estimating' ? (
        <p role="status" data-testid="translate-estimating" className="px-2 py-2 text-xs text-neutral-500 dark:text-neutral-400">
          {label} — 쓸 응답을 세는 중…
        </p>
      ) : s.phase === 'confirm' ? (
        <div data-testid="translate-confirm" className="flex flex-col gap-2 p-2">
          <p className="font-medium">{label}(으)로 번역</p>
          <p className="text-xs text-neutral-600 dark:text-neutral-300">원본은 그대로 두고 새 하위 페이지에 번역본을 만듭니다. 코드 · 수식 · 링크 주소는 옮기지 않습니다.</p>
          <p data-testid="translate-cost" className="text-xs text-neutral-600 dark:text-neutral-300">
            {costText(s.chunks, s.remaining)}
          </p>
          {!enoughQuota(s) && (
            <p role="alert" data-testid="translate-not-enough" className="text-xs text-red-600 dark:text-red-400">
              {notEnoughText(s.chunks, s.remaining ?? 0)}
            </p>
          )}
          <div className="flex justify-end gap-1">
            <button type="button" data-testid="translate-back" className={BUTTON} onClick={() => dispatch({ type: 'back' })}>
              뒤로
            </button>
            <button type="button" data-testid="translate-start" className={PRIMARY} disabled={!enoughQuota(s)} onClick={start}>
              번역
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-2">
          <p role="alert" data-testid="translate-error" className="text-xs text-red-600 dark:text-red-400">
            {s.failure === null ? '' : translateFailureMessage(s.failure)}
          </p>
          <div className="flex justify-end gap-1">
            <button type="button" data-testid="translate-back" className={BUTTON} onClick={() => dispatch({ type: 'back' })}>
              뒤로
            </button>
            <button type="button" data-testid="translate-dismiss" className={BUTTON} onClick={close}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  )

  const toast =
    inToast(s) &&
    typeof document !== 'undefined' &&
    createPortal(
      <div data-testid="translate-toast" data-phase={s.phase} role="status" aria-live="polite" className={TOAST}>
        {s.phase === 'running' ? (
          <div className="flex items-center gap-3">
            <span data-testid="translate-progress" className="flex-1">
              {s.cancelling ? '취소하는 중…' : `번역 중 ${s.done}/${s.total}`}
            </span>
            {s.waiting !== null && !s.cancelling && <span className="text-xs text-neutral-500">AI 서비스가 바빠 {s.waiting}초 기다립니다</span>}
            <button type="button" data-testid="translate-cancel" className={BUTTON} disabled={s.cancelling} onClick={cancel}>
              취소
            </button>
          </div>
        ) : s.phase === 'done' && s.result !== null ? (
          <>
            <p data-testid="translate-result" data-status={s.result.status}>
              {resultText(s.result)}
            </p>
            <div className="flex justify-end gap-1">
              {s.result.status === 'partial' && (
                <button type="button" data-testid="translate-retry" className={BUTTON} onClick={() => dispatch({ type: 'retry' })}>
                  다시
                </button>
              )}
              <button type="button" data-testid="translate-dismiss" className={BUTTON} onClick={() => dispatch({ type: 'dismiss' })}>
                닫기
              </button>
              <button type="button" data-testid="translate-open" className={PRIMARY} onClick={() => openTranslation(s.result!.pageId)}>
                번역본을 열기
              </button>
            </div>
          </>
        ) : (
          <>
            <p data-testid="translate-error" className="text-red-600 dark:text-red-400">
              {s.failure === null ? '' : translateFailureMessage(s.failure)}
            </p>
            <div className="flex justify-end gap-1">
              {s.failure !== null && translateCanRetry(s.failure) && (
                <button type="button" data-testid="translate-retry" className={BUTTON} onClick={() => dispatch({ type: 'retry' })}>
                  다시
                </button>
              )}
              <button type="button" data-testid="translate-dismiss" className={BUTTON} onClick={() => dispatch({ type: 'dismiss' })}>
                닫기
              </button>
            </div>
          </>
        )}
      </div>,
      document.body,
    )

  return (
    <>
      {card}
      {toast}
    </>
  )
}
