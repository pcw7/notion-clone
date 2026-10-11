'use client'

/**
 * 사이트 주소 패널 — 설정 → 워크스페이스 → 사이트 (게시 · 공유 6c-2 · F-13-08)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 사이트 주소 ③⑦
 *
 * 소유자가 워크스페이스의 사이트 주소를 정한다 — 판정은 서버다(`PUT /site-domain` · `publish/site.ts`). 저장하면 서버가 받은 모양
 * (소문자)으로 칸을 다시 채운다. 지우면 사이트 주소가 모두 닫힌다(토큰 주소는 산다).
 */

import { useState } from 'react'

import { SITE_PANEL_NOTE, siteDomainFailureMessage, siteUrlOf } from './site-messages'

const FIELD =
  'min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700'
const BUTTON =
  'rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'

export function SitePanel({ workspaceId, initialName }: { workspaceId: string; initialName: string | null }) {
  const [name, setName] = useState<string | null>(initialName)
  const [draft, setDraft] = useState(initialName ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const save = async (next: string | null) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/site-domain`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: next }),
      })
      const body = (await res.json().catch(() => null)) as { name?: string | null; error?: string } | null
      if (!res.ok || body === null) {
        setError(siteDomainFailureMessage(body?.error))
        return
      }
      const saved = body.name ?? null
      setName(saved)
      setDraft(saved ?? '')
      setNotice(saved === null ? '사이트 주소를 지웠습니다.' : '사이트 주소를 저장했습니다.')
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return (
    <section data-testid="site-panel" className="mt-6 flex flex-col gap-3">
      <h2 className="text-sm font-medium">사이트 주소</h2>
      <p className="text-xs text-neutral-500">{SITE_PANEL_NOTE}</p>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save(draft.trim() === '' ? null : draft)
        }}
      >
        <input
          aria-label="사이트 주소"
          data-testid="site-name"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="예: my-team"
          autoComplete="off"
          className={FIELD}
        />
        <button type="submit" data-testid="site-save" disabled={busy || draft.trim() === (name ?? '')} className={BUTTON}>
          저장
        </button>
        {name !== null && (
          <button type="button" data-testid="site-remove" disabled={busy} onClick={() => void save(null)} className={BUTTON}>
            지우기
          </button>
        )}
      </form>
      {name !== null && (
        <p className="text-xs text-neutral-600 dark:text-neutral-400" data-testid="site-example">
          게시한 페이지의 주소: <code>{siteUrlOf(origin, name, null)}</code>
        </p>
      )}
      {error !== null && (
        <p role="alert" data-testid="site-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {notice !== null && (
        <p role="status" data-testid="site-notice" className="text-xs text-neutral-500">
          {notice}
        </p>
      )}
    </section>
  )
}
