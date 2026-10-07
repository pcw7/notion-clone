/**
 * 키맵 — F-12-01
 *
 * 정본: 12-platform-ux.md F-12-01
 *   "클론 시 현실적 대안: 키맵을 **선언적 테이블 하나로 정의**하고 ProseMirror
 *    `keymap` 플러그인 + `inputRules` 에 위임한다. **OS 분기는
 *    `event.metaKey || event.ctrlKey` 정규화 한 곳에서 처리**한다."
 *
 * 그대로 한다. `Mod-` 접두사가 그 정규화이고 `prosemirror-keymap` 이 이미
 * 플랫폼에 맞게 해석한다 — 우리가 `navigator.platform` 을 보지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 순서가 규칙이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `Backspace` 에 세 커맨드가 걸린다. **순서가 동작을 정의한다.**
 *
 *   ① `undoInputRule`  — 방금 마크다운 변환이 있었다면 그것만 되돌린다
 *   ② `mergeBackward`  — 블록 맨 앞이면 이전 줄과 병합
 *   ③ (기본)           — 글자 지우기 (ProseMirror)
 *
 * ①이 ②보다 앞이어야 한다. `# ` 를 쳐서 헤딩이 된 직후의 Backspace 는
 * "헤딩 취소"이지 "앞 블록과 병합"이 아니다(F-01-17 엣지 케이스).
 *
 * ──────────────────────────────────────────────────────────────────────
 * IME 게이트
 * ──────────────────────────────────────────────────────────────────────
 *
 * 이 파일이 만드는 `handleKeyDown` 이 §7-4 완화 전략 ④의 유일한 구현 지점이다.
 * 조합 중이면 **아무 바인딩도 실행하지 않고** 브라우저·IME 에 넘긴다.
 */

import { keydownHandler } from '@tiptap/pm/keymap'
import { redo, undo } from '@tiptap/pm/history'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'

import type { BlockType } from '../block/types.ts'
import type { Color } from '../contracts/rich-text.ts'
import { openBlockMenuCommand } from './block-menu.ts'
import { moveBlocksCommand } from './block-move.ts'
import {
  deleteBlockSelectionCommand,
  duplicateBlockSelectionCommand,
  exitBlockSelectionCommand,
  extendBlockSelectionCommand,
  moveBlockSelectionCommand,
  selectAllBlocksCommand,
  selectBlockCommand,
  turnSelectionIntoCommand,
} from './block-selection.ts'
import { removeEmptyColumnCommand } from './column-edit.ts'
import { openEquationCommand } from './equation-block.ts'
import { insertInlineEquationCommand, openSelectedInlineEquationCommand, type InlineEquationRef } from './inline-equation.ts'
import {
  createBlockKeymap,
  isComposingEvent,
  turnIntoCommand,
  type CommandDeps,
  type KeyBindings,
} from './commands.ts'
import { undoInputRuleCommand } from './input-rules.ts'
import { tableEdgeDeleteCommand, tableEnterCommand, tableSoftBreakCommand, tableTabCommand } from './table.ts'
import { toggleFormat } from './marks.ts'
import { reapplyColorCommand } from './block-color.ts'
import { lastColor } from './last-color.ts'

/** 여러 커맨드를 순서대로 시도한다. 첫 성공에서 멈춘다. */
export function chain(...commands: readonly Command[]): Command {
  return (state, dispatch, view) => {
    for (const command of commands) {
      if (command(state, dispatch, view)) return true
    }
    return false
  }
}

/**
 * 블록 타입 숫자 단축키 (F-12-01).
 *
 * "Mac 은 `cmd + option + <숫자>`, Windows/Linux 는 `ctrl + shift + <숫자>`" 라고
 * 정본이 적었지만, `prosemirror-keymap` 의 `Mod-Alt-` 가 두 플랫폼을 함께
 * 처리하므로 하나만 선언한다. 0=텍스트, 1/2/3=H1/H2/H3, 4=to-do, 5=불릿,
 * 6=번호, 7=토글, 8=코드(8a-1). 9(새 페이지)는 비어 있다.
 */
const NUMBER_SHORTCUTS: Readonly<Record<string, BlockType>> = {
  '0': 'paragraph',
  '1': 'heading_1',
  '2': 'heading_2',
  '3': 'heading_3',
  '4': 'to_do',
  '5': 'bulleted_list_item',
  '6': 'numbered_list_item',
  '7': 'toggle',
  '8': 'code',
}

export type EditorKeymapDeps = CommandDeps & {
  /** Cmd+K. 링크 URL 을 물어보는 것은 UI 의 일이므로 밖에서 받는다. */
  promptLink?: () => void
  /** Mod+/. 블록 메뉴를 여는 것도 UI 의 일이다(F-12-01 "블록 컨텍스트 메뉴"). */
  openBlockMenu?: () => void
  /** 골라진 블록 수식의 Enter — 입력창을 연다(Phase 2 1a · 오버레이는 UI 의 일이다). */
  openEquation?: (blockId: string) => void
  /** 인라인 수식의 입력창(Phase 2 1b) — 골라진 인라인 수식의 Enter · Ctrl/Cmd+Shift+E 로 넣은 빈 수식. */
  openInlineEquation?: (ref: InlineEquationRef) => void
  /** 마지막으로 쓴 색(Phase 2 1e-1) — 없으면 이 브라우저의 기억(`last-color.ts`). 검사가 바꿔 끼운다. */
  lastColor?: () => Color | null
  /**
   * 되돌리기 · 다시 하기. 없으면 ProseMirror history(Phase 0 편집기). 협업 편집기는 y-prosemirror 의 것을 넘긴다 — 내 편집만
   * 되돌린다(F-05-15 · `collab/collab-editor.ts`).
   */
  history?: { readonly undo: Command; readonly redo: Command }
  /**
   * 명령이 던지면 키를 삼킨다(`createKeydownHandler`). 협업 편집기는 수선이 도착하기 전까지 스키마를 어긴 문서를 볼 수 있고
   * (HANDOFF §7) 명령은 그 모양을 전제하지 않았다 — 진단에서 타입이 동시에 바뀐 블록 뒤의 Backspace 가 던졌다. 명령은
   * dispatch 하기 전에 던지므로 문서는 그대로다. Phase 0 편집기는 켜지 않는다 — 거기서 던지면 버그다.
   */
  swallowCommandErrors?: boolean
}

/**
 * 전체 키맵. F-12-01 의 P0 최소 세트를 덮는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 모드 의존 키는 "블록 선택이 먼저"로 표현한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-12-01: *"단축키는 **모드 의존적**이다. 편집 모드(caret 있음)와 블록 선택
 * 모드(caret 없음)에서 같은 키가 다르게 동작한다."*
 *
 * 모드를 나타내는 플래그를 따로 두지 않는다. 블록 선택용 커맨드는 전부
 * `state.selection instanceof BlockSelection` 이 아니면 `false` 를 돌려주므로,
 * `chain(블록선택용, 편집용)` 한 줄이 곧 분기다. 판정의 진실이 selection 하나뿐이라
 * 모드가 어긋날 자리가 없다.
 *
 * 빠진 것: `/` 메뉴(별도 플러그인), 드래그 핸들과 그 메뉴(F-01-08 의 나머지).
 * 심플 테이블(Phase 2 1d)의 셀 안 키(Tab · Enter · Shift+Enter · 셀 끝의 지우기)는 각 사슬의 앞자리다(`table.ts`) — 셀 밖이면 물러선다.
 */
export function createEditorKeymap(deps: EditorKeymapDeps): KeyBindings {
  const block = createBlockKeymap(deps)

  const bindings: Record<string, Command> = {
    ...block,

    // ★ 순서가 동작을 정의한다 — 파일 머리말 참조.
    // 빈 컬럼의 유일한 빈 블록 맨 앞 — 그 컬럼을 지운다(Phase 2 1c-2). 병합보다 먼저(병합은 컬럼 경계에서 키를 삼킨다).
    Backspace: chain(deleteBlockSelectionCommand(deps), undoInputRuleCommand(), tableEdgeDeleteCommand(-1), removeEmptyColumnCommand(), block.Backspace),
    Delete: chain(deleteBlockSelectionCommand(deps), tableEdgeDeleteCommand(1), block.Delete),
    // 셀 안(Phase 2 1d) — 옆 셀 · 줄바꿈. 셀 밖이면 블록의 들여쓰기 · 줄바꿈.
    Tab: chain(tableTabCommand(1, deps.newId), block.Tab),
    'Shift-Tab': chain(tableTabCommand(-1, deps.newId), block['Shift-Tab']),
    'Shift-Enter': chain(tableSoftBreakCommand(), block['Shift-Enter']),
    // 블록 선택 상태의 Enter 는 "이 블록을 편집한다"이지 분할이 아니다. 골라진 블록 수식이면 그 입력창이 "편집"이다(Phase 2 1a).
    Enter: chain(
      ...(deps.openEquation ? [openEquationCommand(deps.openEquation)] : []),
      ...(deps.openInlineEquation ? [openSelectedInlineEquationCommand(deps.openInlineEquation)] : []),
      exitBlockSelectionCommand(),
      // 셀 안의 Enter 는 아래 셀(Phase 2 1d) — 블록을 쪼개지 않는다.
      tableEnterCommand(deps.newId),
      block.Enter,
    ),

    // Esc 는 한 번 누르면 들어가고 한 번 더 누르면 나온다.
    Escape: chain(exitBlockSelectionCommand(), selectBlockCommand()),

    'Shift-ArrowUp': extendBlockSelectionCommand(-1, deps),
    'Shift-ArrowDown': extendBlockSelectionCommand(1, deps),
    ArrowUp: moveBlockSelectionCommand(-1, deps),
    ArrowDown: moveBlockSelectionCommand(1, deps),

    // ⚠ 위 둘과 다르다. `moveBlockSelection` 은 **선택을** 이웃으로 옮기고
    // 이쪽은 **블록 자체를** 옮긴다. 편집 모드에서도 동작한다(F-01-08).
    'Mod-Shift-ArrowUp': moveBlocksCommand(-1, deps),
    'Mod-Shift-ArrowDown': moveBlocksCommand(1, deps),

    'Mod-d': duplicateBlockSelectionCommand(deps),
    'Mod-a': selectAllBlocksCommand(),

    'Mod-b': toggleFormat('bold'),
    'Mod-i': toggleFormat('italic'),
    'Mod-u': toggleFormat('underline'),
    'Mod-Shift-s': toggleFormat('strikethrough'),
    'Mod-e': toggleFormat('code'),

    'Mod-z': deps.history?.undo ?? undo,
    'Mod-Shift-z': deps.history?.redo ?? redo,
    // Windows 관례. Mac 에서도 눌러 봤을 때 되는 편이 낫다.
    'Mod-y': deps.history?.redo ?? redo,

    // 마지막으로 쓴 색을 다시(F-01-21 시나리오 4 · Phase 2 1e-1) — 고른 글자면 그 글자, 아니면 블록 색. 마지막 색은 이 브라우저의
    // 상태다(`last-color.ts`). 없으면 키를 넘긴다.
    'Mod-Shift-h': reapplyColorCommand(deps.lastColor ?? lastColor),
  }

  if (deps.promptLink) {
    const prompt = deps.promptLink
    bindings['Mod-k'] = () => {
      prompt()
      return true
    }
  }

  if (deps.openBlockMenu) {
    bindings['Mod-/'] = openBlockMenuCommand(deps.openBlockMenu)
  }

  // 인라인 수식(Phase 2 1b · F-01-20 ②③) — 고른 글자를 수식으로, 고른 것이 없으면 빈 수식을 넣고 입력창.
  if (deps.openInlineEquation) {
    bindings['Mod-Shift-e'] = insertInlineEquationCommand(deps.openInlineEquation)
  }

  for (const [digit, type] of Object.entries(NUMBER_SHORTCUTS)) {
    // 블록 선택 상태면 선택 전부를, 아니면 캐럿이 있는 블록 하나를 바꾼다.
    bindings[`Mod-Alt-${digit}`] = chain(
      turnSelectionIntoCommand(type, deps),
      turnIntoCommand(type, deps),
    )
  }

  return bindings
}

/**
 * `handleKeyDown` prop 으로 넣을 함수.
 *
 * **조합 중이면 아무 바인딩도 실행하지 않는다.** §7-4 완화 전략 ④,
 * F-01-19: "`compositionend` 전에 분할하면 조합 문자가 유실된다."
 * 게이트가 여기 하나뿐이라 빠뜨릴 자리가 없다.
 */
export function createKeydownHandler(
  deps: EditorKeymapDeps,
): (
  view: { composing: boolean; state: EditorState; dispatch: (tr: Transaction) => void },
  event: KeyboardEvent,
) => boolean {
  const handler = keydownHandler(createEditorKeymap(deps) as Record<string, Command>)

  return (view, event) => {
    if (isComposingEvent(view, event)) return false
    // keydownHandler 는 prosemirror-view 의 EditorView 를 기대하지만 실제로
    // 쓰는 것은 state·dispatch 뿐이다. 테스트에서 view 없이 돌리기 위해 좁힌다.
    if (!deps.swallowCommandErrors) return handler(view as never, event)
    try {
      return handler(view as never, event)
    } catch (error) {
      // 수선이 곧 온다 — 이 키만 먹고 문서는 건드리지 않는다(`EditorKeymapDeps.swallowCommandErrors`).
      console.warn('[editor] 스키마를 어긴 문서에서 명령이 던졌다 — 키를 삼킨다:', error)
      return true
    }
  }
}
