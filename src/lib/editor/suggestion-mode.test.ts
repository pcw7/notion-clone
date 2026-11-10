/**
 * 제안 모드 — SG-1 (F-05-12 · 판결 U-2 · 불변식 S10) (DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **마크 셋** — `suggestion_insert` · `suggestion_delete` · `suggestion_format` 이 있고 sid · author_id 는 문자열이어야 한다.
 *      그리기는 `data-suggestion` · `data-sid`
 *   ② **넣기** — 친 글은 내 insert 마크를 단다 · 이어 친 것(같은 블록 · 붙은 범위 · 같은 사람)은 같은 sid · 떨어진 자리 · 다른 블록은
 *      새 sid · 남의 insert 에 붙여 쳐도 내 것이다
 *   ③ **지우기** — 지운 글은 남고 delete 마크를 단다(캐럿은 그 너머) · 이어 지운 것은 같은 sid · 내 insert 글은 진짜 지운다 · 남의
 *      delete 는 덮지 않는다 · 고른 글을 덮어 치면 줄 그은 글 뒤에 넣는다
 *   ④ **구조 · 서식은 막는다**(S10) — 블록 나누기 · 합치기 · 바꾸기 · 지우기 · 굵게 · 코드 블록. 꺼졌거나 Y.Doc 에서 온 것은 받은 그대로
 *   ⑤ **저장 마크** — 캐럿에 내 insert 마크(붙은 내 insert 의 sid) — IME 조합이 그 마크 안에서 시작한다
 *   ⑥ **왕복** — PM 문서 → Y.Doc(마크 이름이 Y attr 키) → 읽기 → 정규화에서 마크가 그대로다 · 계약 런은 글만 싣는다(제안은 Y.Doc 에)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Mark, type Node as PmNode } from '@tiptap/pm/model'

import { textRun } from '../contracts/rich-text.ts'
import { normalizeBody } from '../collab/normalize.ts'
import { BODY_FRAGMENT, readBodyPm } from '../collab/ydoc.ts'
import { createInlineAtom } from './atom-marks.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { blockSchema, MENTION_NODE } from './schema.ts'
import {
  caretMarks,
  setSuggestionMode,
  suggestingAuthor,
  suggestionModePlugin,
  suggestTransaction,
  type SuggestBlock,
} from './suggestion-mode.ts'

const ME = randomUUID()
const OTHER = randomUUID()
const INSERT = blockSchema.marks.suggestion_insert!
const DELETE = blockSchema.marks.suggestion_delete!

const ids = (): (() => string) => {
  let n = 0
  return () => `sid-${(n += 1)}`
}

type Block = { readonly id: string; readonly text: string; readonly type?: 'paragraph' | 'code' }

/** 블록들로 문서 — 제안 모드를 켠 상태(`on`)로. 첫 문단의 글자는 위치 3 부터다. */
function stateOf(blocks: readonly Block[], on = true, newId = ids()): EditorState {
  const doc = docToPm({ blocks: blocks.map((b) => ({ id: b.id, type: b.type ?? 'paragraph', title: b.text === '' ? [] : [textRun(b.text)] })) })
  const state = EditorState.create({ schema: blockSchema, doc, plugins: [suggestionModePlugin(newId)] })
  return on ? state.apply(setSuggestionMode(state.tr, ME)) : state
}

/** 블록 글자의 시작 위치. */
function textStart(doc: PmNode, blockId: string): number {
  let at = -1
  doc.descendants((node, pos) => {
    if (node.type.name === 'blockContainer' && node.attrs.blockId === blockId) at = pos + 2
    return at < 0
  })
  assert.ok(at >= 0, `블록이 없다: ${blockId}`)
  return at
}

const caret = (state: EditorState, pos: number): EditorState => state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
const select = (state: EditorState, from: number, to: number): EditorState =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))

type Run = { readonly state: EditorState; readonly blocked: SuggestBlock | null; readonly passed: boolean }

/** 편집기의 dispatch 와 같은 길 — `create-editor.ts`. */
function dispatch(state: EditorState, make: (tr: Transaction) => void, isRemote?: (tr: Transaction) => boolean): Run {
  const tr = state.tr
  make(tr)
  const outcome = suggestTransaction(state, tr, isRemote, ids())
  if ('blocked' in outcome) return { state, blocked: outcome.blocked, passed: false }
  return { state: state.apply(outcome.tr), blocked: null, passed: outcome.tr === tr }
}

/** 브라우저가 글자를 친 것과 같은 트랜잭션(ProseMirror 의 DOM 읽기 — 저장 마크 · 앞 글자의 마크를 문다). */
const type = (state: EditorState, text: string): Run =>
  dispatch(state, (tr) => tr.insertText(text, state.selection.from, state.selection.to))
/** Backspace — 캐럿 앞 한 글자(브라우저가 지운 것을 ProseMirror 가 읽은 모양). */
const backspace = (state: EditorState): Run => dispatch(state, (tr) => tr.delete(state.selection.from - 1, state.selection.from))
/** Delete — 캐럿 뒤 한 글자. */
const forwardDelete = (state: EditorState): Run => dispatch(state, (tr) => tr.delete(state.selection.from, state.selection.from + 1))

/**
 * 한 블록의 모양 — 글 조각마다 `글` · 내 insert `글+A` · 내 delete `글-A` · 남의 것은 끝에 `남`. sid 는 처음 나온 차례로 A · B …
 * (값이 아니라 같은가 · 다른가를 본다).
 */
function shape(state: EditorState, blockId: string): string {
  const names = new Map<string, string>()
  const nameOf = (sid: string): string => {
    if (!names.has(sid)) names.set(sid, String.fromCharCode(65 + names.size))
    return names.get(sid)!
  }
  let container: PmNode | null = null
  state.doc.descendants((node) => {
    if (node.type.name === 'blockContainer' && node.attrs.blockId === blockId) container = node
    return container === null
  })
  const parts: string[] = []
  ;(container as PmNode | null)?.child(0).forEach((node) => {
    let part = node.isText ? node.text! : `[${node.type.name}]`
    for (const mark of node.marks) {
      const sign = mark.type === INSERT ? '+' : mark.type === DELETE ? '-' : null
      if (sign !== null) part += `${sign}${nameOf(String(mark.attrs.sid))}${mark.attrs.author_id === ME ? '' : '남'}`
    }
    parts.push(part)
  })
  return parts.join('|')
}

// ── ① 마크 셋 ─────────────────────────────────────────────────────────

describe('① 마크 셋', () => {
  test('★ 세 마크가 있고 sid · author_id 는 문자열이어야 한다 — 그리기는 data-suggestion · data-sid', () => {
    for (const [name, kind] of [['suggestion_insert', 'insert'], ['suggestion_delete', 'delete'], ['suggestion_format', 'format']] as const) {
      const markType = blockSchema.marks[name]
      assert.ok(markType, name)
      const mark = markType.create({ sid: 's1', author_id: ME })
      const [tag, attrs] = markType.spec.toDOM!(mark, true) as [string, Record<string, string>, number]
      assert.equal(tag, 'span')
      assert.equal(attrs['data-suggestion'], kind)
      assert.equal(attrs['data-sid'], 's1')
      assert.equal(markType.spec.inclusive, false, '끝에 붙여 친 글이 물려받으면 모드가 꺼진 편집도 제안이 된다')
      // 검사하는 길(JSON 읽기 · `Node.check`)은 문자열이 아닌 sid 를 거부한다 · sid 가 없으면 만들 수 없다
      assert.throws(() => Mark.fromJSON(blockSchema, { type: name, attrs: { sid: 5, author_id: ME } }), '숫자 sid')
      assert.throws(() => markType.create({ author_id: ME }), 'sid 없음')
    }
  })
})

// ── ② 넣기 ────────────────────────────────────────────────────────────

describe('② 넣기', () => {
  test('★ 친 글은 내 insert 마크 · 이어 친 것은 같은 sid · 떨어진 자리는 새 sid', () => {
    const p = randomUUID()
    let state = caret(stateOf([{ id: p, text: '원래글' }]), 6)
    state = type(state, '새').state
    state = type(state, ' 글').state
    assert.equal(shape(state, p), '원래글|새 글+A', '이어 친 것은 한 제안이다')
    // 맨 앞(내 제안과 떨어진 자리) — 새 제안
    state = type(caret(state, 3), '앞').state
    assert.equal(shape(state, p), '앞+A|원래글|새 글+B')
  })

  test('다른 블록에서 친 것은 새 sid · 내 제안 바로 앞에 친 것은 그 sid', () => {
    const [p, q] = [randomUUID(), randomUUID()]
    let state = stateOf([{ id: p, text: '하나' }, { id: q, text: '둘' }])
    state = type(caret(state, textStart(state.doc, p) + 2), '가').state
    state = type(caret(state, textStart(state.doc, q) + 1), '나').state
    assert.equal(shape(state, p), '하나|가+A')
    assert.equal(shape(state, q), '둘|나+A')
    const sids = new Set<string>()
    state.doc.descendants((node) => {
      const mark = INSERT.isInSet(node.marks)
      if (mark) sids.add(String(mark.attrs.sid))
      return true
    })
    assert.equal(sids.size, 2, '블록이 다르면 다른 제안이다')
    // 내 제안 "가" 바로 앞 — 붙은 범위다
    state = type(caret(state, textStart(state.doc, p) + 2), '앞').state
    assert.equal(shape(state, p), '하나|앞가+A')
  })

  test('남의 insert 에 붙여 친 글은 내 insert 다(남의 것을 물려받지 않는다)', () => {
    const p = randomUUID()
    let state = stateOf([{ id: p, text: '원문' }])
    state = state.apply(state.tr.addMark(3, 5, INSERT.create({ sid: 'other', author_id: OTHER })))
    state = type(caret(state, 5), '뒤').state
    assert.equal(shape(state, p), '원문+A남|뒤+B')
  })
})

// ── ③ 지우기 ──────────────────────────────────────────────────────────

describe('③ 지우기', () => {
  test('★ Backspace 는 글을 지우지 않고 delete 마크 — 캐럿은 줄 그은 글 앞 · 이어 지운 것은 같은 sid', () => {
    const p = randomUUID()
    let state = caret(stateOf([{ id: p, text: '원래글' }]), 6)
    let run = backspace(state)
    assert.equal(shape(run.state, p), '원래|글-A')
    assert.equal(run.state.selection.from, 5, '캐럿이 줄 그은 글 앞으로 — 다음 Backspace 가 그 앞 글자')
    run = backspace(run.state)
    assert.equal(shape(run.state, p), '원|래글-A', '이어 지운 것은 한 제안이다')
    state = run.state
    assert.equal(state.doc.textContent, '원래글', '글은 그대로다')
  })

  test('Delete 는 캐럿 뒤 글에 delete 마크 — 캐럿은 줄 그은 글 뒤', () => {
    const p = randomUUID()
    const run = forwardDelete(caret(stateOf([{ id: p, text: '원래글' }]), 3))
    assert.equal(shape(run.state, p), '원-A|래글')
    assert.equal(run.state.selection.from, 4)
  })

  test('★ 내 insert 글을 지우면 진짜 지운다 — 내 제안 고치기', () => {
    const p = randomUUID()
    let state = caret(stateOf([{ id: p, text: '원래글' }]), 6)
    state = type(state, '새 글').state
    state = backspace(state).state
    assert.equal(shape(state, p), '원래글|새 +A')
    assert.equal(state.doc.textContent, '원래글새 ')
  })

  test('남의 delete 는 덮지 않는다 · 남의 insert 를 지우면 delete 마크를 단다', () => {
    const p = randomUUID()
    let state = stateOf([{ id: p, text: '가나다' }])
    state = state.apply(state.tr.addMark(3, 4, DELETE.create({ sid: 'd', author_id: OTHER })).addMark(4, 5, INSERT.create({ sid: 'i', author_id: OTHER })))
    const run = dispatch(select(state, 3, 5), (tr) => tr.deleteSelection())
    assert.equal(shape(run.state, p), '가-A남|나+B남-C|다')
  })

  test('★ 고른 글을 덮어 치면 고른 글에 줄을 긋고 그 뒤에 넣는다 — 캐럿은 넣은 글 뒤', () => {
    const p = randomUUID()
    const state = select(stateOf([{ id: p, text: '가나다라' }]), 4, 6)
    const run = type(state, '새')
    assert.equal(shape(run.state, p), '가|나다-A|새+B|라')
    assert.equal(run.state.selection.from, 7)
  })
})

// ── ④ 막기 ────────────────────────────────────────────────────────────

describe('④ 구조 · 서식은 막는다 (S10)', () => {
  test('★ 블록 나누기 · 합치기 · 바꾸기 · 블록 지우기는 structure · 굵게는 format · 코드 블록은 plain_text', () => {
    const [p, q, c] = [randomUUID(), randomUUID(), randomUUID()]
    const state = stateOf([{ id: p, text: '하나' }, { id: q, text: '둘' }, { id: c, text: 'x = 1', type: 'code' }])
    const qStart = textStart(state.doc, q)
    const cases: readonly [string, (tr: Transaction) => void, SuggestBlock][] = [
      ['나누기(Enter)', (tr) => tr.split(4, 2), 'structure'],
      ['합치기(블록 맨 앞의 Backspace)', (tr) => tr.delete(qStart - 4, qStart), 'structure'],
      // 첫 컨테이너는 위치 1, 그 내용 노드(문단)는 2
      ['바꾸기(제목으로)', (tr) => tr.setNodeMarkup(2, blockSchema.nodes.heading_1, { props: {}, format: {} }), 'structure'],
      ['블록 지우기', (tr) => tr.delete(qStart - 2, qStart - 2 + state.doc.resolve(qStart).node(-1).nodeSize), 'structure'],
      ['굵게', (tr) => tr.addMark(3, 5, blockSchema.marks.bold!.create()), 'format'],
      ['코드 블록에 치기', (tr) => tr.insertText('y', textStart(state.doc, c) + 1), 'plain_text'],
    ]
    for (const [label, make, reason] of cases) {
      const run = dispatch(state, make)
      assert.equal(run.blocked, reason, label)
      assert.equal(run.state, state, `${label} — 문서가 그대로다`)
    }
  })

  test('★ 꺼졌으면 · Y.Doc 에서 온 것이면 받은 그대로다', () => {
    const p = randomUUID()
    const off = caret(stateOf([{ id: p, text: '원래글' }], false), 6)
    assert.equal(suggestingAuthor(off), null)
    let run = backspace(off)
    assert.equal(run.passed, true)
    assert.equal(shape(run.state, p), '원래', '꺼졌으면 진짜 지운다')
    run = type(off, '새')
    assert.equal(shape(run.state, p), '원래글새')

    const on = caret(stateOf([{ id: p, text: '원래글' }]), 6)
    run = dispatch(on, (tr) => tr.delete(5, 6), () => true)
    assert.equal(run.passed, true)
    assert.equal(shape(run.state, p), '원래', '다른 참여자 · 되돌리기의 편집은 다시 쓰지 않는다')
  })

  test('켠 뒤 끄면 저장 마크의 제안 마크를 거둔다 — 끈 뒤 친 첫 글자는 그냥 글', () => {
    const p = randomUUID()
    let state = caret(stateOf([{ id: p, text: '원래글' }]), 6)
    assert.ok(state.storedMarks?.some((m) => m.type === INSERT))
    state = state.apply(setSuggestionMode(state.tr, null))
    assert.equal(suggestingAuthor(state), null)
    assert.equal(state.storedMarks?.some((m) => m.type === INSERT) ?? false, false)
    state = type(state, '끝').state
    assert.equal(shape(state, p), '원래글끝')
  })
})

// ── ⑤ 저장 마크 ───────────────────────────────────────────────────────

describe('⑤ 저장 마크 — IME 조합이 마크 안에서 시작한다', () => {
  test('★ 캐럿에 내 insert 마크 — 내 제안 끝이면 그 sid, 떨어진 자리면 새 sid, 코드 블록은 두지 않는다', () => {
    const [p, c] = [randomUUID(), randomUUID()]
    let state = stateOf([{ id: p, text: '원래글' }, { id: c, text: 'x', type: 'code' }])
    state = type(caret(state, 6), '새').state
    const own = state.doc.nodeAt(6)!.marks.find((m) => m.type === INSERT)!
    const atEnd = caret(state, 7)
    // 캐럿을 옮기면 플러그인이 이미 저장 마크를 둔다 — 그 sid 다 · 그때 다시 물으면 null(이미 있다)
    assert.equal(atEnd.storedMarks?.find((m) => m.type === INSERT)?.attrs.sid, own.attrs.sid)
    assert.equal(caretMarks(atEnd, ME, () => 'fresh'), null)
    const cleared = atEnd.apply(atEnd.tr.setStoredMarks(null))
    assert.equal(caretMarks(cleared, ME, () => 'fresh')?.find((m) => m.type === INSERT)?.attrs.sid, own.attrs.sid)
    const away = caret(state, 3)
    assert.equal(away.storedMarks?.find((m) => m.type === INSERT)?.attrs.author_id, ME)
    assert.notEqual(away.storedMarks?.find((m) => m.type === INSERT)?.attrs.sid, own.attrs.sid)
    const inCode = caret(state, textStart(state.doc, c))
    assert.equal(inCode.storedMarks, null)
    assert.equal(caretMarks(inCode, ME), null)
  })
})

// ── ⑥ 왕복 ────────────────────────────────────────────────────────────

describe('⑥ 왕복 — Y.Doc · 정규화 · 계약 런', () => {
  test('★ PM 문서 → Y.Doc → 읽기 → 정규화에서 마크가 sid · author 그대로 남는다 — 멘션의 마크도(거울 attr)', () => {
    const p = randomUUID()
    const base = docToPm({ blocks: [{ id: p, type: 'paragraph', title: [textRun('가나다라')] }] })
    const state = EditorState.create({ schema: blockSchema, doc: base })
    const tr = state.tr
      .addMark(4, 6, INSERT.create({ sid: 's-ins', author_id: ME }))
      .addMark(6, 7, DELETE.create({ sid: 's-del', author_id: OTHER }))
    const mention = createInlineAtom(
      blockSchema.nodes[MENTION_NODE]!,
      { mention: { type: 'user', user: { id: OTHER } }, plainText: '' },
      [INSERT.create({ sid: 's-ins', author_id: ME })],
    )
    tr.insert(7, mention)
    const pm = tr.doc

    const ydoc = new Y.Doc()
    prosemirrorToYXmlFragment(pm, ydoc.getXmlFragment(BODY_FRAGMENT))
    // 저장 포맷 — 글의 Y attr 키가 마크 이름이고 값이 attr 이다
    const deltas: { insert?: unknown; attributes?: Record<string, unknown> }[] = []
    const walk = (parent: Y.XmlFragment | Y.XmlElement): void => {
      for (const child of parent.toArray()) {
        if (child instanceof Y.XmlText) deltas.push(...(child.toDelta() as typeof deltas))
        else if (child instanceof Y.XmlElement) walk(child)
      }
    }
    walk(ydoc.getXmlFragment(BODY_FRAGMENT))
    // ProseMirror 의 attr 객체는 프로토타입이 없다 — JSON 으로 비교한다
    const attrsOf = (text: string): unknown => JSON.parse(JSON.stringify(deltas.find((d) => d.insert === text)?.attributes ?? null))
    assert.deepEqual(attrsOf('나다'), { suggestion_insert: { sid: 's-ins', author_id: ME } })
    assert.deepEqual(attrsOf('라'), { suggestion_delete: { sid: 's-del', author_id: OTHER } })

    const read = readBodyPm(ydoc)
    assert.ok(read.eq(pm), '읽기가 마크를 떨궜다')
    const normalized = normalizeBody(read, { seed: randomUUID() })
    assert.deepEqual(normalized.fixes, [])
    assert.ok(normalized.doc.eq(pm), '정규화가 마크를 떨궜다')

    // 계약 런(행 투영 · 내보내기 · 검색)은 글만 싣는다 — 넣자는 글도 지우자는 글도 남는다(원문 보이기는 SG-2)
    const runs = pmToDoc(normalized.doc).blocks[0]!.title
    assert.deepEqual(runs.map((r) => [r.type, r.plain_text]), [['text', '가나다라'], ['mention', '']])
  })

  test('남이 Y.Doc 에 쓴 모양이 틀린 제안 마크(sid 없음)는 글을 두고 서식만 뺀다 — 읽기 · 정규화 · 런이 던지지 않는다', () => {
    const p = randomUUID()
    const ydoc = new Y.Doc()
    prosemirrorToYXmlFragment(docToPm({ blocks: [{ id: p, type: 'paragraph', title: [textRun('가나')] }] }), ydoc.getXmlFragment(BODY_FRAGMENT))
    const texts: Y.XmlText[] = []
    const walk = (parent: Y.XmlFragment | Y.XmlElement): void => {
      for (const child of parent.toArray()) {
        if (child instanceof Y.XmlText) texts.push(child)
        else if (child instanceof Y.XmlElement) walk(child)
      }
    }
    walk(ydoc.getXmlFragment(BODY_FRAGMENT))
    texts[0]!.format(0, 1, { suggestion_insert: { author_id: ME } })
    const read = readBodyPm(ydoc)
    assert.equal(read.textContent, '가나')
    let marked = 0
    read.descendants((node) => {
      if (node.marks.length > 0) marked += 1
      return true
    })
    assert.equal(marked, 0)
    const normalized = normalizeBody(read, { seed: randomUUID() })
    assert.equal(pmToDoc(normalized.doc).blocks[0]!.title.map((r) => r.plain_text).join(''), '가나')
  })
})
