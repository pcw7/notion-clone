'use client'

/**
 * 비밀번호 패널 — 설정 → 내 계정 → 보안 (잔여 묶음 8i-1b · F-14-03)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 비밀번호 ③ ~ ⑥ · 14-auth-accounts.md F-14-03 *"강도 미터가 아니라 규칙 체크리스트를 실시간
 *       표시 … 15자 넘으면 문자+숫자 항목이 회색으로 소거된다"*
 *
 * 상태(있는가 · 지금 비밀번호를 묻는가)는 서버가 준다(`passwordStatus`) — 이 화면이 판정하지 않는다. 저장하면 서버가 다시 그리고
 * (`router.refresh`) 그 상태를 받는다.
 *
 *   · 없으면 "비밀번호 정하기" — 새 비밀번호와 체크리스트(서버와 같은 함수 `passwordRules`)
 *   · 있으면 "바꾸기" · "지우기" — 10분 안에 로그인 코드로 들어온 세션이 아니면 지금 비밀번호를 묻는다(그것이 재설정이다)
 *   · 바꾸면 다른 기기에서 로그아웃한 수를 말한다
 */

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'

import { isAcceptablePassword, passwordRules } from '@/lib/auth/password-policy'
import { PASSWORD_OFFLINE, checklistOf, passwordFailureMessage, passwordSavedMessage } from './password-messages'

type Mode = 'idle' | 'set' | 'remove'
type Status = { readonly kind: 'saved' | 'error'; readonly text: string }

const INPUT =
  'w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900'
const BUTTON = 'rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900'

export function PasswordPanel(props: { workspaceId: string; hasPassword: boolean; currentRequired: boolean }) {
  const { hasPassword, currentRequired } = props
  const router = useRouter()
  const id = useId()
  const [mode, setMode] = useState<Mode>('idle')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  const open = (to: Mode) => {
    setMode(to)
    setCurrent('')
    setNext('')
    setStatus(null)
  }

  const send = async (method: 'PUT' | 'DELETE', body: Record<string, string>) => {
    setBusy(true)
    setStatus(null)
    let res: Response | null = null
    let data: { error?: string; revokedSessions?: number } | null = null
    try {
      res = await fetch(`/api/workspaces/${props.workspaceId}/account/password`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      data = await res.json().catch(() => null)
    } catch {
      res = null
    }
    setBusy(false)
    if (res === null || !res.ok) {
      setStatus({ kind: 'error', text: res === null ? PASSWORD_OFFLINE : passwordFailureMessage(data?.error) })
      return
    }
    const kind = method === 'DELETE' ? 'removed' : hasPassword ? 'changed' : 'set'
    setStatus({ kind: 'saved', text: passwordSavedMessage(kind, data?.revokedSessions ?? 0) })
    setMode('idle')
    setCurrent('')
    setNext('')
    router.refresh()
  }

  const withCurrent = (body: Record<string, string>) => (hasPassword && currentRequired ? { ...body, currentPassword: current } : body)
  const checklist = checklistOf(passwordRules(next))

  return (
    <section data-testid="password-panel" data-has-password={hasPassword} className="mt-6 flex flex-col gap-3">
      <h2 className="text-sm font-medium">비밀번호</h2>
      <p className="text-xs text-neutral-500" data-testid="password-state">
        {hasPassword
          ? '비밀번호를 정했습니다. 이메일과 비밀번호로도 들어올 수 있습니다.'
          : '비밀번호가 없습니다. 로그인 코드로 들어옵니다 — 정하면 이메일과 비밀번호로도 들어올 수 있습니다.'}
      </p>
      {hasPassword && !currentRequired && (
        <p className="text-xs text-neutral-500" data-testid="password-fresh-note">
          방금 로그인 코드로 들어와 지금 비밀번호 없이 바꿀 수 있습니다(10분).
        </p>
      )}

      {mode === 'idle' && (
        <div className="flex gap-2">
          {hasPassword ? (
            <>
              <button type="button" data-testid="password-change-open" onClick={() => open('set')} className={BUTTON}>
                비밀번호 바꾸기
              </button>
              <button type="button" data-testid="password-remove-open" onClick={() => open('remove')} className={BUTTON}>
                비밀번호 지우기
              </button>
            </>
          ) : (
            <button type="button" data-testid="password-set-open" onClick={() => open('set')} className={BUTTON}>
              비밀번호 정하기
            </button>
          )}
        </div>
      )}

      {mode !== 'idle' && (
        <form
          data-testid={mode === 'set' ? 'password-form' : 'password-remove-form'}
          className="flex max-w-sm flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (busy) return
            if (mode === 'set') void send('PUT', withCurrent({ newPassword: next }))
            else void send('DELETE', withCurrent({}))
          }}
        >
          {hasPassword && currentRequired && (
            <label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400">
              지금 비밀번호
              <input
                type="password"
                autoComplete="current-password"
                data-testid="password-current"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className={INPUT}
              />
            </label>
          )}
          {mode === 'set' ? (
            <>
              <label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400">
                새 비밀번호
                <input
                  type="password"
                  autoComplete="new-password"
                  data-testid="password-new"
                  aria-describedby={`${id}-rules`}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  className={INPUT}
                />
              </label>
              <ul id={`${id}-rules`} data-testid="password-rules" className="flex flex-col gap-0.5 text-xs">
                {checklist.map((item) => (
                  <li
                    key={item.id}
                    data-rule={item.id}
                    data-state={item.state}
                    className={
                      item.state === 'met' ? 'text-green-700 dark:text-green-400' : item.state === 'waived' ? 'text-neutral-400 line-through' : 'text-neutral-500'
                    }
                  >
                    <span aria-hidden>{item.state === 'met' ? '✓ ' : item.state === 'waived' ? '– ' : '○ '}</span>
                    {item.label}
                    <span className="sr-only">{item.state === 'met' ? ' (지킴)' : item.state === 'waived' ? ' (필요 없음)' : ' (아직)'}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-neutral-500">지우면 이메일과 비밀번호로는 들어올 수 없고, 로그인 코드로 들어옵니다.</p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              data-testid={mode === 'set' ? 'password-save' : 'password-remove-confirm'}
              disabled={busy || (mode === 'set' && !isAcceptablePassword(next))}
              className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {busy ? '저장하는 중…' : mode === 'set' ? '저장' : '지우기'}
            </button>
            <button type="button" data-testid="password-cancel" onClick={() => open('idle')} className={BUTTON}>
              취소
            </button>
          </div>
        </form>
      )}

      {status !== null && (
        <p role={status.kind === 'error' ? 'alert' : 'status'} data-testid="password-status" className={`text-xs ${status.kind === 'error' ? 'text-red-600' : 'text-neutral-500'}`}>
          {status.text}
        </p>
      )}
    </section>
  )
}
