/**
 * Phase 0 편집기의 상태 — `createDocumentState` (DB 없음 · EditorView 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **id 없는 블록을 넣은 편집(붙여넣기)은 되돌리기 한 번에 id 까지 함께 돌아간다** — id 스탬프가 기록을 끄지 않아도
 *      ProseMirror history 는 스탬프를 그 편집과 같은 칸에 묶는다. 스탬프가 기록을 끄던 이유가 사실이 아니었다(`block-id-plugin.ts`)
 *   ② 상태는 편집 스키마 · ProseMirror history 로 열린다 — 협업 편집기와 편집 플러그인 목록이 같다(`editingPlugins`)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { undo } from '@tiptap/pm/history'
import type { EditorState, Transaction } from '@tiptap/pm/state'

import { textRun } from '../contracts/rich-text.ts'
import { createDocumentState, editingPlugins, type EditorDeps } from './create-editor.ts'
import { blockSchema } from './schema.ts'

const DEPS = { isCollapsed: () => false } as unknown as EditorDeps
const ORIGIN_ID = '00000000-0000-4000-8000-000000000001'

function blockIds(state: EditorState): string[] {
  const ids: string[] = []
  state.doc.descendants((node) => {
    if (node.type.name === 'blockContainer') ids.push(String(node.attrs.blockId))
  })
  return ids
}

describe('Phase 0 편집기의 상태', () => {
  test('★ id 없는 블록을 넣은 편집은 id 가 찍히고, 되돌리기 한 번에 함께 돌아가며 남는 칸이 없다', () => {
    let state = createDocumentState({ blocks: [{ id: ORIGIN_ID, type: 'paragraph', title: [textRun('원문')] }] }, DEPS)
    const apply = (tr: Transaction) => {
      state = state.apply(tr)
    }
    const pasted = blockSchema.nodes.blockContainer.create({ blockId: '' }, [
      blockSchema.nodes.paragraph.create({ props: {}, format: {} }, [blockSchema.text('붙인 글')]),
    ])
    apply(state.tr.insert(state.doc.firstChild!.firstChild!.nodeSize + 1, pasted))
    const ids = blockIds(state)
    assert.equal(ids.length, 2)
    assert.ok(ids[1] !== '', '전제: 스탬프가 id 를 찍었다')

    assert.equal(undo(state, apply), true)
    assert.deepEqual(blockIds(state), [ORIGIN_ID], '되돌리기 한 번에 붙여넣기가 돌아가지 않았다')
    assert.equal(undo(state, apply), false, '스탬프가 되돌리기에 따로 한 칸을 남겼다')
  })

  test('편집 스키마 · ProseMirror history 로 열린다 — 편집 플러그인은 협업 편집기와 같은 목록이다', () => {
    const state = createDocumentState({ blocks: [] }, DEPS)
    assert.equal(state.schema, blockSchema)
    const keys = state.plugins.map((plugin) => (plugin as unknown as { key: string }).key)
    assert.ok(keys.some((key) => key.startsWith('history$')), 'ProseMirror history 가 없다')
    const editing = editingPlugins(DEPS).map((plugin) => (plugin as unknown as { key: string }).key.replace(/\$\d*$/, ''))
    for (const key of editing) assert.ok(keys.some((k) => k.replace(/\$\d*$/, '') === key), `편집 플러그인 ${key} 가 없다`)
  })
})
