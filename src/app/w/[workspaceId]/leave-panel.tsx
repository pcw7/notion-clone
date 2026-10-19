'use client'

/**
 * 이 워크스페이스에서 나가기 — 멤버 관리 10o-3 (F-14-10)
 *
 * 정본: 00-canonical-data-model.md §3.3 [보강] 멤버 내보내기 · 역할 바꾸기 ⑨
 *
 * 설정의 워크스페이스 일반 절 끝("위험 구역"). **두 번 누른다** — 누르기 전에 무엇을 잃는지와 다시 초대받으면 돌아온다는 것을 그
 * 자리에서 말한다. 나가면 처음 화면(워크스페이스 목록)으로 간다 — 서버가 새로 그리므로 나간 워크스페이스는 목록에 없다(설정 화면은
 * 협업 연결 같은 붙든 상태가 없어 문서째 다시 열 까닭이 없다). 거부되면(마지막 소유자 · 팀스페이스의 마지막 소유자) 이유를 말하고 머문다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { LEAVE_NOTICE, leaveFailureMessage } from './member-messages'

const SMALL = 'rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700'

export function LeavePanel({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function leave(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/leave`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown; teamspaces?: unknown }
      if (res.ok) {
        router.replace('/')
        return
      }
      setError(leaveFailureMessage(data.error, Array.isArray(data.teamspaces) ? data.teamspaces.map(String) : undefined))
    } catch {
      setError('연결에 실패했습니다.')
    }
    setBusy(false)
    setAsking(false)
  }

  return (
    <section data-testid="leave-panel" className="mt-8 rounded-lg border border-red-200 p-4 dark:border-red-900">
      <h2 className="text-sm font-semibold text-red-600">이 워크스페이스에서 나가기</h2>
      {!asking ? (
        <button type="button" data-testid="leave-button" disabled={busy} onClick={() => setAsking(true)} className={`mt-2 ${SMALL}`}>
          나가기
        </button>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-neutral-500">{LEAVE_NOTICE}</p>
          <span className="flex gap-1">
            <button
              type="button"
              data-testid="leave-confirm"
              disabled={busy}
              onClick={() => void leave()}
              className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 disabled:opacity-40 dark:border-red-800"
            >
              정말 나가기
            </button>
            <button type="button" disabled={busy} onClick={() => setAsking(false)} className={SMALL}>
              취소
            </button>
          </span>
        </div>
      )}
      {error && (
        <p role="alert" data-testid="leave-error" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  )
}
