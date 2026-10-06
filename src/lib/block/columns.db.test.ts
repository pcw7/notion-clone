/**
 * 컬럼 — Phase 2 1c (F-01-12 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 본문 저장(서버 명령 경로)이 틀을 행으로 투영한다 — `column_list` → `column` → 블록의 부모 사슬 · 틀의 properties · format 은 비었다 ·
 *      Y.Doc 과 행이 같은 문서 · 틀은 검색 색인에 글을 보태지 않는다
 *   ② ★ 참여자가 깬 구조(컬럼 목록 밖의 컬럼)는 투영이 고쳐 쓴다 — 수선이 Y.Doc 에도 쓰고 행은 고친 문서다
 *   ③ 검증이 거부한다(컬럼 하나) · 복제가 틀째로 옮긴다
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

const blk = (type: string, text = '', children: EditorBlock[] = []): EditorBlock => ({
  id: randomUUID(),
  type: type as EditorBlock['type'],
  title: text === '' ? [] : [textRun(text)],
  properties: {},
  format: {},
  children,
})

type Row = { id: string; type: string; parent_id: string; properties: Record<string, unknown>; format: Record<string, unknown> }
const rowOf = async (id: string) =>
  (await query<Row>(`SELECT id, type, parent_id, properties, format FROM block WHERE id = $1`, [id]))[0]
/** 페이지 아래 블록의 (타입, 부모 타입) — 부모가 페이지면 'page'. */
const treeOf = async (pageId: string) =>
  (
    await query<{ type: string; parent: string; text: string }>(
      `WITH RECURSIVE t AS (
         SELECT b.id, b.type, 'page'::text AS parent, b.order_key, 0 AS depth, b.properties FROM block b WHERE b.parent_id = $1 AND b.type <> 'page'
         UNION ALL
         SELECT c.id, c.type, t.type, c.order_key, t.depth + 1, c.properties FROM block c JOIN t ON c.parent_id = t.id
       )
       SELECT type, parent, coalesce(properties->'title'->0->>'plain_text', '') AS text FROM t ORDER BY depth, order_key, id`,
      [pageId],
    )
  ).map((r) => `${r.parent}>${r.type}${r.text ? `:${r.text}` : ''}`)

const newPage = async () => (await createPage(fx.owner.ctx, { title: titleFromPlainText('컬럼') })).id

describe('① 본문 저장', () => {
  test('★ 틀이 행으로 — 부모 사슬 · 빈 properties · format · Y.Doc 과 같다 · 색인에 글을 보태지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const left = blk('column', '', [blk('paragraph', '왼쪽')])
    const right = blk('column', '', [blk('paragraph', '오른쪽')])
    const list = blk('column_list', '', [left, right])
    const saved = await savePageBody(fx.owner.ctx, pageId, { blocks: [blk('paragraph', '앞'), list] })
    assert.ok(saved.ok, JSON.stringify(saved))

    const listRow = await rowOf(list.id)
    assert.deepEqual([listRow?.type, listRow?.parent_id, listRow?.properties, listRow?.format], ['column_list', pageId, {}, {}])
    assert.deepEqual([(await rowOf(left.id))?.type, (await rowOf(left.id))?.parent_id], ['column', list.id])
    assert.equal((await rowOf(left.children![0]!.id))?.parent_id, left.id)
    assert.deepEqual((await treeOf(pageId)).sort(), ['column>paragraph:오른쪽', 'column>paragraph:왼쪽', 'column_list>column', 'column_list>column', 'page>column_list', 'page>paragraph:앞'].sort())

    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    assert.deepEqual(loaded?.doc.blocks.map((b) => b.type), ['paragraph', 'column_list'])
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
    const [indexed] = await query<{ body: string }>(`SELECT body_text AS body FROM search_document WHERE doc_id = $1`, [pageId])
    assert.ok(indexed?.body.includes('왼쪽') && indexed.body.includes('오른쪽'), JSON.stringify(indexed))
  })
})

describe('② 협업 경로', () => {
  test('★ 참여자가 컬럼 목록 밖에 넣은 컬럼 — 투영이 풀어 자식을 그 자리에(수선이 Y.Doc 에도 쓴다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const anchor = blk('paragraph', '앞')
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [anchor] })).ok)

    const state = await loadDocState(fx.owner.ctx, pageId)
    assert.ok(state.ok)
    const client = peer(state.value.ydoc, 4545)
    const columnId = randomUUID()
    const innerId = randomUUID()
    edit(client, (tr: Transaction, doc: PmNode) => {
      const { pos, node } = findBlock(doc, anchor.id)
      const schema = doc.type.schema
      const inner = schema.nodes.blockContainer.create({ blockId: innerId }, [schema.nodes.paragraph.create({ props: {}, format: {} }, schema.text('컬럼 속'))])
      tr.insert(pos + node.nodeSize, schema.nodes.blockContainer.create({ blockId: columnId }, [
        schema.nodes.column.create({ props: {}, format: {} }),
        schema.nodes.blockGroup.create(null, [inner]),
      ]))
    })
    const result = await appendDocUpdate(fx.owner.ctx, pageId, changesSince(client, state.value.ydoc), { origin: 'editor' })
    assert.ok(result.ok, JSON.stringify(result))

    let row: Row | undefined
    for (let i = 0; i < 60 && row === undefined; i += 1) {
      row = await rowOf(innerId)
      if (row === undefined) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(row?.parent_id, pageId, '컬럼 밖의 컬럼이 풀리지 않았다')
    assert.equal(await rowOf(columnId), undefined)
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
  })
})

describe('③ 검증 · 복제', () => {
  test('컬럼이 하나뿐이면 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const saved = await savePageBody(fx.owner.ctx, pageId, { blocks: [blk('column_list', '', [blk('column', '', [blk('paragraph', 'x')])])] })
    assert.equal(saved.ok, false)
  })

  test('복제가 틀째로 옮긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const blocks = [blk('column_list', '', [blk('column', '', [blk('paragraph', 'a')]), blk('column', '', [blk('paragraph', 'b')])])]
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks })).ok)
    const copy = await duplicatePage(fx.owner.ctx, pageId)
    assert.ok('page' in copy, JSON.stringify(copy))
    assert.deepEqual((await treeOf(copy.page.id)).sort(), (await treeOf(pageId)).sort())
  })
})
