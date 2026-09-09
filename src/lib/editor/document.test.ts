/**
 * 문서 계약 — 검증 · 행↔문서 변환 (DB 없음)
 *
 * 이 계층에서 확인하는 것:
 *   ① 모르는 타입을 **버리지 않는다** (F-01-02 라운드트립 무손실)
 *   ② 자식 페이지의 본문을 이 문서가 소유하지 않는다
 *   ③ `order_key` 가 문서 위치의 순수 함수다 (X-1 의 "파생")
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { textRun } from '../contracts/rich-text.ts'
import { UNSUPPORTED_TYPE, type BlockType } from '../block/types.ts'
import {
  projectDocument,
  rowsToDoc,
  validateDoc,
  type BodyRow,
  type EditorBlock,
} from './document.ts'

const id = () => randomUUID()

function block(type: BlockType, text = '', children: EditorBlock[] = []): EditorBlock {
  return { id: id(), type, title: text === '' ? [] : [textRun(text)], children }
}

function row(over: Partial<BodyRow> & Pick<BodyRow, 'id' | 'parent_id' | 'order_key'>): BodyRow {
  return {
    type: 'paragraph',
    properties: {},
    format: {},
    ...over,
  }
}

// ── 검증 ──────────────────────────────────────────────────────────────

describe('validateDoc', () => {
  test('정상 문서는 문제가 없다', () => {
    assert.deepEqual(
      validateDoc({ blocks: [block('paragraph', '가'), block('heading_1', '나')] }),
      [],
    )
  })

  test('id 가 uuid 가 아니면 거부한다', () => {
    const issues = validateDoc({ blocks: [{ id: 'not-a-uuid', type: 'paragraph', title: [] }] })
    assert.equal(issues.length, 1)
    assert.match(issues[0].path, /\.id$/)
  })

  test('같은 id 가 두 번 나오면 거부한다', () => {
    // 중복 id 를 통과시키면 프로젝터가 한 행을 두 번 쓰고, 두 번째가 첫 번째를
    // 덮어써서 블록 하나가 조용히 사라진다.
    const dup = id()
    const issues = validateDoc({
      blocks: [
        { id: dup, type: 'paragraph', title: [] },
        { id: dup, type: 'paragraph', title: [] },
      ],
    })
    assert.equal(issues.length, 1)
    assert.match(issues[0].message, /두 번/)
  })

  test('제목이 RichText[] 계약을 어기면 거부한다', () => {
    const bad = [{ ...textRun('x'), annotations: { ...textRun('x').annotations, color: 'nope' } }]
    const issues = validateDoc({ blocks: [{ id: id(), type: 'paragraph', title: bad as never }] })
    assert.ok(issues.length > 0)
  })

  test('자식을 가질 수 없는 타입에 자식이 붙으면 거부한다', () => {
    const issues = validateDoc({ blocks: [block('heading_1', '제목', [block('paragraph', '자식')])] })
    assert.equal(issues.length, 1)
    assert.match(issues[0].message, /자식 블록을 가질 수 없습니다/)
  })

  test('page 노드에 자식이 붙으면 거부한다 — 그 본문은 그 페이지의 문서다', () => {
    const issues = validateDoc({ blocks: [block('page', '하위', [block('paragraph', '남의 본문')])] })
    assert.equal(issues.length, 1)
    assert.match(issues[0].message, /그 페이지의 문서에 속합니다/)
  })

  test('모르는 타입은 오류가 아니다 — unsupported 로 보존한다', () => {
    const issues = validateDoc({
      blocks: [{ id: id(), type: 'audio' as BlockType, title: [] }],
    })
    assert.deepEqual(issues, [])
  })

  test('blocks 가 배열이 아니면 거부한다', () => {
    assert.equal(validateDoc({ blocks: 'nope' as never }).length, 1)
  })
})

// ── 행 → 문서 ─────────────────────────────────────────────────────────

describe('rowsToDoc', () => {
  test('order_key 순으로 중첩 트리를 만든다', () => {
    const pageId = id()
    const a = id()
    const b = id()
    const a1 = id()

    const doc = rowsToDoc(pageId, [
      row({ id: b, parent_id: pageId, order_key: 'a1', properties: { title: [textRun('나')] } }),
      row({ id: a, parent_id: pageId, order_key: 'a0', properties: { title: [textRun('가')] } }),
      row({ id: a1, parent_id: a, order_key: 'a0', properties: { title: [textRun('가-1')] } }),
    ])

    assert.deepEqual(doc.blocks.map((x) => x.title[0]?.plain_text), ['가', '나'])
    assert.deepEqual(doc.blocks[0].children?.map((x) => x.title[0]?.plain_text), ['가-1'])
  })

  test('키가 같으면 id 로 결정적으로 정렬한다 (B7)', () => {
    const pageId = id()
    const ids = [id(), id()].sort()
    const doc = rowsToDoc(pageId, [
      row({ id: ids[1], parent_id: pageId, order_key: 'a0' }),
      row({ id: ids[0], parent_id: pageId, order_key: 'a0' }),
    ])
    assert.deepEqual(doc.blocks.map((b) => b.id), ids)
  })

  test('자식 페이지는 참조 노드로만 들어가고 그 자손은 따라가지 않는다', () => {
    const pageId = id()
    const childPage = id()
    const doc = rowsToDoc(pageId, [
      row({ id: childPage, parent_id: pageId, order_key: 'a0', type: 'page' }),
      // 자식 페이지의 본문 — 조회 범위에 섞여 들어왔다고 가정한다
      row({ id: id(), parent_id: childPage, order_key: 'a0' }),
    ])
    assert.equal(doc.blocks.length, 1)
    assert.equal(doc.blocks[0].type, 'page')
    assert.deepEqual(doc.blocks[0].children, [])
  })

  test('모르는 타입의 행은 unsupported 로 읽는다', () => {
    const pageId = id()
    const doc = rowsToDoc(pageId, [
      row({ id: id(), parent_id: pageId, order_key: 'a0', type: 'video' }),
    ])
    assert.equal(doc.blocks[0].type, UNSUPPORTED_TYPE)
  })

  test('title 은 properties 에서 꺼내고 나머지는 남긴다', () => {
    const pageId = id()
    const doc = rowsToDoc(pageId, [
      row({
        id: id(),
        parent_id: pageId,
        order_key: 'a0',
        type: 'to_do',
        properties: { title: [textRun('할 일')], checked: true },
      }),
    ])
    assert.equal(doc.blocks[0].title[0]?.plain_text, '할 일')
    assert.equal(doc.blocks[0].properties?.checked, true)
    assert.equal(doc.blocks[0].properties?.title, undefined)
  })
})

// ── 문서 → 행 ─────────────────────────────────────────────────────────

describe('projectDocument', () => {
  test('order_key 는 문서 위치의 순수 함수다 — 같은 문서면 같은 키 (X-1)', () => {
    const pageId = id()
    const doc = { blocks: [block('paragraph', '가'), block('paragraph', '나'), block('paragraph', '다')] }

    const first = projectDocument(pageId, [], doc)
    const second = projectDocument(pageId, [], doc)

    assert.deepEqual(
      first.blocks.map((b) => b.orderKey),
      second.blocks.map((b) => b.orderKey),
    )
    // 결정론이 곧 "안 바뀌면 안 쓴다"의 근거다.
    assert.deepEqual(first.blocks.map((b) => b.orderKey), ['a0', 'a1', 'a2'])
  })

  test('키는 형제 그룹마다 독립이다', () => {
    const pageId = id()
    const child = block('paragraph', '자식')
    const doc = { blocks: [block('toggle', '부모', [child]), block('paragraph', '형제')] }

    const { blocks } = projectDocument(pageId, [], doc)
    const byId = new Map(blocks.map((b) => [b.id, b]))
    assert.equal(byId.get(doc.blocks[0].id)?.orderKey, 'a0')
    assert.equal(byId.get(doc.blocks[1].id)?.orderKey, 'a1')
    // 자식은 자기 그룹의 첫 번째다
    assert.equal(byId.get(child.id)?.orderKey, 'a0')
  })

  test('ancestor_path 는 페이지 경로 + 페이지 id 로 시작한다 (X-7)', () => {
    const grandparent = id()
    const pageId = id()
    const child = block('paragraph', '자식')
    const doc = { blocks: [block('toggle', '부모', [child])] }

    const { blocks } = projectDocument(pageId, [grandparent], doc)
    const byId = new Map(blocks.map((b) => [b.id, b]))

    assert.deepEqual(byId.get(doc.blocks[0].id)?.ancestorPath, [grandparent, pageId])
    assert.deepEqual(byId.get(child.id)?.ancestorPath, [grandparent, pageId, doc.blocks[0].id])
  })

  test('모르는 타입을 unsupported 로 감싸되 원본을 통째로 보존한다', () => {
    const pageId = id()
    const original = { some: 'payload', nested: { a: 1 } }
    const { blocks } = projectDocument(pageId, [], {
      blocks: [{ id: id(), type: 'audio' as BlockType, title: [], properties: original }],
    })

    assert.equal(blocks[0].type, UNSUPPORTED_TYPE)
    assert.equal(blocks[0].properties.original_type, 'audio')
    assert.deepEqual(blocks[0].properties.original_properties, original)
  })

  test('텍스트를 담지 않는 타입에는 title 을 넣지 않는다', () => {
    const pageId = id()
    const { blocks } = projectDocument(pageId, [], {
      blocks: [{ id: id(), type: 'divider', title: [textRun('버려져야 한다')] }],
    })
    assert.equal(blocks[0].properties.title, undefined)
  })

  test('title 을 계약 정규형으로 넣는다 — 인접 동일 서식이 합쳐진다', () => {
    const pageId = id()
    const { blocks } = projectDocument(pageId, [], {
      blocks: [{ id: id(), type: 'paragraph', title: [textRun('가'), textRun('나')] }],
    })
    const title = blocks[0].properties.title as { plain_text: string }[]
    assert.equal(title.length, 1)
    assert.equal(title[0].plain_text, '가나')
  })

  test('자식 페이지는 참조로 기록하고 자손을 만들지 않는다', () => {
    const pageId = id()
    const childPage = block('page', '하위 페이지')
    const { blocks, pageRefIds } = projectDocument(pageId, [], { blocks: [childPage] })

    assert.deepEqual(pageRefIds, [childPage.id])
    assert.equal(blocks.length, 1)
  })

  test('position 이 전위 순회 순서다 — 쓰기 순서가 결정적이다', () => {
    const pageId = id()
    const c1 = block('paragraph', 'c1')
    const c2 = block('paragraph', 'c2')
    const doc = { blocks: [block('toggle', 'p', [c1, c2]), block('paragraph', 'after')] }

    const { blocks } = projectDocument(pageId, [], doc)
    assert.deepEqual(
      blocks.map((b) => b.position),
      [0, 1, 2, 3],
    )
    assert.deepEqual(
      blocks.map((b) => b.id),
      [doc.blocks[0].id, c1.id, c2.id, doc.blocks[1].id],
    )
  })
})

// ── 왕복 ──────────────────────────────────────────────────────────────

describe('문서 → 행 → 문서 왕복', () => {
  test('구조와 텍스트가 보존된다', () => {
    const pageId = id()
    const doc = {
      blocks: [
        block('heading_1', '제목'),
        block('bulleted_list_item', '항목', [block('paragraph', '자식')]),
        block('divider'),
      ],
    }

    const projected = projectDocument(pageId, [], doc)
    const rows: BodyRow[] = projected.blocks.map((b) => ({
      id: b.id,
      type: b.type,
      parent_id: b.parentId,
      order_key: b.orderKey,
      properties: b.properties,
      format: b.format,
    }))

    const back = rowsToDoc(pageId, rows)

    assert.deepEqual(
      back.blocks.map((b) => [b.type, b.title[0]?.plain_text ?? '']),
      [
        ['heading_1', '제목'],
        ['bulleted_list_item', '항목'],
        ['divider', ''],
      ],
    )
    assert.deepEqual(back.blocks[1].children?.map((c) => c.title[0]?.plain_text), ['자식'])
  })
})
