/**
 * 본문 Y.Doc 계약 — F-05-01 (DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **왕복이 손실 없다** — 문서 → Y.Doc → 바이트 → 새 Y.Doc → 문서. 12종 · 하위 페이지 참조 ·
 *      모르는 타입 · 중첩 · 글자 서식 · attr 객체
 *   ② **동시 편집이 수렴한다** — 두 참여자가 따로 편집하고 update 를 주고받으면 같은 문서로 읽히고,
 *      그 문서는 계약(`validateDoc`)을 지킨다. 구조를 어기는 조합도
 *   ③ **읽기는 원본을 바꾸지 않는다** — y-prosemirror 변환이라면 지웠을 노드(모르는 노드 이름)가 있어도
 *   ④ **막은 손실 · 위험** — 인라인 원자(멘션 · 수식)에 건 서식이 남는다 · y-prosemirror 변환의 연쇄 삭제(편집
 *      스키마로 변환하면 지우고, 바인딩이 넘기는 `collabSchema` 로는 지우지 않는다)
 *
 * 참여자는 에디터 없이 흉내 낸다: Y.Doc → ProseMirror 문서(`initProseMirrorDoc`) → ProseMirror
 * 트랜잭션 → `updateYFragment`. y-prosemirror 의 `ySyncPlugin` 이 에디터 변경을 Y.Doc 에 쓸 때
 * 부르는 함수와 같다. 문서는 바인딩처럼 `collabSchema` 로 읽으므로 지우지 않는다(`testing/collab-peers.ts`).
 * client id 를 고정해 동시 삽입 순서를 결정론으로 만든다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'
import { initProseMirrorDoc } from 'y-prosemirror'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { textRun, type RichTextRun } from '../contracts/rich-text.ts'
import { validateDoc, type EditorBlock, type EditorDoc } from '../editor/document.ts'
import { docToPm, pmToDoc } from '../editor/pm-adapter.ts'
import { blockSchema } from '../editor/schema.ts'
import { edit, exchange, findBlock as find, peer } from '../testing/collab-peers.ts'
import { collabSchema } from './collab-schema.ts'
import { BODY_FRAGMENT, createBodyYDoc, readBodyYDoc } from './ydoc.ts'

const PAGE = randomUUID()

const block = (type: string, text: string | null, extra: Partial<EditorBlock> = {}): EditorBlock => ({
  id: randomUUID(),
  type: type as EditorBlock['type'],
  title: text === null ? [] : [textRun(text)],
  ...extra,
})

// ── 참여자 흉내 — `testing/collab-peers.ts` ────────────────────────────

/** 두 참여자가 서로의 update 를 받고, 같은 문서로 읽히는지 · 계약을 지키는지 본다. */
function converge(a: Y.Doc, b: Y.Doc): EditorDoc {
  exchange(a, b)
  const left = readBodyYDoc(a, PAGE).doc
  assert.deepEqual(readBodyYDoc(b, PAGE).doc, left, '두 참여자가 다른 문서를 본다')
  assert.deepEqual(validateDoc(left), [])
  return left
}

const textOf = (b: EditorBlock | undefined): string => (b?.title ?? []).map((r) => r.plain_text).join('')

// ── ① 왕복 ────────────────────────────────────────────────────────────

describe('① 왕복', () => {
  test('★ 12종 · 하위 페이지 · 모르는 타입 · 중첩 · 서식 · attr 객체가 바이트를 지나 그대로 돌아온다', () => {
    const styled: RichTextRun[] = [
      textRun('굵게', { bold: true }),
      textRun(' 기울임', { italic: true, underline: true }),
      textRun(' 코드', { code: true, strikethrough: true }),
      textRun(' 빨강', { color: 'red' }),
      { ...textRun(' 링크'), href: 'https://example.com', text: { content: ' 링크', link: { url: 'https://example.com' } } },
    ]
    const source: EditorDoc = {
      blocks: [
        block('heading_1', '제목 1'),
        block('heading_2', '제목 2', { format: { block_color: 'blue_background' } }),
        block('heading_3', '제목 3'),
        { ...block('paragraph', null), title: styled },
        block('bulleted_list_item', '글머리', { children: [block('numbered_list_item', '번호', { children: [block('paragraph', '깊이 3')] })] }),
        block('to_do', '할 일', { properties: { checked: true } }),
        block('toggle', '토글', { children: [block('quote', '인용'), block('callout', '콜아웃', { properties: { icon: { type: 'emoji', emoji: '💡' } } })] }),
        block('divider', null),
        block('image', null, { properties: { source: { type: 'file', file_id: randomUUID() }, caption: [] } }),
        block('page', '하위 페이지'),
        block('synced_block', null, { properties: { anything: { nested: [1, 2, 3] } } }),
      ],
    }

    const bytes = Y.encodeStateAsUpdate(createBodyYDoc(source))
    const reloaded = new Y.Doc()
    Y.applyUpdate(reloaded, bytes)

    const read = readBodyYDoc(reloaded, PAGE)
    assert.deepEqual(read.fixes, [], '올바른 문서를 고쳤다')
    // 비교 기준은 ProseMirror 왕복의 정규형 — Y.Doc 층이 더하는 손실만 본다.
    assert.deepEqual(read.doc, pmToDoc(docToPm(source)))
    assert.equal(read.doc.blocks.length, source.blocks.length)
  })

  test('빈 페이지 — Y.Doc 에는 빈 문단 하나가 있고, 읽으면 빈 문서다', () => {
    const ydoc = createBodyYDoc({ blocks: [] })
    const root = ydoc.getXmlFragment(BODY_FRAGMENT).get(0) as Y.XmlElement
    assert.equal(root.nodeName, 'blockGroup')
    assert.equal(root.length, 1)
    assert.deepEqual(readBodyYDoc(ydoc, PAGE), { doc: { blocks: [] }, fixes: [] })
  })
})

// ── ② 동시 편집 ───────────────────────────────────────────────────────

describe('② 동시 편집', () => {
  test('같은 문단의 앞뒤에 동시에 친 글자가 둘 다 남는다', () => {
    const x = block('paragraph', '원문')
    const server = createBodyYDoc({ blocks: [x] })
    const [a, b] = [peer(server, 1), peer(server, 2)]

    edit(a, (tr, doc) => tr.insertText('Hello ', find(doc, x.id).pos + 2))
    edit(b, (tr, doc) => {
      const { pos, node } = find(doc, x.id)
      tr.insertText(' World', pos + 2 + node.child(0).content.size)
    })

    assert.equal(textOf(converge(a, b).blocks[0]), 'Hello 원문 World')
  })

  test('서로 다른 블록의 편집은 둘 다 남는다', () => {
    const [x, y] = [block('paragraph', '엑스'), block('paragraph', '와이')]
    const server = createBodyYDoc({ blocks: [x, y] })
    const [a, b] = [peer(server, 1), peer(server, 2)]
    edit(a, (tr, doc) => tr.insertText('!', find(doc, x.id).pos + 2))
    edit(b, (tr, doc) => tr.insertText('?', find(doc, y.id).pos + 2))
    assert.deepEqual(converge(a, b).blocks.map(textOf), ['!엑스', '?와이'])
  })

  test('★ 같은 블록을 동시에 다른 타입으로 바꾸면 한 블록 · 한 타입만 남는다', () => {
    const x = block('paragraph', '원문')
    const server = createBodyYDoc({ blocks: [x] })
    const [a, b] = [peer(server, 1), peer(server, 2)]
    edit(a, (tr, doc) => tr.setNodeMarkup(find(doc, x.id).pos + 1, blockSchema.nodes.heading_2, { props: {}, format: {} }))
    edit(b, (tr, doc) => tr.setNodeMarkup(find(doc, x.id).pos + 1, blockSchema.nodes.to_do, { props: { checked: false }, format: {} }))

    const merged = converge(a, b)
    assert.equal(merged.blocks.length, 1)
    assert.equal(merged.blocks[0].id, x.id)
    assert.ok(['heading_2', 'to_do'].includes(merged.blocks[0].type), merged.blocks[0].type)
    assert.equal(textOf(merged.blocks[0]), '원문')
    assert.ok(readBodyYDoc(a, PAGE).fixes.includes('type_conflict_resolved'), '이 조합이 실제로 내용 노드 둘을 만들었다')
  })

  test('★ 한 그룹의 남은 자식 둘을 동시에 하나씩 지우면 빈 그룹 없이 부모만 남는다', () => {
    const [c1, c2] = [block('paragraph', '하나'), block('paragraph', '둘')]
    const parent = block('paragraph', '부모', { children: [c1, c2] })
    const server = createBodyYDoc({ blocks: [parent] })
    const [a, b] = [peer(server, 1), peer(server, 2)]
    const remove = (id: string) => (tr: Transaction, doc: PmNode) => {
      const { pos, node } = find(doc, id)
      tr.delete(pos, pos + node.nodeSize)
    }
    edit(a, remove(c1.id))
    edit(b, remove(c2.id))

    const merged = converge(a, b)
    assert.deepEqual(merged.blocks.map((blk) => [blk.id, blk.children?.length ?? 0]), [[parent.id, 0]])
    assert.ok(readBodyYDoc(a, PAGE).fixes.includes('empty_group_removed'), '이 조합이 실제로 빈 그룹을 만들었다')
  })

  test('★ 같은 블록 밑으로 동시에 처음 들여쓰면 그룹이 합쳐져 둘 다 자식이 된다', () => {
    const [x, s, t] = [block('paragraph', '부모'), block('paragraph', '에스'), block('paragraph', '티')]
    const server = createBodyYDoc({ blocks: [x, s, t] })
    const [a, b] = [peer(server, 1), peer(server, 2)]
    const nest = (childId: string) => (tr: Transaction, doc: PmNode) => {
      const child = find(doc, childId)
      const parent = find(doc, x.id)
      tr.delete(child.pos, child.pos + child.node.nodeSize)
      tr.insert(parent.pos + 1 + parent.node.child(0).nodeSize, blockSchema.nodes.blockGroup.create(null, [child.node]))
    }
    edit(a, nest(s.id))
    edit(b, nest(t.id))

    const merged = converge(a, b)
    assert.equal(merged.blocks.length, 1)
    assert.deepEqual(new Set(merged.blocks[0].children?.map((c) => c.id)), new Set([s.id, t.id]))
    assert.ok(readBodyYDoc(a, PAGE).fixes.includes('groups_merged'), '이 조합이 실제로 그룹 둘을 만들었다')
  })

  test('★ 토글을 제목으로 바꾸는 동안 다른 사람이 자식을 넣으면 자식이 뒤 형제로 남는다', () => {
    const [x, s] = [block('toggle', '토글'), block('paragraph', '자식')]
    const server = createBodyYDoc({ blocks: [x, s] })
    const [a, b] = [peer(server, 1), peer(server, 2)]
    edit(a, (tr, doc) => tr.setNodeMarkup(find(doc, x.id).pos + 1, blockSchema.nodes.heading_1, { props: {}, format: {} }))
    edit(b, (tr, doc) => {
      const child = find(doc, s.id)
      const parent = find(doc, x.id)
      tr.delete(child.pos, child.pos + child.node.nodeSize)
      tr.insert(parent.pos + 1 + parent.node.child(0).nodeSize, blockSchema.nodes.blockGroup.create(null, [child.node]))
    })

    const merged = converge(a, b)
    assert.deepEqual(merged.blocks.map((blk) => [blk.type, blk.id]), [['heading_1', x.id], ['paragraph', s.id]])
  })

  test('둘이 동시에 순서를 바꿔도 계약을 지키는 같은 문서로 수렴한다 — 글자 겹침은 알고 있는 한계', () => {
    const blocks = ['일', '이', '삼'].map((t) => block('paragraph', t))
    const server = createBodyYDoc({ blocks })
    const [a, b] = [peer(server, 1), peer(server, 2)]
    const moveToEnd = (id: string) => (tr: Transaction, doc: PmNode) => {
      const moving = find(doc, id)
      tr.delete(moving.pos, moving.pos + moving.node.nodeSize)
      const group = tr.doc.child(0)
      tr.insert(1 + group.content.size, moving.node)
    }
    edit(a, moveToEnd(blocks[0].id))
    edit(b, moveToEnd(blocks[1].id))

    const merged = converge(a, b)
    assert.equal(new Set(merged.blocks.map((blk) => blk.id)).size, merged.blocks.length, 'id 가 겹치지 않는다')
  })

  test('★ id 가 겹친 Y.Doc 은 참여자마다 같은 새 id 로 읽힌다', () => {
    const [x, y] = [block('paragraph', '엑스'), block('paragraph', '와이')]
    const server = createBodyYDoc({ blocks: [x, y] })
    const [a, b] = [peer(server, 1), peer(server, 2)]
    // 순서를 바꾸는 두 편집의 attr LWW 가 만드는 결과를 직접 만든다.
    const root = a.getXmlFragment(BODY_FRAGMENT).get(0) as Y.XmlElement
    a.transact(() => (root.get(1) as Y.XmlElement).setAttribute('blockId', x.id))

    const merged = converge(a, b)
    assert.equal(merged.blocks[0].id, x.id)
    assert.notEqual(merged.blocks[1].id, x.id)
    assert.equal(readBodyYDoc(a, PAGE).doc.blocks[1].id, merged.blocks[1].id, '다시 읽어도 같다')
  })
})

// ── ③ 읽기는 원본을 바꾸지 않는다 ─────────────────────────────────────

describe('③ 읽기', () => {
  test('★ 모르는 노드 이름이 있어도 원본 Y.Doc 은 한 바이트도 바뀌지 않는다', () => {
    const x = block('paragraph', '엑스')
    const ydoc = createBodyYDoc({ blocks: [x] })
    const root = ydoc.getXmlFragment(BODY_FRAGMENT).get(0) as Y.XmlElement
    const future = new Y.XmlElement('blockContainer')
    future.setAttribute('blockId', randomUUID())
    future.insert(0, [new Y.XmlElement('future_block_from_newer_client')])
    root.insert(1, [future])

    const before = Y.encodeStateAsUpdate(ydoc)
    const read = readBodyYDoc(ydoc, PAGE)
    assert.ok(Buffer.from(Y.encodeStateAsUpdate(ydoc)).equals(Buffer.from(before)), '읽기가 원본을 바꿨다')
    assert.deepEqual(read.doc.blocks.map((blk) => blk.id), [x.id])
    assert.equal((ydoc.getXmlFragment(BODY_FRAGMENT).get(0) as Y.XmlElement).length, 2, '모르는 블록은 원본에 남는다')
  })
})

// ── ④ 알고 있는 손실 ──────────────────────────────────────────────────

describe('④ 막은 손실 · 위험', () => {
  test('★ y-prosemirror 변환은 타입 충돌 하나에 편집 스키마로는 본문을 Y.Doc 에서 지우고, 바인딩이 넘기는 collabSchema 로는 지우지 않는다', () => {
    const x = block('paragraph', '원문')
    const server = createBodyYDoc({ blocks: [x] })
    const [a, b] = [peer(server, 1), peer(server, 2)]
    edit(a, (tr, doc) => tr.setNodeMarkup(find(doc, x.id).pos + 1, blockSchema.nodes.heading_2, { props: {}, format: {} }))
    edit(b, (tr, doc) => tr.setNodeMarkup(find(doc, x.id).pos + 1, blockSchema.nodes.to_do, { props: { checked: false }, format: {} }))
    const merged = converge(a, b)
    assert.equal(merged.blocks.length, 1, '우리 읽기는 그 경로를 타지 않는다')

    // 합친 상태를 받은 참여자가 바인딩과 같은 스키마로 문서를 만든다 — 원본이 그대로다(`collab-schema.ts`).
    const guarded = peer(a, 3)
    const before = Buffer.from(Y.encodeStateAsUpdate(guarded))
    initProseMirrorDoc(guarded.getXmlFragment(BODY_FRAGMENT), collabSchema)
    assert.ok(Buffer.from(Y.encodeStateAsUpdate(guarded)).equals(before), 'collabSchema 로 변환했는데 Y.Doc 이 바뀌었다')
    assert.deepEqual(readBodyYDoc(guarded, PAGE).doc, merged)

    // 편집 스키마를 그대로 넘기면 라이브러리가 컨테이너 → 루트 그룹을 지운다 — 파사드가 필요한 이유다.
    // 이 두 단언이 실패하면 y-prosemirror 가 바뀐 것이다: collab-schema.ts 머리말 · HANDOFF §3.2-14 를 다시 본다.
    const unguarded = peer(a, 4)
    const { doc } = initProseMirrorDoc(unguarded.getXmlFragment(BODY_FRAGMENT), blockSchema)
    assert.equal(doc.childCount, 0, 'y-prosemirror 가 본문을 통째로 버렸다')
    assert.equal(unguarded.getXmlFragment(BODY_FRAGMENT).length, 0, '그 삭제가 Y.Doc 에 기록됐다')
  })

  test('★ 멘션 · 수식에 건 서식이 바이트를 지나도 남는다 — 노드 attr 에 비춰 싣는다(`editor/atom-marks.ts`)', () => {
    const mention: RichTextRun = {
      type: 'mention',
      annotations: { ...textRun('').annotations, bold: true },
      plain_text: '@누군가',
      href: null,
      mention: { type: 'user', user: { id: randomUUID() } } as RichTextRun['mention'],
    }
    const equation: RichTextRun = {
      type: 'equation',
      annotations: { ...textRun('').annotations, italic: true, color: 'red' },
      plain_text: 'x^2',
      href: null,
      equation: { expression: 'x^2' },
    }
    const source: EditorDoc = { blocks: [{ ...block('paragraph', null), title: [textRun('앞', { bold: true }), mention, equation] }] }

    const reloaded = new Y.Doc()
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(createBodyYDoc(source)))
    const viaY = readBodyYDoc(reloaded, PAGE).doc.blocks[0].title
    assert.deepEqual(viaY, pmToDoc(docToPm(source)).blocks[0].title)
    assert.equal(viaY[1]?.annotations.bold, true, '멘션의 굵게가 빠졌다')
    assert.equal(viaY[2]?.annotations.color, 'red', '수식의 색이 빠졌다')
  })
})
