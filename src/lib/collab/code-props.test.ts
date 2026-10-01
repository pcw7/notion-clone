/**
 * 코드 블록의 속성 — 협업 경로 (잔여 묶음 8a-2 · Y.Doc · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 되돌리기 — 글자를 친 바로 뒤에 언어 · 줄바꿈 · 캡션을 바꿔도 Mod+Z 한 번은 그것만 되돌린다(`separateUndoStep` — 협업
 *      편집기는 500ms 안의 편집을 한 칸으로 묶는다)
 *   ② ★ 모양이 틀린 캡션(`[null]` · plain_text 가 문자열이 아닌 런)을 참여자가 써도 읽기가 던지지 않고, 수선이 Y.Doc 을 고친다
 *      (`invalid_props_dropped` — 정본 §3.4 [보강] 코드 블록 ⑧)
 *   ③ 한 블록의 언어와 캡션을 두 사람이 동시에 바꾸면 한쪽이 진다 — props 가 attr 하나다(정본 ⑦). 두 참여자는 같은 문서로 수렴한다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type * as Y from 'yjs'
import { yUndoPluginKey } from 'y-prosemirror'

import { textRun } from '../contracts/rich-text.ts'
import { setCodeWrapSelectionCommand } from '../editor/block-menu.ts'
import { BlockSelection } from '../editor/block-selection.ts'
import { setCodeCaptionCommand, setCodeLanguageCommand, setCodeWrapCommand } from '../editor/code-block.ts'
import type { EditorDeps } from '../editor/create-editor.ts'
import type { EditorBlock } from '../editor/document.ts'
import { createEditorKeymap } from '../editor/keymap.ts'
import { findContainerById } from '../editor/pm-blocks.ts'
import { exchange, headless, peer, type BoundEditor } from '../testing/collab-peers.ts'
import { createCollabEditorState } from './collab-editor.ts'
import { repairBodyYDoc } from './repair.ts'
import { BODY_FRAGMENT, createBodyYDoc, readBodyYDoc } from './ydoc.ts'

const PAGE = '22222222-2222-4222-8222-222222222222'
const CODE_ID = '33333333-3333-4333-8333-333333333333'

const DEPS = {
  isCollapsed: () => false,
  toggleCollapsed: () => undefined,
  openPage: () => undefined,
  pageRefTitle: () => undefined,
  mentionLabel: () => undefined,
  openCodeLanguageMenu: () => undefined,
  openCodeCaption: () => undefined,
  workspaceId: 'ws',
  uploadImage: () => Promise.reject(new Error('검사에서 올리지 않는다')),
} as unknown as EditorDeps

type Participant = { readonly ydoc: Y.Doc; readonly editor: BoundEditor; readonly deps: EditorDeps }

function participant(base: Y.Doc, clientId: number): Participant {
  const ydoc = peer(base, clientId)
  const { state, deps } = createCollabEditorState(ydoc.getXmlFragment(BODY_FRAGMENT), DEPS)
  // 묶기 창을 크게 고정한다 — 되돌리기 칸을 끊는 것(`separateUndoStep`)이 없으면 시간과 상관없이 늘 묶인다(8a-2 리뷰 · 500ms 창에
  // 기대면 느린 기계에서 반사실이 떨어지지 않을 수 있다).
  const manager = (yUndoPluginKey.getState(state) as { undoManager?: { captureTimeout: number } } | undefined)?.undoManager
  if (manager) manager.captureTimeout = 1e9
  return { ydoc, editor: headless(state), deps }
}

const codeBlock = (text: string, properties: Record<string, unknown> = {}): EditorBlock => ({
  id: CODE_ID,
  type: 'code',
  title: [textRun(text)],
  properties,
  format: {},
  children: [],
})

const codeOf = (ydoc: Y.Doc) => readBodyYDoc(ydoc, PAGE).doc.blocks.find((b) => b.id === CODE_ID)

describe('① 되돌리기', () => {
  for (const [name, command, changed] of [
    ['언어', setCodeLanguageCommand(CODE_ID, 'python'), (b?: EditorBlock) => b?.properties?.language === 'python'],
    ['줄바꿈', setCodeWrapCommand(CODE_ID, true), (b?: EditorBlock) => b?.format?.code_wrap === true],
    ['캡션', setCodeCaptionCommand(CODE_ID, '설명'), (b?: EditorBlock) => Array.isArray(b?.properties?.caption)],
  ] as const) {
    test(`★ ${name} — 글자를 친 바로 뒤에 바꿔도 Mod+Z 한 번은 그것만 되돌린다`, () => {
      const base = createBodyYDoc({ blocks: [codeBlock('ab')] })
      const a = participant(base, 11)
      const info = findContainerById(a.editor.state.doc, CODE_ID)
      assert.ok(info)
      // 글자 하나 — 곧바로(500ms 안) 속성을 바꾼다.
      a.editor.dispatch(a.editor.state.tr.insertText('c', info.contentPos + 1 + 2))
      assert.ok(command(a.editor.state, a.editor.dispatch))
      assert.ok(changed(codeOf(a.ydoc)), '전제: 바뀌지 않았다')

      const undo = createEditorKeymap(a.deps)['Mod-z']
      assert.ok(undo)
      assert.ok(undo(a.editor.state, a.editor.dispatch))
      const after = codeOf(a.ydoc)
      assert.equal(changed(after), false, `되돌아가지 않았다: ${name}`)
      assert.equal(after?.title.map((r) => r.plain_text).join(''), 'abc', `친 글자까지 함께 되돌렸다 — 되돌리기 칸이 묶였다: ${name}`)
    })
  }
})

describe('① 되돌리기 — 블록 메뉴', () => {
  test('★ 블록 메뉴의 줄바꿈 — 글자를 친 바로 뒤여도 Mod+Z 한 번은 줄바꿈만 되돌린다', () => {
    const base = createBodyYDoc({ blocks: [codeBlock('ab')] })
    const a = participant(base, 13)
    const info = findContainerById(a.editor.state.doc, CODE_ID)
    assert.ok(info)
    a.editor.dispatch(a.editor.state.tr.insertText('c', info.contentPos + 1 + 2))
    const now = findContainerById(a.editor.state.doc, CODE_ID)
    assert.ok(now)
    a.editor.dispatch(a.editor.state.tr.setSelection(BlockSelection.create(a.editor.state.doc, now.pos, now.pos)))
    assert.ok(setCodeWrapSelectionCommand(true)(a.editor.state, a.editor.dispatch))
    assert.equal(codeOf(a.ydoc)?.format?.code_wrap, true, '전제: 켜지지 않았다')

    const undo = createEditorKeymap(a.deps)['Mod-z']
    assert.ok(undo)
    assert.ok(undo(a.editor.state, a.editor.dispatch))
    const after = codeOf(a.ydoc)
    assert.equal(after?.format?.code_wrap, undefined, '줄바꿈이 되돌아가지 않았다')
    assert.equal(after?.title.map((r) => r.plain_text).join(''), 'abc', '친 글자까지 함께 되돌렸다')
  })
})

describe('① 되돌리기 — 뒤쪽', () => {
  test('★ 속성을 바꾼 바로 뒤에 친 글자는 따로 — Mod+Z 한 번은 그 글자만 되돌리고 언어는 남는다', () => {
    const base = createBodyYDoc({ blocks: [codeBlock('ab')] })
    const a = participant(base, 12)
    assert.ok(setCodeLanguageCommand(CODE_ID, 'python')(a.editor.state, a.editor.dispatch))
    const info = findContainerById(a.editor.state.doc, CODE_ID)
    assert.ok(info)
    // 곧바로(500ms 안) 글자 하나.
    a.editor.dispatch(a.editor.state.tr.insertText('c', info.contentPos + 1 + 2))

    const undo = createEditorKeymap(a.deps)['Mod-z']
    assert.ok(undo)
    assert.ok(undo(a.editor.state, a.editor.dispatch))
    const after = codeOf(a.ydoc)
    assert.equal(after?.title.map((r) => r.plain_text).join(''), 'ab', '친 글자가 되돌아가지 않았다')
    assert.equal(after?.properties?.language, 'python', '언어까지 함께 되돌렸다 — 되돌리기 칸이 묶였다')
  })
})

describe('② 모양이 틀린 캡션', () => {
  test('★ 참여자가 caption [null] 을 써도 읽기는 던지지 않고 · 수선이 Y.Doc 을 고친다', () => {
    const base = createBodyYDoc({ blocks: [codeBlock('x')] })
    const a = participant(base, 21)
    const info = findContainerById(a.editor.state.doc, CODE_ID)
    assert.ok(info)
    // 명령을 거치지 않은 참여자 — 검증 없이 무엇이든 쓸 수 있다.
    const hostile = { ...textRun('살아남음'), plain_text: { toString: 0 } }
    a.editor.dispatch(
      a.editor.state.tr.setNodeMarkup(info.contentPos, undefined, {
        ...info.contentNode.attrs,
        props: { caption: [null, hostile], language: 42 },
        format: { code_wrap: 'yes' },
      }),
    )

    let read: ReturnType<typeof readBodyYDoc> | undefined
    assert.doesNotThrow(() => {
      read = readBodyYDoc(a.ydoc, PAGE)
    })
    assert.ok(read?.fixes.includes('invalid_props_dropped'), JSON.stringify(read?.fixes))
    const block = read?.doc.blocks.find((b) => b.id === CODE_ID)
    assert.deepEqual(block?.properties, { caption: [{ ...hostile, plain_text: '살아남음' }] })
    assert.deepEqual(block?.format, {})

    const repaired = repairBodyYDoc(a.ydoc, PAGE)
    assert.equal(repaired.kind, 'repaired', JSON.stringify(repaired))
    assert.deepEqual(readBodyYDoc(a.ydoc, PAGE).fixes, [], '수선 뒤에도 고칠 것이 남았다')
  })
})

describe('③ 동시에', () => {
  test('한 블록의 언어와 캡션을 동시에 바꾸면 한쪽이 진다 — 두 참여자는 같은 문서로 수렴한다(정본 ⑦)', () => {
    const base = createBodyYDoc({ blocks: [codeBlock('x')] })
    const a = participant(base, 31)
    const b = participant(base, 32)
    assert.ok(setCodeLanguageCommand(CODE_ID, 'python')(a.editor.state, a.editor.dispatch))
    assert.ok(setCodeCaptionCommand(CODE_ID, '설명')(b.editor.state, b.editor.dispatch))
    exchange(a.ydoc, b.ydoc)

    const fromA = codeOf(a.ydoc)
    const fromB = codeOf(b.ydoc)
    assert.deepEqual(fromA, fromB, '두 참여자가 다른 문서를 본다')
    const hasLanguage = fromA?.properties?.language === 'python'
    const hasCaption = Array.isArray(fromA?.properties?.caption)
    assert.notEqual(hasLanguage, hasCaption, 'props 통째 LWW 가 아니다 — 정본 ⑦ 을 고쳐야 한다')
  })
})
