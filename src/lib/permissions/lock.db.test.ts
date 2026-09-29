/**
 * 페이지 잠금 — Teamspace · 게스트 · 그룹 7f-1조각 (F-06-16 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 잠그면 본문 · 제목이 막힌다 — 협업 접속은 읽기 전용 · 참여자 update 는 `locked` · 제목은 `locked` · 잠근 사람에게도 ·
 *      잠금은 capability 가 아니다(편집자는 여전히 `edit_content`) · 풀면 다시 고친다
 *   ② 누가 잠그고 푸나 — 고칠 수 있는 사람만(볼 수만 · 댓글까지는 forbidden · 못 보면 not_found) · 화면 상태
 *   ③ ★ 막지 않는 것 — 코멘트 · 하위 페이지 만들기 · 공유 · 복제(사본은 잠기지 않는다) · 휴지통(돌아와도 잠겨 있다) · 상속 안 됨
 *   ④ 잠금의 전이는 협업 신호다(0034) — 같은 상태로 다시 쓰면 신호가 없다
 *   ⑤ ★ 제목은 고칠 수 있는 사람만 — 7f-1 전에는 권한을 묻지 않았다(읽기만 받은 사람 · 볼 수 없는 사람도 바꿨다)
 */

import { test, describe, before, after, type TestContext } from 'node:test'
import assert from 'node:assert/strict'

import * as Y from 'yjs'
import type { Transaction } from '@tiptap/pm/state'

import type { SessionContext } from '../auth/session-context.ts'
import { appendDocUpdate } from '../block/body-write.ts'
import { duplicatePage } from '../block/duplicate.ts'
import { createPage, PageError, renamePage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { restorePage, trashPage } from '../block/trash.ts'
import { openChangeFeed, type CollabSignal } from '../collab/change-feed.ts'
import { loadDocState, pageAccess } from '../collab/doc-store.ts'
import { createDiscussion } from '../comment/discussion.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query, queryOne } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import type { EditorBlock } from '../editor/document.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import type { BlockId } from '../ids.ts'
import { changesSince, edit, peer } from '../testing/collab-peers.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { grantAccess } from './acl.ts'
import { effectiveCaps } from './effective.ts'
import { can } from './levels.ts'
import { pageLockState, setPageLock } from './lock.ts'

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

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)}`

async function office() {
  const ws = await createBareWorkspace('잠금')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const person = async (name: string, role: Parameters<typeof joinAs>[2] = 'member') => joinAs(ws, await createUser(name), role)
  return { ws, boss, person }
}

const para = (text: string): EditorBlock => ({ id: crypto.randomUUID(), type: 'paragraph', title: [textRun(text)] })

/** 본문이 있는 개인 최상위 페이지 — 만든 사람만 전체 권한이다. */
async function docOf(by: Actor, text = '본문'): Promise<BlockId> {
  const page = await createPage(by.ctx, { privateTop: true, title: titleFromPlainText(unique('문서')) })
  const saved = await savePageBody(by.ctx, page.id, { blocks: [para(text)] })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return page.id
}

const share = async (boss: Actor, doc: string, who: Actor, level: 'view' | 'comment' | 'edit') =>
  assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: who.userId }, level)).ok)

/** 참여자가 본문을 바꾼 update — 에디터가 하는 쓰기로 만든다. */
async function typing(ctx: SessionContext, pageId: string, text: string): Promise<Uint8Array> {
  const state = await loadDocState(ctx, pageId)
  if (!state.ok) throw new Error(`본문을 읽지 못했다: ${pageId}`)
  const base: Y.Doc = state.value.ydoc
  const client = peer(base, 4242)
  const next = docToPm({ blocks: [para(text)] })
  edit(client, (tr: Transaction) => {
    tr.replaceWith(0, tr.doc.content.size, next.content)
  })
  return changesSince(client, base)
}

const logLength = async (pageId: string) =>
  Number((await queryOne<{ n: string }>(`SELECT count(*) AS n FROM doc_update WHERE page_id = $1`, [pageId])).n)

const titleOf = async (pageId: string) =>
  (await queryOne<{ title: unknown }>(`SELECT properties->'title' AS title FROM block WHERE id = $1`, [pageId])).title

async function renameFails(actor: Actor, pageId: BlockId): Promise<string> {
  try {
    await renamePage(actor.ctx, pageId, titleFromPlainText('바뀐 제목'))
    return 'ok'
  } catch (e) {
    if (e instanceof PageError) return e.code
    throw e
  }
}

async function listenTo(t: TestContext, workspaceId: string): Promise<() => number> {
  const heard: CollabSignal[] = []
  const feed = await openChangeFeed({ onSignal: (s) => void heard.push(s), onResync: () => {} })
  t.after(() => feed.close())
  return () => heard.filter((s) => s.kind === 'access' && s.workspaceId === workspaceId).length
}

async function until(check: () => boolean, label: string, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) assert.fail(`기다리다 끝났다 — ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 잠그면 본문 · 제목이 막힌다', () => {
  test('★ 협업 접속은 읽기 전용 · 참여자 update 는 locked · 제목은 locked · 잠근 사람에게도 · 풀면 다시 고친다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const editor = await person('편집자')
    const doc = await docOf(boss)
    await share(boss, doc, editor, 'edit')
    assert.equal(await pageAccess(editor.ctx, doc), 'edit', '전제 — 잠그기 전에는 고친다')
    const update = await typing(boss.ctx, doc, '잠긴 뒤에 친 글')
    const before = await logLength(doc)
    const title = await titleOf(doc)

    assert.deepEqual(await setPageLock(editor.ctx, doc, true), { ok: true, value: { changed: true } })
    for (const who of [editor, boss]) assert.equal(await pageAccess(who.ctx, doc), 'view', '잠긴 페이지를 고치는 연결을 받는다')
    assert.deepEqual(await appendDocUpdate(boss.ctx, doc, update, { origin: 'editor' }), { ok: false, reason: 'locked' })
    assert.deepEqual(await savePageBody(boss.ctx, doc, { blocks: [para('덮어쓰기')] }), { ok: false, reason: 'locked' })
    assert.equal(await logLength(doc), before, '잠겼는데 본문 로그가 늘었다')
    assert.equal(await renameFails(boss, doc), 'locked')
    assert.deepEqual(await titleOf(doc), title, '잠겼는데 제목이 바뀌었다')

    const caps = await withReadTransaction((tx) => effectiveCaps(tx, editor.ctx, doc))
    assert.ok(can(caps, 'edit_content'), '잠금이 capability 를 바꿨다 — 잠금은 판정이 아니라 게이트다')
    assert.deepEqual(await setPageLock(editor.ctx, doc, true), { ok: true, value: { changed: false } })

    assert.deepEqual(await setPageLock(boss.ctx, doc, false), { ok: true, value: { changed: true } }, '잠근 사람이 아니어도 푼다')
    assert.equal(await pageAccess(editor.ctx, doc), 'edit')
    const after = await appendDocUpdate(boss.ctx, doc, update, { origin: 'editor' })
    assert.equal(after.ok, true, JSON.stringify(after))
    assert.equal(await renameFails(editor, doc), 'ok')
    assert.deepEqual(await setPageLock(boss.ctx, doc, false), { ok: true, value: { changed: false } })
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 누가 잠그고 푸나', () => {
  test('고칠 수 있는 사람만 — 볼 수만 · 댓글까지는 forbidden · 못 보면 not_found · 아무것도 안 쓴다 · 화면 상태', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const viewer = await person('보기만')
    const commenter = await person('댓글까지')
    const stranger = await person('못 보는 사람')
    const doc = await docOf(boss)
    await share(boss, doc, viewer, 'view')
    await share(boss, doc, commenter, 'comment')

    for (const who of [viewer, commenter]) {
      assert.deepEqual(await setPageLock(who.ctx, doc, true), { ok: false, reason: 'forbidden' })
    }
    assert.deepEqual(await setPageLock(stranger.ctx, doc, true), { ok: false, reason: 'not_found' })
    assert.equal((await query(`SELECT 1 FROM node_lock WHERE node_id = $1`, [doc])).length, 0, '거부했는데 잠겼다')

    assert.ok((await setPageLock(boss.ctx, doc, true)).ok)
    assert.deepEqual(await setPageLock(viewer.ctx, doc, false), { ok: false, reason: 'forbidden' })
    const row = await queryOne<{ kind: string; locked_by: string }>(`SELECT kind, locked_by FROM node_lock WHERE node_id = $1`, [doc])
    assert.deepEqual(row, { kind: 'page', locked_by: boss.userId })

    assert.deepEqual(await pageLockState(viewer.ctx, doc), { locked: true, canToggle: false })
    assert.deepEqual(await pageLockState(boss.ctx, doc), { locked: true, canToggle: true })
    assert.equal(await pageLockState(stranger.ctx, doc), null)
  })
})

// ── ③ ─────────────────────────────────────────────────────────────────

describe('③ 막지 않는 것', () => {
  test('★ 코멘트 · 하위 페이지 만들기 · 공유 · 복제(사본은 잠기지 않는다) · 휴지통(돌아와도 잠겨 있다) · 상속 안 됨', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const commenter = await person('댓글까지')
    const reader = await person('나중에 받을 사람')
    const doc = await docOf(boss)
    await share(boss, doc, commenter, 'comment')
    assert.ok((await setPageLock(boss.ctx, doc, true)).ok)

    const discussion = await createDiscussion(commenter.ctx, { pageId: doc, richText: [textRun('잠겨도 코멘트는 단다')] })
    assert.equal(discussion.ok, true, JSON.stringify(discussion))
    const child = await createPage(boss.ctx, { parentPageId: doc, title: titleFromPlainText('잠긴 페이지 아래') })
    assert.equal(await pageAccess(boss.ctx, child.id), 'edit', '잠금이 하위 페이지로 상속됐다')
    const childWrite = await appendDocUpdate(boss.ctx, child.id, await typing(boss.ctx, child.id, '하위는 고친다'), { origin: 'editor' })
    assert.equal(childWrite.ok, true, JSON.stringify(childWrite))
    await share(boss, doc, reader, 'view')

    const copy = await duplicatePage(boss.ctx, doc)
    assert.equal(await pageAccess(boss.ctx, copy.page.id), 'edit', '사본이 잠겼다 — 복제본은 새 노드다')

    await trashPage(boss.ctx, doc)
    await restorePage(boss.ctx, doc)
    assert.deepEqual(await pageLockState(boss.ctx, doc), { locked: true, canToggle: true }, '휴지통에서 돌아오니 잠금이 풀렸다')
  })
})

// ── ④ ─────────────────────────────────────────────────────────────────

describe('④ 협업 신호', () => {
  test('잠그고 풀면 워크스페이스에 신호가 간다 — 같은 상태로 다시 쓰면 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const doc = await docOf(boss)
    const heard = await listenTo(t, ws)

    assert.ok((await setPageLock(boss.ctx, doc, true)).ok)
    await until(() => heard() === 1, '잠금 신호')
    assert.ok((await setPageLock(boss.ctx, doc, true)).ok)
    assert.ok((await setPageLock(boss.ctx, doc, false)).ok)
    await until(() => heard() === 2, '풀기 신호')
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(heard(), 2, '바뀐 것이 없는 쓰기가 신호를 냈다')
  })
})

// ── ⑤ ─────────────────────────────────────────────────────────────────

describe('⑤ 제목은 고칠 수 있는 사람만', () => {
  test('★ 읽기만 받은 사람은 forbidden · 볼 수 없는 사람은 not_found · 제목은 그대로 · 편집자는 바꾼다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const viewer = await person('보기만')
    const stranger = await person('못 보는 사람')
    const editor = await person('편집자')
    const doc = await docOf(boss)
    await share(boss, doc, viewer, 'view')
    await share(boss, doc, editor, 'edit')
    const title = await titleOf(doc)

    assert.equal(await renameFails(viewer, doc), 'forbidden')
    assert.equal(await renameFails(stranger, doc), 'not_found')
    assert.deepEqual(await titleOf(doc), title, '권한 없는 사람이 제목을 바꿨다')
    assert.equal(await renameFails(editor, doc), 'ok')
  })
})
