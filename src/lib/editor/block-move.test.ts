/**
 * 블록 상하 이동 — F-01-08
 *
 * 이 파일이 지키는 것 넷.
 *
 *   ① **깊이가 멋대로 바뀌지 않는가.** 다음 형제가 자식을 가질 수 있어도
 *      그 안으로 들어가면 안 된다 — 한 번 눌렀는데 남의 자식이 되어 있으면
 *      되돌리는 방법이 불분명해진다.
 *   ② **경계에서는 한 단 나가는가.** 나가지 못하면 리스트 안 블록을 키보드로
 *      뺄 수 없는데 드래그로는 되는 이동이다(WCAG 2.1 SC 2.1.1).
 *   ③ **문서가 스키마를 어기지 않는가.** 자식이 전부 빠져나간 `blockGroup` 은
 *      `blockContainer+` 를 어긴다. 파괴적 조작마다 `doc.check()` 를 부른다.
 *   ④ **왕복의 경계가 어디까지인가.** 형제 사이에서는 제자리로 돌아오지만
 *      경계를 넘으면 돌아오지 않는다. 그 비대칭을 **테스트로 못박아 둔다** —
 *      나중에 "버그 아닌가" 싶을 때 의도였음이 여기서 보여야 한다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'

import { textRun } from '../contracts/rich-text.ts'
import type { BlockType } from '../block/types.ts'
import { blockSchema } from './schema.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { BlockSelection, isBlockSelection } from './block-selection.ts'
import { MOVE_NOT_SIBLINGS_REFUSAL, moveBlocksCommand, planBlockMove } from './block-move.ts'
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

function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  if (!handled) return null
  return next
}

/**
 * 문서 구조를 한 줄로. `A > a1` 은 a1 이 A 의 자식이라는 뜻이다.
 * 위치 숫자를 비교하는 것보다 실패 메시지가 읽힌다.
 */
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

const down = (extra: Partial<CommandDeps> = {}) => moveBlocksCommand(1, deps(extra))
const up = (extra: Partial<CommandDeps> = {}) => moveBlocksCommand(-1, deps(extra))

// ── 형제 순서 ─────────────────────────────────────────────────────────

describe('형제 순서 교환', () => {
  test('아래로 — 다음 형제와 자리를 바꾼다', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B'), blk(c, 'paragraph', 'C')]), a)
    const next = run(state, down())
    assert.ok(next)
    next.doc.check()
    assert.equal(shape(next), 'B | A | C')
  })

  test('위로 — 이전 형제와 자리를 바꾼다', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B'), blk(c, 'paragraph', 'C')]), c)
    const next = run(state, up())
    assert.ok(next)
    assert.equal(shape(next), 'A | C | B')
  })

  test('자식은 딸려 간다 — 드래그 대상은 subtree 전체다', () => {
    const [a, a1, b] = [nextId(), nextId(), nextId()]
    const state = select(
      stateOf([blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1')]), blk(b, 'paragraph', 'B')]),
      a,
    )
    const next = run(state, down())
    assert.ok(next)
    next.doc.check()
    assert.equal(shape(next), 'B | A | A > a1')
  })

  test('★ 다음 형제가 자식을 가질 수 있어도 **안으로 들어가지 않는다**', () => {
    // 들여쓰기는 Tab 의 일이다. 이동이 깊이를 바꾸면 두 조작이 겹쳐
    // 둘 다 예측할 수 없어진다.
    const [a, t, t1] = [nextId(), nextId(), nextId()]
    const state = select(
      stateOf([blk(a, 'paragraph', 'A'), blk(t, 'toggle', 'T', [blk(t1, 'paragraph', 't1')])]),
      a,
    )
    const next = run(state, down())
    assert.ok(next)
    assert.equal(shape(next), 'T | T > t1 | A')
  })

  test('펼쳐진 형제를 건너뛸 때 접힘을 보지 않는다 — 규칙이 트리 순서 기반이다', () => {
    const [a, t, t1] = [nextId(), nextId(), nextId()]
    const doc = stateOf([blk(a, 'paragraph', 'A'), blk(t, 'toggle', 'T', [blk(t1, 'paragraph', 't1')])])
    const collapsed = run(select(doc, a), down({ isCollapsed: () => true }))
    const expanded = run(select(doc, a), down({ isCollapsed: () => false }))
    assert.ok(collapsed && expanded)
    assert.equal(shape(collapsed), shape(expanded))
  })
})

// ── 경계 ──────────────────────────────────────────────────────────────

describe('경계에서는 한 단 나간다 (WCAG 대체 경로)', () => {
  test('마지막 자식에서 아래로 → 부모 다음 자리로', () => {
    const [a, a1, a2, b] = [nextId(), nextId(), nextId(), nextId()]
    const state = select(
      stateOf([
        blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1'), blk(a2, 'paragraph', 'a2')]),
        blk(b, 'paragraph', 'B'),
      ]),
      a2,
    )
    const next = run(state, down())
    assert.ok(next)
    next.doc.check()
    assert.equal(shape(next), 'A | A > a1 | a2 | B')
  })

  test('첫 자식에서 위로 → 부모 앞자리로', () => {
    const [a, a1, a2] = [nextId(), nextId(), nextId()]
    const state = select(
      stateOf([blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1'), blk(a2, 'paragraph', 'a2')])]),
      a1,
    )
    const next = run(state, up())
    assert.ok(next)
    next.doc.check()
    assert.equal(shape(next), 'a1 | A | A > a2')
  })

  test('★ 유일한 자식이 나가면 빈 blockGroup 이 남지 않는다', () => {
    // `blockGroup: blockContainer+` — 빈 채로 두면 `tr.delete()` 가 던진다.
    const [a, a1] = [nextId(), nextId()]
    const state = select(stateOf([blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1')])]), a1)
    const next = run(state, down())
    assert.ok(next)
    next.doc.check()
    assert.equal(shape(next), 'A | a1')
    const info = findContainerById(next.doc, a)
    assert.ok(info)
    assert.equal(info.groupNode, null, '자식이 없으면 그룹 노드도 없어야 한다')
  })

  test('문서 끝에서는 아무 일도 없다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')]), b)
    // dispatch 되지 않지만 true 다 — 블록 선택 모드에서 키를 흘려보내면
    // 편집 모드 커맨드가 받아 캐럿이 생기고 모드가 풀린다.
    assert.ok(down()(state, () => assert.fail('움직일 곳이 없는데 dispatch 되었다')))
  })

  test('문서 처음에서도 마찬가지다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')]), a)
    assert.ok(up()(state, () => assert.fail('움직일 곳이 없는데 dispatch 되었다')))
  })
})

// ── 왕복 ──────────────────────────────────────────────────────────────

describe('왕복 — 형제 사이에서만 제자리다', () => {
  test('형제 사이', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const start = stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B'), blk(c, 'paragraph', 'C')])
    const before = shape(start)
    const moved = run(select(start, b), down())
    assert.ok(moved)
    const back = run(moved, up())
    assert.ok(back)
    assert.equal(shape(back), before)
  })

  test('★ 경계를 넘으면 제자리가 아니다 — 피할 수 없는 성질이다', () => {
    // 마지막 자식이 밖으로 나가면 **화면 순서는 그대로이고 깊이만** 바뀐다
    // (A, a1, a2 순서가 유지된다). 되돌아올 때 그 깊이를 복원하려면
    // "이전 형제 안으로 들어가기"가 필요한데 그것은 이동이 하지 않는 일이다.
    // 순서와 깊이를 한 키로 완전 대칭 왕복시킬 수는 없다.
    const [a, a1, a2] = [nextId(), nextId(), nextId()]
    const start = stateOf([
      blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1'), blk(a2, 'paragraph', 'a2')]),
    ])
    const out = run(select(start, a2), down())
    assert.ok(out)
    assert.equal(shape(out), 'A | A > a1 | a2')

    const back = run(out, up())
    assert.ok(back)
    // a2 는 A 안으로 돌아가지 않고 A 앞으로 간다.
    assert.equal(shape(back), 'a2 | A | A > a1')
    back.doc.check()
  })
})

// ── 여러 블록 ─────────────────────────────────────────────────────────

describe('여러 블록을 함께 (F-01-08: 상대 순서를 유지한 채 이동)', () => {
  test('연속 형제는 한 덩어리로 움직인다', () => {
    const [a, b, c, d] = [nextId(), nextId(), nextId(), nextId()]
    const state = select(
      stateOf([
        blk(a, 'paragraph', 'A'),
        blk(b, 'paragraph', 'B'),
        blk(c, 'paragraph', 'C'),
        blk(d, 'paragraph', 'D'),
      ]),
      b,
      c,
    )
    const next = run(state, down())
    assert.ok(next)
    next.doc.check()
    assert.equal(shape(next), 'A | D | B | C')
  })

  test('옮긴 뒤에도 같은 블록이 선택돼 있다 — 연달아 누를 수 있어야 한다', () => {
    const [a, b, c, d] = [nextId(), nextId(), nextId(), nextId()]
    const state = select(
      stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B'), blk(c, 'paragraph', 'C'), blk(d, 'paragraph', 'D')]),
      b,
      c,
    )
    const once = run(state, down())
    assert.ok(once)
    assert.ok(isBlockSelection(once.selection))
    assert.deepEqual(once.selection.blockIds, [b, c])

    // 이제 B·C 가 마지막 형제다. 더 갈 곳이 없으므로 dispatch 되지 않는다.
    assert.equal(run(once, down()), null)
  })

  test('깊이가 섞이면 거부하고 이유를 알린다', () => {
    const [a, a1, a2, b] = [nextId(), nextId(), nextId(), nextId()]
    const refused: string[] = []
    const state = select(
      stateOf([blk(a, 'toggle', 'A', [blk(a1), blk(a2, 'paragraph', 'a2')]), blk(b, 'paragraph', 'B')]),
      a2,
      b,
    )
    assert.ok(
      down({ onRefused: (d) => refused.push(d) })(state, () => {
        assert.fail('거부했는데 dispatch 되었다')
      }),
    )
    assert.deepEqual(refused, [MOVE_NOT_SIBLINGS_REFUSAL])
  })
})

// ── 편집 모드 ─────────────────────────────────────────────────────────

describe('캐럿만 있어도 동작한다', () => {
  test('캐럿이 있는 블록이 움직이고 캐럿은 따라간다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = caretAt(stateOf([blk(a, 'paragraph', '가나다'), blk(b, 'paragraph', 'B')]), a, 2)
    const next = run(state, down())
    assert.ok(next)
    assert.equal(shape(next), 'B | 가나다')
    assert.equal(isBlockSelection(next.selection), false, '편집 모드는 유지된다')
    assert.equal(next.selection.$from.parent.textContent, '가나다')
    assert.equal(next.selection.$from.parentOffset, 2, '오프셋도 그대로다')
  })

  test('편집 모드에서 갈 곳이 없으면 키를 넘긴다', () => {
    // 블록 선택 모드와 다르다. 편집 모드에서는 흘려보내도 모드가 풀리지 않고,
    // 브라우저의 기본 동작(있다면)이 남는 편이 낫다.
    const a = nextId()
    const state = caretAt(stateOf([blk(a, 'paragraph', 'A')]), a, 0)
    assert.equal(down()(state, () => {}), false)
  })
})

// ── 계획 함수 ─────────────────────────────────────────────────────────

describe('planBlockMove — 문서를 고치지 않는다', () => {
  test('빈 목록은 no_blocks', () => {
    const state = stateOf([blk(nextId())])
    assert.equal(planBlockMove(state.doc, [], 1).kind, 'no_blocks')
  })

  test('떨어진 형제는 not_siblings — 중간에 낀 블록이 따라가야 하는지 정의되지 않는다', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const state = stateOf([blk(a), blk(b), blk(c)])
    const plan = planBlockMove(state.doc, [posOf(state, a), posOf(state, c)], 1)
    assert.equal(plan.kind, 'not_siblings')
  })

  test('나가는 이동은 outdents 로 표시된다', () => {
    const [a, a1] = [nextId(), nextId()]
    const state = stateOf([blk(a, 'toggle', 'A', [blk(a1)])])
    const plan = planBlockMove(state.doc, [posOf(state, a1)], 1)
    assert.equal(plan.kind, 'move')
    assert.ok(plan.kind === 'move' && plan.outdents)
  })
})

// ── 하위 페이지 ───────────────────────────────────────────────────────

describe('하위 페이지는 옮길 수 있다 (삭제와 다르다)', () => {
  test('문서에서 사라지지 않으므로 거부하지 않는다', () => {
    const [p, b] = [nextId(), nextId()]
    const refused: string[] = []
    const state = select(stateOf([blk(p, 'page', '하위'), blk(b, 'paragraph', 'B')]), p)
    const next = run(state, down({ onRefused: (d) => refused.push(d) }))
    assert.ok(next)
    next.doc.check()
    assert.deepEqual(refused, [])
    const doc = pmToDoc(next.doc)
    assert.equal(doc.blocks[1].id, p, '페이지가 문서에 그대로 있다')
    assert.equal(doc.blocks[1].type, 'page')
  })
})
