'use client'

/**
 * teamspace 의 멤버 — 목록 · 넣기 · 역할 · 빼기 · 나가기 (7c-2조각 · F-06-04)
 *
 * 판정과 저장은 전부 서버에 있다(`lib/workspace/teamspace.ts` · 라우트 셋). 이 파일은 **목록과 호출만** 한다.
 *
 *   - 넣기는 소유자, 또는 초대 규칙이 `all_members` 인 teamspace 의 멤버(`canInviteHere`). 소유자로 넣는 것은 소유자만
 *   - 역할 · 빼기는 소유자만. 멤버는 자기 줄의 "나가기"만 있다
 *   - **마지막 소유자**는 내려가거나 나갈 수 없다 — 서버가 `last_owner` 로 거부하고, 그 말을 그대로 세운다
 *
 * 버튼을 숨기는 것은 편의일 뿐이다 — 서버가 다시 묻는다. 조작 뒤에는 `GET teamspaces/{id}` 하나로 머리(내 역할)와 멤버를
 * 다시 읽는다 — 스스로 소유자를 내려놓으면 그 자리에서 버튼이 바뀌어야 한다. `router.refresh()` 는 **나가기** 뒤에만
 * 부른다 — 사이드바에서 이 teamspace 가 사라져야 하는 것은 그때뿐이다.
 *
 * 나가기는 **두 번 누른다**(그룹 지우기와 같은 규칙 · §3.3-188). 나가면 이 teamspace 의 페이지를 곧바로 못 보고, 다시
 * 들어오려면 누군가 넣어 줘야 한다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import type { GroupCandidate } from '../../group-messages'
import { choiceValue, parseChoice } from '../../[pageId]/share-principals'
import {
  canInviteAsOwner,
  canInviteHere,
  teamspaceCandidates,
  teamspaceFailureMessage,
  teamspaceRoleLabel,
  type TeamspaceGroupCandidate,
  type TeamspaceMemberView,
  type TeamspaceRoleName,
} from '../../teamspace-messages'

type Detail = { role: TeamspaceRoleName; whoCanInvite: string }
type Principal = TeamspaceMemberView['principal']
type CallResult = { ok: true; data: Record<string, unknown> } | { ok: false }

const INPUT =
  'rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300'
const SMALL = 'rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-700'

export function TeamspaceMembers({
  workspaceId,
  teamspaceId,
  myUserId,
  initialTeamspace,
  initialMembers,
  people,
  groups,
}: {
  workspaceId: string
  teamspaceId: string
  myUserId: string
  initialTeamspace: Detail
  initialMembers: TeamspaceMemberView[]
  /** 넣을 후보를 고를 워크스페이스 멤버 전원(상태 · 역할과 함께 — 고르는 것은 `teamspaceCandidates`). */
  people: GroupCandidate[]
  groups: TeamspaceGroupCandidate[]
}) {
  const router = useRouter()
  const [detail, setDetail] = useState<Detail>(initialTeamspace)
  const [members, setMembers] = useState(initialMembers)
  const [choice, setChoice] = useState('')
  const [addRole, setAddRole] = useState<TeamspaceRoleName>('member')
  const [leaving, setLeaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const base = `/api/workspaces/${workspaceId}/teamspaces/${teamspaceId}`
  const memberUrl = (p: Principal) => `${base}/members/${p.type}/${p.id}`

  /** 요청 하나. 거부되면 문구를 세우고 `{ ok: false }` — 부른 쪽은 거기서 멈춘다. */
  async function call(url: string, init?: RequestInit): Promise<CallResult> {
    try {
      const res = await fetch(url, init)
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setError(teamspaceFailureMessage(data.error))
        return { ok: false }
      }
      return { ok: true, data }
    } catch {
      setError('연결에 실패했습니다.')
      return { ok: false }
    }
  }

  const send = (url: string, method: string, body?: unknown) =>
    call(url, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  /** 머리와 멤버를 다시 읽는다. 오류를 지우지 않는다 — 거부된 조작 뒤에도 서버가 가진 것을 보여 줘야 한다. */
  async function reload(): Promise<void> {
    const read = await call(base)
    if (!read.ok) return
    const teamspace = read.data.teamspace as Detail
    setDetail({ role: teamspace.role, whoCanInvite: teamspace.whoCanInvite })
    setMembers(read.data.members as TeamspaceMemberView[])
  }

  /** 조작 하나 = 요청 → 다시 읽기. 누르는 동안 다른 버튼을 잠근다. */
  async function act(run: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await run()
    } finally {
      setBusy(false)
    }
  }

  const add = () =>
    act(async () => {
      const principal = parseChoice(choice)
      if (principal === null) return
      const added = await send(`${base}/members`, 'POST', { principal, role: addRole })
      if (added.ok) {
        setChoice('')
        setAddRole('member')
      }
      await reload()
    })

  const changeRole = (member: TeamspaceMemberView, role: string) =>
    act(async () => {
      await send(memberUrl(member.principal), 'PATCH', { role })
      await reload()
    })

  const remove = (member: TeamspaceMemberView) =>
    act(async () => {
      await send(memberUrl(member.principal), 'DELETE')
      await reload()
    })

  const leave = () =>
    act(async () => {
      setLeaving(false)
      const left = await send(memberUrl({ type: 'user', id: myUserId }), 'DELETE')
      if (!left.ok) return
      // 사이드바에서 이 teamspace 가 빠져야 한다 — 레이아웃을 다시 받는다.
      router.push(`/w/${workspaceId}`)
      router.refresh()
    })

  const isOwner = detail.role === 'owner'
  const isSelf = (m: TeamspaceMemberView) => m.principal.type === 'user' && m.principal.id === myUserId
  const hasSelfRow = members.some(isSelf)
  const candidates = teamspaceCandidates(people, groups, members)
  const noCandidates = candidates.people.length + candidates.groups.length === 0

  return (
    <div data-testid="teamspace-members" className="mt-3 flex flex-col gap-3">
      <p className="text-sm">
        내 역할: <span data-testid="teamspace-my-role" className="font-medium">{teamspaceRoleLabel(detail.role)}</span>
      </p>

      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {members.map((m) => {
          const self = isSelf(m)
          return (
            <li
              key={choiceValue(m.principal)}
              data-testid="teamspace-member"
              data-principal={choiceValue(m.principal)}
              className="flex flex-col gap-2 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm">
                  {m.principal.type === 'group' ? `그룹 · ${m.name}` : m.name}
                  {self && <span className="ml-1 text-xs text-neutral-500">(나)</span>}
                  {m.email && <span className="ml-1 text-xs text-neutral-500">{m.email}</span>}
                </span>
                <span className="flex flex-none items-center gap-1">
                  {isOwner ? (
                    <select
                      data-testid="teamspace-member-role"
                      aria-label={`${m.name} 역할`}
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => void changeRole(m, e.target.value)}
                      className="rounded border border-neutral-300 px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <option value="owner">{teamspaceRoleLabel('owner')}</option>
                      <option value="member">{teamspaceRoleLabel('member')}</option>
                    </select>
                  ) : (
                    <span data-testid="teamspace-member-role-label" className="text-xs text-neutral-500">
                      {teamspaceRoleLabel(m.role)}
                    </span>
                  )}
                  {self ? (
                    leaving ? (
                      <>
                        <button
                          type="button"
                          data-testid="teamspace-leave-confirm"
                          disabled={busy}
                          onClick={() => void leave()}
                          className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 disabled:opacity-40 dark:border-red-800"
                        >
                          정말 나가기
                        </button>
                        <button type="button" disabled={busy} onClick={() => setLeaving(false)} className={SMALL}>
                          취소
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        data-testid="teamspace-leave"
                        disabled={busy}
                        onClick={() => setLeaving(true)}
                        className={SMALL}
                      >
                        나가기
                      </button>
                    )
                  ) : (
                    isOwner && (
                      <button
                        type="button"
                        data-testid="teamspace-member-remove"
                        disabled={busy}
                        onClick={() => void remove(m)}
                        className={SMALL}
                      >
                        빼기
                      </button>
                    )
                  )}
                </span>
              </div>
              {self && leaving && (
                <p className="text-xs text-neutral-500">
                  나가면 이 teamspace 의 페이지를 곧바로 못 봅니다. 다시 들어오려면 멤버가 넣어 줘야 합니다.
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {!hasSelfRow && (
        <p className="text-xs text-neutral-500">그룹을 거쳐 이 teamspace 의 멤버입니다. 나가려면 그 그룹에서 빠져야 합니다.</p>
      )}

      {canInviteHere(detail.role, detail.whoCanInvite) && (
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <select
            data-testid="teamspace-add-choice"
            aria-label="넣을 사람이나 그룹"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className={`min-w-0 flex-1 ${INPUT}`}
          >
            <option value="">{noCandidates ? '넣을 수 있는 사람이 없습니다' : '사람 · 그룹 선택…'}</option>
            {candidates.people.length > 0 && (
              <optgroup label="사람">
                {candidates.people.map((p) => (
                  <option key={p.userId} value={choiceValue({ type: 'user', id: p.userId })}>
                    {p.email ? `${p.name} (${p.email})` : p.name}
                  </option>
                ))}
              </optgroup>
            )}
            {candidates.groups.length > 0 && (
              <optgroup label="그룹">
                {candidates.groups.map((g) => (
                  <option key={g.id} value={choiceValue({ type: 'group', id: g.id })}>
                    {`${g.name} (${g.memberCount}명)`}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {canInviteAsOwner(detail.role) && (
            <select
              data-testid="teamspace-add-role"
              aria-label="넣을 역할"
              value={addRole}
              onChange={(e) => setAddRole(e.target.value === 'owner' ? 'owner' : 'member')}
              className={INPUT}
            >
              <option value="member">{teamspaceRoleLabel('member')}</option>
              <option value="owner">{teamspaceRoleLabel('owner')}</option>
            </select>
          )}
          <button
            type="submit"
            data-testid="teamspace-add"
            disabled={busy || choice === ''}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            넣기
          </button>
        </form>
      )}

      {error && (
        <p role="alert" data-testid="teamspace-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
