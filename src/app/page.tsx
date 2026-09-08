import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/auth/current-user'

export default async function Home() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {user.name} 님, 로그인되었습니다
        </h1>
        <p className="mt-2 text-sm text-neutral-500">{user.email}</p>
      </div>

      <div className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        {user.workspaceCount === 0 ? (
          <>
            <p className="font-medium">아직 워크스페이스가 없습니다.</p>
            <p className="mt-1 text-neutral-500">
              신규 계정은 워크스페이스 0개 상태로 존재할 수 있습니다(F-14-01). 워크스페이스
              생성과 초대 수락은 다음 단계(F-14-10)에서 붙습니다.
            </p>
          </>
        ) : (
          <p>참여 중인 워크스페이스 {user.workspaceCount}개</p>
        )}
      </div>

      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
        >
          로그아웃
        </button>
      </form>

      <p className="text-xs text-neutral-400">
        Phase 0 W1–W2 완료. 진행 상황은{' '}
        <Link href="https://github.com/pcw7/notion-clone" className="underline underline-offset-4">
          저장소
        </Link>
        참조.
      </p>
    </main>
  )
}
