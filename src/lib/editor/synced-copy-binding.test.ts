/**
 * 사본의 중첩 묶기 — 먼저 증명 (SB-2 · F-01-11 · 정본 [보강 SB-0] ㉮ · DOM 없음)
 *
 * 이 파일이 지키는 것. 실제 `ySyncPlugin` 을 헤드리스로 돌린다(`testing/collab-peers.ts`).
 *
 *   ① A 의 편집기(본문 전체에 묶였다)에서 X 안에 친 글 · 넣은 블록이 사본의 중첩 편집기(X 의 그룹에 묶였다)에 뜬다 — 다른 참여자의 문서로
 *      update 를 건너도(B 의 embed 연결) 같다. X 밖의 편집은 중첩 편집기에 닿지 않는다
 *   ② 고칠 수 있게 묶으면(SB-3 의 길) 중첩 편집기의 편집이 X 의 그룹 안에만 쓰이고 A 의 편집기로 돌아온다 — X 밖(이웃 · X 의 머리)은 그대로
 *   ③ 읽기 전용 묶기는 아무것도 쓰지 않는다 — 로컬 편집을 거르고, 선택 · 원격 편집에도 Y update 가 나지 않는다
 *   ④ 다시 묶기 — 원본을 끌어 옮기면(지우고 다시 넣기) 새 그룹을 알리고, 지우면 null, 같은 id 로 돌아오면 다시 알린다
 *   ⑤ 되돌리기의 범위(SB-3 · ⑧ⓔ) — 같은 페이지의 사본과 바깥 편집기가 X 안을 함께 고쳐도 사본의 Ctrl+Z 는 사본의 편집만, 바깥의 Ctrl+Z 는
 *      바깥의 편집만 되돌린다 · 같은 X 의 사본 둘도 서로의 편집을 되돌리지 않는다
 *   ⑥ 사본의 편집 규칙(SB-3 · ⑧ⓕ) — 스키마가 편집 스키마의 타입 그대로라 분할 · 병합(화면 순서)이 돈다 · 새 블록은 새 id 로 X 안에 ·
 *      문서 전체가 동기화 블록 안이라 동기화 블록을 넣는 편집은 막힌다 · 블록 선택의 Esc 는 바깥으로 나간다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import * as Y from 'yjs'
import { TextSelection } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { yUndoPluginKey } from 'y-prosemirror'

import { SYNCED_BLOCK_TYPE } from '../block/synced-block.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createCollabEditorState } from '../collab/collab-editor.ts'
import { BODY_FRAGMENT, createBodyYDoc } from '../collab/ydoc.ts'
import { bind, exchange, findBlock, headless, peer, type BoundEditor } from '../testing/collab-peers.ts'
import type { EditorDeps } from './create-editor.ts'
import type { EditorBlock } from './document.ts'
import { createEditorKeymap } from './keymap.ts'
import { isBlockSelection } from './block-selection.ts'
import { visibleBlocks } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'
import { excludedAt } from './synced-block.ts'
import { copyKeyHandler, copySchemas, createCopyEditorState, findSyncedGroup, watchSyncedGroup } from './synced-copy-binding.ts'

const P1 = '11111111-1111-4111-8111-000000000001'
const X = '11111111-1111-4111-8111-00000000000a'
const C1 = '11111111-1111-4111-8111-000000000002'
const P2 = '11111111-1111-4111-8111-000000000003'
const COPY = '11111111-1111-4111-8111-000000000004'

function blk(id: string, type: EditorBlock['type'], text = '', children: EditorBlock[] = [], properties: Record<string, unknown> = {}): EditorBlock {
  return { id, type, title: text === '' ? [] : [textRun(text)], properties, format: {}, children }
}

/** 원본 X(자식 C1) 앞뒤에 문단 — 끝에 같은 페이지의 사본 하나. */
function pageA(): Y.Doc {
  const ydoc = createBodyYDoc({
    blocks: [
      blk(P1, 'paragraph', '앞'),
      blk(X, SYNCED_BLOCK_TYPE, '', [blk(C1, 'paragraph', '안')]),
      blk(P2, 'paragraph', '뒤'),
      blk(COPY, SYNCED_BLOCK_TYPE, '', [], { synced_from: X }),
    ],
  })
  ydoc.clientID = 1
  return ydoc
}

const textOf = (doc: PmNode): string => doc.textBetween(0, doc.content.size, '|')

/** 글자의 시작 위치(컨테이너 + 내용 노드 안). */
const textStart = (doc: PmNode, id: string): number => findBlock(doc, id).pos + 2

function typeAt(editor: BoundEditor, id: string, text: string): void {
  const at = textStart(editor.state.doc, id)
  editor.dispatch(editor.state.tr.insertText(text, at))
}

function copyEditor(ydoc: Y.Doc, readOnly: boolean): BoundEditor {
  const group = findSyncedGroup(ydoc, X)
  assert.ok(group, 'X 의 그룹을 찾는다')
  return headless(createCopyEditorState(group, { readOnly }))
}

/** X 의 그룹 밖 — 본문에서 X 의 자식을 비운 모양(이웃 · 머리 · 사본이 그대로인지 견준다). */
function outsideX(ydoc: Y.Doc): string {
  const clone = new Y.Doc()
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(ydoc))
  const group = findSyncedGroup(clone, X)
  if (group !== null) group.delete(0, group.length)
  return clone.getXmlFragment('body').toString()
}

describe('사본의 중첩 묶기 — 증명(SB-2 · ㉮)', () => {
  test('스키마의 최상위가 그룹이다 — 노드 · 마크 명세는 편집 스키마와 같다 · 한 번만 짓는다', () => {
    const copySchema = copySchemas().copy
    assert.equal(copySchemas().copy, copySchema)
    assert.equal(copySchema.topNodeType.name, 'blockGroup')
    assert.deepEqual(Object.keys(copySchema.nodes), Object.keys(blockSchema.nodes))
    assert.deepEqual(Object.keys(copySchema.marks), Object.keys(blockSchema.marks))
    // SB-3(⑧ⓕ) — 타입 그대로다(편집 규칙이 동일성으로 견준다)
    assert.equal(copySchema.nodes.paragraph, blockSchema.nodes.paragraph)
    assert.equal(copySchemas().collab.marks.bold, blockSchema.marks.bold)
  })

  test('① A 의 편집이 사본에 뜬다 — 같은 문서 · 다른 참여자 · X 밖은 닿지 않는다', () => {
    const a = pageA()
    const editorA = bind(a)
    const same = copyEditor(a, true)
    assert.equal(textOf(same.state.doc), '안', '처음 그리기 — X 의 자식만')
    assert.equal(same.state.doc.type.name, 'blockGroup')

    // 다른 참여자(B 의 embed 연결) — update 를 건너 받는다
    const b = peer(a, 2)
    const embed = copyEditor(b, true)

    typeAt(editorA, C1, '쪽 ')
    assert.equal(textOf(same.state.doc), '쪽 안', '같은 문서의 사본')
    exchange(a, b)
    assert.equal(textOf(embed.state.doc), '쪽 안', '다른 참여자의 사본')

    // X 안에 블록을 하나 더 — Enter 와 같은 모양(컨테이너를 그룹 끝에)
    const group = findBlock(editorA.state.doc, C1)
    const after = group.pos + group.node.nodeSize
    const container = blockSchema.nodes.blockContainer.create({ blockId: '11111111-1111-4111-8111-000000000005' }, [
      blockSchema.nodes.paragraph.create({ props: {}, format: {} }, blockSchema.text('둘째')),
    ])
    editorA.dispatch(editorA.state.tr.insert(after, container))
    exchange(a, b)
    assert.equal(textOf(embed.state.doc), '쪽 안|둘째')
    assert.equal(textOf(same.state.doc), '쪽 안|둘째')

    // X 밖 — 사본의 문서가 바뀌지 않는다(같은 객체)
    const before = embed.state.doc
    typeAt(editorA, P1, '맨 ')
    exchange(a, b)
    assert.equal(embed.state.doc, before, 'X 밖의 편집은 중첩 편집기에 닿지 않는다')
    editorA.destroy()
    same.destroy()
    embed.destroy()
  })

  test('② 고칠 수 있게 묶으면 X 의 그룹 안에만 쓰고 A 로 돌아온다(SB-3 의 길)', () => {
    const a = pageA()
    const editorA = bind(a)
    const b = peer(a, 2)
    const nested = copyEditor(b, false)
    const outside = outsideX(b)

    typeAt(nested, C1, '사본에서 ')
    assert.equal(outsideX(b), outside, 'X 밖(이웃 · 머리 · 같은 페이지의 사본)은 그대로')
    exchange(a, b)
    const at = findBlock(editorA.state.doc, C1)
    assert.equal(at.node.textContent, '사본에서 안', 'A 의 편집기로 돌아온다')
    assert.equal(textOf(editorA.state.doc), '앞|사본에서 안|뒤', 'A 의 문서 — X 안에만')
    editorA.destroy()
    nested.destroy()
  })

  test('③ 읽기 전용 묶기는 아무것도 쓰지 않는다 — 로컬 편집 · 선택 · 원격 편집', () => {
    const a = pageA()
    const b = peer(a, 2)
    const writes: unknown[] = []
    b.on('update', (_update: Uint8Array, origin: unknown) => writes.push(origin))
    const nested = copyEditor(b, true)
    assert.equal(writes.length, 0, '처음 그리기는 쓰지 않는다')

    // 로컬 편집 — 걸러진다(문서 그대로)
    const doc = nested.state.doc
    nested.dispatch(nested.state.tr.insertText('몰래 ', textStart(doc, C1)))
    assert.equal(nested.state.doc, doc, '로컬 편집을 거른다')
    // 선택 — 바인딩의 쓰기 길(플러그인 뷰 update)이 없다
    nested.dispatch(nested.state.tr.setSelection(TextSelection.create(nested.state.doc, textStart(doc, C1) + 1)))
    assert.equal(writes.length, 0, '선택이 쓰지 않는다')

    // 원격 편집이 들어와도 이쪽은 아무것도 보태지 않는다 — 받은 update 하나뿐
    const editorA = bind(a)
    typeAt(editorA, C1, '원격 ')
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), 'remote')
    assert.equal(textOf(nested.state.doc), '원격 안')
    assert.deepEqual(writes, ['remote'], '받은 것 외에 쓴 것이 없다')
    // 이 참여자가 서버에 보낼 것이 없다
    assert.equal(Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)).length, Y.encodeStateAsUpdate(new Y.Doc()).length)
    editorA.destroy()
    nested.destroy()
  })

  test('④ 다시 묶기 — 끌어 옮기면 새 그룹 · 지우면 null · 같은 id 로 돌아오면 다시', () => {
    const a = pageA()
    const editorA = bind(a)
    const seen: (Y.XmlElement | null)[] = []
    const stop = watchSyncedGroup(a, X, (group) => seen.push(group))
    assert.equal(seen.length, 1)
    const first = seen[0]
    assert.ok(first)

    // 끌어 옮기기 — y-prosemirror 는 지우고 다시 넣는다(P2 뒤로)
    const x = findBlock(editorA.state.doc, X)
    const moved = x.node
    let tr = editorA.state.tr.delete(x.pos, x.pos + moved.nodeSize)
    const p2 = findBlock(tr.doc, P2)
    tr = tr.insert(p2.pos + p2.node.nodeSize, moved)
    editorA.dispatch(tr)
    assert.equal(seen.length, 2, '그룹이 바뀌었다')
    assert.ok(seen[1] !== null && seen[1] !== first, '새 Y 요소')
    const rebound = headless(createCopyEditorState(seen[1]!, { readOnly: true }))
    assert.equal(textOf(rebound.state.doc), '안', '새 그룹에 묶은 편집기가 같은 내용을 그린다')

    // 지운다 → null(사본은 "원본이 삭제되었다" 자리 · 관찰은 이어 간다)
    const gone = findBlock(editorA.state.doc, X)
    editorA.dispatch(editorA.state.tr.delete(gone.pos, gone.pos + gone.node.nodeSize))
    assert.equal(seen.at(-1), null)
    // X 밖의 편집 — 못 찾는 동안에도 다시 알리지 않는다
    const count = seen.length
    typeAt(editorA, P1, '-')
    assert.equal(seen.length, count)

    // 되돌리기 · 버전 복원처럼 같은 id 로 돌아온다
    const p1 = findBlock(editorA.state.doc, P1)
    editorA.dispatch(editorA.state.tr.insert(p1.pos + p1.node.nodeSize, moved))
    assert.ok(seen.at(-1) instanceof Y.XmlElement, '다시 묶는다')
    stop()
    editorA.destroy()
    rebound.destroy()
  })

  test('사본(원본이 아님) · 없는 id 는 그룹이 없다', () => {
    const a = pageA()
    assert.equal(findSyncedGroup(a, COPY), null, '사본은 원본이 아니다')
    assert.equal(findSyncedGroup(a, '11111111-1111-4111-8111-0000000000ff'), null)
  })
})

// ── SB-3 — 사본에서 고치기 ─────────────────────────────────────────────

/** 노드 뷰 · 업로드는 이 검사에 닿지 않는다(`collab-editor.test.ts` 와 같다). */
const DEPS = {
  isCollapsed: () => false,
  toggleCollapsed: () => undefined,
  openPage: () => undefined,
  pageRefTitle: () => undefined,
  pageIcon: () => null,
  mentionLabel: () => undefined,
  emojiLabel: () => undefined,
  workspaceId: 'ws',
  uploadImage: () => Promise.reject(new Error('검사에서 올리지 않는다')),
} as unknown as EditorDeps

/** 키맵의 되돌리기만 — 사본 둘 검사(편집 규칙 없이 묶었다). */
const DEPS_UNDO = createCollabEditorState(new Y.Doc().getXmlFragment(BODY_FRAGMENT), DEPS).deps

/** 바깥 편집기 — 협업 편집기 상태 그대로(편집 규칙 · 되돌리기). 돌려준 deps 가 화면이 사본에 넘기는 것이다. */
function outerEditor(ydoc: Y.Doc, extra: Partial<EditorDeps> = {}): { editor: BoundEditor; deps: EditorDeps } {
  const { state, deps } = createCollabEditorState(ydoc.getXmlFragment(BODY_FRAGMENT), { ...DEPS, ...extra })
  return { editor: headless(state), deps }
}

function writableCopy(ydoc: Y.Doc, deps?: EditorDeps): BoundEditor {
  const group = findSyncedGroup(ydoc, X)
  assert.ok(group, 'X 의 그룹을 찾는다')
  return headless(createCopyEditorState(group, { readOnly: false, deps }))
}

const press = (editor: BoundEditor, deps: EditorDeps, key: string): boolean => createEditorKeymap(deps)[key]!(editor.state, editor.dispatch)
/** 되돌리기 한 칸을 끊는다 — UndoManager 는 500ms 안의 편집을 한 칸으로 묶는다. */
const separate = (...editors: BoundEditor[]): void => editors.forEach((e) => yUndoPluginKey.getState(e.state)?.undoManager.stopCapturing())
const textIn = (editor: BoundEditor, id: string): string => findBlock(editor.state.doc, id).node.textContent
const keyEvent = (key: string, keyCode: number) =>
  ({ key, keyCode, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false }) as unknown as KeyboardEvent

describe('사본에서 고치기 — 되돌리기 · 편집 규칙(SB-3 · ⑧ⓔⓕ)', () => {
  test('★ ⑤ 같은 페이지 — 사본의 Ctrl+Z 는 사본의 편집만 · 바깥의 Ctrl+Z 는 바깥의 편집만(X 안을 함께 고쳐도)', () => {
    const a = pageA()
    const outer = outerEditor(a)
    const copy = writableCopy(a, outer.deps)

    typeAt(outer.editor, C1, '바깥 ')
    separate(outer.editor, copy)
    typeAt(copy, C1, '사본 ')
    separate(outer.editor, copy)
    typeAt(outer.editor, P1, '밖 ')
    separate(outer.editor, copy)
    assert.equal(textIn(outer.editor, C1), '사본 바깥 안', '같은 문서 — 바깥에 사본의 편집이 보인다')
    assert.equal(textIn(copy, C1), '사본 바깥 안')

    // 바깥 Ctrl+Z 둘 — 바깥의 편집(P1 · X 안)만 돌아간다
    assert.equal(press(outer.editor, outer.deps, 'Mod-z'), true)
    assert.equal(press(outer.editor, outer.deps, 'Mod-z'), true)
    assert.equal(textIn(outer.editor, P1), '앞')
    assert.equal(textIn(outer.editor, C1), '사본 안', '바깥의 되돌리기가 사본의 편집을 남긴다')
    assert.equal(press(outer.editor, outer.deps, 'Mod-z'), false, '바깥에 더 되돌릴 것이 없다')

    // 바깥에서 다시 하고 · 사본 Ctrl+Z — 사본의 편집만
    assert.equal(press(outer.editor, outer.deps, 'Mod-Shift-z'), true)
    separate(outer.editor, copy)
    assert.equal(press(copy, outer.deps, 'Mod-z'), true)
    assert.equal(textIn(copy, C1), '바깥 안', '사본의 되돌리기가 바깥의 편집을 남긴다')
    assert.equal(press(copy, outer.deps, 'Mod-z'), false, '사본에 더 되돌릴 것이 없다')
    assert.equal(textIn(outer.editor, C1), '바깥 안')
    outer.editor.destroy()
    copy.destroy()
  })

  test('⑤ 같은 X 의 사본 둘(같은 embed 문서) — 서로의 편집을 되돌리지 않는다 · A 로 건너간다', () => {
    const a = pageA()
    const b = peer(a, 2)
    const one = writableCopy(b)
    const two = writableCopy(b)
    typeAt(one, C1, '하나 ')
    separate(one, two)
    typeAt(two, C1, '둘 ')
    separate(one, two)
    assert.equal(textIn(one, C1), '둘 하나 안')
    assert.equal(press(one, DEPS_UNDO, 'Mod-z'), true)
    assert.equal(textIn(two, C1), '둘 안', '사본 하나의 되돌리기 — 둘의 편집은 남는다')
    exchange(a, b)
    const editorA = bind(a)
    assert.equal(findBlock(editorA.state.doc, C1).node.textContent, '둘 안')
    one.destroy()
    two.destroy()
    editorA.destroy()
  })

  test('★ ⑥ 편집 규칙 — 분할(새 id · X 안) · 병합(화면 순서) · 동기화 블록을 넣는 편집은 막힌다 · 블록 선택의 Esc 는 바깥으로', () => {
    const a = pageA()
    const notices: string[] = []
    const outer = outerEditor(a, { onNotice: (m: string) => void notices.push(m) })
    const b = peer(a, 2)
    const copy = writableCopy(b, outer.deps)
    const outside = outsideX(b)

    // 분할 — C1 끝에서 Enter
    const end = findBlock(copy.state.doc, C1)
    copy.dispatch(copy.state.tr.setSelection(TextSelection.create(copy.state.doc, end.pos + end.node.nodeSize - 2)))
    assert.equal(press(copy, outer.deps, 'Enter'), true)
    const order = visibleBlocks(copy.state.doc, () => false).order.map((e) => e.node.id)
    assert.equal(order.length, 2, '화면 순서가 루트 그룹을 읽는다')
    const fresh = order[1]!
    assert.ok(fresh !== '' && fresh !== C1, '새 블록이 새 id 를 받았다')
    copy.dispatch(copy.state.tr.insertText('새'))
    assert.equal(outsideX(b), outside, 'X 밖은 그대로')
    exchange(a, b)
    const editorA = bind(a)
    assert.equal(textOf(editorA.state.doc), '앞|안|새|뒤', 'A 의 X 안에 새 블록')

    // 병합 — 새 블록의 맨 앞에서 Backspace(이웃을 화면 순서로 찾는다)
    const freshAt = findBlock(copy.state.doc, fresh)
    copy.dispatch(copy.state.tr.setSelection(TextSelection.create(copy.state.doc, freshAt.pos + 2)))
    assert.equal(press(copy, outer.deps, 'Backspace'), true)
    assert.equal(textOf(copy.state.doc), '안새')

    // 문서 전체가 동기화 블록 안 — 사본을 넣는 편집은 거른다(SY5)
    assert.equal(excludedAt(copy.state.doc.resolve(1)).has(SYNCED_BLOCK_TYPE), true)
    const before = copy.state.doc
    const nestedCopy = blockSchema.nodes.blockContainer.create({ blockId: '11111111-1111-4111-8111-0000000000c1' }, [
      blockSchema.nodes[SYNCED_BLOCK_TYPE]!.create({ props: { synced_from: X }, format: {} }),
    ])
    copy.dispatch(copy.state.tr.insert(copy.state.doc.content.size, nestedCopy))
    assert.equal(copy.state.doc, before, '사본 안에 동기화 블록을 넣지 못한다')
    assert.ok(notices.length > 0, '까닭을 알린다')

    // Esc — 글자 선택이면 사본 안의 블록 선택 · 블록 선택이면 바깥으로 나간다
    let left = 0
    const keys = copyKeyHandler(outer.deps, () => (left += 1))
    const view = { get state() { return copy.state }, dispatch: copy.dispatch, composing: false } as unknown as EditorView
    assert.equal(keys(view, keyEvent('Escape', 27)), true)
    assert.equal(isBlockSelection(copy.state.selection), true, '사본 안의 블록 선택')
    assert.equal(left, 0)
    assert.equal(keys(view, keyEvent('Escape', 27)), true)
    assert.equal(left, 1, '바깥 편집기에서 사본 블록을 고른다')
    outer.editor.destroy()
    copy.destroy()
    editorA.destroy()
  })
})
