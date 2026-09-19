/**
 * `@` 멘션 메뉴 — 트리거 · 종료 · 넣기 (F-07-08 · 코멘트 5b조각)
 *
 * 07 F-07-08 의 엣지 표를 그대로 옮겼다 — 이메일을 방해하지 않는가 · 후보 0건에 닫히지 않는가 · 붙여넣기에 열리지
 * 않는가 · Esc 가 글자를 남기는가 · 넣으면 `@쿼리` 가 통째로 바뀌는가.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'

import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from './document.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'
import { closeMentionMenu, insertMention, MAX_MENTION_QUERY, mentionMenuPlugin, mentionMenuState } from './mention-menu.ts'

const A = '00000000-0000-4000-8000-00000000000a'
const USER = '00000000-0000-4000-8000-0000000000aa'

const blk = (id: string, text = ''): EditorBlock => ({ id, type: 'paragraph', title: text === '' ? [] : [textRun(text)] })

function stateWith(blocks: EditorBlock[]): EditorState {
  return EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }), plugins: [mentionMenuPlugin()] })
}

function caretAt(state: EditorState, blockId: string, offset: number): EditorState {
  const info = findContainerById(state.doc, blockId)
  assert.ok(info, `블록을 찾지 못했다: ${blockId}`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1 + offset)))
}

/** 한 글자씩 타이핑. 플러그인 상태는 트랜잭션마다 갱신된다. */
function type(state: EditorState, text: string): EditorState {
  let current = state
  for (const char of text) {
    const { from, to } = current.selection
    current = current.apply(current.tr.insertText(char, from, to))
  }
  return current
}

describe('트리거', () => {
  test('줄 시작 · 공백 뒤의 @ 에서 열리고, 쿼리를 따라간다', () => {
    let s = type(caretAt(stateWith([blk(A)]), A, 0), '@')
    assert.equal(mentionMenuState(s).active, true)
    s = type(s, '김')
    assert.deepEqual(mentionMenuState(s), { active: true, from: 3, query: '김' })

    let t = type(caretAt(stateWith([blk(A, '안녕 ')]), A, 3), '@온')
    assert.equal(mentionMenuState(t).query, '온')
    t = type(t, '보')
    assert.equal(mentionMenuState(t).query, '온보')
  })

  test('★ 글자 뒤의 @ 는 열리지 않는다 — 이메일을 방해하지 않는다', () => {
    const s = type(caretAt(stateWith([blk(A)]), A, 0), 'me@example')
    assert.equal(mentionMenuState(s).active, false)
  })

  test('★ 붙여넣기(여러 글자가 한 번에)로 들어온 @ 는 열지 않는다', () => {
    // 붙인 글이 **`@` 로 끝나고 그 앞이 공백**이어야 검사가 된다 — 처음에는 '@홍길동' 을 붙였는데, 그건 마지막 글자가
    // '동' 이라 "한 글자만 받는다" 를 빼도 닫혀 있었다(반사실이 통과했다 · §3.3-144). 트리거 자리는 맞되 여러 글자가
    // 한 번에 들어온 경우만이 이 규칙을 가려낸다.
    const base = caretAt(stateWith([blk(A)]), A, 0)
    const pasted = base.apply(base.tr.insertText('안녕 @'))
    assert.equal(mentionMenuState(pasted).active, false)
    // 같은 자리에 한 글자씩 치면 열린다 — 위와의 차이는 "한 번에 들어온 글자 수" 뿐이다.
    assert.equal(mentionMenuState(type(base, '안녕 @')).active, true)
  })

  test('공백을 치면 닫히고, Esc 는 친 글자를 남긴 채 닫는다', () => {
    let s = type(caretAt(stateWith([blk(A)]), A, 0), '@온보')
    assert.equal(mentionMenuState(s).active, true)
    const spaced = type(s, ' ')
    assert.equal(mentionMenuState(spaced).active, false)

    s = s.apply(closeMentionMenu(s.tr))
    assert.equal(mentionMenuState(s).active, false)
    assert.equal(s.doc.textContent, '@온보', 'Esc 는 입력한 리터럴을 보존한다 (07 F-07-08)')
  })

  test('후보가 없어도 닫히지 않는다 — 닫는 것은 공백 · 길이뿐이다', () => {
    let s = type(caretAt(stateWith([blk(A)]), A, 0), '@아무도없는이름')
    assert.equal(mentionMenuState(s).active, true, '후보를 모르는 플러그인은 열어 둔다')
    s = type(s, '가'.repeat(MAX_MENTION_QUERY))
    assert.equal(mentionMenuState(s).active, false, '너무 길어지면 멘션이 아니라 글이다')
  })

  test('캐럿이 @ 앞으로 가거나 다른 블록으로 넘어가면 닫힌다', () => {
    const s = type(caretAt(stateWith([blk(A), blk('00000000-0000-4000-8000-00000000000b', '둘째')]), A, 0), '@김')
    const info = findContainerById(s.doc, A)
    assert.ok(info)
    const back = s.apply(s.tr.setSelection(TextSelection.create(s.doc, info.contentPos + 1)))
    assert.equal(mentionMenuState(back).active, false)
  })
})

describe('넣기', () => {
  test('★ @쿼리가 통째로 멘션 노드(+공백)로 바뀌고, 노드에는 id 만 있다', () => {
    const s = type(caretAt(stateWith([blk(A, '담당 ')]), A, 3), '@김')
    let after: EditorState | null = null
    const ok = insertMention(s, (tr: Transaction) => (after = s.apply(tr)), { kind: 'user', id: USER })
    assert.equal(ok, true)
    assert.ok(after !== null)
    const done = after as EditorState

    const runs = pmToDoc(done.doc).blocks[0].title
    assert.deepEqual(
      runs.map((r) => (r.type === 'mention' ? `mention:${JSON.stringify(r.mention)}` : r.plain_text)),
      ['담당 ', 'mention:{"type":"user","user":{"id":"' + USER + '"}}', ' '],
    )
    assert.equal(runs[1].plain_text, '', '표시 텍스트를 싣지 않는다')
    assert.equal(mentionMenuState(done).active, false, '넣은 뒤 닫힌다')
  })

  test('메뉴가 열려 있지 않으면 아무것도 하지 않는다', () => {
    const s = caretAt(stateWith([blk(A, '글')]), A, 1)
    let dispatched = false
    assert.equal(insertMention(s, () => (dispatched = true), { kind: 'page', id: A }), false)
    assert.equal(dispatched, false)
  })
})
