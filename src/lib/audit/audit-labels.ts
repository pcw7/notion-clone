/**
 * 감사 로그를 읽는 말 — 종류 이름 · 세부 한 줄 · CSV (게시 · 공유 6d-2 · F-11-12 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.8 끝 [보강] 감사 로그 ③⑥
 *
 * 화면(`audit-panel.tsx`)과 CSV(`audit-csv.ts`)가 같은 말을 쓴다 — 둘이 다른 문구를 쓰면 내려받은 파일과 화면이 어긋난다. 감사 행에는
 * 내용이 없다(id · 키 · 값 · 받는 주소) — 여기도 그것만 읽는다. 브라우저가 부르므로 DB 를 부르는 것을 가져오지 않는다.
 */

import type { AuditEventType, AuditRow } from './audit-types.ts'

export const AUDIT_TYPE_LABEL: Readonly<Record<AuditEventType, string>> = {
  'account.login': '로그인',
  'account.security_changed': '계정 보안 변경',
  'workspace.member_invited': '초대',
  'workspace.member_joined': '합류',
  'workspace.member_removed': '구성원 빼기',
  'workspace.member_role_changed': '역할 변경',
  'workspace.setting_changed': '설정 변경',
  'workspace.exported': '내보내기',
  'page.permission_changed': '페이지 권한 변경',
  'page.publish_changed': '웹 게시 변경',
  'page.permanently_deleted': '영구 삭제',
}

const SECURITY_CHANGE: Readonly<Record<string, string>> = {
  password_set: '비밀번호를 정했다',
  password_changed: '비밀번호를 바꿨다',
  password_removed: '비밀번호를 지웠다',
  mfa_enabled: '2단계 인증을 켰다',
  mfa_method_added: '2단계 인증 수단을 더했다',
  mfa_disabled: '2단계 인증을 껐다',
  mfa_method_removed: '2단계 인증 수단을 뺐다',
  mfa_backup_codes_regenerated: '백업 코드를 새로 만들었다',
}

const PRINCIPAL: Readonly<Record<string, string>> = {
  user: '사람',
  group: '그룹',
  teamspace: '팀스페이스',
  workspace_everyone: '모든 멤버',
}

const LEVEL: Readonly<Record<string, string>> = { view: '읽기', comment: '댓글', edit: '편집', full_access: '전체 권한' }
const ROLE: Readonly<Record<string, string>> = { owner: '소유자', membership_admin: '멤버 관리자', member: '멤버', guest: '게스트' }

/** 자기 칸만 읽는다 — `'constructor'` 같은 값이 원형의 것을 꺼내지 않게. */
const pick = (map: Readonly<Record<string, string>>, key: unknown): string | null =>
  typeof key === 'string' && Object.hasOwn(map, key) ? map[key]! : null

const str = (value: unknown): string => (typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value))

function principalText(raw: unknown): string {
  const p = (raw ?? {}) as { type?: unknown; id?: unknown }
  const kind = pick(PRINCIPAL, p.type) ?? str(p.type)
  return typeof p.id === 'string' ? `${kind} ${p.id.slice(0, 8)}` : kind
}

/** 세부 한 줄 — 무엇이 어떻게. */
export function auditDetail(row: Pick<AuditRow, 'type' | 'metadata' | 'setting'>): string {
  const m = row.metadata as Record<string, unknown>
  switch (row.type) {
    case 'account.login':
      return `${str(m.authMethod)}${m.newAccount === true ? ' · 새 계정' : ''}`
    case 'account.security_changed':
      return pick(SECURITY_CHANGE, m.change) ?? str(m.change)
    case 'workspace.member_invited':
      return `${str(m.email)} · ${pick(ROLE, m.role) ?? str(m.role)}${m.renewed === true ? ' · 다시 보냄' : ''}`
    case 'workspace.member_joined':
      return `${pick(ROLE, m.role) ?? str(m.role)} · ${m.via === 'access_request' ? '접근 요청 허락' : '초대'}`
    case 'workspace.member_removed':
      return pick(ROLE, m.role) ?? str(m.role)
    case 'workspace.member_role_changed':
      return `${pick(ROLE, m.from) ?? str(m.from)} → ${pick(ROLE, m.to) ?? str(m.to)}`
    case 'workspace.setting_changed':
      return row.setting === null ? '' : `${row.setting.key}: ${str(row.setting.before)} → ${str(row.setting.after)}`
    case 'workspace.exported':
      return m.scope === 'workspace' ? '워크스페이스 전체' : '페이지'
    case 'page.permission_changed':
      switch (m.change) {
        case 'grant':
          return `주기 — ${principalText(m.principal)} · ${pick(LEVEL, m.level) ?? str(m.level)}`
        case 'revoke':
          return `거두기 — ${principalText(m.principal)}`
        case 'stop_inheriting':
          return '상속 끊기'
        case 'resume_inheriting':
          return '상속 잇기'
        default:
          return str(m.change)
      }
    case 'page.publish_changed':
      if (m.change === 'publish') return '게시'
      if (m.change === 'unpublish') return '게시 취소'
      return [
        m.robots === 'index' ? '검색 엔진 노출 켬' : m.robots === 'noindex' ? '검색 엔진 노출 끔' : null,
        m.rotated === true ? '주소 바꿈' : null,
      ]
        .filter((x) => x !== null)
        .join(' · ')
    case 'page.permanently_deleted':
      return typeof m.descendants === 'number' && m.descendants > 0 ? `하위 페이지 ${m.descendants}개와 함께` : ''
  }
}

/** 누가 — 이름(메일). 행위자가 없으면(시스템) "시스템". */
export function auditActor(row: Pick<AuditRow, 'actor'>): string {
  const { name, email } = row.actor
  if (name === null && email === null) return '시스템'
  return email === null ? (name ?? '') : `${name ?? ''} (${email})`
}
