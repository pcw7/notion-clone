/**
 * EditorDoc ↔ ProseMirror 왕복 — F-09-03 플래튼/병합 어댑터
 *
 * ProseMirror 는 DOM 없이 돈다(`prosemirror-model`/`state` 는 순수 자료구조).
 * 그래서 에디터의 핵심 계층을 브라우저 없이 테스트할 수 있다.
 *
 * 확인하는 것:
 *   ① 서식·링크·색·원자가 왕복에서 살아남는가
 *   ② ProseMirror 가 런을 합쳐도 계약 정규형이 유지되는가
 *   ③ **오프셋이 두 모델에서 같은 수인가** — 원자 길이 1 판결의 회수 지점
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { DEFAULT_ANNOTATIONS, textRun, toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import type { BlockType } from '../block/types.ts'
import { unitLength } from './rich-text-ops.ts'
import { blockSchema } from './schema.ts'
import { docToPm, inlineToRuns, pmToDoc, runsToInline } from './pm-adapter.ts'
import type { EditorBlock, EditorDoc } from './document.ts'

const id = () => randomUUID()

function blk(type: BlockType, title: RichTextRun[] = [], children: EditorBlock[] = []): EditorBlock {
  return { id: id(), type, title, properties: {}, format: {}, children }
}

/** 런 배열을 인라인으로 바꿨다가 되돌린다. */
function roundTripRuns(runs: RichTextRun[]): RichTextRun[] {
  const fragment = blockSchema.nodes.paragraph.create({ props: {}, format: {} }, runsToInline(runs))
  return inlineToRuns(fragment.content)
}

const mention = (display: string): RichTextRun => ({
  type: 'mention',
  annotations: { ...DEFAULT_ANNOTATIONS },
  plain_text: display,
  href: null,
  mention: { type: 'user', id: 'u1' },
})

const equation = (expr: string): RichTextRun => ({
  type: 'equation',
  annotations: { ...DEFAULT_ANNOTATIONS },
  plain_text: expr,
  href: null,
  equation: { expression: expr },
})

// ── 인라인 왕복 ───────────────────────────────────────────────────────

describe('runsToInline ↔ inlineToRuns', () => {
  test('평문이 살아남는다', () => {
    assert.equal(toPlainText(roundTripRuns([textRun('안녕하세요')])), '안녕하세요')
  })

  test('annotation 5종이 살아남는다', () => {
    const all = textRun('전부', {
      bold: true,
      italic: true,
      strikethrough: true,
      underline: true,
      code: true,
    })
    const back = roundTripRuns([all])
    assert.equal(back.length, 1)
    for (const flag of ['bold', 'italic', 'strikethrough', 'underline', 'code'] as const) {
      assert.equal(back[0].annotations[flag], true, flag)
    }
  })

  test('색이 살아남고 default 는 마크를 만들지 않는다', () => {
    const colored = roundTripRuns([textRun('빨강', { color: 'red_background' })])
    assert.equal(colored[0].annotations.color, 'red_background')

    // default 를 마크로 만들면 문서가 마크로 가득 차고 런 경계가 달라진다.
    const plain = runsToInline([textRun('기본')])
    assert.equal(plain[0].marks.length, 0)
  })

  test('계약에 없는 색은 무시한다 — 서식 하나가 페이지 저장을 막지 않게', () => {
    const node = blockSchema.text('x', [blockSchema.marks.color.create({ color: 'chartreuse' })])
    const para = blockSchema.nodes.paragraph.create({ props: {}, format: {} }, [node])
    assert.equal(inlineToRuns(para.content)[0].annotations.color, 'default')
  })

  test('링크가 살아남는다', () => {
    const linked: RichTextRun = {
      ...textRun('example'),
      href: 'https://example.com',
      text: { content: 'example', link: { url: 'https://example.com' } },
    }
    const back = roundTripRuns([linked])
    assert.equal(back[0].text?.link?.url, 'https://example.com')
    assert.equal(back[0].href, 'https://example.com')
  })

  test('mention 과 equation 이 살아남는다', () => {
    const back = roundTripRuns([textRun('앞 '), mention('@홍길동'), equation('x^2'), textRun(' 뒤')])

    assert.equal(back.length, 4)
    assert.equal(back[1].type, 'mention')
    assert.equal(back[1].plain_text, '@홍길동')
    assert.equal(back[1].mention?.type, 'user')
    assert.equal(back[2].type, 'equation')
    assert.equal(back[2].equation?.expression, 'x^2')
  })

  test('원자에 걸린 서식도 살아남는다', () => {
    const boldMention: RichTextRun = {
      ...mention('@굵은사람'),
      annotations: { ...DEFAULT_ANNOTATIONS, bold: true },
    }
    assert.equal(roundTripRuns([boldMention])[0].annotations.bold, true)
  })

  test('ProseMirror 가 합친 런이 계약 정규형으로 돌아온다', () => {
    // ProseMirror 는 인접한 같은 마크의 텍스트를 합쳐 준다. 우리가 런 경계를
    // 유지하려 해도 유지되지 않으므로 애초에 정규형으로 다룬다.
    const back = roundTripRuns([textRun('가'), textRun('나'), textRun('다')])
    assert.equal(back.length, 1)
    assert.equal(back[0].text?.content, '가나다')
  })

  test('빈 텍스트 런은 인라인 노드를 만들지 않는다', () => {
    // ProseMirror 는 빈 텍스트 노드를 거부한다.
    assert.equal(runsToInline([textRun('')]).length, 0)
    assert.deepEqual(roundTripRuns([]), [])
  })
})

// ── 오프셋 일치 ───────────────────────────────────────────────────────

describe('오프셋이 두 모델에서 같다 (원자 길이 1 판결의 회수)', () => {
  test('텍스트블록의 content 크기 = unitLength', () => {
    const cases: RichTextRun[][] = [
      [textRun('abc')],
      [mention('@아주긴이름')],
      [equation('\\frac{1}{2}')],
      [textRun('ab'), mention('@사람'), textRun('cd')],
      [mention('@a'), mention('@b'), equation('x')],
      [],
    ]

    for (const runs of cases) {
      const para = blockSchema.nodes.paragraph.create({ props: {}, format: {} }, runsToInline(runs))
      assert.equal(
        para.content.size,
        unitLength(runs),
        `ProseMirror 오프셋과 모델 오프셋이 다르다: ${JSON.stringify(runs.map((r) => r.type))}`,
      )
    }
  })

  test('원자의 nodeSize 가 1이다', () => {
    const nodes = runsToInline([mention('@아주긴이름입니다'), equation('\\sum_{i=0}^{n} i')])
    for (const node of nodes) assert.equal(node.nodeSize, 1)
  })
})

// ── 문서 왕복 ─────────────────────────────────────────────────────────

describe('docToPm ↔ pmToDoc', () => {
  test('중첩 구조가 살아남는다', () => {
    const grandchild = blk('paragraph', [textRun('손자')])
    const child = blk('bulleted_list_item', [textRun('자식')], [grandchild])
    const doc: EditorDoc = {
      blocks: [blk('heading_1', [textRun('제목')]), blk('toggle', [textRun('토글')], [child])],
    }

    const back = pmToDoc(docToPm(doc))

    assert.deepEqual(
      back.blocks.map((b) => [b.type, b.title[0]?.plain_text ?? '']),
      [
        ['heading_1', '제목'],
        ['toggle', '토글'],
      ],
    )
    const c = back.blocks[1].children?.[0]
    assert.equal(c?.id, child.id)
    assert.equal(c?.children?.[0].id, grandchild.id)
    assert.equal(c?.children?.[0].title[0]?.plain_text, '손자')
  })

  test('blockId 가 보존된다 — 새 id 를 만들면 매 저장마다 블록이 늘어난다', () => {
    const doc: EditorDoc = { blocks: [blk('paragraph', [textRun('가')]), blk('paragraph', [textRun('나')])] }
    assert.deepEqual(
      pmToDoc(docToPm(doc)).blocks.map((b) => b.id),
      doc.blocks.map((b) => b.id),
    )
  })

  test('properties 와 format 이 보존된다', () => {
    const todo: EditorBlock = {
      id: id(),
      type: 'to_do',
      title: [textRun('할 일')],
      properties: { checked: true },
      format: { block_color: 'blue_background' },
    }
    const back = pmToDoc(docToPm({ blocks: [todo] })).blocks[0]
    assert.equal(back.properties?.checked, true)
    assert.equal(back.format?.block_color, 'blue_background')
  })

  test('텍스트를 담지 않는 타입은 원자이고 title 이 없다', () => {
    const back = pmToDoc(docToPm({ blocks: [blk('divider'), blk('image')] }))
    assert.deepEqual(back.blocks.map((b) => b.type), ['divider', 'image'])
    assert.deepEqual(back.blocks[0].title, [])
  })

  test('모르는 타입은 unsupported 로 원본을 안고 왕복한다 (F-01-02)', () => {
    const exotic: EditorBlock = {
      id: id(),
      type: 'audio' as BlockType,
      title: [],
      properties: { original_type: 'audio', original_properties: { url: 'a.mp3' }, original_format: {} },
    }
    const back = pmToDoc(docToPm({ blocks: [exotic] })).blocks[0]
    assert.equal(back.type, 'unsupported')
    assert.deepEqual(back.properties?.original_properties, { url: 'a.mp3' })
  })

  test('자식 페이지 참조는 순서만 갖고 자손을 만들지 않는다', () => {
    const ref = blk('page', [textRun('하위 페이지')])
    const back = pmToDoc(docToPm({ blocks: [blk('paragraph', [textRun('본문')]), ref] }))

    assert.deepEqual(back.blocks.map((b) => b.type), ['paragraph', 'page'])
    assert.equal(back.blocks[1].id, ref.id)
    // 제목은 프로젝터가 무시하므로 빈 배열로 되돌린다.
    assert.deepEqual(back.blocks[1].title, [])
  })
})

describe('빈 문서', () => {
  test('빈 문서는 빈 문단 하나로 합성된다 — 타이핑할 자리가 필요하다', () => {
    const pm = docToPm({ blocks: [] })
    assert.equal(pm.child(0).childCount, 1)
    assert.equal(pm.child(0).child(0).child(0).type.name, 'paragraph')
  })

  test('합성된 빈 문단은 다시 빈 문서로 되돌아간다', () => {
    // 되돌리지 않으면 페이지를 열어보기만 해도 블록이 하나 생긴다.
    assert.deepEqual(pmToDoc(docToPm({ blocks: [] })).blocks, [])
  })

  test('내용이 있으면 빈 문서로 되돌리지 않는다', () => {
    const withText = pmToDoc(docToPm({ blocks: [blk('paragraph', [textRun('가')])] }))
    assert.equal(withText.blocks.length, 1)

    // 빈 문단이지만 두 개면 사용자가 만든 것이다.
    const two = pmToDoc(docToPm({ blocks: [blk('paragraph'), blk('paragraph')] }))
    assert.equal(two.blocks.length, 2)

    // 빈 heading 은 paragraph 가 아니므로 유지된다.
    const heading = pmToDoc(docToPm({ blocks: [blk('heading_1')] }))
    assert.equal(heading.blocks.length, 1)
  })
})

describe('스키마', () => {
  test('레지스트리의 MVP 12종이 모두 노드로 있다', () => {
    // 손으로 적은 목록이 아니라 레지스트리에서 생성되는지 확인한다 —
    // 어긋나면 그 타입의 블록이 에디터에서 조용히 사라진다.
    for (const type of [
      'paragraph', 'heading_1', 'heading_2', 'heading_3',
      'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle',
      'quote', 'callout', 'divider', 'image',
    ] as const) {
      assert.ok(blockSchema.nodes[type], `${type} 노드가 없다`)
      assert.equal(blockSchema.nodes[type].spec.group, 'blockContent', type)
    }
  })

  test('blockId 의 default 는 빈 문자열 센티널이다 — uuid 상수가 아니다', () => {
    // uuid 를 default 로 넣으면 ProseMirror 가 만드는 **모든** 컨테이너가
    // 같은 id 를 갖는다. 프로젝터가 한 행에 전부 덮어써서 블록이 하나만 남는다.
    // 그래서 센티널을 두고 id 는 나중에 찍는다.
    assert.equal(blockSchema.nodes.blockContainer.spec.attrs?.blockId.default, '')
  })

  test('ProseMirror 가 만든 컨테이너에도 pmToDoc 이 서로 다른 uuid 를 찍는다', () => {
    // 스키마가 인자 없이 생성한 컨테이너 = splitBlock 이 만드는 것과 같은 상태.
    const generated = blockSchema.nodes.doc.create(
      null,
      blockSchema.nodes.blockGroup.create(null, [
        blockSchema.nodes.blockContainer.createAndFill(),
        blockSchema.nodes.blockContainer.createAndFill(),
      ]),
    )
    assert.equal(String(generated.child(0).child(0).attrs.blockId), '')

    const ids = pmToDoc(generated).blocks.map((b) => b.id)
    assert.equal(ids.length, 2)
    assert.notEqual(ids[0], ids[1], '두 블록이 같은 id 를 받았다')
    for (const value of ids) {
      assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    }
  })

  test('그룹의 첫 blockContent 는 paragraph 다 — 새 블록의 기본형', () => {
    // page_ref 나 unsupported 가 먼저 등록되면 Enter 를 누를 때마다
    // 자식 페이지 참조 노드가 생긴다.
    const container = blockSchema.nodes.blockContainer.createAndFill()
    assert.ok(container)
    assert.equal(container.child(0).type.name, 'paragraph')
  })

  test('텍스트를 담는 타입만 textblock 이다', () => {
    assert.equal(blockSchema.nodes.paragraph.isTextblock, true)
    assert.equal(blockSchema.nodes.divider.isTextblock, false)
    assert.equal(blockSchema.nodes.divider.isAtom, true)
  })
})
