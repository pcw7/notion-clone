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
import {
  createBlockKeymap,
  isComposingEvent,
  turnIntoCommand,
  type CommandDeps,
  type KeyBindings,
} from './commands.ts'
import { undoInputRuleCommand } from './input-rules.ts'
import { setTextColor, toggleFormat } from './marks.ts'

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
 * 6=번호, 7=토글. 8(코드)·9(새 페이지)는 MVP 밖이라 비어 있다.
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
}

export type EditorKeymapDeps = CommandDeps & {
  /** Cmd+K. 링크 URL 을 물어보는 것은 UI 의 일이므로 밖에서 받는다. */
  promptLink?: () => void
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
 * 빠진 것: `/` 메뉴(별도 플러그인), 블록 이동 `Mod-Shift-↑↓`(F-01-08),
 * 표 관련(MVP 밖).
 */
export function createEditorKeymap(deps: EditorKeymapDeps): KeyBindings {
  const block = createBlockKeymap(deps)

  const bindings: Record<string, Command> = {
    ...block,

    // ★ 순서가 동작을 정의한다 — 파일 머리말 참조.
    Backspace: chain(deleteBlockSelectionCommand(deps), undoInputRuleCommand(), block.Backspace),
    Delete: chain(deleteBlockSelectionCommand(deps), block.Delete),
    // 블록 선택 상태의 Enter 는 "이 블록을 편집한다"이지 분할이 아니다.
    Enter: chain(exitBlockSelectionCommand(), block.Enter),

    // Esc 는 한 번 누르면 들어가고 한 번 더 누르면 나온다.
    Escape: chain(exitBlockSelectionCommand(), selectBlockCommand()),

    'Shift-ArrowUp': extendBlockSelectionCommand(-1, deps),
    'Shift-ArrowDown': extendBlockSelectionCommand(1, deps),
    ArrowUp: moveBlockSelectionCommand(-1, deps),
    ArrowDown: moveBlockSelectionCommand(1, deps),

    'Mod-d': duplicateBlockSelectionCommand(deps),
    'Mod-a': selectAllBlocksCommand(),

    'Mod-b': toggleFormat('bold'),
    'Mod-i': toggleFormat('italic'),
    'Mod-u': toggleFormat('underline'),
    'Mod-Shift-s': toggleFormat('strikethrough'),
    'Mod-e': toggleFormat('code'),

    'Mod-z': undo,
    'Mod-Shift-z': redo,
    // Windows 관례. Mac 에서도 눌러 봤을 때 되는 편이 낫다.
    'Mod-y': redo,

    // 마지막 색을 재적용하는 Cmd+Shift+H 는 "마지막 사용 색"을 기억해야 하므로
    // UI 상태가 필요하다. 색 해제만 여기 둔다.
    'Mod-Shift-h': setTextColor('default'),
  }

  if (deps.promptLink) {
    const prompt = deps.promptLink
    bindings['Mod-k'] = () => {
      prompt()
      return true
    }
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
    return handler(view as never, event)
  }
}
