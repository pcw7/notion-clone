'use client'

/**
 * AI 모델 — 설정 → AI 의 모델 절 (AI-7 · F-10-26) · 지연 로드(`ai-lazy.tsx`)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑫
 *
 * 소유자는 공급자의 목록에서 멤버가 AI 채팅에서 고를 모델을 더하고, 편집기의 AI 와 채팅의 "자동" 이 쓸 워크스페이스 기본을 고른다(저장 —
 * `PUT …/ai/models` 가 다시 판정한다). 자동(`AI_MODEL`)은 늘 쓸 수 있다. 다른 사람은 쓸 수 있는 모델과 기본을 본다.
 */

import { useEffect, useRef, useState } from 'react'

import type { AiModelSettingsView } from '@/lib/ai/model-setting'

const NOTE = 'text-xs text-neutral-500'

/** 저장이 거부된 까닭의 말. */
export function aiModelsFailureMessage(reason: unknown): string {
  switch (reason) {
    case 'forbidden':
      return '워크스페이스 소유자만 모델을 바꿀 수 있습니다.'
    case 'unknown_model':
      return 'AI 서비스의 목록에 없는 모델입니다 — 화면을 다시 열어 보세요.'
    case 'default_not_allowed':
      return '기본 모델은 더한 모델 중에서 고르세요.'
    case 'too_many_models':
      return '모델은 20개까지 더할 수 있습니다.'
    case 'ai_unavailable':
      return '운영자가 AI 를 설정하지 않았습니다.'
    default:
      return '모델 설정을 저장하지 못했습니다.'
  }
}

export function AiModelsPanel({ workspaceId, initial }: { workspaceId: string; initial: AiModelSettingsView }) {
  const auto = initial.autoModel
  const [allowed, setAllowed] = useState<string[]>([...initial.allowed].sort())
  const [defaultModel, setDefaultModel] = useState<string | null>(initial.defaultModel)
  const [saved, setSaved] = useState({ allowed: [...initial.allowed].sort(), defaultModel: initial.defaultModel })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // 붙었다는 표지(시험이 고르기 전에 기다린다)
  useEffect(() => rootRef.current?.setAttribute('data-hydrated', 'true'), [])

  // 고를 수 있는 것 — 공급자의 목록 ∪ 이미 더한 것(목록을 받지 못했어도 남긴다) · 자동은 따로
  const options = [...new Set([...(initial.available ?? []), ...initial.allowed])].filter((m) => m !== auto).sort()
  const dirty = defaultModel !== saved.defaultModel || allowed.join('\n') !== saved.allowed.join('\n')

  const toggle = (model: string, on: boolean) => {
    setMessage(null)
    setAllowed((list) => (on ? [...new Set([...list, model])].sort() : list.filter((m) => m !== model)))
    if (!on && defaultModel === model) setDefaultModel(null)
  }

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/ai/models`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allowed, default: defaultModel }),
      })
      const body = (await res.json().catch(() => null)) as { allowed?: string[]; defaultModel?: string | null; error?: string } | null
      if (!res.ok || !Array.isArray(body?.allowed)) {
        setMessage({ ok: false, text: aiModelsFailureMessage(body?.error) })
        return
      }
      const next = { allowed: [...body.allowed].sort(), defaultModel: body.defaultModel ?? null }
      setSaved(next)
      setAllowed(next.allowed)
      setDefaultModel(next.defaultModel)
      setMessage({ ok: true, text: '저장했습니다.' })
    } catch {
      setMessage({ ok: false, text: '연결에 실패했습니다.' })
    } finally {
      setBusy(false)
    }
  }

  if (!initial.canManage) {
    return (
      <div ref={rootRef} data-testid="ai-models" data-can-manage="false" className="flex flex-col gap-1">
        <h3 className="text-xs font-medium">모델</h3>
        <p data-testid="ai-models-summary" className="break-all text-xs text-neutral-600 dark:text-neutral-400">
          쓸 수 있는 모델: {[auto, ...initial.allowed.filter((m) => m !== auto)].join(', ')} · 기본: {initial.defaultModel ?? `자동 (${auto})`}
        </p>
        <p className={NOTE}>워크스페이스 소유자만 바꿀 수 있습니다.</p>
      </div>
    )
  }

  return (
    <div ref={rootRef} data-testid="ai-models" data-can-manage="true" className="flex flex-col gap-2">
      <h3 className="text-xs font-medium">모델</h3>
      <p className={NOTE}>멤버가 AI 채팅에서 고를 수 있는 모델을 더하고, 편집기의 AI 와 채팅의 &ldquo;자동&rdquo; 이 쓸 기본 모델을 정합니다.</p>
      {initial.source === 'fallback' && (
        <p data-testid="ai-models-fallback" role="status" className="text-xs text-amber-700 dark:text-amber-400">
          AI 서비스의 모델 목록을 받지 못했습니다 — 자동 모델만 보입니다. 잠시 뒤 다시 여세요.
        </p>
      )}
      <ul data-testid="ai-model-options" className="flex flex-col gap-1 text-sm">
        <li>
          <label className="flex items-start gap-2">
            <input type="checkbox" data-testid="ai-model-option" data-model={auto} checked disabled className="mt-1" />
            <span className="min-w-0 break-all">
              <code>{auto}</code> <span className={NOTE}>자동 — 늘 쓸 수 있습니다</span>
            </span>
          </label>
        </li>
        {options.map((m) => (
          <li key={m}>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                data-testid="ai-model-option"
                data-model={m}
                checked={allowed.includes(m)}
                disabled={busy}
                onChange={(e) => toggle(m, e.target.checked)}
                className="mt-1"
              />
              <code className="min-w-0 break-all">{m}</code>
            </label>
          </li>
        ))}
      </ul>
      <label className="flex flex-wrap items-center gap-2 text-xs">
        기본 모델
        <select
          data-testid="ai-model-default"
          value={defaultModel ?? ''}
          disabled={busy}
          onChange={(e) => {
            setMessage(null)
            setDefaultModel(e.target.value === '' ? null : e.target.value)
          }}
          className="max-w-full rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option value="">자동 ({auto})</option>
          {allowed.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="ai-models-save"
          disabled={busy || !dirty}
          onClick={() => void save()}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-40"
        >
          저장
        </button>
        {message !== null && (
          <p
            data-testid={message.ok ? 'ai-models-saved' : 'ai-models-error'}
            role={message.ok ? 'status' : 'alert'}
            className={`text-xs ${message.ok ? 'text-neutral-500' : 'text-red-600 dark:text-red-400'}`}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  )
}
