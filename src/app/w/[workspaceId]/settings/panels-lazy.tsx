'use client'

/**
 * 설정 패널의 지연 로드(BD-1) — 설정 화면은 한 번에 패널 하나(또는 한 묶음)만 그리는데, 서버 컴포넌트(`setting-panel.tsx`)가 모든 패널을
 * 정적으로 import 하면 열지 않은 패널(2단계 인증의 QR · 오프라인 목록 · 이모지 올리기 · 감사 로그 …)까지 첫 JS 에 들어간다.
 *
 * 각 패널은 이 파일의 `next/dynamic` 을 거친다 — **서버 렌더는 그대로 한다**(ssr 기본값). 지금 그리는 패널의 청크는 서버가 미리 받게
 * 알리고(`<link rel=preload>`) 하이드레이션은 그 청크를 기다린다 — 화면이 비거나 밀리지 않는다. 열지 않은 패널은 받지 않는다.
 * 설정 탭 사이의 이동은 전환(transition)이라 새 패널의 청크가 들어올 때까지 지금 화면을 그대로 둔다(`loading` 을 주지 않는다 — 주면
 * Suspense 경계가 생겨 빈 칸이 먼저 보인다). 요금제 패널은 서버 컴포넌트라 여기 없다.
 */

import dynamic from 'next/dynamic'

export const AccountDeletePanel = dynamic(() => import('./account-delete-panel').then((m) => m.AccountDeletePanel))
export const AccessibilityPanel = dynamic(() => import('./accessibility-panel').then((m) => m.AccessibilityPanel))
export const AiPanel = dynamic(() => import('./ai-panel').then((m) => m.AiPanel))
export const AiInstructionsPanel = dynamic(() => import('./ai-instructions-panel').then((m) => m.AiInstructionsPanel))
export const ApiTokenPanel = dynamic(() => import('./api-token-panel').then((m) => m.ApiTokenPanel))
export const AuditPanel = dynamic(() => import('./audit-panel').then((m) => m.AuditPanel))
export const DevicesPanel = dynamic(() => import('./devices-panel').then((m) => m.DevicesPanel))
export const EmailsPanel = dynamic(() => import('./emails-panel').then((m) => m.EmailsPanel))
export const EmojiPanel = dynamic(() => import('./emoji-panel').then((m) => m.EmojiPanel))
export const MfaPanel = dynamic(() => import('./mfa-panel').then((m) => m.MfaPanel))
export const OfflinePanel = dynamic(() => import('./offline-panel').then((m) => m.OfflinePanel))
export const PasswordPanel = dynamic(() => import('./password-panel').then((m) => m.PasswordPanel))
export const SitePanel = dynamic(() => import('./site-panel').then((m) => m.SitePanel))
// 사람(멤버 · 초대 · 게스트 · 그룹) · 나가기 · 삭제 · 워크스페이스 내보내기 — 워크스페이스 홈의 절이던 부품들
export const ExportButton = dynamic(() => import('../export-button').then((m) => m.ExportButton))
export const GroupPanel = dynamic(() => import('../group-panel').then((m) => m.GroupPanel))
export const GuestPanel = dynamic(() => import('../guest-panel').then((m) => m.GuestPanel))
export const InviteForm = dynamic(() => import('../invite-form').then((m) => m.InviteForm))
export const DeleteWorkspacePanel = dynamic(() => import('../delete-workspace-panel').then((m) => m.DeleteWorkspacePanel))
export const LeavePanel = dynamic(() => import('../leave-panel').then((m) => m.LeavePanel))
export const MemberPanel = dynamic(() => import('../member-panel').then((m) => m.MemberPanel))
export const PendingInviteList = dynamic(() => import('../pending-invite-list').then((m) => m.PendingInviteList))
