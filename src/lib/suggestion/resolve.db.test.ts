/**
 * 제안 수락 · 거절의 기록 (SG-3 · F-05-12 · 판결 U-2 · 불변식 S9 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 문은 본문을 고칠 수 있는 사람이다 — 보기 · 코멘트만이면 forbidden · 잠긴 페이지도 forbidden · 볼 수 없으면 not_found · 모양이 틀리면 invalid
 *   ② 아직 정하지 않은 행(`open` · `stale`)만 적는다 — state · resolved_by(누른 사람) · resolved_at. 이미 정한 행 · 다른 페이지의 행 · 없는 sid 는 그대로.
 *      목록의 이름표는 정한 행의 사람도 준다
 *   ③ 차례 — 본문이 먼저(투영이 stale 로 둔 뒤)여도 · 기록이 먼저(그 뒤 마크가 사라져도)여도 끝은 accepted · rejected 다. 투영은 정한 행을 건드리지 않는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type * as Y from 'yjs'
import type { Mark, Node as PmNode } from '@tiptap/pm/model'

import { appendDocUpdate } from '../block/body-write.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { loadDocState } from '../collab/doc-store.ts'
import type { EditorChange } from '../collab/body-edit.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import { blockSchema, SUGGESTION_DELETE_MARK, SUGGESTION_INSERT_MARK } from '../editor/schema.ts'
import { resolveSuggestionsIn } from '../editor/suggestion-resolve.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { listOpenSuggestions } from './list.ts'
import { resolveSuggestions } from './resolve.ts'

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

const ORIGINAL = '원래글'
const ins = (sid: string, author: string): Mark => blockSchema.marks[SUGGESTION_INSERT_MARK]!.create({ sid, author_id: author })
const del = (sid: string, author: string): Mark => blockSchema.marks[SUGGESTION_DELETE_MARK]!.create({ sid, author_id: author })

type Setup = { readonly owner: Actor; readonly member: Actor; readonly workspaceId: string; readonly pageId: string; readonly blockId: string }

async function setup(options: { privateTop?: boolean } = {}): Promise<Setup> {
  const workspaceId = await createBareWorkspace('제안 수락')
  const owner = await joinAs(workspaceId, await createUser('제안하는 사람'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  const blockId = randomUUID()
  const pageId = (await createPage(owner.ctx, { title: titleFromPlainText('수락 페이지'), privateTop: options.privateTop })).id
  const saved = await savePageBody(owner.ctx, pageId as never, { blocks: [{ id: blockId, type: 'paragraph', title: [textRun(ORIGINAL)] }] })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return { owner, member, workspaceId, pageId, blockId }
}

async function ydocOf(actor: Actor, pageId: string): Promise<Y.Doc> {
  const state = await loadDocState(actor.ctx, pageId)
  if (!state.ok) throw new Error(`본문을 읽지 못했다: ${pageId}`)
  return state.value.ydoc
}

let nextClient = 7300

/** 참여자 편집을 보내고 곧바로 투영한다(협업 서버의 창이 닫힌 뒤와 같다). */
async function send(actor: Actor, pageId: string, change: EditorChange): Promise<void> {
  const base = await ydocOf(actor, pageId)
  const client = peer(base, (nextClient += 1))
  edit(client, change)
  const result = await appendDocUpdate(actor.ctx, pageId, changesSince(client, base), { origin: 'editor', projection: 'now' })
  assert.ok(result.ok && result.appended, JSON.stringify(result))
}

const textStart = (doc: PmNode, blockId: string): number => findBlock(doc, blockId).pos + 2

/** 끝에 넣자는 "새 글" · "래글" 에 긋자는 줄. */
const suggestBoth = (blockId: string, insSid: string, delSid: string, author: string) =>
  (tr: Parameters<EditorChange>[0], doc: PmNode): void => {
    const at = textStart(doc, blockId)
    tr.addMark(at + 1, at + 3, del(delSid, author))
    tr.insert(at + ORIGINAL.length, blockSchema.text('새 글', [ins(insSid, author)]))
  }

/** 편집기가 보내는 수락 · 거절과 같은 단계. */
const resolveInDoc = (sids: readonly string[], action: 'accept' | 'reject'): EditorChange =>
  (tr, doc) => void resolveSuggestionsIn(tr, doc, new Set(sids), action)

type Row = { readonly state: string; readonly resolved_by: string | null; readonly resolved: boolean }

const rowOf = async (sid: string): Promise<Row | undefined> =>
  (await query<Row>(`SELECT state, resolved_by, resolved_at IS NOT NULL AS resolved FROM suggestion WHERE id = $1`, [sid]))[0]

const rowTexts = async (actor: Actor, pageId: string): Promise<string[] | null> => {
  const body = await loadPageBody(actor.ctx, pageId as never)
  return body === null ? null : body.doc.blocks.map((b) => b.title.map((r) => r.plain_text).join(''))
}

// ── ① 문 ─────────────────────────────────────────────────────────────

describe('① 본문을 고칠 수 있는 사람만', () => {
  test('★ 보기 · 코멘트만이면 forbidden · 잠긴 페이지도 forbidden · 볼 수 없으면 not_found · 틀린 모양은 invalid', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, workspaceId, pageId, blockId } = await setup()
    const [insSid, delSid] = [randomUUID(), randomUUID()]
    await send(owner, pageId, suggestBoth(blockId, insSid, delSid, owner.userId))

    for (const level of ['view', 'comment'] as const) {
      const guest = await joinAs(workspaceId as never, await createUser(`손님 ${level}`), 'guest')
      assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: guest.userId }, level)).ok, true)
      assert.deepEqual(await resolveSuggestions(guest.ctx, pageId, [insSid], 'accept'), { ok: false, reason: 'forbidden' }, level)
    }
    assert.equal((await rowOf(insSid))?.state, 'open', '거부된 기록이 행을 바꿨다')

    const hidden = await setup({ privateTop: true })
    assert.deepEqual(await resolveSuggestions(hidden.member.ctx, hidden.pageId, [insSid], 'accept'), { ok: false, reason: 'not_found' })
    assert.deepEqual(await resolveSuggestions(owner.ctx, 'x', [insSid], 'accept'), { ok: false, reason: 'not_found' })
    for (const [ids, action] of [[[insSid], 'merge'], [[], 'accept'], [insSid, 'accept'], [[1], 'reject']] as const) {
      assert.deepEqual(await resolveSuggestions(owner.ctx, pageId, ids, action), { ok: false, reason: 'invalid' }, JSON.stringify([ids, action]))
    }

    assert.equal((await setPageLock(owner.ctx, pageId, true)).ok, true)
    assert.deepEqual(await resolveSuggestions(owner.ctx, pageId, [insSid], 'accept'), { ok: false, reason: 'forbidden' })
    assert.equal((await setPageLock(owner.ctx, pageId, false)).ok, true)
    assert.deepEqual(await resolveSuggestions(owner.ctx, pageId, [insSid], 'accept'), { ok: true, resolved: [insSid] })
  })
})

// ── ② 정하지 않은 행만 ───────────────────────────────────────────────

describe('② open · stale 만 적는다', () => {
  test('★ state · 누른 사람 · 시각 — 이미 정한 행 · 다른 페이지의 행 · 없는 sid · 모양이 틀린 sid 는 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, pageId, blockId } = await setup()
    const other = await setup()
    const [insSid, delSid, foreignSid] = [randomUUID(), randomUUID(), randomUUID()]
    await send(owner, pageId, suggestBoth(blockId, insSid, delSid, owner.userId))
    await send(other.owner, other.pageId, (tr, doc) => {
      tr.insert(textStart(doc, other.blockId), blockSchema.text('남의 제안', [ins(foreignSid, other.owner.userId)]))
    })

    // 멤버(본문을 고칠 수 있다)가 insert 를 수락 — 누른 사람이 resolved_by(제안한 사람이 아니다)
    const accepted = await resolveSuggestions(member.ctx, pageId, [insSid, foreignSid, randomUUID(), 'not-a-uuid'], 'accept')
    assert.deepEqual(accepted, { ok: true, resolved: [insSid] })
    assert.deepEqual(await rowOf(insSid), { state: 'accepted', resolved_by: member.userId, resolved: true })
    assert.equal((await rowOf(foreignSid))?.state, 'open', '다른 페이지의 행을 건드렸다')

    // 이미 정한 행은 다시 쓰지 않는다 — 다른 사람이 거절해도 · 같은 사람이 다시 수락해도
    assert.deepEqual(await resolveSuggestions(owner.ctx, pageId, [insSid], 'reject'), { ok: true, resolved: [] })
    assert.deepEqual(await rowOf(insSid), { state: 'accepted', resolved_by: member.userId, resolved: true })

    // 대문자로 와도 같은 sid · stale 도 정한다(본문이 먼저 닿아 투영이 stale 로 둔 행)
    await query(`UPDATE suggestion SET state = 'stale' WHERE id = $1`, [delSid])
    assert.deepEqual(await resolveSuggestions(owner.ctx, pageId, [delSid.toUpperCase()], 'reject'), { ok: true, resolved: [delSid] })
    assert.deepEqual(await rowOf(delSid), { state: 'rejected', resolved_by: owner.userId, resolved: true })

    // 목록 — 걸린 것은 없지만 이름표는 정한 행의 사람도 준다(되돌린 수락의 카드가 이름을 그린다)
    const listed = await listOpenSuggestions(member.ctx, pageId)
    assert.ok(listed.ok, JSON.stringify(listed))
    assert.deepEqual(listed.suggestions, [])
    assert.deepEqual([...listed.authors], [[owner.userId, '제안하는 사람']])
  })
})

// ── ③ 차례 ───────────────────────────────────────────────────────────

describe('③ 본문과 기록의 차례', () => {
  test('★ 본문이 먼저 — 투영이 stale 로 둔 뒤 기록이 accepted · rejected 로 · 행 · 원문은 수락한 결과', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, pageId, blockId } = await setup()
    const [insSid, delSid] = [randomUUID(), randomUUID()]
    await send(owner, pageId, suggestBoth(blockId, insSid, delSid, owner.userId))

    await send(owner, pageId, resolveInDoc([insSid, delSid], 'accept'))
    assert.equal((await rowOf(insSid))?.state, 'stale')
    assert.deepEqual(await rowTexts(owner, pageId), ['원새 글'], '수락한 글이 원문에 들어가고 지우자는 글은 빠진다')

    const resolved = await resolveSuggestions(owner.ctx, pageId, [insSid, delSid], 'accept')
    assert.ok(resolved.ok && resolved.resolved.length === 2, JSON.stringify(resolved))
    assert.equal((await rowOf(insSid))?.state, 'accepted')
    assert.equal((await rowOf(delSid))?.state, 'accepted')
  })

  test('★ 기록이 먼저 — 그 뒤 마크가 사라지는 투영도 · 남아 있는 투영도 정한 행을 그대로 둔다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, pageId, blockId } = await setup()
    const [insSid, delSid] = [randomUUID(), randomUUID()]
    await send(owner, pageId, suggestBoth(blockId, insSid, delSid, owner.userId))

    const rejected = await resolveSuggestions(owner.ctx, pageId, [insSid, delSid], 'reject')
    assert.ok(rejected.ok, JSON.stringify(rejected))
    assert.deepEqual([...rejected.resolved].sort(), [insSid, delSid].sort())
    // 마크가 아직 남은 채 다른 편집이 투영된다(본문이 아직 닿지 않았다)
    await send(owner, pageId, (tr, doc) => {
      tr.insert(textStart(doc, blockId), blockSchema.text('앞'))
    })
    assert.equal((await rowOf(insSid))?.state, 'rejected')
    // 이제 본문이 닿는다 — 마크가 사라진다
    await send(owner, pageId, resolveInDoc([insSid, delSid], 'reject'))
    assert.deepEqual(await rowOf(insSid), { state: 'rejected', resolved_by: owner.userId, resolved: true })
    assert.deepEqual(await rowOf(delSid), { state: 'rejected', resolved_by: owner.userId, resolved: true })
    assert.deepEqual(await rowTexts(owner, pageId), [`앞${ORIGINAL}`], '거절한 결과 — 넣자는 글은 없고 지우자는 글은 남는다')
  })
})
