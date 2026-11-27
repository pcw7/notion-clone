/**
 * 동기화 블록 — 편집기 쪽 (SB-1 · F-01-11 · 정본 §3.4 [보강 SB-0] ⑤ ⑪ⓐ ⑫ⓒ · SY5)
 *
 * 원본은 원본 페이지에서 **보통 블록처럼** 고친다(정본 ②) — 이 파일은 그 둘레만 다룬다.
 *
 *   · 중첩 가드 — 동기화 블록 안(어느 깊이든)에 동기화 블록 · 하위 페이지 · 인라인 데이터베이스를 두는 로컬 편집을 거부한다(SY5).
 *     끌기 · 붙여넣기 · 들여쓰기 · 병합 · 바꾸기 — 길이 많아 트랜잭션 하나를 본다(`filterTransaction`). 원격 · 되돌리기(Y.Doc 에서 온 것)는
 *     보지 않는다 — 그 모양은 서버의 정규화 ⑥ⓒⓓ 가 고친다. 규칙은 레지스트리의 `excludedDescendantTypes` 다(타입 이름으로 가르지 않는다)
 *   · 자식 없는 원본 — 마지막 자식을 지우면 빈 문단 하나를 넣는다(정규화 ⑥ⓐ 와 같은 모양 · 캐럿을 둘 곳)
 *   · 바꾸기 → 동기화 블록(⑪ⓐ) — 같은 부모의 이웃 블록들을 새 원본(새 id)으로 감싼다
 *   · 동기화 해제(⑫ⓒ) — 사본 없는 원본의 껍데기를 벗긴다(자식은 제자리)
 *   · 붙여넣기 — 붙이는 블록의 동기화 블록은 내용만 편다(사본 붙이기는 SB-2 의 클립보드 v2)
 *
 * 변경 범위만 본다 — 타이핑 한 글자는 조상 몇 개를 볼 뿐이다. 문서 전체를 훑지 않는다.
 */

import type { Node as PmNode, ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Command, type EditorState, type Transaction } from '@tiptap/pm/state'

import { isSyncedCopyProps, SYNCED_BLOCK_TYPE } from '../block/synced-block.ts'
import { BLOCK_TYPES, isRefType, specOf, type BlockType } from '../block/types.ts'
import { BlockSelection, isBlockSelection } from './block-selection.ts'
import type { EditorBlock } from './document.ts'
import { newBlockId } from './pm-adapter.ts'
import { blockTypeOf, findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'

const { blockContainer: CONTAINER, blockGroup: GROUP, paragraph: PARAGRAPH } = blockSchema.nodes

/** 막은 편집의 까닭. */
export const SYNCED_NESTING_NOTICE = '동기화 블록 안에는 동기화 블록 · 하위 페이지 · 데이터베이스를 둘 수 없습니다.'
/** 붙여넣은 동기화 블록을 내용으로 편 까닭. */
export const SYNCED_PASTE_NOTICE = '동기화 블록은 내용만 붙여넣었습니다.'

/** 어딘가의 `excludedDescendantTypes` 에 든 타입 — 이 밖의 타입은 가드가 조상을 볼 필요가 없다. */
const EXCLUDABLE: ReadonlySet<BlockType> = new Set(
  (Object.keys(BLOCK_TYPES) as BlockType[]).flatMap((t) => BLOCK_TYPES[t].excludedDescendantTypes ?? []),
)

const isContainer = (node: PmNode): boolean => node.type === CONTAINER

/** 컨테이너의 블록 타입. */
const typeOfContainer = (container: PmNode): BlockType | null => (container.firstChild === null ? null : blockTypeOf(container.firstChild))

/** 동기화 블록의 원본 컨테이너인가(사본이 아니다). */
export function isSyncedOriginal(container: PmNode): boolean {
  return typeOfContainer(container) === SYNCED_BLOCK_TYPE && !isSyncedCopyProps(container.firstChild?.attrs.props)
}

/**
 * 이 위치를 감싼 블록들이 배제하는 타입(`excludedDescendantTypes` 의 합) — 위치는 컨테이너 앞이거나 블록 안의 아무 곳이다. 그 위치의
 * 블록 자신의 칸은 넣지 않는다(위치가 컨테이너 **앞**이면 그 블록은 조상이 아니다).
 */
export function excludedAt($pos: ResolvedPos): ReadonlySet<BlockType> {
  const out = new Set<BlockType>()
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (!isContainer(node)) continue
    const type = typeOfContainer(node)
    for (const t of type === null ? [] : (specOf(type).excludedDescendantTypes ?? [])) out.add(t)
  }
  return out
}

/** 이 컨테이너들의 서브트리(자신 포함)에 `excluded` 의 타입이 있는가. */
export function subtreeHasExcluded(containers: readonly PmNode[], excluded: ReadonlySet<BlockType>): boolean {
  if (excluded.size === 0) return false
  let found = false
  const visit = (node: PmNode): boolean => {
    if (found) return false
    if (isContainer(node)) {
      const type = typeOfContainer(node)
      if (type !== null && excluded.has(type)) found = true
    }
    return !found && !node.isTextblock && !node.isAtom
  }
  for (const container of containers) {
    if (visit(container)) container.descendants(visit)
    if (found) return true
  }
  return found
}

/**
 * `from`~`to` 에 닿는 블록 중 조상이 배제하는 타입의 블록이 있는가(SY5). 그 범위의 조상도 본다 — 범위를 감싼 블록이 새로 생긴 동기화
 * 블록이면(감싸기) 그 안의 블록들이 범위 안이다.
 */
function nestingBrokenIn(doc: PmNode, from: number, to: number): boolean {
  let broken = false
  doc.nodesBetween(from, to, (node, pos) => {
    if (broken) return false
    if (!isContainer(node)) return !node.isTextblock && !node.isAtom
    const type = typeOfContainer(node)
    if (type !== null && EXCLUDABLE.has(type) && excludedAt(doc.resolve(pos)).has(type)) broken = true
    return !broken
  })
  return broken
}

/** 트랜잭션이 바꾼 범위(최종 문서의 위치) 하나로 — 옮기기(ReplaceAround)의 틈까지 덮는다. 바뀐 것이 없으면 null. */
function changedSpan(tr: Transaction): { from: number; to: number } | null {
  let from = Infinity
  let to = -Infinity
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1)
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      from = Math.min(from, rest.map(newStart, -1))
      to = Math.max(to, rest.map(newEnd, 1))
    })
  })
  if (from > to) return null
  const size = tr.doc.content.size
  return { from: Math.max(0, Math.min(from, size)), to: Math.max(0, Math.min(to, size)) }
}

/** 자식이 하나도 없는 원본(범위에 닿는 것) — 빈 문단을 넣을 자리(그룹이 설 위치)들. 문서 뒤쪽부터. */
function childlessOriginals(doc: PmNode, from: number, to: number): number[] {
  const at: number[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!isContainer(node)) return !node.isTextblock && !node.isAtom
    if (node.childCount === 1 && isSyncedOriginal(node)) at.push(pos + 1 + node.firstChild!.nodeSize)
    return true
  })
  return at.reverse()
}

export type SyncedBlockPluginDeps = {
  /** Y.Doc 에서 온 트랜잭션(다른 참여자 · 되돌리기) — 보지 않는다. */
  readonly isRemoteChange?: (tr: Transaction) => boolean
  /** 막은 까닭을 알린다. */
  readonly onNotice?: (message: string) => void
  readonly newId?: () => string
}

export const syncedBlockPluginKey = new PluginKey('syncedBlock')

/** 중첩 가드 · 자식 없는 원본 채우기(머리말). */
export function syncedBlockPlugin(deps: SyncedBlockPluginDeps = {}): Plugin {
  return new Plugin({
    key: syncedBlockPluginKey,
    filterTransaction: (tr) => {
      if (!tr.docChanged || deps.isRemoteChange?.(tr) === true) return true
      const span = changedSpan(tr)
      if (span === null || !nestingBrokenIn(tr.doc, span.from, span.to)) return true
      deps.onNotice?.(SYNCED_NESTING_NOTICE)
      return false
    },
    appendTransaction: (trs, _old, state) => {
      const local = trs.filter((tr) => tr.docChanged && deps.isRemoteChange?.(tr) !== true)
      if (local.length === 0) return null
      let from = Infinity
      let to = -Infinity
      for (const tr of local) {
        const span = changedSpan(tr)
        if (span === null) continue
        // 뒤의 트랜잭션이 옮긴 위치로 — 마지막 문서의 위치가 필요하다
        const after = trs.slice(trs.indexOf(tr) + 1)
        const map = (pos: number, bias: -1 | 1): number => after.reduce((p, next) => next.mapping.map(p, bias), pos)
        from = Math.min(from, map(span.from, -1))
        to = Math.max(to, map(span.to, 1))
      }
      if (from > to) return null
      const size = state.doc.content.size
      const spots = childlessOriginals(state.doc, Math.max(0, from), Math.min(size, to))
      if (spots.length === 0) return null
      const tr = state.tr
      for (const pos of spots) tr.insert(pos, GROUP.create(null, [emptyParagraph(deps.newId ?? newBlockId)]))
      return tr
    },
  })
}

function emptyParagraph(newId: () => string): PmNode {
  return CONTAINER.create({ blockId: newId() }, [PARAGRAPH.create({ props: {}, format: {} })])
}

/**
 * 끌어 놓기가 배제를 깨는가(SY5) — 놓을 자리의 조상(자식 자리면 그 블록 자신도)이 배제하는 타입이 옮길 블록들의 서브트리에 있으면. 가드가
 * 어차피 막지만 계획에서 먼저 거부한다(`block-handle.ts` `planDrop` — 놓고 나서야 안 되는 줄 알지 않게).
 */
export function dropBreaksExclusion(doc: PmNode, destPos: number, kind: 'before' | 'after' | 'child' | 'side', sourcePositions: readonly number[]): boolean {
  const excluded = new Set(excludedAt(doc.resolve(destPos)))
  const dest = doc.nodeAt(destPos)
  const destType = dest === null ? null : typeOfContainer(dest)
  if (kind === 'child' && destType !== null) for (const t of specOf(destType).excludedDescendantTypes ?? []) excluded.add(t)
  const nodes = sourcePositions.map((pos) => doc.nodeAt(pos)).filter((node): node is PmNode => node !== null)
  return subtreeHasExcluded(nodes, excluded)
}

// ── 바꾸기 → 동기화 블록 (⑪ⓐ) ───────────────────────────────────────

/**
 * 감쌀 블록들 — 블록 선택의 최상위 블록들이 같은 그룹의 이웃이고, 이미 동기화 블록 안이 아니고, 서브트리에 배제 타입이 없을 때만. 블록 메뉴의
 * 다른 동작처럼 블록 선택에 대해서만 정의된다(메뉴는 캐럿을 블록 선택으로 바꾼 뒤 열린다 — `openBlockMenuCommand`).
 */
function wrapTargets(state: EditorState): { from: number; to: number; nodes: PmNode[] } | null {
  const sel = state.selection
  const doc = state.doc
  if (!isBlockSelection(sel)) return null
  const positions = [...sel.rootPositions].sort((a, b) => a - b)
  if (positions.length === 0) return null
  const $first = doc.resolve(positions[0]!)
  const groupStart = $first.start()
  const nodes: PmNode[] = []
  let expected = $first.index()
  for (const pos of positions) {
    const $pos = doc.resolve(pos)
    const node = doc.nodeAt(pos)
    // 같은 그룹 · 이어진 형제만(사이에 낀 블록을 함께 감쌀지 정의되지 않는다 — 옮기기와 같은 판결)
    if (node === null || !isContainer(node) || $pos.start() !== groupStart || $pos.index() !== expected) return null
    // 컬럼은 컬럼 목록 밖에 설 수 없다 — 감싸지 않는다(컬럼 목록째는 된다)
    const type = typeOfContainer(node)
    if (type === null || specOf(type).parentTypes !== undefined) return null
    nodes.push(node)
    expected += 1
  }
  const own = new Set(specOf(SYNCED_BLOCK_TYPE).excludedDescendantTypes ?? [])
  // 이미 동기화 블록 안이거나(그 자리에 동기화 블록을 둘 수 없다) 고른 것에 동기화 블록 · 하위 페이지 · 인라인 데이터베이스가 있다(SY5)
  if (excludedAt($first).has(SYNCED_BLOCK_TYPE) || subtreeHasExcluded(nodes, own)) return null
  const last = positions[positions.length - 1]!
  return { from: positions[0]!, to: last + nodes[nodes.length - 1]!.nodeSize, nodes }
}

/** 메뉴의 "동기화 블록" 이 켜지는가. */
export function canWrapInSyncedBlock(state: EditorState): boolean {
  return wrapTargets(state) !== null
}

/** 고른 블록들을 새 원본으로 감싼다 — 한 트랜잭션(되돌리기 한 번). 감싼 뒤 그 원본을 블록 선택으로. */
export function wrapInSyncedBlockCommand(newId: () => string = newBlockId): Command {
  return (state, dispatch) => {
    const target = wrapTargets(state)
    if (target === null) return false
    if (dispatch) {
      const id = newId()
      const synced = blockSchema.nodes[SYNCED_BLOCK_TYPE]!.create({ props: {}, format: {} })
      const tr = state.tr.replaceWith(target.from, target.to, CONTAINER.create({ blockId: id }, [synced, GROUP.create(null, target.nodes)]))
      const at = findContainerById(tr.doc, id)
      if (at !== null) tr.setSelection(BlockSelection.create(tr.doc, at.pos))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

// ── 동기화 해제 (⑫ⓒ) ────────────────────────────────────────────────

/**
 * 사본 없는 원본의 "동기화 해제" — 껍데기를 벗겨 자식을 그 자리에 둔다(id 그대로 · 한 트랜잭션). 벗긴 블록들이 블록 선택으로 남는다.
 *
 * ⚠ SB-4 의 이음매: 사본이 있는 원본의 해제는 서버 명령(모두 해제 ⑫ⓑ — 고칠 수 있는 사본 페이지에 펴 넣는다)이다. 그 조각이 사본 수를
 * 묻고 이 명령은 사본이 없을 때만 탄다. SB-1 에는 사본이 없다.
 */
export function unsyncSyncedBlockCommand(blockId: string, newId: () => string = newBlockId): Command {
  return (state, dispatch) => {
    const info = findContainerById(state.doc, blockId)
    if (info === null || !isSyncedOriginal(info.node)) return false
    if (dispatch) {
      const children: PmNode[] = []
      info.groupNode?.forEach((child) => children.push(child))
      if (children.length === 0) children.push(emptyParagraph(newId))
      const tr = state.tr.replaceWith(info.pos, info.pos + info.node.nodeSize, children)
      const first = findContainerById(tr.doc, String(children[0]!.attrs.blockId ?? ''))
      const last = findContainerById(tr.doc, String(children[children.length - 1]!.attrs.blockId ?? ''))
      if (first !== null && last !== null) tr.setSelection(BlockSelection.create(tr.doc, first.pos, last.pos))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

// ── 붙여넣기 ───────────────────────────────────────────────────────────

/**
 * 붙일 블록들의 동기화 블록을 내용으로 편다 — 원본은 껍데기를 벗겨 자식을 그 자리에(재귀), 사본은 뺀다(내용이 이 클립보드에 없다).
 * 하위 페이지 · 인라인 데이터베이스는 클립보드가 이미 뺐다(`stripPageRefs`). 바꾼 수를 함께 돌려준다.
 *
 * SB-1 에서는 어디에 붙이든 편다 — 사본이 아직 없어 붙인 원본이 독립된 새 원본이 되면 "동기화된다" 고 잘못 읽힌다. SB-2(클립보드 v2)가
 * 동기화 블록 밖에 붙이는 것을 "X 를 가리키는 새 사본" 으로 바꾸고(⑪ⓑ), 동기화 블록 안이면 여전히 편다(⑪ⓓ).
 */
export function unwrapSyncedBlocks(blocks: readonly EditorBlock[]): { blocks: EditorBlock[]; unwrapped: number } {
  let unwrapped = 0
  const walk = (list: readonly EditorBlock[]): EditorBlock[] =>
    list.flatMap((block) => {
      if (block.type === SYNCED_BLOCK_TYPE) {
        unwrapped += 1
        return isSyncedCopyProps(block.properties) ? [] : walk(block.children ?? [])
      }
      if (isRefType(block.type)) return [block]
      const children = block.children ?? []
      return [children.length > 0 ? { ...block, children: walk(children) } : block]
    })
  return { blocks: walk(blocks), unwrapped }
}
