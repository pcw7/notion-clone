'use client'

/**
 * 계정 삭제 — 설정 "내 계정" 절 맨 아래의 위험 구역 (AD-3 · F-14-13)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 AD-3] ① ~ ④ — 누르면 확인 창이 열리고 그때 미리보기를 읽는다. 워크스페이스마다 한 줄
 * (함께 지워짐 · 나감 · 막힘), 막힌 줄이 하나라도 있으면 삭제 단추는 꺼진 채다. 기본 이메일을 그대로 쳐야 켜진다. 끝나면 함께 로그인한
 * 다른 계정이 있으면 처음 화면(그 계정의 워크스페이스)으로, 없으면 로그인 화면으로 문서째 이동한다.
 */

import { useState } from 'react'

import {
  ACCOUNT_DELETE_EXPORT_HINT,
  ACCOUNT_DELETE_EXPORT_LINK,
  ACCOUNT_DELETE_IRREVERSIBLE,
  ACCOUNT_DELETE_MEMBERS_LINK,
  accountDeleteFailureMessage,
  afterDeletionPath,
  blockedReason,
  canConfirmDeletion,
  outcomeLabel,
  type DeletionRow,
} from '../account-delete-messages'

const SMALL = 'rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700'

export function AccountDeletePanel({ workspaceId }: { workspaceId: string }) {
  const [asking, setAsking] = useState(false)
  const [email, setEmail] = useState('')
  const [rows, setRows] = useState<DeletionRow[] | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open(): Promise<void> {
    setAsking(true)
    setRows(null)
    setTyped('')
    setError(null)
    try {
      const res = await fetch('/api/account/deletion')
      const data = (await res.json().catch(() => ({}))) as { email?: unknown; workspaces?: unknown; error?: unknown }
      if (res.ok && typeof data.email === 'string' && Array.isArray(data.workspaces)) {
        setEmail(data.email)
        setRows(data.workspaces as DeletionRow[])
        return
      }
      setError(accountDeleteFailureMessage(data.error))
    } catch {
      setError('연결에 실패했습니다.')
    }
  }

  async function remove(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/account/deletion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmEmail: typed }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown; ok?: unknown; signedIn?: unknown; workspaces?: unknown }
      if (res.ok && data.ok === true) {
        // 문서째 옮긴다 — 지운 계정이 붙든 상태(협업 연결 · 캐시)를 들고 가지 않는다
        window.location.replace(afterDeletionPath(data.signedIn === true))
        return
      }
      if (data.error === 'blocked' && Array.isArray(data.workspaces)) setRows(data.workspaces as DeletionRow[])
      setError(accountDeleteFailureMessage(data.error))
    } catch {
      setError('연결에 실패했습니다.')
    }
    setBusy(false)
  }

  return (
    <section data-testid="account-delete-panel" className="mt-8 rounded-lg border border-red-200 p-4 dark:border-red-900">
      <h2 className="text-sm font-semibold text-red-600">계정 삭제</h2>
      {!asking ? (
        <button type="button" data-testid="account-delete-open" onClick={() => void open()} className={`mt-2 ${SMALL}`}>
          계정 삭제
        </button>
      ) : (
        <div role="dialog" aria-label="계정 삭제 확인" data-testid="account-delete-dialog" className="mt-2 flex flex-col gap-2">
          {rows === null ? (
            !error && <p className="text-xs text-neutral-500">무엇이 사라지는지 확인하는 중…</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map((row) => (
                <li
                  key={row.id}
                  data-testid="account-delete-row"
                  data-outcome={row.outcome}
                  data-workspace-id={row.id}
                  className="rounded border border-neutral-200 px-2 py-1 text-xs dark:border-neutral-800"
                >
                  <strong>{row.name}</strong> — <span className={row.outcome === 'blocked' ? 'text-red-600' : ''}>{outcomeLabel(row.outcome)}</span>
                  {row.outcome === 'blocked' && (
                    <span className="mt-1 block text-neutral-500">
                      {blockedReason(row)}{' '}
                      <a
                        href={`/w/${row.id}/settings?s=workspace.people`}
                        data-testid="account-delete-members-link"
                        className="underline"
                      >
                        {ACCOUNT_DELETE_MEMBERS_LINK}
                      </a>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-red-600">{ACCOUNT_DELETE_IRREVERSIBLE}</p>
          <p className="text-xs text-neutral-500">
            {ACCOUNT_DELETE_EXPORT_HINT}{' '}
            <a href={`/w/${workspaceId}/settings?s=workspace.general`} data-testid="account-delete-export-link" className="underline">
              {ACCOUNT_DELETE_EXPORT_LINK}
            </a>
          </p>
          <label className="text-xs">
            확인하려면 기본 이메일 <strong>{email}</strong> 을(를) 그대로 입력하세요.
            <input
              data-testid="account-delete-email"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-transparent"
            />
          </label>
          <span className="flex gap-1">
            <button
              type="button"
              data-testid="account-delete-confirm"
              disabled={busy || !canConfirmDeletion(rows, typed, email)}
              onClick={() => void remove()}
              className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 disabled:opacity-40 dark:border-red-800"
            >
              계정 삭제
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setAsking(false)
                setRows(null)
                setTyped('')
                setError(null)
              }}
              className={SMALL}
            >
              취소
            </button>
          </span>
        </div>
      )}
      {error && (
        <p role="alert" data-testid="account-delete-error" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  )
}
