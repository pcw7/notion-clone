/**
 * 협업 서버 — CRDT 5a조각 · 5b조각 · 5c조각 (DB · 실제 WebSocket)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **연결을 받을 때** — 세션 쿠키 · 멤버십 · 페이지 권한 · Origin 을 본다. 볼 수 없는 페이지 · 없는 페이지 · 남의
 *      워크스페이스는 같은 이유다
 *   ② **볼 수만 있는 연결은 읽기 전용** — 본문은 오고, 보낸 편집은 쌓이지도 퍼지지도 않는다
 *   ③ **편집은 로그에 쌓이고 행에 투영되고 다른 참여자에게 간다** — 서버를 다시 띄워도 로그에서 같은 본문을 읽는다
 *   ④ **쓰기마다 다시 묻는다** — 연결 뒤에 권한이 내려간 사람 · 세션이 끊긴 사람의 update 는 쌓이지도 퍼지지도 않는다
 *   ⑤ **수선은 모두에게 간다** — 오프라인 편집이 합쳐져 생긴 구조 위반을 로그가 한 번 고치고 두 참여자가 받는다
 *   ⑥ **명령이 쓴 것과 섞여도 수렴한다** — 메모리 문서가 모르던 로그를 다음 편집이 가져온다
 *   ⑦ **하위 페이지 참조를 지운 편집은 그 페이지를 휴지통으로 보내고 퍼진다**(정본 프로젝터 · 5b) — 버릴 권한이 없는 사람의
 *      편집은 쌓지도 퍼뜨리지도 않고 그 연결을 닫는다
 *   ⑧ **명령이 쓴 것은 누가 편집하기를 기다리지 않고 곧바로 간다**(5c)
 *   ⑨ **권한이 줄면 아무도 쓰지 않아도 서버가 먼저 닫는다** — 강등은 `forbidden`(읽기 전용으로 다시 연다), 회수 · 멤버 제외 ·
 *      휴지통은 `not_found`, 세션 폐기는 `unauthenticated`. 권한이 그대로인 연결은 계속 받는다
 *   ⑩ **회수가 커밋된 뒤에 커밋된 명령 · 편집은 회수된 연결에 가지 않는다** — 신호가 늦게 도착해도. 꼬리는 신호가 알린 seq
 *      까지만 적용한다
 *   ⑪ **권한 검사와 연결 등록 사이에 회수돼도** 첫 동기화에 본문을 답하기 전에 닫는다
 *   ⑫ **신호를 듣는 연결이 끊겨도** 다시 붙으면 그 사이 명령이 쓴 것을 가져오고, 그 사이 회수된 연결은 가져온 것을 받기 전에 닫는다
 *
 * ⑩ 은 커밋 신호를 붙잡아 두었다가 놓아 "신호가 늦게 온다"를 만든다(`holdableFeed`). ④ 도 신호를 붙잡는다 — 권한 신호가 먼저
 * 닫으면 "쓰기마다 다시 묻는다"를 가려낼 수 없다.
 *
 * 참여자는 `@hocuspocus/provider` 다 — 에디터 바인딩(6조각)이 쓸 클라이언트와 같다. 편집은 `testing/collab-peers.ts` 의
 * `edit` 으로 provider 의 Y.Doc 에 쓴다(에디터가 Y.Doc 에 쓰는 것과 같은 함수).
 *
 * "퍼지지 않았다"는 기다린다고 증명되지 않는다. 그래서 **나중에 보낸 것이 도착한 뒤에** 본다 — 서버는 받은 순서대로 적용하고
 * 퍼뜨리므로, 막았어야 할 update 가 퍼졌다면 뒤에 보낸 것보다 먼저 닿았다.
 */

import { test, describe, before, after, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { SESSION_COOKIE } from '../auth/constants.ts'
import { revokeSession } from '../auth/session.ts'
import { hashSessionToken } from '../auth/session-context.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { trashPage } from '../block/trash.ts'
import { textRun } from '../contracts/rich-text.ts'
import { getPool, query } from '../db/pool.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { blockSchema } from '../editor/schema.ts'
import type { Level } from '../permissions/levels.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { assertBodyMatchesYDoc } from '../testing/body-invariant.ts'
import { edit, findBlock } from '../testing/collab-peers.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { openChangeFeed, type ChangeFeed, type ChangeFeedHandlers, type CollabSignal } from './change-feed.ts'
import { collabDocumentName, createCollabServer, type CollabServerOptions } from './collab-server.ts'
import { loadDocState } from './doc-store.ts'
import { readBodyYDoc, type BodyRead } from './ydoc.ts'

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

const APP_ORIGIN = 'http://app.test'

type Running = { readonly url: string; stop(): Promise<void> }

/** 검사마다 서버를 띄운다 — 포트는 OS 가 고른다. 검사가 끝나면 내린다. */
async function startServer(t: TestContext, extra: Pick<CollabServerOptions, 'openFeed'> = {}): Promise<Running> {
  const server = createCollabServer({ port: 0, allowedOrigins: [APP_ORIGIN], quiet: true, stopOnSignals: false, ...extra })
  await server.listen()
  const stop = () => Promise.race([server.destroy(), new Promise<void>((resolve) => setTimeout(resolve, 5000))])
  t.after(stop)
  return { url: `ws://127.0.0.1:${server.address.port}`, stop }
}

type Participant = {
  readonly doc: Y.Doc
  readonly provider: HocuspocusProvider
  /** 연결을 받지 않은 이유. */
  failure: string | null
  /** 받은 뒤에 서버가 이 문서 연결을 닫은 이유. */
  readonly closed: string[]
}

const cookieOf = (actor: Actor, extra: Record<string, string> = {}): Record<string, string> => ({
  cookie: `${SESSION_COOKIE}=${actor.token}`,
  ...extra,
})

/** 페이지 하나에 붙는 참여자. `headers` 는 업그레이드 요청에 싣는다 — 브라우저가 쿠키 · Origin 을 싣는 것처럼. */
function join(t: TestContext, url: string, name: string, headers: Record<string, string>, clientId?: number): Participant {
  class HeaderSocket extends WebSocket {
    constructor(address: string | URL) {
      // Node 의 WebSocket(undici)은 두 번째 인자로 헤더를 받는다(진단으로 확인).
      super(address, { headers } as unknown as string[])
    }
  }
  const doc = new Y.Doc()
  if (clientId !== undefined) doc.clientID = clientId
  const closed: string[] = []
  const state = { failure: null as string | null }
  const provider = new HocuspocusProvider({
    url,
    name,
    document: doc,
    WebSocketPolyfill: HeaderSocket,
    onAuthenticationFailed: ({ reason }) => {
      state.failure = reason
    },
    // 소켓이 끊길 때도 불리지만 이유가 비어 있다. 서버가 문서 연결을 닫을 때만 이유가 있다.
    onClose: ({ event }) => {
      if (event.reason) closed.push(event.reason)
    },
  })
  t.after(() => provider.destroy())
  return {
    doc,
    provider,
    closed,
    get failure() {
      return state.failure
    },
  }
}

async function waitFor(label: string, check: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  for (;;) {
    if (await check()) return
    if (Date.now() > end) assert.fail(`기다리다 끝났다 — ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const ready = (...participants: Participant[]) =>
  waitFor('연결 · 첫 동기화', () => participants.every((p) => p.provider.isAuthenticated && p.provider.isSynced))

/** 조건이 서거나 시간이 다 될 때까지 — 실패하지 않는다. 뒤따르는 단언이 무엇이 달랐는지 보여 준다. */
async function waitUntil(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  while (!check() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20))
}

/** 커밋 신호를 붙잡아 두었다가 차례대로 놓는다 — 신호가 늦게 도착하는 장면을 만든다(실제 LISTEN 을 감싼다). */
function holdableFeed() {
  let target: ChangeFeedHandlers | null = null
  let held: CollabSignal[] | null = null
  return {
    open(handlers: ChangeFeedHandlers): Promise<ChangeFeed> {
      target = handlers
      return openChangeFeed({
        onSignal: (signal) => {
          if (held === null) handlers.onSignal(signal)
          else held.push(signal)
        },
        onResync: () => handlers.onResync(),
      })
    },
    hold(): void {
      held = []
    },
    held: (): readonly CollabSignal[] => held ?? [],
    /** 붙잡은 신호를 `until` 에 맞는 것까지 차례대로 놓는다. `until` 이 없으면 전부 놓고 붙잡기를 끝낸다. */
    release(until?: (signal: CollabSignal) => boolean): void {
      assert.ok(held !== null && target !== null, '붙잡고 있지 않다')
      if (until === undefined) {
        const all = held
        held = null
        for (const signal of all) target.onSignal(signal)
        return
      }
      const index = held.findIndex(until)
      assert.ok(index >= 0, '놓을 신호를 붙잡지 않았다')
      for (const signal of held.splice(0, index + 1)) target.onSignal(signal)
    },
  }
}

const docSignal = (pageId: string, seq: string) => (signal: CollabSignal) =>
  signal.kind === 'doc' && signal.pageId === pageId && signal.seq === seq

const para = (text: string, id: string = randomUUID()): EditorBlock => ({
  id,
  type: 'paragraph',
  title: text === '' ? [] : [textRun(text)],
})

const bodyOf = (ydoc: Y.Doc, pageId: string): EditorDoc => readBodyYDoc(ydoc, pageId).doc
const textsOf = (doc: EditorDoc): string[] => doc.blocks.map((b) => b.title.map((r) => r.plain_text).join(''))
const hasBlock = (ydoc: Y.Doc, pageId: string, blockId: string): boolean => bodyOf(ydoc, pageId).blocks.some((b) => b.id === blockId)

const logOf = (pageId: string) =>
  query<{ seq: string; origin: string; actor_id: string | null }>(
    `SELECT seq, origin, actor_id FROM doc_update WHERE page_id = $1 ORDER BY seq`,
    [pageId],
  )

const lifecycleOf = async (id: string): Promise<string> =>
  (await query<{ lifecycle: string }>(`SELECT lifecycle FROM block WHERE id = $1`, [id]))[0].lifecycle

async function storedBody(actor: Actor, pageId: string): Promise<BodyRead> {
  const state = await loadDocState(actor.ctx, pageId)
  if (!state.ok) throw new Error(`본문을 읽지 못했다: ${pageId}`)
  return readBodyYDoc(state.value.ydoc, pageId)
}

/** 워크스페이스 · 소유자 · 멤버 · 본문이 있는 최상위 페이지(모두가 고칠 수 있다). */
async function pageFixture(texts: string[]) {
  const workspaceId = await createBareWorkspace('협업 서버')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  const page = await createPage(owner.ctx, { parentPageId: null as never, title: titleFromPlainText('페이지') })
  const ids = texts.map(() => randomUUID())
  const saved = await savePageBody(owner.ctx, page.id as never, { blocks: texts.map((text, i) => para(text, ids[i])) })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const pageId: string = page.id
  return { workspaceId, owner, member, pageId, ids, name: collabDocumentName(workspaceId, pageId) }
}

/** 모두에게 열린 최상위 페이지를 소유자만의 페이지로 바꾸고, 지정한 사람에게만 레벨을 준다. */
async function restrict(owner: Actor, pageId: string, grants: readonly [Actor, Level][]): Promise<void> {
  assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
  for (const [actor, level] of grants) {
    assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: actor.userId }, level)).ok, true)
  }
  assert.equal((await revokeAccess(owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
}

type Change = (tr: Transaction, doc: PmNode) => void

const insertAtStart = (blockId: string, text: string): Change => (tr, doc) => {
  tr.insertText(text, findBlock(doc, blockId).pos + 2)
}

const removeBlock = (blockId: string): Change => (tr, doc) => {
  const { pos, node } = findBlock(doc, blockId)
  tr.delete(pos, pos + node.nodeSize)
}

const setType = (blockId: string, type: string, props: Record<string, unknown> = {}): Change => (tr, doc) => {
  tr.setNodeMarkup(findBlock(doc, blockId).pos + 1, blockSchema.nodes[type], { props, format: {} })
}

// ── ① 연결을 받을 때 ─────────────────────────────────────────────────

describe('① 연결을 받을 때', () => {
  test('★ 세션 쿠키 · 멤버십 · 페이지 권한 · Origin 을 본다 — 볼 수 없는 페이지 · 없는 페이지 · 남의 워크스페이스는 같은 이유다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, member, pageId, name } = await pageFixture(['원문'])
    const hidden = await createPage(owner.ctx, { parentPageId: null as never, title: titleFromPlainText('비공개') })
    await restrict(owner, hidden.id, [])
    const stranger = await joinAs(await createBareWorkspace('남의 워크스페이스'), await createUser('남'), 'owner')
    const server = await startServer(t)

    const cases: readonly [string, Record<string, string>, string][] = [
      [name, {}, 'unauthenticated'],
      [name, cookieOf(stranger), 'not_found'],
      [collabDocumentName(workspaceId, hidden.id), cookieOf(member), 'not_found'],
      [collabDocumentName(workspaceId, randomUUID()), cookieOf(owner), 'not_found'],
      ['페이지가 아닌 이름', cookieOf(owner), 'not_found'],
      [name, cookieOf(owner, { origin: 'https://evil.example' }), 'forbidden_origin'],
    ]
    const refused = cases.map(([doc, headers]) => join(t, server.url, doc, headers))
    await waitFor('모두 거부된다', () => refused.every((p) => p.failure !== null))
    assert.deepEqual(
      refused.map((p) => p.failure),
      cases.map(([, , reason]) => reason),
    )

    const allowed = join(t, server.url, name, cookieOf(owner, { origin: APP_ORIGIN }))
    await ready(allowed)
    assert.equal(allowed.provider.authorizedScope, 'read-write')
    assert.deepEqual(textsOf(bodyOf(allowed.doc, pageId)), ['원문'])
  })
})

// ── ② 읽기 전용 ──────────────────────────────────────────────────────

describe('② 볼 수만 있는 연결', () => {
  test('★ 읽기 전용으로 받는다 — 본문은 오고, 보낸 편집은 쌓이지도 퍼지지도 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, pageId, ids, name } = await pageFixture(['원문'])
    await restrict(owner, pageId, [[member, 'view']])
    const server = await startServer(t)
    const [writer, reader] = [join(t, server.url, name, cookieOf(owner)), join(t, server.url, name, cookieOf(member))]
    await ready(writer, reader)
    assert.equal(reader.provider.authorizedScope, 'readonly')
    assert.deepEqual(textsOf(bodyOf(reader.doc, pageId)), ['원문'])
    const before = await logOf(pageId)

    edit(reader.doc, insertAtStart(ids[0], '몰래 '))
    // 같은 연결로 뒤이어 보낸 awareness 가 쓰는 쪽에 닿으면, 앞의 편집은 서버가 이미 처리했다.
    reader.provider.setAwarenessField('mark', 'after-edit')
    await waitFor('읽는 쪽의 awareness 가 닿는다', () => writer.provider.awareness?.getStates().get(reader.doc.clientID)?.mark === 'after-edit')

    assert.deepEqual(textsOf(bodyOf(writer.doc, pageId)), ['원문'], '읽기 전용 연결의 편집이 퍼졌다')
    assert.deepEqual(await logOf(pageId), before, '읽기 전용 연결의 편집이 쌓였다')
  })
})

// ── ③ 편집 ───────────────────────────────────────────────────────────

describe('③ 편집', () => {
  test('★ 로그에 쌓이고(editor · 보낸 사람) 행에 투영되고 다른 참여자에게 간다 — 서버를 다시 띄워도 로그에서 같은 본문을 읽는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, pageId, ids, name } = await pageFixture(['원문', '둘째'])
    const server = await startServer(t)
    const [a, b] = [join(t, server.url, name, cookieOf(owner)), join(t, server.url, name, cookieOf(member))]
    await ready(a, b)

    edit(a.doc, insertAtStart(ids[0], '앞 '))
    await waitFor('다른 참여자가 받는다', () => textsOf(bodyOf(b.doc, pageId))[0] === '앞 원문')

    const last = (await logOf(pageId)).at(-1)
    assert.deepEqual([last?.origin, last?.actor_id], ['editor', owner.userId])
    const rows = await loadPageBody(owner.ctx, pageId as never)
    assert.deepEqual(rows === null ? null : textsOf(rows.doc), ['앞 원문', '둘째'], '행에 투영되지 않았다')
    await assertBodyMatchesYDoc(owner.ctx, pageId)

    a.provider.destroy()
    b.provider.destroy()
    await server.stop()
    const again = await startServer(t)
    const c = join(t, again.url, name, cookieOf(member))
    await ready(c)
    assert.deepEqual(textsOf(bodyOf(c.doc, pageId)), ['앞 원문', '둘째'])
  })
})

// ── ④ 쓰기마다 다시 묻는다 ───────────────────────────────────────────

describe('④ 쓰기마다 다시 묻는다', () => {
  test('★ 연결 뒤에 권한이 보기로 내려간 사람 · 세션이 끊긴 사람의 update 는 쌓이지도 퍼지지도 않고 그 연결이 닫힌다 — 권한 신호가 오기 전이어도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, member, pageId, ids, name } = await pageFixture(['원문'])
    const leaver = await joinAs(workspaceId, await createUser('나갈 사람'), 'member')
    const feed = holdableFeed()
    const server = await startServer(t, { openFeed: (handlers) => feed.open(handlers) })
    const [writer, watcher, demoted, loggedOut] = [
      join(t, server.url, name, cookieOf(owner)),
      join(t, server.url, name, cookieOf(owner)),
      join(t, server.url, name, cookieOf(member)),
      join(t, server.url, name, cookieOf(leaver)),
    ]
    await ready(writer, watcher, demoted, loggedOut)
    assert.equal(demoted.provider.authorizedScope, 'read-write', '전제: 쓰기로 받은 연결이다')

    // 권한 신호가 먼저 닫지 못하게 붙잡는다 — 쓰기에서 다시 묻는 것만으로 닫히는지 본다.
    feed.hold()
    await restrict(owner, pageId, [[member, 'view'], [leaver, 'edit']])
    await query(`UPDATE user_session SET revoked_at = now() WHERE token_hash = $1`, [hashSessionToken(leaver.token)])
    const before = await logOf(pageId)

    edit(demoted.doc, insertAtStart(ids[0], '내려간 '))
    edit(loggedOut.doc, insertAtStart(ids[0], '끊긴 '))
    await waitFor('두 연결이 닫힌다', () => demoted.closed.length > 0 && loggedOut.closed.length > 0)
    assert.deepEqual([demoted.closed, loggedOut.closed], [['forbidden'], ['unauthenticated']])

    feed.release()
    edit(writer.doc, insertAtStart(ids[0], '!'))
    await waitFor('뒤에 보낸 편집이 닿는다', () => textsOf(bodyOf(watcher.doc, pageId))[0].startsWith('!'))
    assert.deepEqual(textsOf(bodyOf(watcher.doc, pageId)), ['!원문'], '거부된 편집이 퍼졌다')
    const log = await logOf(pageId)
    assert.equal(log.length, before.length + 1)
    assert.ok(log.every((row) => row.actor_id !== member.userId && row.actor_id !== leaver.userId), '거부된 편집이 쌓였다')
  })
})

// ── ⑤ 수선 ────────────────────────────────────────────────────────────

describe('⑤ 수선은 모두에게 간다', () => {
  test('★ 오프라인 편집이 합쳐져 생긴 구조 위반을 로그가 한 번 고치고, 두 참여자 모두 고친 문서를 갖는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, pageId, ids, name } = await pageFixture(['원문', '옆'])
    const [x] = ids
    const server = await startServer(t)
    const [a, b] = [join(t, server.url, name, cookieOf(owner), 41), join(t, server.url, name, cookieOf(member), 42)]
    await ready(a, b)

    const socketOfB = b.provider.configuration.websocketProvider
    socketOfB.disconnect()
    await waitFor('b 가 끊긴다', () => !b.provider.isSynced)
    const before = await logOf(pageId)
    edit(a.doc, setType(x, 'heading_2'))
    await waitFor('a 의 편집이 쌓인다', async () => (await logOf(pageId)).length === before.length + 1)
    edit(b.doc, setType(x, 'to_do', { checked: false }))

    const merged = new Y.Doc()
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(a.doc))
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(b.doc))
    assert.ok(readBodyYDoc(merged, pageId).fixes.includes('type_conflict_resolved'), '전제: 두 편집을 합치면 구조 위반이다')

    socketOfB.connect()
    const has = (ydoc: Y.Doc, clientId: number) => Y.decodeStateVector(Y.encodeStateVector(ydoc)).has(clientId)
    await waitFor('서로의 편집을 받는다', () => has(a.doc, 42) && has(b.doc, 41))
    await waitFor('수선까지 받는다', () => readBodyYDoc(a.doc, pageId).fixes.length === 0 && readBodyYDoc(b.doc, pageId).fixes.length === 0)

    const stored = await storedBody(owner, pageId)
    assert.deepEqual(stored.fixes, [])
    assert.deepEqual(readBodyYDoc(a.doc, pageId), stored)
    assert.deepEqual(readBodyYDoc(b.doc, pageId), stored)
    assert.equal((await logOf(pageId)).length, before.length + 2, '수선이 따로 seq 를 받았다')
    await assertBodyMatchesYDoc(owner.ctx, pageId)
  })
})

// ── ⑥ 명령과 섞여도 ──────────────────────────────────────────────────

describe('⑥ 명령이 쓴 것과 섞여도', () => {
  test('★ 수렴한다 — 메모리 문서가 모르던 로그(하위 페이지 생성이 넣은 참조)를 다음 편집이 가져와 모두에게 준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, pageId, ids, name } = await pageFixture(['원문'])
    const server = await startServer(t)
    const [a, b] = [join(t, server.url, name, cookieOf(owner)), join(t, server.url, name, cookieOf(member))]
    await ready(a, b)

    const child = await createPage(owner.ctx, { parentPageId: pageId as never, title: titleFromPlainText('하위') })
    edit(a.doc, insertAtStart(ids[0], '앞 '))
    await waitFor(
      '두 참여자가 편집과 참조를 받는다',
      () => hasBlock(a.doc, pageId, child.id) && hasBlock(b.doc, pageId, child.id) && textsOf(bodyOf(b.doc, pageId))[0] === '앞 원문',
    )

    const stored = await storedBody(owner, pageId)
    assert.deepEqual(readBodyYDoc(a.doc, pageId), stored)
    assert.deepEqual(readBodyYDoc(b.doc, pageId), stored)
    await assertBodyMatchesYDoc(owner.ctx, pageId)
  })
})

// ── ⑦ 하위 페이지 참조를 지운 편집 ──────────────────────────────────

describe('⑦ 하위 페이지 참조를 지운 편집', () => {
  test('★ 그 페이지를 휴지통으로 보내고 모두에게 퍼진다 — 버릴 권한이 없는 사람의 편집은 쌓지도 퍼뜨리지도 않고 그 연결을 닫는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, pageId, name } = await pageFixture(['원문'])
    const open = await createPage(owner.ctx, { parentPageId: pageId as never, title: titleFromPlainText('열린 하위') })
    const guarded = await createPage(owner.ctx, { parentPageId: pageId as never, title: titleFromPlainText('지킨 하위') })
    // 멤버는 볼 수만 있게 — 부모에게서 받던 것을 복사해 끊고 모두에게서 회수한다.
    assert.equal((await stopInheriting(owner.ctx, guarded.id)).ok, true)
    await restrict(owner, guarded.id, [[member, 'view']])

    const server = await startServer(t)
    const [intruder, remover, watcher] = [
      join(t, server.url, name, cookieOf(member)),
      join(t, server.url, name, cookieOf(owner)),
      join(t, server.url, name, cookieOf(owner)),
    ]
    await ready(intruder, remover, watcher)
    assert.ok(hasBlock(intruder.doc, pageId, guarded.id) && hasBlock(watcher.doc, pageId, open.id), '전제: 참조가 본문에 있다')
    const before = await logOf(pageId)

    edit(intruder.doc, removeBlock(guarded.id))
    await waitFor('버릴 권한이 없는 쪽 연결이 닫힌다', () => intruder.closed.length > 0)
    assert.deepEqual(intruder.closed, ['page_ref_forbidden'])

    edit(remover.doc, removeBlock(open.id))
    await waitFor('뒤에 보낸 편집이 닿는다', () => !hasBlock(watcher.doc, pageId, open.id))
    assert.ok(hasBlock(watcher.doc, pageId, guarded.id), '버릴 권한이 없는 편집이 퍼졌다')

    assert.deepEqual([await lifecycleOf(open.id), await lifecycleOf(guarded.id)], ['trashed', 'live'])
    const log = await logOf(pageId)
    assert.equal(log.length, before.length + 1)
    assert.deepEqual([log.at(-1)?.actor_id], [owner.userId])
    await assertBodyMatchesYDoc(owner.ctx, pageId)
  })
})

// ── ⑧ 명령이 쓴 것 ───────────────────────────────────────────────────

describe('⑧ 명령이 쓴 것', () => {
  test('★ 누가 편집하기를 기다리지 않고 곧바로 모두에게 간다 — 하위 페이지 생성 · 휴지통', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, pageId, name } = await pageFixture(['원문'])
    const server = await startServer(t)
    const [a, b] = [join(t, server.url, name, cookieOf(owner)), join(t, server.url, name, cookieOf(member))]
    await ready(a, b)

    const child = await createPage(owner.ctx, { parentPageId: pageId as never, title: titleFromPlainText('하위') })
    await waitFor('두 참여자가 참조를 받는다', () => hasBlock(a.doc, pageId, child.id) && hasBlock(b.doc, pageId, child.id))

    await trashPage(owner.ctx, child.id as never)
    await waitFor('휴지통으로 보낸 참조가 빠진다', () => !hasBlock(a.doc, pageId, child.id) && !hasBlock(b.doc, pageId, child.id))

    const stored = await storedBody(owner, pageId)
    assert.deepEqual(readBodyYDoc(a.doc, pageId), stored)
    assert.deepEqual(readBodyYDoc(b.doc, pageId), stored)
  })
})

// ── ⑨ 권한이 줄면 ────────────────────────────────────────────────────

describe('⑨ 권한이 줄면', () => {
  test('★ 아무도 쓰지 않아도 서버가 먼저 닫는다 — 강등 forbidden · 회수 · 멤버 제외 · 휴지통 not_found · 세션 폐기 unauthenticated, 그대로인 연결은 계속 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, member: demoted, pageId, ids, name } = await pageFixture(['원문'])
    const revoked = await joinAs(workspaceId, await createUser('회수될 사람'), 'member')
    const loggedOut = await joinAs(workspaceId, await createUser('로그아웃할 사람'), 'member')
    const removed = await joinAs(workspaceId, await createUser('내보낼 사람'), 'member')
    await restrict(owner, pageId, [[demoted, 'edit'], [revoked, 'view'], [loggedOut, 'edit'], [removed, 'edit']])
    const doomed = await createPage(owner.ctx, { parentPageId: null as never, title: titleFromPlainText('버릴 페이지') })

    const server = await startServer(t)
    const [writer, watcher] = [join(t, server.url, name, cookieOf(owner)), join(t, server.url, name, cookieOf(owner))]
    const victims = {
      demoted: join(t, server.url, name, cookieOf(demoted)),
      revoked: join(t, server.url, name, cookieOf(revoked)),
      loggedOut: join(t, server.url, name, cookieOf(loggedOut)),
      removed: join(t, server.url, name, cookieOf(removed)),
      trashed: join(t, server.url, collabDocumentName(workspaceId, doomed.id), cookieOf(owner)),
    }
    await ready(writer, watcher, ...Object.values(victims))
    assert.deepEqual(
      [victims.demoted.provider.authorizedScope, victims.revoked.provider.authorizedScope],
      ['read-write', 'readonly'],
      '전제: 강등될 연결은 쓰기, 회수될 연결은 읽기 전용으로 받았다',
    )

    // 쓰기 하나마다 그 연결이 닫히기를 기다린다. 다시 판정은 워크스페이스 단위라 한꺼번에 쓰면 뒤의 쓰기가 보낸 신호가 앞의
    // 연결까지 닫는다 — 그러면 어느 쓰기가 신호를 보내지 않아도 통과한다(트리거를 끄는 반사실에서 통과해서 알았다).
    const steps: readonly [keyof typeof victims, () => Promise<unknown>, string][] = [
      ['demoted', () => grantAccess(owner.ctx, pageId, { type: 'user', id: demoted.userId }, 'view'), 'forbidden'],
      ['revoked', () => revokeAccess(owner.ctx, pageId, { type: 'user', id: revoked.userId }), 'not_found'],
      ['loggedOut', () => revokeSession(loggedOut.token), 'unauthenticated'],
      [
        'removed',
        () => query(`UPDATE workspace_member SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, removed.userId]),
        'not_found',
      ],
      ['trashed', () => trashPage(owner.ctx, doomed.id as never), 'not_found'],
    ]
    for (const [who, write, reason] of steps) {
      const still = Object.entries(victims).filter(([other, p]) => other !== who && p.closed.length === 0).map(([other]) => other)
      await write()
      await waitUntil(() => victims[who].closed.length > 0)
      assert.deepEqual(victims[who].closed, [reason], `${who} — 그 쓰기의 신호로 닫혀야 한다`)
      assert.deepEqual(
        still.filter((other) => victims[other as keyof typeof victims].closed.length > 0),
        [],
        `${who} 의 쓰기가 다른 연결을 닫았다`,
      )
    }

    edit(writer.doc, insertAtStart(ids[0], '!'))
    await waitFor('권한이 그대로인 연결은 계속 받는다', () => textsOf(bodyOf(watcher.doc, pageId))[0] === '!원문')
    assert.deepEqual([writer.closed, watcher.closed], [[], []])
  })
})

// ── ⑩ 신호의 순서 ────────────────────────────────────────────────────

describe('⑩ 권한 신호와 본문 신호의 순서', () => {
  test('★ 회수가 커밋된 뒤에 커밋된 명령 · 편집은 회수된 연결에 가지 않는다 — 신호가 늦게 와도. 그 앞의 명령은 간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, pageId, ids, name } = await pageFixture(['원문'])
    const feed = holdableFeed()
    const server = await startServer(t, { openFeed: (handlers) => feed.open(handlers) })
    const [writer, watcher, victim] = [
      join(t, server.url, name, cookieOf(owner)),
      join(t, server.url, name, cookieOf(owner)),
      join(t, server.url, name, cookieOf(member)),
    ]
    await ready(writer, watcher, victim)

    feed.hold()
    const beforeRevoke = await createPage(owner.ctx, { parentPageId: pageId as never, title: titleFromPlainText('회수 전') })
    const beforeSeq = (await logOf(pageId)).at(-1)?.seq ?? ''
    await restrict(owner, pageId, [])
    const afterRevoke = await createPage(owner.ctx, { parentPageId: pageId as never, title: titleFromPlainText('회수 뒤') })
    const logged = (await logOf(pageId)).length
    edit(writer.doc, insertAtStart(ids[0], '회수 뒤 '))
    await waitFor('편집이 쌓인다', async () => (await logOf(pageId)).length === logged + 1)
    assert.ok(
      !hasBlock(watcher.doc, pageId, beforeRevoke.id) && textsOf(bodyOf(victim.doc, pageId))[0] === '원문',
      '전제: 신호를 붙잡은 동안에는 아무것도 퍼지지 않는다',
    )

    // 회수 전 명령의 신호까지만 놓는다. 그 신호로 꼬리를 끝까지 읽으면 이미 커밋된 회수 뒤의 것까지 함께 간다.
    await waitFor('회수 전 명령의 신호를 붙잡았다', () => feed.held().some(docSignal(pageId, beforeSeq)))
    feed.release(docSignal(pageId, beforeSeq))
    await waitFor('회수 전 명령은 모두에게 간다', () => hasBlock(victim.doc, pageId, beforeRevoke.id) && hasBlock(watcher.doc, pageId, beforeRevoke.id))
    assert.ok(!hasBlock(victim.doc, pageId, afterRevoke.id), '신호가 알린 seq 를 넘어 읽었다 — 회수 뒤의 명령이 함께 갔다')

    feed.release()
    await waitFor('회수된 연결이 닫힌다', () => victim.closed.length > 0)
    await waitFor(
      '남은 연결은 회수 뒤의 것도 받는다',
      () => hasBlock(watcher.doc, pageId, afterRevoke.id) && textsOf(bodyOf(watcher.doc, pageId))[0] === '회수 뒤 원문',
    )
    assert.deepEqual(victim.closed, ['not_found'])
    assert.ok(!hasBlock(victim.doc, pageId, afterRevoke.id), '회수 뒤에 커밋된 명령이 회수된 연결에 갔다')
    assert.equal(textsOf(bodyOf(victim.doc, pageId))[0], '원문', '회수 뒤에 커밋된 편집이 회수된 연결에 갔다')
  })
})

// ── ⑪ 권한 검사와 연결 등록 사이 ─────────────────────────────────────

describe('⑪ 권한 검사와 연결 등록 사이', () => {
  test('★ 문서를 불러오는 사이에 권한이 회수돼도 첫 동기화에 본문을 답하기 전에 닫는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, member, pageId, name } = await pageFixture(['원문'])
    const secret = await createPage(owner.ctx, { parentPageId: pageId as never, title: titleFromPlainText('비밀') })
    assert.equal((await savePageBody(owner.ctx, secret.id as never, { blocks: [para('비밀 본문')] })).ok, true)
    // 옮기기 전 페이지를 흉내 낸다 — 본문 행은 두고 로그 · 스냅샷만 지운다(doc-store 검사와 같은 방법). 처음 불러오는 쪽이 행에서
    // 본문을 옮기며 스냅샷 행을 넣는다. ⚠ 본문이 비어 있으면 받은 것을 가려낼 수 없다 — 처음 쓴 이 검사는 빈 페이지로 만들어서
    // "첫 동기화 전 판정"을 빼는 반사실에서 통과했다(늦게 붙은 쪽이 곧이어 보내는 SyncStep2 가 쓰기 경로에서 같은 이유로 닫혔다).
    await query(`DELETE FROM doc_update WHERE page_id = $1`, [secret.id])
    await query(`DELETE FROM doc_snapshot WHERE page_id = $1`, [secret.id])
    const server = await startServer(t)
    const canary = join(t, server.url, name, cookieOf(member))
    await ready(canary)

    // 같은 페이지의 스냅샷 행을 커밋하지 않고 넣어 둔다 — 불러오는 쪽은 권한 검사(`loadDocState` 의 첫 단계)를 지나 옮기기
    // INSERT 에서 이 트랜잭션을 기다린다. 이 페이지만 기다리므로 다른 검사 파일과 섞이지 않는다.
    const locker = await getPool().connect()
    let late: Participant | null = null
    try {
      await locker.query('BEGIN')
      await locker.query(
        `INSERT INTO doc_snapshot (page_id, state, state_vector, merged_seq, updated_at) VALUES ($1, '\\x00', '\\x00', 1, now())`,
        [secret.id],
      )
      const lockerPid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid
      late = join(t, server.url, collabDocumentName(workspaceId, secret.id), cookieOf(member))
      await waitFor('권한 검사를 지나 불러오기에서 기다린다', async () => {
        const rows = await query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks w
             JOIN pg_locks h ON h.locktype = 'transactionid' AND h.transactionid = w.transactionid AND h.granted AND h.pid = $1
            WHERE w.locktype = 'transactionid' AND NOT w.granted`,
          [lockerPid],
        )
        return rows[0].n > 0
      })
      assert.equal(late.provider.isAuthenticated, true, '전제: 연결을 받았다')

      await restrict(owner, pageId, []) // 비밀 페이지는 상속으로 함께 잃는다
      await waitFor('이미 붙은 연결이 닫힌다 — 권한 신호를 받아 다시 판정했다', () => canary.closed.length > 0)
    } finally {
      await locker.query('ROLLBACK')
      locker.release()
    }

    const lateOne = late as Participant | null
    assert.ok(lateOne !== null)
    await waitUntil(() => lateOne.closed.length > 0 || lateOne.provider.isSynced)
    assert.deepEqual([canary.closed, lateOne.closed], [['not_found'], ['not_found']])
    assert.deepEqual(bodyOf(lateOne.doc, secret.id).blocks, [], '회수된 연결이 본문을 받았다')
  })
})

// ── ⑫ 신호를 듣는 연결이 끊겨도 ──────────────────────────────────────

describe('⑫ 신호를 듣는 연결이 끊겨도', () => {
  test('★ 다시 붙으면 끊긴 사이 명령이 쓴 것을 가져오고, 끊긴 사이 회수된 연결은 그것을 받기 전에 닫는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, pageId, name } = await pageFixture(['원문'])
    const opened: ChangeFeed[] = []
    const server = await startServer(t, {
      openFeed: async (handlers) => {
        const feed = await openChangeFeed(handlers, { retryDelayMs: 1500 })
        opened.push(feed)
        return feed
      },
    })
    const [a, b] = [join(t, server.url, name, cookieOf(owner)), join(t, server.url, name, cookieOf(member))]
    await ready(a, b)
    const [feed] = opened

    const pid = feed.backendPid()
    assert.ok(pid !== null)
    await query(`SELECT pg_terminate_backend($1)`, [pid])
    await waitFor('듣는 연결이 끊긴 것을 안다', () => feed.backendPid() === null)

    const child = await createPage(owner.ctx, { parentPageId: pageId as never, title: titleFromPlainText('끊긴 사이') })
    await restrict(owner, pageId, [])
    assert.equal(feed.backendPid(), null, '전제: 끊긴 사이에 커밋했다')

    await waitUntil(() => hasBlock(a.doc, pageId, child.id) && b.closed.length > 0)
    assert.ok(hasBlock(a.doc, pageId, child.id), '끊긴 사이 명령이 쓴 것을 가져오지 않았다')
    assert.deepEqual(b.closed, ['not_found'])
    assert.ok(!hasBlock(b.doc, pageId, child.id), '끊긴 사이 회수된 연결이 그 뒤의 것을 받았다')
  })
})
