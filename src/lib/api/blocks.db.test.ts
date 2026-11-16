/**
 * 공개 API 의 블록 — 라우트 수준 (API-3 · F-09-01 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑤ · 공개 API 투영 규칙 · 판결 X-1 · V-5 · 09 F-09-01
 *
 * 라우트 파일은 `v1Route(handler)` 한 줄이라 같은 것을 여기서 만들어 `Request` 로 부른다(`pages.db.test.ts` 와 같다). 실제 서버 · 브라우저(열린
 * 편집기에 곧바로 나타나는가)는 e2e '공개 API — 블록 (API-3 · F-09-01)' 이 본다.
 *
 *   ★ 읽기 — 심어 둔 본문(중첩 토글 · 컬럼 · 표)을 쪽으로(page_size · start_cursor · has_more) · 블록 하나(부모 page_id / block_id) · 페이지 id 는
 *     child_page · 대시 없는 id · 없는 id 404
 *   ★ 붙이기 — 끝 · after · position(start) · 블록 밑 · 표의 행 · 거부(형제가 아님 · 자식을 못 갖는 블록 · child_page) · 쓰기는 본문 세션 하나
 *     (doc_update 의 출처 api · 행위자는 토큰의 사람 · 행은 Y.Doc 의 투영)
 *   ★ 고치기 — 체크 · 글 · 언어 · 셀 · 타입이 다른 열쇠는 거부
 *   ★ 지우기 · 되살리기 — 본문 블록(지우기 전의 모습 + in_trash · 다시 읽으면 404) · 하위 페이지 블록(휴지통 → 되살리기) · 블록째 지우면 그 안의
 *     하위 페이지도 휴지통
 *   ★ 제안 마크는 읽기에 보이지 않는다(원문)
 *   ★ 권한 — 볼 수만 있으면 읽기 200 · 쓰기 403 restricted_resource · 볼 수 없으면 404 · 잠긴 페이지 쓰기 400
 *   ★ POST /v1/pages 의 children — 새 페이지의 본문
 *   ★ 열린 협업 연결이 API 의 붙이기를 곧바로 받는다(커밋 신호)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

import { appendDocUpdate } from '../block/body-write.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { collabDocumentName } from '../collab/collab-server.ts'
import { loadDocState } from '../collab/doc-store.ts'
import { readBodyYDoc } from '../collab/ydoc.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import type { EditorBlock } from '../editor/document.ts'
import { blockSchema } from '../editor/schema.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import type { Level } from '../permissions/levels.ts'
import { setPageLock } from '../permissions/lock.ts'
import { reset } from '../rate-limit.ts'
import { assertBodyMatchesYDoc } from '../testing/body-invariant.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { cookieOf, join, ready, startServer, waitFor } from '../testing/collab-server-harness.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createApiToken } from './api-token.ts'
import { appendBlockChildren, deleteApiBlock, retrieveBlock, retrieveBlockChildren, updateApiBlock } from './blocks.ts'
import { createApiPage } from './pages.ts'
import { v1Route } from './v1.ts'
import { API_RATE_NAMESPACE, NOTION_VERSION } from './v1-protocol.ts'

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
    const { closeValkey } = await import('../valkey.ts')
    await closeValkey()
  }
})

// ── 부르기 ────────────────────────────────────────────────────────────

type Caller = Actor & { readonly api: string; readonly apiId: string }

async function withToken(actor: Actor): Promise<Caller> {
  const made = await createApiToken(actor.ctx, { name: 'API-3 시험' })
  if (!made.ok) throw new Error(made.reason)
  return { ...actor, api: made.value.token, apiId: made.value.summary.id }
}

const ROUTES = {
  getBlock: v1Route(retrieveBlock),
  patchBlock: v1Route(updateApiBlock),
  deleteBlock: v1Route(deleteApiBlock),
  getChildren: v1Route(retrieveBlockChildren),
  appendChildren: v1Route(appendBlockChildren),
  postPage: v1Route(createApiPage),
}

type Reply = { readonly status: number; readonly body: unknown }

async function call(who: Caller, route: keyof typeof ROUTES, method: string, path: string, params: Record<string, string>, body?: unknown): Promise<Reply> {
  await reset(API_RATE_NAMESPACE, who.apiId)
  const headers: Record<string, string> = { authorization: `Bearer ${who.api}`, 'notion-version': NOTION_VERSION }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await ROUTES[route](
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve(params) },
  )
  return { status: res.status, body: await res.json() }
}

const getBlock = (who: Caller, id: string) => call(who, 'getBlock', 'GET', `/v1/blocks/${id}`, { block_id: id })
const patchBlock = (who: Caller, id: string, body: unknown) => call(who, 'patchBlock', 'PATCH', `/v1/blocks/${id}`, { block_id: id }, body)
const deleteBlock = (who: Caller, id: string) => call(who, 'deleteBlock', 'DELETE', `/v1/blocks/${id}`, { block_id: id })
const getChildren = (who: Caller, id: string, search = '') => call(who, 'getChildren', 'GET', `/v1/blocks/${id}/children${search}`, { block_id: id })
const append = (who: Caller, id: string, body: unknown) => call(who, 'appendChildren', 'PATCH', `/v1/blocks/${id}/children`, { block_id: id }, body)
const postPage = (who: Caller, body: unknown) => call(who, 'postPage', 'POST', '/v1/pages', {}, body)

function dig(value: unknown, ...path: (string | number)[]): unknown {
  let at: unknown = value
  for (const key of path) {
    if (typeof at !== 'object' || at === null) return undefined
    at = (at as Record<string | number, unknown>)[key]
  }
  return at
}

function assertError(r: Reply, status: number, code: string, message?: RegExp) {
  assert.equal(r.status, status, JSON.stringify(r.body))
  assert.equal(dig(r.body, 'object'), 'error')
  assert.equal(dig(r.body, 'code'), code)
  if (message) assert.match(String(dig(r.body, 'message')), message)
}

type ApiBlock = { id: string; type: string; has_children: boolean; in_trash: boolean; parent: Record<string, unknown> } & Record<string, unknown>
const results = (r: Reply): ApiBlock[] => (dig(r.body, 'results') as ApiBlock[] | undefined) ?? []
const plain = (b: unknown, type: string): string => ((dig(b, type, 'rich_text') as { plain_text: string }[] | undefined) ?? []).map((x) => x.plain_text).join('')
const rt = (text: string) => [{ type: 'text', text: { content: text } }]
const para = (text: string) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(text) } })

const logOf = (pageId: string) => query<{ origin: string; actor_id: string | null }>(`SELECT origin, actor_id FROM doc_update WHERE page_id = $1 ORDER BY seq`, [pageId])

// ── 준비 ──────────────────────────────────────────────────────────────

const b = (type: EditorBlock['type'], extra: Partial<EditorBlock> = {}): EditorBlock => ({ id: randomUUID(), type, title: [], properties: {}, format: {}, children: [], ...extra })
const tp = (text: string, extra: Partial<EditorBlock> = {}) => b('paragraph', { title: [textRun(text)], ...extra })

/**
 * 소유자 · 편집하는 멤버 · 볼 수만 있는 멤버 · 볼 수 없는 멤버와 최상위 페이지 하나. 본문 — 문단 넷 · 토글 > 토글 > 문단 · 컬럼 둘 · 표 · 할 일 · 코드
 * (맨 위 블록 아홉).
 */
async function fixture(name: string) {
  const ws = await createBareWorkspace(name)
  const owner = await withToken(await joinAs(ws, await createUser(`${name} 소유자`), 'owner'))
  const member = await withToken(await joinAs(ws, await createUser(`${name} 멤버`), 'member'))
  const viewer = await withToken(await joinAs(ws, await createUser(`${name} 보기만`), 'member'))
  const stranger = await withToken(await joinAs(ws, await createUser(`${name} 남`), 'member'))
  const page = await createPage(owner.ctx, { parentPageId: null as never, title: titleFromPlainText(`${name} 본문`) })
  const grants: [Actor, Level][] = [[owner, 'full_access'], [member, 'edit'], [viewer, 'view']]
  for (const [actor, level] of grants) assert.equal((await grantAccess(owner.ctx, page.id, { type: 'user', id: actor.userId }, level)).ok, true)
  assert.equal((await revokeAccess(owner.ctx, page.id, { type: 'workspace_everyone' })).ok, true)

  const inner = tp('토글 안의 토글 안')
  const innerToggle = b('toggle', { title: [textRun('안쪽 토글')], children: [inner] })
  const toggle = b('toggle', { title: [textRun('바깥 토글')], children: [innerToggle] })
  const left = b('column', { format: { column_ratio: 0.4 }, children: [tp('왼쪽')] })
  const right = b('column', { format: { column_ratio: 0.6 }, children: [tp('오른쪽')] })
  const columns = b('column_list', { children: [left, right] })
  const rows = [b('table_row', { properties: { cells: [[textRun('이름')], [textRun('값')]] } }), b('table_row', { properties: { cells: [[textRun('가')], []] } })]
  const table = b('table', { properties: { has_column_header: true }, children: rows })
  const todo = b('to_do', { title: [textRun('할 일')], properties: { checked: false } })
  const code = b('code', { title: [textRun('print(1)')], properties: { language: 'python' } })
  const paras = [tp('첫째'), tp('둘째'), tp('셋째'), tp('넷째')]
  const blocks = [...paras, toggle, columns, table, todo, code]
  const saved = await savePageBody(owner.ctx, page.id as never, { blocks })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return { ws, owner, member, viewer, stranger, pageId: page.id as string, blocks, paras, toggle, innerToggle, inner, columns, left, right, table, rows, todo, code }
}

// ── 읽기 ──────────────────────────────────────────────────────────────

describe('읽기', () => {
  test('★ 본문을 쪽으로 · 중첩 토글 · 컬럼(폭) · 표(행 · 셀) · 블록 하나의 부모 · 페이지 id 는 child_page', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await fixture('블록 읽기')
    const first = await getChildren(fx.viewer, fx.pageId, '?page_size=4')
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.deepEqual([dig(first.body, 'object'), dig(first.body, 'type'), dig(first.body, 'has_more')], ['list', 'block', true])
    assert.deepEqual(results(first).map((x) => x.id), fx.paras.map((p) => p.id))
    assert.deepEqual(results(first)[0].parent, { type: 'page_id', page_id: fx.pageId })
    const rest = await getChildren(fx.viewer, fx.pageId.replace(/-/g, ''), `?page_size=100&start_cursor=${dig(first.body, 'next_cursor')}`)
    assert.equal(rest.status, 200, JSON.stringify(rest.body))
    assert.deepEqual(results(rest).map((x) => x.type), ['toggle', 'column_list', 'table', 'to_do', 'code'])
    assert.deepEqual([dig(rest.body, 'has_more'), dig(rest.body, 'next_cursor')], [false, null])
    const [toggle, columns, table, todo, code] = results(rest)
    assert.deepEqual([toggle.has_children, plain(toggle, 'toggle'), todo.has_children, dig(todo, 'to_do', 'checked')], [true, '바깥 토글', false, false])
    assert.deepEqual(dig(table, 'table'), { table_width: 2, has_column_header: true, has_row_header: false })
    assert.equal(dig(code, 'code', 'language'), 'python')
    assert.equal(columns.has_children, true)

    const inner = await getChildren(fx.viewer, fx.toggle.id)
    assert.deepEqual(results(inner).map((x) => [x.type, x.has_children, x.parent]), [['toggle', true, { type: 'block_id', block_id: fx.toggle.id }]])
    const deepest = await getChildren(fx.viewer, fx.innerToggle.id)
    assert.deepEqual(results(deepest).map((x) => plain(x, 'paragraph')), ['토글 안의 토글 안'])
    const cols = await getChildren(fx.viewer, fx.columns.id)
    assert.deepEqual(results(cols).map((x) => [x.type, dig(x, 'column', 'width_ratio')]), [['column', 0.4], ['column', 0.6]])
    const rows = await getChildren(fx.viewer, fx.table.id)
    assert.deepEqual(results(rows).map((x) => (dig(x, 'table_row', 'cells') as { plain_text: string }[][]).map((c) => c.map((r) => r.plain_text).join(''))), [['이름', '값'], ['가', '']])

    const one = await getBlock(fx.viewer, fx.inner.id)
    assert.equal(one.status, 200, JSON.stringify(one.body))
    assert.deepEqual([dig(one.body, 'object'), dig(one.body, 'type'), dig(one.body, 'parent'), dig(one.body, 'in_trash'), dig(one.body, 'created_by', 'id')], [
      'block', 'paragraph', { type: 'block_id', block_id: fx.innerToggle.id }, false, fx.owner.userId,
    ])
    assert.equal(dig(one.body, 'archived'), undefined, 'archived 는 싣지 않는다(정본 투영 규칙)')
    const asPage = await getBlock(fx.viewer, fx.pageId)
    assert.deepEqual([dig(asPage.body, 'type'), dig(asPage.body, 'child_page', 'title'), dig(asPage.body, 'has_children'), dig(asPage.body, 'parent')], [
      'child_page', '블록 읽기 본문', true, { type: 'workspace', workspace: true },
    ])
    assertError(await getBlock(fx.viewer, randomUUID()), 404, 'object_not_found', /Could not find block/)
    assertError(await getBlock(fx.viewer, 'nope'), 400, 'validation_error', /path\.block_id should be a valid uuid/)
    assertError(await getChildren(fx.viewer, fx.pageId, '?page_size=101'), 400, 'validation_error', /page_size/)
  })

  test('★ 제안 마크는 읽기에 보이지 않는다 — 넣자는 글은 빠지고 지우자는 글은 그냥 글이다(원문)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await fixture('제안 원문')
    const target = fx.paras[0]
    const state = await loadDocState(fx.owner.ctx, fx.pageId)
    assert.ok(state.ok)
    if (!state.ok) return
    const client = peer(state.value.ydoc, 8801)
    const author = fx.owner.userId
    edit(client, (tr: Transaction, doc: PmNode) => {
      const at = findBlock(doc, target.id).pos + 2
      tr.addMark(at, at + 1, blockSchema.marks.suggestion_delete!.create({ sid: randomUUID(), author_id: author }))
      tr.insert(at + 2, blockSchema.text('제안 글', [blockSchema.marks.suggestion_insert!.create({ sid: randomUUID(), author_id: author })]))
    })
    const sent = await appendDocUpdate(fx.owner.ctx, fx.pageId, changesSince(client, state.value.ydoc), { origin: 'editor' })
    assert.ok(sent.ok && sent.appended, JSON.stringify(sent))
    const read = await getBlock(fx.member, target.id)
    assert.equal(plain(read.body, 'paragraph'), '첫째')
    const listed = await getChildren(fx.member, fx.pageId, '?page_size=1')
    assert.equal(plain(results(listed)[0], 'paragraph'), '첫째')
  })

  test('★ 읽기는 Y.Doc 에서 — 투영이 밀린 참여자 편집(행은 아직 낡았다)도 곧바로 보인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await fixture('밀린 투영')
    const target = fx.paras[0]
    const state = await loadDocState(fx.owner.ctx, fx.pageId)
    assert.ok(state.ok)
    if (!state.ok) return
    const client = peer(state.value.ydoc, 8802)
    edit(client, (tr: Transaction, doc: PmNode) => {
      tr.insertText(' 더함', findBlock(doc, target.id).pos + 4)
    })
    // 협업 서버처럼 투영을 미룬다 — 행은 낡은 채로 남는다
    const sent = await appendDocUpdate(fx.owner.ctx, fx.pageId, changesSince(client, state.value.ydoc), { origin: 'editor', projection: 'deferred' })
    assert.ok(sent.ok && sent.appended, JSON.stringify(sent))
    const [row] = await query<{ title: string }>(`SELECT properties->'title'->0->'text'->>'content' AS title FROM block WHERE id = $1`, [target.id])
    assert.equal(row?.title, '첫째', '전제 — 행은 아직 투영되지 않았다')
    assert.equal(plain((await getBlock(fx.member, target.id)).body, 'paragraph'), '첫째 더함')
    assert.equal(plain(results(await getChildren(fx.member, fx.pageId, '?page_size=1'))[0], 'paragraph'), '첫째 더함')
  })
})

// ── 쓰기 ──────────────────────────────────────────────────────────────

describe('쓰기', () => {
  test('★ 붙이기 — 끝 · after · position start · 블록 밑 · 표의 행 · 본문 세션 하나(출처 api · 토큰의 사람) · 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await fixture('블록 붙이기')
    const before = (await logOf(fx.pageId)).length

    const atEnd = await append(fx.member, fx.pageId, {
      children: [para('끝 문단'), { type: 'to_do', to_do: { rich_text: rt('붙인 할 일'), checked: true, children: [para('할 일의 자식')] } }],
    })
    assert.equal(atEnd.status, 200, JSON.stringify(atEnd.body))
    assert.deepEqual([dig(atEnd.body, 'object'), dig(atEnd.body, 'has_more')], ['list', false])
    const [endPara, endTodo] = results(atEnd)
    assert.deepEqual([endPara.type, plain(endPara, 'paragraph'), endTodo.type, endTodo.has_children, dig(endTodo, 'to_do', 'checked')], ['paragraph', '끝 문단', 'to_do', true, true])
    assert.equal(dig(endPara, 'created_by', 'id'), fx.member.userId, '만든 사람은 토큰의 사람')
    const log = await logOf(fx.pageId)
    assert.equal(log.length, before + 1, '붙이기 한 번은 update 한 줄')
    assert.deepEqual(log.at(-1), { origin: 'api', actor_id: fx.member.userId })

    const afterFirst = await append(fx.member, fx.pageId.replace(/-/g, ''), { children: [para('첫째 뒤')], after: fx.paras[0].id })
    assert.equal(afterFirst.status, 200, JSON.stringify(afterFirst.body))
    const atStart = await append(fx.member, fx.pageId, { children: [para('맨 처음')], position: { type: 'start' } })
    assert.equal(atStart.status, 200, JSON.stringify(atStart.body))
    const intoToggle = await append(fx.member, fx.toggle.id, {
      children: [para('토글 끝')],
      position: { type: 'after_block', after_block: { id: fx.innerToggle.id } },
    })
    assert.equal(intoToggle.status, 200, JSON.stringify(intoToggle.body))
    assert.deepEqual(results(intoToggle)[0].parent, { type: 'block_id', block_id: fx.toggle.id })
    const intoTable = await append(fx.member, fx.table.id, { children: [{ type: 'table_row', table_row: { cells: [rt('새 행'), []] } }] })
    assert.equal(intoTable.status, 200, JSON.stringify(intoTable.body))

    const top = results(await getChildren(fx.member, fx.pageId)).map((x) => plain(x, x.type) || x.type)
    assert.deepEqual(top, ['맨 처음', '첫째', '첫째 뒤', '둘째', '셋째', '넷째', '바깥 토글', 'column_list', 'table', '할 일', 'print(1)', '끝 문단', '붙인 할 일'])
    assert.deepEqual(results(await getChildren(fx.member, fx.toggle.id)).map((x) => plain(x, x.type)), ['안쪽 토글', '토글 끝'])
    assert.equal(results(await getChildren(fx.member, fx.table.id)).length, 3)
    assert.deepEqual(results(await getChildren(fx.member, endTodo.id)).map((x) => plain(x, 'paragraph')), ['할 일의 자식'])
    await assertBodyMatchesYDoc(fx.owner.ctx, fx.pageId)
    assert.ok((await logOf(fx.pageId)).slice(before).every((r) => r.origin === 'api' && r.actor_id === fx.member.userId))

    // 거부 — 아무것도 쌓지 않는다
    const settled = (await logOf(fx.pageId)).length
    assertError(await append(fx.member, fx.pageId, { children: [para('x')], after: fx.inner.id }), 400, 'validation_error', /is not a child of block/)
    assertError(await append(fx.member, fx.pageId, { children: [{ type: 'child_page', child_page: { title: '새' } }] }), 400, 'validation_error', /POST \/v1\/pages/)
    assertError(await append(fx.member, fx.code.id, { children: [para('x')] }), 400, 'validation_error', /Block type code does not support children/)
    assertError(await append(fx.member, fx.columns.id, { children: [para('x')] }), 400, 'validation_error', /should be "column" inside a column_list/)
    assertError(await append(fx.member, fx.table.id, { children: [{ type: 'table_row', table_row: { cells: [rt('하나')] } }] }), 400, 'validation_error', /should have 2 cells/)
    assertError(await append(fx.member, fx.pageId, { children: [{ type: 'image', image: { file_upload: { id: randomUUID() } } }] }), 400, 'validation_error', /uploaded to this workspace/)
    assertError(await append(fx.member, fx.pageId, { children: [para('x')], after: fx.paras[1].id, position: { type: 'start' } }), 400, 'validation_error', /after should be not present/)
    assertError(await append(fx.member, randomUUID(), { children: [para('x')] }), 404, 'object_not_found')
    assert.equal((await logOf(fx.pageId)).length, settled, '거부된 붙이기는 로그에 남지 않는다')
  })

  test('★ 고치기 — 체크만(글은 그대로) · 글과 색 · 언어 · 셀 · 다른 타입의 열쇠 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await fixture('블록 고치기')
    const checked = await patchBlock(fx.member, fx.todo.id, { to_do: { checked: true } })
    assert.equal(checked.status, 200, JSON.stringify(checked.body))
    assert.deepEqual([dig(checked.body, 'to_do', 'checked'), plain(checked.body, 'to_do'), dig(checked.body, 'last_edited_by', 'id')], [true, '할 일', fx.member.userId])
    const text = await patchBlock(fx.member, fx.paras[1].id, { paragraph: { rich_text: [{ text: { content: '고친 ' }, annotations: { bold: true } }, { text: { content: '둘째' } }], color: 'red' } })
    assert.equal(text.status, 200, JSON.stringify(text.body))
    assert.deepEqual([plain(text.body, 'paragraph'), dig(text.body, 'paragraph', 'color'), dig(text.body, 'paragraph', 'rich_text', 0, 'annotations', 'bold')], ['고친 둘째', 'red', true])
    const language = await patchBlock(fx.member, fx.code.id, { code: { language: 'typescript', caption: rt('설명') } })
    assert.deepEqual([dig(language.body, 'code', 'language'), plain({ code: { rich_text: dig(language.body, 'code', 'caption') } }, 'code')], ['typescript', '설명'])
    const cells = await patchBlock(fx.member, fx.rows[1].id, { table_row: { cells: [rt('나'), rt('다')] } })
    assert.equal(cells.status, 200, JSON.stringify(cells.body))
    assert.deepEqual((dig(cells.body, 'table_row', 'cells') as { plain_text: string }[][]).map((c) => c.map((r) => r.plain_text).join('')), ['나', '다'])
    await assertBodyMatchesYDoc(fx.owner.ctx, fx.pageId)

    assertError(await patchBlock(fx.member, fx.todo.id, { paragraph: { rich_text: [] } }), 400, 'validation_error', /the block is of type "to_do"/)
    assertError(await patchBlock(fx.member, fx.todo.id, { to_do: { checked: true }, paragraph: {} }), 400, 'validation_error', /should be not present/)
    assertError(await patchBlock(fx.member, fx.table.id, { table: { table_width: 5 } }), 400, 'validation_error', /table_width cannot be changed/)
    assertError(await patchBlock(fx.member, fx.pageId, { child_page: { title: '새 제목' } }), 400, 'validation_error', /PATCH \/v1\/pages/)
  })

  test('★ 지우기 · 되살리기 — 본문 블록 · 하위 페이지 블록 · 블록째 지우면 그 안의 하위 페이지도 휴지통', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await fixture('블록 지우기')
    const gone = await deleteBlock(fx.member, fx.toggle.id)
    assert.equal(gone.status, 200, JSON.stringify(gone.body))
    assert.deepEqual([dig(gone.body, 'id'), dig(gone.body, 'type'), dig(gone.body, 'in_trash'), dig(gone.body, 'last_edited_by', 'id')], [fx.toggle.id, 'toggle', true, fx.member.userId])
    assertError(await getBlock(fx.member, fx.toggle.id), 404, 'object_not_found')
    assertError(await getBlock(fx.member, fx.inner.id), 404, 'object_not_found', undefined)
    assertError(await patchBlock(fx.member, fx.toggle.id, { in_trash: false }), 404, 'object_not_found')
    const viaPatch = await patchBlock(fx.member, fx.paras[3].id, { in_trash: true })
    assert.equal(dig(viaPatch.body, 'in_trash'), true)
    assert.equal((await logOf(fx.pageId)).at(-1)?.origin, 'api')
    await assertBodyMatchesYDoc(fx.owner.ctx, fx.pageId)

    // 하위 페이지 — 블록으로 지우면 휴지통 · in_trash:false 로 되살아난다
    const child = await postPage(fx.member, { parent: { page_id: fx.pageId }, properties: { title: { title: rt('하위') } } })
    assert.equal(child.status, 200, JSON.stringify(child.body))
    const childId = String(dig(child.body, 'id'))
    const listed = results(await getChildren(fx.member, fx.pageId)).find((x) => x.id === childId)
    assert.deepEqual([listed?.type, dig(listed, 'child_page', 'title')], ['child_page', '하위'])
    const trashed = await deleteBlock(fx.member, childId)
    assert.deepEqual([trashed.status, dig(trashed.body, 'type'), dig(trashed.body, 'in_trash')], [200, 'child_page', true])
    assert.equal((await query<{ lifecycle: string }>(`SELECT lifecycle FROM block WHERE id = $1`, [childId]))[0].lifecycle, 'trashed')
    assert.equal(results(await getChildren(fx.member, fx.pageId)).some((x) => x.id === childId), false, '부모 본문의 참조가 빠졌다')
    const restored = await patchBlock(fx.member, childId, { in_trash: false })
    assert.deepEqual([restored.status, dig(restored.body, 'in_trash')], [200, false])
    assert.equal(results(await getChildren(fx.member, fx.pageId)).some((x) => x.id === childId), true, '되살리면 참조가 돌아온다')

    // 토글째 지우면 그 안의 하위 페이지도 휴지통(편집기에서 지울 때와 같다)
    const holder = results(await append(fx.member, fx.pageId, { children: [{ type: 'toggle', toggle: { rich_text: rt('담는 토글') } }] }))[0]
    const nested = await postPage(fx.member, { parent: { page_id: fx.pageId }, properties: { title: { title: rt('토글 안 하위') } } })
    const nestedId = String(dig(nested.body, 'id'))
    // 참조를 토글 안으로 — 편집기의 옮기기와 같은 참여자 편집
    const state = await loadDocState(fx.member.ctx, fx.pageId)
    assert.ok(state.ok)
    if (!state.ok) return
    const client = peer(state.value.ydoc, 8802)
    edit(client, (tr: Transaction, doc: PmNode) => {
      const ref = findBlock(doc, nestedId)
      const node = ref.node
      tr.delete(ref.pos, ref.pos + node.nodeSize)
      const host = findBlock(tr.doc, holder.id)
      tr.insert(host.pos + host.node.nodeSize - 1, blockSchema.nodes.blockGroup.create(null, [node]))
    })
    const moved = await appendDocUpdate(fx.member.ctx, fx.pageId, changesSince(client, state.value.ydoc), { origin: 'editor' })
    assert.ok(moved.ok, JSON.stringify(moved))
    assert.deepEqual(results(await getChildren(fx.member, holder.id)).map((x) => x.id), [nestedId])
    assert.equal((await deleteBlock(fx.member, holder.id)).status, 200)
    assert.equal((await query<{ lifecycle: string }>(`SELECT lifecycle FROM block WHERE id = $1`, [nestedId]))[0].lifecycle, 'trashed')
    await assertBodyMatchesYDoc(fx.owner.ctx, fx.pageId)
  })

  test('★ 권한 — 볼 수만 있으면 읽기 200 · 쓰기 403 · 볼 수 없으면 404 · 잠긴 페이지는 쓰기 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await fixture('블록 권한')
    assert.equal((await getChildren(fx.viewer, fx.pageId)).status, 200)
    assertError(await append(fx.viewer, fx.pageId, { children: [para('x')] }), 403, 'restricted_resource')
    assertError(await patchBlock(fx.viewer, fx.todo.id, { to_do: { checked: true } }), 403, 'restricted_resource')
    assertError(await deleteBlock(fx.viewer, fx.paras[0].id), 403, 'restricted_resource')
    assertError(await getChildren(fx.stranger, fx.pageId), 404, 'object_not_found')
    assertError(await getBlock(fx.stranger, fx.paras[0].id), 404, 'object_not_found')
    assertError(await append(fx.stranger, fx.toggle.id, { children: [para('x')] }), 404, 'object_not_found')
    assertError(await deleteBlock(fx.stranger, fx.paras[0].id), 404, 'object_not_found')

    assert.equal((await setPageLock(fx.owner.ctx, fx.pageId, true)).ok, true)
    assertError(await append(fx.member, fx.pageId, { children: [para('x')] }), 400, 'validation_error', /locked/)
    assertError(await patchBlock(fx.member, fx.todo.id, { to_do: { checked: true } }), 400, 'validation_error', /locked/)
    assert.equal((await getBlock(fx.member, fx.todo.id)).status, 200, '잠겨도 읽기는 된다')
    assert.equal((await setPageLock(fx.owner.ctx, fx.pageId, false)).ok, true)
    assert.equal((await patchBlock(fx.member, fx.todo.id, { to_do: { checked: true } })).status, 200)
  })

  test('★ POST /v1/pages 의 children — 새 페이지의 본문(본문 세션 · 출처 api)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await fixture('새 페이지 본문')
    const made = await postPage(fx.member, {
      parent: { page_id: fx.pageId },
      properties: { title: { title: rt('본문 있는 페이지') } },
      children: [
        { type: 'heading_2', heading_2: { rich_text: rt('머리') } },
        { type: 'column_list', column_list: { children: [
          { type: 'column', column: { children: [para('왼')] } },
          { type: 'column', column: { children: [para('오')] } },
        ] } },
        { type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('점'), children: [para('점 밑')] } },
      ],
    })
    assert.equal(made.status, 200, JSON.stringify(made.body))
    const id = String(dig(made.body, 'id'))
    const top = results(await getChildren(fx.member, id))
    assert.deepEqual(top.map((x) => x.type), ['heading_2', 'column_list', 'bulleted_list_item'])
    assert.deepEqual(results(await getChildren(fx.member, top[2].id)).map((x) => plain(x, 'paragraph')), ['점 밑'])
    // 옮기기(빈 본문 · import) 다음의 한 줄 — 출처 api · 토큰의 사람
    assert.deepEqual((await logOf(id)).filter((r) => r.origin !== 'import'), [{ origin: 'api', actor_id: fx.member.userId }])
    await assertBodyMatchesYDoc(fx.member.ctx, id)
  })
})

// ── 협업 ──────────────────────────────────────────────────────────────

describe('협업', () => {
  test('★ 열린 협업 연결이 API 의 붙이기 · 고치기 · 지우기를 곧바로 받는다(커밋 신호)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await fixture('블록 협업')
    const server = await startServer(t)
    const watcher = join(t, server.url, collabDocumentName(fx.ws, fx.pageId), cookieOf(fx.owner))
    await ready(watcher)
    const blocksOf = () => readBodyYDoc(watcher.doc, fx.pageId).doc.blocks

    const appended = await append(fx.member, fx.pageId, { children: [para('API 가 붙인 줄')] })
    const newId = results(appended)[0]?.id
    await waitFor('붙인 블록이 열린 연결에 닿는다', () => blocksOf().some((x) => x.id === newId))
    await patchBlock(fx.member, fx.todo.id, { to_do: { checked: true } })
    await waitFor('고친 체크가 닿는다', () => blocksOf().find((x) => x.id === fx.todo.id)?.properties?.checked === true)
    await deleteBlock(fx.member, newId)
    await waitFor('지운 블록이 빠진다', () => !blocksOf().some((x) => x.id === newId))
  })
})
