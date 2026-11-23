'use client'

/**
 * API 웹훅 절 — 설정 → 내 계정 → API 토큰 → 토큰의 "웹훅" (API-8 · F-09-09)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫ — 구독은 토큰 하나의 것 · 확인 토큰을 붙여 넣어야 켜진다 · 모든 요청에 서명 ·
 *       여덟 번까지 다시 보낸다 · 잇단 실패면 꺼진다 · 토큰을 폐기 · 만료하면 서다
 *
 * 토큰 줄의 "웹훅" 을 눌러야 이 청크를 받는다(`api-token-panel.tsx` 의 `next/dynamic` — 설정 화면의 첫 JS 에 들지 않는다). 목록 · 더하기
 * (주소 + 이벤트) · 확인(붙여 넣기 · 다시 보내기) · 상태 칩 · 마지막 배달 · 멈추기 · 다시 켜기 · 테스트 보내기 · 배달 기록(최근 20줄) ·
 * 지우기(화면 안에서 묻는다). 판정은 라우트의 명령이 다시 한다.
 */

import { useEffect, useState } from 'react'

import type { ApiWebhookDelivery, ApiWebhookSummary } from '@/lib/api/webhooks'
import { WEBHOOK_EVENTS, WEBHOOK_FAMILIES, WEBHOOK_FAMILY_LABEL, webhookEventLabel } from '@/lib/api/webhook-events'
import {
  API_WEBHOOK_EVENTS_NOTE,
  API_WEBHOOK_NOTE,
  API_WEBHOOK_REMOVE_CONFIRM,
  apiWebhookFailureMessage,
  deliveryOutcome,
  shortTime,
  verificationLine,
  webhookStatusLabel,
  WEBHOOK_LIMIT_PER_TOKEN,
} from './api-webhook-messages'

const FIELD =
  'min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700'
const BUTTON =
  'rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'
const TONE: Readonly<Record<'ok' | 'wait' | 'off', string>> = {
  ok: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  wait: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  off: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
}

type Failure = { error?: string; problem?: string }

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; body: T } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, init)
    const body = (await res.json().catch(() => null)) as (T & Failure) | null
    if (!res.ok || body === null) return { ok: false, message: apiWebhookFailureMessage(body?.error, body?.problem) }
    return { ok: true, body }
  } catch {
    return { ok: false, message: '연결에 실패했습니다.' }
  }
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

export function ApiWebhookSection({ workspaceId, tokenId, tokenExpired }: { workspaceId: string; tokenId: string; tokenExpired: boolean }) {
  const base = `/api/workspaces/${workspaceId}/api-tokens/${tokenId}/webhooks`
  const [hooks, setHooks] = useState<ApiWebhookSummary[] | null>(null)
  const [url, setUrl] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 열 때 한 번 읽는다 — 상태는 답이 온 뒤에만 바꾼다(닫혔으면 버린다)
  useEffect(() => {
    let live = true
    void call<{ webhooks: ApiWebhookSummary[] }>(base).then((got) => {
      if (!live) return
      if (got.ok) setHooks(got.body.webhooks)
      else {
        setHooks([])
        setError(got.message)
      }
    })
    return () => {
      live = false
    }
  }, [base])

  const replace = (next: ApiWebhookSummary) => setHooks((list) => (list ?? []).map((h) => (h.id === next.id ? next : h)))
  const toggleEvent = (type: string) => setChosen((list) => (list.includes(type) ? list.filter((t) => t !== type) : [...list, type]))

  const add = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    const got = await call<{ webhook: ApiWebhookSummary }>(base, json('POST', { url: url.trim(), eventTypes: chosen }))
    setBusy(false)
    if (!got.ok) {
      setError(got.message)
      return
    }
    setHooks((list) => [...(list ?? []), got.body.webhook])
    setUrl('')
    setChosen([])
    setNotice('웹훅을 만들었습니다. 받는 주소가 받은 확인 토큰을 붙여 넣으세요.')
  }

  const full = hooks !== null && hooks.length >= WEBHOOK_LIMIT_PER_TOKEN

  return (
    <div data-testid="api-webhooks" data-token={tokenId} className="mt-2 flex w-full flex-col gap-3 rounded border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-medium">웹훅</h3>
        <p className="text-xs text-neutral-500">{API_WEBHOOK_NOTE}</p>
      </div>

      {hooks === null ? (
        <p className="text-xs text-neutral-500">불러오는 중…</p>
      ) : hooks.length === 0 ? (
        <p data-testid="api-webhooks-empty" className="text-xs text-neutral-500">
          아직 웹훅이 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {hooks.map((hook) => (
            <WebhookItem key={hook.id} base={base} hook={hook} onChange={replace} onRemoved={(id) => setHooks((list) => (list ?? []).filter((h) => h.id !== id))} />
          ))}
        </ul>
      )}

      {tokenExpired ? (
        <p className="text-xs text-neutral-500">만료한 토큰에는 웹훅을 걸 수 없습니다.</p>
      ) : (
        <form
          data-testid="api-webhook-form"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <input
            aria-label="받는 주소"
            data-testid="api-webhook-url"
            value={url}
            disabled={busy || full}
            maxLength={2048}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/notion-webhook"
            autoComplete="off"
            inputMode="url"
            className={FIELD}
          />
          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs text-neutral-500">받을 이벤트</legend>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {WEBHOOK_FAMILIES.map((family) => (
                <div key={family} className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium">{WEBHOOK_FAMILY_LABEL[family]}</span>
                  {WEBHOOK_EVENTS.filter((e) => e.family === family).map((e) => (
                    <label key={e.type} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        data-testid="api-webhook-event"
                        value={e.type}
                        checked={chosen.includes(e.type)}
                        disabled={busy || full}
                        onChange={() => toggleEvent(e.type)}
                      />
                      <span>{e.label}</span>
                      <code className="font-mono text-[10px] text-neutral-500">{e.type}</code>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <p className="text-xs text-neutral-500">{API_WEBHOOK_EVENTS_NOTE}</p>
          </fieldset>
          <div>
            <button type="submit" data-testid="api-webhook-add" disabled={busy || full || url.trim() === '' || chosen.length === 0} className={BUTTON}>
              웹훅 더하기
            </button>
            {full && <span className="ml-2 text-xs text-neutral-500">토큰마다 {WEBHOOK_LIMIT_PER_TOKEN}개까지입니다.</span>}
          </div>
        </form>
      )}

      {error !== null && (
        <p role="alert" data-testid="api-webhook-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {notice !== null && (
        <p role="status" data-testid="api-webhook-notice" className="text-xs text-neutral-500">
          {notice}
        </p>
      )}
    </div>
  )
}

function WebhookItem({
  base,
  hook,
  onChange,
  onRemoved,
}: {
  base: string
  hook: ApiWebhookSummary
  onChange: (next: ApiWebhookSummary) => void
  onRemoved: (id: string) => void
}) {
  const self = `${base}/${hook.id}`
  const [given, setGiven] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [log, setLog] = useState<ApiWebhookDelivery[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const chip = webhookStatusLabel(hook)

  const run = async <T,>(fn: () => Promise<{ ok: true; body: T } | { ok: false; message: string }>, done: (body: T) => void) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    const got = await fn()
    setBusy(false)
    if (got.ok) done(got.body)
    else setError(got.message)
  }

  const refresh = () =>
    run(
      () => call<{ webhook: ApiWebhookSummary; deliveries: ApiWebhookDelivery[] }>(self),
      (body) => {
        onChange(body.webhook)
        setLog(body.deliveries)
      },
    )
  // 다른 일 뒤에 기록을 다시 읽는다 — 그 일의 알림은 그대로 둔다
  const reload = async () => {
    const got = await call<{ webhook: ApiWebhookSummary; deliveries: ApiWebhookDelivery[] }>(self)
    if (!got.ok) return setError(got.message)
    onChange(got.body.webhook)
    setLog(got.body.deliveries)
  }

  const last = hook.lastDelivery
  const stopped = hook.tokenExpired || hook.status === 'disabled'

  return (
    <li
      data-testid="api-webhook"
      data-id={hook.id}
      data-status={hook.status}
      className="flex flex-col gap-2 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <code data-testid="api-webhook-hint" className="min-w-0 flex-1 truncate font-mono text-xs">
          {hook.urlHint}
        </code>
        <span data-testid="api-webhook-status" className={`rounded px-1.5 py-0.5 text-[11px] ${TONE[chip.tone]}`}>
          {chip.text}
        </span>
      </div>
      <p className="text-xs text-neutral-500">
        {hook.eventTypes.map(webhookEventLabel).join(' · ')}
      </p>

      {hook.status === 'pending_verification' && !stopped && (
        <div className="flex flex-col gap-1.5">
          <p data-testid="api-webhook-verification" className="text-xs text-neutral-600 dark:text-neutral-400">
            {verificationLine(hook.verification)}
          </p>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void run(
                () => call<{ webhook: ApiWebhookSummary }>(`${self}/verify`, json('POST', { verificationToken: given })),
                (body) => {
                  onChange(body.webhook)
                  setGiven('')
                  setNotice('확인했습니다 — 웹훅이 켜졌습니다.')
                },
              )
            }}
          >
            <input
              aria-label="확인 토큰"
              data-testid="api-webhook-verify-input"
              value={given}
              disabled={busy}
              onChange={(e) => setGiven(e.target.value)}
              placeholder="secret_…"
              autoComplete="off"
              spellCheck={false}
              className={`${FIELD} font-mono`}
            />
            <button type="submit" data-testid="api-webhook-verify" disabled={busy || given.trim() === ''} className={BUTTON}>
              확인
            </button>
            <button
              type="button"
              data-testid="api-webhook-resend"
              disabled={busy}
              onClick={() =>
                void run(
                  () => call<{ webhook: ApiWebhookSummary }>(`${self}/resend`, json('POST')),
                  (body) => {
                    onChange(body.webhook)
                    setNotice('확인 토큰을 다시 보냈습니다.')
                  },
                )
              }
              className={BUTTON}
            >
              다시 보내기
            </button>
          </form>
        </div>
      )}

      <p data-testid="api-webhook-last" className="text-xs text-neutral-500">
        {last === null ? '아직 보낸 적 없음' : `마지막 배달 · ${shortTime(last.at)} · ${deliveryOutcome(last)}`}
        {hook.pending > 0 && ` · 기다리는 이벤트 ${hook.pending}개`}
      </p>

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-xs text-red-600">{API_WEBHOOK_REMOVE_CONFIRM}</span>
          <button
            type="button"
            data-testid="api-webhook-remove-confirm"
            disabled={busy}
            onClick={() =>
              void run(
                () => call<{ ok: true }>(self, { method: 'DELETE' }),
                () => onRemoved(hook.id),
              )
            }
            className={BUTTON}
          >
            지우기
          </button>
          <button type="button" data-testid="api-webhook-remove-cancel" disabled={busy} onClick={() => setConfirming(false)} className={BUTTON}>
            취소
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {hook.status === 'active' && !hook.tokenExpired && (
            <button
              type="button"
              data-testid="api-webhook-test"
              disabled={busy}
              onClick={() =>
                void run(
                  () => call<{ eventId: string }>(`${self}/test`, json('POST')),
                  () => {
                    setNotice('테스트 이벤트를 넣었습니다 — 곧 보냅니다. 배달 기록에서 결과를 보세요.')
                    void reload()
                  },
                )
              }
              className={BUTTON}
            >
              테스트 보내기
            </button>
          )}
          {(hook.status === 'active' || hook.status === 'paused' || (hook.status === 'disabled' && hook.disabledReason === 'failures')) && (
            <button
              type="button"
              data-testid="api-webhook-toggle"
              disabled={busy}
              onClick={() =>
                void run(
                  () => call<{ webhook: ApiWebhookSummary }>(self, json('PATCH', { paused: hook.status === 'active' })),
                  (body) => {
                    onChange(body.webhook)
                    if (log !== null) void reload()
                  },
                )
              }
              className={BUTTON}
            >
              {hook.status === 'active' ? '멈추기' : '다시 켜기'}
            </button>
          )}
          <button
            type="button"
            data-testid="api-webhook-log-toggle"
            disabled={busy}
            aria-expanded={log !== null}
            onClick={() => (log === null ? void refresh() : setLog(null))}
            className={BUTTON}
          >
            {log === null ? '배달 기록' : '기록 닫기'}
          </button>
          <button
            type="button"
            data-testid="api-webhook-remove"
            disabled={busy}
            onClick={() => {
              setError(null)
              setConfirming(true)
            }}
            className={BUTTON}
          >
            지우기
          </button>
        </div>
      )}

      {log !== null && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">배달 기록</span>
            <button type="button" data-testid="api-webhook-log-refresh" disabled={busy} onClick={() => void refresh()} className={BUTTON}>
              새로 고침
            </button>
          </div>
          {log.length === 0 ? (
            <p data-testid="api-webhook-log-empty" className="text-xs text-neutral-500">
              아직 기록이 없습니다.
            </p>
          ) : (
            <ul data-testid="api-webhook-log" className="flex flex-col divide-y divide-neutral-100 text-xs dark:divide-neutral-900">
              {log.map((d) => (
                <li key={d.id} data-testid="api-webhook-log-row" data-status={d.status} className="flex flex-wrap gap-x-2 py-1">
                  <span className="text-neutral-500" suppressHydrationWarning>
                    {shortTime(d.lastAttemptAt ?? d.occurredAt)}
                  </span>
                  <span>{webhookEventLabel(d.type)}</span>
                  <span data-testid="api-webhook-log-outcome" className={d.status === 'failed' ? 'text-red-600' : 'text-neutral-600 dark:text-neutral-400'}>
                    {deliveryOutcome(d)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error !== null && (
        <p role="alert" data-testid="api-webhook-item-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {notice !== null && (
        <p role="status" data-testid="api-webhook-item-notice" className="text-xs text-neutral-500">
          {notice}
        </p>
      )}
    </li>
  )
}
