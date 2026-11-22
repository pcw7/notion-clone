'use client'

/**
 * 내 AI 지시 — 설정 → 워크스페이스 → AI (AI-6 · F-10-22)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑪
 *
 * 페이지 하나를 가리킨다(한 번에 하나) — 고르기 · "새 페이지로 만들기"(개인 페이지 "내 AI 지시" + 짧은 틀) · 해제. AI 채팅이 대화마다 그
 * 페이지의 글(앞 1,500자)을 함께 싣는다 — 채팅에만(묻기 · 고치기 · 번역 · AI 블록에는 싣지 않는다). 다른 사람이 그 페이지를 고칠 수 있으면
 * F-10-22 의 경고를 보인다. 판정은 서버다(`…/ai/instructions`).
 */

import { useState } from 'react'

import Link from '@/app/link'
import type { AiInstructionsView } from '@/lib/ai/chat-store'
// 정적으로 — 지연 로드(`next/dynamic`)는 덧붙는 몫이 이 작은 고르개보다 커서 설정의 첫 JS 가 오히려 늘었다(227.5 → 227.9KB)
import { PagePicker } from '../ai/page-picker'

const BUTTON = 'rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800'
const NOTE = 'text-xs text-neutral-500'

export const AI_INSTRUCTIONS_SHARED_WARNING = '다른 사람이 이 페이지를 고치면 내 AI 의 행동이 바뀝니다'

export function AiInstructionsPanel({ workspaceId, initial }: { workspaceId: string; initial: AiInstructionsView }) {
  const [view, setView] = useState(initial)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const call = async (init: RequestInit) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/ai/instructions`, { ...init, headers: { 'content-type': 'application/json' } })
      const body = (await res.json().catch(() => null)) as { instructions?: AiInstructionsView; error?: string } | null
      if (!res.ok || body?.instructions === undefined) {
        setError(body?.error === 'not_found' ? '그 페이지를 볼 수 없습니다.' : '바꾸지 못했습니다. 다시 시도하세요.')
        return
      }
      setView(body.instructions)
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-testid="ai-instructions" data-state={view.state} className="mt-6 flex flex-col gap-2">
      <h3 className="text-sm font-medium">내 AI 지시</h3>
      <p className={NOTE}>
        페이지 하나에 말투 · 형식 · 나에 대한 맥락을 적어 두면 AI 채팅이 대화마다 함께 읽습니다(앞 1,500자 · 나에게만 · 채팅에만 쓰입니다).
      </p>
      {view.state === 'none' && (
        <p data-testid="ai-instructions-none" className="text-sm">
          정한 페이지가 없습니다.
        </p>
      )}
      {view.state === 'ok' && view.pageId !== null && (
        <p className="text-sm">
          지시 페이지:{' '}
          <Link data-testid="ai-instructions-page" data-page-id={view.pageId} href={`/w/${workspaceId}/${view.pageId}`} className="text-blue-600 hover:underline dark:text-blue-400">
            {view.title?.trim() || '제목 없음'}
          </Link>
        </p>
      )}
      {view.state === 'unavailable' && (
        <p data-testid="ai-instructions-unavailable" role="status" className="text-sm text-amber-700 dark:text-amber-400">
          지시 페이지를 볼 수 없습니다(휴지통 · 권한) — 채팅에 싣지 않습니다. 다른 페이지를 고르거나 해제하세요.
        </p>
      )}
      {view.state === 'ok' && view.otherEditors > 0 && (
        <p data-testid="ai-instructions-warning" role="alert" className="text-xs text-amber-700 dark:text-amber-400">
          ⚠ {AI_INSTRUCTIONS_SHARED_WARNING} — 이 페이지는 나 말고 {view.otherEditors}명이 고칠 수 있습니다.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="ai-instructions-pick" className={BUTTON} disabled={busy} onClick={() => setPicking((p) => !p)}>
          {view.state === 'none' ? '페이지 고르기' : '다른 페이지 고르기'}
        </button>
        <button type="button" data-testid="ai-instructions-create" className={BUTTON} disabled={busy} onClick={() => void call({ method: 'POST' })}>
          새 페이지로 만들기
        </button>
        {view.state !== 'none' && (
          <button type="button" data-testid="ai-instructions-clear" className={BUTTON} disabled={busy} onClick={() => void call({ method: 'PUT', body: JSON.stringify({ pageId: null }) })}>
            해제
          </button>
        )}
      </div>
      {picking && (
        <PagePicker
          workspaceId={workspaceId}
          testId="ai-instructions-picker"
          onPick={(p) => {
            setPicking(false)
            void call({ method: 'PUT', body: JSON.stringify({ pageId: p.id }) })
          }}
          onCancel={() => setPicking(false)}
        />
      )}
      {error !== null && (
        <p role="alert" data-testid="ai-instructions-error" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  )
}
