/**
 * 메뉴 항목 사이의 화살표 이동 — 열 머리 메뉴 (§7 정리 10n-43 · ARIA 메뉴 단추 패턴 · WCAG 2.1.1 · DOM 을 모르는 모듈)
 *
 * ↓ 다음 · ↑ 앞 — 끝에서 처음으로(처음에서 끝으로) 돌아간다. Home 은 첫 항목 · End 는 마지막. 지금 포커스가 항목이 아니면(`current` 가 -1)
 * ↓ 는 첫, ↑ 는 마지막이다. 항목이 없거나 이동 키가 아니면 null — 부르는 쪽이 키를 그대로 둔다(Tab · Enter · 글자는 메뉴가 쓰지 않는다).
 */

export function nextMenuIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
