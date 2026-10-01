/**
 * 코드 블록 — 잔여 묶음 8a-1 (F-01-14 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 본문 저장(서버 명령 경로 — Y.Doc → 투영)이 코드 블록을 `type='code'` 행으로 쓴다 — 글자(줄바꿈 · 탭) · 언어(목록 밖의
 *      값도) 그대로 · 색 없음 · Y.Doc 과 행이 같은 문서
 *   ② 코드 글자가 검색 색인에 들어간다
 *   ③ 언어가 문자열이 아니면 저장을 거부한다(`validateDoc`)
 *   ④ (8a-2) ★ 참여자가 쓴 언어 · 캡션 · 줄바꿈이 행으로 간다 — 행과 Y.Doc 이 같은 문서
 *   ⑤ (8a-2) ★ 참여자가 모양이 틀린 캡션을 써도 투영 · 색인 · 복제가 멈추지 않는다 — 행에는 정화된 값, Y.Doc 도 수선된다
 *      (정본 §3.4 [보강] 코드 블록 ⑧ — 전에는 그 페이지의 투영이 영구히 멈췄다)
 *   ⑤ (8a-2) ★ 순수 `caption: [null]`(null 만 다른 정화 — y-prosemirror 의 비교가 보지 못한다)도 수선이 같은 seq 에 쌓인다 ·
 *      ★ bigint 를 쓴 참여자 update 도 쌓이고 행에는 그 값이 빠진다 — 투영의 직렬화가 던지지 않는다(정본 ⑧ · `json-safe.ts`)
 *   ⑥ (8a-2) 본문 저장 API 는 모양이 틀린 캡션 · 32단계보다 깊은 속성을 거부한다(`validateDoc` — 정화와 같은 문)
 *   ⑦ (8a-2 리뷰) ★ 받은 캡션의 `plain_text` 가 없어도 같은 본문을 다시 저장하면 아무것도 쓰지 않는다 — 쓰는 쪽도 읽기와 같은 정규형
 *      (전에는 저장할 때마다 수선이 고쳐 써 로그가 한 줄씩 자랐다) · ★ 참여자가 쓴 U+0000(jsonb 가 거부한다)도 투영이 멈추지 않는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { query } from '../db/pool.ts'
import { assertBodyMatchesYDoc } from '../testing/body-invariant.ts'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'
import { loadDocState } from '../collab/doc-store.ts'
import { readBodyYDoc } from '../collab/ydoc.ts'
import { changesSince, contentElementOf, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { appendDocUpdate } from './body-write.ts'
import { duplicatePage } from './duplicate.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const code = (text: string, properties: Record<string, unknown> = {}, format: Record<string, unknown> = {}): EditorBlock => ({
  id: randomUUID(),
  type: 'code',
  title: [textRun(text)],
  properties,
  format,
  children: [],
})

const newPage = async () => (await createPage(fx.owner.ctx, { title: titleFromPlainText('코드 블록') })).id

describe('① 본문 저장', () => {
  test("★ 코드 블록은 type='code' 행 — 글자 · 언어(목록 밖의 값도) 그대로 · 색 없음 · Y.Doc 과 같다", async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const a = code('def f():\n\treturn "```"', { language: 'python' }, { block_color: 'red', code_wrap: true })
    const b = code('x := 1', { language: 'my weird lang' })

    const saved = await savePageBody(fx.owner.ctx, pageId, { blocks: [a, b] })
    assert.ok(saved.ok, JSON.stringify(saved))

    const rows = await query<{ id: string; type: string; properties: Record<string, unknown>; format: Record<string, unknown> }>(
      `SELECT id, type, properties, format FROM block WHERE parent_id = $1 ORDER BY order_key, id`,
      [pageId],
    )
    assert.deepEqual(
      rows.map((r) => [r.id, r.type, r.properties.language]),
      [
        [a.id, 'code', 'python'],
        [b.id, 'code', 'my weird lang'],
      ],
    )
    const text = (rows[0]?.properties.title as { plain_text: string }[]).map((r) => r.plain_text).join('')
    assert.equal(text, 'def f():\n\treturn "```"')
    assert.equal(rows[0]?.format.block_color, undefined, '색을 지원하지 않는 코드 블록에 색이 남았다')
    assert.equal(rows[0]?.format.code_wrap, true, '줄바꿈 설정이 사라졌다')

    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    assert.deepEqual(loaded?.doc.blocks.map((x) => x.type), ['code', 'code'])
    // 색은 행에서만 빠지고 Y.Doc 에 남으면 두 본문이 갈린다(8a-1 이 찾은 옛 틈 — 구분선 · 이미지도 같았다).
    const ydoc = await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
    assert.equal(ydoc.blocks[0]?.format?.block_color, undefined)
  })
})

describe('② 검색', () => {
  test('코드 글자가 본문 색인에 들어간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [code('const answerToEverything = 42')] })).ok)
    const [row] = await query<{ body_text: string }>(`SELECT body_text FROM search_document WHERE doc_id = $1`, [pageId])
    assert.ok(row?.body_text.includes('answerToEverything'), row?.body_text)
  })
})

describe('③ 검증', () => {
  test('언어가 문자열이 아니면 저장을 거부한다 — 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const saved = await savePageBody(fx.owner.ctx, pageId, { blocks: [code('x', { language: 42 })] })
    assert.equal(saved.ok, false)
    const rows = await query(`SELECT 1 FROM block WHERE parent_id = $1`, [pageId])
    assert.equal(rows.length, 0)
  })
})

// ── 참여자 경로 (8a-2) ────────────────────────────────────────────────

/** 코드 블록 하나가 든 페이지와 그 Y.Doc. */
async function codePage(block: EditorBlock) {
  const pageId = await newPage()
  assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [block] })).ok)
  const state = await loadDocState(fx.owner.ctx, pageId)
  assert.ok(state.ok)
  return { pageId, base: state.value.ydoc }
}

/** 참여자가 그 코드 블록의 props · format 을 바꾼 update — 명령을 거치지 않는다(검증 없이 무엇이든 쓸 수 있다). */
function settingAttrs(base: Parameters<typeof peer>[0], blockId: string, props: unknown, format: unknown, clientId: number) {
  const client = peer(base, clientId)
  edit(client, (tr: Transaction, doc: PmNode) => {
    const { pos, node } = findBlock(doc, blockId)
    const content = node.child(0)
    tr.setNodeMarkup(pos + 1, undefined, { ...content.attrs, props, format })
  })
  return changesSince(client, base)
}

describe('④ 참여자 경로', () => {
  test('★ 참여자가 쓴 언어 · 캡션 · 줄바꿈이 행으로 간다 — 행과 Y.Doc 이 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const block = code('print(1)')
    const { pageId, base } = await codePage(block)
    const update = settingAttrs(base, block.id, { language: 'python', caption: [textRun('예제')] }, { code_wrap: true }, 81)
    const result = await appendDocUpdate(fx.owner.ctx, pageId, update, { origin: 'editor' })
    assert.ok(result.ok && result.appended, JSON.stringify(result))
    assert.equal(result.repair, null, '멀쩡한 값을 고쳐 썼다')

    const [row] = await query<{ properties: Record<string, unknown>; format: Record<string, unknown> }>(
      `SELECT properties, format FROM block WHERE id = $1`,
      [block.id],
    )
    assert.equal(row?.properties.language, 'python')
    assert.deepEqual((row?.properties.caption as { plain_text: string }[]).map((r) => r.plain_text), ['예제'])
    assert.equal(row?.format.code_wrap, true)
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
  })
})

describe('⑤ 모양이 틀린 캡션 (poison)', () => {
  test('★ 참여자가 caption [null] · 문자열이 아닌 plain_text 를 써도 투영 · 색인 · 복제가 멈추지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const block = code('const poisoned = true')
    const { pageId, base } = await codePage(block)
    const hostile = { ...textRun('살아남은 캡션'), plain_text: { toString: 0 } }
    const update = settingAttrs(base, block.id, { caption: [null, hostile], language: 42 }, { code_wrap: 'yes' }, 82)
    const result = await appendDocUpdate(fx.owner.ctx, pageId, update, { origin: 'editor' })
    assert.ok(result.ok && result.appended, JSON.stringify(result))
    assert.ok(result.repair, '고친 것을 Y.Doc 에 쓰지 않았다 — 보낸 쪽이 모양이 틀린 값을 계속 갖는다')

    // 행 — 정화된 값(런은 plain_text 를 다시 계산했다 · 언어 · 줄바꿈은 빠졌다)
    const [row] = await query<{ properties: Record<string, unknown>; format: Record<string, unknown> }>(
      `SELECT properties, format FROM block WHERE id = $1`,
      [block.id],
    )
    assert.deepEqual(row?.properties, { title: row?.properties.title, caption: [{ ...hostile, plain_text: '살아남은 캡션' }] })
    assert.deepEqual(row?.format, {})
    // 색인 — 캡션까지 들어간다(전에는 여기서 던져 투영이 멈췄다)
    const [search] = await query<{ body_text: string }>(`SELECT body_text FROM search_document WHERE doc_id = $1`, [pageId])
    assert.ok(search?.body_text.includes('살아남은 캡션'), search?.body_text)
    // Y.Doc 도 수선됐다 — 행과 같은 문서
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
    // 그 뒤의 편집도 투영된다 — 페이지가 멈추지 않았다
    const state = await loadDocState(fx.owner.ctx, pageId)
    assert.ok(state.ok)
    const next = settingAttrs(state.value.ydoc, block.id, { language: 'typescript' }, {}, 83)
    assert.ok((await appendDocUpdate(fx.owner.ctx, pageId, next, { origin: 'editor' })).ok)
    const [after] = await query<{ properties: Record<string, unknown> }>(`SELECT properties FROM block WHERE id = $1`, [block.id])
    assert.equal(after?.properties.language, 'typescript')
    // 복제 — 사본이 만들어진다
    const copy = await duplicatePage(fx.owner.ctx, pageId)
    assert.equal(copy.pages, 1)
  })
})

describe('⑤ 순수 null · bigint (Y 에 직접 쓰는 참여자)', () => {
  /** 참여자가 코드 블록의 Y attr 에 직접 쓴 update — y-prosemirror 의 쓰기를 거치지 않는다(null 만 다른 값도 실린다). */
  function writingYAttrs(base: Parameters<typeof peer>[0], blockId: string, attrs: Record<string, unknown>, clientId: number) {
    const client = peer(base, clientId)
    const element = contentElementOf(client, blockId)
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value as never)
    return changesSince(client, base)
  }

  test('★ 순수 caption [null](대표 poison · null 만 다른 정화) — 수선이 같은 seq 에 쌓이고 로그로 다시 읽은 Y.Doc 에 고칠 것이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const block = code('x = 1')
    const { pageId, base } = await codePage(block)
    const result = await appendDocUpdate(fx.owner.ctx, pageId, writingYAttrs(base, block.id, { props: { caption: [null] } }, 84), {
      origin: 'editor',
    })
    assert.ok(result.ok && result.appended, JSON.stringify(result))
    assert.ok(result.repair, '수선을 쓰지 않았다 — Y.Doc 에 [null] 이 남는다')

    const [row] = await query<{ properties: Record<string, unknown> }>(`SELECT properties FROM block WHERE id = $1`, [block.id])
    assert.deepEqual(row?.properties.caption, [])
    const state = await loadDocState(fx.owner.ctx, pageId)
    assert.ok(state.ok)
    assert.deepEqual(readBodyYDoc(state.value.ydoc, pageId).fixes, [], '로그로 다시 읽은 Y.Doc 에 고칠 것이 남았다')
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
  })

  test('★ bigint — 참여자 update 가 쌓이고 · 행에는 그 값이 빠지고 · 다음 편집도 투영된다(투영의 직렬화가 던지지 않는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const block = code('big')
    const { pageId, base } = await codePage(block)
    const update = writingYAttrs(
      base,
      block.id,
      {
        format: { code_wrap: true, x: 1n },
        props: { language: 'rust', caption: [{ ...textRun('큰 수 캡션'), href: 2n }], n: [3n] },
      },
      85,
    )
    const result = await appendDocUpdate(fx.owner.ctx, pageId, update, { origin: 'editor' })
    assert.ok(result.ok && result.appended, JSON.stringify(result))
    assert.ok(result.repair, '수선을 쓰지 않았다 — Y.Doc 에 bigint 가 남는다')

    const [row] = await query<{ properties: Record<string, unknown>; format: Record<string, unknown> }>(
      `SELECT properties, format FROM block WHERE id = $1`,
      [block.id],
    )
    assert.deepEqual(row?.format, { code_wrap: true })
    assert.equal(row?.properties.language, 'rust')
    assert.deepEqual(row?.properties.n, [], '배열 안의 bigint 원소가 남았다')
    assert.deepEqual((row?.properties.caption as { plain_text: string }[]).map((r) => r.plain_text), ['큰 수 캡션'])
    const [search] = await query<{ body_text: string }>(`SELECT body_text FROM search_document WHERE doc_id = $1`, [pageId])
    assert.ok(search?.body_text.includes('큰 수 캡션'), search?.body_text)
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)

    const state = await loadDocState(fx.owner.ctx, pageId)
    assert.ok(state.ok)
    const next = settingAttrs(state.value.ydoc, block.id, { language: 'go' }, {}, 86)
    assert.ok((await appendDocUpdate(fx.owner.ctx, pageId, next, { origin: 'editor' })).ok)
    const [after] = await query<{ properties: Record<string, unknown> }>(`SELECT properties FROM block WHERE id = $1`, [block.id])
    assert.equal(after?.properties.language, 'go')
  })
})

describe('⑥ 본문 저장 API', () => {
  test('모양이 틀린 캡션은 저장을 거부한다 — 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const saved = await savePageBody(fx.owner.ctx, pageId, { blocks: [code('x', { caption: [null] })] })
    assert.equal(saved.ok, false)
    assert.equal((await query(`SELECT 1 FROM block WHERE parent_id = $1`, [pageId])).length, 0)
  })
})

describe('⑦ 쓰는 쪽의 정규형 · U+0000 (8a-2 리뷰)', () => {
  const logRows = async (pageId: string) =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM doc_update WHERE page_id = $1`, [pageId]))[0]?.n ?? 0)

  test('★ plain_text 가 없는 요청 모양의 캡션 — 같은 본문을 다시 저장해도 로그가 늘지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const requestShaped = { type: 'text', text: { content: '요청 모양', link: null }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }
    const doc = { blocks: [code('x', { caption: [requestShaped] })] }
    assert.ok((await savePageBody(fx.owner.ctx, pageId, doc)).ok)
    const after1 = await logRows(pageId)
    assert.ok((await savePageBody(fx.owner.ctx, pageId, doc)).ok)
    assert.equal(await logRows(pageId), after1, '같은 본문을 다시 저장했는데 로그가 자랐다 — 읽기가 고친 것을 또 썼다')
    const state = await loadDocState(fx.owner.ctx, pageId)
    assert.ok(state.ok)
    assert.deepEqual(readBodyYDoc(state.value.ydoc, pageId).fixes, [], 'Y.Doc 에 읽기가 고칠 것이 남았다')
  })

  test('★ 글자에 U+0000 이 든 본문 — 같은 본문을 다시 저장해도 로그가 늘지 않는다(쓸 때도 U+FFFD 로)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const para: EditorBlock = { id: randomUUID(), type: 'paragraph', title: [textRun('p\u0000q')], properties: {}, format: {}, children: [] }
    const doc = { blocks: [code('a\u0000b', { caption: [textRun('c\u0000')] }), para] }
    assert.ok((await savePageBody(fx.owner.ctx, pageId, doc)).ok)
    const after1 = await logRows(pageId)
    assert.ok((await savePageBody(fx.owner.ctx, pageId, doc)).ok)
    assert.equal(await logRows(pageId), after1, '같은 본문을 다시 저장했는데 로그가 자랐다')
    const rows = await query<{ properties: Record<string, unknown> }>(`SELECT properties FROM block WHERE parent_id = $1 ORDER BY order_key, id`, [pageId])
    assert.deepEqual(
      rows.map((r) => (r.properties.title as { plain_text: string }[]).map((t) => t.plain_text).join('')),
      ['a\uFFFDb', 'p\uFFFDq'],
    )
  })

  test('32단계보다 깊은 속성은 저장을 거부한다 — 읽기가 잘라 낼 값을 받고 성공이라 답하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    let deep: unknown = 'bottom'
    for (let i = 0; i < 40; i += 1) deep = { d: deep }
    const saved = await savePageBody(fx.owner.ctx, pageId, { blocks: [code('x', { extra: deep })] })
    assert.equal(saved.ok, false, JSON.stringify(saved))
  })

  test('★ 참여자가 캡션 · 코드 글자에 쓴 U+0000 — update 가 쌓이고 행에는 U+FFFD · 다음 편집도 투영된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const block = code('nul')
    const { pageId, base } = await codePage(block)
    const client = peer(base, 87)
    const element = contentElementOf(client, block.id)
    element.setAttribute('props', { caption: [textRun('캡\u0000션')] } as never)
    ;(element.get(0) as unknown as { insert: (i: number, t: string) => void }).insert(0, 'z\u0000')
    const result = await appendDocUpdate(fx.owner.ctx, pageId, changesSince(client, base), { origin: 'editor' })
    assert.ok(result.ok && result.appended, JSON.stringify(result))
    assert.ok(result.repair, '수선을 쓰지 않았다 — Y.Doc 에 U+0000 이 남는다')
    const [row] = await query<{ properties: Record<string, unknown> }>(`SELECT properties FROM block WHERE id = $1`, [block.id])
    assert.deepEqual((row?.properties.caption as { plain_text: string }[]).map((r) => r.plain_text), ['캡\uFFFD션'])
    const title = (row?.properties.title as { plain_text: string }[]).map((r) => r.plain_text).join('')
    assert.equal(title, 'z\uFFFDnul')
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)

    const state = await loadDocState(fx.owner.ctx, pageId)
    assert.ok(state.ok)
    const next = settingAttrs(state.value.ydoc, block.id, { language: 'go' }, {}, 88)
    assert.ok((await appendDocUpdate(fx.owner.ctx, pageId, next, { origin: 'editor' })).ok)
    const [after] = await query<{ properties: Record<string, unknown> }>(`SELECT properties FROM block WHERE id = $1`, [block.id])
    assert.equal(after?.properties.language, 'go')
  })
})
