/**
 * 목차 플러그인 — 잔여 묶음 8b-1 (F-01-16 · 실제 ProseMirror 상태 위에서 · DOM 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 목차 노드마다 노드 데코레이션 — spec.toc 가 헤딩 목록 · 속성은 비었다(DOM 에 아무것도 달지 않는다)
 *   ② ★ 목차가 없으면 데코레이션도 목록도 없다
 *   ③ ★ 헤딩이 그대로면 **같은 목록 객체** — 데코레이션이 같아 노드 뷰가 불리지 않는다(PM 의 비교 `Decoration.eq`)
 *   ④ ★ 헤딩의 글자 · 더하기 · 지우기 · 수준 · 문단으로 바꾸기 → 새 목록
 *   ⑤ ★ 토글 안의 헤딩 · 토글 안의 목차 · 목차 둘
 *   ⑥ ★ 루트를 통째로 갈아 끼워도(y-prosemirror 의 원격 변경) 데코레이션이 남는다
 *   ⑦ ★ 편집기의 걸음과 내보내기의 걸음이 같은 줄을 낸다(`headingsOfBlocks(pmToDoc(…))`)
 *   ⑧ ★ 줄의 글자 — 멘션(칩과 같은 글자) · 수식 · 줄바꿈 · 모양이 틀린 멘션은 던지지 않는다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'
import { Slice } from '@tiptap/pm/model'
import { DecorationSet } from '@tiptap/pm/view'

import type { BlockType } from '../block/types.ts'
import { TOC_TYPE, headingsOfBlocks, tocEntries, type TocEntry } from '../block/toc.ts'
import { DEFAULT_ANNOTATIONS, textRun, type RichTextRun } from '../contracts/rich-text.ts'
import { turnIntoCommand } from './commands.ts'
import type { EditorBlock } from './document.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'
import { tocEntryText, tocPlugin, tocState, type TocDecorationSpec } from './toc-plugin.ts'

// ── 도우미 ────────────────────────────────────────────────────────────

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function blk(type: BlockType, text = '', children: EditorBlock[] = [], format: Record<string, unknown> = {}): EditorBlock {
  return { id: nextId(), type, title: text === '' ? [] : [textRun(text)], properties: {}, format, children }
}
const toc = (format: Record<string, unknown> = {}) => blk(TOC_TYPE as BlockType, '', [], format)

function stateOf(blocks: EditorBlock[]): EditorState {
  return EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }), plugins: [tocPlugin()] })
}

/** 그 블록 글자의 첫 위치. */
const textStart = (state: EditorState, id: string) => findContainerById(state.doc, id)!.contentPos + 1

/** 목차 노드에 단 데코레이션들 — (범위, spec, 속성). */
function tocDecorations(state: EditorState) {
  return tocState(state)
    .set.find()
    .map((d) => ({ from: d.from, to: d.to, spec: d.spec as TocDecorationSpec, attrs: (d as unknown as { type: { attrs: object } }).type.attrs }))
}

/** 줄의 (깊이, 글자). */
const lines = (entries: readonly TocEntry[]) => entries.map((e) => [e.depth, tocEntryText(e.title, () => undefined)])

function run(state: EditorState, command: Command): EditorState {
  let next: EditorState | null = null
  assert.ok(command(state, (tr) => (next = state.apply(tr))), '명령이 돌지 않았다')
  return next!
}

// ── ① ② ───────────────────────────────────────────────────────────────

describe('① ② 데코레이션', () => {
  test('★ 목차 노드마다 노드 데코레이션 — spec.toc 는 헤딩 목록 · 범위는 목차 내용 노드 · 속성은 비었다', () => {
    const t = toc()
    const state = stateOf([t, blk('heading_1', '첫째'), blk('paragraph', '문단'), blk('heading_2', '둘째')])
    const [deco, ...rest] = tocDecorations(state)
    assert.equal(rest.length, 0)
    const info = findContainerById(state.doc, t.id)!
    assert.equal(deco.from, info.contentPos)
    assert.equal(deco.to, info.contentPos + info.contentNode.nodeSize)
    assert.deepEqual(deco.attrs, {})
    assert.deepEqual(lines(deco.spec.toc), [[0, '첫째'], [1, '둘째']])
    assert.equal(deco.spec.toc, tocState(state).entries)
  })

  test('★ 목차가 없으면 데코레이션도 목록도 없다 — 헤딩이 있어도', () => {
    const state = stateOf([blk('heading_1', '첫째')])
    assert.equal(tocState(state).set, DecorationSet.empty)
    assert.deepEqual(tocState(state).entries, [])
  })

  test('헤딩이 없는 목차 — 데코레이션은 있고 목록이 비었다(노드 뷰가 안내를 그린다)', () => {
    const state = stateOf([toc(), blk('paragraph', '문단')])
    const [deco] = tocDecorations(state)
    assert.deepEqual(deco.spec.toc, [])
  })
})

// ── ③ ④ ───────────────────────────────────────────────────────────────

describe('③ ④ 다시 짓기', () => {
  test('★ 헤딩이 아닌 블록을 고치면 같은 목록 객체 — 데코레이션이 같다(노드 뷰가 불리지 않는다)', () => {
    const p = blk('paragraph', '문단')
    let state = stateOf([toc(), blk('heading_1', '첫째'), p])
    const before = tocState(state).set.find()[0]
    state = state.apply(state.tr.insertText('더', textStart(state, p.id)))
    const after = tocState(state).set.find()[0]
    assert.equal(after.spec.toc, before.spec.toc, '목록 객체가 바뀌었다')
    assert.ok(after.eq(before), 'PM 이 다른 데코레이션으로 본다 — 노드 뷰가 다시 그린다')
  })

  test('★ 헤딩의 글자를 고치면 새 목록 — 데코레이션이 달라진다', () => {
    const h = blk('heading_1', '첫째')
    let state = stateOf([toc(), h])
    const before = tocState(state).set.find()[0]
    state = state.apply(state.tr.insertText('!', textStart(state, h.id) + 2))
    const after = tocState(state).set.find()[0]
    assert.notEqual(after.spec.toc, before.spec.toc)
    assert.ok(!after.eq(before), '같은 데코레이션으로 본다 — 노드 뷰가 다시 그리지 않는다')
    assert.deepEqual(lines(tocState(state).entries), [[0, '첫째!']])
  })

  test('★ 헤딩을 더하고 · 지우고 · 수준을 바꾸고 · 문단으로 바꾸면 줄이 따라간다', () => {
    const a = blk('heading_1', 'A')
    const b = blk('heading_3', 'B')
    const p = blk('paragraph', 'P')
    let state = stateOf([toc(), a, p, b])
    assert.deepEqual(lines(tocState(state).entries), [[0, 'A'], [1, 'B']])

    // 문단을 제목 2 로 — B 가 한 칸 더 들어간다.
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, textStart(state, p.id))))
    state = run(state, turnIntoCommand('heading_2'))
    assert.deepEqual(lines(tocState(state).entries), [[0, 'A'], [1, 'P'], [2, 'B']])

    // A 를 문단으로 — 빠지고 제목 2 가 맨 왼쪽.
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, textStart(state, a.id))))
    state = run(state, turnIntoCommand('paragraph'))
    assert.deepEqual(lines(tocState(state).entries), [[0, 'P'], [1, 'B']])

    // B 를 지운다.
    const info = findContainerById(state.doc, b.id)!
    state = state.apply(state.tr.delete(info.pos, info.pos + info.node.nodeSize))
    assert.deepEqual(lines(tocState(state).entries), [[0, 'P']])
  })

  test('목차를 지우면 데코레이션이 사라지고, 다시 넣으면 다시 단다', () => {
    const t = toc()
    let state = stateOf([blk('heading_1', 'A'), t])
    const info = findContainerById(state.doc, t.id)!
    state = state.apply(state.tr.delete(info.pos, info.pos + info.node.nodeSize))
    assert.equal(tocState(state).set, DecorationSet.empty)
    state = state.apply(state.tr.insert(state.doc.content.size - 1, docToPm({ blocks: [toc()] }).child(0).child(0)))
    assert.deepEqual(lines(tocDecorations(state)[0].spec.toc), [[0, 'A']])
  })
})

// ── ⑤ ⑥ ───────────────────────────────────────────────────────────────

describe('⑤ ⑥ 자리', () => {
  test('★ 토글 안의 헤딩도 · 토글 안의 목차도 — 목차 둘은 같은 목록 객체', () => {
    const inner = toc()
    const outer = toc()
    const state = stateOf([outer, blk('toggle', '토글', [blk('heading_2', '안쪽'), inner]), blk('heading_1', '바깥')])
    const decos = tocDecorations(state)
    assert.equal(decos.length, 2)
    assert.equal(decos[0].spec.toc, decos[1].spec.toc)
    assert.deepEqual(lines(decos[0].spec.toc), [[1, '안쪽'], [0, '바깥']])
  })

  test('★ 루트를 통째로 갈아 끼워도 데코레이션이 남고 목록 객체도 같다(y-prosemirror 의 원격 변경)', () => {
    const state = stateOf([toc(), blk('heading_1', 'A')])
    const before = tocState(state).set.find()[0]
    const replaced = state.apply(state.tr.replace(0, state.doc.content.size, new Slice(state.doc.content, 0, 0)))
    assert.ok(replaced.doc.eq(state.doc), '전제 — 같은 문서')
    const after = tocState(replaced).set.find()
    assert.equal(after.length, 1)
    assert.equal(after[0].spec.toc, before.spec.toc)
  })
})

// ── ⑦ ─────────────────────────────────────────────────────────────────

describe('⑦ 두 걸음', () => {
  test('★ 편집기(ProseMirror 문서)와 내보내기(블록 트리)가 같은 줄을 낸다', () => {
    const state = stateOf([
      blk('heading_2', '둘'),
      blk('toggle', 't', [blk('heading_3', '셋'), blk('bulleted_list_item', 'b', [blk('heading_2', '안쪽 둘')])]),
      toc(),
      blk('heading_1', ''),
      blk('callout', 'c', [blk('heading_3', '콜아웃 셋')]),
    ])
    const fromBlocks = tocEntries(headingsOfBlocks(pmToDoc(state.doc).blocks))
    assert.deepEqual(lines(tocState(state).entries), lines(fromBlocks))
    assert.deepEqual(tocState(state).entries.map((e) => e.id), fromBlocks.map((e) => e.id))
  })
})

// ── ⑧ ─────────────────────────────────────────────────────────────────

describe('⑧ 줄의 글자', () => {
  const mention = (m: Record<string, unknown>, plain = ''): RichTextRun => ({
    type: 'mention',
    annotations: { ...DEFAULT_ANNOTATIONS },
    plain_text: plain,
    href: null,
    mention: m as RichTextRun['mention'],
  })
  const PAGE = '00000000-0000-4000-8000-0000000000a1'
  const USER = '00000000-0000-4000-8000-0000000000b1'

  test('★ 멘션은 칩과 같은 글자 — 볼 수 있으면 이름 · 볼 수 없으면 그렇다고 · 모르면 자리 표시', () => {
    const labels = new Map<string, string | null>([[`page:${PAGE}`, '설계 문서'], [`user:${USER}`, '박찬우']])
    const label = (kind: 'user' | 'page', id: string) => labels.get(`${kind}:${id}`)
    const page = mention({ type: 'page', page: { id: PAGE } })
    const user = mention({ type: 'user', user: { id: USER } })
    assert.equal(tocEntryText([textRun('참고: '), page, textRun(' · '), user], label), '참고: 설계 문서 · @박찬우')
    assert.equal(tocEntryText([page], () => null), '볼 수 없는 페이지')
    assert.equal(tocEntryText([page], () => undefined), '페이지')
    assert.equal(tocEntryText([page], () => ''), '제목 없음')
    assert.equal(tocEntryText([user], () => undefined), '@…')
  })

  test('수식은 식 그대로 · 날짜 같은 멘션은 저장된 평문 · 줄바꿈은 공백으로 접는다', () => {
    const equation: RichTextRun = { type: 'equation', annotations: { ...DEFAULT_ANNOTATIONS }, plain_text: 'e=mc^2', href: null, equation: { expression: 'e=mc^2' } }
    assert.equal(tocEntryText([textRun('식 '), equation], () => undefined), '식 e=mc^2')
    assert.equal(tocEntryText([mention({ type: 'date', date: { start: '2026-10-01' } }, '2026-10-01')], () => undefined), '2026-10-01')
    assert.equal(tocEntryText([textRun('  첫 줄\n  둘째 줄 ')], () => undefined), '첫 줄 둘째 줄')
  })

  test('★ 모양이 틀린 멘션 · 수식 attr — 던지지 않는다(수선이 오기 전의 협업 문서)', () => {
    const poison = [
      mention({ type: 'page', page: { id: 5n } }),
      mention({ type: 'user', user: null }),
      mention({ type: 5 }),
      { type: 'equation', annotations: { ...DEFAULT_ANNOTATIONS }, plain_text: '', href: null, equation: { expression: 7 } } as unknown as RichTextRun,
    ]
    assert.doesNotThrow(() => tocEntryText(poison, () => undefined))
    // 편집기의 노드에서 — 원자의 attr 이 엉망이어도 플러그인이 던지지 않는다.
    const h = blk('heading_1', 'A')
    const state = stateOf([toc(), h])
    const atom = blockSchema.nodes.mention.create({ mention: { type: 'page', page: { id: 5n } } })
    assert.doesNotThrow(() => state.apply(state.tr.insert(textStart(state, h.id), atom)))
  })
})
