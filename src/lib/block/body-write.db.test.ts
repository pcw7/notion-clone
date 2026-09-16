/**
 * 참여자 경로 ① — `appendDocUpdate` 는 쌓는 트랜잭션에서 행까지 투영한다 (CRDT 5a조각 · 5b조각 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **쌓은 update 는 같은 트랜잭션에서 행이 된다** — 행은 쌓인 Y.Doc 의 투영이다
 *   ② **살아 있는 하위 페이지의 참조를 지운 update 는 그 페이지를 자손과 함께 휴지통으로 보낸다**(정본 프로젝터 · 5b) — 휴지통
 *      명령과 같은 상태가 되고, 되살리면 본문의 원래 자리로 돌아온다
 *   ③ **그 하위 페이지를 버릴 권한이 없으면 거부하고 아무것도 쓰지 않는다** — 볼 수 없는 하위 페이지 · 볼 수만 있는 하위 페이지
 *   ④ **하위 페이지 참조를 깊이 상한을 넘는 자리로 옮긴 update 는 거부하지 않고 들어갈 수 있는 깊이까지 올린다** — 참조를 담은
 *      블록을 옮겨도 같고, 하위 페이지 서브트리의 높이까지 센다. 올린 것은 같은 seq 의 수선이다. 모르는 노드가 있어 수선을 쓸 수
 *      없을 때만 거부한다
 *
 * 로그 자체의 성질(seq · 압축 · 재전송 · pending · 수선 · 권한)은 `collab/doc-store.db.test.ts` 가 본다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { loadDocState } from '../collab/doc-store.ts'
import { BODY_FRAGMENT, readBodyYDoc } from '../collab/ydoc.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query, queryOne } from '../db/pool.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { docToPm } from '../editor/pm-adapter.ts'
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

// ── ④ 깊이 상한 ───────────────────────────────────────────────────────

/** 토글을 `ids` 순서로 한 줄로 겹친다 — `ids[0]` 이 최상위(깊이 1)이고 `inner` 는 가장 안쪽 토글의 자식이다. */
function toggleChain(ids: readonly string[], inner: EditorBlock[] = []): EditorBlock {
  let node: EditorBlock = { id: ids[ids.length - 1], type: 'toggle', title: [textRun(`t${ids.length}`)], children: inner }
  for (let i = ids.length - 2; i >= 0; i -= 1) node = { id: ids[i], type: 'toggle', title: [textRun(`t${i + 1}`)], children: [node] }
  return node
}

const refTo = (pageId: string): EditorBlock => ({ id: pageId, type: 'page', title: [] })

/** 참여자가 본문을 `blocks` 로 바꾼 update — 에디터가 하는 쓰기(`edit`)로 만든다. */
function rewriting(base: Y.Doc, blocks: EditorBlock[], clientId: number): { client: Y.Doc; update: Uint8Array } {
  const client = peer(base, clientId)
  const next = docToPm({ blocks })
  edit(client, (tr: Transaction) => {
    tr.replaceWith(0, tr.doc.content.size, next.content)
  })
  return { client, update: changesSince(client, base) }
}

/** 문서에서 그 블록의 자식 id. */
function childIdsOf(doc: EditorDoc, blockId: string): string[] | null {
  const walk = (blocks: readonly EditorBlock[]): string[] | null => {
    for (const b of blocks) {
      if (b.id === blockId) return (b.children ?? []).map((c) => c.id)
      const found = walk(b.children ?? [])
      if (found !== null) return found
    }
    return null
  }
  return walk(doc.blocks)
}

const placeOf = (id: string) =>
  queryOne<{ parent_id: string; ancestor_path: string[] }>(`SELECT parent_id, ancestor_path FROM block WHERE id = $1`, [id])

describe('깊이 상한을 넘는 자리로 옮긴 하위 페이지 참조', () => {
  test('★ 거부하지 않고 들어갈 수 있는 깊이까지 올린다 — 행 · Y.Doc · 보낸 쪽이 같은 자리다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const pageId = await mk(owner, '페이지')
    const child = await mk(owner, '하위', pageId)
    // 토글 99 개 — 가장 안쪽 토글의 자식은 깊이 100 이다. 하위 페이지 경로가 [페이지, 토글 99 개] 가 되어 상한에 닿는다.
    const ids = Array.from({ length: 99 }, () => randomUUID())
    assert.ok((await savePageBody(owner.ctx, pageId as never, { blocks: [toggleChain(ids), refTo(child)] })).ok)
    const base = await ydocOf(owner, pageId)

    const { client, update } = rewriting(base, [toggleChain(ids, [refTo(child)])], 81)
    const result = await appendDocUpdate(owner.ctx, pageId, update, { origin: 'editor' })
    assert.ok(result.ok && result.appended, JSON.stringify(result))

    // 가장 안쪽 토글(깊이 99)의 바로 뒤 형제 — 깊이 99 에서 경로가 [페이지, 토글 98 개] 다.
    const place = await placeOf(child)
    assert.equal(place.parent_id, ids[97], '들어갈 수 있는 가장 깊은 자리로 올리지 않았다')
    assert.deepEqual(place.ancestor_path, [pageId, ...ids.slice(0, 98)])
    const rows = await loadPageBody(owner.ctx, pageId as never)
    assert.deepEqual(rows === null ? null : childIdsOf(rows.doc, ids[97]), [ids[98], child], '올린 참조가 그 토글 바로 뒤가 아니다')
    await assertBodyMatchesYDoc(owner.ctx, pageId)

    // 보낸 쪽은 올린 것을 갖고 있지 않다 — 돌려준 수선을 받으면 로그와 같은 문서다.
    assert.ok(result.repair !== null, '올린 것을 수선으로 돌려주지 않았다')
    Y.applyUpdate(client, result.repair)
    const server = readBodyYDoc(await ydocOf(owner, pageId), pageId)
    assert.deepEqual(readBodyYDoc(client, pageId), server)
  })

  test('★ 참조를 담은 토글을 깊이 옮겨도 같다 — 하위 페이지 서브트리의 높이까지 센다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const pageId = await mk(owner, '페이지')
    const child = await mk(owner, '하위', pageId)
    const grandchild = await mk(owner, '손자', child)
    const holder = randomUUID()
    const ids = Array.from({ length: 97 }, () => randomUUID())
    const holding = (children: EditorBlock[]): EditorBlock => ({ id: holder, type: 'toggle', title: [textRun('담은 토글')], children })
    assert.ok((await savePageBody(owner.ctx, pageId as never, { blocks: [toggleChain(ids), holding([refTo(child)])] })).ok)
    const base = await ydocOf(owner, pageId)

    // 담은 토글을 가장 안쪽 토글(깊이 97) 밑으로 — 참조의 부모는 그대로 담은 토글이고 깊이는 99, 손자의 경로는 100 이 된다.
    const { update } = rewriting(base, [toggleChain(ids, [holding([refTo(child)])])], 82)
    const result = await appendDocUpdate(owner.ctx, pageId, update, { origin: 'editor' })
    assert.ok(result.ok && result.appended, JSON.stringify(result))

    // 손자까지 상한 안에 들려면 참조는 깊이 98 — 담은 토글 바로 뒤다.
    const place = await placeOf(child)
    assert.equal(place.parent_id, ids[96], '서브트리 높이를 세어 올리지 않았다')
    assert.deepEqual(place.ancestor_path, [pageId, ...ids])
    assert.deepEqual((await placeOf(grandchild)).ancestor_path, [pageId, ...ids, child], '자손 경로가 따라가지 않았다')
    const rows = await loadPageBody(owner.ctx, pageId as never)
    assert.deepEqual(rows === null ? null : childIdsOf(rows.doc, ids[96]), [holder, child])
    assert.deepEqual(rows === null ? null : childIdsOf(rows.doc, holder), [])
    await assertBodyMatchesYDoc(owner.ctx, pageId)
  })

  test('★ 상한을 이미 넘은 서브트리의 참조는 지금 깊이까지만 올린다 — 최상위까지 끌어올리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const pageId = await mk(owner, '페이지')
    const child = await mk(owner, '하위', pageId)
    const [first, second, inner] = [randomUUID(), randomUUID(), randomUUID()]
    const toggle = (id: string, children: EditorBlock[] = []): EditorBlock => ({ id, type: 'toggle', title: [textRun('토글')], children })
    assert.ok(
      (await savePageBody(owner.ctx, pageId as never, { blocks: [toggle(first, [refTo(child)]), toggle(second, [toggle(inner)])] })).ok,
    )
    // 하위 페이지의 본문을 깊이 100 까지 — 본문은 페이지에서 센 깊이만 막으므로 서브트리가 상한을 넘는다(경로 102).
    const bodyIds = Array.from({ length: 99 }, () => randomUUID())
    assert.ok((await savePageBody(owner.ctx, child as never, { blocks: [toggleChain(bodyIds, [para('바닥')])] })).ok)
    const base = await ydocOf(owner, pageId)

    // 참조를 깊이 2 에서 3 으로 — 더 깊어진다. 들어갈 수 있는 깊이는 지금 깊이(2)다.
    const { update } = rewriting(base, [toggle(first), toggle(second, [toggle(inner, [refTo(child)])])], 84)
    const result = await appendDocUpdate(owner.ctx, pageId, update, { origin: 'editor' })
    assert.ok(result.ok && result.appended, JSON.stringify(result))

    const place = await placeOf(child)
    assert.equal(place.parent_id, second, '지금 깊이가 아니라 더 위로 올렸다')
    const rows = await loadPageBody(owner.ctx, pageId as never)
    assert.deepEqual(rows === null ? null : childIdsOf(rows.doc, second), [inner, child])
    await assertBodyMatchesYDoc(owner.ctx, pageId)
  })

  test('모르는 노드가 있는 본문에서는 올린 것을 Y.Doc 에 쓸 수 없어 거부한다 — 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const pageId = await mk(owner, '페이지')
    const child = await mk(owner, '하위', pageId)
    const ids = Array.from({ length: 99 }, () => randomUUID())
    assert.ok((await savePageBody(owner.ctx, pageId as never, { blocks: [toggleChain(ids), refTo(child)] })).ok)
    const base = await ydocOf(owner, pageId)
    const [logBefore, placeBefore] = [await logLength(pageId), await placeOf(child)]

    const { client } = rewriting(base, [toggleChain(ids, [refTo(child)])], 83)
    // 새 버전 클라이언트가 넣은 블록 — 수선은 매핑 없이 비교해 이것을 지우므로 쓰지 않는다(`repair.ts`).
    const root = client.getXmlFragment(BODY_FRAGMENT).get(0) as Y.XmlElement
    const future = new Y.XmlElement('blockContainer')
    future.setAttribute('blockId', randomUUID())
    future.insert(0, [new Y.XmlElement('future_block_from_newer_client')])
    client.transact(() => root.insert(root.length, [future]))

    assert.deepEqual(
      await appendDocUpdate(owner.ctx, pageId, changesSince(client, base), { origin: 'editor' }),
      { ok: false, reason: 'page_ref_too_deep' },
    )
    assert.equal(await logLength(pageId), logBefore, '거부한 update 를 쌓았다')
    assert.deepEqual(await placeOf(child), placeBefore, '거부했는데 행이 바뀌었다')
    await assertBodyMatchesYDoc(owner.ctx, pageId)
  })
})
