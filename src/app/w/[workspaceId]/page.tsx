/**
 * 워크스페이스 홈 — **`SessionContext` 를 요구하는 첫 화면.**
 *
 * 여기부터는 `getCurrentUser()`(신원 조회)로는 부족하다.
 * `resolveSessionContext()` 가 0단계 게이트(SSO 강제)까지 통과시킨 뒤에야
 * 워크스페이스 안의 것을 보여준다 — 정본 불변식 A9.
 *
 * 멤버가 아니거나 워크스페이스가 없으면 **둘 다 404** 다 (F-02-17).
 * 403 을 주면 "그 워크스페이스는 존재한다"를 알려주는 셈이 된다.
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { asWorkspaceId } from '@/lib/ids'
import { resolveSessionContext } from '@/lib/auth/session-context'
import { readSessionToken } from '@/lib/auth/session-cookie'
import { listMembers, listPendingInvites } from '@/lib/workspace/list'
import { InviteForm } from './invite-form'

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId: raw } = await params

  let workspaceId
  try {
    workspaceId = asWorkspaceId(raw)
  } catch {
    notFound()
  }

  const token = await readSessionToken()
  const session = await resolveSessionContext(token, workspaceId)

  if (!session.ok) {
    if (session.reason === 'no_session' || session.reason === 'expired' || session.reason === 'revoked') {
      redirect('/login')
    }
    // not_a_member / member_inactive / sso_required — 존재 여부를 노출하지 않는다
    notFound()
  }

  const ctx = session.context
  const canInvite = ctx.role === 'owner' || ctx.role === 'membership_admin'

  const [members, invites] = await Promise.all([
    listMembers(ctx.workspaceId),
    canInvite ? listPendingInvites(ctx.workspaceId) : Promise.resolve([]),
  ])

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">워크스페이스</h1>
          <p className="mt-1 text-sm text-neutral-500">
            내 역할: <span className="font-medium">{ctx.role}</span> · 로그인 방식:{' '}
            {ctx.authMethod}
          </p>
        </div>
        <Link href="/" className="text-sm text-neutral-500 underline underline-offset-4">
          전체 목록
        </Link>
      </header>

      <section>
        <h2 className="text-sm font-medium text-neutral-500">멤버 {members.length}명</h2>
        <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs text-neutral-500">{m.email}</p>
              </div>
              <span className="text-xs text-neutral-500">
                {m.role}
                {m.status !== 'active' && ` · ${m.status}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {canInvite && (
        <section>
          <h2 className="text-sm font-medium text-neutral-500">멤버 초대</h2>
          <InviteForm workspaceId={ctx.workspaceId} />

          {invites.length > 0 && (
            <>
              <h3 className="mt-6 text-xs font-medium text-neutral-500">
                대기 중인 초대 {invites.length}건
              </h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {invites.map((i) => (
                  <li key={i.inviteId} className="text-neutral-500">
                    {i.email} — {i.role}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <p className="mt-auto text-xs text-neutral-400">
        Phase 0 W1 완료 — 인증 · 워크스페이스 · 초대. 다음은 블록 모델과 에디터(W3–4).
      </p>
    </main>
  )
}
