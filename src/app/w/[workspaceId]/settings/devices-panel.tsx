'use client'

/**
 * 로그인한 기기 패널 — 설정 → 내 계정 → 보안 (AC-3 · F-14-08)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ⑭ [AC-3] · 14-auth-accounts.md F-14-08 *"표(기기 아이콘 / 브라우저·OS / 대략 위치 /
 *       마지막 활동 상대시간 / Log out). 상단에 Log out of all devices 위험 버튼"*
 *
 * 목록은 서버가 준다(`listDevices` — 이 사람의 살아 있는 세션 · 이 세션이 맨 위) — 이 화면이 판정하지 않는다. 명령마다 서버가 다시 그린다
 * (`router.refresh`).
 *
 *   · 기기마다 한 줄 — 아이콘(폰 · 태블릿 · 컴퓨터) · "Chrome · Windows" · 대략 위치(가린 IP) · 로그인 · 마지막 활동(상대 시각)
 *   · 이 세션은 "이 기기" 표지 · 끊는 단추가 없다(화면의 로그아웃을 쓴다) · 30일 안에 새 기기 알림을 보낸 세션은 "새 기기" 표지
 *   · 다른 기기마다 "로그아웃" · 다른 기기가 있으면 "다른 모든 기기에서 로그아웃"(한 번 더 묻는다 — API 토큰은 그대로)
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Monitor, MonitorSmartphone, Smartphone, Tablet } from 'lucide-react'

import { DEVICE_OFFLINE, deviceDoneMessage, deviceFailureMessage, relativeTime, type DeviceDone } from './device-messages'

type Status = { readonly kind: 'done' | 'error'; readonly text: string }

export type DevicesPanelProps = {
  readonly workspaceId: string
  readonly devices: readonly {
    readonly id: string
    readonly label: string
    readonly form: 'phone' | 'tablet' | 'computer' | 'unknown'
    readonly place: string | null
    readonly signedInAt: string
    readonly lastActiveAt: string
    readonly current: boolean
    readonly newDevice: boolean
  }[]
  /** 서버의 지금(ISO) — 상대 시각을 이것으로 센다(서버 렌더와 같은 글). */
  readonly now: string
}

const BUTTON =
  'shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900'
const DANGER_BUTTON =
  'rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950'
const ROW = 'flex items-center gap-3 border-b border-[rgb(240,239,237)] py-2 last:border-b-0 dark:border-[#2c2c2b]'
const BADGE = 'rounded px-1.5 py-0.5 text-[11px] font-medium'

const ICONS = { phone: Smartphone, tablet: Tablet, computer: Monitor, unknown: MonitorSmartphone } as const

export function DevicesPanel({ workspaceId, devices, now }: DevicesPanelProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirmOthers, setConfirmOthers] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  const base = `/api/workspaces/${workspaceId}/account/devices`
  const send = async (url: string, method: 'POST' | 'DELETE', done: (data: Record<string, unknown>) => DeviceDone) => {
    setBusy(true)
    setStatus(null)
    let res: Response | null = null
    let data: Record<string, unknown> | null = null
    try {
      res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: '{}' })
      data = await res.json().catch(() => null)
    } catch {
      res = null
    }
    setBusy(false)
    setConfirmOthers(false)
    if (res === null) {
      setStatus({ kind: 'error', text: DEVICE_OFFLINE })
      return
    }
    if (!res.ok) {
      setStatus({ kind: 'error', text: deviceFailureMessage(data?.error) })
      // 이미 끝난 세션이면 목록이 낡았다 — 다시 그린다
      if (data?.error === 'not_found') router.refresh()
      return
    }
    setStatus({ kind: 'done', text: deviceDoneMessage(done(data ?? {})) })
    router.refresh()
  }

  const others = devices.filter((d) => !d.current).length

  return (
    <section data-testid="devices-panel" data-count={devices.length} className="mt-6 flex min-w-0 flex-col gap-3">
      <h2 className="text-sm font-medium">로그인한 기기</h2>
      <p className="text-xs text-neutral-500">
        이 계정으로 로그인해 있는 기기입니다. 모르는 기기가 있으면 로그아웃시키고 비밀번호를 바꾸세요. 위치는 IP 로만 짐작합니다. API 토큰은
        여기서 끊기지 않습니다.
      </p>

      <ul data-testid="devices-list" className="flex min-w-0 flex-col">
        {devices.map((device) => {
          const Icon = ICONS[device.form]
          return (
            <li
              key={device.id}
              data-testid="device-row"
              data-session-id={device.id}
              data-current={device.current}
              data-new={device.newDevice}
              className={ROW}
            >
              <Icon aria-hidden className="size-5 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span data-testid="device-label" className="break-words">
                    {device.label}
                  </span>
                  {device.current && (
                    <span data-testid="device-current-badge" className={`${BADGE} bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300`}>
                      이 기기
                    </span>
                  )}
                  {device.newDevice && (
                    <span data-testid="device-new-badge" className={`${BADGE} bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300`}>
                      새 기기
                    </span>
                  )}
                </div>
                <div data-testid="device-meta" className="break-words text-xs text-neutral-500">
                  {device.place ?? '위치 알 수 없음'} · 로그인 {relativeTime(device.signedInAt, now)} · 마지막 활동{' '}
                  {device.current ? '지금' : relativeTime(device.lastActiveAt, now)}
                </div>
              </div>
              {!device.current && (
                <button
                  type="button"
                  data-testid="device-sign-out"
                  aria-label={`${device.label} 로그아웃`}
                  disabled={busy}
                  onClick={() => void send(`${base}/${device.id}`, 'DELETE', () => ({ kind: 'one', label: device.label }))}
                  className={BUTTON}
                >
                  로그아웃
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {others > 0 &&
        (confirmOthers ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-600 dark:text-neutral-400">
              이 기기만 남고 다른 기기 {others}곳이 로그아웃됩니다.
            </span>
            <button
              type="button"
              data-testid="devices-sign-out-others-confirm"
              disabled={busy}
              onClick={() => void send(`${base}/sign-out-others`, 'POST', (data) => ({
                kind: 'others',
                revokedSessions: typeof data.revokedSessions === 'number' ? data.revokedSessions : 0,
              }))}
              className={DANGER_BUTTON}
            >
              로그아웃
            </button>
            <button type="button" data-testid="devices-sign-out-others-cancel" onClick={() => setConfirmOthers(false)} className={BUTTON}>
              취소
            </button>
          </div>
        ) : (
          <div>
            <button type="button" data-testid="devices-sign-out-others" disabled={busy} onClick={() => setConfirmOthers(true)} className={DANGER_BUTTON}>
              다른 모든 기기에서 로그아웃
            </button>
          </div>
        ))}

      {status !== null && (
        <p
          role={status.kind === 'error' ? 'alert' : 'status'}
          data-testid="devices-status"
          className={`text-xs ${status.kind === 'error' ? 'text-red-600 dark:text-red-400' : 'text-neutral-500'}`}
        >
          {status.text}
        </p>
      )}
    </section>
  )
}
