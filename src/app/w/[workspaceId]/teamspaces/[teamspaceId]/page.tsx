/**
 * teamspace 화면 — 최상위 페이지 · 멤버 · 역할 · 나가기 (7c-2조각 · F-06-04)
 *
 * 사이드바의 teamspace 이름이 여기로 온다. 노션의 teamspace 홈과 설정(`Settings → Teamspaces`)을 한 화면에 둔다 —
 * 설정 화면이 따로 없는 것은 그룹(7b — 워크스페이스 홈의 한 절)과 같다.
 *
 * **멤버만 연다.** 멤버가 아니면 없는 teamspace 와 같은 404 다(`getTeamspace` — 서버 명령과 같은 규칙). 둘러보기 · 참여
 * (open · closed)는 아직 없다(§7).
 *
 * 멤버 목록 · 넣기 · 역할 · 빼기 · 나가기는 클라이언트 컴포넌트가 라우트로 한다(`teamspace-members.tsx`). 넣을 후보는 여기서
 * 싣는다 — 워크스페이스 멤버와 그룹.
 *
 * 최상위의 데이터베이스(7c-4)는 페이지 목록 아래 따로 선다 — 여는 길이 다르다(`/db/{id}`).
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requirePageSession } from '@/lib/auth/page-session'
import { listTeamspacePages } from '@/lib/block/page'
import { listTeamspaceDatabases } from '@/lib/database/database'
import { isUuid } from '@/lib/ids'
import { listGroups } from '@/lib/workspace/group'
import { listMembers } from '@/lib/workspace/list'
import { getTeamspace, listTeamspaceMembers } from '@/lib/workspace/teamspace'
import { NewDatabaseButton } from '../../new-database-button'
import { NewPageButton } from '../../new-page-button'
import { TeamspaceMembers } from './teamspace-members'

const UNTITLED = '제목 없음'

export default async function TeamspacePage({ params }: PageProps<'/w/[workspaceId]/teamspaces/[teamspaceId]'>) {
  const { workspaceId, teamspaceId } = await params
  const ctx = await requirePageSession(workspaceId)
  if (!isUuid(teamspaceId)) notFound()

  const teamspace = await getTeamspace(ctx, teamspaceId)
  if (!teamspace.ok) notFound()

  const [members, pages, databases, people, groups] = await Promise.all([
    listTeamspaceMembers(ctx, teamspaceId),
    listTeamspacePages(ctx, teamspaceId),
    listTeamspaceDatabases(ctx, teamspaceId),
    listMembers(ctx.workspaceId),
    listGroups(ctx),
  ])
  // getTeamspace 가 통과했으므로 여기서 실패하면 그 사이에 빠졌거나 보관된 것이다.
  if (!members.ok) notFound()

  return (
    <main data-testid="teamspace-page" className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header>
        <p className="text-xs text-neutral-500">
          <Link href={`/w/${workspaceId}`} className="hover:underline underline-offset-4">
            워크스페이스
          </Link>{' '}
          / teamspace
        </p>
        <h1 data-testid="teamspace-name" className="mt-1 text-2xl font-semibold tracking-tight">
          {teamspace.value.name}
        </h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-500">페이지 {pages.length}개</h2>
        {pages.length > 0 ? (
          <ul
            data-testid="teamspace-pages"
            className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800"
          >
            {pages.map((p) => (
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
        ) : databases.length === 0 ? (
          <p className="text-sm text-neutral-400">아직 페이지가 없습니다. 여기에 만든 페이지는 이 teamspace 의 멤버가 봅니다.</p>
        ) : null}
        {databases.length > 0 && (
          <ul
            data-testid="teamspace-databases"
            aria-label="데이터베이스"
            className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800"
          >
            {databases.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/w/${workspaceId}/db/${d.id}`}
                  className="block px-4 py-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span aria-hidden className="mr-1 text-neutral-400">
                    ▦
                  </span>
                  {d.name || UNTITLED}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <NewPageButton workspaceId={workspaceId} teamspaceId={teamspaceId} />
          <NewDatabaseButton workspaceId={workspaceId} teamspaceId={teamspaceId} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-neutral-500">멤버</h2>
        <p className="mt-1 text-xs text-neutral-500">
          멤버는 이 teamspace 의 페이지를 모두 봅니다. 소유자는 멤버와 역할을 고칩니다.
        </p>
        <TeamspaceMembers
          workspaceId={workspaceId}
          teamspaceId={teamspaceId}
          myUserId={ctx.userId}
          initialTeamspace={{ role: teamspace.value.role, whoCanInvite: teamspace.value.whoCanInvite }}
          initialMembers={members.value.map((m) => ({ principal: { ...m.principal }, role: m.role, name: m.name, email: m.email }))}
          people={people.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, status: m.status }))}
          groups={groups.ok ? groups.value.map((g) => ({ id: g.id, name: g.name, memberCount: g.memberCount })) : []}
        />
      </section>
    </main>
  )
}
