'use client'

/**
 * teamspace 설정 — 이름 · 공개 범위 · 초대 규칙 (7c-5조각 · F-06-04)
 *
 * **소유자에게만** 보인다(서버가 다시 묻는다 — `updateTeamspace` 는 소유자가 아니면 `forbidden`). 셋을 한 폼에 두고 한 번에
 * 보낸다: 세 칸이 모두 "이 teamspace 를 어떻게 쓰는가" 한 가지를 정하고, 따로 저장하면 어느 것이 저장됐는지 사용자가
 * 세어야 한다.
 *
 * 저장하면 `router.refresh()` 로 **서버 렌더를 다시 받는다** — 이름은 이 화면의 제목 · 사이드바 · breadcrumb 세 곳에 있다.
 * 멤버 절(`teamspace-members.tsx`)처럼 `GET teamspaces/{id}` 하나만 다시 읽지 않는 까닭이다. 부모(서버 컴포넌트)가 콜백을
 * 넘겨 줄 수도 없다 — 서버 컴포넌트는 클라이언트에 함수를 넘기지 못한다.
 *
 * 멤버 절이 들고 있는 초대 규칙은 이 저장으로 낡을 수 있다. 그래도 어긋나 보이지 않는다 — 이 폼은 소유자만 보고, 소유자의
 * "넣기" 칸은 초대 규칙과 무관하게 늘 선다(`canInviteHere`). 규칙을 바꾸면 그 가정을 다시 본다.
 *
 * 공개 범위를 좁혀도 이미 들어온 멤버는 그대로다 — 그 말을 바꾸기 전에 한 줄로 해 둔다(서버의 규칙과 같다).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  TEAMSPACE_VISIBILITY_ORDER,
  teamspaceFailureMessage,
  teamspaceVisibilityHint,
  teamspaceVisibilityLabel,
  type TeamspaceVisibilityName,
} from '../../teamspace-messages'

const INPUT =
  'rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300'

export function TeamspaceSettings({
  workspaceId,
  teamspaceId,
  initial,
}: {
  workspaceId: string
  teamspaceId: string
  initial: { name: string; visibility: TeamspaceVisibilityName; whoCanInvite: 'owners' | 'all_members' }
}) {
  const router = useRouter()
  const [name, setName] = useState(initial.name)
  const [visibility, setVisibility] = useState<TeamspaceVisibilityName>(initial.visibility)
  const [whoCanInvite, setWhoCanInvite] = useState(initial.whoCanInvite)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/teamspaces/${teamspaceId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, visibility, whoCanInvite }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown }
      if (!res.ok) {
        setError(teamspaceFailureMessage(data.error))
        return
      }
      setSaved(true)
      // 이름은 이 화면의 제목 · 사이드바 · breadcrumb 에 있다 — 서버 렌더를 다시 받는다.
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      data-testid="teamspace-settings"
      className="mt-3 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        이름
        <input
          data-testid="teamspace-settings-name"
          aria-label="teamspace 이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className={INPUT}
        />
      </label>

      <fieldset data-testid="teamspace-settings-visibility" className="flex flex-col gap-1">
        <legend className="text-xs text-neutral-500">공개 범위</legend>
        {TEAMSPACE_VISIBILITY_ORDER.map((v) => (
          <label key={v} className="flex items-start gap-1 text-xs">
            <input
              type="radio"
              name="teamspace-settings-visibility"
              value={v}
              data-testid={`teamspace-settings-visibility-${v}`}
              checked={visibility === v}
              onChange={() => setVisibility(v)}
              className="mt-0.5 flex-none"
            />
            <span className="min-w-0">
              <span className="font-medium">{teamspaceVisibilityLabel(v)}</span>
              <span className="ml-1 text-neutral-500">{teamspaceVisibilityHint(v)}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-neutral-500">좁혀도 이미 들어온 멤버는 그대로입니다 — 앞으로의 참여만 막습니다.</p>
      </fieldset>

      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        누가 멤버를 넣을 수 있는가
        <select
          data-testid="teamspace-settings-invite"
          aria-label="초대 규칙"
          value={whoCanInvite}
          onChange={(e) => setWhoCanInvite(e.target.value === 'owners' ? 'owners' : 'all_members')}
          className={INPUT}
        >
          <option value="all_members">멤버 누구나</option>
          <option value="owners">소유자만</option>
        </select>
      </label>

      <span className="flex items-center gap-2">
        <button
          type="submit"
          data-testid="teamspace-settings-save"
          disabled={busy || name.trim().length === 0}
          className="self-start rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          저장
        </button>
        {saved && (
          <span data-testid="teamspace-settings-saved" className="text-xs text-neutral-500">
            저장했습니다
          </span>
        )}
      </span>

      {error && (
        <p role="alert" data-testid="teamspace-settings-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  )
}
