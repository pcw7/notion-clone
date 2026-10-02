/**
 * 모양이 틀린 attr — 협업 참여자가 검증 없이 쓴 값 (잔여 묶음 8a-2 · 정본 §3.4 [보강] 코드 블록 ⑧ · Y.Doc · DB 없음)
 *
 * 참여자는 Y attr 에 lib0 이 인코딩하는 무엇이든 쓸 수 있다. 여기서는 Y 요소에 직접 쓴다 — 편집기 · 명령을 거치지 않는 참여자다.
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ null 만 다른 정화도 수선이 쓴다 — `caption: [null]` · `{ language: null }` · `format.code_wrap: null` · (HEAD 부터의)
 *      `props: []` 들. y-prosemirror 의 비교가 null 을 "없음"으로 세고 배열과 객체를 가르지 않아 건너뛰던 것을 따로 쓴다
 *      (`repair.ts` `writeMissedAttrs`). 전에는 'unverified' 로 남았다
 *   ② ★ 그 정화가 같은 수선에 묶인 구조 수선(타입 충돌 · 중복 id · 둘 수 없는 참조 빼기)을 막지 않는다 — 참조 빼기가 건너뛰어지면
 *      로그 저장소가 던진다(`doc-store.ts` 의 사전 거르기 불변식)
 *   ③ ★ bigint · 바이트 배열 · 공유 타입 — 읽기 · 수선이 던지지 않고, 읽은 문서는 JSON 으로 옮겨진다(투영의 직렬화)
 *   ④ ★ 인라인 원자 — 문자열이 아닌 식 · 보이는 글자, bigint 가 든 멘션. 읽기 · 어댑터가 던지지 않는다(`invalid_inline_fixed`)
 *   ⑤ ★ 수선은 고칠 곳만 쓴다 — 멀쩡한 캡션(런 안의 `link: null`) · 멘션 · 코드 블록의 attr 을 다시 쓰지 않는다
 *   ⑥ ★ 원자의 서식 거울(`marks`) — bigint · 공유 타입 · 이름이 문자열이 아닌 항목. 되살린 마크에서 다시 만들어 편집기가 열리고,
 *      공유 타입이 든 거울이 다른 수선의 비교를 스택 넘침으로 몰지 않는다(8a-2 리뷰)
 *   ⑦ ★ U+0000 — 글자 · 캡션 · 멘션의 보이는 글자 · 식. jsonb 가 거부해 투영이 멈췄다 — U+FFFD 로 바꾸고 수선이 쓴다(8a-2 리뷰)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'

import { pageMentionRun, textRun, DEFAULT_ANNOTATIONS, type RichTextRun } from '../contracts/rich-text.ts'
import type { EditorDeps } from '../editor/create-editor.ts'
import { createCollabEditorState } from './collab-editor.ts'
import type { EditorBlock } from '../editor/document.ts'
import { docToPm, pmToDoc } from '../editor/pm-adapter.ts'
import { findContainerById } from '../editor/pm-blocks.ts'
import { contentElementOf as contentOf, edit, exchange, headless, peer } from '../testing/collab-peers.ts'
import { mergedPeer, violationScenes } from '../testing/collab-scenarios.ts'
import { repairBodyYDoc } from './repair.ts'
import { BODY_FRAGMENT, createBodyYDoc, readBodyPm, readBodyYDoc } from './ydoc.ts'

const PAGE = randomUUID()

const block = (type: EditorBlock['type'], title: RichTextRun[], properties: Record<string, unknown> = {}): EditorBlock => ({
  id: randomUUID(),
  type,
  title,
  properties,
  format: {},
  children: [],
})

const equationRun = (expression: string): RichTextRun => ({
  type: 'equation',
  annotations: { ...DEFAULT_ANNOTATIONS },
  plain_text: expression,
  href: null,
  equation: { expression },
})

/** 참여자의 쓰기 — 검증을 거치지 않는다. */
const write = (element: Y.XmlElement, key: string, value: unknown) => element.setAttribute(key, value as never)

const blockOf = (ydoc: Y.Doc, id: string) => readBodyYDoc(ydoc, PAGE).doc.blocks.find((b) => b.id === id)

/** 수선 뒤: 고칠 것이 남지 않았고, 다시 고치지 않는다. */
function assertRepaired(ydoc: Y.Doc, fix: string): void {
  const read = readBodyYDoc(ydoc, PAGE)
  assert.ok(read.fixes.includes(fix as never), `정규화가 ${fix} 를 보고하지 않았다: ${JSON.stringify(read.fixes)}`)
  const repaired = repairBodyYDoc(ydoc, PAGE)
  assert.equal(repaired.kind, 'repaired', JSON.stringify(repaired))
  assert.deepEqual(readBodyYDoc(ydoc, PAGE).fixes, [], '수선 뒤에도 고칠 것이 남았다')
  assert.equal(repairBodyYDoc(ydoc, PAGE).kind, 'clean', '두 번째 수선이 또 썼다')
}

describe('① null 만 다른 정화', () => {
  for (const [name, key, value, expected, fix] of [
    ['캡션 [null]', 'props', { caption: [null] }, { caption: [] }, 'invalid_props_dropped'],
    ['캡션 [런, null]', 'props', { caption: [textRun('설명'), null] }, { caption: [textRun('설명')] }, 'invalid_props_dropped'],
    ['캡션 null', 'props', { caption: null }, {}, 'invalid_props_dropped'],
    ['언어 null', 'props', { language: null }, {}, 'invalid_props_dropped'],
    ['줄바꿈 null', 'format', { code_wrap: null }, {}, 'invalid_props_dropped'],
    ['색 null', 'format', { block_color: null }, {}, 'invalid_props_dropped'],
    ['props 빈 배열(HEAD 부터)', 'props', [], {}, 'invalid_attrs_reset'],
    ['props [null](HEAD 부터)', 'props', [null], {}, 'invalid_attrs_reset'],
  ] as const) {
    test(`★ ${name} — 수선이 Y.Doc 에 쓴다`, () => {
      const code = block('code', [textRun('x')])
      const ydoc = createBodyYDoc({ blocks: [code] })
      write(contentOf(ydoc, code.id), key, value)
      assertRepaired(ydoc, fix)
      assert.deepEqual(contentOf(ydoc, code.id).getAttribute(key as 'props'), expected, 'Y.Doc 의 attr 이 고쳐지지 않았다')
    })
  }
})

describe('② 구조 수선과 함께', () => {
  for (const fix of ['type_conflict_resolved', 'duplicate_id'] as const) {
    test(`★ null 만 다른 정화가 같은 수선의 ${fix} 를 막지 않는다`, () => {
      const scene = violationScenes().find((s) => s.fix === fix)
      assert.ok(scene)
      const ydoc = mergedPeer(scene, 5)
      write(contentOf(ydoc, scene.bystander), 'format', { code_wrap: null })
      const read = readBodyYDoc(ydoc, PAGE)
      assert.ok(read.fixes.includes(fix) && read.fixes.includes('invalid_props_dropped'), JSON.stringify(read.fixes))
      assertRepaired(ydoc, fix)
    })
  }

  test('★ 둘 수 없는 참조 빼기와 함께 — 수선이 건너뛰지 않는다(건너뛰면 로그 저장소가 던진다)', () => {
    const ref = randomUUID()
    const code = block('code', [textRun('x')])
    const pageRef: EditorBlock = { id: ref, type: 'page', title: [] }
    const toggle = (id: string, children: EditorBlock[] = []): EditorBlock => ({ ...block('toggle', [textRun('토글')]), id, children })
    const [first, second] = [randomUUID(), randomUUID()]
    const base = createBodyYDoc({ blocks: [code, toggle(first), toggle(second), pageRef] })
    const rewrite = (ydoc: Y.Doc, blocks: EditorBlock[]): void => {
      const next = docToPm({ blocks })
      edit(ydoc, (tr) => {
        tr.replaceWith(0, tr.doc.content.size, next.content)
      })
    }
    // 같은 참조를 둘이 동시에 옮긴다 — 둘째는 새 id 를 받고 어떤 페이지도 아니다(`repair.test.ts` ⑥).
    const [server, other] = [peer(base, 21), peer(base, 22)]
    rewrite(server, [code, toggle(first, [pageRef]), toggle(second)])
    rewrite(other, [code, toggle(first), toggle(second, [pageRef])])
    exchange(server, other)
    write(contentOf(server, code.id), 'props', { caption: [null] })

    const pageRefs = new Set([ref])
    const read = readBodyYDoc(server, PAGE, { pageRefs })
    assert.ok(read.fixes.includes('page_ref_dropped') && read.fixes.includes('invalid_props_dropped'), JSON.stringify(read.fixes))
    const repaired = repairBodyYDoc(server, PAGE, { pageRefs })
    assert.equal(repaired.kind, 'repaired', JSON.stringify(repaired))
    assert.deepEqual(readBodyYDoc(server, PAGE, { pageRefs }).fixes, [])
  })
})

describe('③ JSON 으로 나타낼 수 없는 값', () => {
  test('★ bigint · 바이트 배열 · 공유 타입 — 읽기 · 수선이 던지지 않고 · 읽은 문서는 JSON 으로 옮겨진다', () => {
    const code = block('code', [textRun('x')], { language: 'python', caption: [textRun('설명')] })
    const image = block('image', [], { source: { type: 'external', url: 'https://x.io/a.png' } })
    const para = block('paragraph', [textRun('문단')])
    const ydoc = createBodyYDoc({ blocks: [code, image, para] })
    write(contentOf(ydoc, code.id), 'format', { code_wrap: true, x: 1n })
    write(contentOf(ydoc, code.id), 'props', { language: 'python', caption: [{ ...textRun('설명'), href: 2n }], n: [3n] })
    write(contentOf(ydoc, image.id), 'props', new Uint8Array([1, 2, 3]))
    write(contentOf(ydoc, para.id), 'props', { nested: new Y.Map() })

    let read: ReturnType<typeof readBodyYDoc> | undefined
    assert.doesNotThrow(() => {
      read = readBodyYDoc(ydoc, PAGE)
    })
    assert.ok(read?.fixes.includes('invalid_props_dropped') && read.fixes.includes('invalid_attrs_reset'), JSON.stringify(read?.fixes))
    assert.doesNotThrow(() => JSON.stringify(read?.doc))
    const readCode = read?.doc.blocks.find((b) => b.id === code.id)
    assert.deepEqual(readCode?.format, { code_wrap: true })
    assert.equal(readCode?.properties?.language, 'python')
    assert.deepEqual(read?.doc.blocks.find((b) => b.id === image.id)?.properties, {}, '평범한 객체가 아닌 props 가 남았다')

    assertRepaired(ydoc, 'invalid_props_dropped')
  })
})

describe('④ 인라인 원자', () => {
  test('★ 문자열이 아닌 식 · 보이는 글자 · bigint 가 든 멘션 — 읽기 · 어댑터가 던지지 않는다', () => {
    const target = randomUUID()
    const para = block('paragraph', [textRun('앞 '), pageMentionRun(target), equationRun('e=mc^2'), textRun(' 뒤')])
    const ydoc = createBodyYDoc({ blocks: [para] })
    const content = contentOf(ydoc, para.id)
    const atoms = content.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement)
    const mention = atoms.find((a) => a.nodeName === 'mention')
    const equation = atoms.find((a) => a.nodeName === 'equation')
    assert.ok(mention && equation)
    write(mention, 'plainText', { toString: 0 })
    write(mention, 'mention', { type: 'page', page: { id: target }, extra: 4n })
    write(equation, 'expression', { toString: 0 })

    // 어댑터는 정규화 전의 문서도 던지지 않는다(편집기 쪽 읽기 — 복사 · 내보내기).
    assert.doesNotThrow(() => JSON.stringify(pmToDoc(readBodyPm(ydoc))))
    let read: ReturnType<typeof readBodyYDoc> | undefined
    assert.doesNotThrow(() => {
      read = readBodyYDoc(ydoc, PAGE)
    })
    const title = read?.doc.blocks[0]?.title ?? []
    assert.deepEqual(
      title.map((r) => r.type),
      ['text', 'mention', 'text'],
      '식이 문자열이 아닌 수식이 남았거나 멘션이 빠졌다',
    )
    assert.deepEqual(title[1]?.mention, { type: 'page', page: { id: target } })
    assert.equal(title[1]?.plain_text, '')
    assertRepaired(ydoc, 'invalid_inline_fixed')
  })
})

describe('⑤ 고칠 곳만', () => {
  test('★ 수선은 고칠 요소의 attr 만 쓴다 — 멀쩡한 캡션(link: null) · 멘션 · 코드 블록은 다시 쓰지 않는다', () => {
    const code = block('code', [textRun('print(1)')], { language: 'python', caption: [textRun('링크 없는 캡션')] })
    const image = block('image', [], { source: { type: 'external', url: 'https://x.io/a.png' }, caption: [textRun('그림')] })
    const mentioned = block('paragraph', [textRun('누구 '), pageMentionRun(randomUUID())])
    const poisoned = block('code', [textRun('y')])
    const ydoc = createBodyYDoc({ blocks: [code, image, mentioned, poisoned] })
    const target = contentOf(ydoc, poisoned.id)
    write(target, 'props', { caption: [null] })

    const touched = new Set<Y.AbstractType<unknown>>()
    const fragment = ydoc.getXmlFragment(BODY_FRAGMENT)
    const observe = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      for (const event of events) if ((event as Y.YXmlEvent).attributesChanged?.size > 0) touched.add(event.target)
    }
    fragment.observeDeep(observe)
    assert.equal(repairBodyYDoc(ydoc, PAGE).kind, 'repaired')
    fragment.unobserveDeep(observe)
    assert.deepEqual([...touched], [target], '고칠 곳이 아닌 요소의 attr 을 다시 썼다')
    assert.deepEqual(blockOf(ydoc, code.id)?.properties, code.properties)
  })
})

/** 같은 상태의 다른 참여자 — 편집기를 붙여도 검사하는 문서를 바꾸지 않게. */
function peerOf(ydoc: Y.Doc): Y.Doc {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc))
  return copy
}

/** 문단 안의 인라인 원자 요소들. */
function atomsOf(ydoc: Y.Doc, blockId: string): Y.XmlElement[] {
  return contentOf(ydoc, blockId)
    .toArray()
    .filter((c): c is Y.XmlElement => c instanceof Y.XmlElement)
}

const EDITOR_DEPS = {
  isCollapsed: () => false,
  toggleCollapsed: () => undefined,
  openPage: () => undefined,
  pageRefTitle: () => undefined,
  pageIcon: () => null,
  mentionLabel: () => undefined,
  openCodeLanguageMenu: () => undefined,
  openCodeCaption: () => undefined,
  workspaceId: 'ws',
  uploadImage: () => Promise.reject(new Error('검사에서 올리지 않는다')),
} as unknown as EditorDeps

describe('⑥ 원자의 서식 거울(marks)', () => {
  for (const [name, marks] of [
    ['bigint', 5n],
    ['bigint 원소', [5n]],
    ['공유 타입', 'y-map'],
    ['이름이 문자열이 아닌 항목', [{ type: { toString: 0 } }]],
  ] as const) {
    test(`★ ${name} — 읽기가 거울을 다시 만들고 · 수선 뒤 편집기가 열린다`, () => {
      const para = block('paragraph', [textRun('앞 '), pageMentionRun(randomUUID()), equationRun('x^2')])
      const ydoc = createBodyYDoc({ blocks: [para] })
      for (const atom of atomsOf(ydoc, para.id)) write(atom, 'marks', marks === 'y-map' ? new Y.Map() : marks)
      // 수선이 닿기 전에도 편집기가 열리고 고칠 수 있다 — 거울을 맞추는 플러그인(문서가 바뀌는 트랜잭션마다 돈다)의 비교가 던지지
      // 않는다(`atomMarksInSync`).
      const { state } = createCollabEditorState(peerOf(ydoc).getXmlFragment(BODY_FRAGMENT), EDITOR_DEPS)
      const editor = headless(state)
      const at = findContainerById(editor.state.doc, para.id)
      assert.ok(at)
      assert.doesNotThrow(() => editor.dispatch(editor.state.tr.insertText('!', at.contentPos + 1)), '수선 전의 편집기가 편집에 던진다')
      assertRepaired(ydoc, 'invalid_inline_fixed')
      assert.doesNotThrow(() => createCollabEditorState(ydoc.getXmlFragment(BODY_FRAGMENT), EDITOR_DEPS), '수선 뒤에도 편집기가 열리지 않는다')
      assert.deepEqual(
        readBodyYDoc(ydoc, PAGE).doc.blocks[0]?.title.map((r) => r.type),
        ['text', 'mention', 'equation'],
        '원자가 빠졌다 — 서식만 고칠 일이다',
      )
    })
  }

  test('★ 공유 타입이 든 거울은 다른 블록의 수선을 막지 않는다 — 비교가 공유 타입 속으로 들어가 스택을 넘기지 않는다', () => {
    const para = block('paragraph', [pageMentionRun(randomUUID())])
    const code = block('code', [textRun('x')])
    const ydoc = createBodyYDoc({ blocks: [para, code] })
    for (const atom of atomsOf(ydoc, para.id)) write(atom, 'marks', new Y.Map())
    assert.equal(repairBodyYDoc(ydoc, PAGE).kind, 'repaired')
    write(contentOf(ydoc, code.id), 'props', { caption: [null], language: 42 })
    let result: ReturnType<typeof repairBodyYDoc> | undefined
    assert.doesNotThrow(() => {
      result = repairBodyYDoc(ydoc, PAGE)
    })
    assert.equal(result?.kind, 'repaired', JSON.stringify(result))
    assert.deepEqual(readBodyYDoc(ydoc, PAGE).fixes, [])
  })

  test('멀쩡한 서식 거울은 고치지 않는다 — 굵은 멘션 · 링크 걸린 수식', () => {
    const para = block('paragraph', [
      pageMentionRun(randomUUID(), { bold: true }),
      { ...equationRun('y'), annotations: { ...DEFAULT_ANNOTATIONS, italic: true }, href: null },
    ])
    const ydoc = createBodyYDoc({ blocks: [para] })
    assert.deepEqual(readBodyYDoc(ydoc, PAGE).fixes, [])
  })
})

describe('⑦ U+0000', () => {
  test('★ 글자 · 캡션 · 멘션의 보이는 글자 · 식의 U+0000 을 U+FFFD 로 — 수선이 쓰고 읽은 문서에 남지 않는다', () => {
    const para = block('paragraph', [textRun('앞'), pageMentionRun(randomUUID()), equationRun('e')])
    const code = block('code', [textRun('코드')], { caption: [textRun('캡션')] })
    const ydoc = createBodyYDoc({ blocks: [para, code] })
    const texts = contentOf(ydoc, para.id)
      .toArray()
      .filter((c): c is Y.XmlText => c instanceof Y.XmlText)
    texts[0]?.insert(0, 'n\u0000ul')
    const [mention, equation] = atomsOf(ydoc, para.id)
    write(mention, 'plainText', 'p\u0000')
    write(equation, 'expression', 'e\u0000')
    write(contentOf(ydoc, code.id), 'props', { caption: [textRun('c\u0000')] })
    ;(contentOf(ydoc, code.id).get(0) as Y.XmlText).insert(0, 'q\u0000')

    const read = readBodyYDoc(ydoc, PAGE)
    assert.ok(read.fixes.includes('nul_replaced'), JSON.stringify(read.fixes))
    assert.equal(JSON.stringify(read.doc).includes('\\u0000'), false, 'jsonb 가 거부하는 글자가 읽은 문서에 남았다')
    assertRepaired(ydoc, 'nul_replaced')
  })
})

describe('④-2 원자 규칙을 저마다(섞은 poison 은 서로를 가린다)', () => {
  const scene = () => {
    const target = randomUUID()
    const para = block('paragraph', [textRun('앞 '), pageMentionRun(target), equationRun('e')])
    const ydoc = createBodyYDoc({ blocks: [para] })
    const [mention, equation] = atomsOf(ydoc, para.id)
    return { para, ydoc, mention, equation, target }
  }
  const types = (ydoc: Y.Doc) => readBodyYDoc(ydoc, PAGE).doc.blocks[0]?.title.map((r) => r.type)

  test('★ 식이 문자열이 아닌 수식만 — 그 수식은 빠진다', () => {
    const { ydoc, equation } = scene()
    write(equation, 'expression', 7)
    assert.deepEqual(types(ydoc), ['text', 'mention'])
    assertRepaired(ydoc, 'invalid_inline_fixed')
  })

  test('★ 멘션의 보이는 글자만 문자열이 아니다 — 멘션은 남고 글자는 빈다', () => {
    const { ydoc, mention } = scene()
    write(mention, 'plainText', 12)
    const title = readBodyYDoc(ydoc, PAGE).doc.blocks[0]?.title
    assert.deepEqual([title?.[1]?.type, title?.[1]?.plain_text], ['mention', ''])
    assertRepaired(ydoc, 'invalid_inline_fixed')
  })

  test('★ 멘션 대상에 bigint 만 — 그 키만 빠지고 멘션은 남는다', () => {
    const { ydoc, mention, target } = scene()
    write(mention, 'mention', { type: 'page', page: { id: target }, n: 1n })
    assert.deepEqual(readBodyYDoc(ydoc, PAGE).doc.blocks[0]?.title[1]?.mention, { type: 'page', page: { id: target } })
    assertRepaired(ydoc, 'invalid_inline_fixed')
  })

  test('★ 멘션 대상이 평범한 객체가 아니다 — 그 멘션은 빠진다', () => {
    const { ydoc, mention } = scene()
    write(mention, 'mention', 'not-an-object')
    assert.deepEqual(types(ydoc), ['text', 'equation'])
    assertRepaired(ydoc, 'invalid_inline_fixed')
  })

  test('★ 코드 블록(평문 본문) 안에 끼어든 수식 — 식이 문자열이 아니면 빼고 · 문자열이면 글자로 편다 · 던지지 않는다', () => {
    const code = block('code', [textRun('x')])
    const ydoc = createBodyYDoc({ blocks: [code] })
    const element = contentOf(ydoc, code.id)
    const hostile = new Y.XmlElement('equation')
    hostile.setAttribute('expression', { toString: 0 } as never)
    const fine = new Y.XmlElement('equation')
    fine.setAttribute('expression', '+y')
    element.insert(element.length, [hostile, fine])
    let read: ReturnType<typeof readBodyYDoc> | undefined
    assert.doesNotThrow(() => {
      read = readBodyYDoc(ydoc, PAGE)
    })
    assert.equal(read?.doc.blocks[0]?.title.map((r) => r.plain_text).join(''), 'x+y')
    assertRepaired(ydoc, 'plain_text_flattened')
  })
})
