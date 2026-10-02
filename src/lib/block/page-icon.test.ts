/**
 * 페이지 아이콘의 모양 · 본문의 거르기 — 잔여 묶음 8c-1 (F-02-05 · 순수 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 읽기는 관대하게 — 모양이 아니면 없는 것(null)
 *   ② ★ 받기는 엄격하게 — null 은 지우기 · 이모지 한 글자만(키캡 · 가족 · 깃발도) · type 은 생략 가능 · 다른 종류는 거부
 *   ③ ★ 본문은 아이콘을 싣지 않는다 — 세 층이 각자 버린다:
 *        행에서 문서를 지을 때(`rowsToDoc`) · 문서에서 편집기 · Y.Doc 노드를 지을 때(`normalizeFormat` — `contentNodeFor`) ·
 *        Y.Doc 을 읽을 때(정규화 — 참여자가 attr 에 직접 넣은 것)
 *   ④ ★ 경로의 줄이 아이콘을 싣는다 — 페이지 · teamspace · 같은 경로의 판단이 아이콘을 본다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'

import { PAGE_ICON_KEY, pageIconOfFormat, parsePageIconInput, readPageIcon, samePageIcon } from './page-icon.ts'
import { normalizeFormat, PAGE_TYPE, type BlockType } from './types.ts'
import { breadcrumbTrail, sameTrail } from './breadcrumb.ts'
import { rowsToDoc, type EditorBlock } from '../editor/document.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import { BODY_FRAGMENT, createBodyYDoc, readBodyYDoc } from '../collab/ydoc.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const ICON = { type: 'emoji', emoji: '🌱' } as const
const pageRef = (format: Record<string, unknown>): EditorBlock => ({ id: nextId(), type: PAGE_TYPE, title: [], properties: {}, format, children: [] })

describe('① 읽기', () => {
  test('모양이 아니면 null — 문자열(노션 내부 모양) · 두 글자 · 다른 종류 · 객체가 아닌 것', () => {
    assert.deepEqual(readPageIcon(ICON), ICON)
    assert.deepEqual(readPageIcon({ ...ICON, extra: 1 }), ICON, '다른 키는 싣지 않는다')
    for (const raw of ['🌱', null, undefined, [], { type: 'emoji', emoji: '🌱🌱' }, { type: 'emoji', emoji: 1 }, { type: 'external', url: 'https://x' }]) {
      assert.equal(readPageIcon(raw), null, JSON.stringify(raw))
    }
    assert.deepEqual(pageIconOfFormat({ [PAGE_ICON_KEY]: ICON, block_color: 'red' }), ICON)
    assert.equal(pageIconOfFormat(null), null)
    assert.equal(pageIconOfFormat({}), null)
  })
})

describe('② 받기', () => {
  test('★ null 은 지우기 · 이모지 한 글자(키캡 · 가족 · 깃발 · 피부색) · type 생략 · 앞뒤 공백은 벗긴다', () => {
    assert.equal(parsePageIconInput(null), null)
    for (const e of ['🌱', '1️⃣', '#️⃣', '👨‍👩‍👧‍👦', '🇰🇷', '👍🏽', '❤️']) {
      assert.deepEqual(parsePageIconInput({ type: 'emoji', emoji: e }), { type: 'emoji', emoji: e }, e)
    }
    assert.deepEqual(parsePageIconInput({ emoji: ' 🚀 ' }), { type: 'emoji', emoji: '🚀' })
  })

  test('★ 거부 — 빈 글(지우기는 null 이다) · 글자 · 숫자 · 두 글자 · 다른 종류 · 객체가 아닌 것', () => {
    for (const raw of [
      undefined, '🌱', 7, [], {}, { type: 'emoji' }, { type: 'emoji', emoji: '' }, { type: 'emoji', emoji: '   ' },
      { type: 'emoji', emoji: 'a' }, { type: 'emoji', emoji: '1' }, { type: 'emoji', emoji: '🚀🚀' }, { type: 'emoji', emoji: '🚀 x' },
      { type: 'emoji', emoji: '👨‍👩‍👧‍👦'.repeat(3) }, { type: 'external', url: 'https://example.com/a.png' }, { type: 'file', file_id: nextId() },
    ]) {
      assert.equal(parsePageIconInput(raw), undefined, JSON.stringify(raw))
    }
  })

  test('같은 아이콘인가', () => {
    assert.ok(samePageIcon(null, null))
    assert.ok(samePageIcon(ICON, { type: 'emoji', emoji: '🌱' }))
    assert.ok(!samePageIcon(ICON, null))
    assert.ok(!samePageIcon(ICON, { type: 'emoji', emoji: '🚀' }))
  })
})

describe('③ 본문은 아이콘을 싣지 않는다', () => {
  test('★ normalizeFormat 은 어느 타입에서나 아이콘을 버린다 — 다른 키는 그대로', () => {
    for (const type of [PAGE_TYPE, 'paragraph', 'toggle', 'code'] as BlockType[]) {
      const out = normalizeFormat(type, { [PAGE_ICON_KEY]: ICON, block_color: 'red' })
      assert.ok(!(PAGE_ICON_KEY in out), type)
    }
    assert.deepEqual(normalizeFormat(PAGE_TYPE, { [PAGE_ICON_KEY]: ICON, block_color: 'red' }), { block_color: 'red' })
  })

  test('★ 행에서 문서를 지으면 하위 페이지 참조가 그 행의 아이콘을 받지 않는다(rowsToDoc)', () => {
    const pageId = nextId()
    const child = nextId()
    const doc = rowsToDoc(pageId, [
      { id: child, type: PAGE_TYPE, parent_id: pageId, order_key: 'a0', properties: { title: [] }, format: { [PAGE_ICON_KEY]: ICON, block_color: 'red' } },
    ])
    assert.deepEqual(doc.blocks[0]?.format, { block_color: 'red' })
  })

  test('★ 문서에서 편집기 · Y.Doc 노드를 지을 때 참조 노드의 아이콘을 버린다(docToPm)', () => {
    const pm = docToPm({ blocks: [pageRef({ [PAGE_ICON_KEY]: ICON, block_color: 'red' })] })
    const content = pm.child(0).child(0).child(0)
    assert.equal(content.type.name, 'page_ref')
    assert.deepEqual(content.attrs.format, { block_color: 'red' })
    const ydoc = createBodyYDoc({ blocks: [pageRef({ [PAGE_ICON_KEY]: ICON })] })
    assert.ok(!JSON.stringify(rawElements(ydoc)).includes(PAGE_ICON_KEY))
  })

  test('★ 참여자가 Y.Doc 의 참조 attr 에 직접 넣은 아이콘은 읽을 때 고친다(정규화 — 수선이 Y.Doc 에 쓴다)', () => {
    const ref = pageRef({})
    const ydoc = createBodyYDoc({ blocks: [ref] })
    const element = (ydoc.getXmlFragment(BODY_FRAGMENT).toArray()[0] as Y.XmlElement).toArray()[0] as Y.XmlElement
    const content = element.toArray()[0] as Y.XmlElement
    assert.equal(content.nodeName, 'page_ref')
    content.setAttribute('format', { [PAGE_ICON_KEY]: ICON, block_color: 'red' } as unknown as string)
    const read = readBodyYDoc(ydoc, nextId())
    assert.ok(read.fixes.includes('invalid_props_dropped'), JSON.stringify(read.fixes))
    assert.deepEqual(read.doc.blocks[0]?.format, { block_color: 'red' })
  })
})

/** 요소 이름 · attr 을 그대로(정규화 없이). */
function rawElements(ydoc: Y.Doc): unknown {
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlHook): unknown =>
    node instanceof Y.XmlElement ? { name: node.nodeName, attrs: node.getAttributes(), children: node.toArray().map(walk) } : null
  return ydoc.getXmlFragment(BODY_FRAGMENT).toArray().map(walk)
}

describe('④ 경로', () => {
  test('★ 페이지 · teamspace 의 아이콘을 싣는다 — 없으면 null · 워크스페이스는 늘 null', () => {
    const ws = nextId()
    const trail = breadcrumbTrail({
      workspaceId: ws,
      teamspace: { id: nextId(), name: '팀', icon: '🚀' },
      ancestors: [{ id: nextId(), plainTitle: '위', icon: ICON }, { id: nextId(), plainTitle: '중간', icon: null }],
      page: { id: nextId(), plainTitle: '여기', icon: { type: 'emoji', emoji: '🍃' } },
    })
    assert.deepEqual(trail.map((i) => [i.kind, i.icon?.emoji ?? null]), [
      ['workspace', null], ['teamspace', '🚀'], ['page', '🌱'], ['page', null], ['current', '🍃'],
    ])
    const noIcons = breadcrumbTrail({ workspaceId: ws, teamspace: { id: nextId(), name: '팀', icon: null }, ancestors: [], page: { id: nextId(), plainTitle: '여기' } })
    assert.deepEqual(noIcons.map((i) => i.icon), [null, null, null])
  })

  test('★ 같은 경로의 판단이 아이콘을 본다 — 아이콘만 바뀌어도 다른 경로(블록이 다시 그린다)', () => {
    const input = { workspaceId: nextId(), teamspace: null, ancestors: [{ id: nextId(), plainTitle: '위', icon: ICON }], page: { id: nextId(), plainTitle: '여기' } }
    const a = breadcrumbTrail(input)
    assert.ok(sameTrail(a, breadcrumbTrail(input)))
    assert.ok(!sameTrail(a, breadcrumbTrail({ ...input, ancestors: [{ ...input.ancestors[0], icon: { type: 'emoji', emoji: '🚀' } }] })))
    assert.ok(!sameTrail(a, breadcrumbTrail({ ...input, page: { ...input.page, icon: ICON } })))
  })
})
