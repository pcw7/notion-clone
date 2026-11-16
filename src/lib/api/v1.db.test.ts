/**
 * 공개 API `/v1` 의 문 — 라우트 수준 (API-1 · F-09-05 · DB · Valkey)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ② ③ ④
 *
 * 라우트 파일(`app/v1/users/me/route.ts`)은 `export const GET = v1Route(usersMe)` 한 줄이라, 같은 것을 여기서 만들어 `Request` 로 부른다
 * (앱의 `@/` 별칭은 node:test 가 풀지 못한다). 실제 서버 · 브라우저로는 e2e 'API 토큰 (API-1 · F-09-02)' 이 본다.
 *
 *   ★ 머리 없음 · 쿠키만 · 세션 토큰을 Bearer 로 → 401 unauthorized(노션의 오류 모양 · request_id · no-store · CORS 머리 없음)
 *   ★ Notion-Version 없음 → 400 missing_version · 다른 판 → 400 invalid_request
 *   ★ 성공 → 200 person 사용자 객체 · 폐기 → 401
 *   ★ 레이트리밋 → 429 rate_limited + Retry-After
 *   ★ 본문 500KB 초과 → 400 validation_error · JSON 아님 → 400 invalid_json
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { SESSION_COOKIE } from '../auth/constants.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createApiToken, revokeApiToken } from './api-token.ts'
import { usersMe } from './users.ts'
import { v1Ok, v1Route } from './v1.ts'
import { API_MAX_BODY_BYTES, API_RATE_NAMESPACE, API_RATE_RULE, NOTION_VERSION } from './v1-protocol.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let valkeyUp = false

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  try {
    const { getValkey } = await import('../valkey.ts')
    await getValkey().ping()
    valkeyUp = true
  } catch (e) {
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 Valkey 사용 불가: ${(e as Error).message.split('\n')[0]}`)
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

const GET = v1Route(usersMe)
const ECHO = v1Route(async ({ body }) => v1Ok({ echoed: body }))
const URL_ME = 'http://localhost/v1/users/me'
const route = { params: Promise.resolve({}) }

const call = async (handler: typeof GET, init: RequestInit & { headers?: Record<string, string> }, url = URL_ME) => {
  const res = await handler(new Request(url, init), route)
  return { res, body: (await res.json()) as Record<string, unknown> }
}

const headersFor = (token: string, version: string | null = NOTION_VERSION): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  ...(version === null ? {} : { 'notion-version': version }),
})

async function member(name: string): Promise<{ who: Actor; token: string; id: string }> {
  const ws = await createBareWorkspace(name)
  await joinAs(ws, await createUser('대표'), 'owner')
  const who = await joinAs(ws, await createUser(`${name}의 사람`), 'member')
  const made = await createApiToken(who.ctx, { name: 'v1 시험' })
  if (!made.ok) throw new Error(made.reason)
  return { who, token: made.value.token, id: made.value.summary.id }
}

/** 노션의 오류 모양 + 응답 머리. */
function assertError(r: { res: Response; body: Record<string, unknown> }, status: number, code: string) {
  assert.equal(r.res.status, status)
  assert.deepEqual(Object.keys(r.body).sort(), ['code', 'message', 'object', 'request_id', 'status'])
  assert.equal(r.body.object, 'error')
  assert.equal(r.body.status, status)
  assert.equal(r.body.code, code)
  assert.equal(typeof r.body.message, 'string')
  assert.match(String(r.body.request_id), /^[0-9a-f-]{36}$/)
  assert.equal(r.res.headers.get('x-request-id'), r.body.request_id)
  assert.equal(r.res.headers.get('cache-control'), 'no-store')
  assert.equal(r.res.headers.get('access-control-allow-origin'), null, 'CORS 머리를 싣지 않는다')
}

describe('/v1 의 문', () => {
  test('★ 401 — 머리 없음 · 쿠키만 · 세션 토큰 · 모르는 토큰 · 다른 방식', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { who } = await member('401')
    assertError(await call(GET, { headers: { 'notion-version': NOTION_VERSION } }), 401, 'unauthorized')
    // 쿠키는 보지 않는다 — 로그인한 브라우저의 쿠키만 실린 요청(CSRF 의 모양)
    assertError(await call(GET, { headers: { 'notion-version': NOTION_VERSION, cookie: `${SESSION_COOKIE}=${who.token}` } }), 401, 'unauthorized')
    assertError(await call(GET, { headers: headersFor(who.token) }), 401, 'unauthorized')
    assertError(await call(GET, { headers: headersFor(`ntn_${'Q'.repeat(46)}`) }), 401, 'unauthorized')
    assertError(await call(GET, { headers: { authorization: `Basic ${Buffer.from('a:b').toString('base64')}`, 'notion-version': NOTION_VERSION } }), 401, 'unauthorized')
  })

  test('★ Notion-Version — 없으면 400 missing_version · 다른 판은 400 invalid_request', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { token } = await member('판')
    assertError(await call(GET, { headers: headersFor(token, null) }), 400, 'missing_version')
    const old = await call(GET, { headers: headersFor(token, '2022-06-28') })
    assertError(old, 400, 'invalid_request')
    assert.ok(String(old.body.message).includes(NOTION_VERSION), '받는 판을 말한다')
  })

  test('★ 성공 — 200 person 사용자 객체 · 요청마다 새 request_id · 폐기하면 곧바로 401', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { who, token, id } = await member('성공')
    const a = await call(GET, { headers: headersFor(token) })
    assert.equal(a.res.status, 200)
    assert.deepEqual(a.body, { object: 'user', id: who.userId, type: 'person', name: '성공의 사람', avatar_url: null, person: { email: who.email } })
    assert.equal(a.res.headers.get('cache-control'), 'no-store')
    const b = await call(GET, { headers: { ...headersFor(token), cookie: `${SESSION_COOKIE}=garbage` } })
    assert.equal(b.res.status, 200, 'Bearer 가 있으면 쿠키는 상관없다')
    assert.notEqual(a.res.headers.get('x-request-id'), b.res.headers.get('x-request-id'))

    assert.ok((await revokeApiToken(who.ctx, id)).ok)
    assertError(await call(GET, { headers: headersFor(token) }), 401, 'unauthorized')
  })

  test('★ 레이트리밋 — 한 창에 15번까지 · 넘으면 429 rate_limited + Retry-After(1~5초)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    if (!valkeyUp) return t.skip('Valkey 사용 불가 — 레이트리밋은 열린다(fail-open)')
    const { token, id } = await member('레이트리밋')
    const { reset } = await import('../rate-limit.ts')
    await reset(API_RATE_NAMESPACE, id)
    const statuses: number[] = []
    for (let i = 0; i < API_RATE_RULE.limit; i += 1) statuses.push((await call(GET, { headers: headersFor(token) })).res.status)
    assert.ok(statuses.every((s) => s === 200), JSON.stringify(statuses))
    const over = await call(GET, { headers: headersFor(token) })
    assertError(over, 429, 'rate_limited')
    const retry = Number(over.res.headers.get('retry-after'))
    assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= API_RATE_RULE.windowSeconds, String(retry))
    await reset(API_RATE_NAMESPACE, id)
  })

  test('★ 본문 — 500KB 를 넘으면 400 validation_error · JSON 이 아니면 400 invalid_json · 받은 JSON 은 처리로 간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { token } = await member('본문')
    const post = (body: string, extra: Record<string, string> = {}) =>
      call(ECHO, { method: 'POST', headers: { ...headersFor(token), 'content-type': 'application/json', ...extra }, body }, 'http://localhost/v1/echo')
    const big = JSON.stringify({ text: 'x'.repeat(API_MAX_BODY_BYTES) })
    assertError(await post(big), 400, 'validation_error')
    // content-length 를 속여도(작게) 읽으며 센다
    const streamed = await ECHO(
      new Request('http://localhost/v1/echo', {
        method: 'POST',
        headers: { ...headersFor(token), 'content-type': 'application/json' },
        body: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(big))
            c.close()
          },
        }),
        duplex: 'half',
      } as RequestInit),
      route,
    )
    assert.equal(streamed.status, 400)
    assert.equal(((await streamed.json()) as { code: string }).code, 'validation_error')
    assertError(await post('{"broken":'), 400, 'invalid_json')
    const ok = await post(JSON.stringify({ hello: '세상' }))
    assert.equal(ok.res.status, 200)
    assert.deepEqual(ok.body, { echoed: { hello: '세상' } })
  })
})
