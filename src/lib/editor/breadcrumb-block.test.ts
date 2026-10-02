/**
 * breadcrumb 블록 — 저장 모양 · 내보내기 · 복사 · `/` (잔여 묶음 8b-2 · F-01-16 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 레지스트리 — 텍스트 없음(원자) · 자식 없음 · **색 없음**(공개 API 의 페이로드가 `{}` 다)
 *   ② ★ Y.Doc — 요소 이름은 `breadcrumb` · 읽으면 같은 타입 · 정규화가 고칠 것이 없다
 *   ③ ★ 투영(행) — 내용을 저장하지 않는다 · 색이 와도 버린다
 *   ④ ★ Markdown 내보내기 · 블록 복사는 아무것도 쓰지 않는다 — 잃은 것으로 세지 않는다
 *   ⑤ ★ `/이동 경로` · `/breadcrumb` 으로 만들고 뒤에 빈 문단 · 캐럿(8b-1 의 규칙)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection } from '@tiptap/pm/state'

import { BREADCRUMB_TYPE } from '../block/breadcrumb.ts'
import { BLOCK_TYPES, normalizeFormat, type BlockType } from '../block/types.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createBodyYDoc, readBodyYDoc, BODY_FRAGMENT } from '../collab/ydoc.ts'
import { normalizeBody } from '../collab/normalize.ts'
import { pageToMarkdown, type MarkdownLinks } from '../export/markdown.ts'
import { plainTextForBlocks } from './block-clipboard.ts'
import { projectDocument, type EditorBlock } from './document.ts'
import { docToPm } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'
import { filterSlashCommands, runSlashCommand, slashMenuPlugin } from './slash-menu.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
function blk(type: string, text = '', format: Record<string, unknown> = {}): EditorBlock {
  return { id: nextId(), type: type as BlockType, title: text === '' ? [] : [textRun(text)], properties: {}, format, children: [] }
}
const NO_LINKS: MarkdownLinks = { page: () => null, image: () => null }

describe('① 레지스트리', () => {
  test('★ 텍스트 없음(원자) · 자식 없음 · 색 없음 — 스키마가 원자로 만든다', () => {
    assert.deepEqual(BLOCK_TYPES[BREADCRUMB_TYPE as BlockType], { hasRichText: false, canHaveChildren: false, supportsColor: false })
    assert.equal(blockSchema.nodes.breadcrumb?.spec.atom, true)
    assert.deepEqual(normalizeFormat(BREADCRUMB_TYPE as BlockType, { block_color: 'blue' }), {})
  })
})

describe('② ③ 저장', () => {
  test('★ Y.Doc — 요소 이름은 breadcrumb · 읽으면 같은 타입 · 정규화가 고칠 것이 없다', () => {
    const crumb = blk(BREADCRUMB_TYPE)
    const ydoc = createBodyYDoc({ blocks: [crumb, blk('paragraph', '본문')] })
    const group = ydoc.getXmlFragment(BODY_FRAGMENT).toArray()[0] as unknown as { toArray(): { toArray(): { nodeName: string }[] }[] }
    assert.equal(group.toArray()[0]?.toArray()[0]?.nodeName, 'breadcrumb')
    const read = readBodyYDoc(ydoc, nextId())
    assert.deepEqual(read.fixes, [])
    assert.equal(read.doc.blocks[0]?.type, BREADCRUMB_TYPE)
    assert.equal(read.doc.blocks[0]?.id, crumb.id)
    assert.deepEqual(normalizeBody(docToPm({ blocks: [blk(BREADCRUMB_TYPE)] }), { seed: nextId() }).fixes, [])
  })

  test('★ 투영(행) — 내용을 저장하지 않는다 · 색이 와도 버린다', () => {
    const crumb = { ...blk(BREADCRUMB_TYPE, '', { block_color: 'red' }), title: [textRun('실어 보낸 글')] }
    const projected = projectDocument(nextId(), [], { blocks: [crumb] }).blocks[0]
    assert.equal(projected.type, BREADCRUMB_TYPE)
    assert.deepEqual(projected.properties, {})
    assert.deepEqual(projected.format, {})
  })
})

describe('④ 내보내기 · 복사', () => {
  test('★ Markdown 은 아무것도 쓰지 않고 잃은 것으로 세지 않는다 · 블록 복사의 평문도 줄이 없다', () => {
    const { markdown, losses } = pageToMarkdown({ title: [textRun('T')], doc: { blocks: [blk(BREADCRUMB_TYPE), blk('paragraph', '본문')] } }, NO_LINKS, { untitled: 'x' })
    assert.equal(markdown, '# T\n\n본문\n')
    assert.deepEqual(Object.values(losses).filter((n) => n !== 0), [])
    assert.equal(plainTextForBlocks([blk('paragraph', '앞'), blk(BREADCRUMB_TYPE), blk('paragraph', '뒤')]), '앞\n뒤')
  })
})

describe('⑤ /', () => {
  test('★ /이동 경로 · /breadcrumb 으로 찾고, 빈 줄을 breadcrumb 으로 바꾸면 뒤에 빈 문단 · 캐럿', () => {
    for (const query of ['이동', '경로', 'breadcrumb', 'bread']) assert.equal(filterSlashCommands(query)[0]?.id, BREADCRUMB_TYPE, query)
    const a = nextId()
    let state = EditorState.create({ schema: blockSchema, doc: docToPm({ blocks: [{ ...blk('paragraph'), id: a }] }), plugins: [slashMenuPlugin()] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, findContainerById(state.doc, a)!.contentPos + 1)))
    for (const ch of '/경로') state = state.apply(state.tr.insertText(ch))
    const command = filterSlashCommands('경로')[0]
    assert.ok(command?.kind === 'block')
    assert.ok(runSlashCommand(state, (tr) => (state = state.apply(tr)), command, { isCollapsed: () => false }))
    const group = state.doc.child(0)
    assert.equal(group.child(0).child(0).type.name, BREADCRUMB_TYPE)
    assert.equal(group.child(1).child(0).type.name, 'paragraph')
    assert.ok(state.selection.$from.parent === group.child(1).child(0), '캐럿이 새 문단에 없다')
  })
})
