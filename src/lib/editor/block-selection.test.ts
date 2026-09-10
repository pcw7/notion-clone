/**
 * 멀티 블록 선택 — F-01-09
 *
 * 이 파일이 지키는 것은 세 가지다.
 *
 *   ① **최상위 정규화**가 실제로 되는가. 부모와 자식이 함께 잡히면 자식이 두 번
 *      처리되고, 그 증상은 "블록이 사라졌다"로 나타난다(정본이 "필수"라고 못박은 것).
 *   ② **문서가 스키마를 어기지 않는가.** `blockGroup` 은 `blockContainer+` 라
 *      자식이 0 개가 될 수 없다. 그룹의 자식을 전부 지우는 조작이 그 지뢰다 —
 *      매번 `doc.check()` 로 확인한다.
 *   ③ **하위 페이지가 이 경로로 사라지지 않는가.** 사라지면 저장이
 *      `page_ref_missing` 으로 거부되고 사용자는 "저장 안 됨"만 보게 된다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'

import { textRun } from '../contracts/rich-text.ts'
import type { BlockType } from '../block/types.ts'
import { blockSchema } from './schema.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import {
  BlockSelection,
  PAGE_REF_REFUSAL,
  containsPageRef,
  deleteBlockSelectionCommand,
  duplicateBlockSelectionCommand,
  exitBlockSelectionCommand,
  extendBlockSelectionCommand,
  isBlockSelection,
  moveBlockSelectionCommand,
  rootsBetween,
  selectAllBlocksCommand,
  selectBlockCommand,
  turnSelectionIntoCommand,
} from './block-selection.ts'
import { decorateBlockSelection } from './block-selection-plugin.ts'
import { toggleFormat, setTextColor } from './marks.ts'
import { findContainerById } from './pm-blocks.ts'
import type { CommandDeps } from './commands.ts'
import type { EditorBlock, EditorDoc } from './document.ts'

// ── 테스트 도구 ───────────────────────────────────────────────────────

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function blk(
  id: string,
  type: BlockType = 'paragraph',
  text = '',
  children: EditorBlock[] = [],
): EditorBlock {
  return {
    id,
    type,
    title: text === '' ? [] : [textRun(text)],
    properties: {},
    format: {},
    children,
  }
}

function stateOf(blocks: EditorBlock[]): EditorState {
  const doc: EditorDoc = { blocks }
  return EditorState.create({ schema: blockSchema, doc: docToPm(doc) })
}

function posOf(state: EditorState, id: string): number {
  const info = findContainerById(state.doc, id)
  assert.ok(info, `블록을 찾지 못했다: ${id}`)
  return info.pos
}

/** anchorId..headId 를 블록 선택으로 만든다. */
function select(state: EditorState, anchorId: string, headId = anchorId): EditorState {
  return state.apply(
    state.tr.setSelection(
      BlockSelection.create(state.doc, posOf(state, anchorId), posOf(state, headId)),
    ),
  )
}

function caretAt(state: EditorState, blockId: string, offset: number): EditorState {
  const info = findContainerById(state.doc, blockId)
  assert.ok(info)
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1 + offset)),
  )
}

/** 커맨드를 돌리고 새 state 를 준다. 적용되지 않으면 null. */
function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  if (!handled) return null
  return next
}

/** 몇 번 dispatch 되었는가 — "일괄 조작 = undo 1회"를 확인한다. */
function dispatchCount(state: EditorState, command: Command): number {
  let count = 0
  command(state, () => {
    count += 1
  })
  return count
}

function ids(state: EditorState): string[] {
  const sel = state.selection
  assert.ok(isBlockSelection(sel))
  return sel.blockIds
}

/** 화면 순서로 평탄화된 id 목록 — 문서가 어떤 모양인지 한 줄로 본다. */
function flatIds(state: EditorState): string[] {
  const out: string[] = []
  state.doc.descendants((node) => {
    if (node.type.name === 'blockContainer') out.push(String(node.attrs.blockId))
    return true
  })
  return out
}

const deps = (extra: Partial<CommandDeps> = {}): CommandDeps => ({
  isCollapsed: () => false,
  ...extra,
})

// ── 최상위 정규화 ─────────────────────────────────────────────────────

describe('rootsBetween — 최상위 노드만 추출 (정본이 "필수"라고 한 것)', () => {
  test('블록 하나', () => {
    const a = nextId()
    const state = stateOf([blk(a, 'paragraph', 'A')])
    assert.deepEqual(rootsBetween(state.doc, posOf(state, a), posOf(state, a)), [
      posOf(state, a),
    ])
  })

  test('형제 둘 — 사이의 모든 형제가 들어온다', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const state = stateOf([blk(a), blk(b), blk(c)])
    const roots = rootsBetween(state.doc, posOf(state, a), posOf(state, c))
    assert.deepEqual(roots, [posOf(state, a), posOf(state, b), posOf(state, c)])
  })

  test('부모와 자식을 함께 걸치면 **부모만** 남는다 — 자식은 딸려 온다', () => {
    const [a, a1] = [nextId(), nextId()]
    const state = stateOf([blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1')])])
    const roots = rootsBetween(state.doc, posOf(state, a), posOf(state, a1))
    assert.deepEqual(roots, [posOf(state, a)])
  })

  test('자식만 고르면 부모는 잡히지 않는다 — 범위에 걸치기만 한 조상은 통과한다', () => {
    const [a, a1, a2] = [nextId(), nextId(), nextId()]
    const state = stateOf([
      blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1'), blk(a2, 'paragraph', 'a2')]),
    ])
    const roots = rootsBetween(state.doc, posOf(state, a1), posOf(state, a2))
    assert.deepEqual(roots, [posOf(state, a1), posOf(state, a2)])
  })

  test('깊이가 다른 두 블록에 걸쳐도 된다 — 화면에서 붙어 있으면 선택된다', () => {
    const [a, a1, a2, b] = [nextId(), nextId(), nextId(), nextId()]
    const state = stateOf([
      blk(a, 'toggle', 'A', [blk(a1), blk(a2)]),
      blk(b, 'paragraph', 'B'),
    ])
    // a2(자식) ~ B(루트 형제). A 는 a2 보다 앞에서 시작하므로 들어오지 않는다.
    const roots = rootsBetween(state.doc, posOf(state, a2), posOf(state, b))
    assert.deepEqual(roots, [posOf(state, a2), posOf(state, b)])
  })
})

// ── Selection 계약 ────────────────────────────────────────────────────

describe('BlockSelection — ProseMirror 선택으로서의 계약', () => {
  test('캐럿이 없는 선택이다 — 브라우저가 그리지 않는다', () => {
    const a = nextId()
    const state = select(stateOf([blk(a)]), a)
    assert.equal(state.selection.visible, false)
    assert.equal(state.selection.empty, false)
  })

  test('범위는 컨테이너 전체를 덮는다 — subtree 가 통째로 대상이다', () => {
    const [a, a1] = [nextId(), nextId()]
    const state = select(stateOf([blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1')])]), a)
    const sel = state.selection
    assert.ok(isBlockSelection(sel))
    assert.equal(sel.ranges.length, 1)
    const node = state.doc.nodeAt(sel.rootPositions[0])
    assert.ok(node)
    assert.equal(sel.ranges[0].$to.pos - sel.ranges[0].$from.pos, node.nodeSize)
  })

  test('같은 경계면 같은 선택이다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = stateOf([blk(a), blk(b)])
    const one = BlockSelection.create(state.doc, posOf(state, a), posOf(state, b))
    const two = BlockSelection.create(state.doc, posOf(state, a), posOf(state, b))
    assert.ok(one.eq(two))
    assert.equal(one.eq(BlockSelection.create(state.doc, posOf(state, a))), false)
  })

  test('선택된 블록이 사라지면 선택을 포기하고 캐럿으로 떨어진다', () => {
    // F-01-09: "선택 중 다른 사용자가 해당 블록 삭제 → 선택 집합에서 자동 제외".
    const [a, b] = [nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')]), b)
    const info = findContainerById(state.doc, b)
    assert.ok(info)
    const next = state.apply(state.tr.delete(info.pos, info.pos + info.node.nodeSize))
    assert.equal(isBlockSelection(next.selection), false)
    next.doc.check()
  })

  test('본문 편집은 선택을 유지한다 — 매핑이 알아서 따라간다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')]), b)
    const info = findContainerById(state.doc, a)
    assert.ok(info)
    const next = state.apply(state.tr.insertText('앞에 글자', info.contentPos + 1))
    assert.deepEqual(ids(next), [b])
  })

  test('복사 내용은 컨테이너 그대로다 — 경계가 열리지 않는다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = select(stateOf([blk(a), blk(b)]), a, b)
    const slice = state.selection.content()
    assert.equal(slice.openStart, 0)
    assert.equal(slice.openEnd, 0)
    assert.equal(slice.content.childCount, 2)
    assert.equal(slice.content.child(0).type.name, 'blockContainer')
  })
})

// ── 모드 진입 / 이탈 ──────────────────────────────────────────────────

describe('Esc — 모드 전환 (F-12-01 시나리오 2)', () => {
  test('캐럿이 있던 블록 하나가 선택된다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = caretAt(stateOf([blk(a, 'paragraph', 'A'), blk(b)]), a, 1)
    const next = run(state, selectBlockCommand())
    assert.ok(next)
    assert.deepEqual(ids(next), [a])
  })

  test('이미 블록 선택이면 다시 진입하지 않는다 — 나가는 커맨드가 받는다', () => {
    const a = nextId()
    const state = select(stateOf([blk(a)]), a)
    assert.equal(run(state, selectBlockCommand()), null)
  })

  test('나가면 마지막 선택 블록의 끝에 캐럿이 선다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'BB')]), a, b)
    const next = run(state, exitBlockSelectionCommand())
    assert.ok(next)
    assert.equal(isBlockSelection(next.selection), false)
    assert.equal(next.selection.$from.parent.textContent, 'BB')
    assert.equal(next.selection.$from.parentOffset, 2)
  })
})

// ── 범위 확장 ─────────────────────────────────────────────────────────

describe('Shift+↑↓ — 범위 확장 (F-12-01 시나리오 3)', () => {
  test('아래로 늘어난다', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(a), blk(b), blk(c)]), a)
    const one = run(state, extendBlockSelectionCommand(1, deps()))
    assert.ok(one)
    assert.deepEqual(ids(one), [a, b])
    const two = run(one, extendBlockSelectionCommand(1, deps()))
    assert.ok(two)
    assert.deepEqual(ids(two), [a, b, c])
  })

  test('선택된 블록의 **자손을 건너뛴다** — 안 그러면 키가 안 먹는 것처럼 보인다', () => {
    const [a, a1, a2, b] = [nextId(), nextId(), nextId(), nextId()]
    const state = select(
      stateOf([blk(a, 'toggle', 'A', [blk(a1), blk(a2)]), blk(b, 'paragraph', 'B')]),
      a,
    )
    const next = run(state, extendBlockSelectionCommand(1, deps()))
    assert.ok(next)
    // a1·a2 는 이미 A 에 딸려 있다. 한 번 눌러 B 까지 간다.
    assert.deepEqual(ids(next), [a, b])
  })

  test('접힌 토글의 자식은 화면에 없다 — 다음은 그 뒤 형제다', () => {
    const [t, t1, b] = [nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(t, 'toggle', 'T', [blk(t1)]), blk(b)]), t)
    const next = run(state, extendBlockSelectionCommand(1, deps({ isCollapsed: (id) => id === t })))
    assert.ok(next)
    assert.deepEqual(ids(next), [t, b])
  })

  test('위로 늘리면 부모가 아니라 **화면 바로 윗줄**을 잡는다', () => {
    const [a, a1, a2, b] = [nextId(), nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(a, 'toggle', 'A', [blk(a1), blk(a2)]), blk(b)]), b)
    const next = run(state, extendBlockSelectionCommand(-1, deps()))
    assert.ok(next)
    // B 위의 줄은 A 가 아니라 a2 다.
    assert.deepEqual(ids(next), [a2, b])
  })

  test('반대 방향은 줄인다 — 늘린 것이 그대로 되돌아온다', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const start = select(stateOf([blk(a), blk(b), blk(c)]), b)

    const up = run(start, extendBlockSelectionCommand(-1, deps()))
    assert.ok(up)
    assert.deepEqual(ids(up), [a, b])
    const back = run(up, extendBlockSelectionCommand(1, deps()))
    assert.ok(back)
    assert.deepEqual(ids(back), [b])

    const down = run(start, extendBlockSelectionCommand(1, deps()))
    assert.ok(down)
    assert.deepEqual(ids(down), [b, c])
    const back2 = run(down, extendBlockSelectionCommand(-1, deps()))
    assert.ok(back2)
    assert.deepEqual(ids(back2), [b])
  })

  test('문서 끝에서는 움직이지 않되 키를 흘려보내지도 않는다', () => {
    const a = nextId()
    const state = select(stateOf([blk(a)]), a)
    // true 를 돌려야 한다 — false 면 편집 모드 커맨드로 흘러가 캐럿이 생긴다.
    assert.equal(dispatchCount(state, extendBlockSelectionCommand(1, deps())), 0)
    assert.ok(extendBlockSelectionCommand(1, deps())(state, undefined))
  })

  test('↑↓ 는 선택을 이웃 하나로 옮긴다', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(a), blk(b), blk(c)]), a, b)
    const next = run(state, moveBlockSelectionCommand(1, deps()))
    assert.ok(next)
    assert.deepEqual(ids(next), [c])
  })
})

// ── 삭제 ──────────────────────────────────────────────────────────────

describe('Backspace — 일괄 삭제', () => {
  test('선택된 블록과 그 자손이 함께 사라진다', () => {
    const [a, a1, b, c] = [nextId(), nextId(), nextId(), nextId()]
    const state = select(
      stateOf([blk(a, 'toggle', 'A', [blk(a1)]), blk(b), blk(c, 'paragraph', 'C')]),
      a,
      b,
    )
    const next = run(state, deleteBlockSelectionCommand(deps()))
    assert.ok(next)
    next.doc.check()
    assert.deepEqual(flatIds(next), [c])
  })

  test('트랜잭션 하나다 — undo 한 번에 되돌아온다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = select(stateOf([blk(a), blk(b), blk(nextId())]), a, b)
    assert.equal(dispatchCount(state, deleteBlockSelectionCommand(deps())), 1)
  })

  test('그룹의 자식을 전부 지우면 **그룹 노드째** 사라진다 (빈 그룹은 스키마 위반)', () => {
    const [a, a1, a2] = [nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(a, 'toggle', 'A', [blk(a1), blk(a2)])]), a1, a2)
    const next = run(state, deleteBlockSelectionCommand(deps()))
    assert.ok(next)
    next.doc.check()
    assert.deepEqual(flatIds(next), [a])
    // 컨테이너에 blockGroup 이 남아 있으면 안 된다.
    const info = findContainerById(next.doc, a)
    assert.ok(info)
    assert.equal(info.groupNode, null)
  })

  test('문서를 통째로 지우면 빈 문단 하나가 남는다', () => {
    const [a, b] = [nextId(), nextId()]
    const filler = nextId()
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')]), a, b)
    const next = run(state, deleteBlockSelectionCommand(deps({ newId: () => filler })))
    assert.ok(next)
    next.doc.check()
    assert.deepEqual(flatIds(next), [filler])
    // `pmToDoc` 은 "빈 문단 하나"를 빈 문서로 정규화한다 — 새 페이지와 같은 상태다.
    assert.deepEqual(pmToDoc(next.doc).blocks, [])
  })

  test('지운 다음 블록에 캐럿이 선다 — 선택 모드에서 나온다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')]), a)
    const next = run(state, deleteBlockSelectionCommand(deps()))
    assert.ok(next)
    assert.equal(isBlockSelection(next.selection), false)
    assert.equal(next.selection.$from.parent.textContent, 'B')
  })

  test('선택 모드가 아니면 손대지 않는다 — 편집 모드 Backspace 가 받는다', () => {
    const a = nextId()
    const state = caretAt(stateOf([blk(a, 'paragraph', 'A')]), a, 1)
    assert.equal(run(state, deleteBlockSelectionCommand(deps())), null)
  })
})

// ── 하위 페이지 ───────────────────────────────────────────────────────

describe('하위 페이지는 이 경로로 사라지지 않는다', () => {
  test('subtree 안에 있어도 찾아낸다', () => {
    const [a, p] = [nextId(), nextId()]
    const state = stateOf([blk(a, 'toggle', 'A', [blk(p, 'page', '하위')])])
    const info = findContainerById(state.doc, a)
    assert.ok(info)
    assert.equal(containsPageRef(info.node), true)
  })

  test('삭제를 거부하고 이유를 알린다 — 문서는 그대로다', () => {
    const [a, p] = [nextId(), nextId()]
    const refused: string[] = []
    const state = select(
      stateOf([blk(a, 'paragraph', 'A'), blk(p, 'page', '하위')]),
      a,
      p,
    )
    // true 를 돌려야 한다 — false 면 뒤 커맨드가 대신 지운다.
    assert.ok(
      deleteBlockSelectionCommand(deps({ onRefused: (d) => refused.push(d) }))(state, () => {
        assert.fail('거부했는데 dispatch 되었다')
      }),
    )
    assert.deepEqual(refused, [PAGE_REF_REFUSAL])
  })

  test('복제도 거부한다 — 새 id 를 단 페이지 참조는 존재하지 않는 페이지를 가리킨다', () => {
    const p = nextId()
    const refused: string[] = []
    const state = select(stateOf([blk(p, 'page', '하위')]), p)
    assert.ok(
      duplicateBlockSelectionCommand(deps({ onRefused: (d) => refused.push(d) }))(state, () => {
        assert.fail('거부했는데 dispatch 되었다')
      }),
    )
    assert.deepEqual(refused, [PAGE_REF_REFUSAL])
  })
})

// ── 일괄 변환 ─────────────────────────────────────────────────────────

describe('Turn into — 선택 전체 (F-01-09: 각 블록 개별 변환)', () => {
  test('선택된 블록이 모두 바뀐다. 자손은 그대로다', () => {
    const [a, a1, b] = [nextId(), nextId(), nextId()]
    const state = select(
      stateOf([blk(a, 'paragraph', 'A', [blk(a1, 'paragraph', 'a1')]), blk(b, 'paragraph', 'B')]),
      a,
      b,
    )
    const next = run(state, turnSelectionIntoCommand('bulleted_list_item', deps()))
    assert.ok(next)
    const doc = pmToDoc(next.doc)
    assert.equal(doc.blocks[0].type, 'bulleted_list_item')
    assert.equal(doc.blocks[0].children[0].type, 'paragraph')
    assert.equal(doc.blocks[1].type, 'bulleted_list_item')
  })

  test('변환 뒤에도 블록 선택이 유지된다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')]), a, b)
    const next = run(state, turnSelectionIntoCommand('heading_2', deps()))
    assert.ok(next)
    assert.deepEqual(ids(next), [a, b])
  })

  test('거부되는 블록은 남고 나머지는 바뀐다 — 개별 변환이다', () => {
    // heading 은 자식을 가질 수 없다. 자식이 있는 A 만 거부된다.
    const [a, a1, b] = [nextId(), nextId(), nextId()]
    const state = select(
      stateOf([blk(a, 'paragraph', 'A', [blk(a1)]), blk(b, 'paragraph', 'B')]),
      a,
      b,
    )
    const next = run(state, turnSelectionIntoCommand('heading_1', deps()))
    assert.ok(next)
    const doc = pmToDoc(next.doc)
    assert.equal(doc.blocks[0].type, 'paragraph')
    assert.equal(doc.blocks[1].type, 'heading_1')
  })

  test('하나도 바뀌지 않아도 키를 흘려보내지 않는다', () => {
    const a = nextId()
    const state = select(stateOf([blk(a, 'heading_1', 'A')]), a)
    // 이미 heading_1 이라 바뀔 것이 없다. false 를 돌리면 편집 모드 커맨드가
    // 캐럿 기준으로 엉뚱한 블록을 바꾼다.
    assert.ok(turnSelectionIntoCommand('heading_1', deps())(state, () => {}))
  })
})

// ── 복제 ──────────────────────────────────────────────────────────────

describe('Mod+D — 복제', () => {
  test('각 블록 바로 뒤에 사본이 생기고 id 는 전부 새것이다', () => {
    const [a, a1, b] = [nextId(), nextId(), nextId()]
    const state = select(
      stateOf([blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1')]), blk(b, 'paragraph', 'B')]),
      a,
      b,
    )
    const next = run(state, duplicateBlockSelectionCommand(deps({ newId: nextId })))
    assert.ok(next)
    next.doc.check()

    const flat = flatIds(next)
    // A, A 의 자식, A 사본(+자식), B, B 사본
    assert.equal(flat.length, 6)
    assert.equal(new Set(flat).size, 6, '중복 id 가 있으면 프로젝터가 행 하나에 두 번 쓴다')
    assert.ok(flat.includes(a) && flat.includes(a1) && flat.includes(b))

    const doc = pmToDoc(next.doc)
    assert.equal(doc.blocks.length, 4)
    assert.equal(doc.blocks[1].type, 'toggle')
    assert.equal(doc.blocks[1].children.length, 1, '자손까지 함께 복제된다')
  })

  test('선택이 사본으로 옮겨간다 — 바로 한 번 더 누르면 사본이 복제된다', () => {
    const a = nextId()
    const copy = nextId()
    const state = select(stateOf([blk(a, 'paragraph', 'A')]), a)
    const next = run(state, duplicateBlockSelectionCommand(deps({ newId: () => copy })))
    assert.ok(next)
    assert.deepEqual(ids(next), [copy])
  })
})

// ── Mod+A ─────────────────────────────────────────────────────────────

describe('Mod+A — 3단 확장 (F-12-01)', () => {
  test('블록 텍스트 → 그 블록 → 형제 전체', () => {
    const [a, b] = [nextId(), nextId()]
    const start = caretAt(stateOf([blk(a, 'paragraph', '가나다'), blk(b)]), a, 1)

    const text = run(start, selectAllBlocksCommand())
    assert.ok(text)
    assert.equal(isBlockSelection(text.selection), false)
    assert.equal(text.selection.$from.parentOffset, 0)
    assert.equal(text.selection.$to.parentOffset, 3)

    const block = run(text, selectAllBlocksCommand())
    assert.ok(block)
    assert.deepEqual(ids(block), [a])

    const all = run(block, selectAllBlocksCommand())
    assert.ok(all)
    assert.deepEqual(ids(all), [a, b])
  })

  test('중첩 안에서는 형제 전체 다음에 부모로 올라간다', () => {
    const [a, a1, a2, b] = [nextId(), nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(a, 'toggle', 'A', [blk(a1), blk(a2)]), blk(b)]), a1)

    const siblings = run(state, selectAllBlocksCommand())
    assert.ok(siblings)
    assert.deepEqual(ids(siblings), [a1, a2])

    const parent = run(siblings, selectAllBlocksCommand())
    assert.ok(parent)
    assert.deepEqual(ids(parent), [a])

    const roots = run(parent, selectAllBlocksCommand())
    assert.ok(roots)
    assert.deepEqual(ids(roots), [a, b])
  })

  test('깊이가 섞인 선택은 **넓히는 쪽**으로 간다 — 줄이지 않는다', () => {
    const [a, a1, a2, b] = [nextId(), nextId(), nextId(), nextId()]
    // a2(깊이 2) 와 B(깊이 1) 를 함께 고른 상태. 안쪽 그룹을 기준으로 삼으면
    // a1·a2 만 남아 B 가 빠진다.
    const state = select(stateOf([blk(a, 'toggle', 'A', [blk(a1), blk(a2)]), blk(b)]), a2, b)
    const next = run(state, selectAllBlocksCommand())
    assert.ok(next)
    assert.deepEqual(ids(next), [a, b])
  })

  test('문서 전체에서 더 누르면 그대로 있는다 — 편집 모드로 새 나가지 않는다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = select(stateOf([blk(a), blk(b)]), a, b)
    assert.ok(selectAllBlocksCommand()(state, () => assert.fail('더 확장할 곳이 없다')))
  })
})

// ── 화면 표현 ─────────────────────────────────────────────────────────

describe('데코레이션 — 최상위 블록에만 걸린다', () => {
  test('선택된 루트 수만큼, 컨테이너 범위에', () => {
    const [a, a1, b] = [nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(a, 'toggle', 'A', [blk(a1)]), blk(b)]), a, b)
    const set = decorateBlockSelection(state)
    assert.ok(set)
    const found = set.find()
    // 자손(a1)에는 붙지 않는다 — 배경이 겹쳐 진해지면 범위가 왜곡된다.
    assert.equal(found.length, 2)
    assert.equal(found[0].from, posOf(state, a))
  })

  test('블록 선택이 아니면 아무 것도 그리지 않는다', () => {
    const a = nextId()
    const state = caretAt(stateOf([blk(a, 'paragraph', 'A')]), a, 0)
    assert.equal(decorateBlockSelection(state), null)
  })
})

// ── 서식 ──────────────────────────────────────────────────────────────

describe('서식은 선택된 블록 전부에 걸린다', () => {
  test('Mod+B — 커스텀 Selection 을 쓴 덕에 toggleMark 가 그대로 동작한다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')]), a, b)
    const next = run(state, toggleFormat('bold'))
    assert.ok(next)
    const doc = pmToDoc(next.doc)
    assert.equal(doc.blocks[0].title[0]?.annotations.bold, true)
    assert.equal(doc.blocks[1].title[0]?.annotations.bold, true)
  })

  test('색도 마찬가지다 — 첫 범위만 칠하면 첫 블록만 바뀐다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')]), a, b)
    const next = run(state, setTextColor('red'))
    assert.ok(next)
    const doc = pmToDoc(next.doc)
    assert.equal(doc.blocks[0].title[0]?.annotations.color, 'red')
    assert.equal(doc.blocks[1].title[0]?.annotations.color, 'red')
  })
})

// ── 타이핑으로 덮어쓰기 ───────────────────────────────────────────────

describe('선택 위에 타이핑하면 그 블록들을 대체한다', () => {
  test('블록이 사라지고 친 글자가 남는다', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B'), blk(c, 'paragraph', 'C')]), a, b)
    const next = state.apply(state.tr.insertText('새로'))
    next.doc.check()
    const doc = pmToDoc(next.doc)
    assert.equal(doc.blocks.length, 2)
    assert.equal(doc.blocks[1].id, c)
    assert.equal(doc.blocks[0].title[0]?.text?.content, '새로')
  })

  test('하위 페이지가 섞여 있으면 아무 것도 하지 않는다', () => {
    const [a, p] = [nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(p, 'page', '하위')]), a, p)
    const next = state.apply(state.tr.insertText('새로'))
    assert.deepEqual(flatIds(next), [a, p])
  })
})
