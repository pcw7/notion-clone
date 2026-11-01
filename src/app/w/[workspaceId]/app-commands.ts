/**
 * 앱 안의 작업 — 단축키 · 커맨드 팔레트가 함께 부른다 (잔여 묶음 8h · 35번 트랙 CP-1 · F-12-03 · F-07-16 · F-07-11)
 *
 * 같은 일을 여러 곳(단축키 · 검색 오버레이의 작업 줄)이 부르므로 한 곳에 둔다. 여는 쪽과 하는 쪽이 서로를 모르는 것(사이드바의 접기)은
 * 검색 오버레이를 여는 것과 같은 DOM 이벤트로 알린다(`openSearchOverlay` 와 같은 방식 — 상태를 둘로 두지 않는다).
 */

import { isTheme, toggledTheme } from '@/lib/settings/registry'

/** 사이드바를 접거나 편다 — 사이드바가 듣는다(`sidebar.tsx` · Ctrl/Cmd+\ 와 같은 일). */
export const SIDEBAR_TOGGLE_EVENT = 'nc:toggle-sidebar'

export function requestSidebarToggle(): void {
  window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT))
}

/**
 * 밝게 ↔ 어둡게 — 지금 보이는 것의 반대(`system` 이면 OS 가 고른 것의 반대 · 정본 §3.1 [보강] 설정 값 표 · 테마 ④). 먼저 칠하고(`<html data-theme>`)
 * 저장한다 — 거부되거나 끊기면 되돌린다. 저장되면 `onSaved`(서버 렌더를 다시 그린다).
 */
export function toggleThemeNow(workspaceId: string, onSaved: () => void): void {
  const root = document.documentElement
  const before = isTheme(root.dataset.theme) ? root.dataset.theme : 'system'
  const next = toggledTheme(before, window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.dataset.theme = next
  fetch(`/api/workspaces/${workspaceId}/settings/account.theme`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: next }),
  })
    .then((res) => {
      if (res.ok) onSaved()
      else root.dataset.theme = before
    })
    .catch(() => {
      root.dataset.theme = before
    })
}
