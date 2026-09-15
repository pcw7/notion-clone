/**
 * 협업 서버 — CRDT 5a조각 (DB · 실제 WebSocket)
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
 *   ⑦ **투영이 받지 않는 update 는 쌓지도 퍼뜨리지도 않는다** — 살아 있는 하위 페이지의 참조를 지운 편집(5b조각이
 *      정본대로 휴지통 전이로 바꾼다)
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
import { hashSessionToken } from '../auth/session-context.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { blockSchema } from '../editor/schema.ts'
import type { Level } from '../permissions/levels.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import { assertBodyMatchesYDoc } from '../testing/body-invariant.ts'
import { edit, findBlock } from '../testing/collab-peers.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { collabDocumentName, createCollabServer } from './collab-server.ts'
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
async function startServer(t: TestContext): Promise<Running> {
  const server = createCollabServer({ port: 0, allowedOrigins: [APP_ORIGIN], quiet: true, stopOnSignals: false })
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

/** 모두에게 열린 페이지를 소유자만의 페이지로 바꾸고, 지정한 사람에게만 레벨을 준다. */
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
  test('★ 연결 뒤에 권한이 보기로 내려간 사람 · 세션이 끊긴 사람의 update 는 쌓이지도 퍼지지도 않고 그 연결이 닫힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { workspaceId, owner, member, pageId, ids, name } = await pageFixture(['원문'])
    const leaver = await joinAs(workspaceId, await createUser('나갈 사람'), 'member')
    const server = await startServer(t)
    const [writer, watcher, demoted, loggedOut] = [
      join(t, server.url, name, cookieOf(owner)),
      join(t, server.url, name, cookieOf(owner)),
      join(t, server.url, name, cookieOf(member)),
      join(t, server.url, name, cookieOf(leaver)),
    ]
    await ready(writer, watcher, demoted, loggedOut)
    assert.equal(demoted.provider.authorizedScope, 'read-write', '전제: 쓰기로 받은 연결이다')

    await restrict(owner, pageId, [[member, 'view'], [leaver, 'edit']])
    await query(`UPDATE user_session SET revoked_at = now() WHERE token_hash = $1`, [hashSessionToken(leaver.token)])
    const before = await logOf(pageId)

    edit(demoted.doc, insertAtStart(ids[0], '내려간 '))
    edit(loggedOut.doc, insertAtStart(ids[0], '끊긴 '))
    await waitFor('두 연결이 닫힌다', () => demoted.closed.length > 0 && loggedOut.closed.length > 0)
    assert.deepEqual([demoted.closed, loggedOut.closed], [['forbidden'], ['unauthenticated']])

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

// ── ⑦ 투영이 받지 않는 update ────────────────────────────────────────

describe('⑦ 투영이 받지 않는 update', () => {
  test('★ 살아 있는 하위 페이지의 참조를 지운 편집은 쌓지도 퍼뜨리지도 않고 그 연결을 닫는다 (5b 가 휴지통 전이로 바꾼다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, pageId, ids, name } = await pageFixture(['원문'])
    const child = await createPage(owner.ctx, { parentPageId: pageId as never, title: titleFromPlainText('하위') })
    const server = await startServer(t)
    const [remover, writer, watcher] = [
      join(t, server.url, name, cookieOf(owner)),
      join(t, server.url, name, cookieOf(member)),
      join(t, server.url, name, cookieOf(owner)),
    ]
    await ready(remover, writer, watcher)
    assert.ok(hasBlock(remover.doc, pageId, child.id), '전제: 참조가 본문에 있다')
    const before = await logOf(pageId)

    edit(remover.doc, removeBlock(child.id))
    await waitFor('지운 쪽 연결이 닫힌다', () => remover.closed.length > 0)
    assert.deepEqual(remover.closed, ['page_ref_missing'])

    edit(writer.doc, insertAtStart(ids[0], '!'))
    await waitFor('뒤에 보낸 편집이 닿는다', () => textsOf(bodyOf(watcher.doc, pageId))[0].startsWith('!'))
    assert.ok(hasBlock(watcher.doc, pageId, child.id), '참조를 지운 편집이 퍼졌다')
    assert.equal((await logOf(pageId)).length, before.length + 1)
    const [row] = await query<{ lifecycle: string }>(`SELECT lifecycle FROM block WHERE id = $1`, [child.id])
    assert.equal(row.lifecycle, 'live')
    await assertBodyMatchesYDoc(owner.ctx, pageId)
  })
})
