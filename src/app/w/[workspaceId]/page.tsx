/**
 * 워크스페이스 홈 — **`SessionContext` 를 요구하는 첫 화면.**
 *
 * 여기부터는 `getCurrentUser()`(신원 조회)로는 부족하다.
 * `requirePageSession()` → `resolveSessionContext()` 가 0단계 게이트(SSO 강제)까지
 * 통과시킨 뒤에야 워크스페이스 안의 것을 보여준다 — 정본 불변식 A9.
 *
 * 멤버가 아니거나 워크스페이스가 없으면 **둘 다 404** 다 (F-02-17).
 * 403 을 주면 "그 워크스페이스는 존재한다"를 알려주는 셈이 된다.
 *
 * 관리 절(멤버 · 초대 · 게스트 · 그룹 · 정책 · 내보내기)은 설정 화면으로 옮겼다(8g-1 · 8g-2 · F-17-12) — 홈은 페이지로 들어가는 곳이다.
 */

import Link from 'next/link'

import { requirePageSession } from '@/lib/auth/page-session'
import { listChildPages } from '@/lib/block/page'
import { visiblePanels } from '@/lib/settings/panels'
import { workspaceNameOf } from '@/lib/workspace/list'
import { NewPageButton } from './new-page-button'
import { PageIconView } from './page-icon-view'

/** 제목 없는 페이지의 표시 문구. 저장된 값은 빈 배열이다. */
const UNTITLED = '제목 없음'

export default async function WorkspacePage({ params }: PageProps<'/w/[workspaceId]'>) {
  const { workspaceId } = await params

  // 진입 게이트는 page-session.ts 가 소유한다. 거부 코드 매핑
  // (멤버 아님 → 404) 을 화면마다 복사하면 한 곳만 틀려도 존재가 유출된다.
  const ctx = await requirePageSession(workspaceId)

  const [rootPages, workspaceName] = await Promise.all([listChildPages(ctx, null), workspaceNameOf(ctx)])

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="workspace-title">
            {workspaceName || '워크스페이스'}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            내 역할: <span className="font-medium">{ctx.role}</span> · 로그인 방식:{' '}
            {ctx.authMethod}
          </p>
        </div>
        <div className="flex gap-3 text-sm text-neutral-500">
          {/* 사람 · 정책 · 이름 · 내보내기는 설정 화면에 있다(8g-1 · 8g-2 · F-17-12). */}
          <Link href={`/w/${workspaceId}/settings`} data-testid="home-settings" className="underline underline-offset-4">
            설정
          </Link>
          <Link href="/" className="underline underline-offset-4">
            전체 목록
          </Link>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-500">
          최상위 페이지 {rootPages.length}개
        </h2>
        {rootPages.length > 0 ? (
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {rootPages.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/w/${workspaceId}/${p.id}`}
                  className="flex items-center gap-2 px-4 py-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <PageIconView icon={p.icon} fallback />
                  {p.plainTitle || UNTITLED}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-400">
            왼쪽 사이드바의 &ldquo;+ 새 페이지&rdquo;로 시작하세요.
          </p>
        )}
        <NewPageButton workspaceId={workspaceId} />
      </section>

      {/* 사람 절이 서는 사람에게만(게스트에게는 없다) — 판정은 패널의 것이다. */}
      {visiblePanels(ctx).some((panel) => panel.section === 'workspace.people') && (
        <p className="text-sm text-neutral-500">
          멤버 · 초대 · 그룹은{' '}
          <Link href={`/w/${workspaceId}/settings?s=workspace.people`} className="underline underline-offset-4">
            설정 → 사람
          </Link>
          에 있습니다.
        </p>
      )}

      <p className="mt-auto text-xs text-neutral-400">
        Phase 0 W1–W3 완료 — 인증 · 워크스페이스 · 초대 · 블록 모델. W4 진행 중 — 페이지 · 에디터.
      </p>
    </main>
  )
}
