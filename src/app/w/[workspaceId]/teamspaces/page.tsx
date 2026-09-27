/**
 * 둘러보기 화면 — `/w/{ws}/teamspaces` (7c-5 · 7c-6조각 · F-06-04)
 *
 * 사이드바 Teamspaces 머리의 `⌕` 가 여기로 온다. 목록은 **서버가 권한으로 거른 것**이다(`listBrowsableTeamspaces`) — 멤버가
 * 아닌 private teamspace 는 이 화면에 오지 않는다. 둘러볼 수 없는 역할(`restricted_member` · 게스트)에게는 빈 목록이므로
 * 화면이 그렇게 말한다(404 로 막지 않는다 — 주소를 아는 것이 권한 정보가 아니다).
 *
 * **보관된 teamspace** 절(7c-6)은 내가 owner 인 것만 싣고, 없으면 그리지 않는다 — 되살릴 수 있는 사람만 그 존재를 본다.
 *
 * **모든 teamspace** 절(7c-10)은 워크스페이스 owner 에게만 선다 — 비공개 · 보관 · 고아까지 보고 소유자로 들어간다.
 */

import Link from 'next/link'

import { requirePageSession } from '@/lib/auth/page-session'
import { listAllTeamspaces, listArchivedTeamspaces, listBrowsableTeamspaces } from '@/lib/workspace/teamspace'
import { TeamspaceAdmin } from './teamspace-admin'
import { TeamspaceArchived } from './teamspace-archived'
import { TeamspaceBrowser } from './teamspace-browser'

export default async function TeamspaceBrowsePage({ params }: PageProps<'/w/[workspaceId]/teamspaces'>) {
  const { workspaceId } = await params
  const ctx = await requirePageSession(workspaceId)
  const [rows, archived, all] = await Promise.all([
    listBrowsableTeamspaces(ctx),
    listArchivedTeamspaces(ctx),
    listAllTeamspaces(ctx),
  ])

  return (
    <main data-testid="teamspace-browse-page" className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <header>
        <p className="text-xs text-neutral-500">
          <Link href={`/w/${workspaceId}`} className="hover:underline underline-offset-4">
            워크스페이스
          </Link>{' '}
          / teamspace 둘러보기
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Teamspace 둘러보기</h1>
        <p className="mt-2 text-sm text-neutral-500">
          공개 teamspace 는 스스로 참여할 수 있습니다. 참여하면 그 teamspace 의 페이지를 보게 됩니다 — 참여하기 전에는 이름만
          보입니다.
        </p>
      </header>

      <TeamspaceBrowser
        workspaceId={workspaceId}
        initialRows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          visibility: r.visibility,
          memberCount: r.memberCount,
          role: r.role,
        }))}
      />

      <TeamspaceArchived
        workspaceId={workspaceId}
        initialRows={archived.map((r) => ({
          id: r.id,
          name: r.name,
          visibility: r.visibility,
          archivedAt: r.archivedAt,
        }))}
      />

      <TeamspaceAdmin
        workspaceId={workspaceId}
        initialRows={all.map((r) => ({
          id: r.id,
          name: r.name,
          visibility: r.visibility,
          archivedAt: r.archivedAt,
          ownerCount: r.ownerCount,
          role: r.role,
        }))}
      />
    </main>
  )
}
