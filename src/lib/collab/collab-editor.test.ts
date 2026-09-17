/**
 * 협업 편집기의 상태 — CRDT 6a조각 (DB 없음 · EditorView 없음)
 *
 * 이 파일이 지키는 것. 조립된 상태(`createCollabEditorState`)를 헤드리스로 돌린다(`testing/collab-peers.ts` `headless`).
 *
 *   ① **편집 키가 Y.Doc 에 쓰이고 다른 참여자도 같은 문서를 본다** — 분할 · 들여쓰기 · 병합 · 서식. 스키마는 파사드다
 *   ② **Mod-z 는 내 편집만 되돌린다**(F-05-15) — 다른 참여자의 편집은 남고, Mod-Shift-z 로 다시 한다
 *   ③ **id 없는 블록을 넣은 편집(붙여넣기)도 되돌리기 한 번에 돌아간다** — id 스탬프가 되돌리기 기록을 끄지 않는다(HANDOFF §3.2-15 ④)
 *   ④ **수선이 오기 전 스키마를 어긴 문서에서 키가 던지지 않는다** — 문서는 그대로이고, 수선을 받은 뒤에는 같은 키가 동작한다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import * as Y from 'yjs'
import { TextSelection } from '@tiptap/pm/state'
import { yUndoPluginKey } from 'y-prosemirror'

import type { EditorDeps } from '../editor/create-editor.ts'
import type { EditorDoc } from '../editor/document.ts'
import { createEditorKeymap, createKeydownHandler } from '../editor/keymap.ts'
import { blockSchema } from '../editor/schema.ts'
import { exchange, findBlock, headless, peer, type BoundEditor } from '../testing/collab-peers.ts'
import { mergedPeer, paragraph, violationScenes } from '../testing/collab-scenarios.ts'
import { collabSchema } from './collab-schema.ts'
import { createCollabEditorState } from './collab-editor.ts'
import { repairBodyYDoc } from './repair.ts'
import { BODY_FRAGMENT, createBodyYDoc, readBodyYDoc } from './ydoc.ts'

const PAGE = '11111111-1111-4111-8111-111111111111'

/** 노드 뷰 · 업로드는 이 검사에 닿지 않는다. */
const DEPS = {
  isCollapsed: () => false,
  toggleCollapsed: () => undefined,
  openPage: () => undefined,
  pageRefTitle: () => undefined,
  workspaceId: 'ws',
  uploadImage: () => Promise.reject(new Error('검사에서 올리지 않는다')),
} as unknown as EditorDeps

type Participant = { readonly ydoc: Y.Doc; readonly editor: BoundEditor; readonly deps: EditorDeps }

function participant(base: Y.Doc, clientId: number): Participant {
  const ydoc = peer(base, clientId)
  const { state, deps } = createCollabEditorState(ydoc.getXmlFragment(BODY_FRAGMENT), DEPS)
  return { ydoc, editor: headless(state), deps }
}

/** 키맵의 그 키를 누른다 — 키 이름은 `createEditorKeymap` 의 이름이다. */
function press({ editor, deps }: Participant, key: string): boolean {
  const command = createEditorKeymap(deps)[key]
  assert.ok(command !== undefined, `키맵에 ${key} 가 없다`)
  return command(editor.state, editor.dispatch)
}

function caret({ editor }: Participant, blockId: string, offset: number): void {
  const at = findBlock(editor.state.doc, blockId).pos + 2 + offset
  editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)))
}

/** 되돌리기 한 칸을 끊는다 — UndoManager 는 500ms 안의 편집을 한 칸으로 묶는다. */
const separate = ({ editor }: Participant): void => yUndoPluginKey.getState(editor.state)?.undoManager.stopCapturing()

/** 문서를 `글자(자식…)` 꼴로. */
function shape(doc: EditorDoc): string {
  const walk = (blocks: EditorDoc['blocks']): string =>
    blocks
      .map((b) => {
        const text = b.title.map((r) => r.plain_text).join('')
        return b.children?.length ? `${text}(${walk(b.children)})` : text
      })
      .join(' ')
  return walk(doc.blocks)
}

describe('① 편집 키가 Y.Doc 에 쓰인다', () => {
  test('★ 분할 · 들여쓰기 · 병합 · 서식이 Y.Doc 에 쓰이고 다른 참여자도 같은 문서다 — 상태의 스키마는 파사드다', () => {
    const [a, b] = [paragraph('가나다라'), paragraph('옆')]
    const base = createBodyYDoc({ blocks: [a, b] })
    const [me, other] = [participant(base, 10), participant(base, 11)]
    assert.equal(me.editor.state.schema, collabSchema, '상태의 스키마가 파사드가 아니다 — 바인딩이 Y 요소를 지울 수 있다')

    caret(me, a.id, 2)
    assert.equal(press(me, 'Enter'), true)
    assert.equal(press(me, 'Tab'), true)
    exchange(me.ydoc, other.ydoc)
    assert.equal(shape(readBodyYDoc(other.ydoc, PAGE).doc), '가나(다라) 옆')

    caret(me, b.id, 0)
    assert.equal(press(me, 'Backspace'), true)
    const from = findBlock(me.editor.state.doc, a.id).pos + 2
    me.editor.dispatch(me.editor.state.tr.setSelection(TextSelection.create(me.editor.state.doc, from, from + 2)))
    assert.equal(press(me, 'Mod-b'), true)
    exchange(me.ydoc, other.ydoc)

    const read = readBodyYDoc(other.ydoc, PAGE)
    assert.deepEqual(read.fixes, [], '편집이 스키마를 어긴 Y.Doc 을 만들었다')
    assert.deepEqual(read, readBodyYDoc(me.ydoc, PAGE))
    assert.equal(shape(read.doc), '가나(다라옆)')
    assert.deepEqual(read.doc.blocks[0].title[0]?.annotations.bold, true, '서식이 Y.Doc 에 실리지 않았다')
    assert.deepEqual(shape(readBodyYDoc(other.ydoc, PAGE).doc), shape(readBodyYDoc(me.ydoc, PAGE).doc))
  })
})

describe('② 되돌리기는 내 편집만 (F-05-15)', () => {
  test('★ Mod-z 는 내가 친 글자만 되돌리고 다른 참여자의 글자는 남긴다 — Mod-Shift-z 로 다시 한다', () => {
    const [mine, theirs] = [paragraph('내 문단'), paragraph('남 문단')]
    const base = createBodyYDoc({ blocks: [mine, theirs] })
    const [me, other] = [participant(base, 20), participant(base, 21)]

    caret(me, mine.id, 0)
    me.editor.dispatch(me.editor.state.tr.insertText('내가 '))
    separate(me)
    caret(other, theirs.id, 0)
    other.editor.dispatch(other.editor.state.tr.insertText('남이 '))
    exchange(me.ydoc, other.ydoc)
    assert.equal(shape(readBodyYDoc(me.ydoc, PAGE).doc), '내가 내 문단 남이 남 문단')

    assert.equal(press(me, 'Mod-z'), true)
    exchange(me.ydoc, other.ydoc)
    assert.equal(shape(readBodyYDoc(other.ydoc, PAGE).doc), '내 문단 남이 남 문단', '다른 참여자의 편집까지 되돌렸거나 내 편집을 못 되돌렸다')

    assert.equal(press(me, 'Mod-Shift-z'), true)
    exchange(me.ydoc, other.ydoc)
    assert.equal(shape(readBodyYDoc(other.ydoc, PAGE).doc), '내가 내 문단 남이 남 문단')
  })
})

describe('③ id 스탬프와 되돌리기 (§3.2-15 ④)', () => {
  test('★ id 없는 블록을 넣은 편집(붙여넣기)도 되돌리기 한 번에 돌아간다 — id 스탬프가 기록을 끄지 않는다', () => {
    const origin = paragraph('원문')
    const base = createBodyYDoc({ blocks: [origin] })
    const me = participant(base, 30)
    separate(me)

    const pasted = blockSchema.nodes.blockContainer.create({ blockId: '' }, [
      blockSchema.nodes.paragraph.create({ props: {}, format: {} }, [blockSchema.text('붙인 글')]),
    ])
    const { pos, node } = findBlock(me.editor.state.doc, origin.id)
    me.editor.dispatch(me.editor.state.tr.insert(pos + node.nodeSize, pasted))
    const afterPaste = readBodyYDoc(me.ydoc, PAGE)
    assert.equal(shape(afterPaste.doc), '원문 붙인 글')
    assert.deepEqual(afterPaste.fixes, [], '전제: 스탬프가 id 를 찍었다')

    assert.equal(press(me, 'Mod-z'), true, '붙여넣기가 되돌리기 기록에 없다 — id 스탬프가 그 갱신의 기록을 껐다')
    assert.equal(shape(readBodyYDoc(me.ydoc, PAGE).doc), '원문')
  })
})

describe('④ 수선이 오기 전 스키마를 어긴 문서', () => {
  test('★ 타입이 동시에 바뀐 블록 뒤의 Backspace 는 던지지 않고 문서를 그대로 둔다 — 수선을 받은 뒤에는 병합한다', () => {
    const scene = violationScenes().find((s) => s.fix === 'type_conflict_resolved')
    assert.ok(scene !== undefined)
    const ydoc = mergedPeer(scene, 40)
    const { state, deps } = createCollabEditorState(ydoc.getXmlFragment(BODY_FRAGMENT), DEPS)
    const editor = headless(state)
    const me: Participant = { ydoc, editor, deps }
    const keydown = createKeydownHandler(deps)
    const backspace = { key: 'Backspace', keyCode: 8, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false } as unknown as KeyboardEvent
    const before = Buffer.from(Y.encodeStateAsUpdate(ydoc))
    assert.ok(readBodyYDoc(ydoc, PAGE).fixes.includes('type_conflict_resolved'), '전제: 수선 전이다')

    caret(me, scene.bystander, 0)
    assert.equal(keydown({ composing: false, state: editor.state, dispatch: editor.dispatch }, backspace), true, '키를 삼키지 않았다')
    assert.ok(Buffer.from(Y.encodeStateAsUpdate(ydoc)).equals(before), '던진 명령이 문서를 바꿨다')

    // 수선이 도착한다 — 로그 저장소가 고친 것을 받는다.
    const server = mergedPeer(scene, 41)
    const repaired = repairBodyYDoc(server, PAGE)
    assert.ok(repaired.kind === 'repaired')
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(server, Y.encodeStateVector(ydoc)))
    assert.deepEqual(readBodyYDoc(ydoc, PAGE).fixes, [])

    caret(me, scene.bystander, 0)
    const blocksBefore = readBodyYDoc(ydoc, PAGE).doc.blocks.length
    assert.equal(keydown({ composing: false, state: editor.state, dispatch: editor.dispatch }, backspace), true)
    assert.equal(readBodyYDoc(ydoc, PAGE).doc.blocks.length, blocksBefore - 1, '수선 뒤의 Backspace 가 병합하지 않았다')
  })
})
