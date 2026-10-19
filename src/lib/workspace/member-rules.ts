/**
 * 멤버 관리의 규칙 — 역할 목록 · 누가 누구를 무엇으로 (10o-1 · 10o-2 · F-06-02 · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.3 [보강] 멤버 내보내기 · 역할 바꾸기 ① · ⑧
 *
 * 명령(`member.ts`)과 화면(설정의 사람 절 · 초대 폼)이 **같은 함수**로 답한다 — 화면이 고르개를 보였는데 서버가 거부하거나, 그 반대가
 * 없게. DB 를 가져오지 않는 순수 모듈이라 클라이언트 컴포넌트도 쓴다.
 */

import type { WorkspaceRole } from '../auth/session-context.ts'

/** 멤버 관리가 다루는 역할 — 멤버급 넷. 게스트는 게스트의 길이 있다(⑥). 고르개의 순서이기도 하다. */
export const MEMBER_ROLES = ['owner', 'membership_admin', 'member', 'restricted_member'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === 'string' && (MEMBER_ROLES as readonly string[]).includes(value)
}

/** 멤버를 내보내고 역할을 바꿀 수 있는 역할인가 — 역할 **이름**으로 묻는다(CLAUDE.md). 초대 · 게스트 관리와 같은 둘이다. */
export function canManageMembers(role: string): boolean {
  return role === 'owner' || role === 'membership_admin'
}

/** 관리 역할 — 주거나 가진 사람을 건드리는 것은 owner 만이다(①). */
export function isAdminRole(role: string): boolean {
  return role === 'owner' || role === 'membership_admin'
}

/** 이 사람(`actor`)이 이 역할을 가진 사람을 다루고(`from`) 이 역할로 만들 수 있는가(`to` — 내보내기면 없다). */
export function mayManage(actor: string, from: string, to?: string): boolean {
  if (!canManageMembers(actor)) return false
  if (actor === 'owner') return true
  return !isAdminRole(from) && (to === undefined || !isAdminRole(to))
}

/** 이 사람이 이 역할의 사람에게 줄 수 있는 역할 — 고르개의 선택지(⑧). 다룰 수 없는 사람이면 빈 목록이다. */
export function assignableRoles(actor: string, from: string): MemberRole[] {
  if (!isMemberRole(from) || !mayManage(actor, from)) return []
  return MEMBER_ROLES.filter((to) => mayManage(actor, from, to))
}

/** 초대할 때 고를 수 있는 역할 — 관리 역할로 들이는 것은 owner 만(①). 초대 폼의 순서(멤버가 먼저)다. */
export function invitableRoles(actor: WorkspaceRole | string): ('member' | 'membership_admin' | 'owner')[] {
  if (!canManageMembers(actor)) return []
  return actor === 'owner' ? ['member', 'membership_admin', 'owner'] : ['member']
}
