/**
 * 공개 API — 페이지 옮기기 · SDK 의 받지 않는 주소 · 이모지 · 템플릿 목록 (API-10 · F-09-01 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑭ ① ② · [보강] 잠금이 막는 것 ③
 *
 * 라우트 파일은 `v1Route(handler)` 한 줄이라 같은 것을 여기서 만들어 `Request` 로 부른다(`pages.db.test.ts` 와 같다). 실제 서버 · SDK · 사이드바는
 * e2e '공개 API — 페이지 옮기기 (API-10 · F-09-01)' 가 본다.
 *
 *   ① ★ 페이지 밑으로 — 응답은 옮긴 뒤의 페이지 객체 · 블록의 부모 · 출처 api · `page.moved` 웹훅 줄(새 부모)
 *   ② ★ 거부 — 자기 · 자손 400 · 휴지통의 페이지 · 부모 400 · 볼 수만 있는 페이지 · 부모 403 · 안 보이면 404 · 뿌리가 바뀌는데 전체 권한 없음 403 ·
 *     행 · 데이터 소스 · 데이터베이스 · 워크스페이스 부모 400 · 잠긴 페이지는 옮긴다(트리 연산) · 같은 부모는 그대로
 *   ③ ★ SDK 에 있지만 받지 않는 주소는 400 validation_error(까닭) · 없는 주소는 그대로 invalid_request_url · 라우트 파일의 받지 않는 메서드도
 *   ④ ★ 이모지 목록(이름 순 · name · 서명 주소 · 쪽) · 템플릿 목록(is_default · name · 쪽 · 데이터베이스 id 는 404 에 바른 주소)
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage } from '../block/page.ts'
import { trashPage } from '../block/trash.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from '../database/database.ts'
import { createRow } from '../database/row.ts'
import { createTemplate } from '../database/template.ts'
import { query, queryOne } from '../db/pool.ts'
import { createCustomEmoji } from '../emoji/custom-emoji.ts'
import { uploadFile } from '../file/file.ts'
import { setFileStorage, type FileStorage } from '../file/storage.ts'
import { asBlockId } from '../ids.ts'
import type { OutboundResult } from '../net/outbound.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { reset } from '../rate-limit.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createApiToken } from './api-token.ts'
import { listApiCustomEmojis } from './custom-emojis.ts'
import { moveApiPage } from './page-move.ts'
import { listApiTemplates } from './templates.ts'
import { v1InvalidUrl, v1Route } from './v1.ts'
import { API_RATE_NAMESPACE, NOTION_VERSION } from './v1-protocol.ts'
import { createApiWebhook, verifyApiWebhook, type ApiWebhookSender } from './webhooks.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

function memoryStorage(): FileStorage {
  const store = new Map<string, Uint8Array>()
  return {
    kind: 'memory',
    async put(key, bytes) {
      store.set(key, bytes)
    },
    async read(key) {
      return store.get(key) ?? null
    },
    async remove(key) {
      store.delete(key)
    },
  }
}

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  setFileStorage(memoryStorage())
})

after(async () => {
  setFileStorage(null)
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
    const { closeValkey } = await import('../valkey.ts')
    await closeValkey()
  }
})

// ── 부르기 ────────────────────────────────────────────────────────────

type Caller = Actor & { readonly api: string; readonly apiId: string }

async function withToken(actor: Actor): Promise<Caller> {
  const made = await createApiToken(actor.ctx, { name: 'API-10 시험' })
  if (!made.ok) throw new Error(made.reason)
  return { ...actor, api: made.value.token, apiId: made.value.summary.id }
}

const ROUTES = {
  move: v1Route(moveApiPage),
  invalid: v1Route(v1InvalidUrl),
  emojis: v1Route(listApiCustomEmojis),
  templates: v1Route(listApiTemplates),
}

type Reply = { readonly status: number; readonly body: Record<string, unknown> }

async function call(who: Caller, route: keyof typeof ROUTES, method: string, path: string, params: Record<string, string>, body?: unknown): Promise<Reply> {
  await reset(API_RATE_NAMESPACE, who.apiId)
  const headers: Record<string, string> = { authorization: `Bearer ${who.api}`, 'notion-version': NOTION_VERSION }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await ROUTES[route](
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve(params) },
  )
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const move = (who: Caller, pageId: string, parent: unknown) =>
  call(who, 'move', 'POST', `/v1/pages/${pageId}/move`, { page_id: pageId }, { parent })
const under = (pageId: string) => ({ type: 'page_id', page_id: pageId })

function assertError(r: Reply, status: number, code: string, message?: RegExp) {
  assert.equal(r.status, status, JSON.stringify(r.body))
  assert.equal(r.body.object, 'error')
  assert.equal(r.body.code, code)
  if (message) assert.match(String(r.body.message), message)
}

const parentOf = async (id: string) => (await queryOne<{ parent_id: string }>(`SELECT parent_id FROM block WHERE id = $1`, [id])).parent_id

// ── 준비 ──────────────────────────────────────────────────────────────

async function team(name: string) {
  const ws = await createBareWorkspace(name)
  const boss = await withToken(await joinAs(ws, await createUser(`${name} 소유자`), 'owner'))
  const mate = await withToken(await joinAs(ws, await createUser(`${name} 멤버`), 'member'))
  return { ws, boss, mate }
}

const page = async (who: Actor, title: string, parentPageId?: string) =>
  (await createPage(who.ctx, parentPageId === undefined ? { title: [textRun(title)], privateTop: true } : { title: [textRun(title)], parentPageId: asBlockId(parentPageId) })).id

const must = <T>(r: { ok: boolean; value?: T; reason?: string }, what: string): T => {
  if (!r.ok) throw new Error(`${what} 준비 실패: ${r.reason}`)
  return r.value as T
}

/** 받는 쪽 흉내 — 확인 토큰만 받아 둔다. */
function receiver(): { send: ApiWebhookSender; got: string[] } {
  const got: string[] = []
  return { got, send: async (_url, json): Promise<OutboundResult> => (got.push(json), { ok: true, status: 200 }) }
}

// ── ① 옮기기 ──────────────────────────────────────────────────────────

describe('① 페이지 밑으로 옮긴다', () => {
  test('★ 응답은 옮긴 뒤의 페이지 객체 · 블록의 부모 · 같은 부모는 그대로 · page.moved 웹훅 줄은 새 부모를 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('API-10 옮기기')
    // 구독 — page.moved 만(확인까지)
    const r = receiver()
    const hook = must(await createApiWebhook(mate.ctx, mate.apiId, { url: 'https://hooks.example.com/api10', eventTypes: ['page.moved'] }, { send: r.send }), '구독')
    const secret = (JSON.parse(r.got[0]!) as { verification_token: string }).verification_token
    must(await verifyApiWebhook(mate.ctx, mate.apiId, hook.id, secret), '확인')

    const a = await page(mate, '가')
    const b = await page(mate, '나')
    const moved = await move(mate, b, under(a))
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.equal(moved.body.object, 'page')
    assert.equal(moved.body.id, b)
    assert.deepEqual(moved.body.parent, { type: 'page_id', page_id: a })
    assert.equal(await parentOf(b), a)
    // 부모 본문의 참조는 서버 명령의 본문 세션이 쓴다 — 출처 api
    const origin = await queryOne<{ origin: string }>(`SELECT origin::text AS origin FROM doc_update WHERE page_id = $1 ORDER BY seq DESC LIMIT 1`, [a])
    assert.equal(origin.origin, 'api')

    const events = await query<{ type: string; entity_id: string; data: { parent?: { id: string; type: string } } }>(
      `SELECT type, entity_id, data FROM api_webhook_event WHERE subscription_id = $1 ORDER BY seq`,
      [hook.id],
    )
    assert.deepEqual(events.map((e) => [e.type, e.entity_id]), [['page.moved', b]])
    assert.deepEqual(events[0]!.data.parent, { id: a, type: 'page' })

    // 같은 부모 — 아무것도 바꾸지 않는다(웹훅도 없다)
    const again = await move(mate, b, { page_id: a })
    assert.equal(again.status, 200)
    assert.equal((await query(`SELECT 1 FROM api_webhook_event WHERE subscription_id = $1`, [hook.id])).length, 1)
  })

  test('★ 잠긴 페이지도 옮긴다 — 잠금은 내용만 막는다([보강] 잠금 ③ · 앱과 같다) · 잠금은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('API-10 잠금')
    const a = await page(mate, '가')
    const b = await page(mate, '나')
    must(await setPageLock(mate.ctx, b, true), '잠금')
    must(await setPageLock(mate.ctx, a, true), '부모 잠금')
    const moved = await move(mate, b, under(a))
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.equal(await parentOf(b), a)
    assert.equal((await query(`SELECT 1 FROM node_lock WHERE node_id = $1`, [b])).length, 1)
  })
})

// ── ② 거부 ────────────────────────────────────────────────────────────

describe('② 거부', () => {
  test('★ 자기 자신 · 자손 밑은 400 · 휴지통의 페이지 · 부모는 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('API-10 순환')
    const a = await page(mate, '가')
    const child = await page(mate, '가의 자식', a)
    const grandchild = await page(mate, '손자', child)
    assertError(await move(mate, a, under(a)), 400, 'validation_error', /itself or one of its descendants/)
    assertError(await move(mate, a, under(grandchild)), 400, 'validation_error', /itself or one of its descendants/)
    assert.equal(await parentOf(grandchild), child)

    const gone = await page(mate, '버린 것')
    await trashPage(mate.ctx, asBlockId(gone))
    assertError(await move(mate, gone, under(a)), 400, 'validation_error', /in trash/)
    assertError(await move(mate, child, under(gone)), 400, 'validation_error', /into a page that is in trash/)
    assert.equal(await parentOf(child), a)
  })

  test('★ 볼 수만 있으면 403 · 안 보이면 404(옮길 페이지 · 새 부모 모두) · 뿌리가 바뀌는데 전체 권한이 없으면 403', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await team('API-10 권한')
    const mine = await page(mate, '내 것')
    const other = await page(mate, '내 다른 것')
    const viewOnly = await page(boss, '보기만')
    must(await grantAccess(boss.ctx, viewOnly, { type: 'user', id: mate.userId }, 'view'), '보기')
    const hidden = await page(boss, '비밀')

    assertError(await move(mate, viewOnly, under(mine)), 403, 'restricted_resource')
    assertError(await move(mate, hidden, under(mine)), 404, 'object_not_found', new RegExp(hidden))
    assertError(await move(mate, other, under(viewOnly)), 403, 'restricted_resource')
    assertError(await move(mate, other, under(hidden)), 404, 'object_not_found', new RegExp(hidden))
    assertError(await move(mate, '00000000-0000-4000-8000-000000000000', under(mine)), 404, 'object_not_found')

    // 소유자의 개인 페이지를 고칠 수만 있는 사람이 내 개인 페이지 밑으로 — 볼 수 있는 사람이 바뀐다(정본 7c-3 · 7c-7)
    const editable = await page(boss, '고칠 수 있는 것')
    must(await grantAccess(boss.ctx, editable, { type: 'user', id: mate.userId }, 'edit'), '고치기')
    assertError(await move(mate, editable, under(mine)), 403, 'restricted_resource', /full access/)
    // 뿌리가 그대로인 이동(소유자의 개인 페이지 → 소유자의 개인 페이지) — 새 부모는 고칠 수 있어도 옮길 페이지를 보기만 하면 403.
    // 위의 "보기만" 은 뿌리가 바뀌어 전체 권한 판정이 먼저 막는다 — 옮길 페이지의 edit_content 만 따로 거는 경우다
    assertError(await move(mate, viewOnly, under(editable)), 403, 'restricted_resource')
    assert.notEqual(await parentOf(viewOnly), editable, '★ 옮겨지지 않았다')
    assert.equal(await parentOf(editable), (await queryOne<{ id: string }>(`SELECT workspace_id AS id FROM block WHERE id = $1`, [editable])).id)
  })

  test('★ 행 · 데이터 소스 · 데이터베이스 · 워크스페이스 부모는 400(앱에 그 명령이 없다) · 모양이 틀린 부모 · 본문은 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('API-10 행')
    const a = await page(mate, '가')
    const b = await page(mate, '나')
    const db = must(await createDatabase(mate.ctx, { name: '표' }), '표')
    const row = must(await createRow(mate.ctx, db.dataSourceId, {}), '행').id

    assertError(await move(mate, row, under(a)), 400, 'validation_error', /database row/)
    assertError(await move(mate, b, { type: 'data_source_id', data_source_id: db.dataSourceId }), 400, 'validation_error', /into a data source/)
    assertError(await move(mate, b, { database_id: db.id }), 400, 'validation_error', /into a data source/)
    assertError(await move(mate, b, { type: 'workspace', workspace: true }), 400, 'validation_error', /top of the workspace/)
    assertError(await move(mate, b, { type: 'block_id', block_id: a }), 400, 'validation_error', /body\.parent\.type/)
    assertError(await move(mate, b, { page_id: 'nope' }), 400, 'validation_error', /body\.parent\.page_id/)
    assertError(await move(mate, b, 'a'), 400, 'validation_error', /body\.parent should be an object/)
    const extra = await call(mate, 'move', 'POST', `/v1/pages/${b}/move`, { page_id: b }, { parent: under(a), after: a })
    assertError(extra, 400, 'validation_error', /body\.after should be not present/)
    assertError(await call(mate, 'move', 'POST', '/v1/pages/x/move', { page_id: 'x' }, { parent: under(a) }), 400, 'validation_error', /path\.page_id/)
    assert.notEqual(await parentOf(b), a)
  })
})

// ── ③ 받지 않는 주소 ──────────────────────────────────────────────────

describe('③ SDK 에 있지만 받지 않는 주소', () => {
  test('★ 400 validation_error 로 SDK 메서드와 까닭 · 없는 주소는 invalid_request_url', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('API-10 받지 않는 주소')
    const gap = async (method: string, path: string) => call(mate, 'invalid', method, path, {}, method === 'GET' || method === 'DELETE' ? undefined : {})
    assertError(await gap('GET', '/v1/pages/0f1e/markdown'), 400, 'validation_error', /^pages\.retrieveMarkdown \(GET \/v1\/pages\/\{page_id\}\/markdown\) is not supported by this server: /)
    assertError(await gap('POST', '/v1/views'), 400, 'validation_error', /^views\.create .*create and edit views in the app/)
    assertError(await gap('POST', '/v1/blocks/meeting_notes'), 400, 'validation_error', /meeting notes/)
    assertError(await gap('GET', '/v1/async_tasks/t1'), 400, 'validation_error', /async tasks/)
    assertError(await gap('POST', '/v1/agents/query'), 400, 'validation_error', /Notion AI agents/)
    assertError(await gap('POST', '/v1/oauth/token'), 400, 'validation_error', /no public integrations/)
    assertError(await gap('GET', '/v1/nothing/here'), 400, 'invalid_request_url')
    assertError(await gap('DELETE', '/v1/pages/x'), 400, 'invalid_request_url')
  })
})

// ── ④ 이모지 · 템플릿 ─────────────────────────────────────────────────

describe('④ 이모지 · 템플릿 목록', () => {
  test('★ 이모지 — 이름 순 · { id, name, url(서명 주소) } · name 은 정확히 같은 이름 · 쪽을 넘긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('API-10 이모지')
    const image = async () => {
      const out = await uploadFile(mate.ctx, { bytes: new Uint8Array(16).fill(137), mime: 'image/png', originalName: 'emoji.png' })
      assert.ok(out.ok, JSON.stringify(out))
      return out.file.id
    }
    for (const name of ['zebra', 'apple', 'mango']) must(await createCustomEmoji(mate.ctx, { name, fileId: await image() }), name)

    const first = await call(mate, 'emojis', 'GET', '/v1/custom_emojis?page_size=2', {})
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.object, 'list')
    assert.equal(first.body.type, 'custom_emoji')
    const results = first.body.results as { id: string; name: string; url: string }[]
    assert.deepEqual(results.map((e) => e.name), ['apple', 'mango'])
    assert.match(results[0]!.url, /^http:\/\/localhost[^/]*\/api\/files\/[0-9a-f-]{36}\?expires=\d+&signature=/)
    assert.equal(first.body.has_more, true)
    const second = await call(mate, 'emojis', 'GET', `/v1/custom_emojis?page_size=2&start_cursor=${first.body.next_cursor}`, {})
    assert.deepEqual((second.body.results as { name: string }[]).map((e) => e.name), ['zebra'])
    assert.equal(second.body.next_cursor, null)

    const named = await call(mate, 'emojis', 'GET', '/v1/custom_emojis?name=%3AMango%3A', {})
    assert.deepEqual((named.body.results as { name: string }[]).map((e) => e.name), ['mango'])
    assert.deepEqual((await call(mate, 'emojis', 'GET', '/v1/custom_emojis?name=nope', {})).body.results, [])
    assertError(await call(mate, 'emojis', 'GET', `/v1/custom_emojis?name=apple&start_cursor=${first.body.next_cursor}`, {}), 400, 'validation_error', /start_cursor/)
  })

  test('★ 템플릿 — 만든 차례 · is_default(그 데이터베이스의 공유 뷰가 기본으로 둔 것) · name(대소문자 무시 부분 일치) · 데이터베이스 id 는 404', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await team('API-10 템플릿')
    const db = must(await createDatabase(mate.ctx, { name: '표' }), '표')
    const daily = must(await createTemplate(mate.ctx, db.dataSourceId, { title: 'Daily 회의' }), '템플릿').id
    const weekly = must(await createTemplate(mate.ctx, db.dataSourceId, { title: '주간 회고' }), '템플릿').id
    await query(`UPDATE view SET default_template_page_id = $1 WHERE data_source_id = $2 AND owner_user_id IS NULL`, [weekly, db.dataSourceId])

    const path = (search = '') => `/v1/data_sources/${db.dataSourceId}/templates${search}`
    const all = await call(mate, 'templates', 'GET', path(), { data_source_id: db.dataSourceId })
    assert.equal(all.status, 200, JSON.stringify(all.body))
    assert.deepEqual(all.body.templates, [
      { id: daily, name: 'Daily 회의', is_default: false },
      { id: weekly, name: '주간 회고', is_default: true },
    ])
    assert.deepEqual([all.body.has_more, all.body.next_cursor], [false, null])

    const paged = await call(mate, 'templates', 'GET', path('?page_size=1'), { data_source_id: db.dataSourceId })
    assert.equal((paged.body.templates as unknown[]).length, 1)
    assert.equal(paged.body.has_more, true)
    const rest = await call(mate, 'templates', 'GET', path(`?page_size=1&start_cursor=${paged.body.next_cursor}`), { data_source_id: db.dataSourceId })
    assert.deepEqual((rest.body.templates as { id: string }[]).map((x) => x.id), [weekly])

    const named = await call(mate, 'templates', 'GET', path('?name=DAILY'), { data_source_id: db.dataSourceId })
    assert.deepEqual((named.body.templates as { id: string }[]).map((x) => x.id), [daily])

    // 데이터베이스 id — 404 에 바른 주소 · 볼 수 없는 소스는 404
    const wrong = await call(mate, 'templates', 'GET', `/v1/data_sources/${db.id}/templates`, { data_source_id: db.id })
    assertError(wrong, 404, 'object_not_found', /This is a database ID/)
    const secret = must(await createDatabase(boss.ctx, { name: '비밀 표', privateTop: true }), '비밀 표')
    assertError(await call(mate, 'templates', 'GET', `/v1/data_sources/${secret.dataSourceId}/templates`, { data_source_id: secret.dataSourceId }), 404, 'object_not_found')
  })
})
