/**
 * 공개 API 의 블록 JSON — 우리 블록 ↔ 노션 블록 (API-3 · F-09-01 · 순수)
 *
 *   ★ 왕복 — 우리 블록 → 노션(읽기) → 받기(쓰기) → 우리 블록이 같다: 받는 타입 전부(글 블록 · 헤딩 · 목록 · 할 일 · 토글 · 인용 · 콜아웃 ·
 *     코드 · 구분선 · 수식 · 목차 · breadcrumb · 컬럼 · 표 · 이미지 · 비디오 · 파일 · 북마크 · 임베드) · 중첩 · rich text 의 서식 · 멘션
 *   ★ 읽기 — 기본값의 노션 모양(콜아웃 💡 · plain text · is_toggleable false · color default) · 컬럼 폭은 합으로 나눈다 · 참조는
 *     child_page / child_database · 노션 모양이 없는 것은 unsupported
 *   ★ 받기의 거부 — 타입 이름을 말한다(link_to_page · child_page · 모르는 이름) · 구조(컬럼 · 표 · 중첩 2단) · 상한(100 · 1000 · 2000자) · 주소
 *   ★ 고치기 — 준 키만 바꾼다 · 글을 주지 않으면 글을 건드리지 않는다고 알린다 · 바꿀 수 없는 것(표의 열 수 · 타입 · 자식)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pageMentionRun, textRun, userMentionRun, type RichTextRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import {
  API_MAX_BLOCKS,
  apiTypeOf,
  blockContentToApi,
  columnWidthsOf,
  parseApiBlockUpdate,
  parseApiChildren,
  type BlockReadContext,
} from './block-json.ts'
import type { ApiLinks } from './rich-text.ts'

const links: ApiLinks = {
  origin: 'https://app.test',
  pageUrl: (id) => `https://app.test/w/ws/${id}`,
  fileUrl: (id) => ({ url: `https://app.test/api/files/${id}?expires=1&signature=s`, expiry_time: '2026-11-22T01:00:00.000Z' }),
}
const PAGE = '1f2e3d4c-5b6a-4789-8abc-def012345678'
const USER = '2a2e3d4c-5b6a-4789-8abc-def012345678'
const FILE = '3a2e3d4c-5b6a-4789-8abc-def012345678'

let seq = 0
const nextId = (): string => `00000000-0000-4000-8000-${String((seq += 1)).padStart(12, '0')}`

const block = (type: EditorBlock['type'], extra: Partial<EditorBlock> = {}): EditorBlock => ({
  id: nextId(),
  type,
  title: [],
  properties: {},
  format: {},
  children: [],
  ...extra,
})
const para = (text: string, extra: Partial<EditorBlock> = {}) => block('paragraph', { title: [textRun(text)], ...extra })

/** 비교의 정규형 — id 는 받기가 새로 만든다(뺀다) · 없는 칸은 빈 것. */
function canon(blocks: readonly EditorBlock[]): unknown[] {
  return blocks.map((b) => ({
    type: b.type,
    title: b.title,
    properties: b.properties ?? {},
    format: b.format ?? {},
    children: canon(b.children ?? []),
  }))
}

function readContext(blocks: readonly EditorBlock[], extra: Partial<BlockReadContext> = {}): BlockReadContext {
  return { links, refs: new Map(), fileNames: new Map([[FILE, '보고서.pdf']]), columnWidths: columnWidthsOf({ blocks }), ...extra }
}

/** 읽은 노션 블록을 그대로 요청으로 — 자식은 그 타입의 페이로드 안에(노션의 모양). */
function asRequest(b: EditorBlock, read: BlockReadContext): Record<string, unknown> {
  const content = blockContentToApi(b, read)
  const kids = b.children ?? []
  const payload = kids.length > 0 ? { ...content.payload, children: kids.map((k) => asRequest(k, read)) } : content.payload
  return { object: 'block', type: content.type, [content.type]: payload }
}

/** 모든 받는 타입 — 왕복이 닫혀야 한다. */
function everyType(): EditorBlock[] {
  return [
    para('문단', {
      title: [textRun('굵게 ', { bold: true }), textRun('링크', {}), pageMentionRun(PAGE), userMentionRun(USER)],
      format: { block_color: 'blue_background' },
      children: [para('문단의 자식')],
    }),
    block('heading_1', { title: [textRun('제목 1')], format: { block_color: 'red' } }),
    block('heading_2', { title: [textRun('제목 2')] }),
    block('heading_3', { title: [textRun('제목 3', { italic: true })] }),
    block('bulleted_list_item', { title: [textRun('점')], children: [block('numbered_list_item', { title: [textRun('번호')] })] }),
    block('to_do', { title: [textRun('할 일')], properties: { checked: true } }),
    block('to_do', { title: [textRun('안 한 일')], properties: { checked: false } }),
    block('toggle', { title: [textRun('토글')], children: [block('quote', { title: [textRun('인용')] })] }),
    block('callout', { title: [textRun('불')], properties: { icon: { type: 'emoji', emoji: '🔥' } }, children: [para('콜아웃 안')] }),
    block('callout', { title: [textRun('기본 아이콘')] }),
    block('code', { title: [textRun('print(1)\nx = 2')], properties: { language: 'python', caption: [textRun('예제')] } }),
    block('code', { title: [textRun('그냥 글')] }),
    block('divider'),
    block('equation', { properties: { expression: 'E=mc^2' } }),
    block('table_of_contents', { format: { block_color: 'gray' } }),
    block('breadcrumb'),
    block('column_list', {
      children: [
        block('column', { format: { column_ratio: 0.25 }, children: [para('왼쪽')] }),
        block('column', { format: { column_ratio: 0.75 }, children: [para('오른쪽'), block('to_do', { title: [textRun('안쪽')], properties: { checked: false } })] }),
      ],
    }),
    block('table', {
      properties: { has_column_header: true },
      children: [
        block('table_row', { properties: { cells: [[textRun('이름')], [textRun('값', { bold: true })]] } }),
        block('table_row', { properties: { cells: [[textRun('가')], []] } }),
      ],
    }),
    block('image', { properties: { source: { type: 'external', url: 'https://example.com/a.png' }, caption: [textRun('그림')] } }),
    block('image', { properties: { source: { type: 'file', file_id: FILE } } }),
    block('video', { properties: { source: { type: 'external', url: 'https://example.com/v.mp4' } } }),
    block('file', { properties: { source: { type: 'external', url: 'https://example.com/doc.pdf' }, caption: [textRun('문서')] } }),
    block('file', { properties: { source: { type: 'file', file_id: FILE } } }),
    block('bookmark', { properties: { url: 'https://example.com', caption: [textRun('북마크')] } }),
    block('embed', { properties: { url: 'https://example.com/embed' } }),
  ]
}

test('★ 왕복 — 받는 타입 전부가 우리 → 노션 → 우리로 같다(중첩 · 서식 · 멘션 · 색 · 폭 · 표 · 올린 파일)', () => {
  const ours = everyType()
  const read = readContext(ours)
  // 올린 파일은 읽은 서명 주소 그대로 돌아온다(API-7 왕복)
  const ownFileId = (url: string) => (url === links.fileUrl(FILE).url ? FILE : null)
  const parsed = parseApiChildren(ours.map((b) => asRequest(b, read)), 'body.children', 'page', nextId, { ownFileId })
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.message)
  if (!parsed.ok) return
  assert.deepEqual(canon(parsed.blocks), canon(ours))
  // 올린 파일은 DB 가 이 워크스페이스의 것인지 본다
  assert.deepEqual(
    parsed.uploads.map((u) => [u.id, u.blockType]),
    [[FILE, 'image'], [FILE, 'file']],
  )
})

test('★ 읽기 — 노션의 모양 · 기본값', () => {
  const ours = everyType()
  const read = readContext(ours)
  const api = (b: EditorBlock) => blockContentToApi(b, read)
  const [p, h1, , , , todo, , , fire, plainCallout, code, plainCode, divider, equation, toc, , columns, table, image, uploaded, , file, uploadedFile] = ours.map(api)
  assert.equal(p.type, 'paragraph')
  assert.equal(p.payload.color, 'blue_background')
  assert.equal(p.hasChildren, true)
  const runs = p.payload.rich_text as { type: string; plain_text: string; href: string | null; mention?: unknown }[]
  assert.deepEqual(runs.map((r) => r.type), ['text', 'text', 'mention', 'mention'])
  assert.equal(runs[2].href, `https://app.test/w/ws/${PAGE}`)
  assert.deepEqual(runs[3].mention, { type: 'user', user: { object: 'user', id: USER } })
  assert.deepEqual(h1.payload, { rich_text: h1.payload.rich_text, is_toggleable: false, color: 'red' })
  assert.equal(todo.payload.checked, true)
  assert.deepEqual(fire.payload.icon, { type: 'emoji', emoji: '🔥' })
  assert.deepEqual(plainCallout.payload.icon, { type: 'emoji', emoji: '💡' }, '아이콘이 없는 콜아웃은 화면처럼 💡')
  assert.equal(code.payload.language, 'python')
  assert.equal(plainCode.payload.language, 'plain text')
  assert.deepEqual(divider, { type: 'divider', payload: {}, hasChildren: false })
  assert.deepEqual(equation.payload, { expression: 'E=mc^2' })
  assert.deepEqual(toc.payload, { color: 'gray' })
  assert.equal(columns.hasChildren, true)
  assert.deepEqual(table.payload, { table_width: 2, has_column_header: true, has_row_header: false })
  assert.equal((image.payload.external as { url: string }).url, 'https://example.com/a.png')
  assert.deepEqual(
    [uploaded.payload.type, uploaded.payload.file, uploaded.payload.file_upload],
    ['file', links.fileUrl(FILE), undefined],
    '올린 파일은 노션처럼 서명 주소(API-7)',
  )
  assert.equal(file.payload.name, 'doc.pdf', '바깥 주소의 이름은 주소에서')
  assert.equal(uploadedFile.payload.name, '보고서.pdf', '올린 파일의 이름은 파일 행에서')
  const row = blockContentToApi(ours[17].children![0], read)
  assert.equal(row.type, 'table_row')
  assert.equal((row.payload.cells as unknown[][]).length, 2)
})

test('★ 읽기 — 컬럼 폭은 합으로 나누고 하나라도 없으면 싣지 않는다 · 참조 · unsupported', () => {
  const uneven = block('column_list', { children: [block('column', { format: { column_ratio: 0.2 } }), block('column', { format: { column_ratio: 0.2 } })] })
  const partial = block('column_list', { children: [block('column', { format: { column_ratio: 0.5 } }), block('column')] })
  const widths = columnWidthsOf({ blocks: [uneven, partial] })
  assert.deepEqual(uneven.children!.map((c) => widths.get(c.id)), [0.5, 0.5])
  assert.deepEqual(partial.children!.map((c) => widths.get(c.id)), [undefined, undefined])

  const child = block('page')
  const inline = block('database')
  const read = readContext([], { refs: new Map([[child.id, { title: '하위 페이지', hasChildren: true }]]) })
  assert.deepEqual(blockContentToApi(child, read), { type: 'child_page', payload: { title: '하위 페이지' }, hasChildren: true })
  assert.deepEqual(blockContentToApi(inline, read), { type: 'child_database', payload: { title: '' }, hasChildren: false }, '볼 수 없으면 빈 제목')
  for (const b of [
    block('button', { properties: { label: '누르기' } }),
    block('unsupported', { properties: { original_type: 'synced_block', original_properties: {}, original_format: {} } }),
    block('image'),
  ]) {
    assert.deepEqual(blockContentToApi(b, read), { type: 'unsupported', payload: {}, hasChildren: false }, b.type)
    assert.equal(apiTypeOf(b), 'unsupported')
  }
})

const reject = (children: unknown, pattern: RegExp, parent: EditorBlock['type'] = 'page', tableWidth?: number) => {
  const r = parseApiChildren(children, 'body.children', parent, nextId, { tableWidth })
  assert.ok(!r.ok, `받으면 안 된다: ${JSON.stringify(children).slice(0, 120)}`)
  if (!r.ok) assert.match(r.message, pattern)
}
const p = (text = 'a', extra: Record<string, unknown> = {}) => ({ type: 'paragraph', paragraph: { rich_text: [{ text: { content: text } }], ...extra } })

test('★ 받기의 거부 — 우리에게 없는 타입은 그 이름을 말한다 · child_page 는 POST /v1/pages 로', () => {
  reject([{ type: 'link_to_page', link_to_page: { page_id: PAGE } }], /body\.children\[0\]\.type "link_to_page" is not supported/)
  reject([{ synced_block: { synced_from: null } }], /"synced_block" is not supported/)
  reject([{ type: 'child_page', child_page: { title: '새' } }], /child_page.*POST \/v1\/pages/)
  reject([{ type: 'child_database', child_database: { title: '표' } }], /"child_database" cannot be created/)
  reject([{ type: 'foo', foo: {} }], /type should be a block type, instead was `"foo"`/)
  reject([{ ...p(), id: PAGE }], /body\.children\[0\]\.id should be not present/)
  reject([{ type: 'paragraph', paragraph: {} }], /paragraph\.rich_text should be defined/)
  reject([{ type: 'divider', divider: { color: 'red' } }], /divider\.color should be not present/)
  reject([{ type: 'heading_1', heading_1: { rich_text: [], is_toggleable: true } }], /is_toggleable should be false/)
  reject([{ type: 'heading_2', heading_2: { rich_text: [], children: [p()] } }], /heading_2\.children should be not present/)
  reject([{ type: 'callout', callout: { rich_text: [], icon: { type: 'external', external: { url: 'https://x.test/i.png' } } } }], /icon\.type `"external"` is not supported/)
  reject([{ type: 'image', image: { type: 'file', file: { url: 'https://x.test/a.png' } } }], /image\.file\.url should be a file URL read from this API/)
  reject([{ type: 'image', image: { external: { url: 'javascript:alert(1)' } } }], /external\.url should be an http or https URL/)
  reject([{ type: 'bookmark', bookmark: { url: 'ftp://x.test' } }], /bookmark\.url should be an http or https URL/)
  reject([{ type: 'code', code: { rich_text: [], language: 'x'.repeat(65) } }], /language\.length should be ≤ 64/)
  reject([{ type: 'equation', equation: { expression: 'x'.repeat(1001) } }], /expression\.length should be ≤ 1000/)
})

test('★ 받기 — 읽은 `{type:"file", file:{url}}` 을 그대로 보내면 같은 파일(API-7 왕복) · 우리 주소가 아니면 거부 · 옛 file_upload 도 받는다', () => {
  const ownFileId = (url: string) => (url === links.fileUrl(FILE).url ? FILE : null)
  const read = { type: 'image', image: { type: 'file', file: links.fileUrl(FILE), caption: [] } }
  const r = parseApiChildren([read, { type: 'file', file: { file_upload: { id: FILE }, name: '보고서.pdf' } }], 'body.children', 'page', nextId, { ownFileId })
  assert.ok(r.ok, r.ok ? '' : r.message)
  if (!r.ok) return
  assert.deepEqual(r.blocks.map((b) => b.properties.source), [{ type: 'file', file_id: FILE }, { type: 'file', file_id: FILE }])
  assert.deepEqual(r.uploads, [
    { id: FILE, blockType: 'image', path: 'body.children[0].image.file.url' },
    { id: FILE, blockType: 'file', path: 'body.children[1].file.file_upload.id' },
  ])
  const foreign = parseApiChildren([{ type: 'image', image: { type: 'file', file: { url: 'https://cdn.test/a.png' } } }], 'body.children', 'page', nextId, { ownFileId })
  assert.ok(!foreign.ok && /use "external" for other URLs/.test(foreign.message))
  const updated = parseApiBlockUpdate(block('video'), { file: links.fileUrl(FILE) }, 'body.video', { ownFileId })
  assert.ok(updated.ok && updated.next.properties.source !== undefined && updated.uploads[0]?.path === 'body.video.file.url')
})

test('★ 받기의 거부 — 구조(컬럼 · 표 · 중첩 2단)', () => {
  const column = (kids: unknown[] = [p()]) => ({ type: 'column', column: { children: kids } })
  reject([column()], /type "column" can only be a child of a column_list/)
  reject([{ type: 'column_list', column_list: { children: [column()] } }], /column_list\.children should have at least 2 columns/)
  reject([{ type: 'column_list', column_list: { children: [column(), column([])] } }], /column\.children should have at least 1 block/)
  reject([{ type: 'column_list', column_list: { children: [column(), p()] } }], /should be "column" inside a column_list/)
  reject([{ type: 'column_list', column_list: { children: [] } }], /"column_list" cannot be placed directly inside a column/, 'column')
  reject([{ type: 'table_row', table_row: { cells: [] } }], /"table_row" can only be a child of a table/)
  reject([{ type: 'table', table: { table_width: 2, children: [{ type: 'table_row', table_row: { cells: [[]] } }] } }], /cells should have 2 cells/)
  reject([{ type: 'table', table: { table_width: 2 } }], /table\.children should have at least 1 table_row/)
  reject([p()], /should be "table_row" inside a table/, 'table', 2)

  // 두 단까지는 받는다 — 컬럼 목록 > 컬럼 > 문단 · 토글 > 토글 > 문단
  const toggle = (kids: unknown[]) => ({ type: 'toggle', toggle: { rich_text: [], children: kids } })
  const twoDeep = parseApiChildren([toggle([toggle([p()])]), { type: 'column_list', column_list: { children: [column(), column()] } }], 'body.children', 'page', nextId)
  assert.ok(twoDeep.ok, twoDeep.ok ? '' : twoDeep.message)
  reject([toggle([toggle([toggle([p()])])])], /children\[0\]\.toggle\.children\[0\]\.toggle\.children should be not present — a request can nest children at most 2 levels/)
})

test('★ 받기의 상한 — 한 배열 100 · 한 요청 1000 · 글 조각 2000자 · 2000자 조각 여럿은 받는다', () => {
  reject(Array.from({ length: 101 }, () => p()), /body\.children\.length should be ≤ 100, instead was 101/)
  const toggles = Array.from({ length: 10 }, () => ({ type: 'toggle', toggle: { rich_text: [], children: Array.from({ length: 100 }, () => p()) } }))
  reject(toggles, new RegExp(`more than ${API_MAX_BLOCKS} blocks`))
  reject([p('x'.repeat(2001))], /rich_text\[0\]\.text\.content\.length should be ≤ 2000/)
  const long = parseApiChildren([{ type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'x'.repeat(2000) } }, { text: { content: 'y'.repeat(500) } }] } }], 'body.children', 'page', nextId)
  assert.ok(long.ok, long.ok ? '' : long.message)
  if (long.ok) assert.equal(long.blocks[0].title.map((r: RichTextRun) => r.plain_text).join('').length, 2500)
})

test('받기 — 정규형으로 쓴다(기본값은 키가 없다) · 페이지의 맨 위 · 표 밑의 행', () => {
  const r = parseApiChildren(
    [
      p('색', { color: 'default' }),
      { type: 'callout', callout: { rich_text: [], icon: { emoji: '💡' } } },
      { type: 'code', code: { rich_text: [{ text: { content: 'x' }, annotations: { bold: true } }], language: 'Plain Text', caption: [] } },
      { type: 'bookmark', bookmark: { url: '' } },
      { type: 'to_do', to_do: { rich_text: [] } },
    ],
    'body.children',
    'page',
    nextId,
  )
  assert.ok(r.ok, r.ok ? '' : r.message)
  if (!r.ok) return
  assert.deepEqual(r.blocks.map((b) => [b.type, b.properties, b.format]), [
    ['paragraph', {}, {}],
    ['callout', {}, {}],
    ['code', {}, {}],
    ['bookmark', {}, {}],
    ['to_do', { checked: false }, {}],
  ])
  assert.deepEqual(r.blocks[2].title, [textRun('x')], '코드는 평문(서식을 버린다)')
  const rows = parseApiChildren([{ type: 'table_row', table_row: { cells: [[], [{ text: { content: '셀' } }]] } }], 'body.children', 'table', nextId, { tableWidth: 2 })
  assert.ok(rows.ok, rows.ok ? '' : rows.message)
})

test('★ 고치기 — 준 키만 바꾼다 · 글을 주지 않으면 textChanged 가 거짓이다', () => {
  const todo = block('to_do', { title: [textRun('그대로')], properties: { checked: false }, format: { block_color: 'red' } })
  const checked = parseApiBlockUpdate(todo, { checked: true }, 'body.to_do')
  assert.ok(checked.ok)
  if (checked.ok) {
    assert.deepEqual([checked.next.title, checked.next.properties, checked.next.format, checked.textChanged], [todo.title, { checked: true }, { block_color: 'red' }, false])
  }
  const text = parseApiBlockUpdate(todo, { rich_text: [{ text: { content: '새 글' } }], color: 'default' }, 'body.to_do')
  assert.ok(text.ok)
  if (text.ok) assert.deepEqual([text.next.title, text.next.format, text.textChanged], [[textRun('새 글')], {}, true])

  const code = block('code', { title: [textRun('x')], properties: { language: 'python', caption: [textRun('c')] } })
  const plain = parseApiBlockUpdate(code, { language: 'plain text', caption: [] }, 'body.code')
  assert.ok(plain.ok)
  if (plain.ok) assert.deepEqual(plain.next.properties, {})
  const js = parseApiBlockUpdate(code, { language: 'javascript' }, 'body.code')
  assert.ok(js.ok && js.next.properties?.language === 'javascript')

  const table = block('table', { children: [block('table_row', { properties: { cells: [[], []] } })] })
  const header = parseApiBlockUpdate(table, { has_row_header: true, table_width: 2 }, 'body.table')
  assert.ok(header.ok && header.next.properties?.has_row_header === true && header.next.children?.length === 1)
  const row = table.children![0]
  const cells = parseApiBlockUpdate(row, { cells: [[{ text: { content: 'a' } }], []] }, 'body.table_row', { tableWidth: 2 })
  assert.ok(cells.ok && cells.cellsChanged)

  const refused: [EditorBlock, unknown, RegExp, number?][] = [
    [table, { table_width: 3 }, /table_width cannot be changed \(the table has 2 columns\)/],
    [row, { cells: [[]] }, /cells should have 2 cells/, 2],
    [todo, { children: [] }, /to_do\.children should be not present/],
    [todo, { checked: 'yes' }, /checked should be a boolean/],
    [block('button'), {}, /cannot be updated — blocks of type "unsupported"/],
    [block('page'), {}, /"child_page" are not editable/],
  ]
  for (const [b, payload, pattern, width] of refused) {
    const r = parseApiBlockUpdate(b, payload, `body.${apiTypeOf(b)}`, { tableWidth: width })
    assert.ok(!r.ok, JSON.stringify(payload))
    if (!r.ok) assert.match(r.message, pattern)
  }
})
