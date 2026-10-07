/**
 * 마지막으로 쓴 색 — Ctrl/Cmd+Shift+H 가 다시 쓴다 (F-01-21 시나리오 4 · Phase 2 1e-1)
 *
 * 정본: 01-block-editor.md F-01-21 *"'마지막 사용 색'은 사용자별 클라이언트 상태다 … 서버 저장은 불필요(localStorage로 충분)."*
 *
 * 이 브라우저의 것이다 — 다른 기기 · 다른 브라우저는 따로 기억한다. 저장소를 쓸 수 없으면(사생활 보호 모드 · 서버 · 검사) 이 탭의
 * 기억만 쓴다. 읽은 값이 계약의 19색이 아니면 없는 것으로 본다.
 */

import { isColor, type Color } from '../contracts/rich-text.ts'

const KEY = 'notion-clone:last-color'

let remembered: Color | null = null

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** 색을 썼다 — 블록 메뉴의 '색' · `/` 의 색 명령 · 서식 툴바가 부른다. */
export function rememberColor(color: Color): void {
  remembered = color
  try {
    storage()?.setItem(KEY, color)
  } catch {
    // 저장소가 꽉 찼거나 막혔다 — 이 탭의 기억만 쓴다.
  }
}

/** 마지막으로 쓴 색 — 없으면 null. */
export function lastColor(): Color | null {
  if (remembered !== null) return remembered
  try {
    const stored = storage()?.getItem(KEY) ?? null
    if (isColor(stored)) remembered = stored
  } catch {
    // 읽을 수 없다 — 없는 것으로 본다.
  }
  return remembered
}
