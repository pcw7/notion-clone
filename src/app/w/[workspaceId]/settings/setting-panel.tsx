/**
 * 설정 화면의 패널 하나 — 사람(멤버 · 초대 · 게스트 · 그룹) · 워크스페이스 내보내기 (설정 정보구조 8g-2조각 · F-17-12)
 *
 * 전에는 워크스페이스 홈의 절이었다 — 모양과 testid 를 그대로 옮겼다. 패널이 서는지는 `settings/panels.ts` 가 정했고(그 기능의 판정
 * 함수), 데이터는 패널마다 그 기능의 목록 함수가 다시 판정하며 읽는다. 명령(초대 · 올리기 · 빼기 · 그룹)은 각 클라이언트 패널이 그
 * 기능의 라우트로 보내고, 끝나면 서버가 이 화면을 다시 그린다(멤버 목록이 함께 바뀐다).
 */

import { readAiConfig } from '@/lib/ai/config'
import { aiSettingsSummary } from '@/lib/ai/usage'
import { aiInstructionsViewFor } from '@/lib/ai/chat-store'
import { aiModelSettingsFor } from '@/lib/ai/model-setting'
import { canCreateApiToken, listApiTokens } from '@/lib/api/api-token'
import { MAX_TOTP_METHODS, mfaStatus } from '@/lib/auth/mfa'
import { passwordStatus } from '@/lib/auth/password'
import { listWorkspaceAudit } from '@/lib/audit/audit'
import { entitlement } from '@/lib/billing/entitlement'
import { planOverview } from '@/lib/billing/overview'
import { collabServerUrl } from '@/lib/collab/collab-url'
import { canCreateCustomEmoji, listCustomEmoji } from '@/lib/emoji/custom-emoji'
import { readSiteDomain } from '@/lib/publish/site'
import type { SessionContext } from '@/lib/auth/session-context'
import type { SettingPanelId } from '@/lib/settings/panels'
import { canManageGroups, listGroups } from '@/lib/workspace/group'
import { listGuests } from '@/lib/workspace/guest'
import { listMembers, listPendingInvites, workspaceNameOf } from '@/lib/workspace/list'
import { invitableRoles } from '@/lib/workspace/member-rules'
import { readDevicePreferences } from '@/lib/settings/device-preferences-cookie'
import { AiUsagePanel } from './ai-lazy'
// 클라이언트 패널은 지연 로드를 거친다(BD-1) — 서버 렌더는 그대로 · 열지 않은 패널은 첫 JS 에 들지 않는다(`panels-lazy.tsx`)
import {
  AccountDeletePanel,
  AccessibilityPanel,
  AiInstructionsPanel,
  AiPanel,
  ApiTokenPanel,
  AuditPanel,
  DeleteWorkspacePanel,
  EmojiPanel,
  ExportButton,
  GroupPanel,
  GuestPanel,
  InviteForm,
  LeavePanel,
  MemberPanel,
  MfaPanel,
  OfflinePanel,
  PasswordPanel,
  PendingInviteList,
  SitePanel,
} from './panels-lazy'
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
    case 'account-delete':
      // 계정 삭제(AD-3) — 미리보기는 확인 창이 열릴 때 읽는다. 내보내기 링크가 이 워크스페이스의 설정을 가리키려고 id 만 받는다
      return <AccountDeletePanel workspaceId={ctx.workspaceId} />
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
    case 'emoji': {
      // 커스텀 이모지(7c-2b) — 목록 · 올릴 수 있는가를 여기서 읽는다. 명령(올리기 · 바꾸기 · 지우기)은 라우트가 다시 판정한다.
      const [list, canCreate] = await Promise.all([listCustomEmoji(ctx), canCreateCustomEmoji(ctx)])
      return <EmojiPanel workspaceId={ctx.workspaceId} initial={list} canCreate={canCreate} />
    }
    case 'accessibility':
      // 이 기기의 고대비 · 움직임 줄이기(10d-2) — 지금 값은 요청의 쿠키에서(계정의 설정 표가 아니다)
      return <AccessibilityPanel initial={await readDevicePreferences()} />
    case 'offline':
      // 이 기기에 내려받은 것 · 자동 내려받기(OF-5) — 목록 · 스위치는 브라우저가 읽는다. 서버는 요금제가 자동 내려받기를 허락하는가만 준다
      // (원천 라우트가 다시 묻는다 — `plan_required`)
      return (
        <OfflinePanel
          workspaceId={ctx.workspaceId}
          userId={ctx.userId}
          collabUrl={collabServerUrl()}
          autoAllowed={await entitlement(ctx.workspaceId, 'offline.auto_download')}
        />
      )
    case 'api-tokens': {
      // 내 API 토큰(API-1) — 목록은 여기서 읽는다(값은 없다 · 다시 볼 수 없다). 만들기 · 폐기는 라우트가 다시 판정한다.
      const tokens = await listApiTokens(ctx)
      return <ApiTokenPanel workspaceId={ctx.workspaceId} initial={tokens.ok ? [...tokens.value] : []} canCreate={canCreateApiToken(ctx)} />
    }
    case 'ai': {
      // AI(AI-1) — 스위치 · 쓴 양 · 공급자의 host. 게스트면 null(패널 목록이 이미 걸렀다). 스위치는 `PUT /ai` 가 다시 판정한다.
      // 내 AI 지시(AI-6 · F-10-22) — 그 사람 자신의 것(AI 를 쓸 수 있는 사람만 · 로그인 세션). 고르기 · 만들기 · 해제는 `…/ai/instructions` 가 판정한다.
      // 모델(AI-7 · F-10-26) — 더한 모델 · 기본(소유자에게는 공급자의 목록 — 1시간 캐시). 사용량 분석은 패널이 열 때 읽는다.
      const config = readAiConfig()
      const [summary, instructions, models] = await Promise.all([
        aiSettingsSummary(ctx, { config }),
        aiInstructionsViewFor(ctx),
        aiModelSettingsFor(ctx, { config }),
      ])
      if (summary === null) return null
      return (
        <>
          <AiPanel workspaceId={ctx.workspaceId} initial={summary} models={models} />
          {instructions !== null && <AiInstructionsPanel workspaceId={ctx.workspaceId} initial={instructions} />}
          {/* 사용량(AI-7 · F-10-25) — 열고 나서 읽어 차므로 맨 아래(위의 절을 밀지 않게) */}
          <div className="mt-6">
            <AiUsagePanel workspaceId={ctx.workspaceId} />
          </div>
        </>
      )
    }
    case 'site':
      // 사이트 주소(6c-2) — 지금 주소는 여기서 읽는다. 정하는 것은 소유자만(패널 목록이 걸렀다 — 명령이 다시 묻는다).
      return <SitePanel workspaceId={ctx.workspaceId} initialName={await readSiteDomain(ctx)} />
    case 'audit': {
      // 감사 로그(6d-2) — 첫 쪽은 여기서 읽는다(최근 50). 요금제가 막으면 그렇다고만 말한다(기록은 쌓이고 있다).
      const first = await listWorkspaceAudit(ctx, { limit: 50 })
      if (!first.ok && first.reason === 'plan_required') {
        return (
          <section data-testid="audit-plan-required" className="mt-6 text-sm">
            <p>감사 로그는 엔터프라이즈 요금제에서 볼 수 있습니다.</p>
            <p className={NOTE}>기록은 요금제와 상관없이 쌓이고 있습니다 — 요금제를 바꾸면 지난 365일치를 볼 수 있습니다.</p>
          </section>
        )
      }
      return first.ok ? <AuditPanel workspaceId={ctx.workspaceId} initial={[...first.value]} /> : null
    }
    case 'members': {
      const members = await listMembers(ctx.workspaceId)
      // 역할 고르개 · 내보내기는 다룰 수 있는 줄에만(10o-2 · 정본 §3.3 [보강] 멤버 내보내기 ⑧) — 판정은 명령과 같은 함수다
      return (
        <section data-testid="workspace-members" className="mt-8">
          <h2 className={HEADING}>멤버 {members.length}명</h2>
          <MemberPanel
            workspaceId={ctx.workspaceId}
            viewerId={ctx.userId}
            viewerRole={ctx.role}
            members={members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, status: m.status }))}
          />
        </section>
      )
    }
    case 'invites': {
      const invites = await listPendingInvites(ctx.workspaceId)
      return (
        <section className="mt-8">
          <h2 className={HEADING}>멤버 초대</h2>
          <InviteForm workspaceId={ctx.workspaceId} roles={invitableRoles(ctx.role)} />
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
            <ExportButton workspaceId={ctx.workspaceId} label="워크스페이스 내보내기" align="left" variant="bordered" />
          </div>
        </section>
      )
    case 'leave':
      // 스스로 나가기(10o-3 · 정본 §3.3 [보강] 멤버 내보내기 ⑨) — 마지막 소유자인지는 명령이 센다
      return <LeavePanel workspaceId={ctx.workspaceId} />
    case 'delete':
      // 워크스페이스 삭제(AD-1) — owner 만 보인다(패널 목록이 걸렀다 · 명령이 다시 묻는다). 이름은 확인 입력의 기준이다
      return <DeleteWorkspacePanel workspaceId={ctx.workspaceId} workspaceName={await workspaceNameOf(ctx)} />
  }
}
