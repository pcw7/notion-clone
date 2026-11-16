/**
 * 공개 API 의 페이지 — 라우트 수준 (API-2 · F-09-01 · F-09-17 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 공개 API 투영 규칙 · [보강 API-1] ③ ⑤ · 09 F-09-01 · F-09-17
 *
 * 라우트 파일은 `v1Route(handler)` 한 줄이라 같은 것을 여기서 만들어 `Request` 로 부른다(`v1.db.test.ts` 와 같다). 실제 서버 · 브라우저로는
 * e2e '공개 API — 페이지 (API-2 · F-09-01)' 가 본다.
 *
 *   ★ GET — 워크스페이스 페이지(부모 · 제목 · url · 만든 사람) · 데이터베이스 행(타입마다 노션의 모양 · 부모는 data_source_id) · 대시 없는 id ·
 *     모양이 틀린 id 400 · 없는 id 404
 *   ★ 행 단위 권한 — 끊고 뺀 행은 404 · 다른 행의 relation 에서도 빠진다
 *   ★ 내보내기 정책을 끄면 멤버는 403 restricted_resource · 소유자는 그대로
 *   ★ property item — 제목 조각 · relation 을 쪽으로(page_size · start_cursor · has_more · next_url) · 페이지 객체의 relation 은 25 + has_more
 *   ★ POST — 페이지 밑 · 데이터 소스 · database_id(소스 하나만) · 거부(모르는 속성 · 없는 옵션 · 읽기 전용 · children · 워크스페이스 부모) ·
 *     볼 수만 있는 사람 403 · 볼 수 없으면 404 · 쓰기의 출처는 api · 행위자는 토큰의 사람
 *   ★ PATCH — 칸 · 제목 · 아이콘 · 커버 · 휴지통 · 되살리기 · 휴지통에서 고치기 거부 · 잠긴 페이지 400 · 볼 수만 있는 사람 403
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { textRun } from '../contracts/rich-text.ts'
import { createPage } from '../block/page.ts'
import { createDatabase } from '../database/database.ts'
import { addDataSource } from '../database/data-source.ts'
import { addFormulaProperty } from '../database/formula-property.ts'
import { addProperty, addSelectOption, getSchema } from '../database/property.ts'
import { addRelationProperty, linkRows } from '../database/relation.ts'
import { addRollupProperty } from '../database/rollup.ts'
import { createRow } from '../database/row.ts'
import { verifyRow } from '../database/verification.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { query } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { reset } from '../rate-limit.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { writeExportPolicyIn } from '../workspace/security-policy.ts'
import { createApiToken } from './api-token.ts'
import { createApiPage, retrievePage, retrievePageProperty, updateApiPage } from './pages.ts'
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
  const made = await createApiToken(actor.ctx, { name: 'API-2 시험' })
  if (!made.ok) throw new Error(made.reason)
  return { ...actor, api: made.value.token, apiId: made.value.summary.id }
}

const ROUTES = {
  getPage: v1Route(retrievePage),
  patchPage: v1Route(updateApiPage),
  postPage: v1Route(createApiPage),
  getProperty: v1Route(retrievePageProperty),
}

type Reply = { readonly status: number; readonly body: unknown }

async function call(who: Caller, route: keyof typeof ROUTES, method: string, path: string, params: Record<string, string>, body?: unknown): Promise<Reply> {
  // 한 시험이 한 토큰으로 여러 번 부른다 — 요청 제한(5초에 15번)은 API-1 이 본다
  await reset(API_RATE_NAMESPACE, who.apiId)
  const headers: Record<string, string> = { authorization: `Bearer ${who.api}`, 'notion-version': NOTION_VERSION }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await ROUTES[route](
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve(params) },
  )
  return { status: res.status, body: await res.json() }
}

const getPage = (who: Caller, id: string) => call(who, 'getPage', 'GET', `/v1/pages/${id}`, { page_id: id })
const patchPage = (who: Caller, id: string, body: unknown) => call(who, 'patchPage', 'PATCH', `/v1/pages/${id}`, { page_id: id }, body)
const postPage = (who: Caller, body: unknown) => call(who, 'postPage', 'POST', '/v1/pages', {}, body)
const getProperty = (who: Caller, id: string, propertyId: string, search = '') =>
  call(who, 'getProperty', 'GET', `/v1/pages/${id}/properties/${encodeURIComponent(propertyId)}${search}`, { page_id: id, property_id: propertyId })

/** 응답을 들여다본다 — 없는 자리는 undefined. */
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

const title = (text: string) => ({ title: [{ text: { content: text } }] })
const plainOf = (runs: unknown) => (Array.isArray(runs) ? runs.map((r) => String(dig(r, 'plain_text'))).join('') : null)

// ── 준비 ──────────────────────────────────────────────────────────────

async function workspace(name: string) {
  const ws = await createBareWorkspace(name)
  // 검증 속성(VF-1)은 Business 부터
  const plan = await setWorkspacePlan(ws, 'business')
  if (!plan.ok) throw new Error(plan.reason)
  const owner = await withToken(await joinAs(ws, await createUser(`${name} 소유자`), 'owner'))
  const member = await withToken(await joinAs(ws, await createUser(`${name} 멤버`), 'member'))
  return { ws, owner, member }
}

const must = <T>(r: { ok: boolean; value?: T; reason?: string }, what: string): T => {
  if (!r.ok) throw new Error(`${what} 준비 실패: ${r.reason}`)
  return r.value as T
}

/** 여러 타입의 속성을 가진 표(워크스페이스 최상위 — 모두가 본다) · 연결 대상 표 · 행 하나. */
async function richTable(owner: Caller, member: Caller) {
  const target = must(await createDatabase(owner.ctx, { name: '대상 표' }), '대상 표')
  const targetSchema = must(await getSchema(owner.ctx, target.dataSourceId), '대상 스키마')
  const targetTitle = targetSchema.properties.find((p) => p.type === 'title')!.id
  must(await addProperty(owner.ctx, target.dataSourceId, { name: '값', type: 'number' }), '값')
  const valueId = must(await getSchema(owner.ctx, target.dataSourceId), '대상 스키마').properties.find((p) => p.name === '값')!.id
  const targets: string[] = []
  for (const [i, n] of [5, 7].entries()) {
    targets.push(
      must(
        await createRow(owner.ctx, target.dataSourceId, {
          cells: [
            { propertyId: targetTitle, value: { type: 'title', title: [textRun(`대상 ${i}`)] } },
            { propertyId: valueId, value: { type: 'number', number: n } },
          ],
        }),
        '대상 행',
      ).id,
    )
  }

  const table = must(await createDatabase(owner.ctx, { name: '타입 표' }), '표')
  const ds = table.dataSourceId
  must(await addProperty(owner.ctx, ds, { name: '번호', type: 'unique_id', prefix: 'TASK' }), '번호')
  for (const [name, type] of [
    ['점수', 'number'],
    ['종류', 'select'],
    ['상태', 'status'],
    ['태그', 'multi_select'],
    ['완료', 'checkbox'],
    ['기한', 'date'],
    ['담당', 'people'],
    ['주소', 'url'],
    ['메일', 'email'],
    ['전화', 'phone_number'],
    ['장소', 'place'],
    ['메모', 'rich_text'],
    ['만든 시각', 'created_time'],
    ['만든 사람', 'created_by'],
    ['고친 시각', 'last_edited_time'],
    ['고친 사람', 'last_edited_by'],
    ['검증', 'verification'],
  ] as const) {
    must(await addProperty(owner.ctx, ds, { name, type }), name)
  }
  const relation = must(await addRelationProperty(owner.ctx, ds, { name: '관련', targetDataSourceId: target.dataSourceId }), '관련').propertyId
  must(await addRollupProperty(owner.ctx, ds, { name: '합', relationPropertyId: relation, targetPropertyId: valueId, function: 'sum' }), '합')
  must(await addFormulaProperty(owner.ctx, ds, { name: '두배', expression: 'prop("점수") * 2' }), '두배')
  let schema = must(await getSchema(owner.ctx, ds), '스키마')
  const id = (name: string) => schema.properties.find((p) => p.name === name)!.id
  const kind = must(await addSelectOption(owner.ctx, ds, id('종류'), { name: '버그', color: 'red' }), '버그').option
  must(await addSelectOption(owner.ctx, ds, id('종류'), { name: '기능', color: 'blue' }), '기능')
  const tag = must(await addSelectOption(owner.ctx, ds, id('태그'), { name: '급함', color: 'orange' }), '급함').option
  schema = must(await getSchema(owner.ctx, ds), '스키마')
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const statusOptions = schema.properties.find((p) => p.name === '상태')!.options ?? []

  const row = must(
    await createRow(owner.ctx, ds, {
      cells: [
        { propertyId: titleId, value: { type: 'title', title: [textRun('첫 일')] } },
        { propertyId: id('점수'), value: { type: 'number', number: 21 } },
        { propertyId: id('종류'), value: { type: 'select', select: { id: kind.id } } },
        { propertyId: id('태그'), value: { type: 'multi_select', multi_select: [{ id: tag.id }] } },
        { propertyId: id('완료'), value: { type: 'checkbox', checkbox: true } },
        { propertyId: id('기한'), value: { type: 'date', date: { start: '2026-03-01T09:00:00', end: '2026-03-02T18:00:00', time_zone: 'Asia/Seoul' } } },
        { propertyId: id('담당'), value: { type: 'people', people: [{ id: member.userId }] } },
        { propertyId: id('주소'), value: { type: 'url', url: 'https://example.com' } },
        { propertyId: id('메일'), value: { type: 'email', email: 'a@example.com' } },
        { propertyId: id('전화'), value: { type: 'phone_number', phone_number: '010-0000-0000' } },
        { propertyId: id('장소'), value: { type: 'place', place: { name: '서울역', address: '서울 중구', lat: 37.55, lng: 126.97 } } },
        { propertyId: id('메모'), value: { type: 'rich_text', rich_text: [textRun('굵은 ', { bold: true }), textRun('메모')] } },
      ],
    }),
    '행',
  )
  must(await linkRows(owner.ctx, row.id, relation, { add: targets }), '연결')
  must(await verifyRow(owner.ctx, row.id, id('검증'), null), '검증')
  return { table, ds, row: row.id, id, titleId, targets, kind, tag, statusOptions, relation }
}

// ── 읽기 ──────────────────────────────────────────────────────────────

describe('GET /v1/pages/{id}', () => {
  test('★ 워크스페이스 페이지 — 부모 · 제목 · url · 만든 사람 · 대시 없는 id · 400 · 404', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await workspace('읽기')
    const root = await createPage(owner.ctx, { title: [textRun('뿌리')] })
    const child = await createPage(owner.ctx, { parentPageId: root.id, title: [textRun('하위 '), textRun('페이지', { bold: true })] })

    const r = await getPage(member, child.id)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual(Object.keys(r.body as object), [
      'object', 'id', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'cover', 'icon', 'parent', 'in_trash', 'properties', 'url', 'public_url',
    ])
    assert.equal(dig(r.body, 'object'), 'page')
    assert.equal(dig(r.body, 'id'), child.id)
    assert.deepEqual(dig(r.body, 'parent'), { type: 'page_id', page_id: root.id })
    assert.deepEqual(dig(r.body, 'created_by'), { object: 'user', id: owner.userId })
    assert.equal(dig(r.body, 'in_trash'), false)
    assert.equal(dig(r.body, 'public_url'), null)
    assert.match(String(dig(r.body, 'url')), new RegExp(`/w/${ws}/${child.id}$`))
    assert.equal(dig(r.body, 'properties', 'title', 'id'), 'title')
    assert.equal(plainOf(dig(r.body, 'properties', 'title', 'title')), '하위 페이지')
    assert.equal(dig(r.body, 'properties', 'title', 'title', 1, 'annotations', 'bold'), true)
    assert.match(String(dig(r.body, 'created_time')), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

    const top = await getPage(member, root.id.replace(/-/g, ''))
    assert.equal(top.status, 200)
    assert.deepEqual(dig(top.body, 'parent'), { type: 'workspace', workspace: true })

    assertError(await getPage(member, 'nope'), 400, 'validation_error', /path\.page_id should be a valid uuid/)
    assertError(await getPage(member, '0d6c2a52-8b6e-4b57-9a4b-6a1f0c6f0f00'), 404, 'object_not_found', /Could not find page with ID/)
  })

  test('★ 데이터베이스 행 — 타입마다 노션의 모양 · 부모는 data_source_id + database_id', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('행 읽기')
    const fx = await richTable(owner, member)
    const r = await getPage(member, fx.row)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const p = (name: string, ...rest: (string | number)[]) => dig(r.body, 'properties', name, ...rest)
    assert.deepEqual(dig(r.body, 'parent'), { type: 'data_source_id', data_source_id: fx.ds, database_id: fx.table.id })
    const titleName = Object.entries(dig(r.body, 'properties') as Record<string, unknown>).find(([, v]) => dig(v, 'type') === 'title')![0]
    assert.equal(p(titleName, 'id'), 'title')
    assert.equal(plainOf(p(titleName, 'title')), '첫 일')
    assert.deepEqual(p('점수'), { id: fx.id('점수'), type: 'number', number: 21 })
    assert.deepEqual(p('종류', 'select'), { id: fx.kind.id, name: '버그', color: 'red' })
    assert.deepEqual(p('태그', 'multi_select'), [{ id: fx.tag.id, name: '급함', color: 'orange' }])
    const defaultStatus = fx.statusOptions[0]
    assert.deepEqual(p('상태', 'status'), { id: defaultStatus.id, name: defaultStatus.name, color: defaultStatus.color }, '새 행은 기본 상태')
    assert.equal(p('완료', 'checkbox'), true)
    assert.deepEqual(p('기한', 'date'), { start: '2026-03-01T09:00:00', end: '2026-03-02T18:00:00', time_zone: 'Asia/Seoul' })
    assert.deepEqual(p('담당', 'people'), [{ object: 'user', id: member.userId }])
    assert.equal(p('주소', 'url'), 'https://example.com')
    assert.equal(p('메일', 'email'), 'a@example.com')
    assert.equal(p('전화', 'phone_number'), '010-0000-0000')
    assert.deepEqual(p('장소', 'place'), { lat: 37.55, lon: 126.97, name: '서울역', address: '서울 중구', aws_place_id: null, google_place_id: null })
    assert.equal(plainOf(p('메모', 'rich_text')), '굵은 메모')
    assert.deepEqual(p('관련'), { id: fx.relation, type: 'relation', relation: fx.targets.map((id) => ({ id })), has_more: false })
    assert.deepEqual(p('합', 'rollup'), { type: 'number', number: 12, function: 'sum' })
    assert.deepEqual(p('두배', 'formula'), { type: 'number', number: 42 })
    assert.deepEqual(p('번호', 'unique_id'), { prefix: 'TASK', number: 1 })
    assert.deepEqual(p('만든 사람', 'created_by'), { object: 'user', id: owner.userId })
    assert.deepEqual(p('고친 사람', 'last_edited_by'), { object: 'user', id: owner.userId })
    assert.equal(p('만든 시각', 'created_time'), dig(r.body, 'created_time'))
    assert.equal(p('고친 시각', 'last_edited_time'), dig(r.body, 'last_edited_time'))
    assert.equal(p('검증', 'verification', 'state'), 'verified')
    assert.deepEqual(p('검증', 'verification', 'verified_by'), { object: 'user', id: owner.userId })
    assert.equal(p('검증', 'verification', 'date', 'end'), null, '무기한')
  })

  test('★ 행 단위 권한 — 끊고 뺀 행은 404 · 다른 행의 relation 에서도 빠진다 · 소유자는 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('행 권한')
    const table = must(await createDatabase(owner.ctx, { name: '개인 표', privateTop: true }), '개인 표')
    must(await grantAccess(owner.ctx, table.id, { type: 'user', id: member.userId }, 'edit'), '공유')
    const link = must(await addRelationProperty(owner.ctx, table.dataSourceId, { name: '링크', targetDataSourceId: table.dataSourceId }), '링크').propertyId
    const rows = [] as string[]
    for (let i = 0; i < 3; i += 1) rows.push(must(await createRow(owner.ctx, table.dataSourceId, {}), '행').id)
    must(await linkRows(owner.ctx, rows[0], link, { add: [rows[1], rows[2]] }), '연결')
    must(await stopInheriting(owner.ctx, rows[1]), '끊기')
    must(await revokeAccess(owner.ctx, rows[1], { type: 'user', id: member.userId }), '빼기')

    assertError(await getPage(member, rows[1]), 404, 'object_not_found')
    const first = await getPage(member, rows[0])
    assert.deepEqual(dig(first.body, 'properties', '링크', 'relation'), [{ id: rows[2] }], '볼 수 없는 행의 id 를 흘리지 않는다')
    const item = await getProperty(member, rows[0], link)
    assert.deepEqual(dig(item.body, 'results'), [{ object: 'property_item', id: link, type: 'relation', relation: { id: rows[2] } }])
    assert.equal((await getPage(owner, rows[1])).status, 200)
    assert.deepEqual(dig((await getPage(owner, rows[0])).body, 'properties', '링크', 'relation'), [{ id: rows[1] }, { id: rows[2] }])
  })

  test('★ 내보내기 정책을 끄면 멤버는 403 restricted_resource(읽기 · 쓰기) · 소유자는 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await workspace('정책')
    const page = await createPage(owner.ctx, { title: [textRun('정책 아래')] })
    await withTransaction((tx) => writeExportPolicyIn(tx, ws, false))
    try {
      assertError(await getPage(member, page.id), 403, 'restricted_resource', /security policy/)
      assertError(await patchPage(member, page.id, { properties: title('바꿈') }), 403, 'restricted_resource')
      assertError(await getProperty(member, page.id, 'title'), 403, 'restricted_resource')
      assert.equal((await getPage(owner, page.id)).status, 200)
    } finally {
      await withTransaction((tx) => writeExportPolicyIn(tx, ws, true))
    }
    assert.equal((await getPage(member, page.id)).status, 200)
  })
})

describe('GET /v1/pages/{id}/properties/{property_id}', () => {
  test('★ 쪽 나누기 — 제목 조각 · relation 30개(페이지 객체는 25 + has_more · 항목은 page_size 로) · 단일 항목 · 모르는 속성 404', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('항목')
    const page = await createPage(owner.ctx, { title: [textRun('하나 '), textRun('둘', { bold: true }), textRun(' 셋', { italic: true })] })
    const first = await getProperty(member, page.id, 'title', '?page_size=2')
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(dig(first.body, 'object'), 'list')
    assert.equal(dig(first.body, 'type'), 'property_item')
    assert.equal((dig(first.body, 'results') as unknown[]).length, 2)
    assert.equal(dig(first.body, 'results', 0, 'object'), 'property_item')
    assert.equal(dig(first.body, 'results', 0, 'title', 'plain_text'), '하나 ')
    assert.equal(dig(first.body, 'has_more'), true)
    const cursor = String(dig(first.body, 'next_cursor'))
    assert.deepEqual(Object.keys(dig(first.body, 'property_item') as object), ['id', 'next_url', 'type', 'title'])
    assert.match(String(dig(first.body, 'property_item', 'next_url')), new RegExp(`/v1/pages/${page.id}/properties/title\\?start_cursor=${cursor}&page_size=2$`))
    const second = await getProperty(member, page.id, 'title', `?page_size=2&start_cursor=${cursor}`)
    assert.equal((dig(second.body, 'results') as unknown[]).length, 1)
    assert.equal(dig(second.body, 'results', 0, 'title', 'plain_text'), ' 셋')
    assert.equal(dig(second.body, 'has_more'), false)
    assert.equal(dig(second.body, 'next_cursor'), null)
    assertError(await getProperty(member, page.id, 'title', '?page_size=101'), 400, 'validation_error', /page_size/)
    assertError(await getProperty(member, page.id, 'title', '?start_cursor=%21%21'), 400, 'validation_error', /start_cursor/)
    assertError(await getProperty(member, page.id, 'nope'), 404, 'object_not_found', /Could not find property/)

    // relation 30개
    const target = must(await createDatabase(owner.ctx, { name: '많은 대상' }), '대상')
    const table = must(await createDatabase(owner.ctx, { name: '많은 연결' }), '표')
    const rel = must(await addRelationProperty(owner.ctx, table.dataSourceId, { name: '연결', targetDataSourceId: target.dataSourceId }), '연결').propertyId
    must(await addProperty(owner.ctx, table.dataSourceId, { name: '점수', type: 'number' }), '점수')
    const score = must(await getSchema(owner.ctx, table.dataSourceId), '스키마').properties.find((p) => p.name === '점수')!.id
    const targets: string[] = []
    for (let i = 0; i < 30; i += 1) targets.push(must(await createRow(owner.ctx, target.dataSourceId, {}), '대상 행').id)
    const row = must(await createRow(owner.ctx, table.dataSourceId, { cells: [{ propertyId: score, value: { type: 'number', number: 9 } }] }), '행').id
    must(await linkRows(owner.ctx, row, rel, { add: targets }), '연결')

    const pageObject = await getPage(member, row)
    assert.equal((dig(pageObject.body, 'properties', '연결', 'relation') as unknown[]).length, 25)
    assert.equal(dig(pageObject.body, 'properties', '연결', 'has_more'), true, '25개를 넘으면 has_more(F-09-17)')

    const seen: string[] = []
    let next: string | null = null
    let pages = 0
    do {
      const r = await getProperty(member, row, rel, `?page_size=10${next === null ? '' : `&start_cursor=${next}`}`)
      assert.equal(r.status, 200, JSON.stringify(r.body))
      for (const item of dig(r.body, 'results') as unknown[]) seen.push(String(dig(item, 'relation', 'id')))
      next = dig(r.body, 'next_cursor') as string | null
      pages += 1
    } while (next !== null && pages < 10)
    assert.equal(pages, 3)
    assert.deepEqual(seen, targets, '연결한 차례 그대로 · 빠짐 · 겹침 없이')

    const single = await getProperty(member, row, score)
    assert.deepEqual(single.body, { object: 'property_item', id: score, type: 'number', number: 9 })
  })
})

// ── 쓰기 ──────────────────────────────────────────────────────────────

describe('POST /v1/pages', () => {
  test('★ 페이지 밑 — 제목 · 아이콘 · 커버 · 쓰기의 출처는 api · 행위자는 토큰의 사람 · 볼 수만 있으면 403 · 못 보면 404', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await workspace('만들기')
    const root = await createPage(owner.ctx, { title: [textRun('부모')] })
    const r = await postPage(member, {
      parent: { page_id: root.id },
      properties: { title: [{ text: { content: 'API 로 만든 페이지' } }] },
      icon: { emoji: '🚀' },
      cover: { type: 'external', external: { url: 'https://example.com/cover.png' } },
      children: [],
    })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const id = String(dig(r.body, 'id'))
    assert.deepEqual(dig(r.body, 'parent'), { type: 'page_id', page_id: root.id })
    assert.equal(plainOf(dig(r.body, 'properties', 'title', 'title')), 'API 로 만든 페이지')
    assert.deepEqual(dig(r.body, 'icon'), { type: 'emoji', emoji: '🚀' })
    assert.deepEqual(dig(r.body, 'cover'), { type: 'external', external: { url: 'https://example.com/cover.png' } })
    assert.deepEqual(dig(r.body, 'created_by'), { object: 'user', id: member.userId })

    const block = await query<{ created_by: string; last_edited_by: string }>(`SELECT created_by, last_edited_by FROM block WHERE id = $1`, [id])
    assert.deepEqual(block[0], { created_by: member.userId, last_edited_by: member.userId })
    const log = await query<{ origin: string; actor_id: string | null }>(`SELECT origin, actor_id FROM doc_update WHERE page_id = $1 ORDER BY seq`, [root.id])
    assert.deepEqual(log.at(-1), { origin: 'api', actor_id: member.userId }, '부모 본문의 참조는 출처 api · 토큰의 사람으로 쌓인다')

    // 볼 수만 있는 사람 · 볼 수 없는 사람
    const reader = await withToken(await joinAs(ws, await createUser('읽기만'), 'member'))
    const secret = await createPage(owner.ctx, { title: [textRun('비밀')], privateTop: true })
    must(await grantAccess(owner.ctx, secret.id, { type: 'user', id: reader.userId }, 'view'), '보기')
    assertError(await postPage(reader, { parent: { page_id: secret.id }, properties: title('안 됨') }), 403, 'restricted_resource')
    assertError(await postPage(member, { parent: { page_id: secret.id }, properties: title('안 됨') }), 404, 'object_not_found')
  })

  test('★ 데이터 소스 · database_id — 칸(이름 · id · 옵션 이름 · 날짜 범위와 시간대 · relation) · 거부 · 소스가 둘이면 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('행 만들기')
    const fx = await richTable(owner, member)
    const r = await postPage(member, {
      parent: { type: 'data_source_id', data_source_id: fx.ds.replace(/-/g, '') },
      properties: {
        title: { title: [{ text: { content: 'API 행' } }] },
        점수: { number: 4 },
        [fx.id('종류')]: { select: { name: '기능' } },
        상태: { status: { name: fx.statusOptions[2].name } },
        태그: { multi_select: [{ name: '급함' }] },
        기한: { date: { start: '2026-04-01T10:00:00', end: '2026-04-03T10:00:00', time_zone: 'America/New_York' } },
        담당: { people: [{ object: 'user', id: owner.userId }] },
        관련: { relation: [{ id: fx.targets[1] }] },
        장소: { place: { lat: 35.1, lon: 129.04, name: '부산역' } },
      },
      icon: { type: 'external', external: { url: 'https://example.com/icon.png' } },
    })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const p = (name: string, ...rest: (string | number)[]) => dig(r.body, 'properties', name, ...rest)
    assert.deepEqual(dig(r.body, 'parent'), { type: 'data_source_id', data_source_id: fx.ds, database_id: fx.table.id })
    assert.equal(p('점수', 'number'), 4)
    assert.equal(p('종류', 'select', 'name'), '기능')
    assert.equal(p('상태', 'status', 'name'), fx.statusOptions[2].name)
    assert.deepEqual(p('기한', 'date'), { start: '2026-04-01T10:00:00', end: '2026-04-03T10:00:00', time_zone: 'America/New_York' })
    assert.deepEqual(p('담당', 'people'), [{ object: 'user', id: owner.userId }])
    assert.deepEqual(p('관련', 'relation'), [{ id: fx.targets[1] }])
    assert.deepEqual(p('합', 'rollup'), { type: 'number', number: 7, function: 'sum' })
    assert.deepEqual(p('두배', 'formula'), { type: 'number', number: 8 })
    assert.deepEqual(p('번호', 'unique_id'), { prefix: 'TASK', number: 2 })
    assert.deepEqual(p('만든 사람', 'created_by'), { object: 'user', id: member.userId })
    assert.equal(p('장소', 'place', 'name'), '부산역')
    assert.deepEqual(dig(r.body, 'icon'), { type: 'external', external: { url: 'https://example.com/icon.png' } })

    // 거부 — 아무것도 남기지 않는다
    const before = await query<{ n: number }>(`SELECT count(*)::int AS n FROM page WHERE data_source_id = $1`, [fx.ds])
    assertError(await postPage(member, { parent: { data_source_id: fx.ds }, properties: { 없는속성: { number: 1 } } }), 400, 'validation_error', /없는속성 is not a property that exists/)
    assertError(await postPage(member, { parent: { data_source_id: fx.ds }, properties: { 종류: { select: { name: '없는 옵션' } } } }), 400, 'validation_error', /is not an option/)
    assertError(await postPage(member, { parent: { data_source_id: fx.ds }, properties: { 두배: { formula: { number: 1 } } } }), 400, 'validation_error', /formula property and cannot be updated/)
    assertError(await postPage(member, { parent: { data_source_id: fx.ds }, properties: { 담당: { people: [{ id: '0d6c2a52-8b6e-4b57-9a4b-6a1f0c6f0f00' }] } } }), 400, 'validation_error', /담당/)
    assertError(await postPage(member, { parent: { data_source_id: fx.ds }, children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }] }), 400, 'validation_error', /children is not supported yet/)
    assertError(await postPage(member, { parent: { workspace: true }, properties: title('최상위') }), 400, 'validation_error', /top of the workspace/)
    assertError(await postPage(member, { parent: { data_source_id: fx.ds }, template: { type: 'none' } }), 400, 'validation_error', /body\.template should be not present/)
    assertError(await postPage(member, { parent: { data_source_id: 'nope' } }), 400, 'validation_error', /parent\.data_source_id should be a valid uuid/)
    assertError(await postPage(member, { parent: { data_source_id: '0d6c2a52-8b6e-4b57-9a4b-6a1f0c6f0f00' } }), 404, 'object_not_found', /data source/)
    const after = await query<{ n: number }>(`SELECT count(*)::int AS n FROM page WHERE data_source_id = $1`, [fx.ds])
    assert.equal(after[0].n, before[0].n, '거부된 요청은 행을 남기지 않는다')

    // database_id — 소스가 하나면 그 소스에 · 둘이면 400
    const viaDatabase = await postPage(member, { parent: { database_id: fx.table.id }, properties: { title: title('옛 판의 부모') } })
    assert.equal(viaDatabase.status, 200, JSON.stringify(viaDatabase.body))
    assert.equal(dig(viaDatabase.body, 'parent', 'data_source_id'), fx.ds)
    must(await addDataSource(owner.ctx, fx.table.id, { name: '둘째' }), '둘째 소스')
    assertError(await postPage(member, { parent: { database_id: fx.table.id }, properties: {} }), 400, 'validation_error', /has 2 data sources/)
  })
})

describe('PATCH /v1/pages/{id}', () => {
  test('★ 칸 · 제목 · 아이콘 · 커버 · 휴지통 · 되살리기 · 고친 사람은 토큰의 사람', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('고치기')
    const fx = await richTable(owner, member)
    const r = await patchPage(member, fx.row, {
      properties: { 점수: { number: 50 }, title: title('고친 일'), 완료: { checkbox: false }, 관련: { relation: [{ id: fx.targets[0] }] }, 메모: { rich_text: [] } },
      icon: { emoji: '✅' },
    })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const p = (name: string, ...rest: (string | number)[]) => dig(r.body, 'properties', name, ...rest)
    assert.equal(p('점수', 'number'), 50)
    assert.equal(p('완료', 'checkbox'), false)
    assert.deepEqual(p('관련', 'relation'), [{ id: fx.targets[0] }], 'relation 은 통째로 바뀐다')
    assert.deepEqual(p('합', 'rollup'), { type: 'number', number: 5, function: 'sum' })
    assert.deepEqual(p('메모', 'rich_text'), [])
    assert.deepEqual(dig(r.body, 'icon'), { type: 'emoji', emoji: '✅' })
    assert.deepEqual(dig(r.body, 'last_edited_by'), { object: 'user', id: member.userId })
    const titleName = Object.entries(dig(r.body, 'properties') as Record<string, unknown>).find(([, v]) => dig(v, 'type') === 'title')![0]
    assert.equal(plainOf(p(titleName, 'title')), '고친 일')

    assertError(await patchPage(member, fx.row, { properties: { 모르는: { number: 1 } } }), 400, 'validation_error', /모르는 is not a property that exists/)
    assertError(await patchPage(member, fx.row, { properties: { 점수: { number: 'x' } } }), 400, 'validation_error', /점수\.number should be a number/)
    assertError(await patchPage(member, fx.row, { foo: 1 }), 400, 'validation_error', /body\.foo should be not present/)

    // 휴지통 · 되살리기 — 행
    const trashed = await patchPage(member, fx.row, { in_trash: true })
    assert.equal(dig(trashed.body, 'in_trash'), true)
    assert.equal(dig((await getPage(member, fx.row)).body, 'in_trash'), true, '휴지통의 페이지도 읽힌다(in_trash)')
    assertError(await patchPage(member, fx.row, { properties: { 점수: { number: 1 } } }), 400, 'validation_error', /in trash/)
    const restored = await patchPage(member, fx.row, { in_trash: false, properties: { 점수: { number: 51 } } })
    assert.equal(restored.status, 200, JSON.stringify(restored.body))
    assert.equal(dig(restored.body, 'in_trash'), false)
    assert.equal(dig(restored.body, 'properties', '점수', 'number'), 51)

    // 보통 페이지 — 제목 · 커버 지우기 · 휴지통(옛 이름 archived) · 되살리기
    const page = await createPage(owner.ctx, { title: [textRun('보통')] })
    const renamed = await patchPage(member, page.id, { properties: { title: { title: [{ text: { content: '새 이름', link: { url: 'https://example.com' } } }] } }, cover: null })
    assert.equal(plainOf(dig(renamed.body, 'properties', 'title', 'title')), '새 이름')
    assert.equal(dig(renamed.body, 'properties', 'title', 'title', 0, 'href'), 'https://example.com')
    assert.equal(dig(renamed.body, 'cover'), null)
    assertError(await patchPage(member, page.id, { properties: { Name: title('x') } }), 400, 'validation_error', /Name is not a property that exists/)
    assert.equal(dig((await patchPage(member, page.id, { archived: true })).body, 'in_trash'), true)
    assert.equal(dig((await patchPage(member, page.id, { in_trash: false })).body, 'in_trash'), false)
  })

  test('★ 잠긴 페이지 400 · 볼 수만 있는 사람 403 · 못 보면 404', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await workspace('잠금')
    const page = await createPage(owner.ctx, { title: [textRun('잠글 것')] })
    must(await setPageLock(owner.ctx, page.id, true), '잠금')
    assertError(await patchPage(member, page.id, { properties: title('바꿈') }), 400, 'validation_error', /locked/)
    assertError(await patchPage(member, page.id, { icon: { emoji: '🔒' } }), 400, 'validation_error', /locked/)
    must(await setPageLock(owner.ctx, page.id, false), '풀기')
    assert.equal((await patchPage(member, page.id, { properties: title('바꿈') })).status, 200)

    const reader = await withToken(await joinAs(ws, await createUser('읽기만'), 'member'))
    const secret = await createPage(owner.ctx, { title: [textRun('비밀')], privateTop: true })
    must(await grantAccess(owner.ctx, secret.id, { type: 'user', id: reader.userId }, 'view'), '보기')
    assert.equal((await getPage(reader, secret.id)).status, 200)
    assertError(await patchPage(reader, secret.id, { properties: title('안 됨') }), 403, 'restricted_resource')
    assertError(await patchPage(reader, secret.id, { in_trash: true }), 403, 'restricted_resource')
    assertError(await patchPage(member, secret.id, { properties: title('안 됨') }), 404, 'object_not_found')
    assert.equal(plainOf(dig((await getPage(owner, secret.id)).body, 'properties', 'title', 'title')), '비밀', '거부된 쓰기는 아무것도 바꾸지 않는다')
  })
})
