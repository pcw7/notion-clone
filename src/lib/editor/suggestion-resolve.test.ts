/**
 * 제안 수락 · 거절 — SG-3 (F-05-12 · 판결 U-2 · 불변식 S9) (DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **수락** — insert 는 마크만 뗀다(글은 남는다) · delete 는 그 글을 지운다 · format 은 마크만 뗀다
 *   ② **거절** — insert 는 그 글을 지운다 · delete 는 마크만 뗀다(글은 남는다) · format 은 마크만 뗀다
 *   ②-1 **서식 제안**(SG-5a) — 수락은 마크만(바뀐 서식이 남는다) · 거절은 더한 것을 떼고 뺀 것을 다시 건다 · 모두 거절에도 · 바꾼 것을 한 줄로
 *   ③ **그 sid 만** — 다른 sid 의 마크 · 이웃 글 · 다른 블록은 그대로 · 한 글자에 두 제안이 서면 사라지는 쪽이 이긴다
 *   ④ **한 트랜잭션**(S9) — 여러 sid(모두 수락 · 모두 거절)도 트랜잭션 하나 · Y.Doc 에는 update 하나 · 없는 sid 면 null
 *   ⑤ **제안 모드가 비켜 간다** — 켜 둔 채 보내도 다시 쓰거나 막지 않는다
 *   ⑥ **목록** — 문서의 제안을 sid 마다 처음 나온 차례로 · 글 · 자리
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import { EditorState } from '@tiptap/pm/state'
import type { Mark, Node as PmNode } from '@tiptap/pm/model'

import { textRun } from '../contracts/rich-text.ts'
import { writeEditorChange } from '../collab/body-edit.ts'
import { BODY_FRAGMENT, readBodyPm } from '../collab/ydoc.ts'
import { docToPm } from './pm-adapter.ts'
import { blockSchema } from './schema.ts'
import { setSuggestionMode, suggestionModePlugin, suggestTransaction } from './suggestion-mode.ts'
import { docSuggestions, formatChangeLabel, resolveSuggestionsIn, resolveSuggestionTransaction, type ResolveAction } from './suggestion-resolve.ts'

const ME = randomUUID()
const OTHER = randomUUID()
const B1 = randomUUID()
const B2 = randomUUID()
const INSERT = blockSchema.marks.suggestion_insert!
const DELETE = blockSchema.marks.suggestion_delete!
const FORMAT = blockSchema.marks.suggestion_format!
const BOLD = blockSchema.marks.bold!

const ins = (sid: string, author = ME): Mark => INSERT.create({ sid, author_id: author })
const del = (sid: string, author = ME): Mark => DELETE.create({ sid, author_id: author })
const fmt = (sid: string, author = ME): Mark => FORMAT.create({ sid, author_id: author })

type Run = readonly [text: string, marks?: readonly Mark[]]

function textStart(doc: PmNode, blockId: string): number {
  let at = -1
  doc.descendants((node, pos) => {
    if (node.type.name === 'blockContainer' && node.attrs.blockId === blockId) at = pos + 2
    return at < 0
  })
  assert.ok(at >= 0, `블록이 없다: ${blockId}`)
  return at
}

/** 첫 블록에 이 글 조각들 · 둘째 블록은 마크 없는 "옆 블록". */
function stateWith(runs: readonly Run[], plugins = false): EditorState {
  const doc = docToPm({ blocks: [{ id: B1, type: 'paragraph', title: [] }, { id: B2, type: 'paragraph', title: [textRun('옆 블록')] }] } as never)
  const state = EditorState.create({ schema: blockSchema, doc, plugins: plugins ? [suggestionModePlugin()] : [] })
  return state.apply(state.tr.insert(textStart(state.doc, B1), runs.map(([text, marks = []]) => blockSchema.text(text, marks))))
}

/** 블록 글을 조각으로 — `글` 또는 `글[종류:sid · …]`(제안 마크만 · 굵게는 `*`). */
function runsOf(doc: PmNode, blockId: string): string[] {
  const at = textStart(doc, blockId)
  const parent = doc.resolve(at).parent
  const out: string[] = []
  parent.forEach((node) => {
    const tags = node.marks
      .map((m) => (m.type === BOLD ? '*' : m.type.name.startsWith('suggestion_') ? `${m.type.name.slice('suggestion_'.length)}:${String(m.attrs.sid)}` : null))
      .filter((t) => t !== null)
    out.push(tags.length === 0 ? (node.text ?? '') : `${node.text ?? ''}[${tags.join(' · ')}]`)
  })
  return out
}

function resolve(state: EditorState, sids: readonly string[], action: ResolveAction): EditorState {
  const tr = resolveSuggestionTransaction(state, new Set(sids), action)
  assert.ok(tr !== null, '트랜잭션이 없다')
  return state.apply(tr)
}

// ── ① 수락 ───────────────────────────────────────────────────────────

describe('① 수락', () => {
  test('★ insert 는 마크만 뗀다 — 글은 남는다', () => {
    const state = resolve(stateWith([['원래'], ['새 글', [ins('a')]]]), ['a'], 'accept')
    assert.deepEqual(runsOf(state.doc, B1), ['원래새 글'])
  })

  test('★ delete 는 그 글을 지운다', () => {
    const state = resolve(stateWith([['원'], ['래', [del('d')]], ['글']]), ['d'], 'accept')
    assert.deepEqual(runsOf(state.doc, B1), ['원글'])
  })

  test('format 은 마크만 뗀다 — 다른 서식은 그대로', () => {
    const state = resolve(stateWith([['굵게', [BOLD.create(), fmt('f')]]]), ['f'], 'accept')
    assert.deepEqual(runsOf(state.doc, B1), ['굵게[*]'])
  })
})

// ── ② 거절 ───────────────────────────────────────────────────────────

describe('② 거절', () => {
  test('★ insert 는 그 글을 지운다', () => {
    const state = resolve(stateWith([['원래'], ['새 글', [ins('a')]], ['끝']]), ['a'], 'reject')
    assert.deepEqual(runsOf(state.doc, B1), ['원래끝'])
  })

  test('★ delete 는 마크만 뗀다 — 글은 남는다', () => {
    const state = resolve(stateWith([['원'], ['래', [del('d')]], ['글']]), ['d'], 'reject')
    assert.deepEqual(runsOf(state.doc, B1), ['원래글'])
  })

  test('format 은 마크만 뗀다', () => {
    const state = resolve(stateWith([['글', [fmt('f')]]]), ['f'], 'reject')
    assert.deepEqual(runsOf(state.doc, B1), ['글'])
  })
})

// ── ②-1 서식 제안 (SG-5a) ─────────────────────────────────────────────

describe('②-1 서식 제안의 수락 · 거절 (SG-5a)', () => {
  const ITALIC = blockSchema.marks.italic!
  const COLOR = blockSchema.marks.color!
  const entry = (m: Mark) => ({ type: m.type.name, attrs: { ...m.attrs } })
  const change = (sid: string, added: readonly Mark[], removed: readonly Mark[] = []): Mark =>
    FORMAT.create({ sid, author_id: ME, added: added.map(entry), removed: removed.map(entry) })
  /** 글 조각의 서식 — `글:서식+…`(제안 마크는 `F:sid`). */
  const formatsOf = (doc: PmNode): string[] => {
    const out: string[] = []
    doc.resolve(textStart(doc, B1)).parent.forEach((node) => {
      const names = node.marks.map((m) => (m.type === FORMAT ? `F:${String(m.attrs.sid)}` : m.type === COLOR ? `color=${String(m.attrs.color)}` : m.type.name))
      out.push(`${node.text ?? ''}:${names.join('+')}`)
    })
    return out
  }
  const red = COLOR.create({ color: 'red' })
  const blue = COLOR.create({ color: 'blue' })
  // 굵게를 더한 글 · 기울임을 뺀 글 · 빨강을 파랑으로 바꾼 글 · 남의 손이 닿지 않은 글
  const before = (): EditorState =>
    stateWith([
      ['가', [BOLD.create(), change('a', [BOLD.create()])]],
      ['나', [change('b', [], [ITALIC.create()])]],
      ['다', [blue, change('c', [blue], [red])]],
      ['라'],
    ])

  test('★ 수락은 format 마크만 뗀다 — 바뀐 서식이 남는다', () => {
    assert.deepEqual(formatsOf(resolve(before(), ['a', 'b', 'c'], 'accept').doc), ['가:bold', '나:', '다:color=blue', '라:'])
  })

  test('★ 거절은 더한 서식을 떼고 뺀 서식을 다시 건 뒤 마크를 뗀다 — 색은 원래 색으로', () => {
    assert.deepEqual(formatsOf(resolve(before(), ['a', 'b', 'c'], 'reject').doc), ['가:', '나:italic', '다:color=red', '라:'])
  })

  test('그 sid 만 — 거절한 서식 제안 옆의 다른 서식 제안은 그대로 · 모두 거절은 한 트랜잭션에 서식 제안까지', () => {
    assert.deepEqual(formatsOf(resolve(before(), ['a'], 'reject').doc), ['가:', '나:F:b', '다:color=blue+F:c', '라:'])
    const all = new Set(docSuggestions(before().doc).map((s) => s.sid))
    const tr = resolveSuggestionTransaction(before(), all, 'reject')!
    assert.deepEqual(formatsOf(before().apply(tr).doc), ['가:', '나:italic', '다:color=red', '라:'])
  })

  test('★ 바꾼 것을 한 줄로 — 더함 · 뺌 · 바꿈(sid 의 조각을 모은다) · 그 sid 의 서식 제안이 없으면 null', () => {
    const state = stateWith([
      ['가', [BOLD.create(), ITALIC.create(), change('m', [BOLD.create(), ITALIC.create()])]],
      ['나', [ITALIC.create(), change('m', [ITALIC.create()], [blockSchema.marks.underline!.create()])]],
      ['다', [blue, change('c', [blue], [red])]],
      ['라', [COLOR.create({ color: 'yellow_background' }), change('g', [COLOR.create({ color: 'yellow_background' })])]],
      ['마', [ins('i')]],
    ])
    assert.equal(formatChangeLabel(state.doc, 'm'), '굵게 · 기울임 더함, 밑줄 뺌')
    assert.equal(formatChangeLabel(state.doc, 'c'), '글자색 바꿈')
    assert.equal(formatChangeLabel(state.doc, 'g'), '배경색 더함')
    assert.equal(formatChangeLabel(state.doc, 'i'), null)
  })
})

// ── ③ 그 sid 만 ──────────────────────────────────────────────────────

describe('③ 그 sid 만', () => {
  test('★ 다른 sid · 이웃 글 · 다른 블록은 그대로', () => {
    const before = stateWith([['앞'], ['하나', [ins('a')]], ['사이'], ['둘', [ins('b', OTHER)]], ['셋', [del('c')]], ['뒤']])
    const accepted = resolve(before, ['a'], 'accept')
    assert.deepEqual(runsOf(accepted.doc, B1), ['앞하나사이', '둘[insert:b]', '셋[delete:c]', '뒤'])
    assert.deepEqual(runsOf(accepted.doc, B2), ['옆 블록'])
    const rejected = resolve(before, ['b'], 'reject')
    assert.deepEqual(runsOf(rejected.doc, B1), ['앞', '하나[insert:a]', '사이', '셋[delete:c]', '뒤'])
  })

  test('한 sid 가 여러 블록 · 여러 조각이어도 모두', () => {
    const state = stateWith([['가', [del('d')]], ['나'], ['다', [del('d')]]])
    const at = textStart(state.doc, B2)
    const both = state.apply(state.tr.addMark(at, at + 1, del('d')))
    const accepted = resolve(both, ['d'], 'accept')
    assert.deepEqual(runsOf(accepted.doc, B1), ['나'])
    assert.deepEqual(runsOf(accepted.doc, B2), [' 블록'])
  })

  test('한 글자에 두 제안(남이 넣자는 글을 지우자고 했다) — 사라지는 쪽이 이긴다', () => {
    const before = stateWith([['원'], ['새', [ins('a', OTHER), del('d')]]])
    assert.deepEqual(runsOf(resolve(before, ['d'], 'accept').doc, B1), ['원'])
    assert.deepEqual(runsOf(resolve(before, ['a'], 'accept').doc, B1), ['원', '새[delete:d]'])
    assert.deepEqual(runsOf(resolve(before, ['d'], 'reject').doc, B1), ['원', '새[insert:a]'])
    assert.deepEqual(runsOf(resolve(before, ['a', 'd'], 'reject').doc, B1), ['원'])
  })
})

// ── ④ 한 트랜잭션 ───────────────────────────────────────────────────

describe('④ 한 트랜잭션 (S9)', () => {
  test('★ 모두 수락 · 모두 거절 — sid 여럿이 트랜잭션 하나 · 표지가 달린다', () => {
    const before = stateWith([['가', [ins('a')]], ['나'], ['다', [del('b')]], ['라', [ins('c', OTHER)]], ['마', [del('e', OTHER)]]])
    const all = new Set(docSuggestions(before.doc).map((s) => s.sid))
    const accept = resolveSuggestionTransaction(before, all, 'accept')!
    assert.equal(accept.getMeta('suggestion-resolve'), 'accept')
    assert.deepEqual(runsOf(before.apply(accept).doc, B1), ['가나라'])
    const reject = resolveSuggestionTransaction(before, all, 'reject')!
    assert.deepEqual(runsOf(before.apply(reject).doc, B1), ['나다마'])
  })

  test('없는 sid 면 null — 남이 먼저 정했다', () => {
    assert.equal(resolveSuggestionTransaction(stateWith([['글', [ins('a')]]]), new Set(['zz']), 'accept'), null)
  })

  test('★ Y.Doc 에는 update 하나 — 마크 떼기와 지우기가 함께 간다', () => {
    const source = stateWith([['원'], ['새', [ins('a')]], ['래', [del('b')]], ['글']])
    const ydoc = new Y.Doc()
    prosemirrorToYXmlFragment(source.doc, ydoc.getXmlFragment(BODY_FRAGMENT))
    let updates = 0
    ydoc.on('update', () => {
      updates += 1
    })
    writeEditorChange(ydoc, (tr, doc) => void resolveSuggestionsIn(tr, doc, new Set(['a', 'b']), 'accept'), 'editor')
    assert.equal(updates, 1)
    assert.deepEqual(runsOf(readBodyPm(ydoc), B1), ['원새글'])
  })
})

// ── ⑤ 제안 모드 ─────────────────────────────────────────────────────

describe('⑤ 제안 모드가 비켜 간다', () => {
  test('★ 켜 둔 채 보낸 수락 · 거절은 다시 쓰지도 막지도 않는다', () => {
    const plain = stateWith([['원'], ['새', [ins('a')]], ['래', [del('b')]]], true)
    const on = plain.apply(setSuggestionMode(plain.tr, ME))
    for (const action of ['accept', 'reject'] as const) {
      const tr = resolveSuggestionTransaction(on, new Set(['a', 'b']), action)!
      const outcome = suggestTransaction(on, tr)
      assert.ok('tr' in outcome && outcome.tr === tr, action)
    }
  })
})

// ── ⑥ 목록 ───────────────────────────────────────────────────────────

describe('⑥ 문서의 제안 목록', () => {
  test('★ sid 마다 처음 나온 차례 · 종류 · 사람 · 이은 글 · 처음부터 끝까지의 자리', () => {
    const state = stateWith([['앞'], ['새', [ins('a')]], ['중'], ['간', [ins('a')]], ['래', [del('b', OTHER)]]])
    const at = textStart(state.doc, B1)
    assert.deepEqual(docSuggestions(state.doc), [
      { sid: 'a', kind: 'insert', authorId: ME, text: '새간', from: at + 1, to: at + 4 },
      { sid: 'b', kind: 'delete', authorId: OTHER, text: '래', from: at + 4, to: at + 5 },
    ])
  })
})
