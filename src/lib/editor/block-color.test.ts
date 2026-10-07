/**
 * 블록 색의 나머지 — 색 슬래시 명령 · 마지막 색 다시 쓰기 (Phase 2 1e-1 · F-01-21 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ `/` 의 색 명령 — 19색이 메뉴의 맨 끝 · 한국어 · 붙여 쓴 이름 · 영어(`/red` · `/blue background`) · "색" 으로 찾는다
 *   ② ★ 실행 — 쳐 둔 `/쿼리` 를 지우고 그 블록 전체의 색 · `/기본` 은 지운다 · 글자는 그대로 · 메뉴가 닫힌다
 *   ③ ★ Ctrl/Cmd+Shift+H — 마지막 색이 없으면 키를 넘긴다 · 캐럿이면 그 블록 · 고른 글자면 그 글자(인라인) · 블록 선택이면 그
 *        블록들(칠할 수 없는 타입은 건너뛴다) · 같은 색이면 바꾸지 않고 키만 삼킨다
 *   ④ 마지막 색의 기억 — 저장소가 없어도 이 탭의 기억은 남는다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'

import type { BlockType } from '../block/types.ts'
import { textRun, toPlainText, type Color } from '../contracts/rich-text.ts'
import { reapplyColorCommand, runColorSlashCommand } from './block-color.ts'
import { BlockSelection } from './block-selection.ts'
import type { EditorBlock } from './document.ts'
import { createEditorKeymap } from './keymap.ts'
import { lastColor, rememberColor } from './last-color.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'
import { filterSlashCommands, SLASH_COMMANDS, slashMenuPlugin, slashMenuState } from './slash-menu.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const blk = (type: string, text = '', format: Record<string, unknown> = {}): EditorBlock => ({
  id: nextId(),
  type: type as BlockType,
  title: text === '' ? [] : [textRun(text)],
  properties: {},
  format,
  children: [],
})
const stateOf = (blocks: EditorBlock[]) => EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }), plugins: [slashMenuPlugin()] })
function run(state: EditorState, command: Command): { handled: boolean; state: EditorState } {
  let next = state
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { handled, state: next }
}
const colorOf = (state: EditorState, id: string) => pmToDoc(state.doc).blocks.find((b) => b.id === id)?.format?.block_color
const caretAtEnd = (state: EditorState, id: string): EditorState => {
  const info = findContainerById(state.doc, id)!
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1 + info.contentNode.content.size)))
}

describe('① 색 명령', () => {
  test('★ 19색이 메뉴의 맨 끝이다', () => {
    const colors = SLASH_COMMANDS.filter((c) => c.kind === 'color')
    assert.equal(colors.length, 19)
    assert.deepEqual(SLASH_COMMANDS.slice(-19), colors)
  })

  test('★ 한국어 · 붙여 쓴 이름 · 영어 · "색" 으로 찾는다', () => {
    const ids = (q: string) => filterSlashCommands(q).filter((c) => c.kind === 'color').map((c) => c.id)
    assert.deepEqual(ids('빨'), ['color:red', 'color:red_background'])
    assert.deepEqual(ids('빨강배'), ['color:red_background'])
    assert.deepEqual(ids('red'), ['color:red', 'color:red_background'])
    // 메뉴는 쿼리의 공백에서 닫힌다 — 두 낱말 이름은 붙여 쓴 꼴로 찾는다.
    assert.deepEqual(ids('blueb'), ['color:blue_background'])
    assert.deepEqual(ids('기본'), ['color:default'])
    assert.equal(ids('색').length, 19)
  })
})

describe('② 실행', () => {
  const typed = (blocks: EditorBlock[], id: string, query: string): EditorState => {
    let s = caretAtEnd(stateOf(blocks), id)
    s = s.apply(s.tr.insertText('/'))
    s = s.apply(s.tr.insertText(query))
    assert.ok(slashMenuState(s).active)
    return s
  }

  test('★ 쳐 둔 /쿼리를 지우고 그 블록 전체의 색 — 글자는 그대로 · 메뉴가 닫힌다', () => {
    const a = blk('heading_2', '제목 ')
    const { handled, state } = run(typed([a], a.id, '빨강'), (s, d) => runColorSlashCommand(s, d, 'red_background'))
    assert.ok(handled)
    assert.equal(colorOf(state, a.id), 'red_background')
    assert.equal(toPlainText(pmToDoc(state.doc).blocks[0]!.title), '제목 ')
    assert.equal(slashMenuState(state).active, false)
  })

  test('/기본 은 색을 지운다 · 메뉴가 닫혀 있으면 하지 않는다', () => {
    const a = blk('paragraph', '글 ', { block_color: 'blue' })
    const { state } = run(typed([a], a.id, '기본'), (s, d) => runColorSlashCommand(s, d, 'default'))
    assert.equal(colorOf(state, a.id), undefined)
    assert.equal(run(caretAtEnd(stateOf([a]), a.id), (s, d) => runColorSlashCommand(s, d, 'red')).handled, false)
  })
})

describe('③ Ctrl/Cmd+Shift+H', () => {
  const with_ = (color: Color | null) => reapplyColorCommand(() => color)

  test('★ 마지막 색이 없으면 키를 넘긴다', () => {
    const a = blk('paragraph', '글')
    const s = caretAtEnd(stateOf([a]), a.id)
    assert.equal(run(s, with_(null)).handled, false)
  })

  test('★ 캐럿 — 그 블록의 블록 색 · 같은 색이면 바꾸지 않고 키만 삼킨다', () => {
    const a = blk('to_do', '할 일')
    const s = caretAtEnd(stateOf([a, blk('paragraph', '다른')]), a.id)
    const once = run(s, with_('green'))
    assert.ok(once.handled)
    assert.equal(colorOf(once.state, a.id), 'green')
    const again = run(once.state, with_('green'))
    assert.ok(again.handled)
    assert.ok(again.state.doc.eq(once.state.doc))
  })

  test('★ 고른 글자 — 그 글자의 색(인라인) · 블록 색은 그대로', () => {
    const a = blk('paragraph', '앞뒤')
    const state = stateOf([a])
    const info = findContainerById(state.doc, a.id)!
    const s = state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1, info.contentPos + 2)))
    const { state: out } = run(s, with_('purple'))
    const runs = pmToDoc(out.doc).blocks[0]!.title
    assert.deepEqual(runs.map((r) => [r.plain_text, r.annotations.color]), [['앞', 'purple'], ['뒤', 'default']])
    assert.equal(colorOf(out, a.id), undefined)
  })

  test('★ 블록 선택 — 고른 블록들 · 칠할 수 없는 타입(구분선)은 건너뛴다', () => {
    const a = blk('paragraph', 'a')
    const d = blk('divider')
    const b = blk('quote', 'b')
    const state = stateOf([a, d, b])
    const sel = state.apply(state.tr.setSelection(BlockSelection.create(state.doc, findContainerById(state.doc, a.id)!.pos, findContainerById(state.doc, b.id)!.pos)))
    const { state: out } = run(sel, with_('orange_background'))
    assert.equal(colorOf(out, a.id), 'orange_background')
    assert.equal(colorOf(out, d.id), undefined)
    assert.equal(colorOf(out, b.id), 'orange_background')
  })

  test('키맵의 Mod-Shift-h 가 마지막 색을 다시 쓴다(주입한 기억)', () => {
    const a = blk('paragraph', '글')
    const keymap = createEditorKeymap({ isCollapsed: () => false, lastColor: () => 'pink' })
    const { state } = run(caretAtEnd(stateOf([a]), a.id), keymap['Mod-Shift-h']!)
    assert.equal(colorOf(state, a.id), 'pink')
  })
})

describe('④ 마지막 색의 기억', () => {
  test('저장소가 없어도(서버 · 검사) 이 탭의 기억은 남는다', () => {
    rememberColor('yellow_background')
    assert.equal(lastColor(), 'yellow_background')
    rememberColor('default')
    assert.equal(lastColor(), 'default')
  })
})
