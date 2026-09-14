/**
 * 본문 편집 로그 저장소 — CRDT 2조각 (DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **Phase 0 페이지는 처음 읽을 때 한 번만 옮긴다** — 행의 본문 그대로 · seq 1(import · actor 없음) ·
 *      여럿이 동시에 처음 읽어도 이력은 하나
 *   ② **append 는 적용해 보고 쌓는다** — 바뀐 것만 · 지우기만 하는 update 도 · 깨진 것과 앞선 조각이 없는
 *      것은 거부
 *   ③ **seq 는 빈틈 없이 1씩** — 동시에 들어온 append 여러 개도
 *   ④ **압축은 스냅샷만 새로 쓴다** — 로그를 처음부터 적용한 결과와 같고, 로그는 지우지 않는다(S1)
 *   ⑤ **권한** — 읽기는 view, 쓰기는 edit_content, 볼 수 없으면 없는 것과 같다
 *
 * 참여자의 편집은 `testing/collab-peers.ts` 로 흉내 낸다 — 에디터가 Y.Doc 에 쓰는 것과 같은 함수다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { trashPage } from '../block/trash.ts'
import { textRun } from '../contracts/rich-text.ts'
import { getPool, query } from '../db/pool.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { docToPm, pmToDoc } from '../editor/pm-adapter.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import { appendDocUpdate, loadDocState, MAX_DOC_UPDATE_BYTES, type DocState } from './doc-store.ts'
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

async function freshWorkspace(): Promise<{ owner: Actor; member: Actor }> {
  const workspaceId = await createBareWorkspace('편집 로그')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  return { owner, member }
}

const mkPage = async (actor: Actor, title: string, parentPageId: string | null = null) =>
  createPage(actor.ctx, { parentPageId: parentPageId as never, title: titleFromPlainText(title) })

const para = (text: string, id: string = randomUUID()): EditorBlock => ({
  id,
  type: 'paragraph',
  title: text === '' ? [] : [textRun(text)],
})

async function saveBody(actor: Actor, pageId: string, edit: (doc: EditorDoc) => EditorDoc): Promise<void> {
  const body = await loadPageBody(actor.ctx, pageId as never)
  assert.ok(body !== null)
  const saved = await savePageBody(actor.ctx, pageId as never, edit(body.doc), { expectedVersion: body.version })
  assert.equal(saved.ok, true, JSON.stringify(saved))
}

async function load(actor: Actor, pageId: string): Promise<DocState> {
  const result = await loadDocState(actor.ctx, pageId)
  assert.equal(result.ok, true, result.ok ? '' : result.reason)
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

const bodyOf = (state: DocState | Y.Doc, pageId: string): EditorDoc =>
  readBodyYDoc(state instanceof Y.Doc ? state : state.ydoc, pageId).doc

const textsOf = (doc: EditorDoc): string[] => doc.blocks.map((b) => b.title.map((r) => r.plain_text).join(''))

const logOf = (pageId: string) =>
  query<{ seq: string; origin: string; actor_id: string | null }>(
    `SELECT seq, origin, actor_id FROM doc_update WHERE page_id = $1 ORDER BY seq`,
    [pageId],
  )

/** 문단 하나짜리 페이지를 만들어 옮긴다. */
async function pageWithParagraph(owner: Actor, text = '원문'): Promise<{ pageId: string; blockId: string; state: DocState }> {
  const page = await mkPage(owner, '페이지')
  const blockId = randomUUID()
  await saveBody(owner, page.id, () => ({ blocks: [para(text, blockId)] }))
  return { pageId: page.id, blockId, state: await load(owner, page.id) }
}

const insertAtStart = (blockId: string, text: string) => (tr: Transaction, doc: PmNode) => {
  tr.insertText(text, findBlock(doc, blockId).pos + 2)
}

/** `doc_snapshot` 표의 잠금을 기다리는(아직 받지 못한) 요청 수. */
async function waitingOnSnapshotTable(): Promise<number> {
  const [row] = await query<{ n: string }>(
    `SELECT count(*) AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
      WHERE c.relname = 'doc_snapshot' AND NOT l.granted`,
  )
  return Number(row.n)
}

async function waitUntil(check: () => Promise<boolean>, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return false
}

// ── ① 옮기기 ──────────────────────────────────────────────────────────

describe('① Phase 0 페이지 옮기기', () => {
  test('★ 처음 읽으면 행의 본문이 그대로 Y.Doc 이 되고 seq 1(import · actor 없음)로 남는다 — 다시 읽어도 한 번뿐이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const page = await mkPage(owner, '회의록')
    await mkPage(owner, '하위', page.id)
    await saveBody(owner, page.id, (doc) => ({
      blocks: [para('첫 줄'), { ...para('토글'), type: 'toggle', children: [para('안')] }, ...doc.blocks],
    }))

    const rows = await loadPageBody(owner.ctx, page.id as never)
    assert.ok(rows !== null)
    const first = await load(owner, page.id)
    // 비교 기준은 ProseMirror 왕복의 정규형 — 옮기기가 더하는 차이만 본다(1조각의 왕복 검사와 같다).
    assert.deepEqual(bodyOf(first, page.id), pmToDoc(docToPm(rows.doc)))
    assert.equal(first.seq, '1')
    assert.deepEqual(await logOf(page.id), [{ seq: '1', origin: 'import', actor_id: null }])

    const again = await load(owner, page.id)
    assert.equal((await logOf(page.id)).length, 1)
    assert.ok(Buffer.from(Y.encodeStateAsUpdate(again.ydoc)).equals(Buffer.from(Y.encodeStateAsUpdate(first.ydoc))))
  })

  test('★ 여럿이 동시에 처음 읽어도 이력은 하나이고, 진 쪽도 오류 없이 이긴 쪽의 것을 읽는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await freshWorkspace()
    const page = await mkPage(owner, '동시에 처음')
    await saveBody(owner, page.id, () => ({ blocks: [para('하나'), para('둘')] }))

    // 경쟁을 **실제로** 만든다. 그냥 동시에 부르면 먼저 커밋한 쪽의 스냅샷을 나머지가 읽어 경쟁이 일어나지
    // 않는다 — 처음 쓴 이 검사는 `ON CONFLICT` 를 빼도 통과했다(반사실). 스냅샷 표에 쓰기를 막는 잠금을
    // 걸어 두면 모두가 "없다"를 읽고 INSERT 앞에서 기다리다가, 잠금을 풀면 한꺼번에 들어간다.
    const holder = await getPool().connect()
    await holder.query('BEGIN')
    await holder.query('LOCK TABLE doc_snapshot IN SHARE ROW EXCLUSIVE MODE')
    const loads = [owner, member, owner, member, owner].map((actor) => load(actor, page.id))
    let raced = false
    try {
      raced = await waitUntil(async () => (await waitingOnSnapshotTable()) >= loads.length)
    } finally {
      // 기다리는 동안 무엇이 실패해도 잠금은 푼다 — 남으면 다음 검사가 멈춘다.
      await holder.query('COMMIT')
      holder.release()
    }
    const states = await Promise.all(loads)
    assert.ok(raced, '읽기들이 INSERT 앞에서 한꺼번에 기다리지 않았다 — 경쟁이 일어나지 않은 검사다')

    assert.equal((await logOf(page.id)).length, 1)
    const bytes = states.map((s) => Buffer.from(Y.encodeStateAsUpdate(s.ydoc)))
    for (const b of bytes) assert.ok(b.equals(bytes[0]), '읽은 사람마다 다른 이력을 받았다')
    assert.deepEqual(textsOf(bodyOf(states[0], page.id)), ['하나', '둘'])
  })
})

// ── ② append ──────────────────────────────────────────────────────────

describe('② append — 적용해 보고 쌓는다', () => {
  test('★ 편집이 seq 2 로 쌓이고 다시 읽으면 보인다 · 같은 update 를 또 보내면 쌓지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const { pageId, blockId, state } = await pageWithParagraph(owner)
    const client = peer(state.ydoc, 11)
    edit(client, insertAtStart(blockId, '앞 '))
    const update = changesSince(client, state.ydoc)

    assert.deepEqual(await appendDocUpdate(owner.ctx, pageId, update, { origin: 'editor' }), { ok: true, seq: '2', appended: true })
    assert.deepEqual(textsOf(bodyOf(await load(owner, pageId), pageId)), ['앞 원문'])
    assert.deepEqual(
      (await logOf(pageId)).map((r) => [r.seq, r.origin, r.actor_id]),
      [['1', 'import', null], ['2', 'editor', owner.userId]],
    )

    assert.deepEqual(await appendDocUpdate(owner.ctx, pageId, update, { origin: 'editor' }), { ok: true, seq: '2', appended: false })
    assert.equal((await logOf(pageId)).length, 2)
  })

  test('★ 쌓는 것은 받은 바이트가 아니라 실제로 바뀐 부분이다 — 전체 상태를 보내도 새 편집만 쌓인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const { pageId, blockId, state } = await pageWithParagraph(owner)
    const client = peer(state.ydoc, 31)
    edit(client, insertAtStart(blockId, '새 '))
    const whole = Y.encodeStateAsUpdate(client) // 서버가 이미 가진 구조까지 전부 담았다

    assert.deepEqual(await appendDocUpdate(owner.ctx, pageId, whole, { origin: 'editor' }), { ok: true, seq: '2', appended: true })
    const [stored] = await query<{ payload: Buffer }>(`SELECT payload FROM doc_update WHERE page_id = $1 AND seq = 2`, [pageId])
    assert.deepEqual(
      [...new Set(Y.decodeUpdate(stored.payload).structs.map((s) => s.id.client))],
      [31],
      '이미 가진 구조까지 로그에 쌓았다',
    )
    assert.deepEqual(textsOf(bodyOf(await load(owner, pageId), pageId)), ['새 원문'])
  })

  test('★ 지우기만 하는 update 도 쌓인다 — state vector 는 그대로다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const { pageId, blockId, state } = await pageWithParagraph(owner, '지울 글자')
    const client = peer(state.ydoc, 12)
    edit(client, (tr, doc) => {
      const at = findBlock(doc, blockId).pos + 2
      tr.delete(at, at + 3) // '지울 '
    })
    assert.ok(
      Buffer.from(Y.encodeStateVector(client)).equals(Buffer.from(Y.encodeStateVector(state.ydoc))),
      '전제: 이 편집은 지우기만 해서 state vector 가 그대로다',
    )

    const result = await appendDocUpdate(owner.ctx, pageId, changesSince(client, state.ydoc), { origin: 'editor' })
    assert.deepEqual(result, { ok: true, seq: '2', appended: true })
    assert.deepEqual(textsOf(bodyOf(await load(owner, pageId), pageId)), ['글자'])
  })

  test('★ 앞선 update 가 없는 update 는 거부한다 — 앞선 것이 오면 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const { pageId, blockId, state } = await pageWithParagraph(owner)
    const client = peer(state.ydoc, 13)
    edit(client, insertAtStart(blockId, '가'))
    const first = changesSince(client, state.ydoc)
    const afterFirst = Y.encodeStateVector(client)
    edit(client, (tr, doc) => tr.insertText('나', findBlock(doc, blockId).pos + 3)) // '가' 바로 뒤
    const second = Y.encodeStateAsUpdate(client, afterFirst)

    assert.deepEqual(await appendDocUpdate(owner.ctx, pageId, second, { origin: 'editor' }), { ok: false, reason: 'missing_dependencies' })
    assert.equal((await logOf(pageId)).length, 1)

    assert.equal((await appendDocUpdate(owner.ctx, pageId, first, { origin: 'editor' })).ok, true)
    assert.deepEqual(await appendDocUpdate(owner.ctx, pageId, second, { origin: 'editor' }), { ok: true, seq: '3', appended: true })
    assert.deepEqual(textsOf(bodyOf(await load(owner, pageId), pageId)), ['가나원문'])
  })

  test('깨진 바이트 · 너무 큰 update 는 거부하고 쌓지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const { pageId } = await pageWithParagraph(owner)
    const garbage = Uint8Array.from([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1])
    assert.deepEqual(await appendDocUpdate(owner.ctx, pageId, garbage, { origin: 'editor' }), { ok: false, reason: 'invalid_update' })
    assert.deepEqual(
      await appendDocUpdate(owner.ctx, pageId, new Uint8Array(MAX_DOC_UPDATE_BYTES + 1), { origin: 'editor' }),
      { ok: false, reason: 'too_large' },
    )
    assert.equal((await logOf(pageId)).length, 1)
  })
})

// ── ③ seq ─────────────────────────────────────────────────────────────

describe('③ seq', () => {
  test('★ 동시에 들어온 append 여러 개도 seq 가 빈틈 없이 1씩이고 편집이 전부 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const page = await mkPage(owner, '동시 편집')
    const ids = Array.from({ length: 8 }, () => randomUUID())
    await saveBody(owner, page.id, () => ({ blocks: ids.map((id, i) => para(`줄${i}`, id)) }))
    const state = await load(owner, page.id)

    const updates = ids.map((id, i) => {
      const client = peer(state.ydoc, 100 + i)
      edit(client, insertAtStart(id, '★'))
      return changesSince(client, state.ydoc)
    })
    const results = await Promise.all(updates.map((u) => appendDocUpdate(owner.ctx, page.id, u, { origin: 'editor' })))
    assert.ok(results.every((r) => r.ok && r.appended), JSON.stringify(results))

    assert.deepEqual((await logOf(page.id)).map((r) => r.seq), ['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    assert.deepEqual(textsOf(bodyOf(await load(owner, page.id), page.id)), ids.map((_, i) => `★줄${i}`))
  })
})

// ── ④ 압축 ────────────────────────────────────────────────────────────

describe('④ 압축', () => {
  test('★ 스냅샷을 새로 써도 로그를 처음부터 적용한 결과와 같고, 로그는 지우지 않는다(S1)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const { pageId, blockId } = await pageWithParagraph(owner, 'x')

    for (let i = 0; i < 5; i += 1) {
      const base = await load(owner, pageId)
      const client = peer(base.ydoc, 200 + i)
      edit(client, insertAtStart(blockId, String(i)))
      const result = await appendDocUpdate(owner.ctx, pageId, changesSince(client, base.ydoc), { origin: 'editor', compactEvery: 2 })
      assert.ok(result.ok && result.appended, JSON.stringify(result))
    }

    const [snapshot] = await query<{ merged_seq: string }>(`SELECT merged_seq FROM doc_snapshot WHERE page_id = $1`, [pageId])
    assert.equal(snapshot.merged_seq, '5', '압축이 따라오지 않았다')

    const log = await query<{ payload: Buffer }>(`SELECT payload FROM doc_update WHERE page_id = $1 ORDER BY seq`, [pageId])
    assert.equal(log.length, 6, '압축이 로그를 지웠다')
    const replay = new Y.Doc()
    for (const row of log) Y.applyUpdate(replay, row.payload)

    assert.deepEqual(bodyOf(await load(owner, pageId), pageId), bodyOf(replay, pageId))
    assert.deepEqual(textsOf(bodyOf(replay, pageId)), ['43210x'])
  })
})

// ── ⑤ 권한 ────────────────────────────────────────────────────────────

describe('⑤ 권한', () => {
  test('★ 볼 수만 있는 사람은 읽지만 쌓지 못한다 · 볼 수 없거나 없는 페이지는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await freshWorkspace()
    const elsewhere = await freshWorkspace()
    const { pageId, blockId, state } = await pageWithParagraph(owner)
    assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
    assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: member.userId }, 'view')).ok, true)

    const client = peer(state.ydoc, 21)
    edit(client, insertAtStart(blockId, '몰래 '))
    const update = changesSince(client, state.ydoc)

    assert.equal((await loadDocState(member.ctx, pageId)).ok, true)
    assert.deepEqual(await appendDocUpdate(member.ctx, pageId, update, { origin: 'editor' }), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await loadDocState(elsewhere.owner.ctx, pageId), { ok: false, reason: 'not_found' })
    assert.deepEqual(await appendDocUpdate(elsewhere.owner.ctx, pageId, update, { origin: 'editor' }), { ok: false, reason: 'not_found' })
    assert.deepEqual(await loadDocState(owner.ctx, 'not-a-uuid'), { ok: false, reason: 'not_found' })
    assert.equal((await logOf(pageId)).length, 1)
  })

  test('휴지통의 페이지는 없는 것과 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const page = await mkPage(owner, '지울 페이지')
    await trashPage(owner.ctx, page.id as never)
    assert.deepEqual(await loadDocState(owner.ctx, page.id), { ok: false, reason: 'not_found' })
  })
})
