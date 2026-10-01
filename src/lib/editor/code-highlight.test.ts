/**
 * 코드 블록의 문법 강조 — 잔여 묶음 8a-3 (F-01-14 · 실제 ProseMirror 상태 위에서 · DOM 없음 · highlight.js 를 실제로 돌린다)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 칠한다 — 언어가 있는 코드 블록의 글자에 highlight.js 클래스의 데코레이션 · 문서에는 아무것도 쓰지 않는다
 *   ② ★ 칠하지 않는다 — 언어 없음 · plain text · 목록 밖 · 문법이 없는 언어 · 문단 · 모양이 틀린 props(Y attr 은 무엇이든 될 수 있다)
 *   ③ ★ 문법이 들어오기 전에는 칠하지 않고 `missing` 에 적는다 — 들어왔다는 메타에 다시 짓는다
 *   ④ ★ 다시 짓기 — 언어를 바꾸면 · plain text 로 · 문단으로 바꾸면 옛 색이 남지 않는다 · 루트 교체(y-prosemirror 의 원격 변경)에도 색이 남는다
 *   ⑤ ★ 기억 — 다른 블록을 고치면 이 블록을 다시 읽지 않는다 · 선택만 바뀌면 상태가 그대로다
 *   ⑥ ★ 미루기 — 작은 블록은 곧바로 · 큰 블록과 한글 조합은 옛 색을 옮겨 두고 refresh 에 다시 읽는다
 *   ⑦ ★ 큰 블록은 창만 칠한다 — 처음 창 · 뷰가 알린 창 · 데코레이션 수가 묶인다 · 창 앞의 문맥 · 한 줄이 너무 길면 칠하지 않는다
 *   ⑧ 계획(순수) — 통째 · 창의 여백 · 줄 수를 넘는 창 · 문맥의 글자 상한 · 줄 머리
 *   ⑨ ★ 뷰(화면 없이) — 없는 문법을 불러와 다시 짓는다 · 미룬 블록을 손을 멈춘 뒤 다시 읽는다 · window 가 없어도 던지지 않는다
 */

import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'
import { Slice } from '@tiptap/pm/model'

import type { BlockType } from '../block/types.ts'
import { splitText, textRun, type RichTextRun } from '../contracts/rich-text.ts'
import { blockSchema } from './schema.ts'
import { docToPm } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { GRAMMAR_LOADERS, HIGHLIGHT_GRAMMARS, loadGrammar } from './code-grammars.ts'
import { setCodeLanguageCommand } from './code-block.ts'
import { turnIntoCommand } from './commands.ts'
import type { EditorBlock } from './document.ts'
import { headless } from '../testing/collab-peers.ts'
import {
  CONTEXT_LINES,
  CONTEXT_MAX_CHARS,
  DEFAULT_WINDOW_LINES,
  FULL_MAX_CHARS,
  SYNC_MAX_CHARS,
  WINDOW_MARGIN_LINES,
  WINDOW_MAX_CHARS,
  codeHighlightKey,
  codeHighlightPlugin,
  codeHighlightState,
  lineStartsOf,
  planHighlight,
  type Lines,
} from './code-highlight.ts'

// ── 도우미 ────────────────────────────────────────────────────────────

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function blk(type: BlockType, title: RichTextRun[] = [], properties: Record<string, unknown> = {}): EditorBlock {
  return { id: nextId(), type, title, properties, format: {}, children: [] }
}
/** 코드 블록 — 2000자마다 런을 나눈다(런의 계약). */
const code = (text: string, language?: string): EditorBlock =>
  blk('code', text === '' ? [] : splitText(text).map((t) => textRun(t)), language === undefined ? {} : { language })
const para = (text: string) => blk('paragraph', [textRun(text)])

function stateOf(blocks: EditorBlock[]): EditorState {
  return EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }), plugins: [codeHighlightPlugin()] })
}

/** 그 블록 글자의 첫 위치 · 크기. */
function contentOf(state: EditorState, id: string): { start: number; size: number; pos: number } {
  const info = findContainerById(state.doc, id)
  assert.ok(info, `블록을 찾지 못했다: ${id}`)
  return { start: info.contentPos + 1, size: info.contentNode.content.size, pos: info.contentPos }
}

type Painted = { from: number; to: number; cls: string }

/** 그려진 데코레이션 — 전부. */
function decorations(state: EditorState): Painted[] {
  return codeHighlightState(state)
    .set.find()
    .map((d) => ({ from: d.from, to: d.to, cls: (d as unknown as { type: { attrs: { class: string } } }).type.attrs.class }))
}

/** 그 블록에 칠한 (글자, 클래스). */
function painted(state: EditorState, id: string): [string, string][] {
  const { start, size } = contentOf(state, id)
  return decorations(state)
    .filter((d) => d.from >= start && d.to <= start + size)
    .map((d) => [state.doc.textBetween(d.from, d.to), d.cls])
}

const has = (out: [string, string][], text: string, cls: string) => out.some(([t, c]) => t === text && c === cls)

/** 그 블록 글자의 offset 자리에 글자를 넣는다. */
function insertAt(state: EditorState, id: string, offset: number, text: string, meta?: [string, unknown]): EditorState {
  const tr = state.tr.insertText(text, contentOf(state, id).start + offset)
  if (meta) tr.setMeta(meta[0], meta[1])
  return state.apply(tr)
}

const withMeta = (state: EditorState, meta: Record<string, unknown>) => state.apply(state.tr.setMeta(codeHighlightKey, meta))

function run(state: EditorState, command: Command): EditorState {
  let next: EditorState | null = null
  assert.ok(command(state, (tr) => (next = state.apply(tr))), '명령이 돌지 않았다')
  return next!
}

/** 큰 파이썬 블록의 줄 — 줄마다 숫자 하나와 주석 하나. */
const pyLine = (i: number) => `v${i} = ${i}  # c${i}`
const bigPython = (lines: number, line: (i: number) => string = pyLine) => Array.from({ length: lines }, (_, i) => line(i)).join('\n')

/** 칠한 범위가 든 줄의 처음과 끝. */
function paintedLines(state: EditorState, id: string): Lines | null {
  const { start, size, pos } = contentOf(state, id)
  const text = state.doc.nodeAt(pos)!.textContent
  const starts = lineStartsOf(text)
  const lineOf = (offset: number) => {
    let line = 0
    while (line + 1 < starts.length && starts[line + 1] <= offset) line += 1
    return line
  }
  const all = decorations(state).filter((d) => d.from >= start && d.to <= start + size)
  if (all.length === 0) return null
  return [lineOf(all[0].from - start), lineOf(all[all.length - 1].to - 1 - start)]
}

before(async () => {
  await loadGrammar('python')
  await loadGrammar('javascript')
})

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 칠한다', () => {
  test('★ 언어가 있는 코드 블록의 글자에 highlight.js 클래스 — 문서에는 서식이 없다', () => {
    const block = code('def f(x):\n    return "hi"  # c', 'python')
    const state = stateOf([para('위'), block])
    const out = painted(state, block.id)
    assert.ok(has(out, 'def', 'hljs-keyword'), JSON.stringify(out))
    assert.ok(has(out, 'f', 'hljs-title function_'), JSON.stringify(out))
    assert.ok(has(out, '"hi"', 'hljs-string'), JSON.stringify(out))
    assert.ok(has(out, '# c', 'hljs-comment'), JSON.stringify(out))
    let marked = false
    state.doc.descendants((n) => {
      if (n.marks.length > 0) marked = true
    })
    assert.equal(marked, false, '강조가 문서에 서식으로 들어갔다')
  })

  test('★ 데코레이션은 코드 블록 글자 밖으로 나가지 않는다 — 블록이 여럿이어도', () => {
    const a = code('x = 1', 'python')
    const b = code('let y = "s"', 'javascript')
    const state = stateOf([para('def 아님'), a, para('let 아님'), b])
    const inside = [contentOf(state, a.id), contentOf(state, b.id)]
    const all = decorations(state)
    assert.ok(all.length >= 3)
    for (const d of all) assert.ok(inside.some((c) => d.from >= c.start && d.to <= c.start + c.size), JSON.stringify(d))
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 칠하지 않는다', () => {
  test('★ 언어 없음 · plain text · 목록 밖(별칭) · 문법이 없는 언어 · 문단', () => {
    const blocks = [code('def f(): pass'), code('def f(): pass', 'plain text'), code('def f(): pass', 'py'), code('graph TD; A-->B', 'mermaid'), para('def f(): pass')]
    const state = stateOf(blocks)
    assert.deepEqual(decorations(state), [])
    assert.deepEqual([...codeHighlightState(state).missing], [], '칠하지 않을 언어의 문법을 조른다')
  })

  test('★ 모양이 틀린 props · 언어 — 던지지 않고 칠하지 않는다(수선이 오기 전의 협업 문서)', () => {
    const block = code('def f(): pass', 'python')
    const base = stateOf([block])
    assert.ok(painted(base, block.id).length > 0, '전제 — 정상 값은 칠한다')
    for (const poison of [null, 'python', ['python'], 7, { language: 5 }, { language: 5n }, { language: {} }, { language: 'constructor' }, { language: '__proto__' }]) {
      const { pos } = contentOf(base, block.id)
      const node = base.doc.nodeAt(pos)!
      const next = base.apply(base.tr.setNodeMarkup(pos, undefined, { ...node.attrs, props: poison }))
      assert.deepEqual(painted(next, block.id), [], String(JSON.stringify(poison, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v))))
    }
  })
})

// ── ③ ─────────────────────────────────────────────────────────────────

describe('③ 문법 지연 로드', () => {
  test('★ 들어오기 전에는 칠하지 않고 missing 에 적는다 — 들어왔다는 메타에 다시 짓는다', async () => {
    const block = code('fn main() { let x = 1; }', 'rust')
    let state = stateOf([block])
    assert.deepEqual(painted(state, block.id), [])
    assert.deepEqual([...codeHighlightState(state).missing], ['rust'])
    await loadGrammar('rust')
    // 문서도 메타도 없는 트랜잭션은 다시 짓지 않는다 — 뷰가 메타를 보내야 한다.
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, contentOf(state, block.id).start)))
    assert.deepEqual(painted(state, block.id), [])
    state = withMeta(state, { loaded: 'rust' })
    assert.ok(has(painted(state, block.id), 'fn', 'hljs-keyword'), JSON.stringify(painted(state, block.id)))
    assert.deepEqual([...codeHighlightState(state).missing], [])
  })

  test('★ 불러오기에 실패한 문법은 missing 에서 빠진다 — 다시 조르지 않고 칠하지 않는다', async () => {
    // 검사 전용 언어 · 문법 — 실패하는 덩어리를 흉내낸다. 표는 실행 중에는 Map 이다.
    const grammars = HIGHLIGHT_GRAMMARS as Map<string, string | null>
    const loaders = GRAMMAR_LOADERS as Map<string, () => Promise<never>>
    grammars.set('test-lang', 'test-broken')
    loaders.set('test-broken', () => Promise.reject(new Error('덩어리를 받지 못했다')))
    try {
      const block = code('x', 'test-lang')
      let state = stateOf([block])
      assert.deepEqual([...codeHighlightState(state).missing], ['test-broken'])
      await assert.rejects(loadGrammar('test-broken'))
      state = withMeta(state, { loaded: 'test-broken' })
      assert.deepEqual([...codeHighlightState(state).missing], [])
      assert.deepEqual(decorations(state), [])
    } finally {
      grammars.delete('test-lang')
      loaders.delete('test-broken')
    }
  })
})

// ── ④ ─────────────────────────────────────────────────────────────────

describe('④ 다시 짓기', () => {
  test('★ 언어를 바꾸면 그 문법으로 · plain text 로 바꾸면 색이 사라진다', () => {
    const block = code('def x', 'python')
    let state = stateOf([block])
    assert.ok(has(painted(state, block.id), 'def', 'hljs-keyword'))
    state = run(state, setCodeLanguageCommand(block.id, 'javascript'))
    assert.ok(!painted(state, block.id).some(([t]) => t === 'def'), 'javascript 에서 def 는 키워드가 아니다')
    state = run(state, setCodeLanguageCommand(block.id, 'python'))
    assert.ok(has(painted(state, block.id), 'def', 'hljs-keyword'))
    state = run(state, setCodeLanguageCommand(block.id, null))
    assert.deepEqual(decorations(state), [])
  })

  test('★ 코드를 문단으로 바꾸면 옛 색이 문단 글자에 남지 않는다', () => {
    const block = code('def f(): return 1', 'python')
    let state = stateOf([block])
    assert.ok(decorations(state).length > 0)
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, contentOf(state, block.id).start)))
    state = run(state, turnIntoCommand('paragraph'))
    assert.equal(state.doc.nodeAt(contentOf(state, block.id).pos)?.type.name, 'paragraph', '전제 — 문단이 됐다')
    assert.deepEqual(decorations(state), [])
  })

  test('★ 루트를 통째로 갈아 끼워도(y-prosemirror 의 원격 변경) 색이 남는다 — 옛 집합을 따라가지 않고 다시 짓는다', () => {
    const block = code('def f(): return "s"', 'python')
    const state = stateOf([para('a'), block])
    const before = painted(state, block.id)
    assert.ok(before.length >= 3)
    const replaced = state.apply(state.tr.replace(0, state.doc.content.size, new Slice(state.doc.content, 0, 0)))
    assert.ok(replaced.doc.eq(state.doc), '전제 — 같은 문서')
    assert.deepEqual(painted(replaced, block.id), before)
  })
})

// ── ⑤ ─────────────────────────────────────────────────────────────────

describe('⑤ 기억', () => {
  test('★ 다른 블록을 고치면 이 블록을 다시 읽지 않는다 · 이 블록을 고치면 이것만 다시 읽는다', () => {
    const a = code('x = 1', 'python')
    const b = code('y = 2', 'python')
    const p = para('문단')
    let state = stateOf([a, p, b])
    const memoA = codeHighlightState(state).memos.get(a.id)
    const memoB = codeHighlightState(state).memos.get(b.id)
    assert.ok(memoA && memoB)
    state = insertAt(state, p.id, 0, '앞')
    assert.equal(codeHighlightState(state).memos.get(a.id), memoA, '문단을 고쳤는데 a 를 다시 읽었다')
    assert.equal(codeHighlightState(state).memos.get(b.id), memoB, '문단을 고쳤는데 b 를 다시 읽었다')
    state = insertAt(state, b.id, 5, '0')
    assert.equal(codeHighlightState(state).memos.get(a.id), memoA, 'b 를 고쳤는데 a 를 다시 읽었다')
    assert.notEqual(codeHighlightState(state).memos.get(b.id), memoB)
    assert.ok(has(painted(state, b.id), '20', 'hljs-number'))
  })

  test('선택만 바뀌면 상태가 그대로다(같은 객체)', () => {
    const block = code('x = 1', 'python')
    const state = stateOf([block])
    const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, contentOf(state, block.id).start + 2)))
    assert.equal(codeHighlightState(moved), codeHighlightState(state))
  })
})

// ── ⑥ ─────────────────────────────────────────────────────────────────

describe('⑥ 미루기', () => {
  test('★ 작은 블록은 고치는 즉시 다시 읽는다', () => {
    const block = code('x = 1', 'python')
    const state = insertAt(stateOf([block]), block.id, 5, ' + 42')
    assert.ok(has(painted(state, block.id), '42', 'hljs-number'))
    assert.equal(codeHighlightState(state).stale.size, 0)
  })

  test('★ 읽을 글자가 SYNC_MAX_CHARS 를 넘으면 옛 색을 옮겨 두고 refresh 에 다시 읽는다', () => {
    const text = bigPython(300)
    assert.ok(text.length > SYNC_MAX_CHARS && text.length <= FULL_MAX_CHARS, '전제 — 통째로 칠하되 곧바로는 아닌 크기')
    const block = code(text, 'python')
    let state = stateOf([block])
    const before = painted(state, block.id)
    state = insertAt(state, block.id, 0, 'w = 777\n')
    assert.deepEqual([...codeHighlightState(state).stale], [block.id])
    // 옛 색이 옮겨졌다 — 같은 글자에 같은 클래스, 새 글자는 아직 칠하지 않았다.
    assert.deepEqual(painted(state, block.id), before)
    assert.ok(!painted(state, block.id).some(([t]) => t === '777'))
    state = withMeta(state, { refresh: true })
    assert.equal(codeHighlightState(state).stale.size, 0)
    assert.ok(has(painted(state, block.id), '777', 'hljs-number'))
    assert.equal(painted(state, block.id).length, before.length + 1)
  })

  test('★ 한글 조합 중이면 작은 블록도 미룬다 — 조합 트랜잭션의 composition 메타', () => {
    const block = code('x = 1  # ', 'python')
    let state = stateOf([block])
    state = insertAt(state, block.id, 9, '한', ['composition', 1])
    assert.deepEqual([...codeHighlightState(state).stale], [block.id])
    // 조합 중인 글자를 감싼 범위가 바뀌지 않았다 — 주석 범위는 옛 길이 그대로다.
    assert.ok(has(painted(state, block.id), '# ', 'hljs-comment'), JSON.stringify(painted(state, block.id)))
    state = withMeta(state, { refresh: true })
    assert.ok(has(painted(state, block.id), '# 한', 'hljs-comment'), JSON.stringify(painted(state, block.id)))
  })

  test('처음 보는 블록은 조합 중이어도 곧바로 칠한다 — 옮길 옛 색이 없다', () => {
    const block = code('x = 1', 'python')
    const plain = stateOf([block])
    const unknown = run(plain, setCodeLanguageCommand(block.id, null))
    // 언어를 다시 주는 것과 조합이 한 트랜잭션에 오는 일은 없지만, 기억이 없는 블록은 미룰 수 없다.
    const tr = unknown.tr
    const { pos } = contentOf(unknown, block.id)
    tr.setNodeMarkup(pos, undefined, { ...unknown.doc.nodeAt(pos)!.attrs, props: { language: 'python' } }).setMeta('composition', 2)
    const state = unknown.apply(tr)
    assert.equal(codeHighlightState(state).stale.size, 0)
    assert.ok(has(painted(state, block.id), '1', 'hljs-number'))
  })
})

// ── ⑦ ─────────────────────────────────────────────────────────────────

describe('⑦ 큰 블록은 창만', () => {
  test('★ 처음에는 첫 DEFAULT_WINDOW_LINES 줄 + 여백 — 데코레이션 수가 블록 크기와 상관없이 묶인다', () => {
    const block = code(bigPython(10_000), 'python')
    const state = stateOf([block])
    const lines = paintedLines(state, block.id)
    assert.deepEqual(lines, [0, DEFAULT_WINDOW_LINES - 1 + WINDOW_MARGIN_LINES])
    assert.ok(decorations(state).length <= (DEFAULT_WINDOW_LINES + WINDOW_MARGIN_LINES) * 4, String(decorations(state).length))
    const windowed = codeHighlightState(state).windowed
    assert.equal(windowed.length, 1)
    assert.deepEqual(windowed[0].lines, [0, DEFAULT_WINDOW_LINES - 1 + WINDOW_MARGIN_LINES])
    assert.equal(windowed[0].contentStart, contentOf(state, block.id).start)
  })

  test('★ 뷰가 알린 보이는 줄 ± 여백만 칠한다 — 위는 칠하지 않는다', () => {
    const block = code(bigPython(10_000), 'python')
    const state = withMeta(stateOf([block]), { windows: [[block.id, [5000, 5040]]] })
    assert.deepEqual(paintedLines(state, block.id), [5000 - WINDOW_MARGIN_LINES, 5040 + WINDOW_MARGIN_LINES])
    assert.ok(has(painted(state, block.id), '# c5000', 'hljs-comment'))
    assert.ok(!painted(state, block.id).some(([t]) => t === '# c0'))
    assert.deepEqual(codeHighlightState(state).windowed[0].lines, [5000 - WINDOW_MARGIN_LINES, 5040 + WINDOW_MARGIN_LINES])
  })

  test('★ 창 앞의 문맥을 읽는다 — 창 위에서 연 여러 줄 문자열 안의 def 는 키워드가 아니다', () => {
    const open = 5000 - WINDOW_MARGIN_LINES - 20
    const close = 5000 - WINDOW_MARGIN_LINES + 30
    assert.ok(5000 - WINDOW_MARGIN_LINES - open < CONTEXT_LINES, '전제 — 여는 줄이 문맥 안이다')
    const block = code(bigPython(10_000, (i) => (i === open || i === close ? '"""' : i > open && i < close ? `def inside${i}` : pyLine(i))), 'python')
    const state = withMeta(stateOf([block]), { windows: [[block.id, [5000, 5040]]] })
    const out = painted(state, block.id)
    const insideLine = `def inside${5000 - WINDOW_MARGIN_LINES + 10}`
    // 문맥 없이 창의 첫 줄부터 읽으면 문자열 안의 def 가 키워드가 되고, 닫는 """ 가 새 문자열을 연다.
    assert.ok(!out.some(([t, c]) => t === 'def' && c === 'hljs-keyword'), JSON.stringify(out.slice(0, 3)))
    // 창의 첫 줄부터 닫는 줄까지가 한 문자열 범위다.
    const first = out[0]
    assert.equal(first[1], 'hljs-string', JSON.stringify(out.slice(0, 3)))
    assert.ok(first[0].includes(insideLine) && first[0].endsWith('"""'), JSON.stringify(first[0].slice(-40)))
  })

  test('★ 한 줄이 창의 상한을 넘으면 칠하지 않는다 — 여백을 먼저 버린다', () => {
    const giant = 'x' + ' = 1'.repeat(WINDOW_MAX_CHARS / 4 + 10)
    const block = code(bigPython(2_000, (i) => (i === 500 ? giant : pyLine(i))), 'python')
    // 그 줄만 보이면 칠하지 않는다 — 창은 그대로 알린다(스크롤하면 다시 잰다).
    const onGiant = withMeta(stateOf([block]), { windows: [[block.id, [500, 500]]] })
    assert.deepEqual(painted(onGiant, block.id), [])
    assert.deepEqual(codeHighlightState(onGiant).windowed[0].lines, [500, 500])
    // 보이는 줄에는 없고 여백에만 있으면 여백을 버리고 보이는 줄을 칠한다.
    const near = withMeta(stateOf([block]), { windows: [[block.id, [520, 530]]] })
    assert.deepEqual(paintedLines(near, block.id), [520, 530])
  })

  test('★ 큰 블록을 고치면 미룬다 — refresh 에 같은 창을 다시 읽는다', () => {
    const block = code(bigPython(10_000), 'python')
    let state = withMeta(stateOf([block]), { windows: [[block.id, [5000, 5040]]] })
    const at = lineStartsOf(state.doc.nodeAt(contentOf(state, block.id).pos)!.textContent)[5010]
    state = insertAt(state, block.id, at, '# 새 주석\n')
    assert.deepEqual([...codeHighlightState(state).stale], [block.id])
    state = withMeta(state, { refresh: true })
    assert.ok(has(painted(state, block.id), '# 새 주석', 'hljs-comment'))
    assert.deepEqual(paintedLines(state, block.id), [5000 - WINDOW_MARGIN_LINES, 5040 + WINDOW_MARGIN_LINES])
  })

  test('창은 블록이 사라지면 잊는다 · 다른 블록의 창과 섞이지 않는다', () => {
    const a = code(bigPython(3_000), 'python')
    const b = code(bigPython(3_000), 'python')
    let state = withMeta(stateOf([a, b]), { windows: [[b.id, [1000, 1010]]] })
    assert.deepEqual(paintedLines(state, a.id), [0, DEFAULT_WINDOW_LINES - 1 + WINDOW_MARGIN_LINES])
    assert.deepEqual([...codeHighlightState(state).windows.keys()], [b.id])
    state = run(state, setCodeLanguageCommand(b.id, null))
    assert.deepEqual([...codeHighlightState(state).windows.keys()], [])
  })
})

// ── ⑨ ─────────────────────────────────────────────────────────────────

/** 조건이 설 때까지 — 뷰의 비동기(문법 불러오기 · 미룬 다시 읽기)를 기다린다. */
async function eventually(ok: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (ok()) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return ok()
}

describe('⑨ 뷰 — 화면 없이(headless)', () => {
  test('★ 뷰가 없는 문법을 불러와 메타로 다시 짓는다 — 글자를 더 치지 않아도 · 화면이 없어도 던지지 않는다', async () => {
    const block = code('local x = 1', 'lua')
    const editor = headless(stateOf([block]))
    try {
      assert.deepEqual(painted(editor.state, block.id), [], '전제 — 이 파일에서 lua 를 처음 본다')
      assert.ok(await eventually(() => has(painted(editor.state, block.id), 'local', 'hljs-keyword')), JSON.stringify(painted(editor.state, block.id)))
    } finally {
      editor.destroy()
    }
  })

  test('★ 미룬 블록은 손을 멈춘 뒤 뷰가 다시 읽게 한다(refresh 메타)', async () => {
    const block = code(bigPython(300), 'python')
    const editor = headless(stateOf([block]))
    try {
      editor.dispatch(editor.state.tr.insertText('w = 777\n', contentOf(editor.state, block.id).start))
      assert.deepEqual([...codeHighlightState(editor.state).stale], [block.id], '전제 — 미뤘다')
      assert.ok(await eventually(() => codeHighlightState(editor.state).stale.size === 0), '다시 읽지 않았다')
      assert.ok(has(painted(editor.state, block.id), '777', 'hljs-number'))
    } finally {
      editor.destroy()
    }
  })
})

// ── ⑧ ─────────────────────────────────────────────────────────────────

describe('⑧ 계획', () => {
  test('작으면 통째 — 창이 없다', () => {
    const plan = planHighlight('x = 1', 'python')
    assert.deepEqual(plan, { key: 'python|all', scanFrom: 0, from: 0, to: 5, lines: null, skip: false, cost: 5 })
    assert.equal(planHighlight('x'.repeat(FULL_MAX_CHARS), 'python').lines, null)
    assert.notEqual(planHighlight('x\n'.repeat(FULL_MAX_CHARS), 'python').lines, null)
  })

  test('창 — 보이는 줄이 줄 수를 넘으면 마지막 줄로 당긴다(글자를 지운 뒤의 낡은 창)', () => {
    const text = bigPython(2_000)
    const plan = planHighlight(text, 'python', [5000, 6000])
    assert.deepEqual(plan.lines, [1999 - WINDOW_MARGIN_LINES, 1999])
    assert.equal(plan.to, text.length)
  })

  test('문맥은 CONTEXT_MAX_CHARS 를 넘지 않는다 — 줄이 길면 줄 수보다 먼저 멈춘다', () => {
    const text = bigPython(1_000, (i) => `# ${'긴 주석 '.repeat(40)} ${i}`)
    const plan = planHighlight(text, 'python', [600, 610])
    assert.ok(plan.from - plan.scanFrom <= CONTEXT_MAX_CHARS, `${plan.from - plan.scanFrom}`)
    assert.ok(plan.from - plan.scanFrom > 0)
    assert.ok(plan.cost <= WINDOW_MAX_CHARS + CONTEXT_MAX_CHARS)
  })

  test('줄 머리 — 빈 줄 · 끝의 줄바꿈', () => {
    assert.deepEqual(lineStartsOf(''), [0])
    assert.deepEqual(lineStartsOf('a\n\nb\n'), [0, 2, 3, 5])
  })
})
