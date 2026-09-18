/**
 * 브라우저 쪽 협업 연결 — CRDT 6c조각 (DB · 실제 협업 서버 · node 의 provider)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **서버가 준 본문으로 곧바로 시작하고, 친 편집은 서버가 확인한 뒤에야 보존본에서 지운다** — 확인 요청이 나간 뒤에도 앞선 update 가
 *      쌓이기 전에는 지우지 않는다
 *   ② **끊긴 채 친 편집은 보존본에 남고, 닫았다 다시 열면 보내고 지운다**(F-05-04)
 *   ③ **다시 붙을 때 provider 의 셈이 0 이 되어도 뒤의 update 가 확인되기 전에는 지우지 않는다**(HANDOFF §3.3-120) — 끊긴 동안 쌓인
 *      update 둘 가운데 첫째의 확인만 온 때
 *   ④ **쓰기가 거부되면 로컬 문서와 보존본을 버리고 다시 연다** — 새 문서는 서버 본문이고, 동기화된 뒤에 바꾸고, 버린 문서를 알린다.
 *      새 문서에 친 편집은 쌓인다
 *   ⑤ **권한이 강등되면 버리고 읽기 전용으로 다시 연다 · 읽기 전용으로 받았는데 보존본에 편집이 있으면 버리고 알린다**
 *   ⑥ **볼 수 없게 되면 닫고 보존본을 지운다 · 세션이 끊기면 로그인으로 닫고 보존본은 남긴다**
 *   ⑦ **서버가 판정하지 못해 닫으면(`unavailable`) 로컬을 버리지 않고 다시 붙어 그 사이 편집까지 보낸다**
 *   ⑧ **`confirm()` 은 창을 기다리지 않고 지금 청하며, 서버가 쌓은 뒤에 끝난다**(6d 의 하위 페이지 생성이 쓴다) — 끊겨 있었으면
 *      다시 붙는 대로 청한다(창을 기다리지 않는다)
 *   ⑨ **연결이 돌아왔다는 신호를 받으면 provider 의 다음 시도를 기다리지 않고 곧바로 다시 붙는다** — 그리고 **내린 연결은 다시
 *      붙지 않는다**(예약된 재시도가 소켓을 되살리지 않는다)
 *
 * 끊김은 소켓 클래스가 만든다 — `gate.offline` 이면 닫힌 포트로 붙는다. 서버 쪽 처리 순서는 커밋 신호를 붙잡아(`holdableFeed`) 멈춘다 —
 * 참여자 update 는 자기 seq 의 신호가 적용될 때까지 확인되지 않는다(`collab-server.ts` 머리말).
 */

import { test, describe, before, after, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { revokeSession } from '../auth/session.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import type { EditorBlock } from '../editor/document.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import type { Level } from '../permissions/levels.ts'
import { edit, findBlock } from '../testing/collab-peers.ts'
import { APP_ORIGIN, cookieOf, docSignal, holdableFeed, join, ready, startServer, waitFor, type Running } from '../testing/collab-server-harness.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import {
  memoryPendingEditStore,
  openCollabConnection,
  rejectionAction,
  type CollabConnection,
  type CollabConnectionOptions,
  type DiscardedDoc,
} from './collab-connection.ts'
import { collabDocumentName } from './collab-protocol.ts'
import { loadDocState } from './doc-store.ts'
import { readBodyYDoc } from './ydoc.ts'

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

/** 닫힌 포트 — 끊긴 연결. */
const DEAD_URL = 'ws://127.0.0.1:9'
/** y-protocols 가 아닌 Hocuspocus 메시지 종류 — 서버의 update 확인. */
const SYNC_STATUS = 8

type Gate = { offline: boolean }

/** 받은 메시지를 세는 소켓 기록. */
type Wire = { readonly sockets: WebSocket[]; readonly received: Uint8Array[]; readonly sent: Uint8Array[] }

/** 이 사람의 쿠키 · 앱 Origin 을 싣는 소켓. `gate.offline` 이면 닫힌 포트로 붙는다. 주고받은 메시지를 `wire` 에 남긴다. */
function socketFor(actor: Actor, gate: Gate, wire: Wire) {
  return class GatedSocket extends WebSocket {
    constructor(address: string | URL) {
      super(gate.offline ? DEAD_URL : address, { headers: cookieOf(actor, { origin: APP_ORIGIN }) } as unknown as string[])
      wire.sockets.push(this)
      this.addEventListener('message', (event) => {
        if (event.data instanceof ArrayBuffer) wire.received.push(new Uint8Array(event.data))
      })
    }

    override send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (data instanceof Uint8Array) wire.sent.push(data)
      super.send(data)
    }
  }
}

const includesText = (bytes: Uint8Array, text: string): boolean => Buffer.from(bytes).includes(Buffer.from(text, 'utf8'))

/** Hocuspocus 메시지의 종류 — 문서 이름(varString) 다음의 varUint. */
function messageType(bytes: Uint8Array): number {
  let offset = 0
  let length = 0
  let shift = 0
  for (;;) {
    const byte = bytes[offset++]
    length |= (byte & 0x7f) << shift
    shift += 7
    if (byte < 0x80) break
  }
  return bytes[offset + length]
}

const para = (text: string, id: string = randomUUID()): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)] })

async function fixture() {
  const workspaceId = await createBareWorkspace('협업 연결')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  const page = await createPage(owner.ctx, { title: titleFromPlainText('페이지') })
  const blockId = randomUUID()
  assert.ok((await savePageBody(owner.ctx, page.id, { blocks: [para('원문', blockId)] })).ok)
  return { workspaceId, owner, member, pageId: page.id as string, blockId }
}

async function serverState(actor: Actor, pageId: string): Promise<Uint8Array> {
  const state = await loadDocState(actor.ctx, pageId)
  if (!state.ok) throw new Error(`본문을 읽지 못했다: ${pageId}`)
  return Y.encodeStateAsUpdate(state.value.ydoc)
}

const textOf = (doc: Y.Doc, pageId: string): string =>
  readBodyYDoc(doc, pageId)
    .doc.blocks.map((b) => b.title.map((r) => r.plain_text).join(''))
    .join(' | ')

const logTexts = async (pageId: string, text: string): Promise<boolean> =>
  (await query<{ payload: Buffer }>(`SELECT payload FROM doc_update WHERE page_id = $1`, [pageId])).some((row) =>
    row.payload.includes(Buffer.from(text, 'utf8')),
  )

const logLength = async (pageId: string): Promise<number> =>
  Number((await query<{ n: string }>(`SELECT count(*) AS n FROM doc_update WHERE page_id = $1`, [pageId]))[0].n)

const payloadHas = async (pageId: string, seq: string, text: string): Promise<boolean> =>
  (await query<{ payload: Buffer }>(`SELECT payload FROM doc_update WHERE page_id = $1 AND seq = $2`, [pageId, seq]))[0].payload.includes(
    Buffer.from(text, 'utf8'),
  )

const lastSeq = async (pageId: string): Promise<string> =>
  (await query<{ seq: string }>(`SELECT max(seq)::text AS seq FROM doc_update WHERE page_id = $1`, [pageId]))[0].seq

const typeAt = (blockId: string, text: string) => (tr: Transaction, doc: PmNode) => {
  tr.insertText(text, findBlock(doc, blockId).pos + 2)
}

type Opened = {
  readonly connection: CollabConnection
  readonly onlineSource: EventTarget
  readonly discarded: DiscardedDoc[]
  readonly gate: Gate
  readonly wire: Wire
  readonly doc: () => Y.Doc
}

async function open(
  t: TestContext,
  running: Running,
  actor: Actor,
  target: { workspaceId: string; pageId: string },
  store: CollabConnectionOptions['store'],
  gate: Gate = { offline: false },
  extra: Partial<CollabConnectionOptions> = {},
): Promise<Opened> {
  const discarded: DiscardedDoc[] = []
  const wire: Wire = { sockets: [], received: [], sent: [] }
  const onlineSource = new EventTarget()
  const connection = await openCollabConnection({
    onlineSource,
    url: running.url,
    workspaceId: target.workspaceId,
    pageId: target.pageId,
    initialState: await serverState(actor, target.pageId),
    store,
    storeKey: `${actor.userId}:${target.pageId}`,
    WebSocketPolyfill: socketFor(actor, gate, wire),
    confirmDelayMs: 20,
    retryDelayMs: 50,
    onDiscarded: (d) => discarded.push(d),
    ...extra,
  })
  t.after(() => connection.destroy())
  return { connection, discarded, gate, wire, onlineSource, doc: () => connection.snapshot().doc }
}

const settled = (opened: Opened) => () => {
  const s = opened.connection.snapshot()
  return s.online && s.readOnly !== null && !s.reopening
}

/** 모두에게 열린 최상위 페이지를 소유자만의 것으로 바꾸고 `actor` 에게 `level` 을 준다. */
async function restrict(owner: Actor, pageId: string, actor: Actor, level: Level): Promise<void> {
  assert.equal((await stopInheriting(owner.ctx, pageId)).ok, true)
  assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
  assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: actor.userId }, level)).ok, true)
  assert.equal((await revokeAccess(owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
}

// ── ① 확인된 뒤에만 지운다 ────────────────────────────────────────────

describe('① 서버가 확인한 편집만 보존본에서 지운다', () => {
  test('★ 서버 본문으로 곧바로 시작하고, 확인 요청이 나간 뒤에도 앞선 update 가 쌓이기 전에는 지우지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, pageId, blockId } = await fixture()
    const feed = holdableFeed()
    const running = await startServer(t, { openFeed: (handlers) => feed.open(handlers) })
    t.after(() => feed.releaseIfHeld())
    const store = memoryPendingEditStore()
    const me = await open(t, running, owner, { workspaceId, pageId }, store)
    assert.equal(textOf(me.doc(), pageId), '원문', '첫 동기화 전에 서버가 준 본문이 없다')
    await waitFor('연결', settled(me))

    feed.hold()
    const before = await logLength(pageId)
    edit(me.doc(), typeAt(blockId, '앞 '))
    await waitFor('쌓였다(확인은 신호를 기다린다)', async () => (await logLength(pageId)) === before + 1)
    await waitFor('확인 요청이 나갔다', () => me.wire.sent.some((bytes) => includesText(bytes, 'edits:confirm:')))
    assert.ok(store.entries.size === 1, '앞선 update 가 확인되기 전에 보존본을 지웠다')
    assert.equal(me.connection.snapshot().unconfirmed, true)

    feed.release()
    await waitFor('확인되어 지웠다', () => store.entries.size === 0 && !me.connection.snapshot().unconfirmed)
    assert.equal(await logTexts(pageId, '앞 '), true)
  })
})

// ── ② 닫았다 다시 열기 ──────────────────────────────────────────────

describe('② 끊긴 채 친 편집 (F-05-04)', () => {
  test('★ 보존본에 남고, 닫았다 다시 열면 서버가 준 본문 위에 되살려 보내고 지운다 — 다른 참여자도 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, member, pageId, blockId } = await fixture()
    const running = await startServer(t)
    const store = memoryPendingEditStore()

    const offline = await open(t, running, owner, { workspaceId, pageId }, store, { offline: true })
    edit(offline.doc(), typeAt(blockId, '끊김 '))
    await waitFor('보존본에 썼다', () => store.entries.size === 1)
    await offline.connection.destroy()
    assert.equal(await logTexts(pageId, '끊김 '), false, '전제: 서버에 닿지 않았다')

    const other = join(t, running.url, collabDocumentName(workspaceId, pageId), cookieOf(member))
    await ready(other)
    const reopened = await open(t, running, owner, { workspaceId, pageId }, store)
    assert.equal(textOf(reopened.doc(), pageId), '끊김 원문', '보존본을 되살리지 않았다')
    await waitFor('보내고 지웠다', () => store.entries.size === 0)
    assert.equal(await logTexts(pageId, '끊김 '), true)
    await waitFor('다른 참여자가 받았다', () => textOf(other.doc, pageId) === '끊김 원문')
  })
})

// ── ③ provider 의 셈 ────────────────────────────────────────────────

describe('③ 다시 붙을 때의 확인 (HANDOFF §3.3-120)', () => {
  test('★ 끊긴 동안 쌓인 update 둘 가운데 첫째의 확인이 와 provider 의 셈이 0 이 되어도, 둘째가 확인되기 전에는 지우지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, pageId, blockId } = await fixture()
    const feed = holdableFeed()
    const running = await startServer(t, { openFeed: (handlers) => feed.open(handlers) })
    t.after(() => feed.releaseIfHeld())
    const store = memoryPendingEditStore()
    const me = await open(t, running, owner, { workspaceId, pageId }, store)
    await waitFor('연결', settled(me))

    // 끊는다 — provider 가 스스로 다시 붙으려 하지만 닫힌 포트다. 그동안 친 update 둘은 소켓의 큐에 쌓인다.
    me.gate.offline = true
    me.wire.sockets.at(-1)?.close()
    await waitFor('끊겼다', () => !me.connection.snapshot().online)
    edit(me.doc(), typeAt(blockId, '첫째 '))
    edit(me.doc(), typeAt(blockId, '둘째 '))

    feed.hold()
    const before = await logLength(pageId)
    const receivedBefore = me.wire.received.length
    me.gate.offline = false
    await waitFor('첫째가 쌓였다', async () => (await logLength(pageId)) >= before + 1)
    const firstSeq = await lastSeq(pageId)
    assert.equal(await logLength(pageId), before + 1, '전제: 첫째만 쌓였다(확인은 신호를 기다린다)')
    assert.equal(await payloadHas(pageId, firstSeq, '첫째 '), true, '전제: 큐의 첫째가 동기화 응답보다 먼저 나갔다')
    assert.equal(await payloadHas(pageId, firstSeq, '둘째 '), false)
    feed.release(docSignal(pageId, firstSeq))
    await waitFor('첫째의 확인이 왔다', () => me.wire.received.slice(receivedBefore).some((bytes) => messageType(bytes) === SYNC_STATUS))
    // 다시 붙을 때 provider 는 셈을 1 로 두고, 큐의 첫째가 먼저 나가 그 확인이 왔다 — 셈은 0 이다. 둘째를 담은 메시지는 아직 서버에 있다.
    await waitFor('둘째가 쌓였다(확인은 신호를 기다린다)', async () => await logTexts(pageId, '둘째 '))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.ok(store.entries.size === 1, '둘째가 확인되기 전에 보존본을 지웠다')

    feed.release()
    await waitFor('확인되어 지웠다', () => store.entries.size === 0)
    assert.equal(await logTexts(pageId, '둘째 '), true)
  })
})

// ── ④ 쓰기 거부 ────────────────────────────────────────────────────

describe('④ 쓰기가 거부되면', () => {
  test('★ 로컬 문서와 보존본을 버리고 다시 연다 — 새 문서는 서버 본문이고 동기화된 뒤에 바꾸며, 새 문서에 친 편집은 쌓인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, member, pageId, blockId } = await fixture()
    // 멤버가 볼 수만 있는 하위 페이지 — 그 참조를 지우면 버릴 권한이 없어 거부된다(page_ref_forbidden).
    const child = await createPage(owner.ctx, { parentPageId: pageId as never, title: titleFromPlainText('하위') })
    await restrict(owner, child.id, member, 'view')
    const running = await startServer(t)
    const store = memoryPendingEditStore()
    const me = await open(t, running, member, { workspaceId, pageId }, store)
    await waitFor('연결', settled(me))
    const logBefore = await logLength(pageId)
    const first = me.doc()

    edit(first, (tr, doc) => {
      const { pos, node } = findBlock(doc, child.id)
      tr.delete(pos, pos + node.nodeSize)
    })
    await waitFor('버렸다', () => me.discarded.length === 1)
    assert.deepEqual(
      me.discarded.map((d) => [d.reason, d.unconfirmed, d.doc === first]),
      [['page_ref_forbidden', true, true]],
    )
    assert.equal(store.entries.size, 0, '버린 편집의 보존본이 남았다')
    await waitFor('새 문서로 바꿨다', () => me.doc() !== first && settled(me)())
    assert.ok(readBodyYDoc(me.doc(), pageId).doc.blocks.some((b) => b.id === child.id), '새 문서가 서버 본문이 아니다')
    assert.equal(await logLength(pageId), logBefore, '거부된 편집이 쌓였다')

    edit(me.doc(), typeAt(blockId, '다시 '))
    await waitFor('새 문서의 편집이 확인됐다', async () => store.entries.size === 0 && (await logTexts(pageId, '다시 ')))
    assert.equal(me.connection.snapshot().closed, null)
  })
})

// ── ⑤ 읽기 전용 ────────────────────────────────────────────────────

describe('⑤ 읽기 전용', () => {
  test('★ 고칠 수 있던 연결이 강등되면 버리고 읽기 전용으로 다시 연다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, member, pageId } = await fixture()
    await restrict(owner, pageId, member, 'edit')
    const running = await startServer(t)
    const me = await open(t, running, member, { workspaceId, pageId }, memoryPendingEditStore())
    await waitFor('연결', settled(me))
    assert.equal(me.connection.snapshot().readOnly, false)
    const first = me.doc()

    assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: member.userId }, 'view')).ok, true)
    await waitFor('읽기 전용으로 다시 열었다', () => me.doc() !== first && settled(me)())
    assert.equal(me.connection.snapshot().readOnly, true)
    assert.deepEqual(
      me.discarded.map((d) => [d.reason, d.unconfirmed]),
      [['forbidden', false]],
    )
  })

  test('★ 읽기 전용으로 받았는데 보존본에 편집이 있으면 보낼 수 없다 — 버리고 알린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, member, pageId, blockId } = await fixture()
    const running = await startServer(t)
    const store = memoryPendingEditStore()
    const offline = await open(t, running, member, { workspaceId, pageId }, store, { offline: true })
    edit(offline.doc(), typeAt(blockId, '멤버 '))
    await waitFor('보존본에 썼다', () => store.entries.size === 1)
    await offline.connection.destroy()

    await restrict(owner, pageId, member, 'view')
    const logBefore = await logLength(pageId)
    const me = await open(t, running, member, { workspaceId, pageId }, store)
    await waitFor('버리고 다시 열었다', () => me.discarded.length === 1 && settled(me)())
    assert.deepEqual(
      me.discarded.map((d) => [d.reason, d.unconfirmed]),
      [['read_only', true]],
    )
    assert.equal(store.entries.size, 0)
    assert.equal(me.connection.snapshot().readOnly, true)
    assert.equal(textOf(me.doc(), pageId), '원문')
    assert.equal(await logLength(pageId), logBefore)
  })
})

// ── ⑥ 닫기 ─────────────────────────────────────────────────────────

describe('⑥ 닫는다', () => {
  test('★ 볼 수 없게 되면 "접근 권한 없음"으로 닫고 보낼 수 없는 편집의 보존본을 지운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, member, pageId, blockId } = await fixture()
    const running = await startServer(t)
    const store = memoryPendingEditStore()
    const me = await open(t, running, member, { workspaceId, pageId }, store)
    await waitFor('연결', settled(me))

    me.gate.offline = true
    me.wire.sockets.at(-1)?.close()
    await waitFor('끊겼다', () => !me.connection.snapshot().online)
    edit(me.doc(), typeAt(blockId, '못 보냄 '))
    await waitFor('보존본에 썼다', () => store.entries.size === 1)
    assert.equal((await revokeAccess(owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)

    me.gate.offline = false
    await waitFor('닫았다', () => me.connection.snapshot().closed === 'not_found')
    assert.equal(store.entries.size, 0)
    assert.deepEqual(
      me.discarded.map((d) => [d.reason, d.unconfirmed]),
      [['not_found', true]],
    )
  })

  test('★ 세션이 끊기면 로그인으로 닫고 보존본은 남긴다 — 다시 로그인하면 보낼 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, member, pageId, blockId } = await fixture()
    const running = await startServer(t)
    const store = memoryPendingEditStore()
    const me = await open(t, running, member, { workspaceId, pageId }, store)
    await waitFor('연결', settled(me))

    me.gate.offline = true
    me.wire.sockets.at(-1)?.close()
    await waitFor('끊겼다', () => !me.connection.snapshot().online)
    edit(me.doc(), typeAt(blockId, '로그인 뒤 '))
    await waitFor('보존본에 썼다', () => store.entries.size === 1)
    await revokeSession(member.token)

    me.gate.offline = false
    await waitFor('닫았다', () => me.connection.snapshot().closed === 'login')
    assert.equal(store.entries.size, 1, '다시 로그인하면 보낼 편집을 지웠다')
    assert.deepEqual(me.discarded, [])
  })
})

// ── ⑦ 다시 붙기 ────────────────────────────────────────────────────

describe('⑦ 서버가 판정하지 못해 닫으면', () => {
  test('★ 로컬 문서를 버리지 않고 다시 붙어 그 사이 친 편집까지 보낸다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, pageId, blockId } = await fixture()
    const running = await startServer(t)
    const store = memoryPendingEditStore()
    const me = await open(t, running, owner, { workspaceId, pageId }, store)
    await waitFor('연결', settled(me))
    const first = me.doc()
    const socketsBefore = me.wire.sockets.length

    // 인증을 받은 뒤에도 서버가 그 연결을 문서에 올리기까지 틈이 있다 — 올라간 뒤에 닫는다(닫을 연결이 없으면 장면이 아니다).
    const serverConnections = () => [...running.server.hocuspocus.documents.values()].flatMap((document) => document.getConnections())
    await waitFor('서버가 연결을 문서에 올렸다', () => serverConnections().length === 1)
    for (const connection of serverConnections()) connection.close({ code: 4403, reason: 'unavailable' })
    edit(first, typeAt(blockId, '그 사이 '))
    await waitFor('다시 붙었다', () => me.wire.sockets.length > socketsBefore && settled(me)())
    await waitFor('보내고 지웠다', async () => store.entries.size === 0 && (await logTexts(pageId, '그 사이 ')))
    assert.equal(me.doc(), first, '로컬 문서를 버렸다')
    assert.deepEqual(me.discarded, [])
  })
})

// ── 이유 → 하는 일 ─────────────────────────────────────────────────

describe('닫힌 이유 → 하는 일', () => {
  test('쓰기 거부 · 강등 · 모르는 이유는 버리고 다시 열기 — 세션 · 권한 · 설정 · 판정 실패는 각자', () => {
    const reopen = ['forbidden', 'too_large', 'invalid_update', 'missing_dependencies', 'page_ref_forbidden', 'page_ref_too_deep', 'page_ref_unknown', '처음 보는 이유']
    for (const reason of reopen) assert.equal(rejectionAction(reason), 'reopen', reason)
    assert.equal(rejectionAction('not_found'), 'not_found')
    assert.equal(rejectionAction('unauthenticated'), 'login')
    assert.equal(rejectionAction('sso_required'), 'login')
    assert.equal(rejectionAction('unavailable'), 'retry')
    assert.equal(rejectionAction('forbidden_origin'), 'misconfigured')
  })
})

// ── ⑧ 지금 확인 청하기 ─────────────────────────────────────────────

describe('⑧ confirm()', () => {
  test('★ 창을 기다리지 않고 지금 청하며, 서버가 쌓은 뒤에 끝난다 — 내린 연결에서는 던진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, pageId, blockId } = await fixture()
    const feed = holdableFeed()
    const running = await startServer(t, { openFeed: (handlers) => feed.open(handlers) })
    t.after(() => feed.releaseIfHeld())
    const store = memoryPendingEditStore()
    // 창을 아주 길게 둔다 — 저절로 확인되면 이 검사가 아무것도 가려내지 못한다.
    const me = await open(t, running, owner, { workspaceId, pageId }, store, { offline: false }, { confirmDelayMs: 600_000 })
    await waitFor('연결', settled(me))

    feed.hold()
    const before = await logLength(pageId)
    edit(me.doc(), typeAt(blockId, '지금 '))
    let done = false
    const pending = me.connection.confirm().then(() => {
      done = true
    })
    await waitFor('쌓였다(확인은 신호를 기다린다)', async () => (await logLength(pageId)) === before + 1)
    assert.equal(done, false, '서버가 쌓기 전에 끝났다')

    feed.release()
    await pending
    assert.equal(store.entries.size, 0, '확인됐는데 보존본이 남았다')
    assert.equal(await logTexts(pageId, '지금 '), true)
    // 확인할 것이 없으면 곧바로 끝난다.
    await me.connection.confirm()

    await me.connection.destroy()
    await assert.rejects(() => me.connection.confirm())
  })

  test('★ 끊겨 있으면 다시 붙는 대로 청한다 — 창을 기다리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, pageId, blockId } = await fixture()
    const running = await startServer(t)
    const store = memoryPendingEditStore()
    const me = await open(t, running, owner, { workspaceId, pageId }, store, { offline: false }, { confirmDelayMs: 600_000 })
    await waitFor('연결', settled(me))

    me.gate.offline = true
    me.wire.sockets.at(-1)?.close()
    await waitFor('끊겼다', () => !me.connection.snapshot().online)
    edit(me.doc(), typeAt(blockId, '끊긴 채 '))
    let done = false
    const pending = me.connection.confirm().then(() => {
      done = true
    })
    await waitFor('한동안 기다린다', () => me.wire.sockets.length >= 3, 10_000)
    assert.equal(done, false, '서버에 닿지도 않았는데 끝났다')

    me.gate.offline = false
    me.onlineSource.dispatchEvent(new Event('online'))
    await pending
    assert.equal(await logTexts(pageId, '끊긴 채 '), true)
    assert.equal(store.entries.size, 0)
  })
})

// ── ⑨ 연결이 돌아왔다는 신호 ───────────────────────────────────────

describe('⑨ 연결이 돌아오면', () => {
  test('★ provider 의 다음 시도를 기다리지 않고 곧바로 다시 붙어 그 사이 친 편집을 보낸다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, pageId, blockId } = await fixture()
    const running = await startServer(t)
    const store = memoryPendingEditStore()
    const me = await open(t, running, owner, { workspaceId, pageId }, store)
    await waitFor('연결', settled(me))

    me.gate.offline = true
    me.wire.sockets.at(-1)?.close()
    await waitFor('끊겼다', () => !me.connection.snapshot().online)
    edit(me.doc(), typeAt(blockId, '돌아온 뒤 '))
    // 두 번 넘게 헛되이 시도하게 둔다 — provider 는 시도마다 간격을 두 배로 늘린다(다음 시도는 2s 뒤가 넘는다).
    await waitFor('두 번 넘게 시도했다', () => me.wire.sockets.length >= 4, 20_000)

    me.gate.offline = false
    const sockets = me.wire.sockets.length
    me.onlineSource.dispatchEvent(new Event('online'))
    await waitFor('곧바로 다시 붙었다', () => me.wire.sockets.length > sockets, 800)
    await waitFor('그 사이 친 편집이 쌓였다', async () => await logTexts(pageId, '돌아온 뒤 '))
    await waitFor('보존본이 비워졌다', () => store.entries.size === 0)
  })

  test('★ 내린 연결은 다시 붙지 않는다 — 소켓이 예약해 둔 재시도가 그것을 되살리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, pageId } = await fixture()
    const running = await startServer(t)
    const me = await open(t, running, owner, { workspaceId, pageId }, memoryPendingEditStore())
    await waitFor('연결', settled(me))

    // 붙어 있던 소켓이 끊기면 **다음 시도를 예약한다**(`onClose` 의 setTimeout). 그 예약이 남아 있는 동안 내린다 —
    // 재시도 루프가 이미 도는 중이면 예약이 아니라 루프라 이 장면이 아니다.
    me.gate.offline = true
    me.wire.sockets.at(-1)?.close()
    await waitFor('끊겼다', () => !me.connection.snapshot().online)

    await me.connection.destroy()
    const sockets = me.wire.sockets.length
    // 예약된 시도가 지나갈 만큼 기다린다 — 되살아나면 소켓이 는다.
    await new Promise((resolve) => setTimeout(resolve, 4000))
    assert.equal(me.wire.sockets.length, sockets, '내린 연결이 다시 붙었다')
  })
})
