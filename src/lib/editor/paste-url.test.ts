/**
 * 주소 붙여넣기 — 판별 · 링크 걸기 · 범위 따라가기 · 항목 · 적용 (EM-2 · 정본 §3.4 [보강 EM-2])
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { EditorState, TextSelection } from '@tiptap/pm/state'

import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from './document.ts'
import { containerOfPos, isOnlyLink, pasteUrlTransaction } from './paste-url-apply.ts'
import { internalPageIdOf, pasteUrlOptions } from './paste-url-choices.ts'
import { canPasteUrl, holdsLink, pastedUrlOf, pasteUrlCommand, pasteUrlKey, pasteUrlPlugin, pasteUrlState } from './paste-url.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'

const A = '00000000-0000-4000-8000-00000000000a'
const WS = '11111111-1111-4111-8111-111111111111'
const PAGE = '22222222-2222-4222-8222-222222222222'
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const ORIGIN = 'http://localhost:3000'

const blk = (id: string, text = ''): EditorBlock => ({ id, type: 'paragraph', title: text === '' ? [] : [textRun(text)] })

function stateWith(text = '', offset = text.length): EditorState {
  const state = EditorState.create({ schema: blockSchema, doc: docToPm({ blocks: [blk(A, text)] }), plugins: [pasteUrlPlugin()] })
  const info = findContainerById(state.doc, A)!
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1 + offset)))
}

function paste(state: EditorState, url: string): EditorState {
  let next = state
  assert.ok(pasteUrlCommand(url)(state, (tr) => (next = state.apply(tr))))
  return next
}

describe('pastedUrlOf — 평문이 주소 하나인가', () => {
  test('앞뒤 공백을 떼고 http(s) 주소 하나면 그 주소', () => {
    assert.equal(pastedUrlOf(`  ${YT}\n`), YT)
    assert.equal(pastedUrlOf('http://a.test/x'), 'http://a.test/x')
  })
  test('공백 · 줄바꿈이 끼거나 http(s) 가 아니거나 너무 길면 null', () => {
    for (const bad of ['', '   ', 'a b', 'https://a.test\nhttps://b.test', 'https://a.test x', 'ftp://a.test', 'javascript:alert(1)', 'hello', 'a.test', `https://a.test/${'x'.repeat(2048)}`]) {
      assert.equal(pastedUrlOf(bad), null, bad)
    }
    assert.equal(pastedUrlOf(null), null)
  })
})

describe('pasteUrlCommand', () => {
  test('선택이 없으면 링크 글자로 넣고 범위를 열어 둔다', () => {
    const next = paste(stateWith('앞 '), YT)
    const range = pasteUrlState(next)
    assert.deepEqual(range && range.url, YT)
    assert.ok(range && holdsLink(next.doc, range.from, range.to, YT))
    assert.equal(pmToDoc(next.doc).blocks[0].title.map((r) => r.text?.content).join(''), `앞 ${YT}`)
  })

  test('글자 선택이 있으면 그 선택에 링크만 건다 — 글자는 그대로 · 메뉴 없음', () => {
    const base = stateWith('가나다')
    const info = findContainerById(base.doc, A)!
    const sel = base.apply(base.tr.setSelection(TextSelection.create(base.doc, info.contentPos + 1, info.contentPos + 3)))
    const next = paste(sel, YT)
    assert.equal(pasteUrlState(next), null)
    assert.equal(next.doc.textBetween(0, next.doc.content.size, '|'), '가나다')
    assert.ok(next.doc.rangeHasMark(info.contentPos + 1, info.contentPos + 3, blockSchema.marks.link))
    assert.ok(!next.doc.rangeHasMark(info.contentPos + 3, info.contentPos + 4, blockSchema.marks.link))
  })

  test('코드 블록(평문 본문)에서는 받지 않는다', () => {
    const state = EditorState.create({
      schema: blockSchema,
      doc: docToPm({ blocks: [{ id: A, type: 'code', title: [textRun('x')] }] }),
      plugins: [pasteUrlPlugin()],
    })
    const info = findContainerById(state.doc, A)!
    const sel = state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1)))
    assert.equal(pasteUrlCommand(YT)(sel, undefined), false)
    assert.equal(canPasteUrl(sel), false)
  })
})

describe('범위를 따라간다', () => {
  test('앞에 글자가 들어오면 매핑으로 따라간다', () => {
    const open = paste(stateWith('x'), YT)
    const range = pasteUrlState(open)!
    const next = open.apply(open.tr.insertText('앞', findContainerById(open.doc, A)!.contentPos + 1))
    const moved = pasteUrlState(next)
    assert.deepEqual(moved && [moved.from, moved.to], [range.from + 1, range.to + 1])
  })

  test('링크 글자가 바뀌거나 지워지면 닫는다', () => {
    const open = paste(stateWith(), YT)
    const range = pasteUrlState(open)!
    assert.equal(pasteUrlState(open.apply(open.tr.insertText('z', range.from + 3))), null)
    assert.equal(pasteUrlState(open.apply(open.tr.delete(range.from, range.to))), null)
  })

  test('링크 마크가 벗겨지면 닫는다', () => {
    const open = paste(stateWith(), YT)
    const range = pasteUrlState(open)!
    assert.equal(pasteUrlState(open.apply(open.tr.removeMark(range.from, range.to, blockSchema.marks.link))), null)
  })
})

describe('항목', () => {
  test('일반 주소 — 링크로 두기 · 북마크 · 임베드', () => {
    assert.deepEqual(pasteUrlOptions('https://example.com/a', ORIGIN, WS).map((o) => o.choice), ['link', 'bookmark', 'embed'])
  })
  test('알려진 서비스는 이름을 함께', () => {
    assert.equal(pasteUrlOptions(YT, ORIGIN, WS)[2].label, '임베드 · 유튜브')
  })
  test('이 앱의 출처는 임베드를 내놓지 않는다 · 이 워크스페이스의 페이지면 페이지 멘션', () => {
    assert.deepEqual(pasteUrlOptions(`${ORIGIN}/w/${WS}/${PAGE}`, ORIGIN, WS).map((o) => o.choice), ['link', 'bookmark', 'mention'])
    assert.deepEqual(pasteUrlOptions(`${ORIGIN}/w/${WS}/db/${PAGE}`, ORIGIN, WS).map((o) => o.choice), ['link', 'bookmark'])
  })
  test('internalPageIdOf — 출처 · 워크스페이스 · 꼴이 맞을 때만', () => {
    assert.equal(internalPageIdOf(`${ORIGIN}/w/${WS}/${PAGE}/?a=1#b`, ORIGIN, WS), PAGE)
    assert.equal(internalPageIdOf(`https://other.test/w/${WS}/${PAGE}`, ORIGIN, WS), null)
    assert.equal(internalPageIdOf(`${ORIGIN}/w/${PAGE}/${PAGE}`, ORIGIN, WS), null)
    assert.equal(internalPageIdOf(`${ORIGIN}/w/${WS}/not-a-uuid`, ORIGIN, WS), null)
    assert.equal(internalPageIdOf(`${ORIGIN}/w/${WS}`, ORIGIN, WS), null)
  })
})

describe('고르면', () => {
  test('문단이 링크 하나뿐이면 문단을 그 블록으로 바꾼다', () => {
    const open = paste(stateWith(), YT)
    const info = containerOfPos(open.doc, pasteUrlState(open)!.from)!
    assert.ok(isOnlyLink(info, pasteUrlState(open)!.from, pasteUrlState(open)!.to))
    const next = open.apply(pasteUrlTransaction(open, pasteUrlKey, 'embed', null))
    const blocks = pmToDoc(next.doc).blocks
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].type, 'embed')
    assert.equal(blocks[0].id, A)
    assert.equal(blocks[0].properties?.url, YT)
    assert.equal(pasteUrlState(next), null)
  })

  test('다른 글이 있으면 링크 글자만 지우고 문단 바로 뒤에 블록을 넣는다', () => {
    const open = paste(stateWith('앞 '), 'https://example.com/a')
    const next = open.apply(pasteUrlTransaction(open, pasteUrlKey, 'bookmark', null, () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))
    const blocks = pmToDoc(next.doc).blocks
    assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'bookmark'])
    assert.equal(blocks[0].title.map((r) => r.text?.content).join(''), '앞 ')
    assert.equal(blocks[1].properties?.url, 'https://example.com/a')
  })

  test('페이지 멘션 — 링크 글자를 그 페이지의 멘션 원자로 바꾼다', () => {
    const open = paste(stateWith('앞 '), `${ORIGIN}/w/${WS}/${PAGE}`)
    const next = open.apply(pasteUrlTransaction(open, pasteUrlKey, 'mention', PAGE))
    const runs = pmToDoc(next.doc).blocks[0].title
    assert.ok(runs.some((r) => r.type === 'mention'))
    assert.ok(!runs.some((r) => r.text?.content.includes('http')))
  })

  test('링크로 두기 · 범위가 달라졌으면 문서를 바꾸지 않고 닫는다', () => {
    const open = paste(stateWith(), YT)
    const keep = pasteUrlTransaction(open, pasteUrlKey, 'link', null)
    assert.equal(keep.docChanged, false)
    assert.equal(pasteUrlState(open.apply(keep)), null)
    // 범위가 이미 달라진 상태(플러그인 상태를 거치지 않은 직접 호출)에서도 건드리지 않는다.
    const edited = open.apply(open.tr.insertText('z', pasteUrlState(open)!.from + 2))
    assert.equal(pasteUrlTransaction(edited, pasteUrlKey, 'bookmark', null).docChanged, false)
  })
})
