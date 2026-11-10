/**
 * 제안 메타 표의 투영 · 원문 행 · 목록 (SG-2 · F-05-12 · 판결 U-2 · 불변식 S8 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 본문 투영이 같은 트랜잭션에서 sid 마다 `open` 행을 세운다 — 종류 · 사람 · 앞 80자. 행 · 검색 색인은 수락 전 원문이다(서식 제안은
 *      제안 전 서식 — SG-5a)
 *   ② 문서에서 sid 마크가 사라지면 `stale`(S8) — 밀린 투영(5d)도 같다 · 다시 나타나면 `open`
 *   ③ `accepted` · `rejected` 는 건드리지 않는다 — 마크가 사라져도 · 남아 있어도
 *   ④ 모양이 틀린 sid · 사람 · 멤버가 아닌 사람 · 다른 페이지의 sid 는 표에 넣지 않는다 — 투영은 던지지 않는다
 *   ⑤ 목록은 볼 수 있는 사람에게 open 만 · 볼 수 없으면 없는 페이지와 같은 답 · 게스트에게 이름은 "멤버"
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type * as Y from 'yjs'
import type { Transaction } from '@tiptap/pm/state'
import type { Mark, Node as PmNode } from '@tiptap/pm/model'

import { appendDocUpdate, projectPendingBody } from '../block/body-write.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { loadDocState } from '../collab/doc-store.ts'
import type { EditorChange } from '../collab/body-edit.ts'
import { readBodyPm } from '../collab/ydoc.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query, queryOne } from '../db/pool.ts'
import { blockSchema, SUGGESTION_DELETE_MARK, SUGGESTION_FORMAT_MARK, SUGGESTION_INSERT_MARK } from '../editor/schema.ts'
import { grantAccess } from '../permissions/acl.ts'
import { assertBodyMatchesYDoc } from '../testing/body-invariant.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { listOpenSuggestions } from './list.ts'

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
  const workspaceId = await createBareWorkspace('제안 메타')
  const owner = await joinAs(workspaceId, await createUser('제안하는 사람'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  const blockId = randomUUID()
  const pageId = (await createPage(owner.ctx, { title: titleFromPlainText('제안 페이지'), privateTop: options.privateTop })).id
  const saved = await savePageBody(owner.ctx, pageId as never, { blocks: [{ id: blockId, type: 'paragraph', title: [textRun(ORIGINAL)] }] })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return { owner, member, workspaceId, pageId, blockId }
}

async function ydocOf(actor: Actor, pageId: string): Promise<Y.Doc> {
  const state = await loadDocState(actor.ctx, pageId)
  if (!state.ok) throw new Error(`본문을 읽지 못했다: ${pageId}`)
  return state.value.ydoc
}

let nextClient = 7100

/** 참여자 편집을 보낸다 — 곧바로 투영하거나(`now`) 쌓기만 하고 밀린 투영을 돌린다(`deferred` · 협업 서버의 창). */
async function send(actor: Actor, pageId: string, change: EditorChange, projection: 'now' | 'deferred' = 'now'): Promise<void> {
  const base = await ydocOf(actor, pageId)
  const client = peer(base, (nextClient += 1))
  edit(client, change)
  const result = await appendDocUpdate(actor.ctx, pageId, changesSince(client, base), { origin: 'editor', projection })
  assert.ok(result.ok && result.appended, JSON.stringify(result))
  if (projection === 'deferred') assert.equal(await projectPendingBody(actor.ctx, pageId), 'projected')
}

/** 블록 글의 시작 위치. */
const textStart = (doc: PmNode, blockId: string): number => findBlock(doc, blockId).pos + 2

/** 끝에 넣자는 글 · "래글" 에 긋자는 줄 — 편집기가 Y.Doc 에 쓰는 모양(SG-1). */
const suggestBoth = (blockId: string, insSid: string, delSid: string, author: string, inserted = '새 글') =>
  (tr: Transaction, doc: PmNode): void => {
    const at = textStart(doc, blockId)
    tr.addMark(at + 1, at + 3, del(delSid, author))
    tr.insert(at + ORIGINAL.length, blockSchema.text(inserted, [ins(insSid, author)]))
  }

type MetaRow = { readonly id: string; readonly page_id: string; readonly kind: string; readonly author_id: string; readonly preview: string | null; readonly state: string }

const metasOf = async (pageId: string): Promise<Map<string, MetaRow>> =>
  new Map(
    (await query<MetaRow>(`SELECT id, page_id, kind, author_id, preview, state FROM suggestion WHERE page_id = $1`, [pageId])).map((r) => [r.id, r]),
  )

const rowTexts = async (actor: Actor, pageId: string): Promise<string[] | null> => {
  const body = await loadPageBody(actor.ctx, pageId as never)
  return body === null ? null : body.doc.blocks.map((b) => b.title.map((r) => r.plain_text).join(''))
}

// ── ① 세운다 · 원문 ───────────────────────────────────────────────────

describe('① 투영이 open 행을 세우고 행은 원문이다', () => {
  test('★ sid 마다 open — 종류 · 사람 · 그 글 · 행과 검색 색인은 수락 전 원문(insert 빼고 delete 둔다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, pageId, blockId } = await setup()
    const [insSid, delSid] = [randomUUID(), randomUUID()]
    await send(owner, pageId, suggestBoth(blockId, insSid, delSid, owner.userId))

    const metas = await metasOf(pageId)
    assert.deepEqual(
      [...metas.values()].map((m) => [m.id, m.kind, m.author_id, m.preview, m.state]).sort(),
      [[insSid, 'insert', owner.userId, '새 글', 'open'], [delSid, 'delete', owner.userId, '래글', 'open']].sort(),
    )
    assert.deepEqual(await rowTexts(owner, pageId), [ORIGINAL])
    await assertBodyMatchesYDoc(owner.ctx, pageId)
    const indexed = await queryOne<{ body_text: string | null }>(`SELECT body_text FROM search_document WHERE doc_id = $1`, [pageId])
    assert.ok(indexed.body_text?.includes(ORIGINAL) && !indexed.body_text.includes('새 글'), JSON.stringify(indexed))
  })

  test('★ 서식 제안도 open — 종류 format · 미리보기는 그 글 · 행은 제안 전 서식이다(굵게를 더한 글이 행에서는 굵지 않다 · SG-5a)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, pageId, blockId } = await setup()
    const sid = randomUUID()
    const bold = blockSchema.marks.bold!.create()
    await send(owner, pageId, (tr, doc) => {
      const at = textStart(doc, blockId)
      tr.addMark(at, at + 2, bold)
      tr.addMark(at, at + 2, blockSchema.marks[SUGGESTION_FORMAT_MARK]!.create({ sid, author_id: owner.userId, added: [{ type: 'bold', attrs: {} }] }))
    })

    const metas = await metasOf(pageId)
    assert.deepEqual([...metas.values()].map((m) => [m.id, m.kind, m.author_id, m.preview, m.state]), [[sid, 'format', owner.userId, '원래', 'open']])
    const body = await loadPageBody(owner.ctx, pageId as never)
    assert.deepEqual(body?.doc.blocks[0]?.title.map((r) => [r.plain_text, r.annotations.bold]), [[ORIGINAL, false]])
    // 편집기 쪽 Y.Doc 에는 서식 제안이 그대로 있다 — 굵게와 added
    const marked: string[] = []
    readBodyPm(await ydocOf(owner, pageId)).descendants((node) => {
      const format = node.marks.find((m) => m.type.name === SUGGESTION_FORMAT_MARK)
      if (format !== undefined) marked.push(`${node.text}:${node.marks.some((m) => m.eq(bold))}:${JSON.stringify(format.attrs.added)}`)
      return true
    })
    assert.deepEqual(marked, ['원래:true:[{"type":"bold","attrs":{}}]'])
    await assertBodyMatchesYDoc(owner.ctx, pageId)
  })

  test('미리보기는 앞 80자다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, pageId, blockId } = await setup()
    const sid = randomUUID()
    const long = '가나다라마바사아자차'.repeat(10)
    await send(owner, pageId, (tr, doc) => {
      tr.insert(textStart(doc, blockId), blockSchema.text(long, [ins(sid, owner.userId)]))
    })
    assert.equal((await metasOf(pageId)).get(sid)?.preview, long.slice(0, 80))
  })
})

// ── ② stale ──────────────────────────────────────────────────────────

describe('② 마크가 사라지면 stale (S8)', () => {
  test('★ 넣자는 글을 지우면 그 sid 는 stale — 밀린 투영도 같다 · 다른 제안은 open 그대로 · 같은 sid 가 다시 서면 open', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, pageId, blockId } = await setup()
    const [insSid, delSid] = [randomUUID(), randomUUID()]
    await send(owner, pageId, suggestBoth(blockId, insSid, delSid, owner.userId), 'deferred')
    assert.deepEqual([...(await metasOf(pageId)).values()].map((m) => m.state), ['open', 'open'])

    // 자기 제안 고치기 — 넣은 글을 진짜 지운다(SG-1 모드가 하는 것과 같은 결과)
    await send(owner, pageId, (tr, doc) => {
      const at = textStart(doc, blockId) + ORIGINAL.length
      tr.delete(at, at + '새 글'.length)
    }, 'deferred')
    let metas = await metasOf(pageId)
    assert.equal(metas.get(insSid)?.state, 'stale')
    assert.equal(metas.get(delSid)?.state, 'open')
    assert.deepEqual(await rowTexts(owner, pageId), [ORIGINAL])

    // 되돌리기 — 같은 sid 의 마크가 다시 선다
    await send(owner, pageId, (tr, doc) => {
      tr.insert(textStart(doc, blockId) + ORIGINAL.length, blockSchema.text('새', [ins(insSid, owner.userId)]))
    })
    metas = await metasOf(pageId)
    assert.equal(metas.get(insSid)?.state, 'open')
    assert.equal(metas.get(insSid)?.preview, '새 글', '처음 본 미리보기가 그대로다')
  })
})

// ── ③ 정한 것은 건드리지 않는다 ──────────────────────────────────────

describe('③ 수락 · 거절은 건드리지 않는다', () => {
  test('★ accepted 는 마크가 사라져도 accepted · rejected 는 마크가 남아 있어도 rejected', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, pageId, blockId } = await setup()
    const [insSid, delSid] = [randomUUID(), randomUUID()]
    await send(owner, pageId, suggestBoth(blockId, insSid, delSid, owner.userId))
    await query(`UPDATE suggestion SET state = 'accepted', resolved_by = $2, resolved_at = now() WHERE id = $1`, [delSid, owner.userId])
    await query(`UPDATE suggestion SET state = 'rejected', resolved_by = $2, resolved_at = now() WHERE id = $1`, [insSid, owner.userId])

    // delete 마크를 뗀다 — 그 sid 가 문서에서 사라진다 · insert 마크는 남는다
    await send(owner, pageId, (tr, doc) => {
      const at = textStart(doc, blockId)
      tr.removeMark(at, at + ORIGINAL.length, blockSchema.marks[SUGGESTION_DELETE_MARK]!)
    })
    const metas = await metasOf(pageId)
    assert.equal(metas.get(delSid)?.state, 'accepted')
    assert.equal(metas.get(insSid)?.state, 'rejected')
  })
})

// ── ④ 받지 않는 마크 ─────────────────────────────────────────────────

describe('④ 모양이 틀리거나 남의 마크는 표에 넣지 않는다', () => {
  test('★ uuid 가 아닌 sid · 사람 · 멤버가 아닌 사람 · 다른 페이지의 sid 는 넣지 않고 투영은 던지지 않는다 · 대소문자만 다른 sid 는 한 줄', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, pageId, blockId } = await setup()
    const other = await setup()
    const foreignSid = randomUUID()
    await send(other.owner, other.pageId, (tr, doc) => {
      tr.insert(textStart(doc, other.blockId), blockSchema.text('남의 제안', [ins(foreignSid, other.owner.userId)]))
    })
    const outsider = await createUser('바깥 사람')
    const valid = randomUUID()

    await send(owner, pageId, (tr, doc) => {
      const at = textStart(doc, blockId)
      tr.insert(at, [
        blockSchema.text('ㄱ', [ins('not-a-uuid', owner.userId)]),
        blockSchema.text('ㄴ', [ins(randomUUID(), 'nobody')]),
        blockSchema.text('ㄷ', [ins(randomUUID(), outsider.userId)]),
        blockSchema.text('ㄹ', [ins(foreignSid, owner.userId)]),
        blockSchema.text('ㅁ', [ins(valid.toUpperCase(), owner.userId)]),
        blockSchema.text('ㅂ', [del(valid, owner.userId)]),
      ])
    })
    const metas = await metasOf(pageId)
    assert.deepEqual([...metas.values()].map((m) => [m.id, m.kind, m.preview, m.state]), [[valid, 'insert', 'ㅁ', 'open']])
    const foreign = await queryOne<{ page_id: string; state: string }>(`SELECT page_id, state FROM suggestion WHERE id = $1`, [foreignSid])
    assert.deepEqual(foreign, { page_id: other.pageId, state: 'open' }, '다른 페이지의 행을 건드렸다')
    // 표에 넣지 않은 마크여도 넣자는 글은 원문에 없다 — 원문은 마크로 정한다
    assert.deepEqual(await rowTexts(owner, pageId), [`ㅂ${ORIGINAL}`])
  })
})

// ── ⑤ 목록 ───────────────────────────────────────────────────────────

describe('⑤ 걸린 제안 목록', () => {
  test('★ 볼 수 있는 사람에게 open 만 — 이름 · 미리보기 · 볼 수 없으면 not_found · 게스트에게 이름은 "멤버"', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, workspaceId, pageId, blockId } = await setup()
    const [insSid, delSid] = [randomUUID(), randomUUID()]
    await send(owner, pageId, suggestBoth(blockId, insSid, delSid, owner.userId))
    await send(owner, pageId, (tr, doc) => {
      const at = textStart(doc, blockId) + ORIGINAL.length
      tr.delete(at, at + '새 글'.length)
    })

    const mine = await listOpenSuggestions(owner.ctx, pageId)
    assert.ok(mine.ok, JSON.stringify(mine))
    assert.deepEqual(mine.suggestions.map((s) => [s.id, s.kind, s.authorId, s.authorName, s.preview]), [[delSid, 'delete', owner.userId, '제안하는 사람', '래글']])
    const theirs = await listOpenSuggestions(member.ctx, pageId)
    assert.ok(theirs.ok && theirs.suggestions.length === 1, JSON.stringify(theirs))

    const guest = await joinAs(workspaceId as never, await createUser('손님'), 'guest')
    assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: guest.userId }, 'view')).ok, true)
    const asGuest = await listOpenSuggestions(guest.ctx, pageId)
    assert.ok(asGuest.ok && asGuest.suggestions[0]?.authorName === '멤버', JSON.stringify(asGuest))

    const hidden = await setup({ privateTop: true })
    await send(hidden.owner, hidden.pageId, suggestBoth(hidden.blockId, randomUUID(), randomUUID(), hidden.owner.userId))
    assert.equal((await listOpenSuggestions(hidden.owner.ctx, hidden.pageId)).ok, true)
    assert.deepEqual(await listOpenSuggestions(hidden.member.ctx, hidden.pageId), { ok: false, reason: 'not_found' })
    assert.deepEqual(await listOpenSuggestions(owner.ctx, 'x'), { ok: false, reason: 'not_found' })
  })
})
