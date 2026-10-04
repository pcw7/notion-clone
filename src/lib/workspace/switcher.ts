/**
 * 워크스페이스 스위처 — 단축키의 판정 (잔여 묶음 8j-1 · F-14-09 · F-02-17, DOM · DB 없음)
 *
 * 정본: 14-auth-accounts.md F-14-09 *"워크스페이스 이름 클릭 → 드롭다운에서 선택. 데스크톱 단축키 `Ctrl + Shift + {번호}`(목록상
 *       위치)"*
 *
 *   · 단축키는 Ctrl/Cmd + Shift + 1~9 — 목록의 자리(만든 순서 · `listWorkspacesForUser`). 키의 **이름이 아니라 자리**(`code` =
 *     `Digit1`…)로 읽는다 — Shift 가 눌리면 `key` 는 '!' 같은 기호가 되고 자판마다 다르다
 *   · 편집기가 이미 쓴 키(`defaultPrevented`)와 한글 조합 중의 키는 건드리지 않는다
 *   · 그 자리에 워크스페이스가 없거나 지금 있는 곳이면 아무 일도 없다
 */

export const MAX_WORKSPACE_SHORTCUTS = 9

type KeyLike = {
  readonly code: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly isComposing?: boolean
  readonly defaultPrevented?: boolean
}

/** 스위처 단축키이면 목록의 자리(0부터), 아니면 null. */
export function workspaceShortcutIndex(e: KeyLike): number | null {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.isComposing === true || e.defaultPrevented === true) return null
  const digit = /^Digit([1-9])$/.exec(e.code)
  return digit === null ? null : Number(digit[1]) - 1
}

/** 단축키가 갈 곳 — 그 자리에 워크스페이스가 없거나 지금 있는 곳이면 null. */
export function shortcutTarget(workspaceIds: readonly string[], currentId: string, index: number | null): string | null {
  if (index === null) return null
  const id = workspaceIds[index]
  return id === undefined || id === currentId ? null : id
}

/** 목록에 적을 단축키 — 아홉째까지만. */
export function shortcutHint(index: number): string | null {
  return index >= 0 && index < MAX_WORKSPACE_SHORTCUTS ? `Ctrl/Cmd + Shift + ${index + 1}` : null
}
