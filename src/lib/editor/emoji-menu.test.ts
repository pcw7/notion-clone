/**
 * `:` 커스텀 이모지 메뉴 — 트리거 · 종료 · 넣기 (인접 제품 7c-3b · F-13-16)
 *
 * 이 파일이 지키는 것(정본 §3.4 [보강] 커스텀 이모지 ⑧).
 *
 *   ① ★ 트리거 — 줄 시작 · 공백 뒤의 `:` 를 키로 쳤을 때만. 글자 뒤(`10:30` · `https:`) · 붙여넣기 · 코드 블록은 열지 않는다
 *   ② ★ 쿼리 — 이름 글자만 따라간다(대소문자). 공백 · 한글 · 문장 부호 · 40자를 넘으면 닫는다 · 후보와 상관없이 열린 채다 · Esc 는 글자를 남긴다
 *   ③ ★ 넣기 — `:쿼리` 가 통째로 커스텀 이모지 멘션 노드로(뒤에 공백 없음 · id 만 · 소문자) · 한 트랜잭션 · 넣은 뒤 닫힌다
 *   ④ ★ 닫는 `:` — 쿼리 뒤의 `:` 한 글자로 닫히며 그 트랜잭션에만 자리 · 이름을 싣는다 · **같은 디스패치의 덧붙은 트랜잭션은 지우지
 *      않는다**(위치만 옮긴다 — e2e 가 잡았다) · 바꾸기는 자리가 그대로일 때만
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { EditorState, Plugin, TextSelection, type Transaction } from '@tiptap/pm/state'

import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from './document.ts'
import { closeEmojiMenu, emojiMenuPlugin, emojiMenuState, insertCustomEmoji, replaceColonEmoji } from './emoji-menu.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'

const A = '00000000-0000-4000-8000-00000000000a'
const CODE = '00000000-0000-4000-8000-00000000000c'
const EMOJI = '0A1B2C3D-0000-4000-8000-00000000E0E0'

const blk = (id: string, text = '', type = 'paragraph'): EditorBlock => ({ id, type, title: text === '' ? [] : [textRun(text)] })

function stateWith(blocks: EditorBlock[]): EditorState {
  return EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }), plugins: [emojiMenuPlugin()] })
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

describe('① 트리거', () => {
  test('줄 시작 · 공백 뒤의 : 에서 열리고 쿼리를 따라간다 — 대소문자 그대로', () => {
    let s = type(caretAt(stateWith([blk(A)]), A, 0), ':')
    assert.deepEqual(emojiMenuState(s), { active: true, from: 3, query: '' })
    s = type(s, 'Par_ty-1')
    assert.deepEqual(emojiMenuState(s), { active: true, from: 3, query: 'Par_ty-1' })
    assert.equal(emojiMenuState(type(caretAt(stateWith([blk(A, '파티 ')]), A, 3), ':pa')).query, 'pa')
  })

  test('★ 글자 뒤의 : 는 열지 않는다 — 시각 · 주소 · 이름:값', () => {
    for (const text of ['10:30', 'https:', '참고:']) {
      assert.equal(emojiMenuState(type(caretAt(stateWith([blk(A)]), A, 0), text)).active, false, text)
    }
  })

  test('★ 붙여넣기로 들어온 : 는 열지 않는다 · 코드 블록 안에서도 열지 않는다', () => {
    const base = caretAt(stateWith([blk(A)]), A, 0)
    assert.equal(emojiMenuState(base.apply(base.tr.insertText('안녕 :'))).active, false)
    assert.equal(emojiMenuState(type(base, '안녕 :')).active, true, '같은 자리에 한 글자씩 치면 열린다')
    assert.equal(emojiMenuState(type(caretAt(stateWith([blk(CODE, '', 'code')]), CODE, 0), ':')).active, false)
  })
})

describe('② ★ 쿼리', () => {
  test('공백 · 한글 · 문장 부호를 치면 닫는다 — : 뒤에 말을 이어 쓰는 글을 붙잡지 않는다', () => {
    for (const next of [' ', '이', '.', '!', '/']) {
      const s = type(caretAt(stateWith([blk(A)]), A, 0), ':pa')
      assert.equal(emojiMenuState(type(s, next)).active, false, JSON.stringify(next))
    }
  })

  test('40자를 넘으면 닫는다 · 후보와 상관없이 열린 채다(플러그인은 목록을 모른다)', () => {
    const s = type(caretAt(stateWith([blk(A)]), A, 0), `:${'x'.repeat(40)}`)
    assert.equal(emojiMenuState(s).active, true)
    assert.equal(emojiMenuState(type(s, 'x')).active, false)
  })

  test('Esc 는 친 글자를 남긴 채 닫는다 · 캐럿이 : 앞으로 가면 닫는다', () => {
    let s = type(caretAt(stateWith([blk(A)]), A, 0), ':pa')
    s = s.apply(closeEmojiMenu(s.tr))
    assert.equal(emojiMenuState(s).active, false)
    assert.equal(s.doc.textContent, ':pa')

    const open = type(caretAt(stateWith([blk(A)]), A, 0), ':pa')
    const info = findContainerById(open.doc, A)
    assert.ok(info)
    assert.equal(emojiMenuState(open.apply(open.tr.setSelection(TextSelection.create(open.doc, info.contentPos + 1)))).active, false)
  })
})

describe('③ ★ 넣기', () => {
  test(':쿼리가 통째로 커스텀 이모지 멘션 노드로 — 뒤에 공백 없음 · id 만(소문자) · 넣은 뒤 닫힌다', () => {
    const s = type(caretAt(stateWith([blk(A, '파티 ')]), A, 3), ':par')
    let after: EditorState | null = null
    assert.equal(insertCustomEmoji(s, (tr: Transaction) => (after = s.apply(tr)), EMOJI), true)
    assert.ok(after !== null)
    const done = after as EditorState
    const runs = pmToDoc(done.doc).blocks[0]!.title
    assert.deepEqual(
      runs.map((r) => (r.type === 'mention' ? `mention:${JSON.stringify(r.mention)}` : r.plain_text)),
      ['파티 ', `mention:${JSON.stringify({ type: 'custom_emoji', custom_emoji: { id: EMOJI.toLowerCase() } })}`],
    )
    assert.equal(runs[1]!.plain_text, '', '이름을 싣지 않는다')
    assert.equal(emojiMenuState(done).active, false)
  })

  test('메뉴가 열려 있지 않으면 아무것도 하지 않는다', () => {
    const s = caretAt(stateWith([blk(A, '글')]), A, 1)
    let dispatched = false
    assert.equal(insertCustomEmoji(s, () => (dispatched = true), EMOJI), false)
    assert.equal(dispatched, false)
  })
})

describe('④ ★ 닫는 :', () => {
  test('쿼리 뒤의 : 한 글자로 닫히며 자리 · 이름을 싣는다 — 문서를 안 바꾸는 트랜잭션에는 남고, 문서를 바꾸면 사라진다', () => {
    const s = type(caretAt(stateWith([blk(A, '파티 ')]), A, 3), ':Party:')
    const state = emojiMenuState(s)
    assert.equal(state.active, false)
    assert.deepEqual(state.colon, { from: 6, to: 13, name: 'Party' })
    assert.equal(s.doc.textBetween(6, 13), ':Party:')
    // 디스패치 도중 플러그인 뷰가 보내는 메타 트랜잭션 — 화면은 늘 마지막 상태를 읽으므로 여기서 지우면 못 본다(e2e 가 잡았다).
    const meta = s.apply(s.tr.setMeta('somePlugin', true))
    assert.deepEqual(emojiMenuState(meta).colon, { from: 6, to: 13, name: 'Party' })
    assert.equal(emojiMenuState(type(meta, 'x')).colon, undefined)
  })

  test('★ 같은 디스패치의 덧붙은 트랜잭션(appendTransaction)은 자리를 지우지 않는다 — 문서를 바꾸면 위치를 옮긴다', () => {
    // 글이 바뀔 때마다 줄 맨 앞에 글자 하나를 덧붙이는 플러그인 — 정규화 · 협업이 하는 일의 흉내다.
    const prefix = new Plugin({
      appendTransaction: (trs, _old, next) => {
        if (!trs.some((t) => t.docChanged) || trs.some((t) => t.getMeta('prefixed'))) return null
        const info = findContainerById(next.doc, A)
        return info === null ? null : next.tr.insertText('#', info.contentPos + 1).setMeta('prefixed', true)
      },
    })
    const base = EditorState.create({ schema: blockSchema, doc: docToPm({ blocks: [blk(A, '파티 ')] }), plugins: [emojiMenuPlugin(), prefix] })
    let s = caretAt(base, A, 3)
    for (const char of ':party:') {
      const { from, to } = s.selection
      s = s.apply(s.tr.insertText(char, from, to))
    }
    const colon = emojiMenuState(s).colon
    assert.ok(colon !== undefined, '덧붙은 트랜잭션이 자리를 지웠다')
    assert.equal(s.doc.textBetween(colon.from, colon.to), ':party:', '덧붙인 글자만큼 위치가 옮겨졌다')
  })

  test('빈 쿼리의 : (::) · 붙여넣기로 들어온 : · 이름 글자가 아닌 쿼리는 싣지 않는다', () => {
    assert.equal(emojiMenuState(type(caretAt(stateWith([blk(A)]), A, 0), '::')).colon, undefined)
    const open = type(caretAt(stateWith([blk(A)]), A, 0), ':par')
    assert.equal(emojiMenuState(open.apply(open.tr.insertText('ty:'))).colon, undefined, '여러 글자가 한 번에')
    assert.equal(emojiMenuState(type(caretAt(stateWith([blk(A)]), A, 0), ':pa ty:')).colon, undefined)
  })

  test('바꾸기 — :이름: 이 그대로면 멘션 노드로 · 자리가 바뀌었으면 손대지 않는다', () => {
    const s = type(caretAt(stateWith([blk(A, '파티 ')]), A, 3), ':party:')
    const colon = emojiMenuState(s).colon!
    let after: EditorState | null = null
    assert.equal(replaceColonEmoji(s, (tr: Transaction) => (after = s.apply(tr)), colon, EMOJI), true)
    const runs = pmToDoc((after as unknown as EditorState).doc).blocks[0]!.title
    assert.deepEqual(runs.map((r) => (r.type === 'mention' ? r.mention : r.plain_text)), ['파티 ', { type: 'custom_emoji', custom_emoji: { id: EMOJI.toLowerCase() } }])

    const moved = type(s, 'x')
    const edited = moved.apply(moved.tr.insertText('!', colon.from + 1))
    assert.equal(replaceColonEmoji(edited, () => assert.fail('바꾸면 안 된다'), colon, EMOJI), false)
  })
})
