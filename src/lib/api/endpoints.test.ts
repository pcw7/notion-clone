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

import { API_ENDPOINT_GROUPS, API_ENDPOINTS, routeFileToPath, routeHandlers } from './endpoints.ts'

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

test('라우트 파일의 글 — v1Route(핸들러)만 · 받지 않는 메서드(unknownUrl)는 빠진다', () => {
  const source = [
    "const unknownUrl = v1Route(v1InvalidUrl)",
    'export const GET = v1Route(retrievePage)',
    'export const PATCH = v1Route(updateApiPage)',
    'export const POST = unknownUrl',
  ].join('\n')
  assert.deepEqual(routeHandlers(source), [
    { method: 'GET', handler: 'retrievePage' },
    { method: 'PATCH', handler: 'updateApiPage' },
  ])
})
