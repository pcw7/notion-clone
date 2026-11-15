/**
 * "오프라인으로 쓰기" 의 거부 문구 (OF-2 · F-12-04 · 순수)
 *
 * 라우트(`GET …/pages/{id}/offline` · 데이터베이스는 `…/databases/{id}/offline` — OF-4)의 거부를 사람의 말로. 정책 거부는 내보내기 창과
 * 같은 까닭이다(같은 게이트 — `export-button.tsx`).
 */

export function offlineDownloadError(status: number, error: string | null | undefined, subject: '페이지' | '데이터베이스' = '페이지'): string {
  if (error === 'policy_disabled') return '워크스페이스 정책이 멤버의 내보내기를 막아 오프라인으로 내려받을 수 없습니다 — 소유자만 내려받을 수 있습니다.'
  switch (status) {
    case 401:
      return '로그인이 만료됐습니다. 다시 로그인해 주세요.'
    case 404:
      return `이 ${subject}를 찾을 수 없습니다. 지워졌거나 볼 수 없게 됐습니다.`
    default:
      return '내려받지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
  }
}
