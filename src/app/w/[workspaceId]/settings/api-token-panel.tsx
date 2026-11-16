'use client'

/**
 * API 토큰 패널 — 설정 → 내 계정 → API 토큰 (API-1 · F-09-02)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ① — 값은 만들 때 한 번만 보인다 · 살아 있는 것 20개 · 폐기는 곧바로 듣는다
 *
 * 이 워크스페이스의 내 토큰 목록(이름 · 끝 4자 · 만든 날 · 마지막 사용 · 만료)과 만들기 · 폐기. 만들면 값을 한 번 보이고(복사 · "다시 볼 수
 * 없습니다") 닫으면 사라진다. 폐기는 화면 안에서 묻는다(`window.confirm` 이 아니다). 만들기는 게스트에게 서지 않는다 — 판정은 라우트의
 * 명령이 다시 한다(`POST /api-tokens` · `DELETE /api-tokens/[id]`).
 */

import { useState } from 'react'

import type { ApiTokenSummary } from '@/lib/api/api-token'
import {
  API_TOKEN_EXPIRY_OPTIONS,
  API_TOKEN_GUEST_NOTE,
  API_TOKEN_PANEL_NOTE,
  API_TOKEN_REVOKE_CONFIRM,
  API_TOKEN_SHOWN_ONCE,
  apiTokenFailureMessage,
  expiryValue,
  maskedToken,
} from './api-token-messages'

const FIELD =
  'min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700'
const BUTTON =
  'rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'

/** 날짜 — 이 브라우저의 시간대(서버가 그린 것과 다를 수 있다 · 하이드레이션 경고를 막는다). */
function DateText({ iso, testId }: { iso: string; testId?: string }) {
  return (
    <span data-testid={testId} suppressHydrationWarning>
      {new Date(iso).toLocaleDateString('ko-KR')}
    </span>
  )
}

export function ApiTokenPanel({ workspaceId, initial, canCreate }: { workspaceId: string; initial: ApiTokenSummary[]; canCreate: boolean }) {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>(initial)
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState(API_TOKEN_EXPIRY_OPTIONS[0]!.value)
  const [created, setCreated] = useState<{ readonly value: string; readonly name: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const base = `/api/workspaces/${workspaceId}/api-tokens`

  const say = (next: { error?: string; notice?: string }) => {
    setError(next.error ?? null)
    setNotice(next.notice ?? null)
  }

  const create = async () => {
    setBusy(true)
    say({})
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, expiresInDays: expiryValue(expiry) }),
      })
      const body = (await res.json().catch(() => null)) as { token?: string; summary?: ApiTokenSummary; error?: string } | null
      if (!res.ok || typeof body?.token !== 'string' || body.summary === undefined) {
        say({ error: apiTokenFailureMessage(body?.error) })
        return
      }
      const summary = body.summary
      setTokens((list) => [summary, ...list])
      setCreated({ value: body.token, name: summary.name })
      setName('')
    } catch {
      say({ error: '연결에 실패했습니다.' })
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (token: ApiTokenSummary) => {
    setBusy(true)
    say({})
    try {
      const res = await fetch(`${base}/${token.id}`, { method: 'DELETE' })
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      // 이미 없는 토큰(not_found)도 목록에서 뺀다 — 다른 탭에서 폐기했다
      if (res.ok || body?.error === 'not_found') {
        setTokens((list) => list.filter((t) => t.id !== token.id))
        setConfirming(null)
        say({ notice: `"${token.name}" 토큰을 폐기했습니다.` })
      } else {
        say({ error: apiTokenFailureMessage(body?.error) })
      }
    } catch {
      say({ error: '연결에 실패했습니다.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-testid="api-token-panel" className="mt-6 flex flex-col gap-3">
      <h2 className="text-sm font-medium">API 토큰</h2>
      <p className="text-xs text-neutral-500">{API_TOKEN_PANEL_NOTE}</p>

      {canCreate ? (
        <form
          data-testid="api-token-form"
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <input
            aria-label="토큰 이름"
            data-testid="api-token-name"
            value={name}
            disabled={busy}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 배포 스크립트"
            autoComplete="off"
            className={FIELD}
          />
          <select
            aria-label="만료"
            data-testid="api-token-expiry"
            value={expiry}
            disabled={busy}
            onChange={(e) => setExpiry(e.target.value)}
            className="rounded border border-neutral-300 bg-transparent px-2 py-1 text-xs dark:border-neutral-700"
          >
            {API_TOKEN_EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button type="submit" data-testid="api-token-create" disabled={busy || name.trim() === ''} className={BUTTON}>
            토큰 만들기
          </button>
        </form>
      ) : (
        <p data-testid="api-token-guest-note" className="text-xs text-neutral-500">
          {API_TOKEN_GUEST_NOTE}
        </p>
      )}

      {created !== null && (
        <div data-testid="api-token-created" className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
          <p className="text-xs">
            <span className="font-medium">{created.name}</span> 토큰을 만들었습니다.
          </p>
          <div className="flex items-center gap-2">
            <code data-testid="api-token-value" className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-900">
              {created.value}
            </code>
            <button
              type="button"
              data-testid="api-token-copy"
              onClick={() => {
                void navigator.clipboard?.writeText(created.value).then(
                  () => say({ notice: '복사했습니다.' }),
                  () => say({ error: '복사하지 못했습니다 — 직접 골라 복사하세요.' }),
                )
              }}
              className={BUTTON}
            >
              복사
            </button>
          </div>
          <p role="alert" className="text-xs text-amber-800 dark:text-amber-300">
            {API_TOKEN_SHOWN_ONCE}
          </p>
          <div>
            <button type="button" data-testid="api-token-dismiss" onClick={() => setCreated(null)} className={BUTTON}>
              닫기
            </button>
          </div>
        </div>
      )}

      {tokens.length === 0 ? (
        <p data-testid="api-token-empty" className="text-xs text-neutral-500">
          아직 만든 토큰이 없습니다.
        </p>
      ) : (
        <ul data-testid="api-token-list" className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-900">
          {tokens.map((token) => (
            <li key={token.id} data-testid="api-token-row" data-id={token.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              {confirming === token.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="min-w-0 flex-1 text-xs text-red-600">{API_TOKEN_REVOKE_CONFIRM}</span>
                  <button type="button" data-testid="api-token-revoke-confirm" disabled={busy} onClick={() => void revoke(token)} className={BUTTON}>
                    폐기
                  </button>
                  <button type="button" data-testid="api-token-revoke-cancel" disabled={busy} onClick={() => setConfirming(null)} className={BUTTON}>
                    취소
                  </button>
                </div>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate" data-testid="api-token-row-name">
                    {token.name}
                  </span>
                  <code className="font-mono text-xs text-neutral-500" data-testid="api-token-row-mask">
                    {maskedToken(token.last4)}
                  </code>
                  <span className="text-xs text-neutral-500">
                    만든 날 <DateText iso={token.createdAt} />
                  </span>
                  <span className="text-xs text-neutral-500" data-testid="api-token-row-used">
                    {token.lastUsedAt === null ? '쓴 적 없음' : <>마지막 사용 <DateText iso={token.lastUsedAt} /></>}
                  </span>
                  <span className={`text-xs ${token.expired ? 'text-red-600' : 'text-neutral-500'}`}>
                    {token.expiresAt === null ? '만료 없음' : token.expired ? '만료됨' : <>만료 <DateText iso={token.expiresAt} /></>}
                  </span>
                  <button
                    type="button"
                    data-testid="api-token-revoke"
                    disabled={busy}
                    onClick={() => {
                      say({})
                      setConfirming(token.id)
                    }}
                    className={BUTTON}
                  >
                    폐기
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <p role="alert" data-testid="api-token-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {notice !== null && (
        <p role="status" data-testid="api-token-notice" className="text-xs text-neutral-500">
          {notice}
        </p>
      )}
    </section>
  )
}
