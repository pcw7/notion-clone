import type { Metadata } from 'next'
import Link from '@/app/link'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/auth/current-user'
import { roleLabel } from '@/lib/settings/registry'
import { listWorkspacesForUser } from '@/lib/workspace/list'
import { CreateWorkspaceForm } from './create-workspace-form'
import { SCREEN_TITLES, fullTitle } from '@/lib/nav/screen-title'

// 화면 제목(10d-7b) — 루트 레이아웃과 같은 구간이라 틀이 닿지 않는다(전체 제목을 그대로). 스위처의 "모든 워크스페이스" 가 클라이언트
// 이동으로 닿으므로 이름이 있어야 앞 화면의 탭 제목이 남지 않는다
export const metadata: Metadata = { title: { absolute: fullTitle(SCREEN_TITLES.workspaces) } }

export default async function Home() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaces = await listWorkspacesForUser(user.userId)

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{user.name} 님</h1>
        <p className="mt-1 text-sm text-neutral-500">{user.email}</p>
      </div>

      {workspaces.length === 0 ? (
        <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="font-medium">첫 워크스페이스를 만드세요</h2>
          <p className="mt-1 text-sm text-neutral-500">
            모든 페이지는 워크스페이스 안에 있습니다. 워크스페이스끼리는 완전히 분리됩니다.
          </p>
          <CreateWorkspaceForm />
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-neutral-500">워크스페이스</h2>
          <ul className="flex flex-col gap-2">
            {workspaces.map((w) => (
              <li key={w.workspaceId}>
                <Link
                  href={`/w/${w.workspaceId}`}
                  className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
                >
                  <span className="font-medium">{w.name}</span>
                  <span className="text-xs text-neutral-500">{roleLabel(w.role)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-neutral-500">
              워크스페이스 추가로 만들기
            </summary>
            <CreateWorkspaceForm />
          </details>
        </section>
      )}

      <form action="/api/auth/logout" method="post" className="mt-4">
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
        >
          로그아웃
        </button>
      </form>
    </main>
  )
}
