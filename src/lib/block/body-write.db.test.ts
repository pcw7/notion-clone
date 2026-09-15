/**
 * 참여자 경로 ① — `appendDocUpdate` 는 쌓는 트랜잭션에서 행까지 투영한다 (CRDT 5a조각 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **쌓은 update 는 같은 트랜잭션에서 행이 된다** — 행은 쌓인 Y.Doc 의 투영이다
 *   ② **투영이 받지 않는 update 는 쌓지 않는다** — 살아 있는 하위 페이지의 참조를 지운 편집. 행도 그대로다
 *      (5b조각이 정본 프로젝터대로 휴지통 전이로 바꾼다)
 *
 * 로그 자체의 성질(seq · 압축 · 재전송 · pending · 수선 · 권한)은 `collab/doc-store.db.test.ts` 가 본다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { loadDocState } from '../collab/doc-store.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { assertBodyMatchesYDoc } from '../testing/body-invariant.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { makeFixture, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { appendDocUpdate } from './body-write.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const para = (text: string, id: string = randomUUID()): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)] })
const textsOf = (doc: EditorDoc): string[] => doc.blocks.map((b) => b.title.map((r) => r.plain_text).join(''))

/** 본문이 있는 페이지 — 본문 저장이 Y.Doc 까지 만든다(4b). */
async function pageWith(owner: Actor, blocks: EditorBlock[], parentPageId: string | null = null): Promise<string> {
  const page = await createPage(owner.ctx, { parentPageId: parentPageId as never, title: titleFromPlainText('페이지') })
  const saved = await savePageBody(owner.ctx, page.id as never, { blocks })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return page.id
}

async function ydocOf(owner: Actor, pageId: string) {
  const state = await loadDocState(owner.ctx, pageId)
  if (!state.ok) throw new Error(`본문을 읽지 못했다: ${pageId}`)
  return state.value.ydoc
}

const logLength = async (pageId: string) =>
  (await query<{ n: string }>(`SELECT count(*) AS n FROM doc_update WHERE page_id = $1`, [pageId]))[0].n

describe('참여자 update 는 행으로 투영된다', () => {
  test('★ 쌓은 update 는 같은 트랜잭션에서 행이 된다 — 행은 쌓인 Y.Doc 의 투영이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await makeFixture()
    const blockId = randomUUID()
    const pageId = await pageWith(owner, [para('원문', blockId)])
    const base = await ydocOf(owner, pageId)

    const client = peer(base, 71)
    edit(client, (tr: Transaction, doc: PmNode) => {
      tr.insertText('앞 ', findBlock(doc, blockId).pos + 2)
    })
    const result = await appendDocUpdate(owner.ctx, pageId, changesSince(client, base), { origin: 'editor' })
    assert.ok(result.ok && result.appended, JSON.stringify(result))

    const rows = await loadPageBody(owner.ctx, pageId as never)
    assert.deepEqual(rows === null ? null : textsOf(rows.doc), ['앞 원문'])
    await assertBodyMatchesYDoc(owner.ctx, pageId)
  })

  test('★ 살아 있는 하위 페이지의 참조를 지운 update 는 쌓지 않는다 — 행도 하위 페이지도 그대로다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await makeFixture()
    const pageId = await pageWith(owner, [para('원문')])
    const child = await createPage(owner.ctx, { parentPageId: pageId as never, title: titleFromPlainText('하위') })
    const base = await ydocOf(owner, pageId)
    const [logBefore, rowsBefore] = [await logLength(pageId), await loadPageBody(owner.ctx, pageId as never)]

    const client = peer(base, 72)
    edit(client, (tr: Transaction, doc: PmNode) => {
      const { pos, node } = findBlock(doc, child.id)
      tr.delete(pos, pos + node.nodeSize)
    })
    assert.deepEqual(await appendDocUpdate(owner.ctx, pageId, changesSince(client, base), { origin: 'editor' }), {
      ok: false,
      reason: 'page_ref_missing',
    })

    assert.equal(await logLength(pageId), logBefore, '거부한 update 를 쌓았다')
    assert.deepEqual(await loadPageBody(owner.ctx, pageId as never), rowsBefore)
    const [row] = await query<{ lifecycle: string }>(`SELECT lifecycle FROM block WHERE id = $1`, [child.id])
    assert.equal(row.lifecycle, 'live')
    await assertBodyMatchesYDoc(owner.ctx, pageId)
  })
})
