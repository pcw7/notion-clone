/**
 * 공개 API 의 구조 쓰기 — 데이터베이스 · 데이터 소스 만들기 · 고치기 — 라우트 수준 (API-4b · F-09-01 · F-09-16 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑤ ⑨ · 공개 API 투영 규칙
 *
 * 라우트 파일은 `v1Route(handler)` 한 줄이라 같은 것을 여기서 만들어 `Request` 로 부른다(`data-sources.db.test.ts` 와 같다). 실제 서버 ·
 * 브라우저로는 e2e '공개 API — 데이터베이스 만들기 · 고치기 (API-4b · F-09-01)' 가 본다.
 *
 *   ★ 페이지 밑에 인라인 데이터베이스 + 풍부한 첫 스키마 → GET 이 그대로 · 읽기를 돌려보내면 아무것도 바뀌지 않는다(스키마 판까지)
 *   ★ 설정 고치기 — rollup 함수 · 수식 · 고유 ID 접두사 · 상태 옵션(범주) · relation 대상 바꾸기는 400
 *   ★ 만들기의 거부 — 워크스페이스 최상위 · is_inline:false · 설명 · 커버 · 볼 수만(403) · 못 봄(404) · 잠긴 페이지 · 나쁜 속성은 아무것도 남기지 않는다
 *   ★ 데이터베이스 고치기 — 이름 · 아이콘 · 잠금(잠그면 스키마 쓰기 400 · 풀고 고치기는 한 요청) · is_inline 바꾸기 400 · 휴지통 · 되살리기
 *   ★ 둘째 데이터 소스 — 속성과 함께 · 데이터 소스 id 를 부모로 주면 404 + 바른 주소
 *   ★ 데이터 소스 고치기 — 더하기 · 이름 · 타입 바꾸기(값이 옵션으로) · 옵션(id 로 이름 · 색 · 빠진 것 지우기 → 칸이 빈다) · 지우기 · 제목 이름 ·
 *     소스가 하나면 제목은 데이터베이스의 이름
 *   ★ 한 요청은 통째로 — 뒤의 속성 하나가 거부되면 앞의 이름 바꾸기 · 옵션 지우기도 없다(스키마 판 그대로)
 *   ★ 권한 — 못 봄 404 · 볼 수만 403 · 잠김 400 · 내보내기 정책을 끄면 멤버는 403 · 데이터 소스 휴지통 · 되살리기 · 마지막 소스는 400
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { textRun } from '../contracts/rich-text.ts'
import { createPage } from '../block/page.ts'
import { createDatabase } from '../database/database.ts'
import { addDataSource } from '../database/data-source.ts'
import { addProperty, addSelectOption, getSchema } from '../database/property.ts'
import { createRow } from '../database/row.ts'
import { withTransaction } from '../db/tx.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setDatabaseLock, setPageLock } from '../permissions/lock.ts'
import { reset } from '../rate-limit.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { writeExportPolicyIn } from '../workspace/security-policy.ts'
import { createApiToken } from './api-token.ts'
import { retrieveDataSource, retrieveDatabase } from './data-sources.ts'
import { createApiDataSource, createApiDatabase, updateApiDataSource, updateApiDatabase } from './schema-writes.ts'
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
  const made = await createApiToken(actor.ctx, { name: 'API-4b 시험' })
  if (!made.ok) throw new Error(made.reason)
  return { ...actor, api: made.value.token, apiId: made.value.summary.id }
}

const ROUTES = {
  createDatabase: v1Route(createApiDatabase),
  patchDatabase: v1Route(updateApiDatabase),
  getDatabase: v1Route(retrieveDatabase),
  createSource: v1Route(createApiDataSource),
  patchSource: v1Route(updateApiDataSource),
  getSource: v1Route(retrieveDataSource),
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

const createDb = (who: Caller, body: unknown) => call(who, 'createDatabase', 'POST', '/v1/databases', {}, body)
const patchDb = (who: Caller, id: string, body: unknown) => call(who, 'patchDatabase', 'PATCH', `/v1/databases/${id}`, { database_id: id }, body)
const getDb = (who: Caller, id: string) => call(who, 'getDatabase', 'GET', `/v1/databases/${id}`, { database_id: id })
const createSource = (who: Caller, body: unknown) => call(who, 'createSource', 'POST', '/v1/data_sources', {}, body)
const patchSource = (who: Caller, id: string, body: unknown) => call(who, 'patchSource', 'PATCH', `/v1/data_sources/${id}`, { data_source_id: id }, body)
const getSource = (who: Caller, id: string) => call(who, 'getSource', 'GET', `/v1/data_sources/${id}`, { data_source_id: id })

function dig(value: unknown, ...path: (string | number)[]): unknown {
  let at: unknown = value
  for (const key of path) {
    if (typeof at !== 'object' || at === null) return undefined
    at = (at as Record<string | number, unknown>)[key]
  }
  return at
}

function ok(r: Reply): unknown {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}

function assertError(r: Reply, status: number, code: string, message?: RegExp) {
  assert.equal(r.status, status, JSON.stringify(r.body))
  assert.equal(dig(r.body, 'object'), 'error')
  assert.equal(dig(r.body, 'code'), code)
  if (message) assert.match(String(dig(r.body, 'message')), message)
}

const text = (content: string) => [{ type: 'text', text: { content } }]
const plainOf = (runs: unknown) => (Array.isArray(runs) ? runs.map((r) => String(dig(r, 'plain_text'))).join('') : null)
const must = <T>(r: { ok: boolean; value?: T; reason?: string }, what: string): T => {
  if (!r.ok) throw new Error(`${what} 준비 실패: ${r.reason}`)
  return r.value as T
}
const names = (r: Reply) => Object.keys(dig(r.body, 'properties') as object).sort()
const optionNames = (r: Reply, property: string, type: string) =>
  (dig(r.body, 'properties', property, type, 'options') as { name: string }[]).map((o) => o.name)

async function workspace(name: string) {
  const ws = await createBareWorkspace(name)
  const owner = await withToken(await joinAs(ws, await createUser(`${name} 소유자`), 'owner'))
  const member = await withToken(await joinAs(ws, await createUser(`${name} 멤버`), 'member'))
  return { ws, owner, member }
}

async function schemaVersion(who: Caller, dataSourceId: string): Promise<string> {
  return must(await getSchema(who.ctx, dataSourceId), '스키마').schemaVersion
}

async function databasesUnder(pageId: string): Promise<number> {
  return withTransaction(async (tx) =>
    Number((await tx.queryOne<{ n: string }>(`SELECT count(*) AS n FROM block WHERE parent_id = $1 AND type = 'database'`, [pageId])).n),
  )
}

/** 페이지 밑에 풍부한 첫 스키마로 — 다른 표(프로젝트 · 예산)를 가리키는 양방향 relation 과 그 위의 rollup 까지. */
async function richDatabase(owner: Caller) {
  const page = await createPage(owner.ctx, { title: [textRun('작업 페이지')] })
  const target = must(await createDatabase(owner.ctx, { name: '프로젝트' }), '프로젝트')
  must(await addProperty(owner.ctx, target.dataSourceId, { name: '예산', type: 'number' }), '예산')
  const made = await createDb(owner, {
    parent: { type: 'page_id', page_id: page.id },
    title: text('작업 표'),
    icon: { type: 'emoji', emoji: '📋' },
    is_inline: true,
    initial_data_source: {
      properties: {
        작업: { title: {} },
        점수: { number: { format: 'number' } },
        종류: { select: { options: [{ name: '버그', color: 'red' }, { name: '기능', color: 'blue' }] } },
        단계: { status: { options: [{ name: '대기', group: 'To-do' }, { name: '진행', group: 'In progress' }, { name: '끝', group: 'Complete' }] } },
        태그: { multi_select: { options: [{ name: '급함', color: 'orange' }] } },
        기한: { date: {} },
        완료: { checkbox: {} },
        담당: { people: {} },
        프로젝트: { relation: { data_source_id: target.dataSourceId, dual_property: { synced_property_name: '작업들' } } },
        '예산 합': { rollup: { relation_property_name: '프로젝트', rollup_property_name: '예산', function: 'sum' } },
        두배: { formula: { expression: 'prop("점수") * 2' } },
        번호: { unique_id: { prefix: 'TSK' } },
        메모: { rich_text: {}, description: '자유롭게' },
      },
    },
  })
  const db = ok(made)
  const dataSourceId = String(dig(db, 'data_sources', 0, 'id'))
  return { page, target, db, id: String(dig(db, 'id')), dataSourceId }
}

// ── 데이터베이스 만들기 ───────────────────────────────────────────────

describe('POST /v1/databases', () => {
  test('★ 페이지 밑의 인라인 데이터베이스 + 풍부한 첫 스키마 → GET 이 그대로 · 읽기를 돌려보내면 아무것도 바뀌지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace('데이터베이스 만들기')
    const { page, target, db, dataSourceId } = await richDatabase(owner)
    assert.equal(dig(db, 'object'), 'database')
    assert.equal(plainOf(dig(db, 'title')), '작업 표')
    assert.deepEqual(dig(db, 'parent'), { type: 'page_id', page_id: page.id })
    assert.equal(dig(db, 'is_inline'), true)
    assert.deepEqual(dig(db, 'icon'), { type: 'emoji', emoji: '📋' })
    assert.equal((dig(db, 'data_sources') as unknown[]).length, 1)
    assert.equal(await databasesUnder(page.id), 1, '페이지 본문 안에 놓였다')

    const ds = await getSource(owner, dataSourceId)
    assert.deepEqual(names(ds), ['기한', '단계', '담당', '두배', '메모', '번호', '예산 합', '완료', '작업', '점수', '종류', '태그', '프로젝트'].sort())
    assert.equal(dig(ds.body, 'properties', '작업', 'id'), 'title', '요청의 제목 타입 속성은 함께 생긴 제목이다')
    assert.deepEqual(optionNames(ds, '종류', 'select'), ['버그', '기능'])
    assert.equal(dig(ds.body, 'properties', '종류', 'select', 'options', 0, 'color'), 'red')
    assert.deepEqual(optionNames(ds, '단계', 'status'), ['대기', '진행', '끝'], '상태의 기본 셋은 요청의 목록으로 바뀐다')
    const groups = dig(ds.body, 'properties', '단계', 'status', 'groups') as { name: string; option_ids: string[] }[]
    assert.deepEqual(groups.map((g) => [g.name, g.option_ids.length]), [['To-do', 1], ['In progress', 1], ['Complete', 1]])
    assert.equal(dig(ds.body, 'properties', '프로젝트', 'relation', 'data_source_id'), target.dataSourceId)
    assert.equal(dig(ds.body, 'properties', '프로젝트', 'relation', 'dual_property', 'synced_property_name'), '작업들')
    assert.deepEqual(
      [dig(ds.body, 'properties', '예산 합', 'rollup', 'relation_property_name'), dig(ds.body, 'properties', '예산 합', 'rollup', 'rollup_property_name'), dig(ds.body, 'properties', '예산 합', 'rollup', 'function')],
      ['프로젝트', '예산', 'sum'],
    )
    assert.equal(dig(ds.body, 'properties', '두배', 'formula', 'expression'), 'prop("점수") * 2')
    assert.equal(dig(ds.body, 'properties', '번호', 'unique_id', 'prefix'), 'TSK')
    assert.equal(dig(ds.body, 'properties', '메모', 'description'), '자유롭게')
    const targetSchema = await getSource(owner, target.dataSourceId)
    assert.equal(dig(targetSchema.body, 'properties', '작업들', 'type'), 'relation', '양방향의 짝이 대상 표에 생겼다')

    // 왕복 — 읽은 properties 를 그대로 돌려보낸다
    const before = await schemaVersion(owner, dataSourceId)
    const back = await patchSource(owner, dataSourceId, { properties: dig(ds.body, 'properties') })
    assert.deepEqual(dig(ok(back), 'properties'), dig(ds.body, 'properties'))
    assert.equal(await schemaVersion(owner, dataSourceId), before, '스키마 판이 오르지 않았다')
  })

  test('★ 설정 고치기 — rollup 함수 · 수식 · 고유 ID 접두사 · 상태 옵션(범주) · relation 대상 바꾸기는 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace('설정 고치기')
    const { dataSourceId } = await richDatabase(owner)
    const other = must(await createDatabase(owner.ctx, { name: '다른 표' }), '다른 표')
    const r = ok(
      await patchSource(owner, dataSourceId, {
        properties: {
          '예산 합': { rollup: { function: 'max' } },
          두배: { formula: { expression: 'prop("점수") * 3' } },
          번호: { unique_id: { prefix: 'JOB' } },
          단계: { status: { options: [{ name: '대기' }, { name: '진행', group: 'Complete' }, { name: '보류', group: 'To-do' }] } },
        },
      }),
    )
    assert.equal(dig(r, 'properties', '예산 합', 'rollup', 'function'), 'max')
    assert.equal(dig(r, 'properties', '두배', 'formula', 'expression'), 'prop("점수") * 3')
    assert.equal(dig(r, 'properties', '번호', 'unique_id', 'prefix'), 'JOB')
    const groups = dig(r, 'properties', '단계', 'status', 'groups') as { name: string; option_ids: string[] }[]
    const options = dig(r, 'properties', '단계', 'status', 'options') as { id: string; name: string }[]
    const nameOf = (id: string) => options.find((o) => o.id === id)?.name
    assert.deepEqual(
      groups.map((g) => [g.name, g.option_ids.map(nameOf).sort()]),
      [['To-do', ['대기', '보류'].sort()], ['In progress', []], ['Complete', ['진행']]],
      '끝은 지워지고 진행은 완료로 · 보류가 생겼다',
    )
    assertError(
      await patchSource(owner, dataSourceId, { properties: { 프로젝트: { relation: { data_source_id: other.dataSourceId, single_property: {} } } } }),
      400,
      'validation_error',
      /changing a relation's data source or two-way setting is not supported/,
    )
  })

  test('★ 만들기의 거부 — 최상위 · is_inline:false · 설명 · 커버 · 볼 수만 403 · 못 봄 404 · 잠긴 페이지 · 나쁜 속성은 아무것도 남기지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('만들기 거부')
    const page = await createPage(owner.ctx, { title: [textRun('개인 페이지')], privateTop: true })
    const under = (extra: Record<string, unknown> = {}) => ({ parent: { page_id: page.id }, title: text('표'), ...extra })

    assertError(await createDb(owner, { parent: { type: 'workspace', workspace: true }, title: text('표') }), 400, 'validation_error', /top of the workspace/)
    assertError(await createDb(owner, under({ is_inline: false })), 400, 'validation_error', /only inline databases/)
    assertError(await createDb(owner, under({ description: text('설명') })), 400, 'validation_error', /descriptions are not supported/)
    assertError(await createDb(owner, under({ cover: { type: 'external', external: { url: 'https://example.com/a.png' } } })), 400, 'validation_error', /covers are not supported/)
    assertError(await createDb(owner, under({ database_type: 'tasks' })), 400, 'validation_error', /body\.database_type should be not present/)
    assertError(await createDb(member, under()), 404, 'object_not_found', /Could not find page/)
    must(await grantAccess(owner.ctx, page.id, { type: 'user', id: member.userId }, 'view'), '보기')
    assertError(await createDb(member, under()), 403, 'restricted_resource')
    must(await setPageLock(owner.ctx, page.id, true), '잠금')
    assertError(await createDb(owner, under()), 400, 'validation_error', /locked/)
    must(await setPageLock(owner.ctx, page.id, false), '풀기')

    // 뒤의 속성 하나가 거부되면 데이터베이스도 생기지 않는다
    assertError(
      await createDb(owner, under({ initial_data_source: { properties: { 점수: { number: {} }, 식: { formula: { expression: 'prop("없는 칸") * 2' } } } } })),
      400,
      'validation_error',
      /body\.initial_data_source\.properties\.식\.formula\.expression is not valid/,
    )
    assertError(await createDb(owner, under({ initial_data_source: { properties: { 버튼: { button: {} } } } })), 400, 'validation_error', /button properties cannot be created/)
    assert.equal(await databasesUnder(page.id), 0)
  })
})

// ── 데이터베이스 고치기 ───────────────────────────────────────────────

describe('PATCH /v1/databases/{id}', () => {
  test('★ 이름 · 아이콘 · 잠금(잠그면 스키마 쓰기 400 · 풀고 고치기는 한 요청) · is_inline 바꾸기 400 · 휴지통 · 되살리기', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace('데이터베이스 고치기')
    const page = await createPage(owner.ctx, { title: [textRun('페이지')] })
    const db = ok(await createDb(owner, { parent: { page_id: page.id }, title: text('처음') }))
    const id = String(dig(db, 'id'))
    const ds = String(dig(db, 'data_sources', 0, 'id'))

    const renamed = ok(await patchDb(owner, id, { title: text('바뀐 이름'), icon: { emoji: '🗂️' }, description: [], cover: null, is_inline: true }))
    assert.equal(plainOf(dig(renamed, 'title')), '바뀐 이름')
    assert.deepEqual(dig(renamed, 'icon'), { type: 'emoji', emoji: '🗂️' })
    assert.equal(plainOf(dig(ok(await getSource(owner, ds)), 'title')), '바뀐 이름', '소스가 하나면 그 이름은 데이터베이스의 제목')

    ok(await patchDb(owner, id, { is_locked: true }))
    assertError(await patchSource(owner, ds, { properties: { 점수: { number: {} } } }), 400, 'validation_error', /locked/)
    assertError(await patchDb(owner, id, { title: text('잠긴 채') }), 400, 'validation_error', /locked/)
    const unlocked = ok(await patchDb(owner, id, { is_locked: false, title: text('풀고 고침') }))
    assert.equal(plainOf(dig(unlocked, 'title')), '풀고 고침')
    ok(await patchSource(owner, ds, { properties: { 점수: { number: {} } } }))

    assertError(await patchDb(owner, id, { is_inline: false }), 400, 'validation_error', /inline and full page/)
    assertError(await patchDb(owner, id, { description: text('설명') }), 400, 'validation_error', /descriptions are not supported/)
    assertError(await patchDb(owner, id, { parent: { page_id: page.id } }), 400, 'validation_error', /Moving a database is not supported/)

    const trashed = ok(await patchDb(owner, id, { in_trash: true }))
    assert.equal(dig(trashed, 'in_trash'), true)
    assertError(await patchDb(owner, id, { title: text('휴지통에서') }), 400, 'validation_error', /in trash/)
    const restored = ok(await patchDb(owner, id, { in_trash: false, title: text('되살림') }))
    assert.equal(dig(restored, 'in_trash'), false)
    assert.equal(plainOf(dig(restored, 'title')), '되살림')
  })
})

// ── 데이터 소스 ───────────────────────────────────────────────────────

describe('POST /v1/data_sources', () => {
  test('★ 둘째 데이터 소스 — 속성과 함께 · 제목 · 데이터 소스 id 를 부모로 주면 404 + 바른 주소 · 아이콘은 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace('소스 더하기')
    const table = must(await createDatabase(owner.ctx, { name: '두 소스 표' }), '표')
    const made = ok(
      await createSource(owner, {
        parent: { type: 'database_id', database_id: table.id },
        title: text('둘째'),
        properties: { 이름표: { title: {} }, 양: { number: {} }, 색: { select: { options: [{ name: '빨강', color: 'red' }] } } },
      }),
    )
    assert.equal(dig(made, 'object'), 'data_source')
    assert.equal(plainOf(dig(made, 'title')), '둘째')
    assert.deepEqual(dig(made, 'parent'), { type: 'database_id', database_id: table.id })
    assert.deepEqual(Object.keys(dig(made, 'properties') as object).sort(), ['양', '색', '이름표'].sort())
    assert.equal(dig(made, 'properties', '이름표', 'id'), 'title')
    const db = ok(await getDb(owner, table.id))
    assert.deepEqual((dig(db, 'data_sources') as { name: string }[]).map((s) => s.name), ['두 소스 표', '둘째'])

    assertError(await createSource(owner, { parent: { database_id: table.dataSourceId }, properties: {} }), 404, 'object_not_found', /This is a data source ID/)
    assertError(await createSource(owner, { parent: { database_id: table.id }, properties: {}, icon: { emoji: '🙂' } }), 400, 'validation_error', /shows its database's icon/)
    assertError(await createSource(owner, { parent: { database_id: table.id } }), 400, 'validation_error', /body\.properties should be defined/)
  })
})

describe('PATCH /v1/data_sources/{id}', () => {
  async function editTable(owner: Caller) {
    const table = must(await createDatabase(owner.ctx, { name: '고칠 표' }), '표')
    const ds = table.dataSourceId
    must(await addProperty(owner.ctx, ds, { name: '메모', type: 'rich_text' }), '메모')
    must(await addProperty(owner.ctx, ds, { name: '종류', type: 'select' }), '종류')
    let schema = must(await getSchema(owner.ctx, ds), '스키마')
    const id = (name: string) => schema.properties.find((p) => p.name === name)!.id
    const bug = must(await addSelectOption(owner.ctx, ds, id('종류'), { name: '버그', color: 'red' }), '버그').option
    must(await addSelectOption(owner.ctx, ds, id('종류'), { name: '기능', color: 'blue' }), '기능')
    const doc = must(await addSelectOption(owner.ctx, ds, id('종류'), { name: '문서', color: 'gray' }), '문서').option
    schema = must(await getSchema(owner.ctx, ds), '스키마')
    const titleId = schema.properties.find((p) => p.type === 'title')!.id
    const row = async (title: string, memo: string, kind: string) =>
      must(
        await createRow(owner.ctx, ds, {
          cells: [
            { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
            { propertyId: id('메모'), value: { type: 'rich_text', rich_text: [textRun(memo)] } },
            { propertyId: id('종류'), value: { type: 'select', select: { id: kind } } },
          ],
        }),
        title,
      ).id
    const rows = { A: await row('A', '사과', doc.id), B: await row('B', '바나나', bug.id) }
    return { table, ds, id, bug, doc, rows }
  }

  async function cellOf(rowId: string, propertyId: string): Promise<unknown> {
    return withTransaction(async (tx) =>
      (await tx.queryMaybe<{ value: unknown }>(`SELECT value FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [rowId, propertyId]))?.value ?? null,
    )
  }

  test('★ 더하기 · 이름 · 타입 바꾸기(값이 옵션으로) · 옵션(id 로 이름 · 색 · 빠진 것 지우기 → 칸이 빈다) · 지우기 · 제목 이름 · 소스가 하나면 제목은 데이터베이스의 이름', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace('소스 고치기')
    const { table, ds, id, bug, rows } = await editTable(owner)
    const kindId = id('종류')

    const r = ok(
      await patchSource(owner, ds, {
        properties: {
          메모: { select: {} },
          [kindId]: { name: '분류', select: { options: [{ id: bug.id, name: '결함', color: 'orange' }, { name: '기능' }, { name: '새 것', color: 'green' }] } },
          점수: { number: {} },
          title: { name: '제목' },
        },
      }),
    )
    assert.deepEqual(Object.keys(dig(r, 'properties') as object).sort(), ['메모', '분류', '점수', '제목'].sort())
    assert.equal(dig(r, 'properties', '메모', 'type'), 'select')
    assert.deepEqual(optionNames({ status: 200, body: r }, '메모', 'select').sort(), ['바나나', '사과'].sort(), '글의 값이 옵션이 됐다')
    const kinds = dig(r, 'properties', '분류', 'select', 'options') as { id: string; name: string; color: string }[]
    assert.deepEqual(kinds.map((o) => [o.name, o.color]), [['결함', 'orange'], ['기능', 'blue'], ['새 것', 'green']])
    assert.equal(kinds[0].id, bug.id, 'id 로 잡은 옵션은 id 가 그대로')
    assert.equal(dig(await cellOf(rows.A, kindId), 'select'), null, '지운 옵션(문서)을 쓰던 칸이 비었다')
    assert.deepEqual(dig(await cellOf(rows.B, kindId), 'select'), { id: bug.id }, '이름이 바뀐 옵션의 칸은 그대로')

    const second = ok(await patchSource(owner, ds, { properties: { 점수: null, 메모: { name: '메모2' } } }))
    assert.deepEqual(Object.keys(dig(second, 'properties') as object).sort(), ['메모2', '분류', '제목'].sort())

    const titled = ok(await patchSource(owner, ds, { title: text('새 표 이름') }))
    assert.equal(plainOf(dig(titled, 'title')), '새 표 이름')
    assert.equal(plainOf(dig(ok(await getDb(owner, table.id)), 'title')), '새 표 이름')
  })

  test('★ 한 요청은 통째로 — 뒤의 속성 하나가 거부되면 앞의 이름 바꾸기 · 옵션 지우기 · 더하기도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace('통째로')
    const { ds } = await editTable(owner)
    const before = await getSource(owner, ds)
    const version = await schemaVersion(owner, ds)
    assertError(
      await patchSource(owner, ds, {
        properties: {
          종류: { name: '바뀐 이름', select: { options: [{ name: '버그' }] } },
          '새 칸': { checkbox: {} },
          '나쁜 식': { formula: { expression: 'prop("없는 칸") +' } },
        },
      }),
      400,
      'validation_error',
      /나쁜 식\.formula\.expression is not valid/,
    )
    assertError(await patchSource(owner, ds, { properties: { 메모: { name: '이름만' }, 종류: { people: {} } } }), 400, 'validation_error', /cannot be converted to people/)
    assertError(await patchSource(owner, ds, { properties: { 이름: null } }), 400, 'validation_error', /title property cannot be deleted/)
    assertError(await patchSource(owner, ds, { properties: { 둘째: { title: {} } } }), 400, 'validation_error', /exactly one title property/)
    assert.equal(await schemaVersion(owner, ds), version, '스키마 판이 그대로')
    assert.deepEqual(dig((await getSource(owner, ds)).body, 'properties'), dig(before.body, 'properties'))
  })

  test('★ 권한 — 못 봄 404 · 볼 수만 403 · 잠김 400 · 내보내기 정책을 끄면 멤버는 403 · 데이터 소스 휴지통 · 되살리기 · 마지막 소스는 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await workspace('구조 권한')
    const secret = must(await createDatabase(owner.ctx, { name: '비밀 표', privateTop: true }), '비밀 표')
    const add = { properties: { 점수: { number: {} } } }
    assertError(await patchSource(member, secret.dataSourceId, add), 404, 'object_not_found')
    assertError(await patchDb(member, secret.id, { title: text('남의 것') }), 404, 'object_not_found')
    assertError(await createSource(member, { parent: { database_id: secret.id }, properties: {} }), 404, 'object_not_found')
    must(await grantAccess(owner.ctx, secret.id, { type: 'user', id: member.userId }, 'view'), '보기')
    assertError(await patchSource(member, secret.dataSourceId, add), 403, 'restricted_resource')
    assertError(await patchDb(member, secret.id, { title: text('남의 것') }), 403, 'restricted_resource')
    assertError(await createSource(member, { parent: { database_id: secret.id }, properties: {} }), 403, 'restricted_resource')
    must(await setDatabaseLock(owner.ctx, secret.id, true), '잠금')
    assertError(await patchSource(owner, secret.dataSourceId, add), 400, 'validation_error', /locked/)
    must(await setDatabaseLock(owner.ctx, secret.id, false), '풀기')

    const shared = must(await createDatabase(owner.ctx, { name: '모두의 표' }), '모두의 표')
    await withTransaction((tx) => writeExportPolicyIn(tx, ws, false))
    try {
      assertError(await patchSource(member, shared.dataSourceId, add), 403, 'restricted_resource', /security policy/)
      assertError(await createDb(member, { parent: { page_id: secret.id }, title: text('x') }), 403, 'restricted_resource', /security policy/)
      ok(await patchSource(owner, shared.dataSourceId, add))
    } finally {
      await withTransaction((tx) => writeExportPolicyIn(tx, ws, true))
    }

    // 데이터 소스 휴지통 — 둘째를 넣고 되살린다 · 휴지통의 것은 고치지 않는다 · 마지막 소스는 넣지 않는다
    const second = must(await addDataSource(owner.ctx, shared.id, { name: '둘째' }), '둘째').dataSource.id
    const trashed = ok(await patchSource(owner, second, { in_trash: true }))
    assert.equal(dig(trashed, 'in_trash'), true)
    assert.equal((dig(ok(await getDb(owner, shared.id)), 'data_sources') as unknown[]).length, 1)
    assertError(await patchSource(owner, second, { title: text('휴지통에서') }), 400, 'validation_error', /in trash/)
    const restored = ok(await patchSource(owner, second, { in_trash: false }))
    assert.equal(dig(restored, 'in_trash'), false)
    ok(await patchSource(owner, second, { in_trash: true }))
    assertError(await patchSource(owner, shared.dataSourceId, { in_trash: true }), 400, 'validation_error', /only data source/)
  })
})
