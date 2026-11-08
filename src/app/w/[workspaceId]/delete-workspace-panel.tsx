'use client'

/**
 * 워크스페이스 삭제 — 설정 일반 절 끝의 위험 구역 (AD-1 · F-14-13)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 AD-1] ① ④ — owner 만 보인다(서버가 패널 목록에서 거른다 · 명령이 다시 판정). 이름을 그대로
 * 다시 쳐야 지울 수 있다. 지우면 서버가 알려 준 곳(다른 워크스페이스 · 없으면 새로 만들기)으로 문서째 이동한다 — 지운 워크스페이스의
 * 화면에는 더는 들어올 수 없다.
 */

import { useState } from 'react'

import { DELETE_WORKSPACE_WARNING, deleteWorkspaceFailureMessage } from './delete-workspace-messages'

const SMALL = 'rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700'

export function DeleteWorkspacePanel({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const [asking, setAsking] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmName: typed }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown; next?: unknown }
      if (res.ok) {
        // 문서째 옮긴다 — 지운 워크스페이스가 붙든 상태(협업 연결 · 캐시)를 들고 가지 않는다
        window.location.replace(typeof data.next === 'string' && data.next.startsWith('/') ? data.next : '/')
        return
      }
      setError(deleteWorkspaceFailureMessage(data.error))
    } catch {
      setError('연결에 실패했습니다.')
    }
    setBusy(false)
  }

  return (
    <section data-testid="delete-workspace-panel" className="mt-8 rounded-lg border border-red-200 p-4 dark:border-red-900">
      <h2 className="text-sm font-semibold text-red-600">워크스페이스 삭제</h2>
      {!asking ? (
        <button type="button" data-testid="delete-workspace-button" onClick={() => setAsking(true)} className={`mt-2 ${SMALL}`}>
          워크스페이스 삭제
        </button>
      ) : (
        <div role="dialog" aria-label="워크스페이스 삭제 확인" data-testid="delete-workspace-dialog" className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-neutral-500">{DELETE_WORKSPACE_WARNING}</p>
          <label className="text-xs">
            확인하려면 워크스페이스 이름 <strong>{workspaceName}</strong> 을(를) 그대로 입력하세요.
            <input
              data-testid="delete-workspace-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-transparent"
            />
          </label>
          <span className="flex gap-1">
            <button
              type="button"
              data-testid="delete-workspace-confirm"
              disabled={busy || typed !== workspaceName}
              onClick={() => void remove()}
              className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 disabled:opacity-40 dark:border-red-800"
            >
              워크스페이스 삭제
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setAsking(false)
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
        <p role="alert" data-testid="delete-workspace-error" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  )
}
