/**
 * 목차 블록 — 잔여 묶음 8b-1 (F-01-16 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 본문 저장(서버 명령 경로 — Y.Doc → 투영)이 목차를 `type='table_of_contents'` 행으로 쓴다 — 내용은 저장하지 않는다
 *      (title 을 실어 보내도 행 · Y.Doc 에 없다) · 색 그대로 · Y.Doc 과 행이 같은 문서
 *   ② ★ 참여자가 Y.Doc 에 넣은 목차도 행으로 투영된다(협업 경로)
 *   ③ 자식을 실어 보내면 거부한다(`validateDoc` — 자식 없음) · 복제가 목차를 그대로 옮긴다
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
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { appendDocUpdate } from './body-write.ts'
import { duplicatePage } from './duplicate.ts'
import { TOC_TYPE } from './toc.ts'

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

const block = (type: string, text = '', format: Record<string, unknown> = {}, children: EditorBlock[] = []): EditorBlock => ({
  id: randomUUID(),
  type: type as EditorBlock['type'],
  title: text === '' ? [] : [textRun(text)],
  properties: {},
  format,
  children,
})

type Row = { id: string; type: string; properties: Record<string, unknown>; format: Record<string, unknown> }
const rowsOf = (pageId: string) =>
  query<Row>(`SELECT id, type, properties, format FROM block WHERE parent_id = $1 ORDER BY order_key, id`, [pageId])

const newPage = async () => (await createPage(fx.owner.ctx, { title: titleFromPlainText('목차') })).id

describe('① 본문 저장', () => {
  test("★ 목차는 type='table_of_contents' 행 — 내용을 저장하지 않는다 · 색 그대로 · Y.Doc 과 같다", async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    // API 로 title 을 실어 보내도 — 목차는 내용이 없다.
    const toc = { ...block(TOC_TYPE, '', { block_color: 'blue_background' }), title: [textRun('실어 보낸 글')] }
    const saved = await savePageBody(fx.owner.ctx, pageId, { blocks: [block('heading_1', '개요'), toc] })
    assert.ok(saved.ok, JSON.stringify(saved))

    const rows = await rowsOf(pageId)
    const row = rows.find((r) => r.id === toc.id)
    assert.equal(row?.type, TOC_TYPE)
    assert.deepEqual(row?.properties, {})
    assert.deepEqual(row?.format, { block_color: 'blue_background' })

    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    const read = loaded?.doc.blocks.find((b) => b.id === toc.id)
    assert.equal(read?.type, TOC_TYPE)
    assert.deepEqual(read?.title, [])
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
  })
})

describe('② 협업 경로', () => {
  test('★ 참여자가 Y.Doc 에 넣은 목차도 행으로 투영된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const anchor = block('heading_1', '개요')
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [anchor] })).ok)

    const state = await loadDocState(fx.owner.ctx, pageId)
    assert.ok(state.ok)
    const client = peer(state.value.ydoc, 4242)
    const tocId = randomUUID()
    edit(client, (tr: Transaction, doc: PmNode) => {
      const { pos, node } = findBlock(doc, anchor.id)
      const schema = doc.type.schema
      tr.insert(pos + node.nodeSize, schema.nodes.blockContainer.create({ blockId: tocId }, [
        schema.nodes.table_of_contents.create({ props: {}, format: { block_color: 'gray' } }),
      ]))
    })
    const result = await appendDocUpdate(fx.owner.ctx, pageId, changesSince(client, state.value.ydoc), { origin: 'editor' })
    assert.ok(result.ok, JSON.stringify(result))

    let row: Row | undefined
    for (let i = 0; i < 60 && row === undefined; i += 1) {
      row = (await rowsOf(pageId)).find((r) => r.id === tocId)
      if (row === undefined) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(row?.type, TOC_TYPE)
    assert.deepEqual(row?.format, { block_color: 'gray' })
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
  })
})

describe('③ 검증 · 복제', () => {
  test('자식을 실어 보내면 거부한다 — 목차는 자식이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const saved = await savePageBody(fx.owner.ctx, pageId, { blocks: [block(TOC_TYPE, '', {}, [block('paragraph', '자식')])] })
    assert.equal(saved.ok, false)
  })

  test('복제가 목차를 그대로 옮긴다 — 타입 · 색', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [block(TOC_TYPE, '', { block_color: 'red' }), block('heading_2', '둘')] })).ok)
    const copy = await duplicatePage(fx.owner.ctx, pageId)
    assert.ok('page' in copy, JSON.stringify(copy))
    const rows = await rowsOf(copy.page.id)
    assert.deepEqual(rows.map((r) => [r.type, r.format.block_color ?? null]), [[TOC_TYPE, 'red'], ['heading_2', null]])
  })
})
