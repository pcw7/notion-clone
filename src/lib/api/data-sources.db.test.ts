/**
 * 공개 API 의 데이터베이스 · 데이터 소스 · 질의 — 라우트 수준 (API-4 · F-09-01 · F-09-04 · F-09-16 · F-09-17 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑤ ⑧ · 공개 API 투영 규칙 · 09 F-09-16
 *
 * 라우트 파일은 `v1Route(handler)` 한 줄이라 같은 것을 여기서 만들어 `Request` 로 부른다(`pages.db.test.ts` 와 같다). 실제 서버 · 브라우저로는
 * e2e '공개 API — 데이터 소스 · 질의 (API-4 · F-09-16)' 가 본다.
 *
 *   ★ GET 데이터베이스 — 모양 · 제목 · 부모 · 소스가 하나면 그 이름은 제목 · 둘이면 저마다 · 볼 수 없는 원본의 붙인 소스는 빠진다 · 휴지통 ·
 *     페이지 id 는 404 · 데이터 소스 id 는 404 + 바른 주소 · 고치기는 400
 *   ★ GET 데이터 소스 — 모든 타입의 스키마 · 부모 · database_parent · 스키마의 id 가 property item 과 필터에 그대로 · 데이터베이스 id 는 404 + 바른 주소
 *   ★ 질의 — 타입 계열마다 필터 · and/or 겹침 · 정렬(속성 · timestamp) · 커서로 쪽을 넘긴다(빠짐 · 겹침 없음) · 다른 질의의 커서는 400 ·
 *     filter_properties · 휴지통 행은 in_trash 로만 · rollup 필터는 400
 *   ★ 행 단위 권한 — 볼 수 없는 행은 소리 없이 빠진다(그 행만 맞는 필터도 빈 결과) · 소유자는 본다
 *   ★ 내보내기 정책을 끄면 멤버는 403 · 볼 수 없는 표는 404 · 10,000 상한(상한을 낮춘 라우트로) — has_more:false + request_status
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { textRun } from '../contracts/rich-text.ts'
import { createPage } from '../block/page.ts'
import { trashPage } from '../block/trash.ts'
import { createDatabase } from '../database/database.ts'
import { addDataSource, attachLinkedDataSource } from '../database/data-source.ts'
import { todayIn } from '../database/date-group.ts'
import { addFormulaProperty } from '../database/formula-property.ts'
import { addProperty, addSelectOption, getSchema } from '../database/property.ts'
import { addRelationProperty, linkRows } from '../database/relation.ts'
import { addRollupProperty } from '../database/rollup.ts'
import { createRow, trashRow, type RowCell } from '../database/row.ts'
import { verifyRow } from '../database/verification.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { withTransaction } from '../db/tx.ts'
import { asBlockId } from '../ids.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { reset } from '../rate-limit.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { writeExportPolicyIn } from '../workspace/security-policy.ts'
import { createApiToken } from './api-token.ts'
import { makeQueryDataSource, queryDataSource, retrieveDataSource, retrieveDatabase, unsupportedSchemaWrite } from './data-sources.ts'
import { retrievePageProperty } from './pages.ts'
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
  const made = await createApiToken(actor.ctx, { name: 'API-4 시험' })
  if (!made.ok) throw new Error(made.reason)
  return { ...actor, api: made.value.token, apiId: made.value.summary.id }
}

const ROUTES = {
  getDatabase: v1Route(retrieveDatabase),
  patchDatabase: v1Route(unsupportedSchemaWrite),
  getSource: v1Route(retrieveDataSource),
  query: v1Route(queryDataSource),
  queryCapped: v1Route(makeQueryDataSource({ cap: 3 })),
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

const getDatabase = (who: Caller, id: string) => call(who, 'getDatabase', 'GET', `/v1/databases/${id}`, { database_id: id })
const getSource = (who: Caller, id: string) => call(who, 'getSource', 'GET', `/v1/data_sources/${id}`, { data_source_id: id })
const query = (who: Caller, id: string, body?: unknown, search = '', route: 'query' | 'queryCapped' = 'query') =>
  call(who, route, 'POST', `/v1/data_sources/${id}/query${search}`, { data_source_id: id }, body)

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

const plainOf = (runs: unknown) => (Array.isArray(runs) ? runs.map((r) => String(dig(r, 'plain_text'))).join('') : null)

/** 질의 결과의 제목들 — 차례 그대로. */
function titles(r: Reply): string[] {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const results = dig(r.body, 'results') as unknown[]
  return results.map((page) => {
    const title = Object.values(dig(page, 'properties') as Record<string, unknown>).find((v) => dig(v, 'type') === 'title')
    return plainOf(dig(title, 'title')) ?? ''
  })
}

const sorted = (list: string[]) => [...list].sort()

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

/**
 * 질의할 표 — 워크스페이스 최상위(모두가 본다) · 모든 타입 · 행 다섯(A~E). 기한은 A 가 3월 1일 · B 가 4월 10일 · E 가 오늘(UTC) · C · D 는 없다.
 * 만든 차례가 A → E 라 고유 ID 는 1~5 다.
 */
async function queryTable(owner: Caller, member: Caller) {
  const target = must(await createDatabase(owner.ctx, { name: '대상 표' }), '대상 표')
  const targetSchema = must(await getSchema(owner.ctx, target.dataSourceId), '대상 스키마')
  const targetTitle = targetSchema.properties.find((p) => p.type === 'title')!.id
  must(await addProperty(owner.ctx, target.dataSourceId, { name: '값', type: 'number' }), '값')
  const valueId = must(await getSchema(owner.ctx, target.dataSourceId), '대상 스키마').properties.find((p) => p.name === '값')!.id
  const t0 = must(
    await createRow(owner.ctx, target.dataSourceId, {
      cells: [
        { propertyId: targetTitle, value: { type: 'title', title: [textRun('대상 0')] } },
        { propertyId: valueId, value: { type: 'number', number: 7 } },
      ],
    }),
    '대상 행',
  ).id

  const table = must(await createDatabase(owner.ctx, { name: '질의 표' }), '표')
  const ds = table.dataSourceId
  must(await addProperty(owner.ctx, ds, { name: '번호', type: 'unique_id', prefix: 'QRY' }), '번호')
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
    ['파일', 'files'],
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
  const bug = must(await addSelectOption(owner.ctx, ds, id('종류'), { name: '버그', color: 'red' }), '버그').option
  const feature = must(await addSelectOption(owner.ctx, ds, id('종류'), { name: '기능', color: 'blue' }), '기능').option
  const urgent = must(await addSelectOption(owner.ctx, ds, id('태그'), { name: '급함', color: 'orange' }), '급함').option
  schema = must(await getSchema(owner.ctx, ds), '스키마')
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const statusOptions = schema.properties.find((p) => p.name === '상태')!.options ?? []
  const today = todayIn('UTC')

  const row = async (title: string, cells: RowCell[]) =>
    must(await createRow(owner.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }, ...cells] }), title).id
  const num = (n: number): RowCell => ({ propertyId: id('점수'), value: { type: 'number', number: n } })
  const kind = (o: { id: string }): RowCell => ({ propertyId: id('종류'), value: { type: 'select', select: { id: o.id } } })
  const done = (b: boolean): RowCell => ({ propertyId: id('완료'), value: { type: 'checkbox', checkbox: b } })
  const due = (start: string): RowCell => ({ propertyId: id('기한'), value: { type: 'date', date: { start } } })
  const memo = (text: string): RowCell => ({ propertyId: id('메모'), value: { type: 'rich_text', rich_text: [textRun(text)] } })
  const who = (userId: string): RowCell => ({ propertyId: id('담당'), value: { type: 'people', people: [{ id: userId }] } })

  const rows = {
    A: await row('A 하나', [num(1), kind(bug), done(true), due('2026-03-01'), memo('사과'), who(member.userId),
      { propertyId: id('태그'), value: { type: 'multi_select', multi_select: [{ id: urgent.id }] } }]),
    B: await row('B 둘', [num(5), kind(feature), done(false), due('2026-04-10'), memo('바나나')]),
    C: await row('C 셋', [num(3), kind(bug), done(true), memo('사과 파이'), who(owner.userId)]),
    D: await row('D 넷', []),
    E: await row('E 다섯', [num(10), due(today)]),
  }
  must(await linkRows(owner.ctx, rows.A, relation, { add: [t0] }), '연결')
  must(await verifyRow(owner.ctx, rows.B, id('검증'), null), '검증')
  return { table, ds, id, titleId, rows, t0, relation, bug, feature, urgent, statusOptions, target, valueId }
}

// ── 데이터베이스 ──────────────────────────────────────────────────────

describe('GET /v1/databases/{id}', () => {
  test('★ 모양 · 제목 · 부모 · 소스가 하나면 그 이름은 제목 · 둘이면 저마다 · 대시 없는 id', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await workspace('데이터베이스 읽기')
    const table = must(await createDatabase(owner.ctx, { name: '할 일 표' }), '표')
    const r = await getDatabase(member, table.id.replace(/-/g, ''))
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual(Object.keys(r.body as object), [
      'object', 'id', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'title', 'description', 'icon', 'cover', 'parent',
      'is_inline', 'in_trash', 'data_sources', 'url', 'public_url',
    ])
    assert.equal(dig(r.body, 'object'), 'database')
    assert.equal(dig(r.body, 'id'), table.id)
    assert.equal(plainOf(dig(r.body, 'title')), '할 일 표')
    assert.deepEqual(dig(r.body, 'description'), [])
    assert.deepEqual(dig(r.body, 'parent'), { type: 'workspace', workspace: true })
    assert.deepEqual(dig(r.body, 'created_by'), { object: 'user', id: owner.userId })
    assert.equal(typeof dig(r.body, 'is_inline'), 'boolean')
    assert.equal(dig(r.body, 'in_trash'), false)
    assert.equal(dig(r.body, 'public_url'), null)
    assert.match(String(dig(r.body, 'url')), new RegExp(`/w/${ws}/db/${table.id}$`))
    assert.deepEqual(dig(r.body, 'data_sources'), [{ id: table.dataSourceId, name: '할 일 표' }], '소스가 하나면 그 이름은 데이터베이스의 제목')

    const second = must(await addDataSource(owner.ctx, table.id, { name: '두 번째' }), '둘째').dataSource
    const two = await getDatabase(member, table.id)
    assert.deepEqual(dig(two.body, 'data_sources'), [
      { id: table.dataSourceId, name: '할 일 표' },
      { id: second.id, name: '두 번째' },
    ])
  })

  test('★ 볼 수 없는 원본의 붙인 소스는 빠진다 · 소유자는 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('붙인 소스')
    const secret = must(await createDatabase(owner.ctx, { name: '비밀 표', privateTop: true }), '비밀 표')
    const shared = must(await createDatabase(owner.ctx, { name: '모두의 표' }), '모두의 표')
    must(await attachLinkedDataSource(owner.ctx, shared.id, { dataSourceId: secret.dataSourceId }), '붙이기')
    const ids = (r: Reply) => (dig(r.body, 'data_sources') as { id: string }[]).map((s) => s.id)
    assert.deepEqual(ids(await getDatabase(member, shared.id)), [shared.dataSourceId])
    assert.deepEqual(ids(await getDatabase(owner, shared.id)), [shared.dataSourceId, secret.dataSourceId])
    assertError(await getSource(member, secret.dataSourceId), 404, 'object_not_found', /Could not find data source/)
  })

  test('★ 휴지통 · 400 · 페이지 id 는 404 · 데이터 소스 id 는 404 + 바른 주소 · 볼 수 없으면 404 · 고치기는 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('데이터베이스 거부')
    const table = must(await createDatabase(owner.ctx, { name: '버릴 표' }), '표')
    const page = await createPage(owner.ctx, { title: [textRun('페이지')] })
    const secret = must(await createDatabase(owner.ctx, { name: '비밀', privateTop: true }), '비밀')

    assertError(await getDatabase(member, 'nope'), 400, 'validation_error', /path\.database_id should be a valid uuid/)
    assertError(await getDatabase(member, page.id), 404, 'object_not_found', new RegExp(`^Could not find database with ID: ${page.id}\\.$`))
    assertError(await getDatabase(member, table.dataSourceId), 404, 'object_not_found', /This is a data source ID — use \/v1\/data_sources\//)
    assertError(await getDatabase(member, secret.id), 404, 'object_not_found', /^Could not find database with ID: [0-9a-f-]+\.$/)
    assertError(
      await call(owner, 'patchDatabase', 'PATCH', `/v1/databases/${table.id}`, { database_id: table.id }, { title: [] }),
      400,
      'validation_error',
      /not supported by this API/,
    )

    await trashPage(owner.ctx, asBlockId(table.id))
    const trashed = await getDatabase(member, table.id)
    assert.equal(trashed.status, 200, JSON.stringify(trashed.body))
    assert.equal(dig(trashed.body, 'in_trash'), true)
  })
})

// ── 데이터 소스 ───────────────────────────────────────────────────────

describe('GET /v1/data_sources/{id}', () => {
  test('★ 모든 타입의 스키마 · 부모 · database_parent · 제목', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('소스 읽기')
    const fx = await queryTable(owner, member)
    const r = await getSource(member, fx.ds)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(dig(r.body, 'object'), 'data_source')
    assert.equal(dig(r.body, 'id'), fx.ds)
    assert.deepEqual(dig(r.body, 'parent'), { type: 'database_id', database_id: fx.table.id })
    assert.deepEqual(dig(r.body, 'database_parent'), { type: 'workspace', workspace: true })
    assert.equal(plainOf(dig(r.body, 'title')), '질의 표')
    assert.equal(dig(r.body, 'in_trash'), false)
    const props = dig(r.body, 'properties') as Record<string, Record<string, unknown>>
    const titleName = Object.keys(props).find((k) => props[k].type === 'title')!
    assert.deepEqual(props[titleName], { id: 'title', name: titleName, type: 'title', title: {} })
    assert.deepEqual(props['점수'], { id: fx.id('점수'), name: '점수', type: 'number', number: { format: 'number' } })
    assert.deepEqual(props['종류'].select, { options: [{ id: fx.bug.id, name: '버그', color: 'red' }, { id: fx.feature.id, name: '기능', color: 'blue' }] })
    assert.deepEqual(props['태그'].multi_select, { options: [{ id: fx.urgent.id, name: '급함', color: 'orange' }] })
    const status = props['상태'].status as { options: { id: string }[]; groups: { name: string; option_ids: string[] }[] }
    assert.deepEqual(status.options.map((o) => o.id), fx.statusOptions.map((o) => o.id))
    assert.deepEqual(status.groups.map((g) => g.name), ['To-do', 'In progress', 'Complete'])
    assert.deepEqual(status.groups.flatMap((g) => g.option_ids).sort(), fx.statusOptions.map((o) => o.id).sort())
    assert.deepEqual(props['번호'].unique_id, { prefix: 'QRY' })
    assert.deepEqual(props['두배'].formula, { expression: 'prop("점수") * 2' })
    assert.deepEqual(props['관련'].relation, { data_source_id: fx.target.dataSourceId, type: 'single_property', single_property: {} })
    assert.deepEqual(props['합'].rollup, {
      relation_property_id: fx.relation,
      relation_property_name: '관련',
      rollup_property_id: fx.valueId,
      rollup_property_name: '값',
      function: 'sum',
    })
    for (const [name, type] of [
      ['기한', 'date'], ['담당', 'people'], ['주소', 'url'], ['메일', 'email'], ['전화', 'phone_number'], ['장소', 'place'], ['메모', 'rich_text'],
      ['파일', 'files'], ['완료', 'checkbox'], ['만든 시각', 'created_time'], ['만든 사람', 'created_by'], ['고친 시각', 'last_edited_time'],
      ['고친 사람', 'last_edited_by'], ['검증', 'verification'],
    ] as const) {
      assert.deepEqual(props[name], { id: fx.id(name), name, type, [type]: {} }, name)
    }
  })

  test('★ 스키마의 id 가 property item 과 필터에 그대로 듣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('소스 id')
    const fx = await queryTable(owner, member)
    const props = dig((await getSource(member, fx.ds)).body, 'properties') as Record<string, { id: string }>
    const scoreId = props['점수'].id
    const item = await call(member, 'getProperty', 'GET', `/v1/pages/${fx.rows.B}/properties/${scoreId}`, { page_id: fx.rows.B, property_id: scoreId })
    assert.deepEqual(item.body, { object: 'property_item', id: scoreId, type: 'number', number: 5 })
    assert.deepEqual(sorted(titles(await query(member, fx.ds, { filter: { property: scoreId, number: { greater_than: 4 } } }))), ['B 둘', 'E 다섯'])
    assert.deepEqual(titles(await query(member, fx.ds, { filter: { property: 'title', title: { equals: 'c 셋' } } })), ['C 셋'])
  })

  test('★ 데이터베이스 id 는 404 + 바른 주소 · 페이지 id 는 그냥 404 · 고치기는 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('소스 거부')
    const table = must(await createDatabase(owner.ctx, { name: '표' }), '표')
    const page = await createPage(owner.ctx, { title: [textRun('페이지')] })
    assertError(await getSource(member, table.id), 404, 'object_not_found', /This is a database ID — retrieve the database \(GET \/v1\/databases\/.+\) and use one of its data_sources\[\]\.id/)
    assertError(await query(member, table.id, {}), 404, 'object_not_found', /This is a database ID/)
    assertError(await getSource(member, page.id), 404, 'object_not_found', /^Could not find data source with ID: [0-9a-f-]+\.$/)
    assertError(await getSource(member, 'x'), 400, 'validation_error', /path\.data_source_id should be a valid uuid/)
  })
})

// ── 질의 ──────────────────────────────────────────────────────────────

describe('POST /v1/data_sources/{id}/query', () => {
  test('★ 타입 계열마다 필터 — 앱의 필터와 같은 뜻(빈 칸은 같지 않음에 걸린다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('질의 필터')
    const fx = await queryTable(owner, member)
    const q = async (filter: unknown) => sorted(titles(await query(member, fx.ds, { filter })))
    const all = ['A 하나', 'B 둘', 'C 셋', 'D 넷', 'E 다섯']

    const envelope = await query(member, fx.ds, {})
    assert.deepEqual(Object.keys(envelope.body as object), ['object', 'results', 'next_cursor', 'has_more', 'type', 'page_or_data_source'])
    assert.equal(dig(envelope.body, 'object'), 'list')
    assert.equal(dig(envelope.body, 'type'), 'page_or_data_source')
    assert.deepEqual(dig(envelope.body, 'page_or_data_source'), {})
    assert.equal(dig(envelope.body, 'has_more'), false)
    assert.equal(dig(envelope.body, 'next_cursor'), null)
    assert.deepEqual(titles(envelope), all, '정렬이 없으면 표의 차례')
    const first = (dig(envelope.body, 'results') as unknown[])[0]
    assert.equal(dig(first, 'object'), 'page')
    assert.deepEqual(dig(first, 'parent'), { type: 'data_source_id', data_source_id: fx.ds, database_id: fx.table.id })
    assert.deepEqual(dig(first, 'properties', '관련', 'relation'), [{ id: fx.t0 }])
    assert.equal(dig(first, 'properties', '합', 'rollup', 'number'), 7)
    assert.equal(dig(first, 'properties', '두배', 'formula', 'number'), 2)

    assert.deepEqual(await q({ property: '점수', number: { greater_than: 2 } }), ['B 둘', 'C 셋', 'E 다섯'])
    assert.deepEqual(await q({ property: '점수', number: { is_empty: true } }), ['D 넷'])
    assert.deepEqual(await q({ property: '메모', rich_text: { contains: '사과' } }), ['A 하나', 'C 셋'])
    assert.deepEqual(await q({ property: '메모', rich_text: { does_not_contain: '사과' } }), ['B 둘', 'D 넷', 'E 다섯'])
    assert.deepEqual(await q({ property: 'title', title: { starts_with: 'a' } }), ['A 하나'])
    assert.deepEqual(await q({ property: '완료', checkbox: { equals: true } }), ['A 하나', 'C 셋'])
    assert.deepEqual(await q({ property: '완료', checkbox: { does_not_equal: true } }), ['B 둘', 'D 넷', 'E 다섯'])
    assert.deepEqual(await q({ property: '종류', select: { equals: '버그' } }), ['A 하나', 'C 셋'])
    assert.deepEqual(await q({ property: '종류', select: { does_not_equal: '버그' } }), ['B 둘', 'D 넷', 'E 다섯'])
    assert.deepEqual(await q({ property: '종류', select: { equals: '없는 옵션' } }), [])
    assert.deepEqual(await q({ property: '상태', status: { equals: fx.statusOptions[0].name } }), all, '새 행은 기본 상태')
    assert.deepEqual(await q({ property: '태그', multi_select: { contains: '급함' } }), ['A 하나'])
    assert.deepEqual(await q({ property: '태그', multi_select: { is_empty: true } }), ['B 둘', 'C 셋', 'D 넷', 'E 다섯'])
    assert.deepEqual(await q({ property: '기한', date: { before: '2026-04-01' } }), ['A 하나'])
    assert.deepEqual(await q({ property: '기한', date: { is_empty: true } }), ['C 셋', 'D 넷'])
    assert.deepEqual(await q({ property: '기한', date: { past_week: {} } }), ['E 다섯'], '상대 날짜 — 오늘(UTC)')
    assert.deepEqual(await q({ property: '담당', people: { contains: 'me' } }), ['A 하나'], '"me" 는 토큰의 사람')
    assert.deepEqual(await q({ property: '담당', people: { is_empty: true } }), ['B 둘', 'D 넷', 'E 다섯'])
    assert.deepEqual(await q({ property: '관련', relation: { contains: fx.t0.replace(/-/g, '') } }), ['A 하나'])
    assert.deepEqual(await q({ property: '관련', relation: { is_empty: true } }), ['B 둘', 'C 셋', 'D 넷', 'E 다섯'])
    assert.deepEqual(await q({ property: '파일', files: { is_empty: true } }), all)
    assert.deepEqual(await q({ property: '번호', unique_id: { greater_than: 3 } }), ['D 넷', 'E 다섯'])
    assert.deepEqual(await q({ property: '검증', verification: { status: 'verified' } }), ['B 둘'])
    assert.deepEqual(await q({ property: '두배', formula: { number: { greater_than: 6 } } }), ['B 둘', 'E 다섯'])
    assert.deepEqual(await q({ property: '만든 사람', created_by: { contains: owner.userId } }), all)
    assert.deepEqual(await q({ property: '만든 시각', created_time: { on_or_after: todayIn('UTC') } }), all)
    assert.deepEqual(await q({ timestamp: 'created_time', created_time: { past_week: {} } }), all, 'timestamp — 속성 없이')
    assert.deepEqual(await q({ timestamp: 'last_edited_time', last_edited_time: { before: '2020-01-01' } }), [])

    // and · or 겹침
    assert.deepEqual(
      await q({ and: [{ property: '완료', checkbox: { equals: true } }, { or: [{ property: '점수', number: { greater_than: 2 } }, { property: '메모', rich_text: { contains: '바' } }] }] }),
      ['C 셋'],
    )
    assert.deepEqual(await q({ or: [{ property: '종류', select: { equals: '기능' } }, { property: '기한', date: { past_week: {} } }] }), ['B 둘', 'E 다섯'])

    // 거부 — rollup · 세 겹 · 없는 속성 · 모르는 키
    assertError(await query(member, fx.ds, { filter: { property: '합', rollup: { number: { greater_than: 1 } } } }), 400, 'validation_error', /rollup property is not supported.*"합"/)
    assertError(
      await query(member, fx.ds, { filter: { and: [{ or: [{ and: [{ property: '완료', checkbox: { equals: true } }] }] }] } }),
      400,
      'validation_error',
      /nested too deeply/,
    )
    assertError(await query(member, fx.ds, { filter: { property: '없음', number: { equals: 1 } } }), 400, 'validation_error', /^Could not find property with name or id: 없음$/)
    assertError(await query(member, fx.ds, { limit: 3 }), 400, 'validation_error', /body\.limit should be not present/)
    assertError(await query(member, fx.ds, { page_size: 101 }), 400, 'validation_error', /page_size should be a number between 1 and 100/)
  })

  test('★ 정렬 — 속성 · timestamp · 우선순위 · 빈 칸은 맨 뒤', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('질의 정렬')
    const fx = await queryTable(owner, member)
    assert.deepEqual(titles(await query(member, fx.ds, { sorts: [{ property: '점수', direction: 'descending' }] })), ['E 다섯', 'B 둘', 'C 셋', 'A 하나', 'D 넷'])
    assert.deepEqual(titles(await query(member, fx.ds, { sorts: [{ timestamp: 'created_time', direction: 'descending' }] })), ['E 다섯', 'D 넷', 'C 셋', 'B 둘', 'A 하나'])
    assert.deepEqual(
      titles(await query(member, fx.ds, { sorts: [{ property: '종류', direction: 'ascending' }, { property: '점수', direction: 'descending' }] })),
      ['C 셋', 'A 하나', 'B 둘', 'E 다섯', 'D 넷'],
      '버그(옵션 차례 첫째) 안은 점수 내림차순 · 빈 칸은 맨 뒤',
    )
    assertError(await query(member, fx.ds, { sorts: [{ property: '담당', direction: 'ascending' }] }), 400, 'validation_error', /Sorting by a people property/)
    assertError(await query(member, fx.ds, { sorts: [{ property: '없음', direction: 'ascending' }] }), 400, 'validation_error', /Could not find sort property/)
  })

  test('★ 커서로 쪽을 넘긴다 — 빠짐 · 겹침 없음 · 다른 질의의 커서는 400 · 모양이 틀린 커서는 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('질의 커서')
    const fx = await queryTable(owner, member)
    const body = { sorts: [{ property: '점수', direction: 'ascending' }], page_size: 2 }
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const r = await query(member, fx.ds, cursor === null ? body : { ...body, start_cursor: cursor })
      seen.push(...titles(r))
      cursor = dig(r.body, 'next_cursor') as string | null
      assert.equal(dig(r.body, 'has_more'), cursor !== null)
      assert.equal(dig(r.body, 'request_status'), undefined, '상한에 닿지 않으면 request_status 가 없다')
      pages += 1
    } while (cursor !== null && pages < 10)
    assert.equal(pages, 3)
    assert.deepEqual(seen, ['A 하나', 'C 셋', 'B 둘', 'E 다섯', 'D 넷'])

    const firstPage = await query(member, fx.ds, body)
    const next = dig(firstPage.body, 'next_cursor') as string
    assertError(
      await query(member, fx.ds, { sorts: [{ property: '점수', direction: 'descending' }], start_cursor: next }),
      400,
      'validation_error',
      /start_cursor does not belong to this query/,
    )
    assertError(await query(member, fx.ds, { ...body, filter: { property: '완료', checkbox: { equals: true } }, start_cursor: next }), 400, 'validation_error')
    assertError(await query(member, fx.ds, { ...body, start_cursor: 'garbage!' }), 400, 'validation_error', /start_cursor should be a cursor/)
    // 이름으로 준 질의와 id 로 준 질의는 같은 질의다
    const byId = await query(member, fx.ds, { sorts: [{ property: fx.id('점수'), direction: 'ascending' }], page_size: 2, start_cursor: next })
    assert.deepEqual(titles(byId), ['B 둘', 'E 다섯'])
  })

  test('★ filter_properties — 준 속성만(이름 · id) · 모르는 것은 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('질의 속성')
    const fx = await queryTable(owner, member)
    const r = await query(member, fx.ds, {}, `?filter_properties=${encodeURIComponent(fx.id('점수'))}&filter_properties=title`)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const props = dig((dig(r.body, 'results') as unknown[])[1], 'properties') as Record<string, { id: string }>
    assert.deepEqual(Object.values(props).map((p) => p.id), ['title', fx.id('점수')])
    assert.equal(dig(Object.values(props)[1], 'number'), 5)
    const byName = await query(member, fx.ds, {}, `?filter_properties=${encodeURIComponent('메모')}`)
    assert.deepEqual(Object.keys(dig((dig(byName.body, 'results') as unknown[])[0], 'properties') as object), ['메모'])
    assertError(await query(member, fx.ds, {}, '?filter_properties=nope'), 400, 'validation_error', /filter_properties.*nope/)
  })

  test('★ 휴지통의 행은 in_trash(is_archived) 로만 · 빠지면 기본 질의에 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('질의 휴지통')
    const fx = await queryTable(owner, member)
    must(await trashRow(owner.ctx, fx.rows.D), '휴지통')
    assert.deepEqual(titles(await query(member, fx.ds, {})), ['A 하나', 'B 둘', 'C 셋', 'E 다섯'])
    const trashed = await query(member, fx.ds, { in_trash: true })
    assert.deepEqual(titles(trashed), ['D 넷'])
    assert.equal(dig((dig(trashed.body, 'results') as unknown[])[0], 'in_trash'), true)
    assert.deepEqual(titles(await query(member, fx.ds, { is_archived: true })), ['D 넷'])
    assertError(await query(member, fx.ds, { in_trash: true, is_archived: false }), 400, 'validation_error')
    assert.deepEqual(titles(await query(member, fx.ds, { result_type: 'data_source' })), [], '데이터 소스 밑의 데이터 소스는 없다')
  })

  test('★ 행 단위 권한 — 볼 수 없는 행은 소리 없이 빠진다(그 행만 맞는 필터도 빈 결과) · 소유자는 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('질의 행 권한')
    const table = must(await createDatabase(owner.ctx, { name: '개인 표', privateTop: true }), '개인 표')
    must(await grantAccess(owner.ctx, table.id, { type: 'user', id: member.userId }, 'edit'), '공유')
    const titleId = must(await getSchema(owner.ctx, table.dataSourceId), '스키마').properties.find((p) => p.type === 'title')!.id
    const rows: string[] = []
    for (const name of ['보임 1', '숨김', '보임 2']) {
      rows.push(must(await createRow(owner.ctx, table.dataSourceId, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(name)] } }] }), name).id)
    }
    must(await stopInheriting(owner.ctx, rows[1]), '끊기')
    must(await revokeAccess(owner.ctx, rows[1], { type: 'user', id: member.userId }), '빼기')

    assert.deepEqual(titles(await query(member, table.dataSourceId, {})), ['보임 1', '보임 2'])
    assert.deepEqual(titles(await query(member, table.dataSourceId, { filter: { property: 'title', title: { equals: '숨김' } } })), [])
    const paged = await query(member, table.dataSourceId, { page_size: 1 })
    assert.equal(dig(paged.body, 'has_more'), true)
    const rest = await query(member, table.dataSourceId, { page_size: 1, start_cursor: dig(paged.body, 'next_cursor') })
    assert.deepEqual([...titles(paged), ...titles(rest)], ['보임 1', '보임 2'])
    assert.deepEqual(titles(await query(owner, table.dataSourceId, {})), ['보임 1', '숨김', '보임 2'])
  })

  test('★ 내보내기 정책을 끄면 멤버는 403(세 주소 모두) · 소유자는 그대로 · 볼 수 없는 표는 404', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await workspace('질의 정책')
    const table = must(await createDatabase(owner.ctx, { name: '표' }), '표')
    const secret = must(await createDatabase(owner.ctx, { name: '비밀', privateTop: true }), '비밀')
    await withTransaction((tx) => writeExportPolicyIn(tx, ws, false))
    try {
      assertError(await getDatabase(member, table.id), 403, 'restricted_resource', /security policy/)
      assertError(await getSource(member, table.dataSourceId), 403, 'restricted_resource')
      assertError(await query(member, table.dataSourceId, {}), 403, 'restricted_resource')
      assert.equal((await query(owner, table.dataSourceId, {})).status, 200)
    } finally {
      await withTransaction((tx) => writeExportPolicyIn(tx, ws, true))
    }
    assert.equal((await query(member, table.dataSourceId, {})).status, 200)
    assertError(await getDatabase(member, secret.id), 404, 'object_not_found')
    assertError(await getSource(member, secret.dataSourceId), 404, 'object_not_found')
    assertError(await query(member, secret.dataSourceId, {}), 404, 'object_not_found')
  })

  test('★ 10,000 상한(상한 3 으로 낮춘 라우트) — 닿으면 has_more:false · next_cursor:null · request_status incomplete', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('질의 상한')
    const fx = await queryTable(owner, member)
    const first = await query(member, fx.ds, { page_size: 2 }, '', 'queryCapped')
    assert.deepEqual(titles(first), ['A 하나', 'B 둘'])
    assert.equal(dig(first.body, 'has_more'), true)
    assert.equal(dig(first.body, 'request_status'), undefined)
    const second = await query(member, fx.ds, { page_size: 2, start_cursor: dig(first.body, 'next_cursor') }, '', 'queryCapped')
    assert.deepEqual(titles(second), ['C 셋'], '상한까지만 준다')
    assert.equal(dig(second.body, 'has_more'), false)
    assert.equal(dig(second.body, 'next_cursor'), null)
    assert.deepEqual(dig(second.body, 'request_status'), { type: 'incomplete', incomplete_reason: 'query_result_limit_reached' })
    // 상한 밑에서 끝나면 request_status 가 없다
    const narrow = await query(member, fx.ds, { filter: { property: '완료', checkbox: { equals: true } } }, '', 'queryCapped')
    assert.deepEqual(titles(narrow), ['A 하나', 'C 셋'])
    assert.equal(dig(narrow.body, 'request_status'), undefined)
  })
})
