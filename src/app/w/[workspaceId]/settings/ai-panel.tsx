'use client'

/**
 * AI 패널 — 설정 → 워크스페이스 → AI (AI-1 · F-10-12)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ③ ⑤
 *
 * 소유자는 스위치(기본 끔)와 "글이 어디로 가는가" 알림을 본다 — 판정은 서버다(`PUT /ai` · `setAiEnabled`). 모두(게스트 아님)가 이번
 * 기간의 쓴 양 · 남은 보충 · 언제 풀리는지 · 공급자의 이름(host)을 본다. 쓴 양은 화면을 열 때의 값이다.
 */

import { useState } from 'react'

import type { AiSettingsSummary } from '@/lib/ai/usage'
import {
  AI_DISABLED,
  AI_ENABLED,
  AI_OWNER_ONLY,
  AI_SWITCH_LABEL,
  AI_UNAVAILABLE,
  aiDisclosure,
  aiSwitchFailureMessage,
  aiUsageLines,
} from './ai-messages'

const NOTE = 'text-xs text-neutral-500'

export function AiPanel({ workspaceId, initial }: { workspaceId: string; initial: AiSettingsSummary }) {
  const [enabled, setEnabled] = useState(initial.enabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = async (next: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/ai`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const body = (await res.json().catch(() => null)) as { enabled?: boolean; error?: string } | null
      if (!res.ok || typeof body?.enabled !== 'boolean') {
        setError(aiSwitchFailureMessage(body?.error))
        return
      }
      setEnabled(body.enabled)
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const lines = aiUsageLines(initial.quota)
  return (
    <section data-testid="ai-panel" data-enabled={enabled ? 'true' : 'false'} className="mt-6 flex flex-col gap-3">
      <h2 className="text-sm font-medium">AI</h2>
      {!initial.available && (
        <p data-testid="ai-unavailable" className={NOTE}>
          {AI_UNAVAILABLE}
        </p>
      )}
      {initial.canManage ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            role="switch"
            data-testid="ai-switch"
            checked={enabled}
            aria-checked={enabled}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
          />
          {AI_SWITCH_LABEL}
        </label>
      ) : (
        <p data-testid="ai-state" className="text-sm">
          {enabled ? AI_ENABLED : AI_DISABLED} <span className={NOTE}>{AI_OWNER_ONLY}</span>
        </p>
      )}
      {initial.providerHost !== null && (
        <p data-testid="ai-disclosure" className={NOTE}>
          {aiDisclosure(initial.providerHost)}
        </p>
      )}
      {initial.providerHost !== null && (
        <p data-testid="ai-provider" className={NOTE}>
          AI 서비스: <code>{initial.providerHost}</code>
          {initial.model !== null && (
            <>
              {' '}
              · 모델 <code>{initial.model}</code>
            </>
          )}
        </p>
      )}
      <div>
        <h3 className="text-xs font-medium">쓴 양</h3>
        <ul data-testid="ai-usage" className="mt-1 flex flex-col gap-0.5 text-xs text-neutral-600 dark:text-neutral-400">
          {lines.map((line) => (
            <li key={line.key} data-line={line.key}>
              {line.text}
            </li>
          ))}
        </ul>
      </div>
      {error !== null && (
        <p role="alert" data-testid="ai-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  )
}
