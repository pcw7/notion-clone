'use client'

/**
 * 그룹 — 워크스페이스 홈의 "그룹" 절 (7b조각 · F-06-03)
 *
 * 판정과 저장은 전부 서버에 있다(`lib/workspace/group.ts` · 라우트 넷). 이 파일은 **목록과 호출만** 한다.
 *
 *   - 목록 · 멤버 보기는 게스트가 아닌 멤버 전원(`canSeeGroups` — 게스트에게는 이 절을 그리지 않는다)
 *   - 만들기 · 이름 바꾸기 · 넣기/빼기 · 지우기는 **owner · membership_admin 만**(`canManageGroups`). 버튼을 숨기는 것은
 *     편의일 뿐이다 — 서버가 다시 묻는다
 *
 * 지우기는 **두 번 누른다.** 그룹을 지우면 그 그룹이 받은 공유가 함께 사라지고 되살리는 길이 없다(HANDOFF §3.2-38).
 * `confirm()` 창 대신 그 자리에서 한 번 더 묻는다. 서버가 `would_orphan` 으로 거부하면 몇 페이지인지 함께 말한다.
 *
 * 고친 뒤에는 `router.refresh()` 를 부르지 않고 이 절의 목록만 다시 읽는다 — 홈의 나머지(최상위 페이지 · 멤버)는
 * 그룹과 상관없다.
 */

import { useState } from 'react'

import { addableMembers, deletedNotice, groupFailureMessage, type GroupCandidate } from './group-messages'

type Group = { id: string; name: string; memberCount: number }
type GroupMemberRow = { userId: string; name: string; email: string | null; role: string }

type CallResult = { ok: true; data: Record<string, unknown> } | { ok: false }

const INPUT =
  'rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300'
const SMALL = 'rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-700'

export function GroupPanel({
  workspaceId,
  canManage,
  initialGroups,
  members,
}: {
  workspaceId: string
  canManage: boolean
  initialGroups: Group[]
  /** 그룹에 넣을 후보를 고를 워크스페이스 멤버 전원(상태 · 역할과 함께 — 고르는 것은 `addableMembers`). */
  members: GroupCandidate[]
}) {
  const [groups, setGroups] = useState(initialGroups)
  const [openId, setOpenId] = useState<string | null>(null)
  const [openMembers, setOpenMembers] = useState<GroupMemberRow[] | null>(null)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [addUser, setAddUser] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const base = `/api/workspaces/${workspaceId}/groups`

  /** 요청 하나. 거부되면 문구를 세우고 `{ ok: false }` — 부른 쪽은 거기서 멈춘다. */
  async function call(url: string, init?: RequestInit): Promise<CallResult> {
    try {
      const res = await fetch(url, init)
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setError(groupFailureMessage(data.error, data.nodes))
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

  /** 목록을 다시 읽는다. 오류를 지우지 않는다 — 실패한 조작 뒤에도 서버가 가진 것을 보여 줘야 한다(공유 패널과 같다). */
  async function reloadGroups(): Promise<void> {
    const listed = await call(base)
    if (listed.ok) setGroups(listed.data.groups as Group[])
  }

  async function reloadMembers(groupId: string): Promise<void> {
    const listed = await call(`${base}/${groupId}`)
    setOpenMembers(listed.ok ? (listed.data.members as GroupMemberRow[]) : [])
  }

  /** 조작 하나 = 요청 → 목록 다시 읽기. 누르는 동안 다른 버튼을 잠근다. */
  async function act(run: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await run()
    } finally {
      setBusy(false)
    }
  }

  const toggle = (groupId: string) =>
    act(async () => {
      setConfirming(null)
      setAddUser('')
      if (openId === groupId) {
        setOpenId(null)
        setOpenMembers(null)
        return
      }
      setOpenId(groupId)
      setOpenMembers(null)
      await reloadMembers(groupId)
    })

  const create = () =>
    act(async () => {
      const made = await send(base, 'POST', { name: newName })
      if (made.ok) setNewName('')
      await reloadGroups()
    })

  const rename = (groupId: string, draft: string) =>
    act(async () => {
      const renamed = await send(`${base}/${groupId}`, 'PATCH', { name: draft })
      if (renamed.ok) setRenaming(null)
      await reloadGroups()
    })

  const remove = (group: Group) =>
    act(async () => {
      setConfirming(null)
      const deleted = await send(`${base}/${group.id}`, 'DELETE')
      if (deleted.ok) {
        setNotice(deletedNotice(group.name, deleted.data.nodes))
        if (openId === group.id) {
          setOpenId(null)
          setOpenMembers(null)
        }
      }
      await reloadGroups()
    })

  const addMember = (groupId: string) =>
    act(async () => {
      if (addUser === '') return
      const added = await send(`${base}/${groupId}/members`, 'POST', { userId: addUser })
      if (added.ok) setAddUser('')
      await Promise.all([reloadMembers(groupId), reloadGroups()])
    })

  const removeMember = (groupId: string, userId: string) =>
    act(async () => {
      await send(`${base}/${groupId}/members/${userId}`, 'DELETE')
      await Promise.all([reloadMembers(groupId), reloadGroups()])
    })

  const candidates = openMembers === null ? [] : addableMembers(members, openMembers)

  return (
    <div data-testid="group-panel" className="mt-3 flex flex-col gap-3">
      {canManage && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <input
            data-testid="group-create-name"
            aria-label="새 그룹 이름"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="새 그룹 이름"
            maxLength={100}
            className={`flex-1 ${INPUT}`}
          />
          <button
            type="submit"
            data-testid="group-create"
            disabled={busy || newName.trim().length === 0}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            만들기
          </button>
        </form>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-neutral-400">
          {canManage ? '아직 그룹이 없습니다. 사람을 묶어 두면 페이지를 한 번에 공유할 수 있습니다.' : '아직 그룹이 없습니다.'}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {groups.map((group) => {
            const open = openId === group.id
            const draft = renaming?.id === group.id ? renaming.draft : null
            return (
              <li key={group.id} data-testid="group-row" data-group-id={group.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  {draft !== null ? (
                    <form
                      className="flex flex-1 gap-1"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void rename(group.id, draft)
                      }}
                    >
                      <input
                        data-testid="group-rename-input"
                        aria-label={`${group.name} 새 이름`}
                        value={draft}
                        onChange={(e) => setRenaming({ id: group.id, draft: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        maxLength={100}
                        autoFocus
                        className={`flex-1 ${INPUT}`}
                      />
                      <button type="submit" data-testid="group-rename-save" disabled={busy} className={SMALL}>
                        저장
                      </button>
                      <button type="button" disabled={busy} onClick={() => setRenaming(null)} className={SMALL}>
                        취소
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      data-testid="group-toggle"
                      aria-expanded={open}
                      disabled={busy}
                      onClick={() => void toggle(group.id)}
                      className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                    >
                      <span className="truncate text-sm font-medium" data-testid="group-name">
                        {group.name}
                      </span>
                      <span className="flex-none text-xs text-neutral-500" data-testid="group-count">
                        {group.memberCount}명
                      </span>
                    </button>
                  )}

                  {canManage && draft === null && (
                    <span className="flex flex-none items-center gap-1">
                      <button
                        type="button"
                        data-testid="group-rename"
                        disabled={busy}
                        onClick={() => {
                          setConfirming(null)
                          setRenaming({ id: group.id, draft: group.name })
                        }}
                        className={SMALL}
                      >
                        이름 바꾸기
                      </button>
                      {confirming === group.id ? (
                        <>
                          <button
                            type="button"
                            data-testid="group-delete-confirm"
                            disabled={busy}
                            onClick={() => void remove(group)}
                            className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 disabled:opacity-40 dark:border-red-800"
                          >
                            정말 지우기
                          </button>
                          <button type="button" disabled={busy} onClick={() => setConfirming(null)} className={SMALL}>
                            취소
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          data-testid="group-delete"
                          disabled={busy}
                          onClick={() => setConfirming(group.id)}
                          className={SMALL}
                        >
                          지우기
                        </button>
                      )}
                    </span>
                  )}
                </div>

                {confirming === group.id && (
                  <p className="mt-2 text-xs text-neutral-500">
                    이 그룹이 받은 공유도 함께 사라집니다. 그룹으로 보던 사람은 그 페이지를 더 못 봅니다.
                  </p>
                )}

                {open && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                    {openMembers === null ? (
                      <p className="text-xs text-neutral-400">불러오는 중…</p>
                    ) : openMembers.length === 0 ? (
                      <p className="text-xs text-neutral-400">아직 아무도 없습니다.</p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {openMembers.map((m) => (
                          <li
                            key={m.userId}
                            data-testid="group-member"
                            data-user-id={m.userId}
                            className="flex items-center justify-between text-sm"
                          >
                            <span>
                              {m.name}
                              {m.email && <span className="ml-1 text-xs text-neutral-500">{m.email}</span>}
                            </span>
                            {canManage && (
                              <button
                                type="button"
                                data-testid="group-member-remove"
                                disabled={busy}
                                onClick={() => void removeMember(group.id, m.userId)}
                                className={SMALL}
                              >
                                빼기
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {canManage && openMembers !== null && (
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void addMember(group.id)
                        }}
                      >
                        <select
                          data-testid="group-member-add"
                          aria-label={`${group.name}에 넣을 사람`}
                          value={addUser}
                          onChange={(e) => setAddUser(e.target.value)}
                          className={`min-w-0 flex-1 ${INPUT}`}
                        >
                          <option value="">{candidates.length === 0 ? '넣을 수 있는 사람이 없습니다' : '사람 선택…'}</option>
                          {candidates.map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {m.email ? `${m.name} (${m.email})` : m.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          data-testid="group-member-add-button"
                          disabled={busy || addUser === ''}
                          className={SMALL}
                        >
                          넣기
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {error && (
        <p role="alert" data-testid="group-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="group-notice" className="text-xs text-neutral-500">
          {notice}
        </p>
      )}
    </div>
  )
}
