/**
 * 계정 삭제 화면의 말 (AD-3 · F-14-13 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 AD-3] ② ③ — 워크스페이스마다 한 줄(결과 · 까닭), 경고 두 줄, 실패 문구.
 */

export type DeletionOutcome = 'delete' | 'leave' | 'blocked'

/** 미리보기의 한 줄(`GET /api/account/deletion` 의 워크스페이스 항목). */
export type DeletionRow = {
  readonly id: string
  readonly name: string
  readonly outcome: DeletionOutcome
  readonly reason?: 'sole_owner' | 'teamspace_last_owner'
  readonly teamspaces?: readonly string[]
}

export const ACCOUNT_DELETE_IRREVERSIBLE = '되돌릴 수 없습니다. 계정과 로그인 정보가 영구히 지워지고, 같은 이메일은 새 계정으로만 다시 쓸 수 있습니다.'
export const ACCOUNT_DELETE_EXPORT_HINT = '먼저 내보내기를 받아 두세요.'
export const ACCOUNT_DELETE_EXPORT_LINK = '내보내기 설정으로 가기'
export const ACCOUNT_DELETE_MEMBERS_LINK = '멤버 설정으로 가기'

export function outcomeLabel(outcome: DeletionOutcome): string {
  switch (outcome) {
    case 'delete':
      return '함께 지워집니다'
    case 'leave':
      return '이 워크스페이스에서 나갑니다'
    case 'blocked':
      return '먼저 해결해야 합니다'
  }
}

/** 막힌 줄의 까닭 — 다른 줄에는 없다. */
export function blockedReason(row: DeletionRow): string {
  if (row.outcome !== 'blocked') return ''
  if (row.reason === 'teamspace_last_owner') {
    const names = (row.teamspaces ?? []).join(' · ')
    return names === ''
      ? '마지막 owner 인 팀스페이스가 있습니다. 다른 멤버를 owner 로 올리거나 팀스페이스를 정리하세요.'
      : `마지막 owner 인 팀스페이스가 있습니다: ${names}. 다른 멤버를 owner 로 올리거나 팀스페이스를 정리하세요.`
  }
  return '유일한 owner 입니다. 다른 멤버를 owner 로 올리거나 워크스페이스를 지우세요.'
}

export function hasBlocked(rows: readonly DeletionRow[]): boolean {
  return rows.some((row) => row.outcome === 'blocked')
}

/** 삭제 단추가 켜지는가 — 막힌 줄이 없고, 기본 이메일을 그대로(대소문자 무관) 쳤을 때. */
export function canConfirmDeletion(rows: readonly DeletionRow[] | null, typed: string, email: string): boolean {
  if (rows === null || hasBlocked(rows)) return false
  const want = email.trim().toLowerCase()
  return want !== '' && typed.trim().toLowerCase() === want
}

export function accountDeleteFailureMessage(reason: unknown): string {
  switch (reason) {
    case 'email_mismatch':
      return '이메일이 다릅니다. 기본 이메일을 그대로 입력하세요.'
    case 'blocked':
      return '먼저 해결해야 하는 워크스페이스가 있습니다. 목록을 다시 확인하세요.'
    case 'unauthenticated':
      return '로그인이 끝났습니다. 다시 로그인하세요.'
    default:
      return '삭제하지 못했습니다. 잠시 뒤 다시 시도하세요.'
  }
}

/** 끝난 뒤 갈 곳 — 함께 로그인한 다른 계정이 있으면 처음 화면(그 계정의 워크스페이스로 간다), 없으면 로그인 화면. */
export function afterDeletionPath(signedIn: boolean): string {
  return signedIn ? '/' : '/login'
}
