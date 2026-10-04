/**
 * 설정 화면의 패널 하나 — 사람(멤버 · 초대 · 게스트 · 그룹) · 워크스페이스 내보내기 (설정 정보구조 8g-2조각 · F-17-12)
 *
 * 전에는 워크스페이스 홈의 절이었다 — 모양과 testid 를 그대로 옮겼다. 패널이 서는지는 `settings/panels.ts` 가 정했고(그 기능의 판정
 * 함수), 데이터는 패널마다 그 기능의 목록 함수가 다시 판정하며 읽는다. 명령(초대 · 올리기 · 빼기 · 그룹)은 각 클라이언트 패널이 그
 * 기능의 라우트로 보내고, 끝나면 서버가 이 화면을 다시 그린다(멤버 목록이 함께 바뀐다).
 */

import { MAX_TOTP_METHODS, mfaStatus } from '@/lib/auth/mfa'
import { passwordStatus } from '@/lib/auth/password'
import { planOverview } from '@/lib/billing/overview'
import type { SessionContext } from '@/lib/auth/session-context'
import type { SettingPanelId } from '@/lib/settings/panels'
import { canManageGroups, listGroups } from '@/lib/workspace/group'
import { listGuests } from '@/lib/workspace/guest'
import { listMembers, listPendingInvites } from '@/lib/workspace/list'
import { ExportButton } from '../export-button'
import { GroupPanel } from '../group-panel'
import { GuestPanel } from '../guest-panel'
import { InviteForm } from '../invite-form'
import { PendingInviteList } from '../pending-invite-list'
import { MfaPanel } from './mfa-panel'
import { PasswordPanel } from './password-panel'
import { PlanPanel } from './plan-panel'

const HEADING = 'text-sm font-medium'
const NOTE = 'mt-1 text-xs text-neutral-500'

export async function SettingPanelView({ id, ctx }: { id: SettingPanelId; ctx: SessionContext }) {
  switch (id) {
    case 'password': {
      // 자기 계정의 비밀번호(8i-1b) — 있는가 · 지금 비밀번호를 묻는가는 서버가 판정한다.
      const status = await passwordStatus(ctx)
      return <PasswordPanel workspaceId={ctx.workspaceId} hasPassword={status.hasPassword} currentRequired={status.currentRequired} />
    }
    case 'mfa': {
      // 2단계 인증(8i-2b) — 켜졌는가 · 수단 · 남은 백업 코드 · 비밀번호가 있는가는 서버가 판정한다.
      const status = await mfaStatus(ctx)
      return (
        <MfaPanel
          workspaceId={ctx.workspaceId}
          enabled={status.enabled}
          methods={[...status.methods]}
          backupCodesLeft={status.backupCodesLeft}
          hasPassword={status.hasPassword}
          maxMethods={MAX_TOTP_METHODS}
        />
      )
    }
    case 'plan': {
      // 요금제(8k-3) — 읽기만. 볼 수 없는 역할이면 null(패널 목록이 이미 걸렀다 — 서버가 다시 묻는다).
      const overview = await planOverview(ctx)
      return overview === null ? null : <PlanPanel overview={overview} />
    }
    case 'members': {
      const members = await listMembers(ctx.workspaceId)
      return (
        <section data-testid="workspace-members" className="mt-8">
          <h2 className={HEADING}>멤버 {members.length}명</h2>
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
      )
    }
    case 'invites': {
      const invites = await listPendingInvites(ctx.workspaceId)
      return (
        <section className="mt-8">
          <h2 className={HEADING}>멤버 초대</h2>
          <InviteForm workspaceId={ctx.workspaceId} />
          {/* 대기 중인 초대와 취소(7g-3) — 게스트의 대기 초대(7g-1)는 제목 없이 "게스트 · 페이지 하나"로 선다. */}
          <PendingInviteList workspaceId={ctx.workspaceId} initialInvites={[...invites]} />
        </section>
      )
    }
    case 'guests': {
      const guests = await listGuests(ctx)
      if (!guests.ok) return null
      return (
        <section data-testid="workspace-guests" className="mt-8">
          <h2 className={HEADING}>게스트 {guests.value.length}명</h2>
          <p className={NOTE}>게스트는 받은 페이지와 그 아래만 봅니다. 멤버로 올리거나 워크스페이스에서 뺄 수 있습니다.</p>
          <GuestPanel workspaceId={ctx.workspaceId} initialGuests={[...guests.value]} />
        </section>
      )
    }
    case 'groups': {
      const [groups, members] = await Promise.all([listGroups(ctx), listMembers(ctx.workspaceId)])
      if (!groups.ok) return null
      return (
        <section className="mt-8">
          <h2 className={HEADING}>그룹 {groups.value.length}개</h2>
          <p className={NOTE}>사람을 묶어 두면 페이지 공유에서 한 번에 줄 수 있습니다. 나중에 그룹에 들어온 사람도 곧바로 봅니다.</p>
          <GroupPanel
            workspaceId={ctx.workspaceId}
            canManage={canManageGroups(ctx.role)}
            initialGroups={[...groups.value]}
            members={members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, status: m.status }))}
          />
        </section>
      )
    }
    case 'export':
      return (
        <section className="mt-8">
          <h2 className={HEADING}>데이터 내보내기</h2>
          <p className={NOTE}>
            워크스페이스 전체를 Markdown · CSV 로 내려받습니다. 소유자만 할 수 있고, 소유자도 볼 수 있는 페이지만 들어갑니다. 멤버는 페이지 ·
            데이터베이스 화면에서 각각 내보냅니다.
          </p>
          <div className="mt-3">
            <ExportButton workspaceId={ctx.workspaceId} label="워크스페이스 내보내기" align="left" />
          </div>
        </section>
      )
  }
}
