'use client'

/**
 * 2단계 인증 패널 — 설정 → 내 계정 → 보안 (잔여 묶음 8i-2b · F-14-05)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 2단계 인증 ① ~ ⑥ · 14-auth-accounts.md F-14-05 *"QR + 수동 입력용 base32 시크릿 병기 … 백업
 *       코드는 복사·다운로드·인쇄 3버튼 + '저장했음' 체크박스 강제"*
 *
 * 상태(켜졌는가 · 수단 · 남은 백업 코드 · 비밀번호가 있는가)는 서버가 준다(`mfaStatus`). 이 화면이 판정하지 않는다.
 *
 *   · 켜기 — 이름 → QR(`uqr` 로 그린 SVG — 의존성 없음 · MIT)과 base32 비밀값 → 앱의 코드로 확정. 비밀값은 **이 응답에서 한 번만** 온다
 *   · 처음 켜면 백업 코드 6개 — 복사 · 내려받기 · "안전한 곳에 저장했습니다"를 고르기 전에는 닫히지 않는다(다시 보는 길이 없다)
 *   · 켠 뒤 — 수단 목록 · 지우기(지금 코드로) · 앱 더하기(둘까지) · 백업 코드 새로 받기(지금 코드로)
 *
 * QR 은 밝은 바탕에 검은 점으로 그린다 — 어두운 테마에서도 인증 앱의 카메라가 읽게.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { renderSVG } from 'uqr'

import { MFA_OFFLINE, backupCodesFile, groupSecret, mfaFailureMessage } from './mfa-messages'

type Method = { readonly id: string; readonly label: string; readonly createdAt: string; readonly lastUsedAt: string | null }
type Enrollment = { readonly methodId: string; readonly secret: string; readonly uri: string }
type Mode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'label' }
  | { readonly kind: 'scan'; readonly enrollment: Enrollment }
  | { readonly kind: 'codes'; readonly codes: readonly string[] }
  | { readonly kind: 'remove'; readonly methodId: string }
  | { readonly kind: 'regenerate' }
type Status = { readonly kind: 'saved' | 'error'; readonly text: string }

const INPUT = 'w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900'
const BUTTON = 'rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900'
const PRIMARY = 'rounded-md bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900'

const dateOf = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })

export function MfaPanel(props: {
  workspaceId: string
  enabled: boolean
  methods: readonly Method[]
  backupCodesLeft: number
  hasPassword: boolean
  maxMethods: number
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [label, setLabel] = useState('')
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const base = `/api/workspaces/${props.workspaceId}/account/mfa`

  const go = (next: Mode) => {
    setMode(next)
    setCode('')
    setSaved(false)
    setStatus(null)
  }

  /** 요청 하나 — 실패면 이유를 말하고 null. */
  const call = async (url: string, method: 'POST' | 'DELETE', body: Record<string, unknown>) => {
    setBusy(true)
    setStatus(null)
    try {
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) {
        setStatus({ kind: 'error', text: mfaFailureMessage(data?.error) })
        return null
      }
      return data ?? {}
    } catch {
      setStatus({ kind: 'error', text: MFA_OFFLINE })
      return null
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    const data = await call(base, 'POST', { label })
    if (data === null) return
    go({ kind: 'scan', enrollment: { methodId: String(data.methodId), secret: String(data.secret), uri: String(data.uri) } })
  }

  const confirm = async (enrollment: Enrollment) => {
    const data = await call(`${base}/${enrollment.methodId}/confirm`, 'POST', { code })
    if (data === null) return
    const codes = Array.isArray(data.backupCodes) ? (data.backupCodes as string[]) : null
    if (codes !== null) {
      go({ kind: 'codes', codes })
      return
    }
    go({ kind: 'idle' })
    setStatus({ kind: 'saved', text: '인증 앱을 더했습니다.' })
    router.refresh()
  }

  const remove = async (methodId: string) => {
    const data = await call(`${base}/${methodId}`, 'DELETE', { code })
    if (data === null) return
    go({ kind: 'idle' })
    setStatus({ kind: 'saved', text: data.disabled === true ? '2단계 인증을 껐습니다. 백업 코드도 지웠습니다.' : '인증 앱을 지웠습니다.' })
    router.refresh()
  }

  const regenerate = async () => {
    const data = await call(`${base}/backup-codes`, 'POST', { code })
    if (data === null) return
    go({ kind: 'codes', codes: Array.isArray(data.backupCodes) ? (data.backupCodes as string[]) : [] })
  }

  const closeCodes = () => {
    go({ kind: 'idle' })
    setStatus({ kind: 'saved', text: '백업 코드를 저장했습니다. 인증 앱을 쓸 수 없을 때 하나씩 한 번 쓸 수 있습니다.' })
    router.refresh()
  }

  /** 지금 코드 한 칸 — 지우기 · 새로 받기 · 확정이 같이 쓴다. */
  const codeField = (testId: string) => (
    <label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400">
      인증 앱의 지금 코드 또는 백업 코드
      <input
        data-testid={testId}
        autoComplete="one-time-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className={INPUT}
      />
    </label>
  )

  return (
    <section data-testid="mfa-panel" data-enabled={props.enabled} className="mt-8 flex flex-col gap-3">
      <h2 className="text-sm font-medium">2단계 인증</h2>
      <p className="text-xs text-neutral-500" data-testid="mfa-state">
        {props.enabled
          ? '켜져 있습니다. 로그인할 때마다 인증 앱의 코드(또는 백업 코드)를 한 번 더 묻습니다.'
          : props.hasPassword
            ? '꺼져 있습니다. 켜면 로그인할 때마다 인증 앱의 코드를 한 번 더 묻습니다.'
            : '2단계 인증을 켜려면 먼저 비밀번호를 정하세요.'}
      </p>

      {props.enabled && mode.kind !== 'codes' && (
        <ul data-testid="mfa-methods" className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200 text-sm dark:divide-neutral-900 dark:border-neutral-800">
          {props.methods.map((m) => (
            <li key={m.id} data-testid="mfa-method" data-method-id={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">
                {m.label}
                <span className="ml-2 text-xs text-neutral-400">
                  {dateOf(m.createdAt)} 더함{m.lastUsedAt !== null && ` · 마지막 사용 ${dateOf(m.lastUsedAt)}`}
                </span>
              </span>
              <button type="button" data-testid="mfa-remove-open" onClick={() => go({ kind: 'remove', methodId: m.id })} className={BUTTON}>
                지우기
              </button>
            </li>
          ))}
        </ul>
      )}
      {props.enabled && mode.kind !== 'codes' && (
        <p className="text-xs text-neutral-500" data-testid="mfa-backup-left">
          남은 백업 코드 {props.backupCodesLeft}개
        </p>
      )}

      {mode.kind === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {props.hasPassword && props.methods.length < props.maxMethods && (
            <button type="button" data-testid="mfa-enroll-open" onClick={() => go({ kind: 'label' })} className={BUTTON}>
              {props.enabled ? '인증 앱 더하기' : '2단계 인증 켜기'}
            </button>
          )}
          {props.enabled && (
            <button type="button" data-testid="mfa-regenerate-open" onClick={() => go({ kind: 'regenerate' })} className={BUTTON}>
              백업 코드 새로 받기
            </button>
          )}
        </div>
      )}

      {mode.kind === 'label' && (
        <form
          data-testid="mfa-label-form"
          className="flex max-w-sm flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy) void start()
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400">
            인증 앱의 이름(나중에 구분하려고)
            <input data-testid="mfa-label" value={label} placeholder="인증 앱" onChange={(e) => setLabel(e.target.value)} className={INPUT} />
          </label>
          <div className="flex gap-2">
            <button type="submit" data-testid="mfa-start" disabled={busy} className={PRIMARY}>
              다음
            </button>
            <button type="button" onClick={() => go({ kind: 'idle' })} className={BUTTON}>
              취소
            </button>
          </div>
        </form>
      )}

      {mode.kind === 'scan' && (
        <form
          data-testid="mfa-scan-form"
          className="flex max-w-sm flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy) void confirm(mode.enrollment)
          }}
        >
          <p className="text-xs text-neutral-500">인증 앱으로 QR 코드를 찍거나, 카메라를 쓸 수 없으면 아래 비밀값을 직접 넣으세요.</p>
          <div
            data-testid="mfa-qr"
            role="img"
            aria-label="인증 앱에 넣을 QR 코드"
            className="h-44 w-44 rounded bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: renderSVG(mode.enrollment.uri, { whiteColor: '#ffffff', blackColor: '#000000' }) }}
          />
          <code data-testid="mfa-secret" className="select-all break-all rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-900">
            {groupSecret(mode.enrollment.secret)}
          </code>
          {codeField('mfa-code')}
          <div className="flex gap-2">
            <button type="submit" data-testid="mfa-confirm" disabled={busy || code.trim().length === 0} className={PRIMARY}>
              확인
            </button>
            <button type="button" onClick={() => go({ kind: 'idle' })} className={BUTTON}>
              취소
            </button>
          </div>
        </form>
      )}

      {mode.kind === 'codes' && (
        <div data-testid="mfa-codes" className="flex max-w-sm flex-col gap-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            백업 코드입니다 — <strong>지금 한 번만 보입니다.</strong> 인증 앱을 쓸 수 없을 때 하나씩 한 번 쓸 수 있습니다.
          </p>
          <ul data-testid="mfa-backup-codes" className="grid grid-cols-2 gap-1 font-mono text-sm">
            {mode.codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" data-testid="mfa-codes-copy" onClick={() => void navigator.clipboard?.writeText(mode.codes.join('\n'))} className={BUTTON}>
              복사
            </button>
            <a
              data-testid="mfa-codes-download"
              href={`data:text/plain;charset=utf-8,${encodeURIComponent(backupCodesFile(mode.codes))}`}
              download="notion-clone-backup-codes.txt"
              className={BUTTON}
            >
              내려받기
            </a>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" data-testid="mfa-codes-saved" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            안전한 곳에 저장했습니다
          </label>
          <button type="button" data-testid="mfa-codes-close" disabled={!saved} onClick={closeCodes} className={PRIMARY}>
            닫기
          </button>
        </div>
      )}

      {(mode.kind === 'remove' || mode.kind === 'regenerate') && (
        <form
          data-testid={mode.kind === 'remove' ? 'mfa-remove-form' : 'mfa-regenerate-form'}
          className="flex max-w-sm flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (busy) return
            if (mode.kind === 'remove') void remove(mode.methodId)
            else void regenerate()
          }}
        >
          <p className="text-xs text-neutral-500">
            {mode.kind === 'remove'
              ? props.methods.length === 1
                ? '마지막 인증 앱입니다 — 지우면 2단계 인증이 꺼지고 백업 코드도 사라집니다.'
                : '이 인증 앱을 지웁니다.'
              : '새로 받으면 지금의 백업 코드는 더 쓸 수 없습니다.'}
          </p>
          {codeField('mfa-confirm-code')}
          <div className="flex gap-2">
            <button type="submit" data-testid="mfa-confirm-action" disabled={busy || code.trim().length === 0} className={PRIMARY}>
              {mode.kind === 'remove' ? '지우기' : '새로 받기'}
            </button>
            <button type="button" onClick={() => go({ kind: 'idle' })} className={BUTTON}>
              취소
            </button>
          </div>
        </form>
      )}

      {status !== null && (
        <p role={status.kind === 'error' ? 'alert' : 'status'} data-testid="mfa-status" className={`text-xs ${status.kind === 'error' ? 'text-red-600' : 'text-neutral-500'}`}>
          {status.text}
        </p>
      )}
    </section>
  )
}
