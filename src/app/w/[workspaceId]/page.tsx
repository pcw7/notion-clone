/**
 * 워크스페이스 홈 — **`SessionContext` 를 요구하는 첫 화면.**
 *
 * 여기부터는 `getCurrentUser()`(신원 조회)로는 부족하다.
 * `requirePageSession()` → `resolveSessionContext()` 가 0단계 게이트(SSO 강제)까지
 * 통과시킨 뒤에야 워크스페이스 안의 것을 보여준다 — 정본 불변식 A9.
 *
 * 멤버가 아니거나 워크스페이스가 없으면 **둘 다 404** 다 (F-02-17).
 * 403 을 주면 "그 워크스페이스는 존재한다"를 알려주는 셈이 된다.
 */

import Link from 'next/link'

import { requirePageSession } from '@/lib/auth/page-session'
import { listChildPages } from '@/lib/block/page'
import { canExportWorkspace } from '@/lib/export/download'
import { canManageGroups, canSeeGroups, listGroups } from '@/lib/workspace/group'
import { listMembers, listPendingInvites } from '@/lib/workspace/list'
import { ExportButton } from './export-button'
import { GroupPanel } from './group-panel'
import { InviteForm } from './invite-form'
import { NewPageButton } from './new-page-button'

/** 제목 없는 페이지의 표시 문구. 저장된 값은 빈 배열이다. */
const UNTITLED = '제목 없음'

export default async function WorkspacePage({ params }: PageProps<'/w/[workspaceId]'>) {
  const { workspaceId } = await params

  // 진입 게이트는 page-session.ts 가 소유한다. 거부 코드 매핑
  // (멤버 아님 → 404) 을 화면마다 복사하면 한 곳만 틀려도 존재가 유출된다.
  const ctx = await requirePageSession(workspaceId)
  const canInvite = ctx.role === 'owner' || ctx.role === 'membership_admin'
  // 표시 전용 — 판정은 내보내기 라우트가 `prepareExport` 로 다시 한다.
  const canExport = canExportWorkspace(ctx)

  const [rootPages, members, invites, groups] = await Promise.all([
    listChildPages(ctx, null),
    listMembers(ctx.workspaceId),
    canInvite ? listPendingInvites(ctx.workspaceId) : Promise.resolve([]),
    // 게스트는 그룹을 보지 않는다(F-06-09) — 절 자체를 그리지 않는다. 판정은 `listGroups` 가 다시 한다.
    canSeeGroups(ctx.role) ? listGroups(ctx) : Promise.resolve(null),
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
                  className="block px-4 py-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
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

      {groups?.ok && (
        <section>
          <h2 className="text-sm font-medium text-neutral-500">그룹 {groups.value.length}개</h2>
          <p className="mt-1 text-xs text-neutral-500">
            사람을 묶어 두면 페이지 공유에서 한 번에 줄 수 있습니다. 나중에 그룹에 들어온 사람도 곧바로 봅니다.
          </p>
          <GroupPanel
            workspaceId={ctx.workspaceId}
            canManage={canManageGroups(ctx.role)}
            initialGroups={[...groups.value]}
            members={members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, status: m.status }))}
          />
        </section>
      )}

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

      {canExport && (
        <section>
          <h2 className="text-sm font-medium text-neutral-500">데이터 내보내기</h2>
          <p className="mt-1 text-xs text-neutral-500">
            워크스페이스 전체를 Markdown · CSV 로 내려받습니다. 소유자만 할 수 있고, 소유자도 볼 수 있는
            페이지만 들어갑니다. 멤버는 페이지 · 데이터베이스 화면에서 각각 내보냅니다.
          </p>
          <div className="mt-3">
            <ExportButton workspaceId={ctx.workspaceId} label="워크스페이스 내보내기" align="left" />
          </div>
        </section>
      )}

      <p className="mt-auto text-xs text-neutral-400">
        Phase 0 W1–W3 완료 — 인증 · 워크스페이스 · 초대 · 블록 모델. W4 진행 중 — 페이지 · 에디터.
      </p>
    </main>
  )
}
