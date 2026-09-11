/**
 * 편집 커맨드 — 실제 ProseMirror 문서 위에서 (DOM 없음)
 *
 * `block-rules.test.ts` 는 **결정**을 검증한다. 이 파일은 그 결정이 문서에
 * **제대로 적용되는가**를 검증한다. 둘 다 필요하다 — 규칙이 맞아도 트랜잭션을
 * 잘못 조립하면 블록이 사라진다.
 *
 * 특히 §7-4 가 "최빈 버그"로 지목한 **자식 소실**을 문서 구조로 확인한다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { textRun, type RichTextRun } from '../contracts/rich-text.ts'
import type { BlockType } from '../block/types.ts'
import { blockSchema } from './schema.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findBlockIdFixes } from './block-id-plugin.ts'
import {
  indentCommand,
  isComposingEvent,
  mergeBackwardCommand,
  mergeForwardCommand,
  outdentCommand,
  softBreakCommand,
  splitBlockCommand,
  turnIntoCommand,
  type CommandDeps,
} from './commands.ts'
import { findContainerById } from './pm-blocks.ts'
import type { EditorBlock, EditorDoc } from './document.ts'

// ── 테스트 도구 ───────────────────────────────────────────────────────

let counter = 0
/** 결정적 id. 실패 메시지에서 어느 블록인지 알아볼 수 있게 한다. */
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function blk(
  id: string,
  type: BlockType,
  text = '',
  children: EditorBlock[] = [],
  extra: Partial<EditorBlock> = {},
): EditorBlock {
  return {
    id,
    type,
    title: text === '' ? [] : [textRun(text)],
    properties: {},
    format: {},
    children,
    ...extra,
  }
}

function stateOf(doc: EditorDoc): EditorState {
  return EditorState.create({ schema: blockSchema, doc: docToPm(doc) })
}

/** 블록 안의 오프셋에 캐럿을 놓는다. */
function withCaret(state: EditorState, blockId: string, offset: number): EditorState {
  const info = findContainerById(state.doc, blockId)
  assert.ok(info, `블록을 찾지 못했다: ${blockId}`)
  const pos = info.contentPos + 1 + offset
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
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

/**
 * 문서 구조를 [타입, 텍스트, [자식…]] 로 납작하게.
 *
 * **`pmToDoc` 을 거치지 않고 PM 문서를 직접 읽는다.** `pmToDoc` 은 "빈 문단
 * 하나뿐인 문서"를 빈 문서로 정규화하는데(페이지를 열어보기만 해도 블록이
 * 생기는 것을 막는 규칙), 구조 검증에 그게 섞이면 "블록이 사라졌다"와
 * "정규화됐다"를 구분할 수 없다.
 */
function shape(state: EditorState): unknown {
  const walkGroup = (group: PmNode): unknown[] => {
    const out: unknown[] = []
    group.forEach((container) => {
      const content = container.child(0)
      const nested = container.childCount > 1 ? container.child(1) : null
      out.push([
        content.type.name,
        content.isTextblock ? content.textContent : '',
        nested ? walkGroup(nested) : [],
      ])
    })
    return out
  }
  return state.doc.childCount > 0 ? walkGroup(state.doc.child(0)) : []
}

/** 블록의 내용 노드 attrs. properties/format 확인용. */
function attrsOf(state: EditorState, blockId: string): Record<string, unknown> {
  const info = findContainerById(state.doc, blockId)
  assert.ok(info, `블록을 찾지 못했다: ${blockId}`)
  return info.contentNode.attrs as Record<string, unknown>
}

/** 문서에 있는 모든 blockId. 소실·중복 확인용. */
function allIds(doc: PmNode): string[] {
  const ids: string[] = []
  doc.descendants((node) => {
    if (node.type.name === 'blockContainer') ids.push(String(node.attrs.blockId))
    return true
  })
  return ids
}

const deps = (over: Partial<CommandDeps> = {}): CommandDeps => ({
  isCollapsed: () => false,
  newId: nextId,
  ...over,
})

// ── Enter ─────────────────────────────────────────────────────────────

describe('Enter — 분할', () => {
  test('문단 한가운데서 캐럿 앞뒤가 두 블록으로 갈린다', () => {
    const a = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '안녕하세요')] })
    state = withCaret(state, a, 2)

    const next = run(state, splitBlockCommand(deps()))
    assert.ok(next)
    assert.deepEqual(shape(next), [
      ['paragraph', '안녕', []],
      ['paragraph', '하세요', []],
    ])
  })

  test('캐럿은 새 블록의 맨 앞에 남는다', () => {
    const a = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '안녕하세요')] })
    state = withCaret(state, a, 2)

    const next = run(state, splitBlockCommand(deps()))
    assert.ok(next)
    const newBlockPmId = pmToDoc(next.doc).blocks[1].id
    const info = findContainerById(next.doc, newBlockPmId)
    assert.ok(info)
    assert.equal(next.selection.from, info.contentPos + 1)
  })

  test('리스트는 타입을 이어가고 heading 은 paragraph 가 된다', () => {
    for (const [type, expected] of [
      ['bulleted_list_item', 'bulleted_list_item'],
      ['numbered_list_item', 'numbered_list_item'],
      ['to_do', 'to_do'],
      ['heading_1', 'paragraph'],
      ['quote', 'paragraph'],
      ['callout', 'paragraph'],
    ] as const) {
      const a = nextId()
      let state = stateOf({ blocks: [blk(a, type, '내용')] })
      state = withCaret(state, a, 2)
      const next = run(state, splitBlockCommand(deps()))
      assert.ok(next, type)
      assert.equal(pmToDoc(next.doc).blocks[1].type, expected, type)
    }
  })

  test('to_do 를 쪼개면 새 블록은 checked=false 다', () => {
    const a = nextId()
    let state = stateOf({
      blocks: [blk(a, 'to_do', '완료한 일', [], { properties: { checked: true } })],
    })
    state = withCaret(state, a, 2)

    const next = run(state, splitBlockCommand(deps()))
    assert.ok(next)
    const blocks = pmToDoc(next.doc).blocks
    assert.equal(blocks[0].properties?.checked, true)
    assert.equal(blocks[1].properties?.checked, false)
  })

  test('block_color 를 상속한다', () => {
    const a = nextId()
    let state = stateOf({
      blocks: [blk(a, 'bulleted_list_item', '색깔', [], { format: { block_color: 'red_background' } })],
    })
    state = withCaret(state, a, 2)

    const next = run(state, splitBlockCommand(deps()))
    assert.ok(next)
    assert.equal(pmToDoc(next.doc).blocks[1].format?.block_color, 'red_background')
  })

  test('서식 경계를 가로질러 쪼개도 서식이 양쪽에 남는다', () => {
    const a = nextId()
    const title: RichTextRun[] = [textRun('일반'), textRun('굵게', { bold: true })]
    let state = stateOf({ blocks: [{ ...blk(a, 'paragraph'), title }] })
    state = withCaret(state, a, 3) // '일반' + '굵' | '게'

    const next = run(state, splitBlockCommand(deps()))
    assert.ok(next)
    const blocks = pmToDoc(next.doc).blocks
    assert.equal(blocks[0].title.map((r) => r.plain_text).join(''), '일반굵')
    assert.equal(blocks[0].title[1].annotations.bold, true)
    assert.equal(blocks[1].title[0].plain_text, '게')
    assert.equal(blocks[1].title[0].annotations.bold, true)
  })
})

describe('Enter — 자식 귀속 (§7-4 최빈 버그)', () => {
  test('펼쳐진 자식이 있으면 새 블록이 첫 자식이 되고 자식은 그대로 남는다', () => {
    const parent = nextId()
    const child = nextId()
    let state = stateOf({
      blocks: [blk(parent, 'bulleted_list_item', '부모', [blk(child, 'paragraph', '자식')])],
    })
    state = withCaret(state, parent, 2) // '부' | '모'

    const next = run(state, splitBlockCommand(deps()))
    assert.ok(next)

    assert.deepEqual(shape(next), [
      [
        'bulleted_list_item',
        '부모',
        [
          ['bulleted_list_item', '', []], // 새 블록 — tail 이 빈 문자열
          ['paragraph', '자식', []],
        ],
      ],
    ])
    // 자식이 살아 있는지 id 로 확인한다. 구조만 보면 놓친다.
    assert.ok(allIds(next.doc).includes(child), '자식이 사라졌다')
  })

  test('접힌 자식이 있으면 새 블록은 형제이고 자식은 접힌 채 남는다', () => {
    const parent = nextId()
    const child = nextId()
    let state = stateOf({
      blocks: [blk(parent, 'toggle', '접힘', [blk(child, 'paragraph', '숨은 자식')])],
    })
    state = withCaret(state, parent, 2)

    const next = run(state, splitBlockCommand(deps({ isCollapsed: (id) => id === parent })))
    assert.ok(next)

    assert.deepEqual(shape(next), [
      ['toggle', '접힘', [['paragraph', '숨은 자식', []]]],
      ['toggle', '', []],
    ])
    assert.ok(allIds(next.doc).includes(child), '자식이 사라졌다')
  })

  test('자식이 없으면 형제다', () => {
    const a = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '문단')] })
    state = withCaret(state, a, 2)
    const next = run(state, splitBlockCommand(deps()))
    assert.ok(next)
    assert.equal(pmToDoc(next.doc).blocks.length, 2)
    assert.equal(pmToDoc(next.doc).blocks[0].children?.length ?? 0, 0)
  })

  test('어떤 오프셋에서 쪼개도 자식 수가 변하지 않는다 (전수)', () => {
    const parent = nextId()
    const c1 = nextId()
    const c2 = nextId()

    for (let offset = 0; offset <= 4; offset += 1) {
      let state = stateOf({
        blocks: [
          blk(parent, 'bulleted_list_item', '가나다라', [
            blk(c1, 'paragraph', 'c1'),
            blk(c2, 'paragraph', 'c2'),
          ]),
        ],
      })
      state = withCaret(state, parent, offset)
      const next = run(state, splitBlockCommand(deps()))
      assert.ok(next, `offset=${offset}`)

      const ids = allIds(next.doc)
      assert.ok(ids.includes(c1), `offset=${offset} 에서 c1 이 사라졌다`)
      assert.ok(ids.includes(c2), `offset=${offset} 에서 c2 이 사라졌다`)
      assert.equal(ids.length, 4, `offset=${offset} 에서 블록 수가 ${ids.length}`)
    }
  })
})

describe('Enter — 빈 블록', () => {
  test('빈 리스트에서 Enter 는 paragraph 로 탈출한다 (블록을 만들지 않는다)', () => {
    const a = nextId()
    let state = stateOf({ blocks: [blk(a, 'bulleted_list_item')] })
    state = withCaret(state, a, 0)

    const next = run(state, splitBlockCommand(deps()))
    assert.ok(next)
    assert.deepEqual(shape(next), [['paragraph', '', []]])
    assert.equal(allIds(next.doc).length, 1)
  })

  test('빈 to_do 를 탈출하면 checked 가 남지 않는다', () => {
    const a = nextId()
    let state = stateOf({ blocks: [blk(a, 'to_do', '', [], { properties: { checked: true } })] })
    state = withCaret(state, a, 0)

    const next = run(state, splitBlockCommand(deps()))
    assert.ok(next)
    // 문단에 checked 가 남으면 나중에 to_do 로 되돌릴 때 완료 상태가 되살아난다.
    assert.deepEqual(attrsOf(next, a).props, {})
  })

  test('빈 paragraph 에서 Enter 는 새 빈 블록을 만든다', () => {
    const a = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph')] })
    state = withCaret(state, a, 0)

    const next = run(state, splitBlockCommand(deps()))
    assert.ok(next)
    assert.equal(allIds(next.doc).length, 2)
  })
})

describe('Shift+Enter — soft break', () => {
  test('블록을 쪼개지 않고 개행을 넣는다', () => {
    const a = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '한줄')] })
    state = withCaret(state, a, 1)

    const next = run(state, softBreakCommand())
    assert.ok(next)
    assert.equal(allIds(next.doc).length, 1, '블록이 쪼개졌다')
    assert.equal(pmToDoc(next.doc).blocks[0].title[0].plain_text, '한\n줄')
  })
})

// ── Backspace ─────────────────────────────────────────────────────────

describe('Backspace — 병합', () => {
  test('블록 맨 앞이 아니면 기본 동작에 넘긴다', () => {
    const a = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '가나')] })
    state = withCaret(state, a, 1)
    assert.equal(run(state, mergeBackwardCommand(deps())), null)
  })

  test('앞 블록 끝에 텍스트가 이어붙고 앞 블록의 타입이 이긴다', () => {
    const a = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(a, 'heading_1', '제목'), blk(b, 'paragraph', '본문')] })
    state = withCaret(state, b, 0)

    const next = run(state, mergeBackwardCommand(deps()))
    assert.ok(next)
    assert.deepEqual(shape(next), [['heading_1', '제목본문', []]])
  })

  test('캐럿이 이어붙인 경계에 남는다', () => {
    const a = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '앞쪽'), blk(b, 'paragraph', '뒤')] })
    state = withCaret(state, b, 0)

    const next = run(state, mergeBackwardCommand(deps()))
    assert.ok(next)
    const info = findContainerById(next.doc, a)
    assert.ok(info)
    assert.equal(next.selection.from, info.contentPos + 1 + 2)
  })

  test('사라지는 블록의 자식이 대상의 자식 끝으로 이관된다', () => {
    const a = nextId()
    const b = nextId()
    const existing = nextId()
    const moved = nextId()
    let state = stateOf({
      blocks: [
        blk(a, 'bulleted_list_item', '앞', [blk(existing, 'paragraph', '원래 자식')]),
        blk(b, 'paragraph', '뒤', [blk(moved, 'paragraph', '따라올 자식')]),
      ],
    })
    state = withCaret(state, b, 0)

    const next = run(state, mergeBackwardCommand(deps()))
    assert.ok(next)

    // ⚠ 병합 대상은 **앞 형제(a)가 아니라 화면상 이전 줄(existing)** 이다.
    // 화면은 [앞] / [원래 자식] / [뒤] 순서이고, Backspace 는 바로 위 줄과
    // 합쳐진다 — F-01-19 의 "이전 블록 끝에 이어붙는다"는 형제가 아니라 줄이다.
    // 처음엔 a 와 합쳐질 것으로 기대했다가 이 테스트가 잡았다.
    assert.deepEqual(shape(next), [
      [
        'bulleted_list_item',
        '앞',
        [['paragraph', '원래 자식뒤', [['paragraph', '따라올 자식', []]]]],
      ],
    ])
    assert.ok(allIds(next.doc).includes(moved), '이관된 자식이 사라졌다')
  })

  test('대상에 자식이 없으면 앞 형제와 합쳐지고 자식이 그 아래로 온다', () => {
    const a = nextId()
    const b = nextId()
    const moved = nextId()
    let state = stateOf({
      blocks: [
        blk(a, 'bulleted_list_item', '앞'),
        blk(b, 'paragraph', '뒤', [blk(moved, 'paragraph', '따라올 자식')]),
      ],
    })
    state = withCaret(state, b, 0)

    const next = run(state, mergeBackwardCommand(deps()))
    assert.ok(next)
    assert.deepEqual(shape(next), [
      ['bulleted_list_item', '앞뒤', [['paragraph', '따라올 자식', []]]],
    ])
  })

  test('앞 블록이 자식을 가질 수 없으면 거부하고 텍스트를 지우지 않는다', () => {
    const a = nextId()
    const b = nextId()
    const child = nextId()
    let state = stateOf({
      blocks: [
        blk(a, 'heading_1', '제목'), // heading 은 자식 불가
        blk(b, 'paragraph', '뒤', [blk(child, 'paragraph', '자식')]),
      ],
    })
    state = withCaret(state, b, 0)

    const blocked: string[] = []
    const next = run(
      state,
      mergeBackwardCommand(deps({ onBlocked: (p) => blocked.push(p.reason) })),
    )

    // 거부했지만 true 를 돌려 기본 Backspace 를 막는다 — 그렇지 않으면
    // 병합을 거부했는데 ProseMirror 가 대신 글자를 지운다.
    assert.ok(next)
    assert.deepEqual(blocked, ['target_cannot_have_children'])
    assert.deepEqual(shape(next), shape(state), '문서가 변했다')
  })

  test('앞 블록이 divider 면 병합 대신 그 블록을 선택한다', () => {
    const a = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(a, 'divider'), blk(b, 'paragraph', '뒤')] })
    state = withCaret(state, b, 0)

    const next = run(state, mergeBackwardCommand(deps()))
    assert.ok(next)
    assert.deepEqual(shape(next), shape(state), '문서가 변했다')

    const info = findContainerById(next.doc, a)
    assert.ok(info)
    assert.equal(next.selection.from, info.contentPos)
    assert.equal(next.selection.constructor.name, 'NodeSelection')
  })

  test('빈 리스트에서 Backspace 는 먼저 타입을 되돌린다', () => {
    const a = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '앞'), blk(b, 'to_do')] })
    state = withCaret(state, b, 0)

    const next = run(state, mergeBackwardCommand(deps()))
    assert.ok(next)
    assert.deepEqual(shape(next), [
      ['paragraph', '앞', []],
      ['paragraph', '', []],
    ])
  })

  test('빈 paragraph 는 삭제되고 캐럿이 앞 블록 끝으로 간다', () => {
    const a = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '앞쪽'), blk(b, 'paragraph')] })
    state = withCaret(state, b, 0)

    const next = run(state, mergeBackwardCommand(deps()))
    assert.ok(next)
    assert.deepEqual(shape(next), [['paragraph', '앞쪽', []]])
    const info = findContainerById(next.doc, a)
    assert.ok(info)
    assert.equal(next.selection.from, info.contentPos + 1 + 2)
  })

  test('문서 첫 블록에서 Backspace 는 아무 일도 하지 않는다', () => {
    const a = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '첫 블록')] })
    state = withCaret(state, a, 0)
    assert.equal(run(state, mergeBackwardCommand(deps())), null)
  })
})

describe('Backspace — 접힌 토글 뒤 (F-01-19 엣지 케이스)', () => {
  test('접힌 토글의 마지막 자손이 아니라 토글 제목과 병합한다', () => {
    const toggle = nextId()
    const hidden = nextId()
    const after = nextId()
    let state = stateOf({
      blocks: [
        blk(toggle, 'toggle', '토글', [blk(hidden, 'paragraph', '숨은 자식')]),
        blk(after, 'paragraph', '뒤 블록'),
      ],
    })
    state = withCaret(state, after, 0)

    const next = run(state, mergeBackwardCommand(deps({ isCollapsed: (id) => id === toggle })))
    assert.ok(next)

    // 토글 제목에 이어붙고, 자식은 토글에 그대로 남는다.
    assert.deepEqual(shape(next), [['toggle', '토글뒤 블록', [['paragraph', '숨은 자식', []]]]])
  })

  test('펼쳐져 있으면 마지막 자손과 병합한다', () => {
    const toggle = nextId()
    const visible = nextId()
    const after = nextId()
    let state = stateOf({
      blocks: [
        blk(toggle, 'toggle', '토글', [blk(visible, 'paragraph', '보이는 자식')]),
        blk(after, 'paragraph', '뒤'),
      ],
    })
    state = withCaret(state, after, 0)

    const next = run(state, mergeBackwardCommand(deps()))
    assert.ok(next)
    assert.deepEqual(shape(next), [['toggle', '토글', [['paragraph', '보이는 자식뒤', []]]]])
  })

  test('접힌 대상으로 자식이 들어가면 펼치라고 알린다', () => {
    const toggle = nextId()
    const hidden = nextId()
    const after = nextId()
    const movedChild = nextId()
    let state = stateOf({
      blocks: [
        blk(toggle, 'toggle', '토글', [blk(hidden, 'paragraph', '숨은')]),
        blk(after, 'paragraph', '뒤', [blk(movedChild, 'paragraph', '따라올')]),
      ],
    })
    state = withCaret(state, after, 0)

    const expanded: string[] = []
    const next = run(
      state,
      mergeBackwardCommand(
        deps({ isCollapsed: (id) => id === toggle, expand: (id) => expanded.push(id) }),
      ),
    )
    assert.ok(next)
    assert.deepEqual(expanded, [toggle], '접힌 대상을 펼치지 않으면 자식이 화면에서 사라진다')
    assert.ok(allIds(next.doc).includes(movedChild))
  })
})

describe('Backspace — 첫 자식에서', () => {
  test('부모와 병합하고 부모의 다른 자식이 살아남는다', () => {
    const parent = nextId()
    const first = nextId()
    const second = nextId()
    let state = stateOf({
      blocks: [
        blk(parent, 'bulleted_list_item', '부모', [
          blk(first, 'paragraph', '첫 자식'),
          blk(second, 'paragraph', '둘째 자식'),
        ]),
      ],
    })
    state = withCaret(state, first, 0)

    const next = run(state, mergeBackwardCommand(deps()))
    assert.ok(next)
    assert.deepEqual(shape(next), [
      ['bulleted_list_item', '부모첫 자식', [['paragraph', '둘째 자식', []]]],
    ])
    assert.ok(allIds(next.doc).includes(second))
  })
})

// ── Delete ────────────────────────────────────────────────────────────

describe('Delete — 다음 블록 끌어올리기', () => {
  test('블록 끝에서 다음 블록이 이어붙는다', () => {
    const a = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '앞'), blk(b, 'heading_1', '뒤')] })
    state = withCaret(state, a, 1)

    const next = run(state, mergeForwardCommand(deps()))
    assert.ok(next)
    // 앞 블록의 타입이 이긴다 — Backspace 와 같은 규칙이다.
    assert.deepEqual(shape(next), [['paragraph', '앞뒤', []]])
  })

  test('블록 끝이 아니면 기본 동작에 넘긴다', () => {
    const a = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '앞'), blk(b, 'paragraph', '뒤')] })
    state = withCaret(state, a, 0)
    assert.equal(run(state, mergeForwardCommand(deps())), null)
  })

  test('마지막 블록에서는 아무 일도 하지 않는다', () => {
    const a = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '끝')] })
    state = withCaret(state, a, 1)
    assert.equal(run(state, mergeForwardCommand(deps())), null)
  })

  test('다음 블록이 빈 리스트여도 타입 되돌림을 하지 않는다', () => {
    // 타입 되돌림은 캐럿이 있는 블록에 대한 동작이다(F-01-01).
    // Delete 로 다음 블록의 타입을 바꾸면 사용자가 만지지 않은 블록이 변한다.
    const a = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '앞'), blk(b, 'to_do')] })
    state = withCaret(state, a, 1)
    assert.equal(run(state, mergeForwardCommand(deps())), null)
  })
})

// ── Tab / Shift+Tab ───────────────────────────────────────────────────

describe('Tab — 들여쓰기 (F-01-07)', () => {
  test('이전 형제의 자식이 된다', () => {
    const a = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '앞'), blk(b, 'paragraph', '들여쓸 것')] })
    state = withCaret(state, b, 0)

    const next = run(state, indentCommand(deps()))
    assert.ok(next)
    assert.deepEqual(shape(next), [['paragraph', '앞', [['paragraph', '들여쓸 것', []]]]])
  })

  test('이전 형제에 이미 자식이 있으면 끝에 붙는다', () => {
    const a = nextId()
    const existing = nextId()
    const b = nextId()
    let state = stateOf({
      blocks: [
        blk(a, 'paragraph', '앞', [blk(existing, 'paragraph', '기존')]),
        blk(b, 'paragraph', '새로'),
      ],
    })
    state = withCaret(state, b, 0)

    const next = run(state, indentCommand(deps()))
    assert.ok(next)
    assert.deepEqual(shape(next), [
      [
        'paragraph',
        '앞',
        [
          ['paragraph', '기존', []],
          ['paragraph', '새로', []],
        ],
      ],
    ])
  })

  test('첫 블록은 들여쓸 수 없다', () => {
    const a = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '첫'), blk(b, 'paragraph', '둘째')] })
    state = withCaret(state, a, 0)
    assert.equal(run(state, indentCommand(deps())), null)
  })

  test('heading 밑으로는 들여쓸 수 없다 — 레지스트리가 자식을 금지한다', () => {
    const a = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(a, 'heading_1', '제목'), blk(b, 'paragraph', '본문')] })
    state = withCaret(state, b, 0)
    assert.equal(run(state, indentCommand(deps())), null)
  })

  test('하위 페이지 참조 밑으로도 들여쓸 수 없다 — 그 밑은 그 페이지의 문서다', () => {
    // 레지스트리의 `page.canHaveChildren` 은 true 다(페이지 트리). 그것만 보고
    // 들여쓰기를 허용하면 에디터에서는 된 것처럼 보이고, 저장할 때 `validateDoc`
    // 이 "두 문서가 같은 블록을 소유한다"며 거부한다. 사용자는 "저장하지
    // 못했습니다"만 본다.
    const p = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(p, 'page', '하위'), blk(b, 'paragraph', '본문')] })
    state = withCaret(state, b, 0)
    // ⚠ `assert.equal(run(...), null)` 로 쓰지 않는다. 실패하면 node 가 메시지를
    // 만들려고 EditorState(스키마까지 딸린 객체 그래프)를 통째로 inspect 하다가
    // **멈춘다** — 이 테스트가 버그를 잡는지 확인하다 실제로 40초 넘게 멈췄다.
    const next = run(state, indentCommand(deps()))
    assert.ok(next === null, '하위 페이지 참조 밑으로 들여쓰기가 허용되었다')
  })

  test('자기 자식을 데리고 들어간다', () => {
    const a = nextId()
    const b = nextId()
    const child = nextId()
    let state = stateOf({
      blocks: [
        blk(a, 'paragraph', '앞'),
        blk(b, 'paragraph', '나', [blk(child, 'paragraph', '내 자식')]),
      ],
    })
    state = withCaret(state, b, 0)

    const next = run(state, indentCommand(deps()))
    assert.ok(next)
    assert.deepEqual(shape(next), [
      ['paragraph', '앞', [['paragraph', '나', [['paragraph', '내 자식', []]]]]],
    ])
  })

  test('접힌 블록으로 들여쓰면 펼치라고 알린다', () => {
    const a = nextId()
    const hidden = nextId()
    const b = nextId()
    let state = stateOf({
      blocks: [blk(a, 'toggle', '접힘', [blk(hidden, 'paragraph', '숨은')]), blk(b, 'paragraph', '나')],
    })
    state = withCaret(state, b, 0)

    const expanded: string[] = []
    const next = run(
      state,
      indentCommand(deps({ isCollapsed: (id) => id === a, expand: (id) => expanded.push(id) })),
    )
    assert.ok(next)
    assert.deepEqual(expanded, [a])
  })

  test('캐럿 위치가 유지된다', () => {
    const a = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '앞'), blk(b, 'paragraph', '들여쓸 것')] })
    state = withCaret(state, b, 3)

    const next = run(state, indentCommand(deps()))
    assert.ok(next)
    const info = findContainerById(next.doc, b)
    assert.ok(info)
    assert.equal(next.selection.from, info.contentPos + 1 + 3)
  })
})

describe('Shift+Tab — 내어쓰기', () => {
  test('한 단 올라간다', () => {
    const a = nextId()
    const b = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '부모', [blk(b, 'paragraph', '자식')])] })
    state = withCaret(state, b, 0)

    const next = run(state, outdentCommand())
    assert.ok(next)
    assert.deepEqual(shape(next), [
      ['paragraph', '부모', []],
      ['paragraph', '자식', []],
    ])
  })

  test('최상위에서는 아무 일도 하지 않는다', () => {
    const a = nextId()
    let state = stateOf({ blocks: [blk(a, 'paragraph', '최상위')] })
    state = withCaret(state, a, 0)
    assert.equal(run(state, outdentCommand()), null)
  })

  test('자기 자식을 데리고 나온다', () => {
    const p = nextId()
    const b = nextId()
    const child = nextId()
    let state = stateOf({
      blocks: [blk(p, 'paragraph', '부모', [blk(b, 'paragraph', '나', [blk(child, 'paragraph', '내 자식')])])],
    })
    state = withCaret(state, b, 0)

    const next = run(state, outdentCommand())
    assert.ok(next)
    assert.deepEqual(shape(next), [
      ['paragraph', '부모', []],
      ['paragraph', '나', [['paragraph', '내 자식', []]]],
    ])
  })

  test('Tab → Shift+Tab 왕복이 원래 구조로 돌아온다', () => {
    const a = nextId()
    const b = nextId()
    const original: EditorDoc = {
      blocks: [blk(a, 'paragraph', '앞'), blk(b, 'paragraph', '뒤')],
    }
    let state = withCaret(stateOf(original), b, 0)

    const indented = run(state, indentCommand(deps()))
    assert.ok(indented)
    state = withCaret(indented, b, 0)
    const back = run(state, outdentCommand())
    assert.ok(back)

    assert.deepEqual(shape(back), [
      ['paragraph', '앞', []],
      ['paragraph', '뒤', []],
    ])
  })
})

// ── Turn into (F-01-06) ───────────────────────────────────────────────

describe('turnInto — 타입 변환', () => {
  test('텍스트를 보존한다', () => {
    const a = nextId()
    const state = withCaret(stateOf({ blocks: [blk(a, 'paragraph', '내용은 그대로')] }), a, 0)

    const next = run(state, turnIntoCommand('heading_2', deps()))
    assert.ok(next)
    assert.deepEqual(shape(next), [['heading_2', '내용은 그대로', []]])
  })

  test('to_do 로 바꾸면 checked=false 로 시작한다', () => {
    const a = nextId()
    const state = withCaret(stateOf({ blocks: [blk(a, 'paragraph', '할 일')] }), a, 0)
    const next = run(state, turnIntoCommand('to_do', deps()))
    assert.ok(next)
    assert.equal(pmToDoc(next.doc).blocks[0].properties?.checked, false)
  })

  test('색을 지원하지 않는 타입으로 바꾸면 색을 버린다', () => {
    const a = nextId()
    const state = withCaret(
      stateOf({ blocks: [blk(a, 'paragraph', '', [], { format: { block_color: 'red' } })] }),
      a,
      0,
    )
    const next = run(state, turnIntoCommand('divider', deps()))
    assert.ok(next)
    assert.equal(pmToDoc(next.doc).blocks[0].format?.block_color, undefined)
  })

  test('내용이 있는 블록을 divider 로 바꾸지 않는다 — 텍스트를 조용히 버리지 않는다', () => {
    const a = nextId()
    const state = withCaret(stateOf({ blocks: [blk(a, 'paragraph', '지워지면 안 된다')] }), a, 0)
    assert.equal(run(state, turnIntoCommand('divider', deps())), null)
  })

  test('자식이 있는 블록을 heading 으로 바꾸지 않는다 — 자식이 갈 곳이 없다', () => {
    const a = nextId()
    const child = nextId()
    const state = withCaret(
      stateOf({ blocks: [blk(a, 'paragraph', '부모', [blk(child, 'paragraph', '자식')])] }),
      a,
      0,
    )
    assert.equal(run(state, turnIntoCommand('heading_1', deps())), null)
  })

  test('같은 타입으로는 바꾸지 않는다', () => {
    const a = nextId()
    const state = withCaret(stateOf({ blocks: [blk(a, 'paragraph', '가')] }), a, 0)
    assert.equal(run(state, turnIntoCommand('paragraph', deps())), null)
  })
})

// ── blockId 스탬프 ────────────────────────────────────────────────────

describe('blockId 스탬프', () => {
  test('빈 id 를 찾아낸다', () => {
    const doc = blockSchema.nodes.doc.create(
      null,
      blockSchema.nodes.blockGroup.create(null, [
        blockSchema.nodes.blockContainer.createAndFill(),
      ]),
    )
    assert.equal(findBlockIdFixes(doc).length, 1)
  })

  test('중복 id 를 찾아낸다 — 붙여넣기가 만드는 상태다', () => {
    const dup = nextId()
    const doc = docToPm({ blocks: [blk(dup, 'paragraph', '원본'), blk(dup, 'paragraph', '붙인 것')] })
    const fixes = findBlockIdFixes(doc)

    // 처음 나온 것이 원본이고 뒤에 나온 것만 새 id 를 받는다.
    assert.equal(fixes.length, 1)
    assert.notEqual(fixes[0].id, dup)
  })

  test('정상 문서에는 손대지 않는다', () => {
    const doc = docToPm({ blocks: [blk(nextId(), 'paragraph', '가'), blk(nextId(), 'paragraph', '나')] })
    assert.deepEqual(findBlockIdFixes(doc), [])
  })
})

// ── IME 게이트 ────────────────────────────────────────────────────────

describe('IME 게이트 (§7-4 완화 전략 ④)', () => {
  test('조합 중이면 어느 신호로든 막는다', () => {
    // 세 신호 중 하나만 믿으면 어떤 IME 에서 새 나간다.
    assert.equal(isComposingEvent({ composing: true }, {}), true)
    assert.equal(isComposingEvent({ composing: false }, { isComposing: true }), true)
    assert.equal(isComposingEvent({ composing: false }, { keyCode: 229 }), true)
  })

  test('조합 중이 아니면 통과시킨다', () => {
    assert.equal(isComposingEvent({ composing: false }, { isComposing: false, keyCode: 13 }), false)
  })
})
