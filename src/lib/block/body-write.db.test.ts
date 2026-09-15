/**
 * 참여자 경로 ① — `appendDocUpdate` 는 쌓는 트랜잭션에서 행까지 투영한다 (CRDT 5a조각 · 5b조각 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **쌓은 update 는 같은 트랜잭션에서 행이 된다** — 행은 쌓인 Y.Doc 의 투영이다
 *   ② **살아 있는 하위 페이지의 참조를 지운 update 는 그 페이지를 자손과 함께 휴지통으로 보낸다**(정본 프로젝터 · 5b) — 휴지통
 *      명령과 같은 상태가 되고, 되살리면 본문의 원래 자리로 돌아온다
 *   ③ **그 하위 페이지를 버릴 권한이 없으면 거부하고 아무것도 쓰지 않는다** — 볼 수 없는 하위 페이지 · 볼 수만 있는 하위 페이지
 *
 * 로그 자체의 성질(seq · 압축 · 재전송 · pending · 수선 · 권한)은 `collab/doc-store.db.test.ts` 가 본다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type * as Y from 'yjs'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { loadDocState } from '../collab/doc-store.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query, queryOne } from '../db/pool.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import type { Level } from '../permissions/levels.ts'
import { assertBodyMatchesYDoc } from '../testing/body-invariant.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { appendDocUpdate } from './body-write.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'
import { restorePage } from './trash.ts'

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

async function workspace(): Promise<{ owner: Actor; member: Actor }> {
  const workspaceId = await createBareWorkspace('참여자 경로')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  return { owner, member }
}

const para = (text: string, id: string = randomUUID()): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)] })
const textsOf = (doc: EditorDoc): string[] => doc.blocks.map((b) => b.title.map((r) => r.plain_text).join(''))

const mk = async (actor: Actor, title: string, parent: string | null = null): Promise<string> =>
  (await createPage(actor.ctx, { parentPageId: parent as never, title: titleFromPlainText(title) })).id

/** 본문이 있는 최상위 페이지 — 본문 저장이 Y.Doc 까지 만든다(4b). */
async function pageWith(owner: Actor, blocks: EditorBlock[]): Promise<string> {
  const pageId = await mk(owner, '페이지')
  const saved = await savePageBody(owner.ctx, pageId as never, { blocks })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return pageId
}

async function ydocOf(actor: Actor, pageId: string): Promise<Y.Doc> {
  const state = await loadDocState(actor.ctx, pageId)
  if (!state.ok) throw new Error(`본문을 읽지 못했다: ${pageId}`)
  return state.value.ydoc
}

const logLength = async (pageId: string) =>
  (await query<{ n: string }>(`SELECT count(*) AS n FROM doc_update WHERE page_id = $1`, [pageId]))[0].n

const rowOf = (id: string) =>
  queryOne<{ lifecycle: string; trash_root_id: string | null; trashed_by: string | null; version: string }>(
    `SELECT lifecycle, trash_root_id, trashed_by, version FROM block WHERE id = $1`,
    [id],
  )

/** 참여자가 본문에서 그 하위 페이지의 참조 노드를 지운 update. */
function removingRef(base: Y.Doc, childId: string, clientId: number): Uint8Array {
  const client = peer(base, clientId)
  edit(client, (tr: Transaction, doc: PmNode) => {
    const { pos, node } = findBlock(doc, childId)
    tr.delete(pos, pos + node.nodeSize)
  })
  return changesSince(client, base)
}

/** 부모에게서 받던 권한을 끊고 소유자에게만 남긴 뒤, 멤버에게 `level` 을 준다(null 이면 아무것도). */
async function restrictChild(owner: Actor, member: Actor, pageId: string, level: Level | null): Promise<void> {
  assert.equal((await stopInheriting(owner.ctx, pageId)).ok, true)
  assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
  if (level !== null) {
    assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: member.userId }, level)).ok, true)
  }
  assert.equal((await revokeAccess(owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
}

describe('참여자 update 는 행으로 투영된다', () => {
  test('★ 쌓은 update 는 같은 트랜잭션에서 행이 된다 — 행은 쌓인 Y.Doc 의 투영이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
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

  test('★ 살아 있는 하위 페이지의 참조를 지운 update 는 그 페이지를 자손과 함께 휴지통으로 보낸다 — 되살리면 원래 자리다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const paraId = randomUUID()
    const pageId = await pageWith(owner, [para('원문', paraId)])
    const child = await mk(owner, '하위', pageId)
    const grandchild = await mk(owner, '손자', child)
    const base = await ydocOf(owner, pageId)
    const [logBefore, parentBefore] = [await logLength(pageId), await rowOf(pageId)]

    const result = await appendDocUpdate(owner.ctx, pageId, removingRef(base, child, 72), { origin: 'editor' })
    assert.ok(result.ok && result.appended, JSON.stringify(result))

    assert.equal(Number(await logLength(pageId)), Number(logBefore) + 1)
    const [childRow, grandchildRow, parentRow] = [await rowOf(child), await rowOf(grandchild), await rowOf(pageId)]
    assert.deepEqual(
      [childRow.lifecycle, childRow.trash_root_id, childRow.trashed_by],
      ['trashed', child, owner.userId],
      '지운 하위 페이지가 휴지통 명령과 같은 상태가 아니다',
    )
    assert.deepEqual([grandchildRow.lifecycle, grandchildRow.trash_root_id], ['trashed', child], '자손이 함께 가지 않았다')
    assert.ok(BigInt(parentRow.version) > BigInt(parentBefore.version), '부모 본문이 바뀌었는데 version 이 그대로다')
    await assertBodyMatchesYDoc(owner.ctx, pageId)

    await restorePage(owner.ctx, child as never)
    const restored = await loadPageBody(owner.ctx, pageId as never)
    assert.deepEqual(restored?.doc.blocks.map((b) => b.id), [paraId, child], '되살린 참조가 원래 자리가 아니다')
    assert.equal((await rowOf(grandchild)).lifecycle, 'live')
    await assertBodyMatchesYDoc(owner.ctx, pageId)
  })

  test('★ 그 하위 페이지를 버릴 권한이 없으면 거부하고 아무것도 쓰지 않는다 — 볼 수 없는 하위 페이지 · 볼 수만 있는 하위 페이지', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageWith(owner, [para('원문')])
    const secret = await mk(owner, '비공개 하위', pageId)
    await restrictChild(owner, member, secret, null)
    const viewOnly = await mk(owner, '보기만 하는 하위', pageId)
    await restrictChild(owner, member, viewOnly, 'view')
    const base = await ydocOf(owner, pageId)
    const [logBefore, rowsBefore] = [await logLength(pageId), await loadPageBody(owner.ctx, pageId as never)]

    for (const [childId, clientId] of [[secret, 73], [viewOnly, 74]] as const) {
      assert.deepEqual(
        await appendDocUpdate(member.ctx, pageId, removingRef(base, childId, clientId), { origin: 'editor' }),
        { ok: false, reason: 'page_ref_forbidden' },
      )
      assert.equal((await rowOf(childId)).lifecycle, 'live')
    }
    assert.equal(await logLength(pageId), logBefore, '거부한 update 를 쌓았다')
    assert.deepEqual(await loadPageBody(owner.ctx, pageId as never), rowsBefore, '거부했는데 행이 바뀌었다')
    await assertBodyMatchesYDoc(owner.ctx, pageId)
  })
})
