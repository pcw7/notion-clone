/**
 * 공개 API 의 사용자 — `GET /v1/users` · `GET /v1/users/{id}` · `GET /v1/users/me` (API-5 · F-09-01 · F-09-02 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑩
 *
 *   ★ 목록은 활동 중인 멤버만 — 게스트 · 멈춘 사람 · 나간 사람 · 다른 워크스페이스의 사람은 없다 · 노션의 person 객체 · 이메일은 대표 주소
 *   ★ 한 사람 — 게스트 · 멈춘 사람도(앱이 이름을 보인다) · 나간 사람 · 다른 워크스페이스의 사람 · 모양이 틀린 id 는 404 · 400
 *   ★ 쪽 — 빠짐 · 겹침 없다 · 다른 목록의 커서는 400 · `users/me` 는 그대로
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query as sql } from '../db/pool.ts'
import { reset } from '../rate-limit.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createApiToken } from './api-token.ts'
import { listApiUsers, retrieveApiUser, usersMe } from './users.ts'
import { v1Route } from './v1.ts'
import { API_RATE_NAMESPACE, NOTION_VERSION, encodeBoundCursor } from './v1-protocol.ts'

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

type Caller = Actor & { readonly api: string; readonly apiId: string }

async function withToken(actor: Actor): Promise<Caller> {
  const made = await createApiToken(actor.ctx, { name: 'API-5 사용자 시험' })
  if (!made.ok) throw new Error(made.reason)
  return { ...actor, api: made.value.token, apiId: made.value.summary.id }
}

const ROUTES = { list: v1Route(listApiUsers), get: v1Route(retrieveApiUser), me: v1Route(usersMe) }

type Reply = { readonly status: number; readonly body: Record<string, unknown> }

async function call(who: Caller, route: keyof typeof ROUTES, path: string, params: Record<string, string> = {}): Promise<Reply> {
  await reset(API_RATE_NAMESPACE, who.apiId)
  const res = await ROUTES[route](
    new Request(`http://localhost${path}`, { method: 'GET', headers: { authorization: `Bearer ${who.api}`, 'notion-version': NOTION_VERSION } }),
    { params: Promise.resolve(params) },
  )
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

type User = { object: string; id: string; type: string; name: string; avatar_url: string | null; person: { email: string | null } }

const ids = (r: Reply): string[] => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return (r.body.results as User[]).map((u) => u.id)
}
const sorted = (list: string[]) => [...list].sort()

async function setStatus(ws: string, userId: string, status: 'suspended' | 'removed') {
  await sql(`UPDATE workspace_member SET status = $3 WHERE workspace_id = $1 AND user_id = $2`, [ws, userId, status])
}

describe('공개 API 의 사용자 (API-5)', () => {
  test('★ 목록 · 한 사람 — 활동 중인 멤버만 · 게스트 · 멈춘 사람은 id 로만 · 나간 사람 · 다른 워크스페이스는 404 · 이메일', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ws = await createBareWorkspace('사용자 목록')
    const owner = await withToken(await joinAs(ws, await createUser('사용자 소유자'), 'owner'))
    const member = await withToken(await joinAs(ws, await createUser('사용자 멤버'), 'member'))
    const guest = await joinAs(ws, await createUser('사용자 게스트'), 'guest')
    const paused = await joinAs(ws, await createUser('사용자 멈춤'), 'member')
    const left = await joinAs(ws, await createUser('사용자 나감'), 'member')
    await setStatus(ws, paused.userId, 'suspended')
    await setStatus(ws, left.userId, 'removed')
    const elsewhere = await joinAs(await createBareWorkspace('다른 곳'), await createUser('다른 곳 사람'), 'owner')

    const listed = await call(member, 'list', '/v1/users')
    assert.deepEqual(sorted(ids(listed)), sorted([owner.userId, member.userId]))
    assert.equal(listed.body.object, 'list')
    assert.equal(listed.body.type, 'user')
    assert.deepEqual(listed.body.user, {})
    assert.equal(listed.body.has_more, false)
    const me = (listed.body.results as User[]).find((u) => u.id === member.userId)!
    assert.deepEqual(me, { object: 'user', id: member.userId, type: 'person', name: '사용자 멤버', avatar_url: null, person: { email: member.email } })

    const one = await call(member, 'get', `/v1/users/${owner.userId}`, { user_id: owner.userId })
    assert.equal(one.status, 200)
    assert.deepEqual(one.body, { object: 'user', id: owner.userId, type: 'person', name: '사용자 소유자', avatar_url: null, person: { email: owner.email } })
    // 대시 없는 id 도
    assert.equal((await call(member, 'get', `/v1/users/x`, { user_id: owner.userId.replace(/-/g, '') })).status, 200)
    for (const who of [guest, paused]) {
      const r = await call(member, 'get', `/v1/users/${who.userId}`, { user_id: who.userId })
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.equal(r.body.id, who.userId)
    }
    for (const who of [left, elsewhere]) {
      const r = await call(member, 'get', `/v1/users/${who.userId}`, { user_id: who.userId })
      assert.equal(r.status, 404)
      assert.equal(r.body.code, 'object_not_found')
    }
    const bad = await call(member, 'get', '/v1/users/nope', { user_id: 'nope' })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.code, 'validation_error')

    const self = await call(member, 'me', '/v1/users/me')
    assert.equal(self.body.id, member.userId)
  })

  test('★ 쪽 — 빠짐 · 겹침 없다 · 다른 목록의 커서 · 틀린 page_size 는 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ws = await createBareWorkspace('사용자 쪽')
    const owner = await withToken(await joinAs(ws, await createUser('쪽 소유자'), 'owner'))
    const all = [owner.userId]
    for (let i = 0; i < 4; i += 1) all.push((await joinAs(ws, await createUser(`쪽 멤버 ${i}`), 'member')).userId)

    const seen: string[] = []
    let cursor: unknown = null
    let pages = 0
    do {
      const r = await call(owner, 'list', `/v1/users?page_size=2${cursor === null ? '' : `&start_cursor=${cursor}`}`)
      seen.push(...ids(r))
      cursor = r.body.next_cursor
      pages += 1
    } while (cursor !== null && pages < 10)
    assert.equal(pages, 3)
    assert.deepEqual(sorted(seen), sorted(all))
    assert.equal(new Set(seen).size, seen.length)

    const foreign = await call(owner, 'list', `/v1/users?start_cursor=${encodeBoundCursor('comments:x', 2)}`)
    assert.equal(foreign.status, 400)
    assert.equal(foreign.body.code, 'validation_error')
    assert.equal((await call(owner, 'list', '/v1/users?page_size=101')).status, 400)
  })
})
