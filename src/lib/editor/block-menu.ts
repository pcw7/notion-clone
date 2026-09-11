/**
 * 블록 메뉴 — F-01-08 (핸들 메뉴) · F-12-01 (`Mod+/`) · F-12-13 (메뉴 접근성)
 *
 * 정본: 01-block-editor.md F-01-08 시나리오 4 — *"`⋮⋮` 클릭 → 메뉴: Turn into,
 * Color, Copy link to block, Duplicate, Move to, Delete, Comment, Suggest edits,
 * Ask AI, Word and character count."* 12-platform-ux.md F-12-01 — *"우클릭 또는
 * `cmd/ctrl + /` 로 블록 컨텍스트 메뉴."*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무엇을 넣고 무엇을 뺐나
 * ──────────────────────────────────────────────────────────────────────
 *
 *   넣음: 변환 · 색 · 복제 · 블록 링크 복사 · 삭제
 *   뺌:   Move to(정본 P1) · Comment · Suggest edits(판결 U-2, 이후 단계) ·
 *         Ask AI(F-10, Phase 2 — 토큰 하드 캡 게이트와 동시에만 들어온다) ·
 *         Word count
 *
 * 넣은 항목의 **동작은 새로 만들지 않았다.** 변환·복제·삭제는 블록 선택(#27)의
 * 커맨드이고, 메뉴는 그것을 부를 뿐이다. 새로 생긴 동작은 둘이다 — 블록 색
 * (`setBlockColorCommand`)과 링크로 들어왔을 때 그 블록을 보여주기
 * (`revealBlockCommand`). 링크를 복사만 하고 받는 쪽이 없으면 반쪽이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 메뉴 모델과 키보드 이동도 여기 있다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 화면(`block-menu.tsx`)은 그리기만 한다. 어떤 항목이 켜져 있는지(`blockMenuItems`),
 * 키 하나가 커서를 어디로 옮기는지(`navigateMenu`)는 순수 함수라 DOM 없이
 * 테스트된다. F-12-13 이 요구한 키보드 조작이 "화면에서 대충 됐다"가 아니라
 * 규칙으로 고정된다.
 */

import type { Command, EditorState } from '@tiptap/pm/state'

import { normalizeFormat, PAGE_TYPE, specOf, type BlockFormat, type MvpBlockType } from '../block/types.ts'
import { COLORS, type Color } from '../contracts/rich-text.ts'
import { isUuid } from '../ids.ts'
import { BlockSelection, isBlockSelection, selectionHasPageRef } from './block-selection.ts'
import { applyTurnInto, type CommandDeps } from './commands.ts'
import { blockTypeOf, containerAt, findContainerById } from './pm-blocks.ts'
import { blockTypeLabel } from './slash-menu.ts'

// ── 항목 ──────────────────────────────────────────────────────────────

/**
 * "변환" 목록. 텍스트를 담는 타입만이다 — 노션의 Turn into 도 구분선·이미지를
 * 두지 않는다. 텍스트가 있는 블록을 구분선으로 바꾸면 텍스트가 사라지고,
 * `applyTurnInto` 는 그것을 거부한다(빈 블록만 허용).
 */
export const TURN_INTO_TYPES: readonly MvpBlockType[] = [
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'quote',
  'callout',
]

const COLOR_NAMES: Readonly<Record<string, string>> = {
  gray: '회색',
  brown: '갈색',
  orange: '주황',
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  purple: '보라',
  pink: '분홍',
  red: '빨강',
}

/** 색의 화면 이름. `default` 는 "색 없음"이다 — 계약에 `default_background` 가 없는 것과 같은 이유. */
export function colorLabel(color: Color): string {
  if (color === 'default') return '기본'
  if (color.endsWith('_background')) return `${COLOR_NAMES[color.slice(0, -'_background'.length)]} 배경`
  return COLOR_NAMES[color] ?? color
}

export type BlockMenuAction =
  | { readonly kind: 'turn_into'; readonly type: MvpBlockType }
  | { readonly kind: 'color'; readonly color: Color }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'copy_link' }
  | { readonly kind: 'delete' }

export type MenuItem = {
  readonly id: string
  readonly label: string
  readonly enabled: boolean
  /** 라디오 항목이면 현재 값인지. 아니면 없다. */
  readonly checked?: boolean
  /** 화면에 보여줄 단축키. */
  readonly shortcut?: string
  /** 하위 메뉴가 있으면 이 항목은 동작이 아니라 열기다. */
  readonly children?: readonly MenuItem[]
  readonly action?: BlockMenuAction
}

/** 블록 선택의 최상위 블록들 — 내용 노드와 함께. */
function selectedBlocks(state: EditorState) {
  const sel = state.selection
  if (!isBlockSelection(sel)) return []
  return sel.rootPositions.flatMap((pos) => {
    const container = state.doc.nodeAt(pos)
    if (!container) return []
    const content = container.child(0)
    return [{ pos, id: String(container.attrs.blockId ?? ''), content, type: blockTypeOf(content) }]
  })
}

/**
 * 블록 색을 지원하는 블록인가.
 *
 * 레지스트리의 `supportsColor` 에 **하위 페이지 참조를 뺀다.** `page` 는 레지스트리상
 * 색을 지원하지만(페이지 자체의 속성), 본문의 참조 노드에 칠한 색은 프로젝터가
 * 쓰지 않는다 — 자식 페이지 행은 "순서와 부모만" 건드린다(`save-page-body.ts`).
 * 칠해진 것처럼 보이다가 새로고침하면 사라진다.
 */
function colorable(type: ReturnType<typeof blockTypeOf>): boolean {
  return type !== PAGE_TYPE && specOf(type).supportsColor
}

/**
 * 지금 선택에 대한 메뉴. 켜짐/꺼짐과 현재 값을 **문서에서** 계산한다.
 *
 * 꺼진 항목은 숨기지 않고 `enabled: false` 로 둔다. 메뉴 모양이 선택에 따라
 * 바뀌면 손이 기억한 위치가 틀어진다(`aria-disabled` 로 읽힌다).
 */
export function blockMenuItems(state: EditorState, deps: CommandDeps): MenuItem[] {
  const blocks = selectedBlocks(state)
  const sel = state.selection
  const hasPageRef = isBlockSelection(sel) && selectionHasPageRef(state.doc, sel.rootPositions)

  const turnInto: MenuItem[] = TURN_INTO_TYPES.map((type) => ({
    id: `turn_into:${type}`,
    label: blockTypeLabel(type),
    // 하나라도 바뀌면 켠다. 변환은 블록마다 따로 적용된다(F-01-09: "각 블록 개별 변환").
    // 판정은 실제 변환 함수에 버리는 트랜잭션을 줘서 묻는다 — 규칙을 두 벌로 두지 않는다.
    enabled: blocks.some((b) => applyTurnInto(state.tr, b.id, type, deps, 0)),
    checked: blocks.length > 0 && blocks.every((b) => b.type === type),
    action: { kind: 'turn_into', type },
  }))

  const paintable = blocks.filter((b) => colorable(b.type))
  const currentColor = (b: (typeof blocks)[number]): Color =>
    ((b.content.attrs.format as BlockFormat | undefined)?.block_color ?? 'default') as Color
  const color: MenuItem[] = COLORS.map((c) => ({
    id: `color:${c}`,
    label: colorLabel(c),
    enabled: paintable.length > 0,
    checked: paintable.length > 0 && paintable.every((b) => currentColor(b) === c),
    action: { kind: 'color', color: c },
  }))

  return [
    {
      id: 'turn_into',
      label: '변환',
      shortcut: 'Mod-Alt-숫자',
      enabled: turnInto.some((i) => i.enabled),
      children: turnInto,
    },
    { id: 'color', label: '색', enabled: paintable.length > 0, children: color },
    {
      id: 'duplicate',
      label: '복제',
      shortcut: 'Mod-D',
      // 하위 페이지는 삭제·복제를 거부한다(#27). 커맨드도 거부하지만 메뉴에서
      // 먼저 꺼 두면 눌러보고 나서야 안 되는 줄 아는 일이 없다.
      enabled: blocks.length > 0 && !hasPageRef,
      action: { kind: 'duplicate' },
    },
    {
      id: 'copy_link',
      label: '블록 링크 복사',
      enabled: blocks.length > 0,
      action: { kind: 'copy_link' },
    },
    {
      id: 'delete',
      label: '삭제',
      shortcut: 'Del',
      enabled: blocks.length > 0 && !hasPageRef,
      action: { kind: 'delete' },
    },
  ]
}

// ── 키보드 이동 (F-12-13) ─────────────────────────────────────────────

/** 커서. `sub` 가 null 이 아니면 `index` 항목의 하위 메뉴 안 `sub` 번째에 있다. */
export type MenuCursor = { readonly index: number; readonly sub: number | null }

export type MenuNav =
  | { readonly kind: 'move'; readonly cursor: MenuCursor }
  | { readonly kind: 'activate'; readonly item: MenuItem }
  | { readonly kind: 'close' }
  | { readonly kind: 'none' }

/** `from` 에서 `step` 방향으로 가며 처음 만나는 켜진 항목. 한 바퀴 돌면 제자리. */
function nextEnabled(items: readonly MenuItem[], from: number, step: 1 | -1): number {
  const n = items.length
  for (let i = 1; i <= n; i += 1) {
    const at = (((from + step * i) % n) + n) % n
    if (items[at].enabled) return at
  }
  return from
}

export function firstEnabled(items: readonly MenuItem[]): number {
  const i = items.findIndex((item) => item.enabled)
  return i < 0 ? 0 : i
}

function lastEnabled(items: readonly MenuItem[]): number {
  for (let i = items.length - 1; i >= 0; i -= 1) if (items[i].enabled) return i
  return 0
}

/**
 * 키 하나에 대한 메뉴의 반응.
 *
 * WAI-ARIA 메뉴 패턴을 따른다: ↑↓ 이동(꺼진 항목은 건너뛰고 끝에서 돈다), Home/End,
 * → · Enter · Space 로 하위 메뉴 열기, ← 로 하위 메뉴 닫기, Esc 는 하위 메뉴에서
 * 한 단계 · 최상위에서 메뉴 닫기, Tab 은 메뉴 닫기.
 */
export function navigateMenu(items: readonly MenuItem[], cursor: MenuCursor, key: string): MenuNav {
  const top = items[cursor.index]
  if (!top) return { kind: 'close' }

  if (cursor.sub === null) {
    switch (key) {
      case 'ArrowDown':
        return { kind: 'move', cursor: { index: nextEnabled(items, cursor.index, 1), sub: null } }
      case 'ArrowUp':
        return { kind: 'move', cursor: { index: nextEnabled(items, cursor.index, -1), sub: null } }
      case 'Home':
        return { kind: 'move', cursor: { index: firstEnabled(items), sub: null } }
      case 'End':
        return { kind: 'move', cursor: { index: lastEnabled(items), sub: null } }
      case 'ArrowRight':
      case 'Enter':
      case ' ':
        if (!top.enabled) return { kind: 'none' }
        if (top.children) return { kind: 'move', cursor: { index: cursor.index, sub: firstEnabled(top.children) } }
        return key === 'ArrowRight' ? { kind: 'none' } : { kind: 'activate', item: top }
      case 'Escape':
      case 'Tab':
        return { kind: 'close' }
      default:
        return { kind: 'none' }
    }
  }

  const children = top.children ?? []
  const child = children[cursor.sub]
  switch (key) {
    case 'ArrowDown':
      return { kind: 'move', cursor: { index: cursor.index, sub: nextEnabled(children, cursor.sub, 1) } }
    case 'ArrowUp':
      return { kind: 'move', cursor: { index: cursor.index, sub: nextEnabled(children, cursor.sub, -1) } }
    case 'Home':
      return { kind: 'move', cursor: { index: cursor.index, sub: firstEnabled(children) } }
    case 'End':
      return { kind: 'move', cursor: { index: cursor.index, sub: lastEnabled(children) } }
    case 'ArrowLeft':
    case 'Escape':
      return { kind: 'move', cursor: { index: cursor.index, sub: null } }
    case 'Enter':
    case ' ':
      return child?.enabled ? { kind: 'activate', item: child } : { kind: 'none' }
    case 'Tab':
      return { kind: 'close' }
    default:
      return { kind: 'none' }
  }
}

// ── 새 동작 ① 블록 색 (F-01-21) ───────────────────────────────────────

/**
 * 선택된 블록 전부의 블록 색을 바꾼다. `default` 는 색을 **지운다.**
 *
 * 인라인 글자색(`setTextColor`, 문자 범위)과는 **다른 계층**이다 — F-01-21:
 * *"문자 범위 단위인 rich text `annotations.color` 와는 별개의 두 번째 색상 계층."*
 * 블록 색은 `format.block_color` 에 들어가고 블록 전체(배경 포함)에 걸린다.
 *
 * 한 트랜잭션이다(undo 1회). 속성만 바꾸므로 위치가 밀리지 않고, 블록 선택이
 * 그대로 남는다.
 */
export function setBlockColorCommand(color: Color): Command {
  return (state, dispatch) => {
    if (!isBlockSelection(state.selection)) return false

    const tr = state.tr
    for (const b of selectedBlocks(state)) {
      if (!colorable(b.type)) continue
      const format = { ...((b.content.attrs.format ?? {}) as BlockFormat) }
      if (color === 'default') delete format.block_color
      else format.block_color = color
      const next = normalizeFormat(b.type, format)
      if ((b.content.attrs.format as BlockFormat | undefined)?.block_color === next.block_color) continue
      tr.setNodeMarkup(b.pos + 1, undefined, { ...b.content.attrs, format: next })
    }
    // 바뀐 것이 없어도 true — 메뉴에서 불렀으면 닫히기만 하면 된다.
    if (dispatch && tr.docChanged) dispatch(tr)
    return true
  }
}

// ── 새 동작 ② 블록 링크 (F-01-08 "Copy link to block") ────────────────

/** 정본: *"`Copy link to block` 은 `/{pageId}#{blockId}` 형태 URL."* */
export function blockLinkPath(workspaceId: string, pageId: string, blockId: string): string {
  return `/w/${workspaceId}/${pageId}#${blockId}`
}

/** `#…` 에서 블록 id. uuid 가 아니면 null — 해시는 사용자가 아무거나 넣을 수 있다. */
export function blockIdFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return isUuid(raw) ? raw : null
}

/**
 * 링크로 들어왔을 때 그 블록을 **블록 선택으로** 보여준다.
 *
 * 접힌 조상 안에 있으면 조상을 펼친다 — 펼치지 않으면 선택은 됐는데 화면에 없다.
 * 펼침은 dispatch **뒤에**(`dropBlocksCommand` 와 같은 이유: 펼침이 빈 트랜잭션으로
 * 다시 그리게 하므로, 앞에서 부르면 우리 트랜잭션이 낡은 state 위에 얹힌다).
 */
export function revealBlockCommand(blockId: string, deps: CommandDeps): Command {
  return (state, dispatch) => {
    const info = findContainerById(state.doc, blockId)
    if (!info) return false

    const collapsedAncestors: string[] = []
    const $pos = state.doc.resolve(info.pos)
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const node = $pos.node(depth)
      if (node.type.name !== 'blockContainer') continue
      const id = String(node.attrs.blockId ?? '')
      if (deps.isCollapsed(id)) collapsedAncestors.push(id)
    }

    if (dispatch) {
      dispatch(state.tr.setSelection(BlockSelection.create(state.doc, info.pos)).scrollIntoView())
      for (const id of collapsedAncestors) deps.expand?.(id)
    }
    return true
  }
}

// ── 열기 (`Mod+/`) ────────────────────────────────────────────────────

/**
 * `Mod+/` — 블록 메뉴를 연다 (F-12-01 · F-01-06 "블록 선택 후 Cmd/Ctrl+/").
 *
 * 편집 모드면 캐럿이 있는 블록을 먼저 블록 선택으로 만든다. 메뉴의 모든 동작이
 * 블록 선택에 대해 정의되어 있어서, 선택 없이 열면 무엇에 대한 메뉴인지가 없다.
 *
 * 메뉴 UI 는 화면의 것이라 여는 함수를 밖에서 받는다(`promptLink` 와 같은 방식).
 */
export function openBlockMenuCommand(open: () => void): Command {
  return (state, dispatch) => {
    if (!isBlockSelection(state.selection)) {
      const info = containerAt(state.selection.$from)
      if (!info) return false
      if (dispatch) dispatch(state.tr.setSelection(BlockSelection.create(state.doc, info.pos)))
    }
    if (dispatch) open()
    return true
  }
}
