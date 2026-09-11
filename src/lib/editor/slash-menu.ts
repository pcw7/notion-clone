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
 * `Record<MvpBlockType, …>` 로 선언해 **레지스트리에 타입을 추가하면 이 파일이
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

import { NodeSelection, Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'

import { MVP_BLOCK_TYPES, specOf, type MvpBlockType } from '../block/types.ts'
import { applyTurnInto, type CommandDeps } from './commands.ts'
import { containerAt, findContainerById } from './pm-blocks.ts'
import { blockSchema, PAGE_REF_NODE } from './schema.ts'

type SlashCommandBase = {
  readonly label: string
  /** 검색 대상. 한글·영문을 함께 둔다. */
  readonly aliases: readonly string[]
  readonly group: '기본 블록' | '페이지' | '미디어'
}

/** 블록 타입 변환. 트랜잭션 하나로 끝난다. */
export type BlockSlashCommand = SlashCommandBase & {
  readonly kind: 'block'
  readonly id: MvpBlockType
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

export type SlashCommand = BlockSlashCommand | PageSlashCommand

/**
 * 타입별 라벨·별칭.
 *
 * `Record<MvpBlockType, …>` 이므로 레지스트리에 타입을 추가하면 **여기가
 * 컴파일 에러**가 된다. "슬래시 메뉴에만 없는 타입"이 생기지 않는다.
 */
const CATALOG: Readonly<Record<MvpBlockType, SlashCommandBase>> = {
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
}

/**
 * 블록 타입의 화면 이름. 블록 메뉴의 "변환" 목록(`block-menu.ts`)이 같은 이름을
 * 쓴다 — 두 벌로 두면 슬래시 메뉴에서는 "할 일 목록"인데 핸들 메뉴에서는
 * "체크리스트"가 되는 식으로 어긋난다.
 */
export function blockTypeLabel(type: MvpBlockType): string {
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

const BLOCK_COMMANDS: readonly BlockSlashCommand[] = MVP_BLOCK_TYPES.map((id) => ({
  kind: 'block',
  id,
  ...CATALOG[id],
}))

/**
 * 메뉴에 나오는 커맨드 전부. 순서가 곧 노출 순서다.
 *
 * 기본 블록 → 페이지 → 미디어. 그룹으로 갈라 조립하므로 레지스트리에 타입이
 * 늘어나도 자기 그룹 안에 알아서 들어간다.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  ...BLOCK_COMMANDS.filter((c) => c.group === '기본 블록'),
  PAGE_COMMAND,
  ...BLOCK_COMMANDS.filter((c) => c.group === '미디어'),
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
  // 텍스트블록 안이 아니면 트리거하지 않는다.
  if (!$slash.parent.isTextblock) return false
  if ($slash.parentOffset === 0) return true
  const before = $slash.parent.textBetween($slash.parentOffset - 1, $slash.parentOffset)
  return /\s/.test(before)
}

function computeState(prev: SlashMenuState, tr: Transaction, next: EditorState): SlashMenuState {
  const meta = tr.getMeta(slashMenuKey) as { close?: boolean } | undefined
  if (meta?.close) return INACTIVE

  const { $from, empty } = next.selection
  if (!empty || !$from.parent.isTextblock) return INACTIVE

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
  applyTurnInto(tr, info.id, command.id, deps, 0)

  dispatch(tr.scrollIntoView())
  return true
}

// ── 하위 페이지 삽입 (F-02-13) ────────────────────────────────────────

/**
 * 방금 만든 하위 페이지의 참조 노드를 넣는다.
 *
 * 서버가 **진짜 `block` 행**을 만든 뒤에 부른다 — 참조 노드의 컨테이너
 * `blockId` 가 곧 그 페이지의 id 여야 하기 때문이다(`pmToDoc` 이 그렇게 읽는다).
 * 가짜 id 로 먼저 넣고 나중에 바꾸면 그 사이의 자동 저장이 존재하지 않는
 * 페이지를 참조하게 된다.
 *
 * 정본 F-02-13: 서브페이지는 **소유 관계**다(`block.parent_id`). `sidebar_alias`
 * 나 `page_link` 로 표현하는 link_to_page·@멘션과 섞지 않는다 — *"섞는 순간
 * 권한 상속이 무너진다."* MVP 는 서브페이지만이다(클론 대안).
 *
 * `/쿼리` 삭제와 삽입은 **한 트랜잭션**이다(Cmd+Z 한 번).
 */
export function insertSubpageRef(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  page: { readonly id: string; readonly title: string },
): boolean {
  const info = containerAt(state.selection.$from)
  if (!info) return false
  if (!dispatch) return true

  const tr = state.tr

  // 메뉴가 아직 열려 있으면 `/쿼리` 를 지운다. 서버 왕복 사이에 사용자가 더
  // 입력했어도 플러그인 상태가 매핑을 따라오므로 범위가 여전히 정확하다.
  // 그 사이 메뉴가 닫혔다면(공백 입력 등) 지울 근거가 없으므로 그대로 둔다.
  const menu = slashMenuState(state)
  if (menu.active && state.selection.head > menu.from) {
    tr.delete(menu.from, state.selection.head)
  }
  closeSlashMenu(tr)

  const container = blockSchema.nodes.blockContainer.create({ blockId: page.id }, [
    blockSchema.nodes[PAGE_REF_NODE].create({ props: {}, format: {}, title: page.title }),
  ])

  // 캐럿이 있던 블록이 비었으면 **그 자리를 대체한다.** 빈 문단을 남겨두면
  // 사용자가 `/페이지` 를 친 줄이 빈 줄로 남는다.
  const fresh = findContainerById(tr.doc, info.id)
  const replaceable =
    fresh !== null &&
    fresh.contentNode.isTextblock &&
    fresh.contentNode.content.size === 0 &&
    (fresh.groupNode === null || fresh.groupNode.childCount === 0)

  if (fresh !== null && replaceable) {
    tr.replaceWith(fresh.pos, fresh.pos + fresh.node.nodeSize, container)
  } else if (fresh !== null) {
    tr.insert(fresh.pos + fresh.node.nodeSize, container)
  } else {
    return false
  }

  const placed = findContainerById(tr.doc, page.id)
  if (placed) tr.setSelection(NodeSelection.create(tr.doc, placed.contentPos))

  dispatch(tr.scrollIntoView())
  return true
}
