/**
 * 이미지 블록의 편집 명령 — 대체 텍스트 쓰기 (10d-1b · F-12-13)
 *
 *   ① ★ 쓴다 — 형식의 두 키 · 모르는 형식 키는 그대로 · 지금 값을 읽는다
 *   ② 같은 값이면 쓰지 않는다 · 비우면 키를 지운다
 *   ③ 이미지가 아니거나 없는 블록이면 거절
 *   ④ ★ 다른 타입으로 바뀌면 대체 텍스트의 두 키가 사라진다(`normalizeFormat`)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@tiptap/pm/state'

import { textRun } from '../contracts/rich-text.ts'
import { docToPm } from './pm-adapter.ts'
import { blockSchema } from './schema.ts'
import { findContainerById } from './pm-blocks.ts'
import { imageBlockInfo, setImageAltCommand } from './image-block.ts'
import { normalizeFormat } from '../block/types.ts'

const IMAGE = '0190a3f1-1111-7000-8000-000000000001'
const PARA = '0190a3f1-1111-7000-8000-000000000002'

function stateWith(format: Record<string, unknown>): EditorState {
  const doc = docToPm({
    blocks: [
      { id: IMAGE, type: 'image', title: [], properties: { source: { type: 'external', url: 'https://example.com/a.png' } }, format, children: [] },
      { id: PARA, type: 'paragraph', title: [textRun('글')], properties: {}, format: {}, children: [] },
    ],
  })
  return EditorState.create({ schema: blockSchema, doc })
}

const formatOf = (state: EditorState) => findContainerById(state.doc, IMAGE)!.contentNode.attrs.format as Record<string, unknown>

const run = (state: EditorState, command: ReturnType<typeof setImageAltCommand>) => {
  let next = state
  const ok = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { ok, next }
}

test('① ★ 쓴다 — 모르는 형식 키는 그대로 · 지금 값을 읽는다', () => {
  const state = stateWith({ future_key: 'kept' })
  const { ok, next } = run(state, setImageAltCommand(IMAGE, { text: '고양이 사진', decorative: false }))
  assert.equal(ok, true)
  assert.deepEqual(formatOf(next), { future_key: 'kept', alt_text: '고양이 사진' })
  assert.deepEqual(imageBlockInfo(next, IMAGE)?.alt, { text: '고양이 사진', decorative: false })
  const decorative = run(next, setImageAltCommand(IMAGE, { text: '', decorative: true }))
  assert.deepEqual(formatOf(decorative.next), { future_key: 'kept', alt_decorative: true })
})

test('② 같은 값이면 쓰지 않는다 · 비우면 키를 지운다', () => {
  const state = stateWith({ alt_text: '말' })
  assert.equal(run(state, setImageAltCommand(IMAGE, { text: '말', decorative: false })).ok, false)
  const cleared = run(state, setImageAltCommand(IMAGE, { text: '  ', decorative: false }))
  assert.equal(cleared.ok, true)
  assert.deepEqual(formatOf(cleared.next), {})
})

test('③ 이미지가 아니거나 없는 블록이면 거절', () => {
  const state = stateWith({})
  assert.equal(imageBlockInfo(state, PARA), null)
  assert.equal(run(state, setImageAltCommand(PARA, { text: '말', decorative: false })).ok, false)
  assert.equal(run(state, setImageAltCommand('0190a3f1-1111-7000-8000-00000000ffff', { text: '말', decorative: false })).ok, false)
})

test('④ ★ 다른 타입으로 바뀌면 대체 텍스트의 두 키가 사라진다', () => {
  assert.deepEqual(normalizeFormat('paragraph', { alt_text: '말', alt_decorative: true, future_key: 1 }), { future_key: 1 })
  assert.deepEqual(normalizeFormat('image', { alt_text: '말', alt_decorative: true }), { alt_text: '말', alt_decorative: true })
})
