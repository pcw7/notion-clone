/**
 * 인라인 데이터베이스 — 본문의 데이터베이스 참조가 저장 경로에서 지켜진다 (26번 트랙 I-1 · F-04-14, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 I-1] ① ~ ④
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 만들기 — 데이터베이스 블록이 부모 페이지 밑에(경로 · 권한 스코프를 물려받는다 · ACL 행 없음 · is_inline) · 본문에 참조
 *   ② ★ 본문 저장은 데이터베이스를 지키고 내용(이름 · format)을 쓰지 않는다 — 순서와 자리만
 *   ③ ★ 통째로 받는 저장이 참조를 빠뜨리면 거부한다(`page_ref_missing`) — 데이터베이스는 그대로(지우면 CASCADE 로 통째로 사라진다)
 *   ④ ★ 참여자 update 가 참조를 지우면 데이터베이스와 그 행이 휴지통으로(0121)
 *   ⑤ ★ 토글 안으로 옮기면 행까지 경로가 따라간다(relocateSubtree)
 *   ⑥ 이 본문의 데이터베이스가 아닌 참조는 빠진다 — 데이터베이스 확장 없는 데이터베이스 행이 생기지 않는다
 *   ⑦ 부모 본문의 색인에 데이터베이스 이름이 들지 않는다(그 데이터베이스의 것이다)
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { loadDocState } from '../collab/doc-store.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query, queryOne } from '../db/pool.ts'
import type { EditorBlock } from '../editor/document.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { appendDocUpdate } from './body-write.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'
import { createInlineDatabase } from '../database/database.ts'
import { createRow } from '../database/row.ts'

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

// ── 도우미 ────────────────────────────────────────────────────────────

async function owner(): Promise<Actor> {
  const workspaceId = await createBareWorkspace('인라인 데이터베이스')
  return joinAs(workspaceId, await createUser('소유자'), 'owner')
}

const para = (text: string, id: string = randomUUID()): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)] })
const dbRef = (id: string): EditorBlock => ({ id, type: 'database', title: [] })

/** 본문이 있는 최상위 페이지와 그 안의 인라인 데이터베이스 "할 일" — 본문은 [앞 · 데이터베이스]. */
async function pageWithInlineDb(actor: Actor) {
  const pageId = (await createPage(actor.ctx, { title: titleFromPlainText('페이지') })).id as string
  const front = randomUUID()
  const saved = await savePageBody(actor.ctx, pageId as never, { blocks: [para('앞', front)] })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const created = await createInlineDatabase(actor.ctx, { parentPageId: pageId, name: '할 일' })
  assert.equal(created.ok, true, JSON.stringify(created))
  if (!created.ok) throw new Error('unreachable')
  return { pageId, front, dbId: created.value.id, dataSourceId: created.value.dataSourceId }
}

const blockOf = (id: string) =>
  queryOne<{ type: string; parent_type: string; parent_id: string; ancestor_path: string[]; perm_scope_id: string; lifecycle: string; title: string | null; format: unknown }>(
    `SELECT type, parent_type, parent_id, ancestor_path, perm_scope_id, lifecycle, properties -> 'title' -> 0 ->> 'plain_text' AS title, format
       FROM block WHERE id = $1`,
    [id],
  )

async function ydocOf(actor: Actor, pageId: string): Promise<Y.Doc> {
  const state = await loadDocState(actor.ctx, pageId)
  if (!state.ok) throw new Error(`본문을 읽지 못했다: ${pageId}`)
  return state.value.ydoc
}

/** 참여자가 본문에서 그 참조 노드를 지운 update. */
function removingRef(base: Y.Doc, refId: string, clientId: number): Uint8Array {
  const client = peer(base, clientId)
  edit(client, (tr: Transaction, doc: PmNode) => {
    const { pos, node } = findBlock(doc, refId)
    tr.delete(pos, pos + node.nodeSize)
  })
  return changesSince(client, base)
}

describe('① 만들기', () => {
  test('★ 데이터베이스 블록이 부모 페이지 밑에 · 경로 · 스코프를 물려받는다 · ACL 행 없음 · 본문에 참조', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const actor = await owner()
    const { pageId, front, dbId } = await pageWithInlineDb(actor)
    const page = await blockOf(pageId)
    const db = await blockOf(dbId)
    assert.deepEqual(
      { type: db.type, parentType: db.parent_type, parentId: db.parent_id, path: db.ancestor_path, scope: db.perm_scope_id, lifecycle: db.lifecycle, title: db.title },
      { type: 'database', parentType: 'block', parentId: pageId, path: [pageId], scope: page.perm_scope_id, lifecycle: 'live', title: '할 일' },
    )
    assert.equal((await queryOne<{ is_inline: boolean }>(`SELECT is_inline FROM database WHERE id = $1`, [dbId])).is_inline, true)
    assert.equal((await query(`SELECT 1 FROM acl_entry WHERE node_id = $1`, [dbId])).length, 0, '부모 페이지의 권한을 상속한다')
    const body = await loadPageBody(actor.ctx, pageId as never)
    assert.deepEqual(body?.doc.blocks.map((b) => [b.id, b.type]), [[front, 'paragraph'], [dbId, 'database']], '본문 맨 뒤에 참조')
  })
})

describe('② 본문 저장은 데이터베이스를 지킨다', () => {
  test('★ 순서만 바꾸고 내용(이름 · format)을 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const actor = await owner()
    const { pageId, front, dbId } = await pageWithInlineDb(actor)
    const saved = await savePageBody(actor.ctx, pageId as never, {
      blocks: [{ ...dbRef(dbId), title: [textRun('바꾼 이름')], format: { block_color: 'red' } } as EditorBlock, para('앞', front)],
    })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    const db = await blockOf(dbId)
    assert.equal(db.title, '할 일', '이름은 그 데이터베이스의 것이다')
    assert.deepEqual(db.format, {}, 'format 도 쓰지 않는다')
    const body = await loadPageBody(actor.ctx, pageId as never)
    assert.deepEqual(body?.doc.blocks.map((b) => b.id), [dbId, front], '순서는 문서를 따른다')
  })
})

describe('③ 통째로 받는 저장이 참조를 빠뜨리면', () => {
  test('★ 거부한다(page_ref_missing) — 데이터베이스는 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const actor = await owner()
    const { pageId, front, dbId } = await pageWithInlineDb(actor)
    const saved = await savePageBody(actor.ctx, pageId as never, { blocks: [para('앞', front)] })
    assert.equal(saved.ok, false)
    assert.deepEqual(saved.ok === false && saved.reason === 'page_ref_missing' ? saved.missing : saved, [dbId])
    assert.equal((await blockOf(dbId)).lifecycle, 'live')
    assert.equal((await query(`SELECT 1 FROM database WHERE id = $1`, [dbId])).length, 1)
  })
})

describe('④ 참여자 update 가 참조를 지우면', () => {
  test('★ 데이터베이스와 그 행이 휴지통으로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const actor = await owner()
    const { pageId, dbId, dataSourceId } = await pageWithInlineDb(actor)
    const row = await createRow(actor.ctx, dataSourceId, {})
    assert.equal(row.ok, true, JSON.stringify(row))
    const rowId = row.ok ? row.value.id : ''
    const base = await ydocOf(actor, pageId)
    const result = await appendDocUpdate(actor.ctx, pageId, removingRef(base, dbId, 81), { origin: 'editor' })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal((await blockOf(dbId)).lifecycle, 'trashed')
    assert.equal((await blockOf(rowId)).lifecycle, 'trashed', '행도 함께')
    assert.equal((await query(`SELECT 1 FROM database WHERE id = $1`, [dbId])).length, 1, '지우지 않았다')
  })
})

describe('⑤ 토글 안으로 옮기면', () => {
  test('★ 데이터베이스와 행의 경로가 따라간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const actor = await owner()
    const { pageId, front, dbId, dataSourceId } = await pageWithInlineDb(actor)
    const row = await createRow(actor.ctx, dataSourceId, {})
    const rowId = row.ok ? row.value.id : ''
    assert.deepEqual((await blockOf(rowId)).ancestor_path, [pageId, dbId])
    const toggle = randomUUID()
    const saved = await savePageBody(actor.ctx, pageId as never, {
      blocks: [para('앞', front), { id: toggle, type: 'toggle', title: [textRun('묶음')], children: [dbRef(dbId)] }],
    })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    const db = await blockOf(dbId)
    assert.deepEqual({ parent: db.parent_id, path: db.ancestor_path }, { parent: toggle, path: [pageId, toggle] })
    assert.deepEqual((await blockOf(rowId)).ancestor_path, [pageId, toggle, dbId], '행도 서브트리째')
  })
})

describe('⑥ 이 본문의 데이터베이스가 아닌 참조', () => {
  test('빠진다 — 데이터베이스 확장 없는 데이터베이스 행이 생기지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const actor = await owner()
    const { pageId, front, dbId } = await pageWithInlineDb(actor)
    const stray = randomUUID()
    const saved = await savePageBody(actor.ctx, pageId as never, { blocks: [para('앞', front), dbRef(dbId), dbRef(stray)] })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.equal((await query(`SELECT 1 FROM block WHERE id = $1`, [stray])).length, 0)
    const body = await loadPageBody(actor.ctx, pageId as never)
    assert.deepEqual(body?.doc.blocks.map((b) => b.id), [front, dbId])
  })
})

describe('⑦ 색인', () => {
  test('부모 본문의 색인에 데이터베이스 이름이 들지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const actor = await owner()
    const { pageId, front, dbId } = await pageWithInlineDb(actor)
    assert.equal((await savePageBody(actor.ctx, pageId as never, { blocks: [para('앞 글', front), dbRef(dbId)] })).ok, true)
    const doc = await queryOne<{ body_text: string }>(`SELECT body_text FROM search_document WHERE page_id = $1`, [pageId])
    assert.ok(doc.body_text.includes('앞 글') && !doc.body_text.includes('할 일'), doc.body_text)
  })
})
