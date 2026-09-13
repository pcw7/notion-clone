/**
 * 표 그리드의 키보드 내비게이션 — W8-b (F-03-16 의 UI 몫)
 *
 * 정본: 03-database-core.md F-03-16
 *   *"셀 클릭 → 선택 상태(테두리). 한 번 더 클릭 또는 `Enter` → 편집 모드.
 *    `Tab` / `Shift+Tab` 좌우 이동, `↑↓←→` 셀 선택 이동, `Enter` 아래 셀.
 *    `Esc` 편집 취소."*
 *
 * ──────────────────────────────────────────────────────────────────────
 * DOM 을 모른다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 키 하나와 지금 상태, 격자 크기를 받아 **다음 상태와 화면이 할 일**을 돌려준다.
 * 화면은 그 결과대로 포커스를 옮기고 저장을 부를 뿐이다. 에디터의 `block-rules.ts`
 * 와 같은 분리이고, 같은 이유로 규칙 전부가 `node --test` 로 돈다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 표 끝의 Tab 은 표 밖으로 보낸다 — 선택 상태에서만
 * ──────────────────────────────────────────────────────────────────────
 *
 * 선택 상태에서 마지막 칸의 Tab(첫 칸의 Shift+Tab)은 처리하지 않는다. 브라우저가
 * 다음 포커스 대상으로 넘긴다 — 막으면 키보드 사용자가 표에 갇힌다(WCAG 2.1
 * SC 2.1.2).
 *
 * 편집 중에는 다르다: 저장하고 **그 칸에 머문다.** 입력을 끝내는 키가 표를 떠나는
 * 키이기도 하면, 저장이 실패했을 때 오류를 보여줄 자리가 화면에서 사라진다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * IME 조합 중에는 아무것도 하지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 조합 중의 Enter 는 한글 후보 확정이다. 가로채면 마지막 글자가 사라진다
 * (`page-title.tsx` · 검색 오버레이와 같은 규칙).
 */

export type CellPos = { readonly row: number; readonly col: number }

export type GridMode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'selected'; readonly at: CellPos }
  | { readonly kind: 'editing'; readonly at: CellPos }

export type GridSize = { readonly rows: number; readonly cols: number }

export type KeyInput = {
  readonly key: string
  readonly shift?: boolean
  /** Ctrl 또는 Cmd. 복사·붙여넣기·실행 취소는 이동 규칙이 아니다 — 처리하지 않는다. */
  readonly mod?: boolean
  readonly alt?: boolean
  /** `KeyboardEvent.isComposing`. */
  readonly composing?: boolean
}

/**
 * 키를 처리한 뒤 화면이 할 일.
 *
 *   `edit`   — 이 칸의 편집을 시작한다(체크박스처럼 편집칸이 없는 타입은 화면이 토글로 바꾼다)
 *   `commit` — 편집 중인 값을 저장한다. **저장이 거부되면** 화면은 `mode` 로 옮기지 않고 편집에 머문다
 *   `cancel` — 편집 중인 값을 버린다
 *   `clear`  — 이 칸의 값을 비운다
 */
export type GridEffect = 'none' | 'edit' | 'commit' | 'cancel' | 'clear'

export type KeyResult = {
  /** `false` 면 이 키는 표의 것이 아니다. 화면은 `preventDefault()` 를 하지 않는다. */
  readonly handled: boolean
  readonly mode: GridMode
  readonly effect: GridEffect
  /** `effect` 가 가리키는 칸. `none` 이면 `null`. */
  readonly target: CellPos | null
}

/** 격자 안으로 끌어온다. 격자가 비었으면 `null`. 행이 지워져 선택이 밖에 남았을 때 쓴다. */
export function clampPos(pos: CellPos, size: GridSize): CellPos | null {
  if (size.rows <= 0 || size.cols <= 0) return null
  return {
    row: Math.min(Math.max(pos.row, 0), size.rows - 1),
    col: Math.min(Math.max(pos.col, 0), size.cols - 1),
  }
}

/** Tab 한 칸. 줄 끝이면 다음 줄 첫 칸, 표 끝이면 `null`. */
export function nextCell(pos: CellPos, size: GridSize): CellPos | null {
  if (pos.col + 1 < size.cols) return { row: pos.row, col: pos.col + 1 }
  if (pos.row + 1 < size.rows) return { row: pos.row + 1, col: 0 }
  return null
}

/** Shift+Tab 한 칸. 줄 처음이면 윗줄 마지막 칸, 표 처음이면 `null`. */
export function prevCell(pos: CellPos, size: GridSize): CellPos | null {
  if (pos.col > 0) return { row: pos.row, col: pos.col - 1 }
  if (pos.row > 0) return { row: pos.row - 1, col: size.cols - 1 }
  return null
}

export function handleGridKey(mode: GridMode, input: KeyInput, size: GridSize): KeyResult {
  const skip = (): KeyResult => ({ handled: false, mode, effect: 'none', target: null })

  if (input.composing || mode.kind === 'idle') return skip()

  const at = clampPos(mode.at, size)
  if (at === null) return { handled: false, mode: { kind: 'idle' }, effect: 'none', target: null }
  if (input.mod || input.alt) return skip()

  const select = (to: CellPos): KeyResult => ({
    handled: true,
    mode: { kind: 'selected', at: to },
    effect: 'none',
    target: null,
  })

  if (mode.kind === 'editing') {
    switch (input.key) {
      case 'Escape':
        return { handled: true, mode: { kind: 'selected', at }, effect: 'cancel', target: at }

      case 'Enter': {
        // Shift+Enter 는 입력칸의 몫이다(줄바꿈을 받는 편집기가 붙을 자리).
        if (input.shift) return skip()
        // F-03-16: "Enter 아래 셀". 마지막 줄이면 제자리 — 새 행을 몰래 만들지 않는다.
        const below = at.row + 1 < size.rows ? { row: at.row + 1, col: at.col } : at
        return { handled: true, mode: { kind: 'selected', at: below }, effect: 'commit', target: at }
      }

      case 'Tab': {
        // 편집 중에는 표를 떠나지 않는다(머리말).
        const to = (input.shift ? prevCell(at, size) : nextCell(at, size)) ?? at
        return { handled: true, mode: { kind: 'selected', at: to }, effect: 'commit', target: at }
      }

      default:
        // 화살표·글자는 입력칸의 것이다 — 캐럿을 움직여야 한다.
        return skip()
    }
  }

  switch (input.key) {
    // 경계에서도 **처리한다.** 처리하지 않으면 브라우저가 페이지를 스크롤한다.
    case 'ArrowUp':
      return select(clampPos({ row: at.row - 1, col: at.col }, size) ?? at)
    case 'ArrowDown':
      return select(clampPos({ row: at.row + 1, col: at.col }, size) ?? at)
    case 'ArrowLeft':
      return select(clampPos({ row: at.row, col: at.col - 1 }, size) ?? at)
    case 'ArrowRight':
      return select(clampPos({ row: at.row, col: at.col + 1 }, size) ?? at)

    case 'Tab': {
      const to = input.shift ? prevCell(at, size) : nextCell(at, size)
      // 표 끝 — 브라우저에 넘긴다(머리말: 키보드 사용자를 가두지 않는다).
      if (to === null) return { handled: false, mode: { kind: 'idle' }, effect: 'none', target: null }
      return select(to)
    }

    case 'Enter':
    case 'F2':
      return { handled: true, mode: { kind: 'editing', at }, effect: 'edit', target: at }

    case 'Backspace':
    case 'Delete':
      return { handled: true, mode: { kind: 'selected', at }, effect: 'clear', target: at }

    case 'Escape':
      return { handled: true, mode: { kind: 'idle' }, effect: 'none', target: null }

    default:
      return skip()
  }
}
