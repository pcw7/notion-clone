/**
 * 초대 수락 화면 — F-14-10
 *
 * 로그인이 안 되어 있으면 로그인으로 보낸다. 초대받은 주소와 로그인한 계정이
 * 다르면 그 사실을 알려준다 — 계정을 바꿔 로그인해야 하기 때문이다.
 * (이건 계정 열거가 아니다. 이미 초대 링크를 가진 사람에게만 보인다.)
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { addAccountHref } from '@/lib/auth/account-set'
import { getCurrentUser } from '@/lib/auth/current-user'
import { previewInvite } from '@/lib/workspace/invite'
import { AcceptInviteButton } from './accept-button'
import { inviteSummary } from './invite-messages'

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const invite = await previewInvite(token)

  if (!invite) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-xl font-semibold">유효하지 않은 초대입니다</h1>
        <p className="text-sm text-neutral-500">
          링크가 만료되었거나 취소되었거나 이미 사용되었습니다. 초대한 사람에게 다시
          요청해주세요.
        </p>
        <Link href="/" className="text-sm underline underline-offset-4">
          홈으로
        </Link>
      </main>
    )
  }

  const user = await getCurrentUser()
  if (!user) {
    // 로그인 후 이 화면으로 돌아오게 한다.
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`)
  }

  const emailMatches = user.email !== null && user.email.toLowerCase() === invite.email.toLowerCase()

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-6">
      <div>
        <h1 className="text-xl font-semibold">
          <span className="font-bold">{invite.workspaceName}</span> 워크스페이스 초대
        </h1>
        <p className="mt-2 text-sm text-neutral-500" data-testid="invite-summary">
          {inviteSummary(invite.email, invite.role)}
        </p>
      </div>

      {emailMatches ? (
        <AcceptInviteButton token={token} role={invite.role} />
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium">다른 계정으로 로그인되어 있습니다</p>
          <p className="mt-1 text-neutral-600 dark:text-neutral-400">
            현재 <span className="font-mono">{user.email}</span> 로 로그인 중입니다. 이 초대는{' '}
            <span className="font-mono">{invite.email}</span> 앞으로 왔습니다.
          </p>
          {/* 다른 계정 더하기(8j-3 · F-14-09) — 지금 계정은 그대로 두고 초대받은 주소로 로그인한 뒤 이 초대로 돌아온다. */}
          <Link
            href={addAccountHref({ email: invite.email ?? undefined, next: `/invite/${token}` })}
            data-testid="invite-add-account"
            className="mt-3 inline-block text-sm underline underline-offset-4"
          >
            {invite.email} 로 로그인(지금 계정은 그대로)
          </Link>
        </div>
      )}
    </main>
  )
}
