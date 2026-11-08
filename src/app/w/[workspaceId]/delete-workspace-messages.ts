/**
 * 워크스페이스 삭제의 말 (AD-1 · F-14-13 · 순수)
 */

/** 확인 창의 경고 — 모든 멤버가 잃는다는 것. */
export const DELETE_WORKSPACE_WARNING =
  '모든 멤버가 이 워크스페이스를 잃습니다. 페이지 · 데이터베이스 · 공개 링크 · 폼이 모두 즉시 닫히고, 화면에서는 되살릴 수 없습니다(운영자에게 문의).'

export function deleteWorkspaceFailureMessage(reason: unknown): string {
  switch (reason) {
    case 'name_mismatch':
      return '워크스페이스 이름이 다릅니다. 이름을 그대로 입력하세요.'
    case 'forbidden':
      return '소유자만 워크스페이스를 삭제할 수 있습니다.'
    case 'not_found':
      return '이미 삭제되었거나 없는 워크스페이스입니다.'
    default:
      return '삭제하지 못했습니다. 잠시 뒤 다시 시도하세요.'
  }
}
