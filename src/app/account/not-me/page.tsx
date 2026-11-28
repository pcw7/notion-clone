/**
 * "내가 아니에요" 화면 — 새 기기 알림 메일의 링크로 연다 (AC-3 · F-14-08)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ⑭ [AC-3] · 14-auth-accounts.md F-14-08 *"본인이 아니면 This was not me"*
 *
 * 로그인하지 않아도 된다 — 증명은 링크의 서명 토큰이다. **이 화면은 아무것도 바꾸지 않는다**(메일의 링크 미리보기 · 검사기가 열어도
 * 그대로) — 단추가 폼으로 `POST /api/auth/not-me` 를 보내 그 사람의 모든 세션을 폐기하고, 이 화면으로 돌아온다(`done=1`). 돌아온 화면은
 * 토큰이 정말 쓰였는지 다시 보고 "로그아웃했다"고 말한다(주소의 `done` 만으로 말하지 않는다). JS 없이 돈다.
 *
 * 끝나면 비밀번호를 바꾸라고 말한다 — 다시 로그인 → 설정 → 보안. 비밀번호를 쓰지 않으면 로그인 코드가 오는 메일함을 지키라고.
 */

import type { Metadata } from 'next'

import Link from '@/app/link'
import { previewDeviceReport } from '@/lib/auth/devices'
import { SCREEN_TITLES } from '@/lib/nav/screen-title'

// 화면 제목(10d-7a · F-12-13) — 루트의 틀이 `… · notion-clone` 을 붙인다
export const metadata: Metadata = { title: SCREEN_TITLES.notMe }

const MAIN = 'mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6'
const NOTE = 'text-sm text-neutral-600 dark:text-neutral-400'

const AFTER = (
  <>
    <p className={NOTE}>
      다시 로그인한 뒤 <b>설정 → 내 계정 → 보안</b>에서 비밀번호를 바꾸세요. 비밀번호를 쓰지 않는다면 로그인 코드가 오는 메일 계정의 보안을
      확인하세요(그 메일함을 가진 사람은 누구나 로그인 코드를 받을 수 있습니다).
    </p>
    <Link href="/login" data-testid="not-me-login" className="text-sm underline underline-offset-4">
      다시 로그인
    </Link>
  </>
)

export default async function NotMePage({ searchParams }: { searchParams: Promise<{ t?: string | string[]; done?: string | string[] }> }) {
  const { t, done } = await searchParams
  const token = typeof t === 'string' ? t : null
  const preview = await previewDeviceReport(token)

  if (!preview.ok && preview.reason === 'already_used') {
    return (
      <main data-testid="not-me" data-state={done === '1' ? 'done' : 'used'} className={MAIN}>
        <h1 className="text-xl font-semibold">{done === '1' ? '모든 기기에서 로그아웃했습니다' : '이미 처리한 링크입니다'}</h1>
        <p className={NOTE}>
          {done === '1'
            ? '이 계정으로 로그인해 있던 모든 기기가 로그아웃되었습니다. API 토큰은 그대로입니다 — 모르는 토큰이 있으면 설정에서 폐기하세요.'
            : '이 링크로 이미 모든 기기를 로그아웃시켰습니다. 링크는 한 번만 쓸 수 있습니다.'}
        </p>
        {AFTER}
      </main>
    )
  }

  if (!preview.ok) {
    return (
      <main data-testid="not-me" data-state={preview.reason} className={MAIN}>
        <h1 className="text-xl font-semibold">{preview.reason === 'expired' ? '링크가 만료되었습니다' : '유효하지 않은 링크입니다'}</h1>
        <p className={NOTE}>
          알림의 링크는 7일 동안만 쓸 수 있습니다. 모르는 로그인이 걱정되면 로그인한 뒤 설정 → 내 계정 → 보안에서 &ldquo;다른 모든 기기에서
          로그아웃&rdquo;을 누르고 비밀번호를 바꾸세요.
        </p>
        <Link href="/login" className="text-sm underline underline-offset-4">
          로그인
        </Link>
      </main>
    )
  }

  return (
    <main data-testid="not-me" data-state="ready" className={MAIN}>
      <h1 className="text-xl font-semibold">이 로그인이 본인이 아니었나요?</h1>
      <p className={NOTE} data-testid="not-me-device">
        {preview.value.device} · {preview.value.signedInAt.slice(0, 16).replace('T', ' ')} UTC 에 로그인했습니다.
      </p>
      <p className={NOTE}>
        아래 단추를 누르면 이 계정으로 로그인해 있는 <b>모든 기기</b>(지금 이 기기도)가 로그아웃됩니다. 그 뒤 다시 로그인해 비밀번호를
        바꾸세요.
      </p>
      <form method="post" action="/api/auth/not-me">
        <input type="hidden" name="t" value={token ?? ''} />
        <button
          type="submit"
          data-testid="not-me-submit"
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
        >
          모든 기기에서 로그아웃
        </button>
      </form>
      <p className="text-xs text-neutral-500">본인이 로그인한 것이라면 이 화면을 닫으면 됩니다.</p>
    </main>
  )
}
