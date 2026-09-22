/**
 * 옮기기의 문구 — F-02-08 · 7c-3조각 (F-06-20 · DOM · DB 없음)
 *
 * 서버의 거부 코드(`MoveError`)를 사람의 말로 바꾼다. `needs_full_access` 는 **왜** 막혔는지 말한다 — 다른 teamspace 나
 * 워크스페이스 최상위로 옮기면 그 페이지를 볼 수 있는 사람이 통째로 바뀌므로 공유를 바꾸는 것과 같다(`move-page.ts` 머리말).
 */

export function moveFailureMessage(error: unknown): string {
  switch (error) {
    case 'too_deep':
      return '그 위치로 옮기면 깊이 제한을 넘습니다.'
    case 'cycle':
      return '자기 하위 페이지 안으로는 옮길 수 없습니다.'
    case 'forbidden':
      return '이 페이지를 옮길 권한이 없습니다.'
    case 'needs_full_access':
      return '다른 teamspace 나 워크스페이스 최상위로 옮기려면 이 페이지의 전체 권한이 필요합니다 — 볼 수 있는 사람이 바뀝니다.'
    case 'target_not_found':
      return '그 위치로 옮길 수 없습니다.'
    default:
      return '옮기지 못했습니다.'
  }
}
