/**
 * 블록 핸들 — F-01-08 (드롭 판정 · 드롭 적용 · `+` 버튼)
 *
 * 화면(`block-gutter.tsx`)은 좌표만 읽는다. 무엇을 할지는 전부 여기 있으므로,
 * 드래그가 "블록이 엉뚱한 데로 갔다"로 망가진다면 그 원인은 이 파일의 테스트가
 * 잡아야 한다.
 *
 * 지키는 것:
 *   ① **자기 자신·후손 위로는 드롭 존이 없다** (정본이 명시한 차단)
 *   ② **떨어진 선택이 상대 순서를 유지한 채 모인다** (정본 "다중 선택 드래그")
 *   ③ **문서가 스키마를 어기지 않는다** — 매번 `doc.check()`
 *   ④ **하위 페이지 밑으로는 못 들어간다** — 그 밑은 그 페이지의 문서다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'

import { textRun } from '../contracts/rich-text.ts'
import type { BlockType } from '../block/types.ts'
import { blockSchema } from './schema.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { BlockSelection, isBlockSelection } from './block-selection.ts'
import {
  dropBlocksCommand,
  dropCandidates,
  dropGuide,
  handleTargets,
  insertBlockBelowCommand,
  planDrop,
  resolveDrop,
  selectHandleTargetsCommand,
  type BlockLine,
  type DropTarget,
} from './block-handle.ts'
import { findContainerById } from './pm-blocks.ts'
import { slashMenuPlugin, slashMenuState } from './slash-menu.ts'
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

function select(state: EditorState, anchorId: string, headId = anchorId): EditorState {
  return state.apply(
    state.tr.setSelection(
      BlockSelection.create(state.doc, posOf(state, anchorId), posOf(state, headId)),
    ),
  )
}

/**
 * 커맨드를 돌리고 새 state 를 준다. 적용되지 않으면 null.
 *
 * ⚠ 결과를 `assert.equal(x, null)` 로 검사하지 않는다 — 실패하면 node 가
 * EditorState 를 통째로 inspect 하다가 멈춘다. `assert.ok(x === null, …)` 로 쓴다.
 */
function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  if (!handled) return null
  return next
}

/** 문서 구조를 한 줄로. `A > a1` 은 a1 이 A 의 자식이라는 뜻이다. */
function shape(state: EditorState): string {
  const parts: string[] = []
  const walk = (blocks: readonly EditorBlock[], prefix: string): void => {
    for (const b of blocks) {
      const name = b.title[0]?.text?.content ?? '·'
      parts.push(prefix + name)
      if (b.children && b.children.length > 0) walk(b.children, `${prefix}${name} > `)
    }
  }
  walk(pmToDoc(state.doc).blocks, '')
  return parts.join(' | ')
}

const deps = (extra: Partial<CommandDeps> = {}): CommandDeps => ({
  isCollapsed: () => false,
  ...extra,
})

function drop(state: EditorState, ids: string[], target: DropTarget, extra: Partial<CommandDeps> = {}) {
  return run(state, dropBlocksCommand(ids, target, deps(extra)))
}

/** 줄 좌표를 손으로 만든다. 한 줄 20px, 줄 사이 4px. */
function lines(
  specs: Array<{ id: string; depth?: number; canNest?: boolean; visibleChildren?: boolean }>,
): BlockLine[] {
  return specs.map((s, i) => ({
    blockId: s.id,
    pos: i,
    canNest: s.canNest ?? true,
    hasVisibleChildren: s.visibleChildren ?? false,
    top: i * 24,
    bottom: i * 24 + 20,
    contentLeft: 48 + (s.depth ?? 0) * 24,
  }))
}

const INDENT = 24

// ── 드롭 후보 ─────────────────────────────────────────────────────────

describe('dropCandidates — 무엇 위에 놓을 수 있는가', () => {
  test('★ 끌고 있는 블록과 그 자손은 후보가 아니다 (정본: 드롭 존 비활성)', () => {
    const [a, a1, b] = [nextId(), nextId(), nextId()]
    const state = stateOf([blk(a, 'toggle', 'A', [blk(a1)]), blk(b)])
    const ids = dropCandidates(state.doc, () => false, [a]).map((l) => l.blockId)
    assert.deepEqual(ids, [b])
  })

  test('접힌 블록의 자식은 화면에 없으므로 후보도 아니다', () => {
    const [t, t1, b] = [nextId(), nextId(), nextId()]
    const state = stateOf([blk(t, 'toggle', 'T', [blk(t1)]), blk(b)])
    const ids = dropCandidates(state.doc, (id) => id === t, []).map((l) => l.blockId)
    assert.deepEqual(ids, [t, b])
  })

  test('heading 과 하위 페이지 밑에는 자식을 둘 수 없다', () => {
    const [h, p, q] = [nextId(), nextId(), nextId()]
    const state = stateOf([blk(h, 'heading_1', 'H'), blk(p, 'page', '하위'), blk(q, 'paragraph', 'Q')])
    const info = new Map(dropCandidates(state.doc, () => false, []).map((l) => [l.blockId, l]))
    assert.equal(info.get(h)?.canNest, false)
    assert.equal(info.get(p)?.canNest, false, '레지스트리의 page.canHaveChildren 은 true 지만 본문에서는 아니다')
    assert.equal(info.get(q)?.canNest, true)
  })

  test('보이는 자식 — 자식이 있고 펼쳐져 있을 때만', () => {
    const [t, t1, u, u1] = [nextId(), nextId(), nextId(), nextId()]
    const state = stateOf([blk(t, 'toggle', 'T', [blk(t1)]), blk(u, 'toggle', 'U', [blk(u1)])])
    const info = new Map(
      dropCandidates(state.doc, (id) => id === u, []).map((l) => [l.blockId, l]),
    )
    assert.equal(info.get(t)?.hasVisibleChildren, true)
    assert.equal(info.get(u)?.hasVisibleChildren, false, '접혀 있다')
    assert.equal(info.get(t1)?.hasVisibleChildren, false)
  })
})

// ── 좌표 → 드롭 ───────────────────────────────────────────────────────

describe('resolveDrop — 좌표가 자리로 바뀌는 규칙', () => {
  const L = lines([{ id: 'A' }, { id: 'B' }, { id: 'C' }])

  test('줄의 위 절반은 그 블록 앞', () => {
    assert.deepEqual(resolveDrop(L, 60, 24 + 5, INDENT)?.target, { kind: 'before', blockId: 'B' })
  })

  test('줄의 아래 절반은 그 블록 뒤', () => {
    assert.deepEqual(resolveDrop(L, 60, 24 + 15, INDENT)?.target, { kind: 'after', blockId: 'B' })
  })

  test('한 단 들여쓴 위치보다 오른쪽이면 자식', () => {
    assert.deepEqual(resolveDrop(L, 48 + INDENT + 1, 24 + 15, INDENT)?.target, {
      kind: 'child',
      blockId: 'B',
    })
  })

  test('자식을 못 두는 블록이면 오른쪽이어도 뒤다', () => {
    const H = lines([{ id: 'H', canNest: false }])
    assert.deepEqual(resolveDrop(H, 200, 15, INDENT)?.target, { kind: 'after', blockId: 'H' })
  })

  test('★ 보이는 자식이 있으면 아래 절반은 첫 자식 자리다 — 가이드가 포인터 옆에 온다', () => {
    // "뒤"는 subtree 전체 다음이라, 펼쳐진 토글이면 자식들 아래 멀리 선이 생긴다.
    const T = lines([{ id: 'T', visibleChildren: true }, { id: 't1', depth: 1 }])
    assert.deepEqual(resolveDrop(T, 60, 15, INDENT)?.target, { kind: 'child', blockId: 'T' })
  })

  test('문서 위·아래 바깥은 첫 줄 앞 / 마지막 줄 뒤', () => {
    assert.deepEqual(resolveDrop(L, 60, -50, INDENT)?.target, { kind: 'before', blockId: 'A' })
    assert.deepEqual(resolveDrop(L, 60, 999, INDENT)?.target, { kind: 'after', blockId: 'C' })
  })

  test('줄 사이 틈은 가까운 줄로', () => {
    // A 는 0~20, B 는 24~44. 21 은 A 쪽, 23 은 B 쪽.
    assert.equal(resolveDrop(L, 60, 21, INDENT)?.line.blockId, 'A')
    assert.equal(resolveDrop(L, 60, 23, INDENT)?.line.blockId, 'B')
  })

  test('후보가 없으면 null', () => {
    assert.equal(resolveDrop([], 0, 0, INDENT), null)
  })

  test('이진 탐색 — 1000줄에서 모든 줄을 정확히 찾는다', () => {
    const many = lines(Array.from({ length: 1000 }, (_, i) => ({ id: `b${i}` })))
    for (const i of [0, 1, 499, 998, 999]) {
      assert.equal(resolveDrop(many, 60, i * 24 + 2, INDENT)?.target.blockId, `b${i}`)
    }
  })
})

describe('dropGuide — 선은 늘 포인터가 있는 줄의 경계에', () => {
  const L = lines([{ id: 'A' }])
  test('앞은 줄 위, 뒤는 줄 아래, 자식은 줄 아래에서 한 단 들여서', () => {
    const line = L[0]
    assert.deepEqual(dropGuide({ target: { kind: 'before', blockId: 'A' }, line }, INDENT), { top: 0, left: 48 })
    assert.deepEqual(dropGuide({ target: { kind: 'after', blockId: 'A' }, line }, INDENT), { top: 20, left: 48 })
    assert.deepEqual(dropGuide({ target: { kind: 'child', blockId: 'A' }, line }, INDENT), { top: 20, left: 72 })
  })
})

// ── 계획 ──────────────────────────────────────────────────────────────

describe('planDrop — 화면이 걸렀어도 다시 막는다', () => {
  test('자기 자신 위로는 안 된다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = stateOf([blk(a), blk(b)])
    assert.equal(planDrop(state.doc, [a], { kind: 'after', blockId: a }, () => false).kind, 'invalid_target')
  })

  test('후손 위로는 안 된다 — 블록이 자기 자신의 자손이 된다', () => {
    const [a, a1] = [nextId(), nextId()]
    const state = stateOf([blk(a, 'toggle', 'A', [blk(a1)])])
    assert.equal(planDrop(state.doc, [a], { kind: 'child', blockId: a1 }, () => false).kind, 'invalid_target')
  })

  test('heading · 하위 페이지 밑으로는 안 된다', () => {
    const [h, p, x] = [nextId(), nextId(), nextId()]
    const state = stateOf([blk(h, 'heading_1', 'H'), blk(p, 'page', '하위'), blk(x)])
    assert.equal(planDrop(state.doc, [x], { kind: 'child', blockId: h }, () => false).kind, 'invalid_target')
    assert.equal(planDrop(state.doc, [x], { kind: 'child', blockId: p }, () => false).kind, 'invalid_target')
  })

  test('사라진 블록은 no_blocks / invalid_target', () => {
    const a = nextId()
    const state = stateOf([blk(a)])
    assert.equal(planDrop(state.doc, [nextId()], { kind: 'after', blockId: a }, () => false).kind, 'no_blocks')
    assert.equal(planDrop(state.doc, [a], { kind: 'after', blockId: nextId() }, () => false).kind, 'invalid_target')
  })

  test('접힌 블록 안으로 들어가면 펼칠 대상을 알려준다', () => {
    const [t, t1, x] = [nextId(), nextId(), nextId()]
    const state = stateOf([blk(t, 'toggle', 'T', [blk(t1)]), blk(x)])
    const plan = planDrop(state.doc, [x], { kind: 'child', blockId: t }, (id) => id === t)
    assert.ok(plan.kind === 'drop')
    assert.equal(plan.expand, t)
  })
})

// ── 적용 ──────────────────────────────────────────────────────────────

describe('드롭 — 세 자리', () => {
  test('앞', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const next = drop(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B'), blk(c, 'paragraph', 'C')]), [c], { kind: 'before', blockId: a })
    assert.ok(next)
    next.doc.check()
    assert.equal(shape(next), 'C | A | B')
  })

  test('뒤 — subtree 전체 다음', () => {
    const [a, t, t1] = [nextId(), nextId(), nextId()]
    const next = drop(
      stateOf([blk(a, 'paragraph', 'A'), blk(t, 'toggle', 'T', [blk(t1, 'paragraph', 't1')])]),
      [a],
      { kind: 'after', blockId: t },
    )
    assert.ok(next)
    assert.equal(shape(next), 'T | T > t1 | A')
  })

  test('자식 — 그룹이 없으면 만든다', () => {
    const [a, b] = [nextId(), nextId()]
    const next = drop(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')]), [b], { kind: 'child', blockId: a })
    assert.ok(next)
    next.doc.check()
    assert.equal(shape(next), 'A | A > B')
  })

  test('자식 — 그룹이 있으면 **첫** 자식 자리다(포인터가 부모 바로 아래에 있다)', () => {
    const [t, t1, x] = [nextId(), nextId(), nextId()]
    const next = drop(
      stateOf([blk(t, 'toggle', 'T', [blk(t1, 'paragraph', 't1')]), blk(x, 'paragraph', 'X')]),
      [x],
      { kind: 'child', blockId: t },
    )
    assert.ok(next)
    assert.equal(shape(next), 'T | T > X | T > t1')
  })

  test('드래그는 키보드와 달리 안으로 들어갈 수 있다 — 가이드가 먼저 보여주므로', () => {
    // `block-move.ts` 는 한 키에 순서·깊이를 섞지 않으려고 막았다. 드래그는
    // 놓기 전에 목적지를 본다.
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const next = drop(
      stateOf([blk(a, 'paragraph', 'A'), blk(b, 'bulleted_list_item', 'B'), blk(c, 'paragraph', 'C')]),
      [c],
      { kind: 'child', blockId: b },
    )
    assert.ok(next)
    assert.equal(shape(next), 'A | B | B > C')
  })
})

describe('드롭 — 다중 선택 (정본: 상대 순서를 유지한 채)', () => {
  test('★ 깊이가 섞인 선택도 한곳에 모인다 — 목적지가 소스들 사이에 있어도', () => {
    // a2(A 의 자식)와 B 를 끌어 C 뒤에 놓는다. 목적지 C 는 두 소스 뒤지만,
    // A·a2·B·C 순서라 a2 를 지우면 B 의 위치가, B 를 지우면 C 의 위치가 밀린다.
    const [a, a1, a2, b, c] = [nextId(), nextId(), nextId(), nextId(), nextId()]
    const state = stateOf([
      blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1'), blk(a2, 'paragraph', 'a2')]),
      blk(b, 'paragraph', 'B'),
      blk(c, 'paragraph', 'C'),
    ])
    const next = drop(state, [b, a2], { kind: 'after', blockId: c })
    assert.ok(next)
    next.doc.check()
    // 문서 순서(a2 → B)를 유지한다 — 넘긴 배열 순서(B, a2)가 아니다.
    assert.equal(shape(next), 'A | A > a1 | C | a2 | B')
  })

  test('목적지가 두 소스 사이에 있을 때', () => {
    const [a, b, c, d] = [nextId(), nextId(), nextId(), nextId()]
    const state = stateOf([
      blk(a, 'paragraph', 'A'),
      blk(b, 'paragraph', 'B'),
      blk(c, 'paragraph', 'C'),
      blk(d, 'paragraph', 'D'),
    ])
    // A 와 D 를 B 뒤로. 목적지 B 는 A 와 D 사이다.
    const next = drop(state, [a, d], { kind: 'after', blockId: b })
    assert.ok(next)
    next.doc.check()
    assert.equal(shape(next), 'B | A | D | C')
  })

  test('옮긴 블록들이 블록 선택으로 남는다', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const next = drop(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B'), blk(c, 'paragraph', 'C')]), [a, b], { kind: 'after', blockId: c })
    assert.ok(next)
    assert.ok(isBlockSelection(next.selection))
    assert.deepEqual(next.selection.blockIds, [a, b])
  })
})

describe('드롭 — 경계와 방어', () => {
  test('★ 유일한 자식을 끌어내면 빈 blockGroup 이 남지 않는다', () => {
    const [a, a1, b] = [nextId(), nextId(), nextId()]
    const next = drop(
      stateOf([blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1')]), blk(b, 'paragraph', 'B')]),
      [a1],
      { kind: 'after', blockId: b },
    )
    assert.ok(next)
    next.doc.check()
    assert.equal(shape(next), 'A | B | a1')
    assert.equal(findContainerById(next.doc, a)?.groupNode, null)
  })

  test('제자리 드롭은 아무 것도 하지 않는다 — undo 스택에 빈 항목을 쌓지 않는다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')])
    const result = run(state, dropBlocksCommand([b], { kind: 'after', blockId: a }, deps()))
    assert.ok(result === null, '문서가 그대로인데 dispatch 되었다')
  })

  test('자기 위로 놓으면 거부된다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = stateOf([blk(a), blk(b)])
    const result = run(state, dropBlocksCommand([a], { kind: 'before', blockId: a }, deps()))
    assert.ok(result === null)
  })

  test('하위 페이지도 옮길 수 있다 — 문서에서 사라지지 않는다', () => {
    const [p, b] = [nextId(), nextId()]
    const next = drop(stateOf([blk(p, 'page', '하위'), blk(b, 'toggle', 'B')]), [p], { kind: 'child', blockId: b })
    assert.ok(next)
    next.doc.check()
    const doc = pmToDoc(next.doc)
    assert.equal(doc.blocks[0].children[0].id, p)
    assert.equal(doc.blocks[0].children[0].type, 'page')
  })

  test('접힌 블록 안에 놓으면 펼친다 — dispatch 뒤에', () => {
    const [t, t1, x] = [nextId(), nextId(), nextId()]
    const events: string[] = []
    const state = stateOf([blk(t, 'toggle', 'T', [blk(t1)]), blk(x)])
    dropBlocksCommand([x], { kind: 'child', blockId: t }, deps({
      isCollapsed: (id) => id === t,
      expand: (id) => events.push(`expand:${id === t ? 'T' : id}`),
    }))(state, () => events.push('dispatch'))
    assert.deepEqual(events, ['dispatch', 'expand:T'])
  })
})

// ── 핸들이 잡는 것 ────────────────────────────────────────────────────

describe('handleTargets — 핸들을 잡으면 무엇이 딸려 오는가', () => {
  test('선택 밖의 블록이면 그 블록 하나', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(a), blk(b), blk(c)]), a)
    assert.deepEqual(handleTargets(state, posOf(state, c)), [c])
  })

  test('선택된 블록의 핸들이면 선택 전체', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(a), blk(b), blk(c)]), a, b)
    assert.deepEqual(handleTargets(state, posOf(state, b)), [a, b])
  })

  test('선택된 블록의 **자손** 핸들이어도 선택 전체 — 하이라이트돼 있으므로', () => {
    const [a, a1, b] = [nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(a, 'toggle', 'A', [blk(a1)]), blk(b)]), a)
    assert.deepEqual(handleTargets(state, posOf(state, a1)), [a])
  })

  test('핸들 클릭은 잡은 것을 블록 선택으로 만든다', () => {
    const [a, b] = [nextId(), nextId()]
    const next = run(stateOf([blk(a), blk(b)]), selectHandleTargetsCommand([b]))
    assert.ok(next)
    assert.ok(isBlockSelection(next.selection))
    assert.deepEqual(next.selection.blockIds, [b])
  })
})

// ── + 버튼 ────────────────────────────────────────────────────────────

describe('+ 버튼 — 아랫줄에 빈 블록과 / 메뉴', () => {
  test('형제로 들어가고 / 뒤에 캐럿이 선다', () => {
    const [a, b] = [nextId(), nextId()]
    const fresh = nextId()
    const next = run(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')]), insertBlockBelowCommand(a, deps({ newId: () => fresh })))
    assert.ok(next)
    next.doc.check()
    assert.equal(shape(next), 'A | / | B')
    assert.equal(next.selection.$from.parent.textContent, '/')
    assert.equal(next.selection.$from.parentOffset, 1)
  })

  test('★ 슬래시 메뉴가 실제로 열린다 — 별도 통로 없이 `/` 입력으로', () => {
    const a = nextId()
    const base = EditorState.create({
      schema: blockSchema,
      doc: docToPm({ blocks: [blk(a, 'paragraph', 'A')] }),
      plugins: [slashMenuPlugin()],
    })
    const next = run(base, insertBlockBelowCommand(a, deps()))
    assert.ok(next)
    const menu = slashMenuState(next)
    assert.equal(menu.active, true)
    assert.equal(menu.active && menu.query, '')
  })

  test('펼쳐진 자식이 있으면 첫 자식 자리 — 화면에서 바로 아랫줄', () => {
    const [t, t1] = [nextId(), nextId()]
    const next = run(stateOf([blk(t, 'toggle', 'T', [blk(t1, 'paragraph', 't1')])]), insertBlockBelowCommand(t, deps()))
    assert.ok(next)
    assert.equal(shape(next), 'T | T > / | T > t1')
  })

  test('접혀 있으면 형제 자리 — 접힌 안으로 넣으면 만든 블록이 안 보인다', () => {
    const [t, t1] = [nextId(), nextId()]
    const next = run(
      stateOf([blk(t, 'toggle', 'T', [blk(t1, 'paragraph', 't1')])]),
      insertBlockBelowCommand(t, deps({ isCollapsed: (id) => id === t })),
    )
    assert.ok(next)
    assert.equal(shape(next), 'T | T > t1 | /')
  })

  test('트랜잭션 하나다 — Cmd+Z 한 번에 블록과 / 가 함께 사라진다', () => {
    const a = nextId()
    let count = 0
    insertBlockBelowCommand(a, deps())(stateOf([blk(a)]), () => {
      count += 1
    })
    assert.equal(count, 1)
  })
})

// 편집 모드 캐럿에서 핸들 대상 — 선택이 텍스트여도 그 블록 하나다.
test('텍스트 선택 상태에서 핸들을 잡으면 그 블록 하나', () => {
  const [a, b] = [nextId(), nextId()]
  let state = stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')])
  const info = findContainerById(state.doc, a)
  assert.ok(info)
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1)))
  assert.deepEqual(handleTargets(state, posOf(state, b)), [b])
})
