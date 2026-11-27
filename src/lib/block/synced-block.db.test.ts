/**
 * 동기화 블록의 원본 — 투영 · 색인 · 공개 API 읽기 (SB-1 · F-01-11 · 정본 §3.4 [보강 SB-0] ④ ⑯ ⑳)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 투영 — 원본은 `block` 의 보통 행(`type='synced_block'` · `properties` 빈 객체 · 글 · 색 없음)이고, 그 자식은 원본을 부모로 하는 같은
 *      페이지의 행이다(`ancestor_path` · `perm_scope_id` 는 그 페이지의 것 — X-1 그대로)
 *   ② 색인 — 원본의 글이 그 페이지의 `search_document` 에 든다(07 *"원본 콘텐츠 기준으로 검색"* · SY9)
 *   ③ 검증 — 동기화 블록 안의 동기화 블록은 저장이 거부한다(SY5)
 *   ④ 공개 API — 원본은 `{type:'synced_block', synced_block:{synced_from:null}, has_children:true}` · 자식은 보통의 블록 · 고치기는 400
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createApiToken } from '../api/api-token.ts'
import { retrieveBlock, retrieveBlockChildren, updateApiBlock } from '../api/blocks.ts'
import { v1Route } from '../api/v1.ts'
import { API_RATE_NAMESPACE, NOTION_VERSION } from '../api/v1-protocol.ts'
import { textRun } from '../contracts/rich-text.ts'
import { withReadTransaction } from '../db/tx.ts'
import type { EditorBlock } from '../editor/document.ts'
import { reset } from '../rate-limit.ts'
import { asBlockId } from '../ids.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import { createBareWorkspace, createUser, joinAs, makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { savePageBody } from './save-page-body.ts'
import { SYNCED_BLOCK_TYPE } from './synced-block.ts'
import { listSyncedPlaces, requestSyncedOriginalAccess, resolveSyncedBlock } from './synced-block-resolve.ts'
import { restorePage, trashPage } from './trash.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''
let fx: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
    const { closeValkey } = await import('../valkey.ts')
    await closeValkey()
  }
})

const blk = (id: string, type: EditorBlock['type'], text: string, children: EditorBlock[] = []): EditorBlock => ({
  id, type, title: text === '' ? [] : [textRun(text)], properties: {}, format: {}, children,
})

type Row = { id: string; type: string; parent_id: string; ancestor_path: string[]; perm_scope_id: string; properties: Record<string, unknown>; format: Record<string, unknown> }

/** 원본이 든 페이지 하나 — `앞` · 원본(`원본 글` · 토글(`깊은 글`)). */
async function pageWithOriginal(): Promise<{ page: string; synced: string; inner: string; toggle: string; deep: string }> {
  const page = (await createPage(fx.owner.ctx, { title: titleFromPlainText(`동기화 원본 ${randomUUID().slice(0, 8)}`) })).id
  const [before, synced, inner, toggle, deep] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  const saved = await savePageBody(fx.owner.ctx, page, {
    blocks: [
      blk(before, 'paragraph', '앞'),
      blk(synced, SYNCED_BLOCK_TYPE, '', [blk(inner, 'paragraph', '원본 글 동기화내용'), blk(toggle, 'toggle', '토글', [blk(deep, 'paragraph', '깊은 글')])]),
    ],
  })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return { page, synced, inner, toggle, deep }
}

describe('동기화 블록의 원본 (SB-1)', () => {
  test('★ ① 투영 — 원본은 보통 행(속성 빈 객체) · 자식은 원본을 부모로 하는 같은 페이지의 행', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { page, synced, inner, toggle, deep } = await pageWithOriginal()
    const rows = await withReadTransaction((tx) =>
      tx.query<Row>(`SELECT id, type, parent_id, ancestor_path, perm_scope_id, properties, format FROM block WHERE id = ANY($1::uuid[])`, [[synced, inner, toggle, deep]]),
    )
    const byId = new Map(rows.map((r) => [r.id, r]))
    const head = byId.get(synced)
    assert.ok(head)
    assert.equal(head.type, SYNCED_BLOCK_TYPE)
    assert.equal(head.parent_id, page)
    assert.deepEqual(head.properties, {}, '원본은 synced_from 이 없다 — 속성이 빈 객체')
    assert.deepEqual(head.format, {})
    assert.equal(byId.get(inner)?.parent_id, synced)
    assert.equal(byId.get(deep)?.parent_id, toggle)
    assert.ok(byId.get(deep)!.ancestor_path.includes(page) && byId.get(deep)!.ancestor_path.includes(synced), '경로가 원본을 지난다')
    assert.equal(byId.get(deep)?.perm_scope_id, head.perm_scope_id, '권한 범위는 그 페이지의 것이다')
  })

  test('★ ② 색인 — 원본의 글이 그 페이지의 색인에 든다(어느 깊이든)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { page } = await pageWithOriginal()
    const row = await withReadTransaction((tx) => tx.queryMaybe<{ body_text: string | null }>(`SELECT body_text FROM search_document WHERE doc_id = $1`, [page]))
    assert.ok(row?.body_text?.includes('원본 글 동기화내용'), row?.body_text ?? '색인 행 없음')
    assert.ok(row?.body_text?.includes('깊은 글'))
  })

  test('★ ③ 검증 — 동기화 블록 안의 동기화 블록은 저장이 거부한다(SY5)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = (await createPage(fx.owner.ctx, { title: titleFromPlainText('중첩 거부') })).id
    const saved = await savePageBody(fx.owner.ctx, page, {
      blocks: [blk(randomUUID(), SYNCED_BLOCK_TYPE, '', [blk(randomUUID(), SYNCED_BLOCK_TYPE, '', [blk(randomUUID(), 'paragraph', '안')])])],
    })
    assert.equal(saved.ok, false)
    assert.ok(!saved.ok && saved.reason === 'invalid_document')
  })

  test('★ ④ 공개 API — 원본은 synced_from: null · has_children · 자식은 보통의 블록 · 고치기는 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { synced, inner, toggle } = await pageWithOriginal()
    const made = await createApiToken(fx.owner.ctx, { name: 'SB-1 시험' })
    assert.ok(made.ok)
    const call = async (handler: Parameters<typeof v1Route>[0], method: string, path: string, body?: unknown) => {
      await reset(API_RATE_NAMESPACE, made.value.summary.id)
      const headers: Record<string, string> = { authorization: `Bearer ${made.value.token}`, 'notion-version': NOTION_VERSION }
      if (body !== undefined) headers['content-type'] = 'application/json'
      const res = await v1Route(handler)(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), {
        params: Promise.resolve({ block_id: synced }),
      })
      return { status: res.status, body: (await res.json()) as Record<string, unknown> }
    }
    const got = await call(retrieveBlock, 'GET', `/v1/blocks/${synced}`)
    assert.equal(got.status, 200)
    assert.equal(got.body.type, 'synced_block')
    assert.deepEqual(got.body.synced_block, { synced_from: null })
    assert.equal(got.body.has_children, true)
    const kids = await call(retrieveBlockChildren, 'GET', `/v1/blocks/${synced}/children`)
    assert.equal(kids.status, 200)
    assert.deepEqual((kids.body.results as { id: string; type: string }[]).map((r) => [r.id, r.type]), [[inner, 'paragraph'], [toggle, 'toggle']])
    const patched = await call(updateApiBlock, 'PATCH', `/v1/blocks/${synced}`, { synced_block: {} })
    assert.equal(patched.status, 400, JSON.stringify(patched.body))
  })
})

/** 사본 하나가 든 페이지 — 원본 X 를 가리킨다. */
async function pageWithCopy(original: string): Promise<{ page: string; copy: string }> {
  const page = (await createPage(fx.owner.ctx, { title: titleFromPlainText(`동기화 사본 ${randomUUID().slice(0, 8)}`) })).id
  const copy = randomUUID()
  const saved = await savePageBody(fx.owner.ctx, page, {
    blocks: [{ id: copy, type: SYNCED_BLOCK_TYPE, title: [], properties: { synced_from: original }, format: {}, children: [] }],
  })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return { page, copy }
}

describe('동기화 블록이 보이는 곳 — "다른 N개 페이지에서 편집 중" (SB-3 · ㉑)', () => {
  test('★ 원본 · 사본의 페이지 중 살아 있고 볼 수 있는 것만 — 원본 먼저 · 페이지마다 한 줄 · 휴지통 · 볼 수 없는 페이지는 수에도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { page: a, synced } = await pageWithOriginal()
    const { page: b, copy: copyB } = await pageWithCopy(synced)
    // 한 페이지에 사본 둘 — 한 줄(첫 블록)
    const c = (await createPage(fx.owner.ctx, { title: titleFromPlainText('사본 둘') })).id
    const [c1, c2] = [randomUUID(), randomUUID()]
    const copyOf = (id: string): EditorBlock => ({ id, type: SYNCED_BLOCK_TYPE, title: [], properties: { synced_from: synced }, format: {}, children: [] })
    assert.equal((await savePageBody(fx.owner.ctx, c, { blocks: [copyOf(c1), blk(randomUUID(), 'paragraph', '사이'), copyOf(c2)] })).ok, true)
    const { page: trashed } = await pageWithCopy(synced)
    await trashPage(fx.owner.ctx, asBlockId(trashed))

    const owner = await listSyncedPlaces(fx.owner.ctx, synced)
    assert.deepEqual(owner[0], { pageId: a, title: owner[0]?.title, blockId: synced, original: true }, '원본 먼저')
    assert.deepEqual(
      owner.slice(1).map((p) => [p.pageId, p.blockId, p.original]).sort(),
      [[b, copyB, false], [c, [c1, c2].sort()[0], false]].sort(),
      '사본의 페이지마다 한 줄 · 휴지통의 페이지는 없다',
    )
    assert.deepEqual(await listSyncedPlaces(fx.owner.ctx, synced.toUpperCase()), owner, '대문자로 와도 같다')

    // 손님 — 볼 수 있게 받은 페이지만(수에도 들지 않는다)
    const guest = await joinAs(fx.workspaceId, await createUser('곳을 보는 손님'), 'guest')
    assert.deepEqual(await listSyncedPlaces(guest.ctx, synced), [], '볼 수 있는 곳이 없다')
    assert.ok((await grantAccess(fx.owner.ctx, b, { type: 'user', id: guest.userId }, 'view')).ok)
    assert.deepEqual((await listSyncedPlaces(guest.ctx, synced)).map((p) => [p.pageId, p.original]), [[b, false]], '원본 페이지를 볼 수 없으면 원본은 없다')
    assert.ok((await grantAccess(fx.owner.ctx, a, { type: 'user', id: guest.userId }, 'view')).ok)
    assert.deepEqual((await listSyncedPlaces(guest.ctx, synced)).map((p) => [p.pageId, p.original]), [[a, true], [b, false]])

    // 다른 워크스페이스 · uuid 아님 · 사본의 id(원본이 아니다 — 가리키는 사본도 없다)
    const stranger = await joinAs(await createBareWorkspace('다른 곳'), { userId: fx.owner.userId })
    assert.deepEqual(await listSyncedPlaces(stranger.ctx, synced), [])
    assert.deepEqual(await listSyncedPlaces(fx.owner.ctx, 'nope'), [])
    assert.deepEqual(await listSyncedPlaces(fx.owner.ctx, copyB), [])
  })
})

describe('동기화 블록 사본의 해석 (SB-2 · ⑨)', () => {
  test('★ 권한 — 볼 수 있으면 ok(pageId) · 게스트는 부여 전 no_access(id 없음) · 부여하면 ok · 회수하면 다시 no_access', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { page, synced } = await pageWithOriginal()
    assert.deepEqual(await resolveSyncedBlock(fx.owner.ctx, synced), { state: 'ok', pageId: page })
    // 대문자로 와도 같은 원본이다
    assert.deepEqual(await resolveSyncedBlock(fx.owner.ctx, synced.toUpperCase()), { state: 'ok', pageId: page })

    const guest = await joinAs(fx.workspaceId, await createUser('사본을 보는 손님'), 'guest')
    const denied = await resolveSyncedBlock(guest.ctx, synced)
    assert.deepEqual(denied, { state: 'no_access' })
    assert.ok(!JSON.stringify(denied).includes(page), '원본 페이지의 id 를 싣지 않는다')

    assert.ok((await grantAccess(fx.owner.ctx, page, { type: 'user', id: guest.userId }, 'view')).ok)
    assert.deepEqual(await resolveSyncedBlock(guest.ctx, synced), { state: 'ok', pageId: page }, '능력 비트만 본다 — 게스트도 같다')
    assert.ok((await revokeAccess(fx.owner.ctx, page, { type: 'user', id: guest.userId })).ok)
    assert.deepEqual(await resolveSyncedBlock(guest.ctx, synced), { state: 'no_access' })
  })

  test('★ 휴지통 — 볼 수 있으면 trashed · 볼 수 없으면 휴지통이어도 no_access · 되살리면 ok', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { page, synced } = await pageWithOriginal()
    const guest = await joinAs(fx.workspaceId, await createUser('휴지통을 모르는 손님'), 'guest')
    await trashPage(fx.owner.ctx, asBlockId(page))
    assert.deepEqual(await resolveSyncedBlock(fx.owner.ctx, synced), { state: 'trashed' })
    assert.deepEqual(await resolveSyncedBlock(guest.ctx, synced), { state: 'no_access' }, '볼 수 없으면 휴지통인지도 모른다')
    await restorePage(fx.owner.ctx, asBlockId(page))
    assert.deepEqual(await resolveSyncedBlock(fx.owner.ctx, synced), { state: 'ok', pageId: page })
  })

  test('★ 없음 — 모르는 id · 사본 · uuid 아님 · 원본을 지운 뒤 · 다른 워크스페이스(SY6)는 missing', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { page, synced } = await pageWithOriginal()
    const { copy } = await pageWithCopy(synced)
    assert.deepEqual(await resolveSyncedBlock(fx.owner.ctx, randomUUID()), { state: 'missing' })
    assert.deepEqual(await resolveSyncedBlock(fx.owner.ctx, copy), { state: 'missing' }, '사본은 원본이 아니다')
    assert.deepEqual(await resolveSyncedBlock(fx.owner.ctx, 'nope'), { state: 'missing' })

    const elsewhere = await createBareWorkspace('다른 워크스페이스')
    const stranger = await joinAs(elsewhere, { userId: fx.owner.userId })
    assert.deepEqual(await resolveSyncedBlock(stranger.ctx, synced), { state: 'missing' }, '다른 워크스페이스의 원본은 없는 것이다')

    const saved = await savePageBody(fx.owner.ctx, page, { blocks: [blk(randomUUID(), 'paragraph', '원본을 지웠다')] })
    assert.equal(saved.ok, true)
    assert.deepEqual(await resolveSyncedBlock(fx.owner.ctx, synced), { state: 'missing' })
  })

  test('★ 접근 요청 — X 로 보내면 원본 페이지에 열린다 · 답에 페이지가 없다 · 볼 수 있으면 has_access · 없는 원본은 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { page, synced } = await pageWithOriginal()
    const guest = await joinAs(fx.workspaceId, await createUser('요청하는 손님'), 'guest')
    const sent = await requestSyncedOriginalAccess(guest.ctx, synced)
    assert.ok(sent.ok && sent.value.sent, JSON.stringify(sent))
    const opened = await withReadTransaction((tx) =>
      tx.query<{ node_id: string; kind: string }>(`SELECT node_id, kind FROM access_request WHERE requester_id = $1`, [guest.userId]),
    )
    assert.deepEqual(opened, [{ node_id: page, kind: 'page_access' }], '요청은 원본 페이지의 것이다')
    const again = await requestSyncedOriginalAccess(guest.ctx, synced)
    assert.ok(again.ok && !again.value.sent, '이미 열린 요청')
    assert.deepEqual(await requestSyncedOriginalAccess(fx.owner.ctx, synced), { ok: false, reason: 'has_access' })
    assert.deepEqual(await requestSyncedOriginalAccess(guest.ctx, randomUUID()), { ok: false, reason: 'not_found' })
  })

  test('★ 공개 API — 사본은 synced_from.block_id · has_children false · 자식은 빈 목록', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { synced } = await pageWithOriginal()
    const { copy } = await pageWithCopy(synced)
    const made = await createApiToken(fx.owner.ctx, { name: 'SB-2 시험' })
    assert.ok(made.ok)
    const call = async (handler: Parameters<typeof v1Route>[0], path: string) => {
      await reset(API_RATE_NAMESPACE, made.value.summary.id)
      const headers = { authorization: `Bearer ${made.value.token}`, 'notion-version': NOTION_VERSION }
      const res = await v1Route(handler)(new Request(`http://localhost${path}`, { headers }), { params: Promise.resolve({ block_id: copy }) })
      return { status: res.status, body: (await res.json()) as Record<string, unknown> }
    }
    const got = await call(retrieveBlock, `/v1/blocks/${copy}`)
    assert.equal(got.status, 200, JSON.stringify(got.body))
    assert.deepEqual(got.body.synced_block, { synced_from: { type: 'block_id', block_id: synced } })
    assert.equal(got.body.has_children, false)
    const kids = await call(retrieveBlockChildren, `/v1/blocks/${copy}/children`)
    assert.equal(kids.status, 200)
    assert.deepEqual(kids.body.results, [])
  })
})
