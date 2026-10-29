/**
 * 인라인 데이터베이스 — 휴지통 · 되살리기 · 영구 삭제 · 이동 · 복제 (26번 트랙 I-1b · F-04-14, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 I-1] ④ ⑤
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 버리기 — 데이터베이스와 행이 휴지통으로 · 부모 본문에서 참조가 빠진다
 *   ② ★ 되살리기 — 살아나고 참조가 원래 자리(앞 형제 뒤)로 돌아온다
 *   ③ 휴지통 목록 — 삭제 루트로 이름과 함께 · 함께 들어간 행의 수
 *   ④ ★ 영구 삭제 → 물리 삭제 — 데이터베이스 · 소스 · 행이 깨끗이 지워진다(CASCADE 순서로 깨지지 않는다)
 *   ⑤ 이동 명령은 인라인 데이터베이스를 옮기지 않는다(본문 안에서만 — 풀페이지로 바꾸기는 v2)
 *   ⑥ ★ 페이지 복제 — 사본에 인라인 데이터베이스(와 그 행)를 싣지 않고 그 수를 말한다 · 사본 본문에 참조가 없다
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { loadDocState } from '../collab/doc-store.ts'
import { readBodyYDoc } from '../collab/ydoc.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query, queryOne } from '../db/pool.ts'
import type { EditorBlock } from '../editor/document.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'
import { listTrash, purgePage, restorePage, trashPage } from './trash.ts'
import { runTrashHardDelete, PURGED_HARD_DELETE_DAYS } from './trash-hard-delete.ts'
import { movePage, MoveError } from './move-page.ts'
import { duplicatePage } from './duplicate.ts'
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

const para = (text: string, id: string = randomUUID()): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)] })

/** 본문 [앞 · 데이터베이스 "할 일"(행 둘) · 뒤] 인 최상위 페이지. */
async function fixture() {
  const workspaceId = await createBareWorkspace('인라인 데이터베이스 휴지통')
  const actor: Actor = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const pageId = (await createPage(actor.ctx, { title: titleFromPlainText('페이지') })).id as string
  const front = randomUUID()
  const back = randomUUID()
  assert.equal((await savePageBody(actor.ctx, pageId as never, { blocks: [para('앞', front)] })).ok, true)
  const created = await createInlineDatabase(actor.ctx, { parentPageId: pageId, name: '할 일' })
  if (!created.ok) throw new Error(JSON.stringify(created))
  const dbId = created.value.id
  assert.equal((await savePageBody(actor.ctx, pageId as never, { blocks: [para('앞', front), { id: dbId, type: 'database', title: [] }, para('뒤', back)] })).ok, true)
  const rows: string[] = []
  for (let i = 0; i < 2; i += 1) {
    const row = await createRow(actor.ctx, created.value.dataSourceId, {})
    if (!row.ok) throw new Error(JSON.stringify(row))
    rows.push(row.value.id)
  }
  return { workspaceId, actor, pageId, front, back, dbId, dataSourceId: created.value.dataSourceId, rows }
}

const lifecycleOf = async (id: string) => (await queryOne<{ lifecycle: string }>(`SELECT lifecycle FROM block WHERE id = $1`, [id])).lifecycle
const bodyIds = async (actor: Actor, pageId: string) => (await loadPageBody(actor.ctx, pageId as never))?.doc.blocks.map((b) => b.id)

describe('① ② 버리기 · 되살리기', () => {
  test('★ 데이터베이스와 행이 휴지통으로 · 참조가 빠진다 → 되살리면 원래 자리로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    const trashed = await trashPage(f.actor.ctx, f.dbId as never)
    assert.equal(trashed.trashedDescendants, 2, '행 둘이 함께')
    assert.equal(await lifecycleOf(f.dbId), 'trashed')
    assert.deepEqual(await Promise.all(f.rows.map(lifecycleOf)), ['trashed', 'trashed'])
    assert.deepEqual(await bodyIds(f.actor, f.pageId), [f.front, f.back], '부모 본문에서 참조가 빠진다')

    const restored = await restorePage(f.actor.ctx, f.dbId as never)
    assert.equal(restored.reparented, false)
    assert.equal(await lifecycleOf(f.dbId), 'live')
    assert.deepEqual(await Promise.all(f.rows.map(lifecycleOf)), ['live', 'live'])
    assert.deepEqual(await bodyIds(f.actor, f.pageId), [f.front, f.dbId, f.back], '앞 형제 뒤 — 원래 자리')
    // Y.Doc 에도 데이터베이스 참조로 — 하위 페이지 참조로 되살리면 행과 Y.Doc 이 다른 본문이 된다
    const state = await loadDocState(f.actor.ctx, f.pageId)
    if (!state.ok) throw new Error('본문을 읽지 못했다')
    assert.deepEqual(readBodyYDoc(state.value.ydoc, f.pageId).doc.blocks.map((b) => b.type), ['paragraph', 'database', 'paragraph'])
  })
})

describe('③ 휴지통 목록', () => {
  test('삭제 루트로 이름과 함께 · 함께 들어간 행의 수', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    await trashPage(f.actor.ctx, f.dbId as never)
    const entry = (await listTrash(f.actor.ctx)).find((e) => e.id === f.dbId)
    assert.deepEqual(entry && { kind: entry.kind, title: entry.title, descendants: entry.descendantCount }, { kind: 'page', title: '할 일', descendants: 2 })
  })
})

describe('④ 영구 삭제 → 물리 삭제', () => {
  test('★ 데이터베이스 · 소스 · 행이 깨끗이 지워진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    await trashPage(f.actor.ctx, f.dbId as never)
    await purgePage(f.actor.ctx, f.dbId as never)
    assert.equal(await lifecycleOf(f.dbId), 'purged')
    const later = new Date(Date.now() + (PURGED_HARD_DELETE_DAYS + 1) * 86_400_000)
    await runTrashHardDelete(later, { workspaces: [f.workspaceId] })
    const left = await query(
      `SELECT 'block' AS what FROM block WHERE id = ANY($1::uuid[])
       UNION ALL SELECT 'database' FROM database WHERE id = $2
       UNION ALL SELECT 'data_source' FROM data_source WHERE id = $3`,
      [[f.dbId, ...f.rows], f.dbId, f.dataSourceId],
    )
    assert.deepEqual(left, [])
    assert.deepEqual(await bodyIds(f.actor, f.pageId), [f.front, f.back], '부모 본문은 그대로')
  })
})

describe('⑤ 이동 명령', () => {
  test('인라인 데이터베이스를 옮기지 않는다 — 본문 안에서만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    await assert.rejects(movePage(f.actor.ctx, f.dbId as never, null), (e) => e instanceof MoveError && e.code === 'invalid_target')
    assert.deepEqual(await bodyIds(f.actor, f.pageId), [f.front, f.dbId, f.back])
  })
})

describe('⑥ 페이지 복제', () => {
  test('★ 사본에 인라인 데이터베이스를 싣지 않고 그 수를 말한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    const copy = await duplicatePage(f.actor.ctx, f.pageId as never)
    assert.deepEqual({ pages: copy.pages, skipped: copy.skipped, skippedDatabases: copy.skippedDatabases }, { pages: 1, skipped: 0, skippedDatabases: 1 })
    const copied = await loadPageBody(f.actor.ctx, copy.page.id)
    assert.deepEqual(copied?.doc.blocks.map((b) => b.type), ['paragraph', 'paragraph'], '사본 본문에 데이터베이스 참조가 없다')
    const under = await query(`SELECT 1 FROM block WHERE ancestor_path @> ARRAY[$1]::uuid[] AND type IN ('page', 'database')`, [copy.page.id])
    assert.equal(under.length, 0, '행이 사본의 하위 페이지로 붙지 않는다')
  })
})
