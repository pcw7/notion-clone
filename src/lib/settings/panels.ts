/**
 * 설정 화면의 패널 — 값 하나가 아니라 목록 · 명령을 가진 관리 화면 (설정 정보구조 8g-2조각 · F-17-12)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강] 설정 정보구조 ④ · 17-ops-governance.md F-17-12 의 워크스페이스 계층
 *       *"General … Export all workspace content"* · 노션 설정의 People 탭(멤버 · 게스트 · 그룹 · 초대)
 *       14-auth-accounts.md F-14-03 *"Settings → {내 이름} → Set a password"*(8i-1b — 계정의 보안 절)
 *
 * 레지스트리(`registry.ts`)의 항목은 값 하나다. 사람(멤버 · 초대 · 게스트 · 그룹)과 워크스페이스 내보내기는 목록과 명령이 있는 화면이라
 * 그 한 줄로 그릴 수 없다 — 그래서 절 안의 **패널**로 선다. 전에는 워크스페이스 홈의 절들이었다.
 *
 * **누가 보는가는 그 기능의 판정 함수 그대로다** — 레지스트리로 옮겨 적지 않는다(판정이 둘이 되지 않게). 화면은 이 목록의 순서로
 * 그리고(`settings/page.tsx`), 패널이 선 절은 내비에도 선다(`visibleSettingGroups` 의 둘째 인자). 데이터를 읽는 곳 · 명령의 판정은
 * 각 기능의 것이 다시 한다(목록 함수 · 라우트).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { canReadAudit } from '../audit/audit.ts'
import { canSeePlan } from '../billing/overview.ts'
import { canExportWorkspace } from '../export/download.ts'
import { canSeeGroups } from '../workspace/group.ts'
import { canManageGuests } from '../workspace/guest.ts'
import { canInvite } from '../workspace/invite.ts'
import { canListMembers } from '../workspace/list.ts'
import type { SettingSectionId } from './registry.ts'

/** 모든 패널 — 절 안의 순서이기도 하다(값 항목들 뒤에 선다). */
export const SETTING_PANELS = [
  // 자기 계정의 비밀번호 — 누구나(게스트 포함). 판정 · 쓰기는 `auth/password.ts` 가 한다.
  { id: 'password', section: 'account.security', visible: () => true },
  // 2단계 인증(8i-2b) — 누구나 본다(켜려면 비밀번호가 있어야 한다는 것은 패널이 말한다). 판정 · 쓰기는 `auth/mfa.ts`.
  { id: 'mfa', section: 'account.security', visible: () => true },
  { id: 'members', section: 'workspace.people', visible: (ctx: SessionContext) => canListMembers(ctx.role) },
  { id: 'invites', section: 'workspace.people', visible: (ctx: SessionContext) => canInvite(ctx.role) },
  { id: 'guests', section: 'workspace.people', visible: (ctx: SessionContext) => canManageGuests(ctx.role) },
  { id: 'groups', section: 'workspace.people', visible: (ctx: SessionContext) => canSeeGroups(ctx.role) },
  { id: 'export', section: 'workspace.general', visible: (ctx: SessionContext) => canExportWorkspace(ctx) },
  // 요금제(8k-3) — 소유자 · 멤버 관리자. 읽기만 한다(바꾸는 길은 운영자 명령).
  { id: 'plan', section: 'workspace.plan', visible: (ctx: SessionContext) => canSeePlan(ctx.role) },
  // 감사 로그(6d-2) — 소유자. 요금제(Enterprise)가 아니면 패널이 그렇다고 말한다. 판정은 `listWorkspaceAudit` 가 다시 한다.
  { id: 'audit', section: 'workspace.audit', visible: (ctx: SessionContext) => canReadAudit(ctx) },
] as const satisfies readonly {
  readonly id: string
  readonly section: SettingSectionId
  readonly visible: (ctx: SessionContext) => boolean
}[]

export type SettingPanel = (typeof SETTING_PANELS)[number]
export type SettingPanelId = SettingPanel['id']

/** 이 사람에게 서는 패널 — 목록의 순서로. */
export function visiblePanels(ctx: SessionContext): SettingPanel[] {
  return SETTING_PANELS.filter((panel) => panel.visible(ctx))
}
