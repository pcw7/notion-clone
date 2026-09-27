'use client'

/**
 * teamspace 설정 — 이름 · 아이콘 · 공개 범위 · 초대 규칙 · 멤버 기본 권한 · 기본 teamspace · 보관 (7c-5 · 7c-6 · 7c-11 · 7c-12조각 · F-06-04)
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
 *
 * **멤버 기본 권한**(7c-12)도 같은 폼이다 — 멤버 전원이 이 teamspace 의 페이지를 받는 레벨. 고르개 옆에 그 레벨로 멤버가
 * 무엇을 하게 되는지 말하고, 바꾸기 전에 두 가지를 먼저 말한다: 소유자는 늘 전체 권한이고, 상속을 끊은(따로 관리하는)
 * 페이지는 바뀌지 않는다(P2). 낮추면 사이드바의 `+` 도 바뀌므로 저장 뒤의 `router.refresh()` 가 그것까지 나른다.
 *
 * **보관은 두 번 누른다**(그룹 지우기 · 나가기와 같은 규칙 · §3.3-188). teamspace 는 지워지지 않는 대신 보관되고, 보관하면
 * **나까지** 그 페이지들을 못 본다 — 되살릴 수 있다는 말을 함께 한다. 보관한 뒤에는 이 화면이 404 가 되므로 워크스페이스
 * 홈으로 옮겨 간다.
 *
 * **기본 teamspace**(7c-11)는 폼과 따로 누른다 — 켜면 워크스페이스 전원이 멤버로 들어오는 큰 일이고, 끄더라도 들어온
 * 사람은 남는다. 그래서 켜기는 **두 번 누르고** 그 말을 먼저 한다. 끄기는 앞으로의 자동 추가만 멈추므로 한 번이다.
 * 버튼은 워크스페이스 owner 에게만 선다(`canSetDefault` — 서버가 다시 묻는다). 기본인 동안 보관 버튼은 서지 않고 까닭을
 * 말한다(서버도 `default_teamspace` 로 거부한다). 바꾼 뒤에는 서버 렌더를 다시 받는다 — 멤버 절이 새 멤버를 받아야 한다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { TeamspaceIconPicker } from '../../teamspace-icon-picker'
import {
  TEAMSPACE_MEMBER_LEVEL_ORDER,
  TEAMSPACE_VISIBILITY_ORDER,
  defaultTeamspaceAddedMessage,
  memberLevelHint,
  memberLevelLabel,
  teamspaceFailureMessage,
  teamspaceVisibilityHint,
  teamspaceVisibilityLabel,
  type TeamspaceMemberLevelName,
  type TeamspaceVisibilityName,
} from '../../teamspace-messages'

const INPUT =
  'rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300'

export function TeamspaceSettings({
  workspaceId,
  teamspaceId,
  initial,
  canSetDefault,
}: {
  workspaceId: string
  teamspaceId: string
  initial: {
    name: string
    icon: string | null
    visibility: TeamspaceVisibilityName
    whoCanInvite: 'owners' | 'all_members'
    isDefault: boolean
    memberLevel: TeamspaceMemberLevelName
  }
  /** 워크스페이스 owner 인가 — 기본 teamspace 버튼을 세울지(표시 전용 · 서버가 다시 묻는다). */
  canSetDefault: boolean
}) {
  const router = useRouter()
  const [name, setName] = useState(initial.name)
  const [icon, setIcon] = useState<string | null>(initial.icon)
  const [visibility, setVisibility] = useState<TeamspaceVisibilityName>(initial.visibility)
  const [whoCanInvite, setWhoCanInvite] = useState(initial.whoCanInvite)
  const [memberLevel, setMemberLevel] = useState<TeamspaceMemberLevelName>(initial.memberLevel)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [isDefault, setIsDefault] = useState(initial.isDefault)
  const [confirmingDefault, setConfirmingDefault] = useState(false)
  const [defaultNote, setDefaultNote] = useState<string | null>(null)

  async function setDefault(on: boolean): Promise<void> {
    setBusy(true)
    setError(null)
    setDefaultNote(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/teamspaces/${teamspaceId}/default`, {
        method: on ? 'PUT' : 'DELETE',
      })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown; added?: unknown }
      if (!res.ok) {
        setError(teamspaceFailureMessage(data.error))
        return
      }
      setIsDefault(on)
      if (on) setDefaultNote(defaultTeamspaceAddedMessage(typeof data.added === 'number' ? data.added : 0))
      // 멤버 절이 새로 들어온 사람들을 받아야 한다 — 서버 렌더를 다시 받는다(부모가 기본 여부로 그 절을 새로 세운다).
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
      setConfirmingDefault(false)
    }
  }

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/teamspaces/${teamspaceId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, icon, visibility, whoCanInvite, memberLevel }),
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

  async function archive(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/teamspaces/${teamspaceId}/archive`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown }
      if (!res.ok) {
        setError(teamspaceFailureMessage(data.error))
        return
      }
      // 보관하면 이 화면은 404 다 — 사이드바에서도 빠져야 하므로 홈으로 옮겨 가며 서버 렌더를 다시 받는다.
      router.push(`/w/${workspaceId}`)
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
      setArchiving(false)
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

      <div className="flex flex-col gap-1 text-xs text-neutral-500">
        아이콘
        <TeamspaceIconPicker value={icon} onChange={setIcon} disabled={busy} />
      </div>

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

      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        멤버 기본 권한
        <select
          data-testid="teamspace-settings-member-level"
          aria-label="멤버 기본 권한"
          value={memberLevel}
          onChange={(e) => {
            const next = TEAMSPACE_MEMBER_LEVEL_ORDER.find((l) => l === e.target.value)
            if (next) setMemberLevel(next)
          }}
          className={INPUT}
        >
          {TEAMSPACE_MEMBER_LEVEL_ORDER.map((level) => (
            <option key={level} value={level}>
              {memberLevelLabel(level)}
            </option>
          ))}
        </select>
        <span data-testid="teamspace-settings-member-level-hint">{memberLevelHint(memberLevel)}</span>
        <span>소유자는 늘 전체 권한입니다. 상속을 끊고 따로 관리하는 페이지는 바뀌지 않습니다.</span>
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

      {/* 켤 수 없는 사람에게는 기본일 때만 그 사실을 말한다 — 누를 수 없는 설명을 세우지 않는다. */}
      {(canSetDefault || isDefault) && (
        <div
          data-testid="teamspace-default"
          data-default={isDefault ? 'true' : 'false'}
          className="mt-2 flex flex-col gap-1 border-t border-neutral-200 pt-3 dark:border-neutral-800"
        >
          <p className="text-xs text-neutral-500">
            {isDefault ? (
              <>
                <b>기본 teamspace</b> 입니다. 워크스페이스에 새로 들어오는 멤버가 저절로 들어옵니다.
              </>
            ) : (
              <>
                <b>기본 teamspace</b> 로 만들면 워크스페이스 멤버 전원이 곧바로 들어오고, 새로 들어오는 멤버도 저절로
                들어옵니다.
              </>
            )}
          </p>
          {canSetDefault &&
            (isDefault ? (
              <button
                type="button"
                data-testid="teamspace-default-off"
                disabled={busy}
                onClick={() => void setDefault(false)}
                className="self-start rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-700"
              >
                기본 해제
              </button>
            ) : confirmingDefault ? (
              <span className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">
                  제한 멤버와 게스트는 들어오지 않습니다. 나중에 해제해도 이미 들어온 멤버는 남습니다.
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    data-testid="teamspace-default-confirm"
                    disabled={busy}
                    onClick={() => void setDefault(true)}
                    className="rounded border border-neutral-900 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-100"
                  >
                    전원을 넣고 기본으로
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmingDefault(false)}
                    className="rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-700"
                  >
                    취소
                  </button>
                </span>
              </span>
            ) : (
              <button
                type="button"
                data-testid="teamspace-default-on"
                disabled={busy}
                onClick={() => setConfirmingDefault(true)}
                className="self-start rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-700"
              >
                기본으로 만들기
              </button>
            ))}
          {defaultNote && (
            <p data-testid="teamspace-default-note" className="text-xs text-neutral-500">
              {defaultNote}
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-col gap-1 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <p className="text-xs text-neutral-500">
          teamspace 는 지워지지 않고 <b>보관</b>됩니다. 보관하면 소유자인 나까지 이 teamspace 의 페이지를 못 보게 되고,
          되살리면 그대로 돌아옵니다.
        </p>
        {isDefault ? (
          <p data-testid="teamspace-archive-blocked" className="text-xs text-neutral-500">
            기본 teamspace 는 보관할 수 없습니다. 먼저 기본을 해제하세요.
          </p>
        ) : archiving ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              data-testid="teamspace-archive-confirm"
              disabled={busy}
              onClick={() => void archive()}
              className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 disabled:opacity-40 dark:border-red-800"
            >
              정말 보관하기
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setArchiving(false)}
              className="rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-700"
            >
              취소
            </button>
          </span>
        ) : (
          <button
            type="button"
            data-testid="teamspace-archive"
            disabled={busy}
            onClick={() => setArchiving(true)}
            className="self-start rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-700"
          >
            보관하기
          </button>
        )}
      </div>
    </form>
  )
}
