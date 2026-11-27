'use client'

/**
 * 이메일 주소 패널 — 설정 → 내 계정 → 보안 (AC-1 · F-14-07 · F-14-15 의 이메일 바꾸기)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ① ~ ⑨ · 14-auth-accounts.md F-14-07 *"주소 목록 표(주소 / 검증 상태 / primary 배지 /
 *       •••). 추가 시 인라인 코드 입력"*
 *
 * 상태(주소 · 확인 대기 · 재인증이 필요한가)는 서버가 준다(`emailsStatus`) — 이 화면이 판정하지 않는다. 명령마다 서버가 다시 그린다
 * (`router.refresh`).
 *
 *   · 주소마다 한 줄 — 대표는 "대표" 표지 · 별칭은 "대표로" · "빼기"(빼기는 한 번 더 묻는다 — 다른 기기에서 로그아웃된다)
 *   · 확인 대기는 그 주소의 줄에 코드 칸(10분) · "코드 다시 보내기"
 *   · 더하기 — 주소를 내면 그 주소로 코드. 다른 계정의 주소여도 같은 말이다(서버가 같은 응답을 준다)
 *   · 10분 안에 로그인한 세션이 아니면 — 비밀번호가 있으면 "지금 비밀번호" 칸 · 없으면 다시 로그인하라는 말과 함께 명령을 막는다
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { EMAIL_OFFLINE, emailDoneMessage, emailFailureMessage, type EmailDone } from './email-messages'

type Status = { readonly kind: 'done' | 'error'; readonly text: string }

export type EmailsPanelProps = {
  readonly workspaceId: string
  readonly emails: readonly { readonly id: string; readonly email: string; readonly isPrimary: boolean }[]
  readonly pending: readonly { readonly email: string; readonly expiresAt: string }[]
  readonly max: number
  readonly hasPassword: boolean
  readonly reauthRequired: boolean
}

const INPUT = 'min-w-0 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900'
const BUTTON =
  'rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900'
const PRIMARY_BUTTON = 'rounded-md bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900'
const ROW = 'flex flex-wrap items-center gap-2 border-b border-[rgb(240,239,237)] py-2 last:border-b-0 dark:border-[#2c2c2b]'
const BADGE = 'rounded px-1.5 py-0.5 text-[11px] font-medium'

export function EmailsPanel(props: EmailsPanelProps) {
  const { workspaceId, emails, pending, max, hasPassword, reauthRequired } = props
  const router = useRouter()
  const [address, setAddress] = useState('')
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [current, setCurrent] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  // 비밀번호가 없고 오래된 세션 — 서버가 어차피 거부한다(다시 로그인해야 한다). 누르기 전에 막고 까닭을 말한다.
  const blocked = reauthRequired && !hasPassword
  const withReauth = (body: Record<string, string>) => (reauthRequired && hasPassword ? { ...body, currentPassword: current } : body)

  const send = async (url: string, method: 'POST' | 'DELETE', body: Record<string, string>, done: (data: Record<string, unknown>) => EmailDone) => {
    setBusy(true)
    setStatus(null)
    let res: Response | null = null
    let data: Record<string, unknown> | null = null
    try {
      res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      data = await res.json().catch(() => null)
    } catch {
      res = null
    }
    setBusy(false)
    if (res === null || !res.ok) {
      setStatus({ kind: 'error', text: res === null ? EMAIL_OFFLINE : emailFailureMessage(data?.error) })
      return false
    }
    setStatus({ kind: 'done', text: emailDoneMessage(done(data ?? {})) })
    setConfirmRemove(null)
    router.refresh()
    return true
  }

  const base = `/api/workspaces/${workspaceId}/account/emails`
  const requestCode = async (email: string) => {
    const ok = await send(base, 'POST', withReauth({ email }), () => ({ kind: 'requested', email }))
    if (ok) setAddress('')
  }
  const verify = (email: string) =>
    send(`${base}/verify`, 'POST', { email, code: codes[email] ?? '' }, () => ({ kind: 'added', email }))
  const makePrimary = (id: string, email: string) =>
    send(`${base}/${id}/primary`, 'POST', withReauth({}), () => ({ kind: 'primary', email }))
  const remove = (id: string, email: string) =>
    send(`${base}/${id}`, 'DELETE', withReauth({}), (data) => ({
      kind: 'removed',
      email,
      revokedSessions: typeof data.revokedSessions === 'number' ? data.revokedSessions : 0,
    }))

  const full = emails.length >= max

  return (
    <section data-testid="emails-panel" data-count={emails.length} data-reauth={reauthRequired} className="mt-6 flex flex-col gap-3">
      <h2 className="text-sm font-medium">이메일 주소</h2>
      <p className="text-xs text-neutral-500">
        로그인 · 공유 · 초대에 쓰는 주소입니다. 어느 주소로 들어와도 같은 계정이고, 다른 사람에게는 대표 주소만 보입니다. 계정 알림은 대표
        주소로 갑니다. {max}개까지.
      </p>

      <ul data-testid="emails-list" className="flex flex-col">
        {emails.map((row) => (
          <li key={row.id} data-testid="email-row" data-email={row.email} data-primary={row.isPrimary} className={ROW}>
            <span className="min-w-0 flex-1 break-all text-sm">{row.email}</span>
            {row.isPrimary ? (
              <span data-testid="email-primary-badge" className={`${BADGE} bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300`}>
                대표
              </span>
            ) : confirmRemove === row.id ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-neutral-500">빼면 다른 기기에서 로그아웃됩니다.</span>
                <button type="button" data-testid="email-remove-confirm" disabled={busy || blocked} onClick={() => void remove(row.id, row.email)} className={`${BUTTON} text-red-600 dark:text-red-400`}>
                  빼기
                </button>
                <button type="button" data-testid="email-remove-cancel" onClick={() => setConfirmRemove(null)} className={BUTTON}>
                  취소
                </button>
              </span>
            ) : (
              <span className="flex gap-2">
                <button type="button" data-testid="email-make-primary" disabled={busy || blocked} onClick={() => void makePrimary(row.id, row.email)} className={BUTTON}>
                  대표로
                </button>
                <button type="button" data-testid="email-remove" disabled={busy || blocked} onClick={() => setConfirmRemove(row.id)} className={BUTTON}>
                  빼기
                </button>
              </span>
            )}
          </li>
        ))}
        {pending.map((row) => (
          <li key={`pending-${row.email}`} data-testid="email-pending" data-email={row.email} className={ROW}>
            <span className="min-w-0 flex-1 break-all text-sm text-neutral-500">{row.email}</span>
            <span className={`${BADGE} bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300`}>확인 대기</span>
            <form
              className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
              onSubmit={(e) => {
                e.preventDefault()
                if (!busy) void verify(row.email)
              }}
            >
              <input
                aria-label={`${row.email} 의 확인 코드`}
                data-testid="email-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="6자리 코드"
                value={codes[row.email] ?? ''}
                onChange={(e) => setCodes((all) => ({ ...all, [row.email]: e.target.value.replace(/\D/g, '') }))}
                className={`${INPUT} w-28`}
              />
              <button type="submit" data-testid="email-verify" disabled={busy || (codes[row.email] ?? '').length !== 6} className={BUTTON}>
                확인
              </button>
              <button type="button" data-testid="email-resend" disabled={busy || blocked || full} onClick={() => void requestCode(row.email)} className={BUTTON}>
                코드 다시 보내기
              </button>
            </form>
          </li>
        ))}
      </ul>

      {reauthRequired &&
        (hasPassword ? (
          <label className="flex max-w-sm flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400">
            지금 비밀번호 — 주소를 더하거나 바꾸려면 필요합니다(10분 안에 로그인한 세션이 아닙니다)
            <input
              type="password"
              autoComplete="current-password"
              data-testid="email-current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={INPUT}
            />
          </label>
        ) : (
          <p data-testid="email-reauth-note" className="text-xs text-neutral-500">
            보안을 위해 주소를 더하거나 바꾸는 일은 10분 안에 로그인한 세션에서만 할 수 있습니다. 로그아웃한 뒤 다시 로그인해 주세요.
          </p>
        ))}

      {full ? (
        <p data-testid="emails-full" className="text-xs text-neutral-500">
          주소가 {max}개입니다. 더하려면 하나를 빼세요.
        </p>
      ) : (
        <form
          data-testid="email-add-form"
          className="flex max-w-md flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy && address.trim() !== '') void requestCode(address.trim())
          }}
        >
          <input
            type="email"
            aria-label="더할 이메일 주소"
            data-testid="email-add-input"
            placeholder="다른 이메일 주소"
            autoComplete="email"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={`${INPUT} flex-1`}
          />
          <button type="submit" data-testid="email-add-submit" disabled={busy || blocked || address.trim() === ''} className={PRIMARY_BUTTON}>
            {busy ? '보내는 중…' : '확인 코드 보내기'}
          </button>
        </form>
      )}

      {status !== null && (
        <p
          role={status.kind === 'error' ? 'alert' : 'status'}
          data-testid="emails-status"
          className={`text-xs ${status.kind === 'error' ? 'text-red-600 dark:text-red-400' : 'text-neutral-500'}`}
        >
          {status.text}
        </p>
      )}
    </section>
  )
}
