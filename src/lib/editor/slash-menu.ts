/**
 * 슬래시(`/`) 커맨드 메뉴 — F-01-04
 *
 * 정본: 01-block-editor.md F-01-04
 *
 * ──────────────────────────────────────────────────────────────────────
 * 레지스트리에서 생성한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-01-04 데이터 모델 함의: *"커맨드 레지스트리는
 * `{id, label, aliases[], keywords[], category, group, handler}` 구조로,
 * **F-01-02 의 블록 타입 레지스트리에서 자동 생성**하는 것이 유지보수에 유리."*
 *
 * 라벨과 별칭은 레지스트리에 없으므로 여기 표가 필요하다. 다만 그 표를
 * `Record<BodyBlockType, …>` 로 선언해 **레지스트리에 타입을 추가하면 이 파일이
 * 컴파일되지 않게** 했다. 목록이 조용히 어긋나는 것을 타입 검사가 막는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 여기서 정한 것 (정본이 `[확인필요]` 로 남긴 항목)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본 "미해결" 16번: *"슬래시 메뉴의 필터 방식(prefix vs fuzzy)과 `/` 트리거
 * 종료 조건"* — 앱 실측 대상이지만 구현하려면 지금 정해야 한다.
 *
 *   ① **필터는 prefix 다.** 라벨과 별칭 각각에 대해 앞부분 일치.
 *      fuzzy 는 `/h1` 을 쳤을 때 예상 밖 항목이 섞여 나오고, "왜 이게 나오지"를
 *      사용자가 예측할 수 없다. 항목이 10여 개인 MVP 에서는 prefix 로 충분하다.
 *   ② **종료 조건은 셋이다.** ⓐ 쿼리에 공백이 들어옴 ⓑ 매칭 0건 ⓒ 캐럿이
 *      트리거 지점 앞으로 가거나 다른 블록으로 이동. ⓐⓑ는 정본이 서술한
 *      동작("`/` 뒤에 공백이 오면 닫힘", "매칭 0건이면 닫히고 평문 유지")이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 트리거 조건
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본 엣지 케이스: *"문장 중간의 `https://` 안 슬래시 → 메뉴가 열리면 안 됨
 * → **트리거 조건: `/` 앞이 줄 시작 또는 공백일 때만**."* 그대로 구현한다.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'

import { BODY_BLOCK_TYPES, specOf, type BodyBlockType } from '../block/types.ts'
import { applyTurnInto, insertParagraphAfter, type CommandDeps } from './commands.ts'
import { containerAt } from './pm-blocks.ts'
import { COLORS, type Color } from '../contracts/rich-text.ts'
import { colorAliases, colorLabel } from './color-names.ts'
import { isPlainTextNode, TABLE_CELL_NODE } from './schema.ts'

type SlashCommandBase = {
  readonly label: string
  /** 검색 대상. 한글·영문을 함께 둔다. */
  readonly aliases: readonly string[]
  readonly group: '기본 블록' | '페이지' | '미디어' | '고급 블록' | '색'
}

/** 블록 타입 변환. 트랜잭션 하나로 끝난다. */
export type BlockSlashCommand = SlashCommandBase & {
  readonly kind: 'block'
  readonly id: BodyBlockType
}

/**
 * 하위 페이지 만들기 (F-02-13).
 *
 * 다른 커맨드와 달리 **서버 왕복이 필요하다** — 진짜 `block` 행을 만들어야
 * 그 id 로 참조 노드를 넣을 수 있다. 그래서 `runSlashCommand` 가 처리하지 않고
 * 호출자가 비동기로 다룬다(타입이 그걸 강제한다).
 */
export type PageSlashCommand = SlashCommandBase & {
  readonly kind: 'page'
  readonly id: 'page'
}

/**
 * 컬럼 만들기(Phase 2 1c · F-01-12) — 블록 타입이 아니다. 컬럼의 틀은 `/` 로 하나씩 만들지 않고 N열째로 만든다(`columns.ts`).
 */
export type ColumnsSlashCommand = SlashCommandBase & {
  readonly kind: 'columns'
  readonly id: 'columns_2' | 'columns_3'
  readonly count: 2 | 3
}

/** 심플 테이블(Phase 2 1d · F-01-18) — 블록 타입 목록 밖이다. 표째로 만든다(`table.ts`). */
export type TableSlashCommand = SlashCommandBase & { readonly kind: 'table'; readonly id: 'table' }

/**
 * 블록 색(Phase 2 1e-1 · F-01-21 시나리오 2 — 노션의 `/red` · `/blue background`) — 그 블록 전체의 색. 블록 타입이 아니다
 * (`block-color.ts`). `default` 는 색을 지운다.
 */
export type ColorSlashCommand = SlashCommandBase & { readonly kind: 'color'; readonly id: `color:${Color}`; readonly color: Color }

export type SlashCommand = BlockSlashCommand | PageSlashCommand | ColumnsSlashCommand | TableSlashCommand | ColorSlashCommand

/**
 * 타입별 라벨·별칭.
 *
 * `Record<BodyBlockType, …>` 이므로 레지스트리에 타입을 추가하면 **여기가
 * 컴파일 에러**가 된다. "슬래시 메뉴에만 없는 타입"이 생기지 않는다.
 */
const CATALOG: Readonly<Record<BodyBlockType, SlashCommandBase>> = {
  paragraph: { label: '텍스트', aliases: ['텍스트', 'text', 'p', '문단'], group: '기본 블록' },
  heading_1: { label: '제목 1', aliases: ['제목1', 'h1', 'heading1', '헤딩1'], group: '기본 블록' },
  heading_2: { label: '제목 2', aliases: ['제목2', 'h2', 'heading2', '헤딩2'], group: '기본 블록' },
  heading_3: { label: '제목 3', aliases: ['제목3', 'h3', 'heading3', '헤딩3'], group: '기본 블록' },
  bulleted_list_item: {
    label: '글머리 기호 목록',
    aliases: ['글머리', '목록', 'bullet', 'ul', 'list'],
    group: '기본 블록',
  },
  numbered_list_item: {
    label: '번호 매기기 목록',
    aliases: ['번호', 'number', 'ol', 'numbered'],
    group: '기본 블록',
  },
  to_do: { label: '할 일 목록', aliases: ['할일', 'todo', 'checkbox', '체크'], group: '기본 블록' },
  toggle: { label: '토글 목록', aliases: ['토글', 'toggle'], group: '기본 블록' },
  quote: { label: '인용', aliases: ['인용', 'quote'], group: '기본 블록' },
  callout: { label: '콜아웃', aliases: ['콜아웃', 'callout'], group: '기본 블록' },
  divider: { label: '구분선', aliases: ['구분선', 'divider', 'div', 'hr'], group: '기본 블록' },
  image: { label: '이미지', aliases: ['이미지', 'image', 'img', '사진'], group: '미디어' },
  code: { label: '코드', aliases: ['코드', 'code', 'codeblock', '```'], group: '기본 블록' },
  // 목차(8b-1) — 노션의 'Advanced blocks' 자리.
  table_of_contents: { label: '목차', aliases: ['목차', '차례', 'toc', 'table of contents', 'contents'], group: '고급 블록' },
  breadcrumb: { label: '이동 경로', aliases: ['이동 경로', '경로', '이동경로', 'breadcrumb', 'bread'], group: '고급 블록' },
  // 블록 수식(Phase 2 1a · F-01-20 — 노션의 `/math` · `/latex`).
  equation: { label: '블록 수식', aliases: ['수식', '블록 수식', '방정식', 'math', 'latex', 'tex', 'equation', 'katex'], group: '고급 블록' },
  // 버튼 블록(자동화 5e-1 · F-08-06 — 노션의 `/button`). 구 `/template` 도 받는다(08 *"구 template button 의 후신"*).
  button: { label: '버튼', aliases: ['버튼', 'button', 'template', '템플릿 버튼'], group: '고급 블록' },
}

/**
 * 블록 타입의 화면 이름. 블록 메뉴의 "변환" 목록(`block-menu.ts`)이 같은 이름을
 * 쓴다 — 두 벌로 두면 슬래시 메뉴에서는 "할 일 목록"인데 핸들 메뉴에서는
 * "체크리스트"가 되는 식으로 어긋난다.
 */
export function blockTypeLabel(type: BodyBlockType): string {
  return CATALOG[type].label
}

/** 하위 페이지. 레지스트리의 블록 타입이 아니므로 여기 따로 둔다. */
const PAGE_COMMAND: PageSlashCommand = {
  kind: 'page',
  id: 'page',
  label: '페이지',
  aliases: ['페이지', 'page', '하위페이지', 'subpage'],
  group: '페이지',
}

/** 컬럼(Phase 2 1c) — 노션의 Layout 자리. "열" · "컬럼"으로 둘 다 찾는다. */
const COLUMN_COMMANDS: readonly ColumnsSlashCommand[] = [
  { kind: 'columns', id: 'columns_2', count: 2, label: '2열', aliases: ['2열', '2단', '2 columns', '2columns', '컬럼', 'columns', '열'], group: '고급 블록' },
  { kind: 'columns', id: 'columns_3', count: 3, label: '3열', aliases: ['3열', '3단', '3 columns', '3columns', '컬럼', 'columns', '열'], group: '고급 블록' },
]

/** 심플 테이블(Phase 2 1d) — 노션의 `/table` 첫 항목. "표" · "테이블"로 찾는다. */
const TABLE_COMMAND: TableSlashCommand = {
  kind: 'table', id: 'table', label: '표', aliases: ['표', '테이블', 'table', '심플 테이블', 'simple table'], group: '고급 블록',
}

/** 색(1e-1) — 기본 · 글자색 9 · 배경색 9. 메뉴의 맨 끝(노션과 같다). "색" · "color" 로 모두 찾는다. */
const COLOR_COMMANDS: readonly ColorSlashCommand[] = COLORS.map((color) => ({
  kind: 'color', id: `color:${color}`, color, label: colorLabel(color), aliases: colorAliases(color), group: '색',
}))

const BLOCK_COMMANDS: readonly BlockSlashCommand[] = BODY_BLOCK_TYPES.map((id) => ({
  kind: 'block',
  id,
  ...CATALOG[id],
}))

/**
 * 메뉴에 나오는 커맨드 전부. 순서가 곧 노출 순서다.
 *
 * 기본 블록 → 페이지 → 미디어 → 고급 블록. 그룹으로 갈라 조립하므로 레지스트리에 타입이
 * 늘어나도 자기 그룹 안에 알아서 들어간다.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  ...BLOCK_COMMANDS.filter((c) => c.group === '기본 블록'),
  PAGE_COMMAND,
  ...BLOCK_COMMANDS.filter((c) => c.group === '미디어'),
  ...BLOCK_COMMANDS.filter((c) => c.group === '고급 블록'),
  TABLE_COMMAND,
  ...COLUMN_COMMANDS,
  ...COLOR_COMMANDS,
]

/**
 * prefix 필터.
 *
 * 라벨과 별칭 **각각**에 대해 앞부분 일치를 본다. 라벨의 공백을 지운 형태도
 * 함께 본다 — "제목 1"을 찾으려고 `/제목1` 을 치는 것이 자연스럽다.
 */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...SLASH_COMMANDS]

  return SLASH_COMMANDS.filter((command) => {
    const targets = [command.label, command.label.replace(/\s+/g, ''), ...command.aliases]
    return targets.some((t) => t.toLowerCase().startsWith(q))
  })
}

// ── 플러그인 상태 ─────────────────────────────────────────────────────

export type SlashMenuState = {
  readonly active: boolean
  /** `/` 문자의 위치. 실행 시 여기부터 캐럿까지를 지운다. */
  readonly from: number
  /** `/` 뒤에 입력된 문자열. */
  readonly query: string
}

const INACTIVE: SlashMenuState = { active: false, from: -1, query: '' }

export const slashMenuKey = new PluginKey<SlashMenuState>('slashMenu')

/** 명시적으로 닫는다(Esc, 실행 후). */
export function closeSlashMenu(tr: Transaction): Transaction {
  return tr.setMeta(slashMenuKey, { close: true })
}

/**
 * `/` 앞이 줄 시작 또는 공백인가.
 *
 * 이 한 줄이 `https://` 문제를 막는다(정본 엣지 케이스).
 */
function isTriggerPosition(state: EditorState, slashPos: number): boolean {
  const $slash = state.doc.resolve(slashPos)
  // 텍스트블록 안이 아니면 트리거하지 않는다. 코드 블록(평문 본문) 안의 `/` 는 글자다(F-01-14 · F-01-04). 표의 셀 안도 글자다
  // (Phase 2 1d — 셀은 블록을 담지 않는다 · 블록 명령이 표를 통째로 바꾼다).
  if (!$slash.parent.isTextblock || isPlainTextNode($slash.parent) || $slash.parent.type.name === TABLE_CELL_NODE) return false
  if ($slash.parentOffset === 0) return true
  const before = $slash.parent.textBetween($slash.parentOffset - 1, $slash.parentOffset)
  return /\s/.test(before)
}

function computeState(prev: SlashMenuState, tr: Transaction, next: EditorState): SlashMenuState {
  const meta = tr.getMeta(slashMenuKey) as { close?: boolean } | undefined
  if (meta?.close) return INACTIVE

  const { $from, empty } = next.selection
  if (!empty || !$from.parent.isTextblock || isPlainTextNode($from.parent)) return INACTIVE

  if (prev.active) {
    const from = tr.mapping.map(prev.from)
    const head = next.selection.head

    // 캐럿이 트리거 앞으로 갔거나 다른 블록으로 넘어갔다.
    if (head <= from) return INACTIVE
    const $slash = next.doc.resolve(from)
    if ($slash.parent !== $from.parent) return INACTIVE
    // `/` 가 지워졌다.
    if (next.doc.textBetween(from, from + 1) !== '/') return INACTIVE

    const query = next.doc.textBetween(from + 1, head)
    // 종료 조건 ⓐ 공백 ⓑ 매칭 0건
    if (/\s/.test(query)) return INACTIVE
    if (filterSlashCommands(query).length === 0) return INACTIVE

    return { active: true, from, query }
  }

  // 새로 열리는가 — 방금 입력된 글자가 `/` 인가.
  if (!tr.docChanged) return INACTIVE
  const head = next.selection.head
  if (head < 1) return INACTIVE
  if (next.doc.textBetween(head - 1, head) !== '/') return INACTIVE
  if (!isTriggerPosition(next, head - 1)) return INACTIVE

  return { active: true, from: head - 1, query: '' }
}

export function slashMenuPlugin(): Plugin<SlashMenuState> {
  return new Plugin<SlashMenuState>({
    key: slashMenuKey,
    state: {
      init: () => INACTIVE,
      apply: (tr, value, _old, next) => computeState(value, tr, next),
    },
  })
}

export function slashMenuState(state: EditorState): SlashMenuState {
  return slashMenuKey.getState(state) ?? INACTIVE
}

// ── 실행 ──────────────────────────────────────────────────────────────

/**
 * 커맨드 실행 — `/` 와 쿼리를 지우고 나서 타입을 바꾼다.
 *
 * 정본 시나리오 3: *"`/` 와 뒤에 입력한 쿼리 문자열은 **삭제되고** 블록이
 * 해당 타입으로 생성/변환됨."*
 *
 * 지우기와 변환이 **한 트랜잭션**이어야 한다. 두 개로 나누면 Cmd+Z 를 두 번
 * 눌러야 원상복구된다 — F-01-19 가 분할에 대해 요구한 것과 같은 이유다.
 * 그래서 `commands.ts` 가 변환을 커맨드가 아니라 **트랜잭션 변형**
 * (`applyTurnInto`)으로도 내보낸다.
 */
export function runSlashCommand(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  command: BlockSlashCommand,
  deps: CommandDeps,
): boolean {
  const menu = slashMenuState(state)
  if (!menu.active) return false

  const info = containerAt(state.selection.$from)
  if (!info) return false

  // 텍스트를 담지 않는 타입(divider·image)으로 바꾸려는데 `/쿼리` 말고 다른
  // 텍스트가 남아 있으면 그 텍스트가 사라진다. 그 경우는 변환하지 않는다.
  const head = state.selection.head
  const typedLength = head - menu.from
  if (!specOf(command.id).hasRichText && info.contentNode.content.size > typedLength) {
    return false
  }

  if (!dispatch) return true

  const tr = state.tr.delete(menu.from, head)
  closeSlashMenu(tr)
  // 이미 그 타입이면 applyTurnInto 가 false 를 돌려준다 — 지우기만으로 충분하다.
  const turned = applyTurnInto(tr, info.id, command.id, deps, 0)
  // 텍스트를 담지 않는 타입(구분선 · 이미지 · 목차)으로 바꾸면 캐럿을 둘 자리가 없다 — 뒤에 빈 문단을 만들고 캐럿을 그리로(입력 규칙
  // `---` 와 같은 모양 · 8b-1). 전에는 그 블록이 노드 선택으로 남아 Enter 도 글자도 받지 않았다 — 페이지의 마지막 줄이면 이어 쓸 길이 없었다.
  if (turned && !specOf(command.id).hasRichText) insertParagraphAfter(tr, info.id, deps.newId?.())

  dispatch(tr.scrollIntoView())
  return true
}

// ── 하위 페이지 (F-02-13) ─────────────────────────────────────────────
//
// 참조 노드를 여기서 넣지 않는다. 서버(`block/page.ts` `createPage` 의 `at`)가 캐럿이 있던 블록 자리에 넣고, 참여자에게는
// 동기화로 온다 — 로컬에도 넣으면 같은 참조가 둘이 되어 문서 순서의 첫째만 남는다(HANDOFF §3.2-24 · 3.3-119).
