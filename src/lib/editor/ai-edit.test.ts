/**
 * AI 로 고치기 — 고른 글 읽기 · 바꿀 자리 다시 찾기 · 바꾸기 (AI-3 · F-10-02 · DOM 없음)
 *
 *   ① 읽기 — 한 블록의 조각(인라인 마크다운) · 여러 블록은 통째로(종류 · 깊이) · 코드 언어 · 글 아닌 블록은 빼고 센다(바꾸기 없음)
 *   ② 바꾸기 — 한 블록은 그 범위만(마크다운 → 서식) · 블록들은 종류를 지키며 첫 id 를 지킨다 · 코드는 글 그대로 · 되돌리기 한 번
 *   ③ 바꿀 자리 — 앞에 글이 들어와 밀려도 찾는다 · 고른 글이 바뀌었거나 블록이 사라지면 바꾸지 않는다
 *   ④ 할 일 뽑기는 할 일 블록만 · 입구(Ctrl/Cmd+J)는 고른 글이 있을 때만
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { history, undo } from '@tiptap/pm/history'
import { EditorState, TextSelection } from '@tiptap/pm/state'

import { textRun, toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import { fakeEditAnswer } from '../testing/fake-ai-provider.ts'
import { editAnswerBlocks, editSnapshot, inlineRunsOf, locateEditTarget, replaceSelectionCommand, runsToEditMarkdown } from './ai-edit.ts'
import { aiEditCommand } from './ai-trigger.ts'
import type { EditorBlock } from './document.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'

const blk = (type: EditorBlock['type'], text: string | RichTextRun[], extra: Partial<EditorBlock> = {}): EditorBlock => ({
  id: randomUUID(),
  type,
  title: typeof text === 'string' ? (text === '' ? [] : [textRun(text)]) : text,
  properties: {},
  format: {},
  children: [],
  ...extra,
})

const stateOf = (blocks: EditorBlock[]) => EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }), plugins: [history()] })

/** 블록의 글자 [from, to) 를 고른다(to 는 다른 블록일 수 있다). */
function select(state: EditorState, fromId: string, from: number, toId: string, to: number): EditorState {
  const a = findContainerById(state.doc, fromId)!
  const b = findContainerById(state.doc, toId)!
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, a.contentPos + 1 + from, b.contentPos + 1 + to)))
}

const shape = (state: EditorState) => pmToDoc(state.doc).blocks.map((b) => `${b.type}:${toPlainText(b.title ?? [])}`)
const run = (state: EditorState, command: ReturnType<typeof replaceSelectionCommand>): EditorState | null => {
  let next: EditorState | null = null
  const ok = command(state, (tr) => {
    next = state.apply(tr)
  })
  return ok ? next : null
}

test('★ ① 한 블록의 조각 — 고른 글자만 · 굵게 · 링크는 인라인 마크다운으로 · 바꿀 자리는 그 범위', () => {
  const p = blk('paragraph', [textRun('앞 '), textRun('굵은', { bold: true }), { ...textRun(' 링크'), text: { content: ' 링크', link: { url: 'https://example.com' } } }, textRun(' 뒤')])
  const state = select(stateOf([p]), p.id, 2, p.id, 7)
  const snap = editSnapshot(state)!
  assert.deepEqual(snap.selection, { inline: true, blocks: [{ kind: 'paragraph', text: '**굵은** [링크](https://example.com)', depth: 0, language: null, checked: false }] })
  assert.equal(snap.target.kind, 'inline')
  assert.ok(snap.replaceable && snap.skipped === 0 && snap.anchorId === p.id)
  assert.equal(snap.chars, '**굵은** [링크](https://example.com)'.length)
  assert.equal(editSnapshot(stateOf([p])), null, '빈 선택(캐럿)은 없다')
})

test('★ ① 여러 블록 — 블록을 통째로 · 종류 · 깊이(가장 얕은 것이 0) · 체크 · 다음 블록 머리에서 끝나면 그 블록은 들지 않는다', () => {
  const child = blk('bulleted_list_item', '둘')
  const h = blk('heading_2', '제목입니다')
  const one = blk('bulleted_list_item', '하나', { children: [child] })
  const todo = blk('to_do', '할 일', { properties: { checked: true } })
  const after = blk('paragraph', '뒤')
  const state = select(stateOf([h, one, todo, after]), h.id, 2, after.id, 0)
  const snap = editSnapshot(state)!
  assert.deepEqual(
    snap.selection.blocks.map((b) => [b.kind, b.text, b.depth, b.checked]),
    [['heading_2', '제목입니다', 0, false], ['bulleted_list_item', '하나', 0, false], ['bulleted_list_item', '둘', 1, false], ['to_do', '할 일', 0, true]],
  )
  assert.equal(snap.selection.inline, false)
  assert.ok(snap.replaceable)
  assert.equal(snap.anchorId, todo.id)
})

test('★ ① 코드 — 한 블록 안이면 코드 그대로 + 언어 · 여러 블록이면 코드 블록으로', () => {
  const code = blk('code', 'const a = 1\nconst b = 2', { properties: { language: 'typescript' } })
  const p = blk('paragraph', '설명')
  const inCode = editSnapshot(select(stateOf([code, p]), code.id, 0, code.id, 11))!
  assert.deepEqual(inCode.selection.blocks[0], { kind: 'code', text: 'const a = 1', depth: 0, language: 'typescript', checked: false })
  assert.ok(inCode.target.kind === 'inline' && inCode.target.code)
  const across = editSnapshot(select(stateOf([code, p]), code.id, 3, p.id, 2))!
  assert.deepEqual(across.selection.blocks.map((b) => [b.kind, b.text, b.language]), [['code', 'const a = 1\nconst b = 2', 'typescript'], ['paragraph', '설명', null]])
})

test('★ ① 글 아닌 블록(구분선 · 이미지 …)은 싣지 않고 센다 — 바꾸기를 하지 않는다', () => {
  const a = blk('paragraph', '첫 글')
  const line = blk('divider', '')
  const c = blk('paragraph', '끝 글')
  const snap = editSnapshot(select(stateOf([a, line, c]), a.id, 0, c.id, 3))!
  assert.deepEqual(snap.selection.blocks.map((b) => b.text), ['첫 글', '끝 글'])
  assert.equal(snap.skipped, 1)
  assert.equal(snap.replaceable, false)
})

test('★ ② 한 블록 바꾸기 — 고른 범위만 · 마크다운 → 서식(굵게 · 기울임 · 코드 · 링크) · 블록 문법은 버린다 · 되돌리기 한 번에 원문', () => {
  const p = blk('paragraph', '앞 글 바꿀 글 뒤 글')
  const before = select(stateOf([p]), p.id, 4, p.id, 8)
  const snap = editSnapshot(before)!
  assert.equal(snap.selection.blocks[0]!.text, '바꿀 글')
  const after = run(before, replaceSelectionCommand(snap.target, '## **굵게** *기울임* `코드` [링크](https://x.com)', 'improve'))!
  const runs = pmToDoc(after.doc).blocks[0]!.title!
  assert.equal(toPlainText(runs), '앞 글 굵게 기울임 코드 링크 뒤 글')
  const marked = Object.fromEntries(runs.map((r) => [r.plain_text, r]))
  assert.ok(marked['굵게']!.annotations.bold && marked['기울임']!.annotations.italic && marked['코드']!.annotations.code)
  assert.equal(marked['링크']!.text!.link!.url, 'https://x.com')
  assert.deepEqual(shape(after), ['paragraph:앞 글 굵게 기울임 코드 링크 뒤 글'])

  let undone: EditorState | null = null
  undo(after, (tr) => {
    undone = after.apply(tr)
  })
  assert.deepEqual(shape(undone!), ['paragraph:앞 글 바꿀 글 뒤 글'], '되돌리기 한 번')
})

test('★ ② 블록들 바꾸기 — 결과 블록으로 · 종류를 지킨다 · 첫 id 를 지킨다 · 트랜잭션 하나(되돌리기 한 번)', () => {
  const h = blk('heading_2', '제목')
  const one = blk('bulleted_list_item', '하나')
  const two = blk('bulleted_list_item', '둘')
  const tail = blk('paragraph', '그대로')
  const before = select(stateOf([h, one, two, tail]), h.id, 1, two.id, 1)
  const snap = editSnapshot(before)!
  const answer = fakeEditAnswer('## 제목\n\n- 하나\n- 둘', false)
  assert.equal(answer, '## 고친 제목\n\n- 고친 하나\n- 고친 둘')
  const after = run(before, replaceSelectionCommand(snap.target, answer, 'improve'))!
  assert.deepEqual(shape(after), ['heading_2:고친 제목', 'bulleted_list_item:고친 하나', 'bulleted_list_item:고친 둘', 'paragraph:그대로'])
  assert.equal(pmToDoc(after.doc).blocks[0]!.id, h.id, '첫 블록의 id 를 지킨다')
  let undone: EditorState | null = null
  undo(after, (tr) => {
    undone = after.apply(tr)
  })
  assert.deepEqual(shape(undone!), ['heading_2:제목', 'bulleted_list_item:하나', 'bulleted_list_item:둘', 'paragraph:그대로'])
})

test('② 코드 조각 바꾸기 — 울타리를 벗기고 글 그대로', () => {
  const code = blk('code', 'let x = 1', { properties: { language: 'javascript' } })
  const before = select(stateOf([code]), code.id, 0, code.id, 9)
  const after = run(before, replaceSelectionCommand(editSnapshot(before)!.target, '```js\nconst x = 1\n```', 'fix'))!
  assert.deepEqual(shape(after), ['code:const x = 1'])
})

test('★ ③ 바꿀 자리 — 앞에 글이 들어와 밀려도 찾는다 · 고른 글이 바뀌면 · 블록이 사라지면 · 구조가 바뀌면 바꾸지 않는다', () => {
  const p = blk('paragraph', '앞 글 바꿀 글 뒤 글')
  const before = select(stateOf([p]), p.id, 4, p.id, 8)
  const target = editSnapshot(before)!.target
  const at = findContainerById(before.doc, p.id)!.contentPos + 1

  const shifted = before.apply(before.tr.insertText('누가 ', at))
  const found = locateEditTarget(shifted.doc, target)!
  assert.equal(shifted.doc.textBetween(found.from, found.to), '바꿀 글', '밀린 자리를 찾는다')
  const changed = before.apply(before.tr.insertText('X', at + 5))
  assert.equal(locateEditTarget(changed.doc, target), null, '고른 글이 바뀌었다')
  assert.equal(run(changed, replaceSelectionCommand(target, '고친 글', 'improve')), null, '바꾸지 않는다')

  const a = blk('paragraph', '첫째')
  const b = blk('paragraph', '둘째')
  const c = blk('paragraph', '셋째')
  const multi = select(stateOf([a, b, c]), a.id, 0, b.id, 2)
  const blocks = editSnapshot(multi)!.target
  assert.ok(locateEditTarget(multi.doc, blocks) !== null)
  const bInfo = findContainerById(multi.doc, b.id)!
  const edited = multi.apply(multi.tr.insertText('!', bInfo.contentPos + 2))
  assert.equal(locateEditTarget(edited.doc, blocks), null, '고른 블록의 글이 바뀌었다')
  const removed = multi.apply(multi.tr.delete(bInfo.pos, bInfo.pos + bInfo.node.nodeSize))
  assert.equal(locateEditTarget(removed.doc, blocks), null, '고른 블록이 사라졌다')
  const cInfo = findContainerById(multi.doc, c.id)!
  const moved = multi.apply(multi.tr.delete(cInfo.pos, cInfo.pos + cInfo.node.nodeSize).insert(bInfo.pos, cInfo.node))
  assert.equal(locateEditTarget(moved.doc, blocks), null, '사이에 고르지 않은 블록이 끼었다')
})

test('③ 고르지 않은 자식이 있으면(고른 글 뒤의 자식) 블록들을 바꾸지 않는다', () => {
  const kid = blk('paragraph', '자식')
  const a = blk('paragraph', '첫째')
  const b = blk('paragraph', '둘째', { children: [kid] })
  const snap = editSnapshot(select(stateOf([a, b]), a.id, 0, b.id, 2))!
  assert.equal(snap.replaceable, false)
})

test('★ ④ 할 일 뽑기는 할 일 블록만 · 결과의 인라인 런 · 인라인 마크다운', () => {
  const blocks = editAnswerBlocks('## 할 일\n\n- 회의 잡기\n- [x] 메일 보내기\n\n```js\nx\n```', 'action_items')
  assert.deepEqual(blocks.map((b) => [b.type, toPlainText(b.title ?? []), b.properties?.checked]), [['to_do', '할 일', false], ['to_do', '회의 잡기', false], ['to_do', '메일 보내기', true]])
  assert.deepEqual(editAnswerBlocks('- 하나', 'summarize').map((b) => b.type), ['bulleted_list_item'])
  assert.equal(toPlainText(inlineRunsOf('첫 문단\n\n둘째 문단')), '첫 문단 둘째 문단')
  assert.equal(runsToEditMarkdown([textRun(' 앞뒤 공백 ', { bold: true }), textRun('줄', { strikethrough: true })]), ' **앞뒤 공백** ~~줄~~')
})

test('④ 입구 — Ctrl/Cmd+J 는 글을 골랐을 때만 연다', () => {
  const p = blk('paragraph', '글입니다')
  let opened = 0
  const command = aiEditCommand(() => {
    opened += 1
    return true
  })
  assert.equal(command(stateOf([p])), false, '캐럿만 — 키를 넘긴다')
  assert.equal(command(select(stateOf([p]), p.id, 0, p.id, 2)), true)
  assert.equal(opened, 1)
})
