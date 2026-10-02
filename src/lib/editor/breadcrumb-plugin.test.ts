/**
 * breadcrumb 플러그인 — 잔여 묶음 8b-2 (F-01-16 · 실제 ProseMirror 상태 위에서 · DOM 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ breadcrumb 노드마다 노드 데코레이션 — spec.breadcrumb 이 편집기를 만들 때 받은 경로 · 속성은 비었다
 *   ② ★ 새 경로는 메타 트랜잭션으로 — 문서를 바꾸지 않는다 · 내용이 같은 새 배열이면 **지난 객체**를 둔다(노드 뷰가 다시 그리지 않는다)
 *   ③ ★ 다른 블록을 고쳐도 · 루트를 통째로 갈아 끼워도 데코레이션이 같다(같은 경로 객체)
 *   ④ breadcrumb 이 없으면 데코레이션이 없다 · 경로를 아직 모르면 spec 이 null
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@tiptap/pm/state'
import { Slice } from '@tiptap/pm/model'
import { DecorationSet } from '@tiptap/pm/view'

import { BREADCRUMB_TYPE, breadcrumbTrail, type BreadcrumbTrail } from '../block/breadcrumb.ts'
import type { BlockType } from '../block/types.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from './document.ts'
import { docToPm } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'
import { breadcrumbFrom, breadcrumbPlugin, breadcrumbState, setBreadcrumbTrail } from './breadcrumb-plugin.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const blk = (type: string, text = '', children: EditorBlock[] = []): EditorBlock => ({
  id: nextId(), type: type as BlockType, title: text === '' ? [] : [textRun(text)], properties: {}, format: {}, children,
})
const WS = '00000000-0000-4000-8000-0000000000aa'
const trailOf = (title: string): BreadcrumbTrail =>
  breadcrumbTrail({ workspaceId: WS, teamspace: null, ancestors: [{ id: nextId(), plainTitle: '상위' }], page: { id: '00000000-0000-4000-8000-0000000000cc', plainTitle: title } })

function stateOf(blocks: EditorBlock[], trail: BreadcrumbTrail | null): EditorState {
  return EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }), plugins: [breadcrumbPlugin(() => trail)] })
}
const decos = (state: EditorState) => breadcrumbState(state).set.find()

describe('① 데코레이션', () => {
  test('★ breadcrumb 노드마다 — spec.breadcrumb 은 만들 때 받은 경로 · 범위는 내용 노드 · 속성은 비었다', () => {
    const crumb = blk(BREADCRUMB_TYPE)
    const trail = trailOf('이 페이지')
    const state = stateOf([blk('paragraph', '앞'), crumb, blk('toggle', '토글', [blk(BREADCRUMB_TYPE)])], trail)
    const found = decos(state)
    assert.equal(found.length, 2, '토글 안의 breadcrumb 까지')
    const info = findContainerById(state.doc, crumb.id)!
    assert.equal(found[0].from, info.contentPos)
    assert.equal(found[0].to, info.contentPos + info.contentNode.nodeSize)
    assert.equal(breadcrumbFrom(found), trail)
    assert.deepEqual((found[0] as unknown as { type: { attrs: object } }).type.attrs, {})
  })
})

describe('② 새 경로', () => {
  test('★ 메타로 새 경로 — 문서는 그대로 · 데코레이션이 달라진다', () => {
    let state = stateOf([blk(BREADCRUMB_TYPE)], trailOf('옛 제목'))
    const before = decos(state)[0]
    const next = trailOf('새 제목')
    state = state.apply(setBreadcrumbTrail(state.tr, next))
    assert.equal(breadcrumbState(state).trail, next)
    assert.ok(!decos(state)[0].eq(before), '같은 데코레이션으로 본다 — 노드 뷰가 다시 그리지 않는다')
    assert.equal(breadcrumbFrom(decos(state)), next)
  })

  test('★ 내용이 같은 새 배열이면 지난 객체를 둔다 — 상태도 데코레이션도 그대로', () => {
    const input = { workspaceId: WS, teamspace: null, ancestors: [{ id: nextId(), plainTitle: '상위' }], page: { id: nextId(), plainTitle: '여기' } }
    const first = breadcrumbTrail(input)
    const state = stateOf([blk(BREADCRUMB_TYPE)], first)
    const again = state.apply(setBreadcrumbTrail(state.tr, breadcrumbTrail(input)))
    assert.equal(breadcrumbState(again), breadcrumbState(state), '같은 경로에 상태를 새로 지었다')
    assert.equal(breadcrumbFrom(decos(again)), first)
  })
})

describe('③ 문서가 바뀌어도', () => {
  test('★ 다른 블록을 고치면 데코레이션이 같다 — 같은 경로 객체', () => {
    const p = blk('paragraph', '문단')
    let state = stateOf([blk(BREADCRUMB_TYPE), p], trailOf('여기'))
    const before = decos(state)[0]
    state = state.apply(state.tr.insertText('더', findContainerById(state.doc, p.id)!.contentPos + 1))
    assert.ok(decos(state)[0].eq(before))
  })

  test('★ 루트를 통째로 갈아 끼워도(y-prosemirror 의 원격 변경) 데코레이션이 남는다', () => {
    const state = stateOf([blk('paragraph', 'a'), blk(BREADCRUMB_TYPE)], trailOf('여기'))
    const before = decos(state)[0]
    const replaced = state.apply(state.tr.replace(0, state.doc.content.size, new Slice(state.doc.content, 0, 0)))
    assert.equal(decos(replaced).length, 1)
    assert.ok(decos(replaced)[0].eq(before))
  })
})

describe('④ 없을 때', () => {
  test('breadcrumb 이 없으면 데코레이션이 없다 · 경로를 아직 모르면 spec 이 null', () => {
    assert.equal(breadcrumbState(stateOf([blk('paragraph', 'a')], trailOf('여기'))).set, DecorationSet.empty)
    const unknown = stateOf([blk(BREADCRUMB_TYPE)], null)
    assert.equal(decos(unknown).length, 1)
    assert.equal(breadcrumbFrom(decos(unknown)), null)
    assert.equal(breadcrumbFrom([]), undefined)
  })
})
