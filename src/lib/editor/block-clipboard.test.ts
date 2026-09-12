/**
 * 복사 · 붙여넣기 — F-01-10 (P0: 내부 라운드트립 + 평문)
 *
 * 이 파일이 지키는 것 넷.
 *
 *   ① **무손실 라운드트립** — 복사한 그대로 붙는다. HTML 로는 안 되는 것
 *      (할 일의 checked, 이미지 URL, 모르는 타입의 원본 페이로드)까지.
 *   ② **id 는 언제나 새로** — 원본 id 가 하나라도 살아남으면 프로젝터가 한 행에
 *      두 번 쓰거나 다른 페이지의 블록과 PK 가 부딪친다.
 *   ③ **하위 페이지는 복사되지 않는다** — 존재하지 않는 페이지를 가리키는 행을
 *      만들면 저장이 통째로 실패한다.
 *   ④ **캐럿에 붙이면 첫 블록이 인라인으로 병합된다**(정본 엣지 케이스).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'

import { textRun, toPlainText } from '../contracts/rich-text.ts'
import type { BlockType } from '../block/types.ts'
import { blockSchema } from './schema.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { BlockSelection } from './block-selection.ts'
import {
  BLOCKS_MIME,
  CLIPBOARD_VERSION,
  MAX_PASTE_BLOCKS,
  parseClipboardBlocks,
  pasteBlocksCommand,
  plainTextForBlocks,
  serializeBlocks,
  stripPageRefs,
  textToBlocks,
  withFreshBlockIds,
} from './block-clipboard.ts'
import { findContainerById } from './pm-blocks.ts'
import { validateDoc, type EditorBlock } from './document.ts'
import type { CommandDeps } from './commands.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function blk(
  id: string,
  type: BlockType = 'paragraph',
  text = '',
  children: EditorBlock[] = [],
  properties: Record<string, unknown> = {},
): EditorBlock {
  return { id, type, title: text === '' ? [] : [textRun(text)], properties, format: {}, children }
}

function stateOf(blocks: EditorBlock[]): EditorState {
  return EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }) })
}

function select(state: EditorState, anchorId: string, headId = anchorId): EditorState {
  const a = findContainerById(state.doc, anchorId)
  const h = findContainerById(state.doc, headId)
  assert.ok(a && h)
  return state.apply(state.tr.setSelection(BlockSelection.create(state.doc, a.pos, h.pos)))
}

function caretAt(state: EditorState, blockId: string, offset: number): EditorState {
  const info = findContainerById(state.doc, blockId)
  assert.ok(info)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1 + offset)))
}

/** 실패해도 멈추지 않게 `assert.ok(x === null)` 로 본다(HANDOFF §5). */
function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  return handled ? next : null
}

/** 문서 구조를 한 줄로. `A > a1` 은 a1 이 A 의 자식이라는 뜻이다. */
function shape(state: EditorState): string {
  const parts: string[] = []
  const walk = (blocks: readonly EditorBlock[], prefix: string): void => {
    for (const b of blocks) {
      const name = toPlainText(b.title ?? []) || '·'
      parts.push(prefix + name)
      if (b.children?.length) walk(b.children, `${prefix}${name} > `)
    }
  }
  walk(pmToDoc(state.doc).blocks, '')
  return parts.join(' | ')
}

function allIds(blocks: readonly EditorBlock[]): string[] {
  return blocks.flatMap((b) => [b.id, ...allIds(b.children ?? [])])
}

const deps = (extra: Partial<CommandDeps> = {}): CommandDeps => ({ isCollapsed: () => false, ...extra })

/** 복사 → 붙여넣기 한 번. 클립보드를 실제로 문자열로 오간다. */
function copyPaste(from: EditorState, into: EditorState, ids: string[]): EditorState | null {
  const roots = ids.map((id) => {
    const info = findContainerById(from.doc, id)
    assert.ok(info, id)
    return info.pos
  })
  const out = serializeBlocks(from.doc, roots)
  assert.ok(out)
  const parsed = parseClipboardBlocks(out.json)
  assert.ok(parsed.ok, `클립보드를 다시 읽지 못했다: ${JSON.stringify(parsed)}`)
  return run(into, pasteBlocksCommand(parsed.blocks, deps({ newId: nextId })))
}

// ── 라운드트립 ────────────────────────────────────────────────────────

describe('무손실 라운드트립 — HTML 로는 안 되는 것까지', () => {
  test('중첩 구조가 그대로 붙는다 (정본: 3단계 중첩 subtree)', () => {
    const [a, b, c, target] = [nextId(), nextId(), nextId(), nextId()]
    const from = stateOf([blk(a, 'toggle', 'A', [blk(b, 'toggle', 'B', [blk(c, 'paragraph', 'C')])])])
    const into = select(stateOf([blk(target, 'paragraph', '대상')]), target)
    const next = copyPaste(from, into, [a])
    assert.ok(next)
    next.doc.check()
    assert.equal(shape(next), 'A | A > B | A > B > C')
  })

  test('★ properties 가 살아남는다 — toDOM 에 없는 값들', () => {
    const [todo, img, target] = [nextId(), nextId(), nextId()]
    const from = stateOf([
      blk(todo, 'to_do', '완료한 일', [], { checked: true }),
      blk(img, 'image', '', [], { url: 'https://example.com/a.png', caption: '설명' }),
    ])
    const into = select(stateOf([blk(target, 'paragraph', '대상')]), target)
    const next = copyPaste(from, into, [todo, img])
    assert.ok(next)
    const pasted = pmToDoc(next.doc).blocks
    assert.equal(pasted[0].properties?.checked, true)
    assert.equal(pasted[1].properties?.url, 'https://example.com/a.png')
    assert.equal(pasted[1].properties?.caption, '설명')
  })

  test('모르는 타입도 그대로 오간다 (F-01-02 의 보존 규칙)', () => {
    const [x, target] = [nextId(), nextId()]
    const from = stateOf([blk(x, 'unsupported', '', [], { original_type: 'table_of_contents', payload: { a: 1 } })])
    const into = select(stateOf([blk(target, 'paragraph', '대상')]), target)
    const next = copyPaste(from, into, [x])
    assert.ok(next)
    const pasted = pmToDoc(next.doc).blocks[0]
    assert.equal(pasted.type, 'unsupported')
    assert.equal(pasted.properties?.original_type, 'table_of_contents')
    assert.deepEqual(pasted.properties?.payload, { a: 1 })
  })

  test('서식(마크)도 오간다', () => {
    const [a, target] = [nextId(), nextId()]
    const bold: EditorBlock = {
      id: a,
      type: 'paragraph',
      title: [textRun('굵게', { bold: true }), textRun(' 보통')],
      properties: {},
      format: { block_color: 'red' },
      children: [],
    }
    const into = select(stateOf([blk(target, 'paragraph', '대상')]), target)
    const next = copyPaste(stateOf([bold]), into, [a])
    assert.ok(next)
    const pasted = pmToDoc(next.doc).blocks[0]
    assert.equal(pasted.title[0]?.annotations.bold, true)
    assert.equal(pasted.title[1]?.annotations.bold, false)
    assert.equal(pasted.format?.block_color, 'red')
  })

  test('붙인 문서는 저장 검증을 통과한다', () => {
    const [a, a1, target] = [nextId(), nextId(), nextId()]
    const from = stateOf([blk(a, 'toggle', 'A', [blk(a1, 'to_do', '할 일', [], { checked: false })])])
    const into = select(stateOf([blk(target, 'paragraph', '대상')]), target)
    const next = copyPaste(from, into, [a])
    assert.ok(next)
    assert.deepEqual(validateDoc(pmToDoc(next.doc)), [])
  })
})

// ── id ────────────────────────────────────────────────────────────────

describe('id 는 언제나 새로 발급한다', () => {
  test('★ 같은 문서에 붙여도 id 가 겹치지 않는다', () => {
    // A(자식 a1)를 복사해 **다른 블록의 캐럿**에 붙인다. A 를 고른 채로 붙이면
    // 그건 대체라서(아래 "어디에 붙는가") 중복이 생길 자리가 없다.
    const [a, a1, b] = [nextId(), nextId(), nextId()]
    const doc = stateOf([blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1')]), blk(b, 'paragraph', 'B')])
    const next = copyPaste(doc, caretAt(doc, b, 1), [a])
    assert.ok(next)
    // 원본 3개(A · a1 · B) + 사본 2개(A' · a1').
    const ids = allIds(pmToDoc(next.doc).blocks)
    assert.equal(ids.length, 5, shape(next))
    assert.equal(new Set(ids).size, 5, '중복 id 가 있으면 프로젝터가 한 행에 두 번 쓴다')
    // 원본 A·a1 은 그대로 있고, 사본은 새 id 를 받았다.
    assert.ok(ids.includes(a) && ids.includes(a1))
  })

  test('자손까지 전부 새 id 다', () => {
    const [a, a1, a2] = [nextId(), nextId(), nextId()]
    const blocks = [blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1', [blk(a2)])])]
    const fresh = withFreshBlockIds(blocks, nextId)
    const before = new Set(allIds(blocks))
    assert.ok(allIds(fresh).every((id) => !before.has(id)))
  })
})

// ── 하위 페이지 ───────────────────────────────────────────────────────

describe('하위 페이지는 복사되지 않는다', () => {
  test('자손에 섞여 있어도 빠지고, 몇 개가 빠졌는지 알려준다', () => {
    const [a, p, q] = [nextId(), nextId(), nextId()]
    const from = stateOf([blk(a, 'toggle', 'A', [blk(p, 'page', '하위1')]), blk(q, 'page', '하위2')])
    const roots = [a, q].map((id) => {
      const info = findContainerById(from.doc, id)
      assert.ok(info)
      return info.pos
    })
    const out = serializeBlocks(from.doc, roots)
    assert.ok(out)
    assert.equal(out.dropped, 2)
    const parsed = parseClipboardBlocks(out.json)
    assert.ok(parsed.ok)
    assert.equal(parsed.blocks.length, 1)
    assert.equal((parsed.blocks[0].children ?? []).length, 0)
  })

  test('손으로 만든 클립보드가 하위 페이지를 들고 와도 걸러낸다', () => {
    const raw = JSON.stringify({
      version: CLIPBOARD_VERSION,
      blocks: [blk(nextId(), 'page', '하위'), blk(nextId(), 'paragraph', '본문')],
    })
    const parsed = parseClipboardBlocks(raw)
    assert.ok(parsed.ok)
    assert.equal(parsed.blocks.length, 1)
    assert.equal(parsed.blocks[0].type, 'paragraph')
  })

  test('stripPageRefs 는 자손을 유지한다', () => {
    const [a, a1] = [nextId(), nextId()]
    const { blocks, dropped } = stripPageRefs([blk(a, 'toggle', 'A', [blk(a1, 'paragraph', 'a1')])])
    assert.equal(dropped, 0)
    assert.equal(blocks[0].children?.[0].id, a1)
  })
})

// ── 클립보드 읽기 방어 ────────────────────────────────────────────────

describe('클립보드는 신뢰할 수 없는 입구다', () => {
  test('빈 값 · 깨진 JSON · 다른 버전 — 조용히 평문 경로로 떨어진다', () => {
    assert.equal(parseClipboardBlocks(null).ok, false)
    assert.equal(parseClipboardBlocks('').ok, false)
    assert.equal(parseClipboardBlocks('{어쩌고').ok, false)
    const other = JSON.stringify({ version: CLIPBOARD_VERSION + 1, blocks: [] })
    const parsed = parseClipboardBlocks(other)
    assert.equal(parsed.ok, false)
    assert.equal(parsed.ok === false && parsed.reason, 'other_version')
  })

  test('★ 저장할 때와 같은 함수로 검증한다 — 여기서 무르면 저장 단계에서 거부된다', () => {
    const broken = JSON.stringify({
      version: CLIPBOARD_VERSION,
      // uuid 가 아닌 id. validateDoc 이 거부하는 값이다.
      blocks: [{ id: 'not-a-uuid', type: 'paragraph', title: [], properties: {}, format: {}, children: [] }],
    })
    const parsed = parseClipboardBlocks(broken)
    assert.equal(parsed.ok, false)
    assert.equal(parsed.ok === false && parsed.reason, 'unreadable')
  })

  test('블록 수 상한 (정본: 1회 5000개)', () => {
    const many = Array.from({ length: MAX_PASTE_BLOCKS + 1 }, () => blk(nextId()))
    const parsed = parseClipboardBlocks(JSON.stringify({ version: CLIPBOARD_VERSION, blocks: many }))
    assert.equal(parsed.ok, false)
    assert.equal(parsed.ok === false && parsed.reason, 'too_many')
  })

  test('MIME 이름은 정본 형태다', () => {
    assert.equal(BLOCKS_MIME, 'application/x-notion-clone-blocks+json')
  })
})

// ── 붙는 자리 ─────────────────────────────────────────────────────────

describe('어디에 붙는가', () => {
  test('블록 선택 위에 붙이면 그 블록들을 대체한다', () => {
    const [a, b, c, x] = [nextId(), nextId(), nextId(), nextId()]
    const from = stateOf([blk(x, 'paragraph', 'X')])
    const into = select(
      stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B'), blk(c, 'paragraph', 'C')]),
      a,
      b,
    )
    const next = copyPaste(from, into, [x])
    assert.ok(next)
    next.doc.check()
    assert.equal(shape(next), 'X | C')
  })

  test('★ 캐럿 중간에 붙이면 첫 블록이 인라인으로 병합된다 (정본 엣지 케이스)', () => {
    const [a, x, y] = [nextId(), nextId(), nextId()]
    const from = stateOf([blk(x, 'paragraph', '하나'), blk(y, 'paragraph', '둘')])
    const into = caretAt(stateOf([blk(a, 'paragraph', '앞뒤')]), a, 1)
    const next = copyPaste(from, into, [x, y])
    assert.ok(next)
    next.doc.check()
    // "앞" + "하나" 가 한 블록이 되고, "둘" 과 남은 "뒤" 가 뒤따른다.
    assert.equal(shape(next), '앞하나 | 둘뒤')
  })

  test('빈 블록에 붙이면 그 블록이 대체된다', () => {
    const [a, x] = [nextId(), nextId()]
    const from = stateOf([blk(x, 'heading_1', '제목')])
    const into = caretAt(stateOf([blk(a, 'paragraph', '')]), a, 0)
    const next = copyPaste(from, into, [x])
    assert.ok(next)
    assert.equal(shape(next), '제목')
    assert.equal(pmToDoc(next.doc).blocks[0].type, 'heading_1')
  })

  test('구분선처럼 텍스트가 없는 블록도 캐럿에 붙는다 — 양끝을 열지 않는다', () => {
    const [a, d] = [nextId(), nextId()]
    const from = stateOf([blk(d, 'divider')])
    const into = caretAt(stateOf([blk(a, 'paragraph', '본문')]), a, 2)
    const next = copyPaste(from, into, [d])
    assert.ok(next)
    next.doc.check()
    assert.ok(pmToDoc(next.doc).blocks.some((b) => b.type === 'divider'))
  })

  test('★ 자식이 있는 블록의 캐럿에 붙여도 자식이 딸려가지 않는다 (§7-4 최빈 버그)', () => {
    // ProseMirror 에 맡기면 컨테이너를 쪼개면서 자식을 뒤 블록으로 옮긴다.
    // 실제 브라우저 검증에서 이 경로로 자식이 딸려가는 것을 봤다.
    const [parent, child, x] = [nextId(), nextId(), nextId()]
    const from = stateOf([blk(x, 'paragraph', 'X')])
    const into = caretAt(stateOf([blk(parent, 'toggle', '부모', [blk(child, 'paragraph', '자식')])]), parent, 2)
    const next = copyPaste(from, into, [x])
    assert.ok(next)
    next.doc.check()
    // 펼쳐져 있으니 화면에서 바로 다음 줄 = 첫 자식 자리(판결 ④ · `+` 버튼과 같다).
    assert.equal(shape(next), '부모 | 부모 > X | 부모 > 자식')
  })

  test('접혀 있으면 그 블록 **뒤**에 붙는다 — 접힌 안으로 넣으면 보이지 않는다', () => {
    const [parent, child, x] = [nextId(), nextId(), nextId()]
    const into = caretAt(stateOf([blk(parent, 'toggle', '부모', [blk(child, 'paragraph', '자식')])]), parent, 2)
    const next = run(
      into,
      pasteBlocksCommand([blk(x, 'paragraph', 'X')], deps({ newId: nextId, isCollapsed: (id) => id === parent })),
    )
    assert.ok(next)
    assert.equal(shape(next), '부모 | 부모 > 자식 | X')
  })

  test('빈 목록은 아무 일도 하지 않는다 (정본: 클립보드가 비어 있음 → 무동작)', () => {
    const a = nextId()
    const state = caretAt(stateOf([blk(a, 'paragraph', 'A')]), a, 0)
    assert.ok(run(state, pasteBlocksCommand([], deps())) === null)
  })
})

// ── 평문 ──────────────────────────────────────────────────────────────

describe('평문 — 나가는 쪽과 들어오는 쪽', () => {
  test('마크다운에 가깝게 나간다. 중첩은 들여쓰기로', () => {
    const blocks = [
      blk(nextId(), 'heading_1', '제목'),
      blk(nextId(), 'bulleted_list_item', '항목', [blk(nextId(), 'to_do', '할 일', [], { checked: true })]),
      blk(nextId(), 'divider'),
    ]
    assert.equal(plainTextForBlocks(blocks), '# 제목\n- 항목\n  - [x] 할 일\n---')
  })

  test('★ 한 줄이 한 블록이다 — 목록을 복사해 붙이는 흔한 경우', () => {
    const blocks = textToBlocks('첫 줄\n둘째 줄\n\n넷째 줄', nextId)
    assert.equal(blocks.length, 4)
    assert.deepEqual(blocks.map((b) => toPlainText(b.title)), ['첫 줄', '둘째 줄', '', '넷째 줄'])
    assert.ok(blocks.every((b) => b.type === 'paragraph'))
  })

  test('끝의 빈 줄은 버린다 — 줄바꿈으로 끝나는 텍스트가 빈 블록을 만들지 않게', () => {
    assert.equal(textToBlocks('한 줄\n', nextId).length, 1)
    assert.equal(textToBlocks('', nextId).length, 1, '빈 문자열은 빈 문단 하나')
  })

  test('줄바꿈 방식(CRLF)에 상관없이 같다', () => {
    assert.equal(textToBlocks('a\r\nb', nextId).length, 2)
  })
})
