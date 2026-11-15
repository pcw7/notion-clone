'use client'

/**
 * 로그아웃 전에 이 기기의 오프라인 사본 · 남은 편집을 지운다 (OF-3 · F-12-04 · 정본 §3.7 [보강 OF-1] ④ "로그아웃하면 그 사람의 내려받은 것을 모두 지운다")
 *
 * 로그아웃 단추(스위처 · 처음 화면)가 보내기 전에 부른다. 일은 지연 로드한 모듈과 그 워커가 한다(`lib/offline/offline-sync-client.ts`) —
 * 첫 JS 에는 이 갈래와 물음뿐이다.
 *
 *   - 지금 계정의 남은 편집은 **먼저 보내 본다**(연결돼 있을 때 · 시간 상한). 다른 계정의 것은 보내지 않는다(이 탭의 세션이 그 사람의 것이 아니다)
 *   - 그래도 남으면 **화면 안에서 묻는다** — "보내지 못한 편집이 사라집니다"(`window.confirm` 이 아니다). 취소하면 아무것도 지우지 않는다
 *   - 남은 것이 없거나 확인하면 그 사람(들)의 사본과 보존본을 모두 지우고 로그아웃한다. 모듈을 받지 못하면 로그아웃은 막지 않는다
 */

import { useState, type ReactNode } from 'react'

type OfflineSync = typeof import('@/lib/offline/offline-sync-client')

export type LogoutGuardTarget = {
  /** 로그아웃할 사람들 — 지금 계정 · 다른 계정 하나 · 모두(이 브라우저에 함께 로그인한 계정들). */
  readonly users: readonly string[]
  /** 남은 편집을 먼저 보내 볼 지금 계정(이 탭의 세션) — 없으면(다른 계정만 로그아웃 · 협업 주소를 모른다) null. */
  readonly flushAs: { readonly userId: string; readonly collabUrl: string } | null
}

export type LogoutGuard = {
  /** 확인하고(남으면 묻고) 지운 뒤 `proceed` 를 부른다. */
  guard(target: LogoutGuardTarget, proceed: () => void): void
  /** 확인하는 중 — 단추를 막는다. */
  readonly checking: boolean
  /** 남은 편집이 있을 때의 물음 — 단추 옆에 그린다. */
  readonly prompt: ReactNode
}

export function useLogoutGuard(): LogoutGuard {
  const [checking, setChecking] = useState(false)
  const [ask, setAsk] = useState<{ readonly message: string; confirm(): void } | null>(null)

  const guard = (target: LogoutGuardTarget, proceed: () => void): void => {
    if (checking) return
    setChecking(true)
    setAsk(null)
    void (async () => {
      let sync: OfflineSync | null = null
      let warning: string | null = null
      try {
        sync = await import('@/lib/offline/offline-sync-client')
        warning = await sync.prepareOfflineLogout(target.users, target.flushAs)
      } catch {
        // 확인하지 못했다 — 로그아웃은 막지 않는다(지우기는 아래에서 해 본다)
      }
      const leave = async (): Promise<void> => {
        try {
          await sync?.discardOfflineData(target.users)
        } catch {
          // 지우지 못해도 로그아웃은 한다
        }
        proceed()
        setChecking(false)
      }
      if (warning === null) return leave()
      setChecking(false)
      setAsk({
        message: warning,
        confirm: () => {
          setAsk(null)
          setChecking(true)
          void leave()
        },
      })
    })()
  }

  const prompt =
    ask === null ? null : (
      <div
        role="alert"
        data-testid="logout-unsent-warning"
        className="mx-1 my-1 flex flex-col gap-1.5 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
      >
        <p>{ask.message}</p>
        <div className="flex justify-end gap-2">
          <button type="button" data-testid="logout-unsent-cancel" onClick={() => setAsk(null)} className="rounded px-1.5 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900">
            취소
          </button>
          <button
            type="button"
            data-testid="logout-unsent-confirm"
            onClick={ask.confirm}
            className="rounded px-1.5 py-0.5 font-medium text-red-700 hover:bg-amber-100 dark:text-red-400 dark:hover:bg-amber-900"
          >
            그래도 로그아웃
          </button>
        </div>
      </div>
    )

  return { guard, checking, prompt }
}

/** 처음 화면(`/`)의 로그아웃 — 지금 계정만(폼 그대로 · 확인한 뒤 보낸다). */
export function LogoutButton({ userId, collabUrl }: { userId: string; collabUrl: string }) {
  const { guard, checking, prompt } = useLogoutGuard()
  return (
    <form
      action="/api/auth/logout"
      method="post"
      className="mt-4 flex flex-col items-start gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const form = event.currentTarget
        guard({ users: [userId], flushAs: { userId, collabUrl } }, () => form.submit())
      }}
    >
      <button type="submit" disabled={checking} data-testid="home-logout" className="rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-neutral-700">
        로그아웃
      </button>
      {prompt}
    </form>
  )
}
