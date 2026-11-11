/**
 * 코멘트 권한자의 제안 — 쓰기 경로 ① (SG-5b · F-05-12 · 정본 [보강 SG-1] ⑨)
 *
 * 이 파일이 지키는 것.
 *
 *   ① comment 만 있으면 협업 접근이 `suggest` 다 — view 는 `view` · 고칠 수 있으면 `edit` · 잠기면 `suggest` 도 `view`
 *   ② 그냥 고친 update 와 남의 이름을 단 제안은 `suggest_only` 로 거부한다 — 로그에 아무것도 쌓이지 않는다
 *   ③ 자기 이름의 제안은 받는다 — 원문(행)은 그대로이고 메타 표에 그 사람의 제안이 선다
 *   ④ view 만 있으면 여전히 `forbidden` · 잠기면 `locked`
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type * as Y from 'yjs'
import type { Transaction } from '@tiptap/pm/state'

import type { SessionContext } from '../auth/session-context.ts'
import { appendDocUpdate } from '../block/body-write.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { loadDocState, pageAccess } from '../collab/doc-store.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query, queryOne } from '../db/pool.ts'
import type { EditorBlock } from '../editor/document.ts'
import { SUGGESTION_INSERT_MARK } from '../editor/schema.ts'
import type { BlockId } from '../ids.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { changesSince, edit, peer } from '../testing/collab-peers.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'

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

const para = (text: string): EditorBlock => ({ id: randomUUID(), type: 'paragraph', title: [textRun(text)] })

async function docOf(by: Actor, text: string): Promise<BlockId> {
  const page = await createPage(by.ctx, { privateTop: true, title: titleFromPlainText(`제안 ${randomUUID().slice(0, 6)}`) })
  const saved = await savePageBody(by.ctx, page.id, { blocks: [para(text)] })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return page.id
}

const share = async (boss: Actor, doc: string, who: Actor, level: 'view' | 'comment') =>
  assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: who.userId }, level)).ok)

/** 첫 문단 끝에서 고친 update — 에디터가 하는 쓰기로 만든다. */
async function atEnd(ctx: SessionContext, pageId: string, change: (tr: Transaction, end: number) => void): Promise<Uint8Array> {
  const state = await loadDocState(ctx, pageId)
  if (!state.ok) throw new Error(`본문을 읽지 못했다: ${pageId}`)
  const base: Y.Doc = state.value.ydoc
  const client = peer(base, 5150)
  edit(client, (tr: Transaction) => {
    let end = -1
    tr.doc.descendants((node, pos) => {
      if (end < 0 && node.isTextblock) end = pos + 1 + node.content.size
      return end < 0
    })
    change(tr, end)
  })
  return changesSince(client, base)
}

const suggestText = (tr: Transaction, text: string, sid: string, author: string) =>
  tr.doc.type.schema.text(text, [tr.doc.type.schema.marks[SUGGESTION_INSERT_MARK]!.create({ sid, author_id: author })])

const logLength = async (pageId: string) =>
  Number((await queryOne<{ n: string }>(`SELECT count(*) AS n FROM doc_update WHERE page_id = $1`, [pageId])).n)

const rowText = async (pageId: string) =>
  (await query<{ t: string }>(`SELECT properties->'title'->0->>'plain_text' AS t FROM block WHERE parent_id = $1 AND type = 'paragraph'`, [pageId])).map(
    (r) => r.t,
  )

describe('코멘트 권한자의 제안 — 쓰기 경로 ① (SG-5b)', () => {
  test('★ comment 는 suggest · 그냥 고친 것 · 남의 이름은 suggest_only · 내 제안은 받는다 · view 는 forbidden · 잠그면 locked', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ws = await createBareWorkspace('제안만')
    const boss = await joinAs(ws, await createUser('대표'), 'owner')
    const commenter = await joinAs(ws, await createUser('코멘트'), 'member')
    const viewer = await joinAs(ws, await createUser('보기'), 'member')
    const doc = await docOf(boss, '본문')
    await share(boss, doc, commenter, 'comment')
    await share(boss, doc, viewer, 'view')

    // ①
    assert.equal(await pageAccess(boss.ctx, doc), 'edit')
    assert.equal(await pageAccess(commenter.ctx, doc), 'suggest')
    assert.equal(await pageAccess(viewer.ctx, doc), 'view')

    // ②
    const logged = await logLength(doc)
    const plain = await atEnd(commenter.ctx, doc, (tr, end) => tr.insertText(' 덧붙임', end))
    assert.deepEqual(await appendDocUpdate(commenter.ctx, doc, plain, { origin: 'editor' }), { ok: false, reason: 'suggest_only' })
    const forged = await atEnd(commenter.ctx, doc, (tr, end) => tr.insert(end, suggestText(tr, ' 남의 이름', randomUUID(), boss.userId)))
    assert.deepEqual(await appendDocUpdate(commenter.ctx, doc, forged, { origin: 'editor' }), { ok: false, reason: 'suggest_only' })
    assert.equal(await logLength(doc), logged, '거부한 update 는 쌓이지 않는다')

    // ④ view
    const viewed = await atEnd(viewer.ctx, doc, (tr, end) => tr.insert(end, suggestText(tr, ' 보기', randomUUID(), viewer.userId)))
    assert.deepEqual(await appendDocUpdate(viewer.ctx, doc, viewed, { origin: 'editor' }), { ok: false, reason: 'forbidden' })

    // ③
    const sid = randomUUID()
    const mine = await atEnd(commenter.ctx, doc, (tr, end) => tr.insert(end, suggestText(tr, ' 제안', sid, commenter.userId)))
    const accepted = await appendDocUpdate(commenter.ctx, doc, mine, { origin: 'editor' })
    assert.equal(accepted.ok && accepted.appended, true, JSON.stringify(accepted))
    assert.deepEqual(await rowText(doc), ['본문'], '원문(행)은 그대로')
    const meta = await queryOne<{ author_id: string; kind: string; state: string }>(
      `SELECT author_id, kind, state FROM suggestion WHERE id = $1`,
      [sid],
    )
    assert.deepEqual(meta, { author_id: commenter.userId, kind: 'insert', state: 'open' })

    // ④ 잠그면
    assert.equal((await setPageLock(boss.ctx, doc, true)).ok, true)
    assert.equal(await pageAccess(commenter.ctx, doc), 'view')
    const late = await atEnd(commenter.ctx, doc, (tr, end) => tr.insert(end, suggestText(tr, ' 늦은', randomUUID(), commenter.userId)))
    assert.deepEqual(await appendDocUpdate(commenter.ctx, doc, late, { origin: 'editor' }), { ok: false, reason: 'locked' })
  })
})
