'use client'

/**
 * 페이지 웹훅 칸 — Updates 패널 아래 (히스토리 · 활동 4e-3 · F-11-19)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 페이지 웹훅 — 화면 ⓗ ~ ⓚ
 *
 * 노션은 Updates 패널의 "Connect Slack channel" 이다. 여기는 그 자리에 임의 URL 의 웹훅을 둔다(Slack 은 incoming webhook URL 을 그대로).
 *
 *   - 판정은 서버에 있다 — 패널이 열릴 때 목록을 읽고, 서버가 거절하면(전체 권한이 없다 · 행이다) **칸을 그리지 않는다**.
 *   - 걸기 전에 무엇이 나가는지 한 줄로 알린다(ⓘ). 거절은 까닭마다 말한다.
 *   - 한 줄 = 힌트 · 건 사람 · 상태 · 마지막 배달(ⓙ). 원문 URL 은 서버가 주지 않는다.
 *   - 멈추기 · 다시 켜기 · 지우기 — 지우기는 한 번 더 묻는다(ⓚ).
 */

import { useEffect, useState } from 'react'

import { formatVersionTime } from '@/lib/history/format'
import { lastDeliveryLabel, WEBHOOK_NOTICE, webhookErrorMessage, webhookStateLabel } from './webhook-messages'

type Hook = {
  readonly id: string
  readonly urlHint: string
  readonly createdBy: { readonly id: string; readonly name: string }
  readonly paused: { readonly at: string; readonly reason: string } | null
  readonly lastDelivery: { readonly status: string; readonly at: string; readonly httpStatus: number | null } | null
}

type ErrorBody = { error?: string; problem?: string }

export function PageWebhooks({ workspaceId, pageId }: { workspaceId: string; pageId: string }) {
  // null — 아직 읽는 중이거나 서버가 거절했다(칸을 그리지 않는다)
  const [hooks, setHooks] = useState<readonly Hook[] | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const base = `/api/workspaces/${workspaceId}/pages/${pageId}/webhooks`

  // 바꾸고 나면 다시 읽는다 — 번호를 올리면 아래 이펙트가 돈다
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let alive = true
    fetch(base)
      .then(async (res) => {
        const body = res.ok ? ((await res.json().catch(() => ({}))) as { webhooks?: Hook[] }) : {}
        if (alive) setHooks(Array.isArray(body.webhooks) ? body.webhooks : null)
      })
      .catch(() => {
        if (alive) setHooks(null)
      })
    return () => {
      alive = false
    }
  }, [base, reloads])

  const act = async (request: () => Promise<Response>, after?: () => void) => {
    setBusy(true)
    setError(null)
    try {
      const res = await request()
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorBody
        setError(webhookErrorMessage(body.error, body.problem))
        return
      }
      after?.()
      setReloads((n) => n + 1)
    } catch {
      setError('웹훅을 바꾸지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  if (hooks === null) return null

  return (
    <section data-testid="page-webhooks" aria-label="웹훅" className="mt-2 flex flex-col gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-700">
      <h3 className="text-xs font-semibold">웹훅</h3>
      <p className="text-xs text-neutral-500">{WEBHOOK_NOTICE}</p>
      {hooks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {hooks.map((hook) => (
            <li
              key={hook.id}
              data-testid="page-webhook"
              data-state={hook.paused === null ? 'on' : hook.paused.reason}
              className="rounded border border-neutral-200 p-2 text-xs dark:border-neutral-700"
            >
              <div className="font-medium break-all">{hook.urlHint}</div>
              <div className="text-neutral-500">
                {hook.createdBy.name || '이름 없음'} · <span data-testid="page-webhook-state">{webhookStateLabel(hook.paused)}</span>
              </div>
              <div data-testid="page-webhook-last" className="text-neutral-500">
                {lastDeliveryLabel(hook.lastDelivery, (iso) => formatVersionTime(iso))}
              </div>
              <div className="mt-1 flex gap-1">
                <button
                  type="button"
                  data-testid="page-webhook-toggle"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      fetch(`${base}/${hook.id}`, {
                        method: 'PATCH',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ paused: hook.paused === null }),
                      }),
                    )
                  }
                  className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  {hook.paused === null ? '멈추기' : '다시 켜기'}
                </button>
                {confirming === hook.id ? (
                  <>
                    <button
                      type="button"
                      data-testid="page-webhook-remove-confirm"
                      disabled={busy}
                      onClick={() => void act(() => fetch(`${base}/${hook.id}`, { method: 'DELETE' }), () => setConfirming(null))}
                      className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700"
                    >
                      지우기
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded border border-neutral-300 px-2 py-0.5 dark:border-neutral-700"
                    >
                      취소
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    data-testid="page-webhook-remove"
                    disabled={busy}
                    onClick={() => setConfirming(hook.id)}
                    className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    지우기
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          void act(
            () => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }),
            () => setUrl(''),
          )
        }}
      >
        <input
          data-testid="page-webhook-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/…"
          aria-label="웹훅 주소"
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          data-testid="page-webhook-add"
          disabled={busy || url.trim() === ''}
          className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          연결
        </button>
      </form>
      {error !== null && (
        <p role="alert" data-testid="page-webhook-error" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  )
}
