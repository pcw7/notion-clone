/**
 * 블록 수식 — Phase 2 1a (F-01-20 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 본문 저장(서버 명령 경로 — Y.Doc → 투영)이 수식을 `type='equation'` 행으로 쓴다 — `properties` 는 `{ expression }` 뿐(title 을
 *      실어 보내도 없다 · 색도 없다) · Y.Doc 의 요소는 `equation_block` · Y.Doc 과 행이 같은 문서
 *   ② ★ 참여자가 Y.Doc 에 넣은 수식도 행으로 투영된다(협업 경로) — 넘는 식은 잘려서
 *   ③ 자식을 실어 보내면 거부한다 · 복제가 식을 그대로 옮긴다 · 검색 색인에 식이 들어가지 않는다(본문 검색을 더럽히지 않는다)
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
import { EQUATION_TYPE } from './equation.ts'

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

const block = (
  type: string,
  text = '',
  properties: Record<string, unknown> = {},
  format: Record<string, unknown> = {},
  children: EditorBlock[] = [],
): EditorBlock => ({
  id: randomUUID(),
  type: type as EditorBlock['type'],
  title: text === '' ? [] : [textRun(text)],
  properties,
  format,
  children,
})

type Row = { id: string; type: string; properties: Record<string, unknown>; format: Record<string, unknown> }
const rowsOf = (pageId: string) =>
  query<Row>(`SELECT id, type, properties, format FROM block WHERE parent_id = $1 ORDER BY order_key, id`, [pageId])

const newPage = async () => (await createPage(fx.owner.ctx, { title: titleFromPlainText('수식') })).id

describe('① 본문 저장', () => {
  test("★ 수식은 type='equation' 행 — properties 는 { expression } 뿐 · 색 없음 · Y.Doc 과 같다", async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    // API 로 title · 색을 실어 보내도 — 수식은 식 하나뿐이다.
    const equation = { ...block(EQUATION_TYPE, '', { expression: '\\int_0^1 x\\,dx' }, { block_color: 'red' }), title: [textRun('실어 보낸 글')] }
    const saved = await savePageBody(fx.owner.ctx, pageId, { blocks: [block('paragraph', '앞'), equation] })
    assert.ok(saved.ok, JSON.stringify(saved))

    const row = (await rowsOf(pageId)).find((r) => r.id === equation.id)
    assert.equal(row?.type, EQUATION_TYPE)
    assert.deepEqual(row?.properties, { expression: '\\int_0^1 x\\,dx' })
    assert.deepEqual(row?.format, {})

    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    const read = loaded?.doc.blocks.find((b) => b.id === equation.id)
    assert.equal(read?.type, EQUATION_TYPE)
    assert.deepEqual(read?.properties, { expression: '\\int_0^1 x\\,dx' })
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
  })
})

describe('② 협업 경로', () => {
  test('★ 참여자가 Y.Doc 에 넣은 수식도 행으로 — 넘는 식은 잘려서', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const anchor = block('paragraph', '앞')
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [anchor] })).ok)

    const state = await loadDocState(fx.owner.ctx, pageId)
    assert.ok(state.ok)
    const client = peer(state.value.ydoc, 4343)
    const id = randomUUID()
    edit(client, (tr: Transaction, doc: PmNode) => {
      const { pos, node } = findBlock(doc, anchor.id)
      const schema = doc.type.schema
      tr.insert(pos + node.nodeSize, schema.nodes.blockContainer.create({ blockId: id }, [
        schema.nodes.equation_block.create({ props: { expression: 'w'.repeat(1100) }, format: {} }),
      ]))
    })
    const result = await appendDocUpdate(fx.owner.ctx, pageId, changesSince(client, state.value.ydoc), { origin: 'editor' })
    assert.ok(result.ok, JSON.stringify(result))

    let row: Row | undefined
    for (let i = 0; i < 60 && row === undefined; i += 1) {
      row = (await rowsOf(pageId)).find((r) => r.id === id)
      if (row === undefined) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(row?.type, EQUATION_TYPE)
    assert.equal((row?.properties.expression as string | undefined)?.length, 1000)
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
  })
})

describe('③ 검증 · 복제 · 색인', () => {
  test('자식을 실어 보내면 거부한다 — 수식은 자식이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const saved = await savePageBody(fx.owner.ctx, pageId, {
      blocks: [block(EQUATION_TYPE, '', { expression: 'x' }, {}, [block('paragraph', '자식')])],
    })
    assert.equal(saved.ok, false)
  })

  test('복제가 식을 그대로 옮긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [block(EQUATION_TYPE, '', { expression: 'a^2+b^2=c^2' })] })).ok)
    const copy = await duplicatePage(fx.owner.ctx, pageId)
    assert.ok('page' in copy, JSON.stringify(copy))
    assert.deepEqual((await rowsOf(copy.page.id)).map((r) => [r.type, r.properties]), [[EQUATION_TYPE, { expression: 'a^2+b^2=c^2' }]])
  })

  test('검색 색인에 식이 들어가지 않는다 — 본문 검색을 더럽히지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [block('paragraph', '본문 글'), block(EQUATION_TYPE, '', { expression: '\\mathrm{zqxjv}' })] })).ok)
    const [indexed] = await query<{ body: string }>(`SELECT body_text AS body FROM search_document WHERE doc_id = $1`, [pageId])
    assert.ok(indexed?.body.includes('본문 글'), JSON.stringify(indexed))
    assert.ok(!indexed?.body.includes('zqxjv'), JSON.stringify(indexed))
  })
})
