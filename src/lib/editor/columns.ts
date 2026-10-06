/**
 * 컬럼 만들기 — `/2열` · `/3열` (Phase 2 1c · F-01-12 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 컬럼 · 01-block-editor.md F-01-12 *"클론 시 현실적 대안: 드래그 생성 대신 `/2 columns`,
 * `/3 columns` 커맨드로 명시 생성만 지원"*
 *
 *   · 지금 블록(자식까지)이 첫 컬럼으로 들어가고, 나머지 컬럼은 빈 문단 하나씩으로 시작한다 — 블록 id 와 캐럿은 그대로다(친 자리에서
 *     이어 쓴다)
 *   · 컬럼 안에서는 만들지 않는다 — 컬럼 바로 안의 컬럼 목록은 없다(중첩 금지 · 정규화 ④). 바깥에 만들면 지금 블록을 그 컬럼에서
 *     빼야 해서 뜻이 흐려진다
 *   · 틀(컬럼 목록 · 컬럼)의 id 는 새로 만든다 — 정규화의 결정론적 id 가 아니다(편집이 만드는 블록이다)
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

import { newBlockId } from './pm-adapter.ts'
import { columnIdAt, containerAt, findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'
import { closeSlashMenu, slashMenuState } from './slash-menu.ts'

/** `/` 메뉴의 컬럼 수. */
export const COLUMN_COUNTS = [2, 3] as const
export type ColumnCount = (typeof COLUMN_COUNTS)[number]

const { blockContainer: CONTAINER, blockGroup: GROUP, paragraph: PARAGRAPH, column: COLUMN, column_list: COLUMN_LIST } = blockSchema.nodes

/**
 * 그 블록을 첫 컬럼으로 옮겨 `count` 열을 만든다 — 트랜잭션에. 블록이 없거나 이미 컬럼 안이면 false(아무것도 하지 않았다).
 * 캐럿이 그 블록 안이었으면 같은 자리로 돌려놓는다.
 */
export function insertColumnsInto(tr: Transaction, blockId: string, count: ColumnCount, newId: () => string = newBlockId): boolean {
  const info = findContainerById(tr.doc, blockId)
  if (!info || columnIdAt(tr.doc.resolve(info.pos)) !== null) return false
  const caret = tr.selection.empty && tr.selection.from > info.contentPos && tr.selection.from <= info.contentPos + info.contentNode.nodeSize - 1
    ? tr.selection.from - info.contentPos - 1
    : null
  const empty = (): PmNode => PARAGRAPH!.create({ props: {}, format: {} })
  const column = (children: PmNode[]): PmNode => CONTAINER!.create({ blockId: newId() }, [COLUMN!.create({ props: {}, format: {} }), GROUP!.create(null, children)])
  const columns = [
    column([info.node]),
    ...Array.from({ length: count - 1 }, () => column([CONTAINER!.create({ blockId: newId() }, [empty()])])),
  ]
  tr.replaceWith(info.pos, info.pos + info.node.nodeSize, CONTAINER!.create({ blockId: newId() }, [COLUMN_LIST!.create({ props: {}, format: {} }), GROUP!.create(null, columns)]))
  const moved = findContainerById(tr.doc, blockId)
  if (moved && moved.contentNode.isTextblock) {
    const offset = Math.min(caret ?? moved.contentNode.content.size, moved.contentNode.content.size)
    tr.setSelection(TextSelection.create(tr.doc, moved.contentPos + 1 + offset))
  }
  return true
}

/** `/2열` · `/3열` — 쳐 둔 `/쿼리` 를 지우고 지금 블록을 컬럼으로. 메뉴가 닫혀 있거나 컬럼 안이면 false. */
export function runColumnsSlashCommand(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  count: ColumnCount,
  newId: () => string = newBlockId,
): boolean {
  const menu = slashMenuState(state)
  if (!menu.active) return false
  const info = containerAt(state.selection.$from)
  if (!info || columnIdAt(state.selection.$from) !== null) return false
  if (!dispatch) return true
  const tr = state.tr.delete(menu.from, state.selection.head)
  closeSlashMenu(tr)
  if (!insertColumnsInto(tr, info.id, count, newId)) return false
  dispatch(tr.scrollIntoView())
  return true
}
