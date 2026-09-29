'use client'

/**
 * 워크스페이스 정책 — 홈의 "정책" 절 (7g-2 · F-06-15)
 *
 * owner 에게만 선다(`canManageSecurityPolicy` — 판정은 라우트가 다시 한다). 지금 칸은 하나다: 워크스페이스 밖의 사람이 페이지
 * 접근을 요청할 수 있는가. 바꾸는 즉시 저장한다(체크박스 하나 — 되돌리기도 한 번이다). 저장이 거부되면 원래 값으로 돌아간다.
 */

import { useState } from 'react'

import { policySavedNotice } from './security-policy-messages'

export function SecurityPolicyForm({
  workspaceId,
  initialAllowNonmemberRequests,
}: {
  workspaceId: string
  initialAllowNonmemberRequests: boolean
}) {
  const [allow, setAllow] = useState(initialAllowNonmemberRequests)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(next: boolean): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    setAllow(next)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/security-policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allowNonmemberPageAccessRequest: next }),
      })
      const data = (await res.json().catch(() => ({}))) as { policy?: { allowNonmemberPageAccessRequest?: unknown } }
      const saved = data.policy?.allowNonmemberPageAccessRequest
      if (!res.ok || typeof saved !== 'boolean') {
        setAllow(!next)
        setError('정책을 저장하지 못했습니다.')
        return
      }
      setAllow(saved)
      setNotice(policySavedNotice(saved))
    } catch {
      setAllow(!next)
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="security-policy" className="mt-3 flex flex-col gap-2">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="policy-nonmember-requests"
          checked={allow}
          disabled={busy}
          onChange={(e) => void save(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          워크스페이스 밖의 사람이 페이지 접근을 요청할 수 있습니다
          <span className="block text-xs text-neutral-500">
            페이지 주소를 받은 사람이 요청하면, 그 페이지를 공유할 수 있는 사람이 허락해 게스트로 들입니다. 끄면 그 주소는 없는
            페이지로 보입니다.
          </span>
        </span>
      </label>
      {notice !== null && (
        <p role="status" data-testid="policy-saved" className="text-xs text-neutral-500">
          {notice}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
