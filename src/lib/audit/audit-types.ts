/**
 * 감사 로그의 종류 · 행 모양 (게시 · 공유 6d-1 · 6d-2 · F-11-12 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.8 끝 [보강] 감사 로그 ① · 마이그레이션 0087 의 CHECK
 *
 * 쌓고 읽는 쪽(`audit.ts` — DB)과 화면(`audit-panel.tsx` — 브라우저)이 함께 쓴다. 여기에 DB 를 부르는 것을 두지 않는다 — 브라우저 묶음에
 * 서버 코드가 끌려 들어간다.
 */

export const AUDIT_EVENT_TYPES = [
  'account.login',
  'account.security_changed',
  'workspace.member_invited',
  'workspace.member_joined',
  'workspace.member_removed',
  'workspace.member_role_changed',
  'workspace.setting_changed',
  'workspace.exported',
  'page.permission_changed',
  'page.publish_changed',
  'page.permanently_deleted',
] as const
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number]

export type AuditRow = {
  readonly id: string
  readonly type: AuditEventType
  readonly occurredAt: string
  readonly actor: { readonly userId: string | null; readonly name: string | null; readonly email: string | null }
  readonly target: { readonly type: string; readonly id: string } | null
  readonly ip: string | null
  readonly metadata: Readonly<Record<string, unknown>>
  readonly setting: { readonly key: string; readonly before: unknown; readonly after: unknown } | null
}
