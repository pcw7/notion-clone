/**
 * ProseMirror 변경을 Y.Doc 본문에 쓰기 — CRDT 4a조각 (DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **바꾼 것만 쓴다** — 문서가 그대로면 Y.Doc 을 한 바이트도 바꾸지 않는다
 *   ② **서식 거울을 거친다** — 멘션에 건 굵게가 Y.Doc 에 실린다(`editor/atom-marks.ts`)
 *   ③ **구조 위반이 있어도 지우지 않는다** — 위반과 상관없는 블록을 고칠 수 있다(`collabSchema`)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'

import { textRun, type RichTextRun } from '../contracts/rich-text.ts'
import { blockSchema } from '../editor/schema.ts'
import { findBlock } from '../testing/collab-peers.ts'
import { mergedPeer, paragraph, violationScenes } from '../testing/collab-scenarios.ts'
import { writeEditorChange } from './body-edit.ts'
import { createBodyYDoc, readBodyYDoc } from './ydoc.ts'

const PAGE = randomUUID()
const bytes = (ydoc: Y.Doc): Buffer => Buffer.from(Y.encodeStateAsUpdate(ydoc))

describe('writeEditorChange', () => {
  test('★ 문서를 바꾸지 않는 변경은 Y.Doc 을 건드리지 않는다', () => {
    const ydoc = createBodyYDoc({ blocks: [paragraph('그대로')] })
    const before = bytes(ydoc)
    const updates: Uint8Array[] = []
    ydoc.on('update', (u: Uint8Array) => void updates.push(u))
    writeEditorChange(ydoc, () => {}, 'test')
    assert.equal(updates.length, 0)
    assert.ok(bytes(ydoc).equals(before))
  })

  test('★ 멘션에 건 굵게가 Y.Doc 에 실린다 — 서식 거울을 거친다', () => {
    const mention: RichTextRun = {
      type: 'mention',
      annotations: { ...textRun('').annotations },
      plain_text: '@누군가',
      href: null,
      mention: { type: 'user', user: { id: randomUUID() } } as RichTextRun['mention'],
    }
    const block = { ...paragraph(''), title: [textRun('앞 '), mention] }
    const ydoc = createBodyYDoc({ blocks: [block] })
    writeEditorChange(
      ydoc,
      (tr, doc) => {
        const start = findBlock(doc, block.id).pos + 2
        tr.addMark(start + 2, start + 3, blockSchema.marks.bold.create())
      },
      'test',
    )
    assert.equal(readBodyYDoc(ydoc, PAGE).doc.blocks[0].title[1]?.annotations.bold, true)
  })

  test('★ 구조 위반이 있는 Y.Doc 에서도 지우지 않고 다른 블록을 고친다', () => {
    const scene = violationScenes().find((s) => s.fix === 'type_conflict_resolved')
    assert.ok(scene !== undefined)
    const ydoc = mergedPeer(scene, 9)
    const before = readBodyYDoc(ydoc, PAGE)
    writeEditorChange(ydoc, (tr, doc) => tr.insertText('!', findBlock(doc, scene.bystander).pos + 2), 'test')
    const after = readBodyYDoc(ydoc, PAGE)
    assert.equal(after.doc.blocks.length, before.doc.blocks.length, '블록이 사라졌다')
    assert.deepEqual(after.fixes, before.fixes, '쓰기가 위반을 고쳤다 — 수선은 로그 저장소의 일이다')
    assert.equal(after.doc.blocks[1].title.map((r) => r.plain_text).join(''), '!옆 문단')
  })
})
