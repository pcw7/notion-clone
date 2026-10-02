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
import { canManageGuests, listGuests } from '@/lib/workspace/guest'
import { canInvite as canInviteRole } from '@/lib/workspace/invite'
import { canListMembers, listMembers, listPendingInvites } from '@/lib/workspace/list'
import { canManageSecurityPolicy, getSecurityPolicy } from '@/lib/workspace/security-policy'
import { ExportButton } from './export-button'
import { GuestPanel } from './guest-panel'
import { GroupPanel } from './group-panel'
import { InviteForm } from './invite-form'
import { NewPageButton } from './new-page-button'
import { PendingInviteList } from './pending-invite-list'
import { SecurityPolicyForm } from './security-policy-form'
import { PageIconView } from './page-icon-view'

/** 제목 없는 페이지의 표시 문구. 저장된 값은 빈 배열이다. */
const UNTITLED = '제목 없음'

export default async function WorkspacePage({ params }: PageProps<'/w/[workspaceId]'>) {
  const { workspaceId } = await params

  // 진입 게이트는 page-session.ts 가 소유한다. 거부 코드 매핑
  // (멤버 아님 → 404) 을 화면마다 복사하면 한 곳만 틀려도 존재가 유출된다.
  const ctx = await requirePageSession(workspaceId)
  // 초대를 보내고 · 대기 중인 초대를 보고 · 취소하는 역할(7g-3) — 취소 판정은 라우트가 같은 함수로 다시 한다.
  const canInvite = canInviteRole(ctx.role)
  // 표시 전용 — 판정은 내보내기 라우트가 `prepareExport` 로 다시 한다.
  const canExport = canExportWorkspace(ctx)

  const [rootPages, members, invites, groups, guests, policy] = await Promise.all([
    listChildPages(ctx, null),
    // 게스트는 멤버 목록을 받지 않는다(7d-2 · F-06-09) — 절 자체를 그리지 않는다.
    canListMembers(ctx.role) ? listMembers(ctx.workspaceId) : Promise.resolve(null),
    canInvite ? listPendingInvites(ctx.workspaceId) : Promise.resolve([]),
    // 게스트는 그룹을 보지 않는다(F-06-09) — 절 자체를 그리지 않는다. 판정은 `listGroups` 가 다시 한다.
    canSeeGroups(ctx.role) ? listGroups(ctx) : Promise.resolve(null),
    // 게스트 관리(7d-3)는 owner · membership_admin 에게만 — 판정은 `listGuests` 가 다시 한다.
    canManageGuests(ctx.role) ? listGuests(ctx) : Promise.resolve(null),
    // 정책(7g-2)은 owner 에게만 — 판정은 `getSecurityPolicy` 와 저장 라우트가 다시 한다.
    canManageSecurityPolicy(ctx.role) ? getSecurityPolicy(ctx) : Promise.resolve(null),
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

      {members !== null && (
        <section data-testid="workspace-members">
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
      )}

      {guests?.ok && (
        <section data-testid="workspace-guests">
          <h2 className="text-sm font-medium text-neutral-500">게스트 {guests.value.length}명</h2>
          <p className="mt-1 text-xs text-neutral-500">
            게스트는 받은 페이지와 그 아래만 봅니다. 멤버로 올리거나 워크스페이스에서 뺄 수 있습니다.
          </p>
          <GuestPanel workspaceId={ctx.workspaceId} initialGuests={[...guests.value]} />
        </section>
      )}

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
            members={(members ?? []).map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, status: m.status }))}
          />
        </section>
      )}

      {canInvite && (
        <section>
          <h2 className="text-sm font-medium text-neutral-500">멤버 초대</h2>
          <InviteForm workspaceId={ctx.workspaceId} />
          {/* 대기 중인 초대와 취소(7g-3) — 게스트의 대기 초대(7g-1)는 제목 없이 "게스트 · 페이지 하나"로 선다. */}
          <PendingInviteList workspaceId={ctx.workspaceId} initialInvites={[...invites]} />
        </section>
      )}

      {policy?.ok && (
        <section>
          <h2 className="text-sm font-medium text-neutral-500">정책</h2>
          <SecurityPolicyForm
            workspaceId={ctx.workspaceId}
            initialAllowNonmemberRequests={policy.value.allowNonmemberPageAccessRequest}
          />
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
