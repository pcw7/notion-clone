'use client'

/**
 * 공유 패널 — F-06-05 / F-06-01
 *
 * 판정과 저장은 전부 서버에 있다(`src/lib/permissions/`). 이 파일은 **목록과
 * 호출만** 한다. 화면이 권한 규칙을 한 줄이라도 갖기 시작하면 서버와 어긋나고,
 * 어긋난 쪽이 더 관대하면 그게 사고다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * "상속됨 주체 제거"는 한 번의 클릭이지만 두 번의 요청이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 상속으로 들어온 주체를 지우려면 먼저 **상속을 끊어야** 하고, 끊는 순간
 * 지금까지 상속하던 모든 주체가 이 페이지로 복사된다(불변식 P1 — 그러지 않으면
 * "1명 제거"가 "전원 상실"이 된다). 그 복사를 하는 곳은 서버의 `stopInheriting`
 * 하나뿐이고, 여기서는 `restrict` → `revoke` 순서로 부르기만 한다.
 *
 * 사용자에게는 그 두 단계를 설명하지 않는다. 대신 결과를 설명한다 —
 * "이제 이 페이지는 따로 관리됩니다".
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  GUEST_LEVEL_OPTIONS,
  choiceValue,
  entryLabel,
  groupLabel,
  guestInviteMessage,
  guestInvitedNotice,
  memberLabel,
  parseChoice,
  principalOfEntry,
  type ShareGroup,
  type ShareMember,
  type ShareTeamspace,
} from './share-principals'
import {
  EDIT_REQUEST_HINT,
  EDIT_REQUEST_SENT,
  accessRequestFailureMessage,
  approveLevelOptions,
  approvedNotice,
  defaultApproveLevel,
  ignoredNotice,
  requestKindLabel,
  requesterLabel,
} from '../access-request-messages'

type AccessEntry = {
  principalType: string
  principalId: string | null
  level: string
  inherited: boolean
}

type AccessState = {
  canManage: boolean
  entries: AccessEntry[]
  members: ShareMember[]
  groups: ShareGroup[]
  teamspaces: ShareTeamspace[]
  /** 대기 중인 접근 · 편집 요청(7e-1 · 7e-2) — 공유할 수 있는 사람에게만 온다. */
  requests: AccessRequestView[]
  /** 편집 권한 요청(7e-2) — 볼 수는 있지만 고칠 수 없는 사람에게만 온다(아니면 null). */
  editRequest: { requested: boolean } | null
}

type AccessRequestView = {
  id: string
  requesterId: string
  name: string
  email: string | null
  guest: boolean
  kind: string
  requestedLevel: string | null
}

/** 공유 설정을 읽는다 — 목록이거나, 못 읽었으면 보여 줄 문구. 상태를 모른다(클릭과 효과가 나눠 쓴다). */
async function readAccess(url: string): Promise<AccessState | string> {
  try {
    const res = await fetch(url)
    if (!res.ok) return '공유 설정을 불러오지 못했습니다.'
    const data = await res.json()
    return {
      canManage: data.canManage,
      entries: data.entries,
      members: data.members,
      groups: data.groups ?? [],
      teamspaces: data.teamspaces ?? [],
      requests: data.requests ?? [],
      editRequest: data.editRequest ?? null,
    }
  } catch {
    return '연결에 실패했습니다.'
  }
}

/** 페이지에 줄 수 있는 레벨. `create`·`edit_content` 는 database 전용이다. */
const PAGE_LEVELS: readonly { value: string; label: string }[] = [
  { value: 'view', label: '읽기' },
  { value: 'comment', label: '댓글' },
  { value: 'edit', label: '편집' },
  { value: 'full_access', label: '전체 권한' },
]

export function SharePanel({
  workspaceId,
  pageId,
  initialOpen = false,
}: {
  workspaceId: string
  pageId: string
  /** 연 채로 시작한다 — 인박스의 접근 요청 줄이 `?share=1` 로 데려올 때(7e-1). */
  initialOpen?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(initialOpen)
  const [state, setState] = useState<AccessState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [addUser, setAddUser] = useState('')
  const [addLevel, setAddLevel] = useState('edit')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLevel, setInviteLevel] = useState('comment')
  /** 요청마다 고른 레벨 — 고르지 않았으면 그 요청의 첫 선택지(읽기). */
  const [requestLevels, setRequestLevels] = useState<Record<string, string>>({})

  const url = `/api/workspaces/${workspaceId}/pages/${pageId}/access`
  const guestsUrl = `/api/workspaces/${workspaceId}/pages/${pageId}/guests`

  /**
   * 목록을 다시 읽는다.
   *
   * ⚠ **여기서 오류를 지우지 않는다.** 실패한 조작 뒤에도 목록은 새로 읽어야
   * 하는데(서버가 무엇을 갖고 있는지 보여줘야 한다), 그때 오류까지 지우면
   * 방금 뜬 "막혔습니다"가 즉시 사라져 **아무 일도 안 일어난 것처럼 보인다.**
   * 실제로 그렇게 짰다가 e2e 가 잡았다.
   */
  const load = useCallback(async () => {
    const read = await readAccess(url)
    if (typeof read === 'string') setError(read)
    else setState(read)
  }, [url])

  // 연 채로 왔으면(인박스 → `?share=1`) 첫 목록은 효과가 읽는다 — 클릭이 없었으므로. 그 뒤는 여느 때처럼 클릭이 읽는다.
  // 상태는 응답이 온 뒤에만 바꾼다(효과 안의 동기 setState 는 렌더를 연쇄시킨다 — `react-hooks/set-state-in-effect`).
  useEffect(() => {
    if (!initialOpen) return
    let cancelled = false
    void readAccess(url).then((read) => {
      if (cancelled) return
      if (typeof read === 'string') setError(read)
      else setState(read)
    })
    return () => {
      cancelled = true
    }
  }, [initialOpen, url])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  /** 한 번의 조작 = 한 번 이상의 요청. 하나라도 실패하면 거기서 멈추고 알린다. */
  const run = useCallback(
    async (steps: Record<string, unknown>[], done?: string) => {
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        for (const body of steps) {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            setError(data.message ?? '바꾸지 못했습니다.')
            await load()
            return
          }
        }
        if (done) setNotice(done)
        await load()
        // 사이드바는 서버 렌더다 — 접근이 바뀌면 목록도 바뀐다.
        router.refresh()
      } catch {
        setError('연결에 실패했습니다.')
      } finally {
        setBusy(false)
      }
    },
    [url, load, router],
  )

  const nameOf = (entry: AccessEntry): string =>
    entryLabel(entry, state?.members ?? [], state?.groups ?? [], state?.teamspaces ?? [])

  const inheriting = state?.entries.some((e) => e.inherited) ?? false
  const listed = new Set(
    (state?.entries ?? []).map((e) => principalOfEntry(e)).flatMap((p) => (p && p.type !== 'workspace_everyone' ? [choiceValue(p)] : [])),
  )
  const addableMembers = (state?.members ?? []).filter((m) => !listed.has(choiceValue({ type: 'user', id: m.userId })))
  const addableGroups = (state?.groups ?? []).filter((g) => !listed.has(choiceValue({ type: 'group', id: g.groupId })))

  /** 이메일로 초대 — 없는 사람은 게스트로 들인다(7d-1). 성공하면 목록을 다시 읽는다(새 게스트의 이름이 서야 한다). */
  async function inviteGuest(): Promise<void> {
    const email = inviteEmail.trim()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(guestsUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, level: inviteLevel }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown; as?: unknown }
      if (!res.ok) {
        setError(guestInviteMessage(data.error))
        return
      }
      setNotice(guestInvitedNotice(data.as, email))
      setInviteEmail('')
      await load()
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 접근 요청을 허락하거나 무시한다(7e-1). 허락의 레벨 규칙(게스트는 편집까지 · 낮추지 않는다)은 서버가 한다 — 여기서는 고를 수
   * 없는 것을 보여 주지 않을 뿐이다. 끝나면 목록을 다시 읽는다(허락한 사람이 공유 행에 선다).
   */
  async function decide(request: AccessRequestView, action: 'approve' | 'ignore', level: string): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/access-requests/${request.id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'approve' ? { level } : {}),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown }
      if (!res.ok) {
        setError(accessRequestFailureMessage(data.error))
        await load()
        return
      }
      setNotice(action === 'approve' ? approvedNotice(request.name, level) : ignoredNotice(request.name))
      await load()
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 편집 권한을 요청한다(7e-2). 끝나면 목록을 다시 읽는다 — "요청했습니다"는 서버가 아는 상태로 선다(이미 열린 요청 · 하루 안에
   * 무시된 요청도 같다). 그 사이에 고칠 수 있게 됐으면(`has_access`) 페이지를 다시 그린다.
   */
  async function requestEdit(): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/access-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'edit_access' }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown }
      if (!res.ok && data.error !== 'has_access') setError(accessRequestFailureMessage(data.error))
      await load()
      if (data.error === 'has_access') router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        // 열 때 읽는다. 효과(useEffect)가 아니라 **이 클릭**이 부르는 것이 맞다 —
        // 패널을 안 여는 사람에게 ACL 질의를 돌릴 이유가 없다.
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) {
            setError(null)
            setNotice(null)
            void load()
          }
        }}
        aria-expanded={open}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        공유
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="공유 설정"
          className="absolute right-0 z-20 mt-2 w-96 rounded-lg border border-neutral-200 bg-white p-4 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {state === null && !error && <p className="text-sm text-neutral-500">불러오는 중…</p>}

          {state !== null && (
            <>
              {/* 접근 요청(7e-1) — 공유할 수 있는 사람에게만 온다. 목록 맨 위에 둔다: 인박스가 이것을 처리하라고 데려왔다. */}
              {state.canManage && state.requests.length > 0 && (
                <section
                  data-testid="access-requests"
                  aria-label="접근 요청"
                  className="mb-3 flex flex-col gap-2 border-b border-neutral-200 pb-3 dark:border-neutral-800"
                >
                  <h3 className="text-xs font-medium text-neutral-500">접근 요청 {state.requests.length}</h3>
                  <ul className="flex flex-col gap-2">
                    {state.requests.map((r) => {
                      const options = approveLevelOptions(r.guest)
                      const level = requestLevels[r.id] ?? defaultApproveLevel(options, r.requestedLevel)
                      return (
                        <li
                          key={r.id}
                          data-testid="access-request-row"
                          data-request-id={r.id}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="min-w-0 truncate">
                            {requesterLabel(r)}
                            <span data-testid="access-request-kind" className="ml-1 text-xs text-neutral-400">
                              {requestKindLabel(r.kind)}
                            </span>
                          </span>
                          <span className="flex flex-none items-center gap-1">
                            <select
                              aria-label={`${r.name} 님에게 줄 권한`}
                              data-testid="access-request-level"
                              value={level}
                              disabled={busy}
                              onChange={(e) => {
                                const value = e.target.value
                                setRequestLevels((prev) => ({ ...prev, [r.id]: value }))
                              }}
                              className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                            >
                              {options.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              data-testid="access-request-approve"
                              disabled={busy}
                              onClick={() => void decide(r, 'approve', level)}
                              className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700"
                            >
                              허락
                            </button>
                            <button
                              type="button"
                              data-testid="access-request-ignore"
                              disabled={busy}
                              onClick={() => void decide(r, 'ignore', level)}
                              className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-500 dark:border-neutral-700"
                            >
                              무시
                            </button>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              <ul className="flex flex-col gap-2">
                {state.entries.map((entry) => {
                  // 모르는 종류의 주체는 null — 그 행은 고치지 못하게 읽기 전용으로 그린다(`share-principals.ts`).
                  const principal = principalOfEntry(entry)
                  return (
                  <li
                    key={`${entry.principalType}:${entry.principalId ?? ''}`}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className={entry.inherited ? 'text-neutral-400' : ''}>
                      {nameOf(entry)}
                      {/* 상속됨을 회색 + 말로 함께 표시한다 — 색만으로는 안 보이는
                          사용자에게 아무것도 알리지 않는다(F-12-12). */}
                      {entry.inherited && <span className="ml-1 text-xs">(상위에서 상속됨)</span>}
                    </span>

                    {state.canManage && principal !== null ? (
                      <span className="flex flex-none items-center gap-1">
                        <select
                          aria-label={`${nameOf(entry)} 권한`}
                          value={entry.level}
                          disabled={busy}
                          onChange={(e) =>
                            void run(
                              // 상속된 줄의 레벨을 바꾸는 것도 이 노드에 부여하는 일이다.
                              entry.inherited
                                ? [{ action: 'restrict' }, { action: 'grant', principal, level: e.target.value }]
                                : [{ action: 'grant', principal, level: e.target.value }],
                            )
                          }
                          className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                        >
                          {PAGE_LEVELS.map((l) => (
                            <option key={l.value} value={l.value}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              // ★ 상속된 주체를 지우려면 먼저 끊어야 한다(머리말).
                              entry.inherited
                                ? [{ action: 'restrict' }, { action: 'revoke', principal }]
                                : [{ action: 'revoke', principal }],
                              entry.inherited ? '이제 이 페이지는 따로 관리됩니다.' : undefined,
                            )
                          }
                          className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700"
                        >
                          제거
                        </button>
                      </span>
                    ) : (
                      <span className="flex-none text-xs text-neutral-400">
                        {PAGE_LEVELS.find((l) => l.value === entry.level)?.label ?? entry.level}
                      </span>
                    )}
                  </li>
                  )
                })}
              </ul>

              {state.canManage && (
                <>
                  <form
                    className="mt-3 flex items-center gap-1 border-t border-neutral-200 pt-3 dark:border-neutral-800"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const principal = parseChoice(addUser)
                      if (principal === null) return
                      void run([{ action: 'grant', principal, level: addLevel }])
                      setAddUser('')
                    }}
                  >
                    <select
                      aria-label="추가할 사람"
                      value={addUser}
                      onChange={(e) => setAddUser(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                    >
                      <option value="">사람 · 그룹 선택…</option>
                      {addableMembers.length > 0 && (
                        <optgroup label="사람">
                          {addableMembers.map((m) => (
                            <option key={m.userId} value={choiceValue({ type: 'user', id: m.userId })}>
                              {memberLabel(m)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {addableGroups.length > 0 && (
                        <optgroup label="그룹">
                          {addableGroups.map((g) => (
                            <option key={g.groupId} value={choiceValue({ type: 'group', id: g.groupId })}>
                              {groupLabel(g)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <select
                      aria-label="줄 권한"
                      value={addLevel}
                      onChange={(e) => setAddLevel(e.target.value)}
                      className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                    >
                      {PAGE_LEVELS.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={busy || addUser === ''}
                      className="rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-700"
                    >
                      추가
                    </button>
                  </form>

                  {/* 이메일로 초대(7d-1) — 이 워크스페이스에 없는 사람은 게스트가 된다. 게스트는 편집까지만 받는다. */}
                  <form
                    data-testid="share-invite-guest"
                    className="mt-2 flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void inviteGuest()
                    }}
                  >
                    <input
                      type="email"
                      aria-label="초대할 이메일"
                      placeholder="이메일로 초대(게스트)"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                    />
                    <select
                      aria-label="게스트에게 줄 권한"
                      value={inviteLevel}
                      onChange={(e) => setInviteLevel(e.target.value)}
                      className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                    >
                      {GUEST_LEVEL_OPTIONS.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      data-testid="share-invite-guest-submit"
                      disabled={busy || inviteEmail.trim() === ''}
                      className="rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-700"
                    >
                      초대
                    </button>
                  </form>

                  <p className="mt-3 border-t border-neutral-200 pt-3 text-xs text-neutral-500 dark:border-neutral-800">
                    {inheriting ? (
                      <>
                        상위 페이지의 공유 설정을 따르고 있습니다.{' '}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run([{ action: 'restrict' }], '이제 이 페이지는 따로 관리됩니다.')}
                          className="underline underline-offset-2"
                        >
                          따로 관리하기
                        </button>
                      </>
                    ) : (
                      <>
                        이 페이지는 따로 관리되고 있습니다.{' '}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run([{ action: 'inherit' }], '다시 상위 페이지를 따릅니다.')}
                          className="underline underline-offset-2"
                        >
                          상위 설정 따르기
                        </button>
                      </>
                    )}
                  </p>
                </>
              )}

              {/* 편집 권한 요청(7e-2) — 볼 수는 있지만 고칠 수 없는 사람에게만 서버가 준다. 관리자에게는 오지 않는다. */}
              {state.editRequest !== null && (
                <p
                  data-testid="edit-request"
                  className="mt-3 border-t border-neutral-200 pt-3 text-xs text-neutral-500 dark:border-neutral-800"
                >
                  {state.editRequest.requested ? (
                    <span data-testid="edit-requested">{EDIT_REQUEST_SENT}</span>
                  ) : (
                    <>
                      {EDIT_REQUEST_HINT}{' '}
                      <button
                        type="button"
                        data-testid="edit-request-send"
                        disabled={busy}
                        onClick={() => void requestEdit()}
                        className="underline underline-offset-2"
                      >
                        편집 권한 요청
                      </button>
                    </>
                  )}
                </p>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="mt-3 text-xs text-red-600">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-3 text-xs text-neutral-500">
              {notice}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
