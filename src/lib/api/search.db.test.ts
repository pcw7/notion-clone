/**
 * 공개 API 의 검색 — 라우트 수준 (API-5 · F-09-06 · F-09-04 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑤ ⑩ · 09 F-09-06
 *
 * 라우트 파일은 `v1Route(handler)` 한 줄이라 같은 것을 여기서 만들어 `Request` 로 부른다(`data-sources.db.test.ts` 와 같다). 실제 서버 ·
 * 브라우저로는 e2e '공개 API — 검색 · 댓글 · 사용자 (API-5 · F-09-06 · F-09-07)' 가 본다.
 *
 *   ★ 제목으로 볼 수 있는 페이지 · 데이터 소스 · 행을 찾고 볼 수 없는 것(개인 페이지 · 개인 표 · 끊겨 빠진 행)은 결코 주지 않는다 · 소유자는 본다
 *   ★ filter 로 종류만 · 정렬(편집 순 오름 · 내림) · 쪽을 넘겨도 빠짐 · 겹침 없다 · 다른 질의의 커서는 400
 *   ★ 소스가 둘인 데이터베이스는 소스 둘 — 쪽이 그 사이에서 끊겨도 겹치지 않는다
 *   ★ query 를 빼면 볼 수 있는 것 모두 · 휴지통은 없다 · 내보내기 정책을 끄면 멤버는 403
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { textRun } from '../contracts/rich-text.ts'
import { createPage } from '../block/page.ts'
import { trashPage } from '../block/trash.ts'
import { createDatabase } from '../database/database.ts'
import { addDataSource } from '../database/data-source.ts'
import { getSchema } from '../database/property.ts'
import { createRow } from '../database/row.ts'
import { withTransaction } from '../db/tx.ts'
import { asBlockId } from '../ids.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { reset } from '../rate-limit.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { writeExportPolicyIn } from '../workspace/security-policy.ts'
import { createApiToken } from './api-token.ts'
import { searchApi } from './search.ts'
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
  const made = await createApiToken(actor.ctx, { name: 'API-5 검색 시험' })
  if (!made.ok) throw new Error(made.reason)
  return { ...actor, api: made.value.token, apiId: made.value.summary.id }
}

const route = v1Route(searchApi)

type Reply = { readonly status: number; readonly body: Record<string, unknown> }

async function search(who: Caller, body?: unknown): Promise<Reply> {
  await reset(API_RATE_NAMESPACE, who.apiId)
  const headers: Record<string, string> = { authorization: `Bearer ${who.api}`, 'notion-version': NOTION_VERSION }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await route(new Request('http://localhost/v1/search', { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) }), {
    params: Promise.resolve({}),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

type Result = { object: string; id: string; title?: { plain_text: string }[]; properties?: Record<string, { type: string; title?: { plain_text: string }[] }> }

const results = (r: Reply): Result[] => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body.results as Result[]
}

/** 결과의 이름 — 페이지는 제목 속성, 데이터 소스는 `title`. 앞에 종류를 붙인다. */
function names(r: Reply): string[] {
  return results(r).map((x) => {
    const runs = x.object === 'data_source' ? x.title : Object.values(x.properties ?? {}).find((p) => p.type === 'title')?.title
    return `${x.object}:${(runs ?? []).map((t) => t.plain_text).join('')}`
  })
}

/** 커서를 끝까지 따라간다. */
async function walk(who: Caller, body: Record<string, unknown>): Promise<{ names: string[]; pages: number }> {
  const out: string[] = []
  let cursor: unknown = undefined
  let pages = 0
  for (;;) {
    const r = await search(who, { ...body, ...(cursor === undefined ? {} : { start_cursor: cursor }) })
    out.push(...names(r))
    pages += 1
    if (r.body.has_more !== true) {
      assert.equal(r.body.next_cursor, null)
      break
    }
    cursor = r.body.next_cursor
    assert.ok(pages < 50, '끝나지 않는다')
  }
  return { names: out, pages }
}

const sorted = (list: string[]) => [...list].sort()

// ── 준비 ──────────────────────────────────────────────────────────────

async function workspace(name: string) {
  const ws = await createBareWorkspace(name)
  const owner = await withToken(await joinAs(ws, await createUser(`${name} 소유자`), 'owner'))
  const member = await withToken(await joinAs(ws, await createUser(`${name} 멤버`), 'member'))
  return { ws, owner, member }
}

const must = <T>(r: { ok: boolean; value?: T; reason?: string }, what: string): T => {
  if (!r.ok) throw new Error(`${what} 준비 실패: ${r.reason}`)
  return r.value as T
}

const titleOf = async (who: Caller, ds: string) => must(await getSchema(who.ctx, ds), '스키마').properties.find((p) => p.type === 'title')!.id

async function row(who: Caller, ds: string, title: string): Promise<string> {
  return must(await createRow(who.ctx, ds, { cells: [{ propertyId: await titleOf(who, ds), value: { type: 'title', title: [textRun(title)] } }] }), title).id
}

describe('공개 API 의 검색 (API-5)', () => {
  test('★ 제목으로 볼 수 있는 페이지 · 데이터 소스 · 행을 찾는다 — 개인 페이지 · 개인 표 · 끊겨 빠진 행은 결코 없다 · 소유자는 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('검색 권한')
    const page = await createPage(owner.ctx, { title: [textRun('알파 보고서')] })
    await createPage(owner.ctx, { title: [textRun('알파 비밀')], privateTop: true })
    await createPage(owner.ctx, { title: [textRun('베타 문서')] })
    // 행을 끊어 빼려면 멤버가 사람으로 받은 표여야 한다(워크스페이스 전체의 부여는 사람 하나를 빼도 남는다)
    const table = must(await createDatabase(owner.ctx, { name: '알파 표', privateTop: true }), '표')
    must(await grantAccess(owner.ctx, table.id, { type: 'user', id: member.userId }, 'edit'), '공유')
    must(await createDatabase(owner.ctx, { name: '알파 개인 표', privateTop: true }), '개인 표')
    await row(owner, table.dataSourceId, '알파 행 보임')
    const hidden = await row(owner, table.dataSourceId, '알파 행 숨김')
    must(await stopInheriting(owner.ctx, hidden), '끊기')
    must(await revokeAccess(owner.ctx, hidden, { type: 'user', id: member.userId }), '빼기')

    const seen = await search(member, { query: '알파' })
    assert.deepEqual(sorted(names(seen)), sorted(['page:알파 보고서', 'data_source:알파 표', 'page:알파 행 보임']))
    assert.equal(seen.body.object, 'list')
    assert.equal(seen.body.type, 'page_or_data_source')
    assert.deepEqual(seen.body.page_or_data_source, {})
    // 객체는 API-2 · API-4 의 것 — 페이지의 부모 · 행의 부모 · 데이터 소스의 부모
    const byId = new Map(results(seen).map((x) => [x.id, x as unknown as Record<string, unknown>]))
    assert.deepEqual(byId.get(page.id)?.parent, { type: 'workspace', workspace: true })
    assert.equal(byId.get(page.id)?.in_trash, false)
    assert.deepEqual(byId.get(table.dataSourceId)?.parent, { type: 'database_id', database_id: table.id })
    assert.equal(byId.get(table.dataSourceId)?.object, 'data_source')
    const shown = results(seen).find((x) => x.object === 'page' && x.id !== page.id) as unknown as Record<string, unknown>
    assert.deepEqual(shown.parent, { type: 'data_source_id', data_source_id: table.dataSourceId, database_id: table.id })

    assert.deepEqual(
      sorted(names(await search(owner, { query: '알파' }))),
      sorted(['page:알파 보고서', 'page:알파 비밀', 'data_source:알파 표', 'data_source:알파 개인 표', 'page:알파 행 보임', 'page:알파 행 숨김']),
    )
    // 숨긴 행의 이름 그대로 찾아도 없다(맞는 것이 없으니 앱처럼 비슷한 제목으로 한 쪽 — 거기에도 없다)
    const exact = names(await search(member, { query: '알파 행 숨김' }))
    assert.ok(!exact.includes('page:알파 행 숨김'), JSON.stringify(exact))
    assert.ok(exact.length > 0, '오타 대체가 돈다')
  })

  test('★ filter 는 종류만 — page · data_source', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('검색 종류')
    await createPage(owner.ctx, { title: [textRun('감마 노트')] })
    must(await createDatabase(owner.ctx, { name: '감마 표' }), '표')
    assert.deepEqual(names(await search(member, { query: '감마', filter: { property: 'object', value: 'page' } })), ['page:감마 노트'])
    assert.deepEqual(names(await search(member, { query: '감마', filter: { property: 'object', value: 'data_source' } })), ['data_source:감마 표'])
    const bad = await search(member, { query: '감마', filter: { property: 'object', value: 'database' } })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.code, 'validation_error')
  })

  test('★ 정렬 · 쪽 — 편집 순 오름 · 내림 · 쪽을 넘겨도 빠짐 · 겹침 없다 · 다른 질의의 커서는 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('검색 쪽')
    const made: string[] = []
    for (let i = 1; i <= 5; i += 1) {
      await createPage(owner.ctx, { title: [textRun(`델타 ${i}`)] })
      made.push(`page:델타 ${i}`)
    }
    const asc = await walk(member, { query: '델타', sort: { timestamp: 'last_edited_time', direction: 'ascending' }, page_size: 2 })
    assert.deepEqual(asc.names, made)
    assert.equal(asc.pages, 3)
    const desc = await walk(member, { query: '델타', sort: { timestamp: 'last_edited_time', direction: 'descending' }, page_size: 2 })
    assert.deepEqual(desc.names, [...made].reverse())
    const best = await walk(member, { query: '델타', page_size: 3 })
    assert.deepEqual(sorted(best.names), sorted(made), '기본(가장 잘 맞는 순)도 빠짐 · 겹침 없다')

    const first = await search(member, { query: '델타', page_size: 2 })
    assert.equal(first.body.has_more, true)
    const other = await search(member, { query: '델타 1', page_size: 2, start_cursor: first.body.next_cursor })
    assert.equal(other.status, 400)
    assert.match(String(other.body.message), /start_cursor does not belong to this search/)
    const resorted = await search(member, { query: '델타', sort: { timestamp: 'last_edited_time', direction: 'ascending' }, start_cursor: first.body.next_cursor })
    assert.equal(resorted.status, 400)
  })

  test('★ 소스가 둘인 데이터베이스는 소스 둘 — 쪽이 그 사이에서 끊겨도 겹치지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('검색 소스')
    const table = must(await createDatabase(owner.ctx, { name: '엡실론 표' }), '표')
    const second = must(await addDataSource(owner.ctx, table.id, { name: '둘째 소스' }), '소스')
    await createPage(owner.ctx, { title: [textRun('엡실론 메모')] })
    const all = await walk(member, { query: '엡실론', page_size: 1, sort: { timestamp: 'last_edited_time', direction: 'ascending' } })
    assert.equal(all.pages, 3)
    assert.equal(new Set(all.names).size, 3, JSON.stringify(all.names))
    assert.deepEqual(all.names.filter((n) => n.startsWith('data_source:')).length, 2)
    assert.ok(all.names.includes('data_source:둘째 소스'), JSON.stringify(all.names))
    const ids = results(await search(member, { query: '엡실론', filter: { property: 'object', value: 'data_source' } })).map((x) => x.id)
    assert.deepEqual(sorted(ids), sorted([table.dataSourceId, second.dataSource.id]))
  })

  test('★ query 를 빼면 볼 수 있는 것 모두 · 휴지통은 없다 · 짧은 라틴 검색어는 빈 목록 · 내보내기 정책을 끄면 멤버는 403', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await workspace('검색 모두')
    await createPage(owner.ctx, { title: [textRun('하나')] })
    const gone = await createPage(owner.ctx, { title: [textRun('버린 것')] })
    await trashPage(owner.ctx, asBlockId(gone.id))
    await createPage(owner.ctx, { title: [textRun('개인')], privateTop: true })
    must(await createDatabase(owner.ctx, { name: '둘 표' }), '표')
    assert.deepEqual(sorted(names(await search(member))), sorted(['page:하나', 'data_source:둘 표']))
    assert.deepEqual(sorted(names(await search(member, { query: '' }))), sorted(['page:하나', 'data_source:둘 표']))
    assert.deepEqual(names(await search(member, { query: '버린' })), [])
    assert.deepEqual(names(await search(member, { query: 'a' })), [])

    await withTransaction((tx) => writeExportPolicyIn(tx, ws, false))
    try {
      const blocked = await search(member, {})
      assert.equal(blocked.status, 403)
      assert.equal(blocked.body.code, 'restricted_resource')
      assert.equal((await search(owner, {})).status, 200)
    } finally {
      await withTransaction((tx) => writeExportPolicyIn(tx, ws, true))
    }
  })
})
