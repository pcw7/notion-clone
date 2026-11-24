/**
 * 개발자 문서의 주소 표 ↔ `/v1` 라우트 파일 (API-6 · F-09-15 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] · 09 F-09-15 — 문서가 라우트와 어긋나지 않게(드리프트) 한 목록에서 그린다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@notionhq/client'

import {
  API_ENDPOINT_GROUPS,
  API_ENDPOINTS,
  API_UNSUPPORTED,
  UNSUPPORTED_FAMILIES,
  routeFileToPath,
  routeHandlers,
  unsupportedEndpoint,
  unsupportedMessage,
} from './endpoints.ts'

const APP = fileURLToPath(new URL('../../app', import.meta.url))

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? routeFiles(join(dir, e.name)) : e.name === 'route.ts' ? [join(dir, e.name)] : [],
  )
}

/** 라우트 파일들이 실제로 여는 것 — `METHOD 주소 → 핸들러`. */
function servedByRoutes(): string[] {
  return routeFiles(join(APP, 'v1')).flatMap((file) => {
    const path = routeFileToPath(relative(APP, file))
    if (path === null) return []
    return routeHandlers(readFileSync(file, 'utf8')).map((r) => `${r.method} ${path} → ${r.handler}`)
  })
}

test('★ 문서의 주소 표가 /v1 라우트 파일과 하나도 다르지 않다 — 메서드 · 주소 · 핸들러', () => {
  const documented = API_ENDPOINTS.map((e) => `${e.method} ${e.path} → ${e.handler}`)
  assert.deepEqual([...documented].sort(), servedByRoutes().sort())
})

test('표의 줄은 겹치지 않고 · 주소마다 SDK 메서드 · 설명이 있다', () => {
  const keys = API_ENDPOINTS.map((e) => `${e.method} ${e.path}`)
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(new Set(API_ENDPOINTS.map((e) => e.sdk)).size, API_ENDPOINTS.length)
  for (const e of API_ENDPOINTS) {
    assert.match(e.path, /^\/v1\//)
    assert.ok(e.summary.trim() !== '' && e.sdk.trim() !== '', e.path)
  }
  assert.ok(API_ENDPOINT_GROUPS.every((g) => g.endpoints.length > 0))
})

test('라우트 파일의 자리 → 주소 — 경로 변수는 {이름} · 그물(`[...path]`)과 라우트가 아닌 파일은 null', () => {
  assert.equal(routeFileToPath('v1/pages/[page_id]/properties/[property_id]/route.ts'), '/v1/pages/{page_id}/properties/{property_id}')
  assert.equal(routeFileToPath('v1\\users\\me\\route.ts'), '/v1/users/me')
  assert.equal(routeFileToPath('v1/[...path]/route.ts'), null)
  assert.equal(routeFileToPath('v1/pages/page.tsx'), null)
  assert.equal(routeFileToPath('api/v1/route.ts'), null)
})

/**
 * 공식 SDK 의 메서드마다 실제로 보내는 `METHOD /v1/주소` — 가짜 fetch 로 잡는다(경로 변수는 `{이름}`). 메서드는 `Client` 의 함수인 잎을
 * 걷는다(내부 `request` 는 뺀다).
 */
async function sdkCalls(): Promise<Map<string, string>> {
  let captured = ''
  const fakeFetch = async (url: string, init?: { method?: string }) => {
    captured = `${String(init?.method ?? 'GET').toUpperCase()} ${decodeURIComponent(new URL(url).pathname)}`
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const client = new Client({ auth: 'ntn_test', baseUrl: 'http://sdk.invalid', fetch: fakeFetch as never, retry: false, logLevel: 'error' as never })
  const methods: [string, (args: unknown) => unknown][] = []
  const walk = (obj: object, prefix: string, seen: Set<object>) => {
    if (seen.has(obj)) return
    seen.add(obj)
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'request' || key.startsWith('_')) continue
      const path = prefix === '' ? key : `${prefix}.${key}`
      if (typeof value === 'function') methods.push([path, value as (args: unknown) => unknown])
      else if (typeof value === 'object' && value !== null) walk(value, path, seen)
    }
  }
  walk(client, '', new Set())
  // 경로 변수는 그 이름을 `{이름}` 으로 돌려주는 인자 — 몸체 · 질의의 키는 없는 것처럼
  const args = new Proxy({}, { get: (_, key) => (typeof key === 'string' ? `{${key}}` : undefined), has: () => false, ownKeys: () => [] })
  const calls = new Map<string, string>()
  for (const [name, method] of methods) {
    captured = ''
    try {
      const out = method(args) as { then?: unknown; [Symbol.asyncIterator]?: () => AsyncIterator<unknown> } | undefined
      if (out && typeof out.then === 'function') await (out as Promise<unknown>).catch(() => undefined)
      else if (out && typeof out[Symbol.asyncIterator] === 'function') await out[Symbol.asyncIterator]!().next().catch(() => undefined)
    } catch {
      // 잡은 요청만 본다
    }
    calls.set(name, captured)
  }
  return calls
}

test('★ SDK 대조(⑭ ②) — 공식 SDK 의 메서드는 모두 받는 주소나 받지 않는 주소에 있고 · 메서드 · 주소가 SDK 가 보내는 것과 같다', async () => {
  const calls = await sdkCalls()
  assert.ok(calls.size >= 60, `SDK 메서드 ${calls.size}개`)
  const ours = new Map(API_ENDPOINTS.map((e) => [e.sdk, `${e.method} ${e.path}`]))
  const gaps = new Map(API_UNSUPPORTED.map((e) => [e.sdk, `${e.method} ${e.path}`]))
  for (const [sdk, call] of calls) {
    const listed = ours.get(sdk) ?? gaps.get(sdk)
    assert.ok(listed !== undefined, `${sdk}(${call}) 가 어느 표에도 없다 — endpoints.ts 에 더한다`)
    assert.equal(listed, call, sdk)
    assert.ok(!(ours.has(sdk) && gaps.has(sdk)), `${sdk} 가 두 표에 다 있다`)
  }
  for (const sdk of [...ours.keys(), ...gaps.keys()]) assert.ok(calls.has(sdk), `${sdk} 는 SDK 에 없다`)
  // 이 조각이 센 수 — ✅ 33 · 400 29 · 해당 없음(OAuth) 3
  const na = API_UNSUPPORTED.filter((e) => !UNSUPPORTED_FAMILIES[e.family].applicable).length
  assert.deepEqual([ours.size, gaps.size - na, na], [33, 29, 3])
})

test('받지 않는 주소 — 메서드 · 주소 틀로 맞추고(끝의 / 는 뗀다) · 받는 주소와 겹치지 않는다 · 글은 SDK 메서드와 까닭', () => {
  assert.equal(unsupportedEndpoint('GET', '/v1/pages/abc/markdown')?.sdk, 'pages.retrieveMarkdown')
  assert.equal(unsupportedEndpoint('patch', '/v1/pages/abc/markdown/')?.sdk, 'pages.updateMarkdown')
  assert.equal(unsupportedEndpoint('POST', '/v1/blocks/meeting_notes')?.sdk, 'blocks.meetingNotes.create')
  assert.equal(unsupportedEndpoint('POST', '/v1/sessions')?.sdk, 'sessions.update')
  assert.equal(unsupportedEndpoint('POST', '/v1/agents/query')?.sdk, 'agents.query')
  assert.equal(unsupportedEndpoint('GET', '/v1/agents/a1')?.sdk, 'agents.retrieve')
  assert.equal(unsupportedEndpoint('POST', '/v1/oauth/token')?.family, 'oauth')
  assert.equal(unsupportedEndpoint('DELETE', '/v1/pages/abc/markdown'), null)
  assert.equal(unsupportedEndpoint('GET', '/v1/views/v/queries'), null)
  assert.equal(unsupportedEndpoint('GET', '/v1/nothing'), null)
  for (const e of API_ENDPOINTS) assert.equal(unsupportedEndpoint(e.method, e.path.replace(/\{[^}]+\}/g, 'x')), null, `${e.method} ${e.path}`)
  assert.match(unsupportedMessage(unsupportedEndpoint('GET', '/v1/views')!), /^views\.list \(GET \/v1\/views\) is not supported by this server: /)
  for (const f of Object.values(UNSUPPORTED_FAMILIES)) assert.ok(f.title !== '' && f.reason !== '' && f.message !== '')
})

test('라우트 파일의 글 — v1Route(핸들러)만 · 받지 않는 메서드(unknownUrl)는 빠진다', () => {
  const source = [
    "const unknownUrl = v1Route(v1InvalidUrl)",
    'export const GET = v1Route(retrievePage)',
    'export const PATCH = v1Route(updateApiPage)',
    'export const POST = unknownUrl',
    "export const PUT = v1Route(sendApiFileUpload, { body: 'multipart' })",
  ].join('\n')
  assert.deepEqual(routeHandlers(source), [
    { method: 'GET', handler: 'retrievePage' },
    { method: 'PATCH', handler: 'updateApiPage' },
    { method: 'PUT', handler: 'sendApiFileUpload' },
  ])
})
