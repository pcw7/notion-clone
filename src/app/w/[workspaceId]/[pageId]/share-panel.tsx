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

type Principal = { type: 'user'; id: string } | { type: 'workspace_everyone' }

type AccessEntry = {
  principalType: string
  principalId: string | null
  level: string
  inherited: boolean
}

type Member = { userId: string; name: string; email: string | null }

type AccessState = {
  canManage: boolean
  entries: AccessEntry[]
  members: Member[]
}

/** 페이지에 줄 수 있는 레벨. `create`·`edit_content` 는 database 전용이다. */
const PAGE_LEVELS: readonly { value: string; label: string }[] = [
  { value: 'view', label: '읽기' },
  { value: 'comment', label: '댓글' },
  { value: 'edit', label: '편집' },
  { value: 'full_access', label: '전체 권한' },
]

const EVERYONE = '워크스페이스 모든 멤버'

export function SharePanel({ workspaceId, pageId }: { workspaceId: string; pageId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<AccessState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [addUser, setAddUser] = useState('')
  const [addLevel, setAddLevel] = useState('edit')

  const url = `/api/workspaces/${workspaceId}/pages/${pageId}/access`

  /**
   * 목록을 다시 읽는다.
   *
   * ⚠ **여기서 오류를 지우지 않는다.** 실패한 조작 뒤에도 목록은 새로 읽어야
   * 하는데(서버가 무엇을 갖고 있는지 보여줘야 한다), 그때 오류까지 지우면
   * 방금 뜬 "막혔습니다"가 즉시 사라져 **아무 일도 안 일어난 것처럼 보인다.**
   * 실제로 그렇게 짰다가 e2e 가 잡았다.
   */
  const load = useCallback(async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        setError('공유 설정을 불러오지 못했습니다.')
        return
      }
      const data = await res.json()
      setState({ canManage: data.canManage, entries: data.entries, members: data.members })
    } catch {
      setError('연결에 실패했습니다.')
    }
  }, [url])

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

  const principalOf = (entry: AccessEntry): Principal =>
    entry.principalType === 'user'
      ? { type: 'user', id: String(entry.principalId) }
      : { type: 'workspace_everyone' }

  const nameOf = (entry: AccessEntry): string => {
    if (entry.principalType === 'workspace_everyone') return EVERYONE
    const member = state?.members.find((m) => m.userId === entry.principalId)
    return member ? (member.email ? `${member.name} (${member.email})` : member.name) : '알 수 없는 사용자'
  }

  const inheriting = state?.entries.some((e) => e.inherited) ?? false
  const listed = new Set(state?.entries.map((e) => e.principalId).filter(Boolean) ?? [])
  const addable = (state?.members ?? []).filter((m) => !listed.has(m.userId))

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
              <ul className="flex flex-col gap-2">
                {state.entries.map((entry) => (
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

                    {state.canManage ? (
                      <span className="flex flex-none items-center gap-1">
                        <select
                          aria-label={`${nameOf(entry)} 권한`}
                          value={entry.level}
                          disabled={busy}
                          onChange={(e) =>
                            void run(
                              // 상속된 줄의 레벨을 바꾸는 것도 이 노드에 부여하는 일이다.
                              entry.inherited
                                ? [{ action: 'restrict' }, { action: 'grant', principal: principalOf(entry), level: e.target.value }]
                                : [{ action: 'grant', principal: principalOf(entry), level: e.target.value }],
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
                                ? [{ action: 'restrict' }, { action: 'revoke', principal: principalOf(entry) }]
                                : [{ action: 'revoke', principal: principalOf(entry) }],
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
                ))}
              </ul>

              {state.canManage && (
                <>
                  <form
                    className="mt-3 flex items-center gap-1 border-t border-neutral-200 pt-3 dark:border-neutral-800"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (addUser === '') return
                      void run([
                        { action: 'grant', principal: { type: 'user', id: addUser }, level: addLevel },
                      ])
                      setAddUser('')
                    }}
                  >
                    <select
                      aria-label="추가할 사람"
                      value={addUser}
                      onChange={(e) => setAddUser(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                    >
                      <option value="">사람 선택…</option>
                      {addable.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.email ? `${m.name} (${m.email})` : m.name}
                        </option>
                      ))}
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
