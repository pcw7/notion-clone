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
import { makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { savePageBody } from './save-page-body.ts'
import { SYNCED_BLOCK_TYPE } from './synced-block.ts'

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
