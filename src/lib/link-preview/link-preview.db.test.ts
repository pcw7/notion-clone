// 북마크 메타의 캐시(F-4a · 정본 §3.4 [보강 F-4] ① ② ④) — 살아 있는 캐시 · 음성 캐시 · http 는 건너뜀 · 동시 요청은 하나 · 만료 뒤 다시.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import type { HtmlResult } from '../net/outbound.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { ensureLinkPreview, normalizePreviewUrl, previewKey, readLinkPreviews } from './link-preview.ts'

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
  // 속도 제한(`consume`)이 연 Valkey 연결을 닫는다 — 두면 이 파일의 프로세스가 끝나지 않는다(login-code.db.test 와 같다)
  const { closeValkey } = await import('../valkey.ts')
  await closeValkey().catch(() => {})
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

let seq = 0
const uniqueUrl = (path: string) => `https://preview-${Date.now()}-${(seq += 1)}.example/${path}`
const RATE = { limit: 1000, windowSeconds: 60 }

async function someone() {
  const ws = await createBareWorkspace('메타')
  return joinAs(ws, await createUser('메타 쓰는 사람'), 'owner')
}

const html = (body: string, finalUrl: string): HtmlResult => ({ ok: true, status: 200, finalUrl, html: body, truncated: false })

describe('ensureLinkPreview', () => {
  test('★ 가져와 적고 두 번째는 캐시 — 가져오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const me = await someone()
    const url = uniqueUrl('a')
    let calls = 0
    const fetcher = async (u: string) => {
      calls += 1
      return html('<head><meta property="og:title" content="제목"><meta property="og:image" content="/c.png"></head>', u)
    }
    const first = await ensureLinkPreview(me.ctx, url, { fetcher, rate: RATE })
    assert.ok(first.ok)
    assert.equal(first.cached, false)
    assert.deepEqual(first.preview, { status: 'ok', title: '제목', description: null, imageUrl: new URL('/c.png', url).href, siteName: null })
    const second = await ensureLinkPreview(me.ctx, `${url}#section`, { fetcher, rate: RATE })
    assert.ok(second.ok)
    assert.equal(second.cached, true, '해시를 뗀 같은 주소')
    assert.equal(calls, 1)
    const read = await readLinkPreviews([url])
    assert.equal(read.get(normalizePreviewUrl(url) as string)?.title, '제목')
  })

  test('★ 못 가져온 것도 적는다(음성 캐시) · http 는 건너뛰고 막힌 모양은 실패 — 둘 다 가져오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const me = await someone()
    let calls = 0
    const failing = async () => {
      calls += 1
      return { ok: false, reason: 'http_error', status: 404, detail: 'HTTP 404' } as HtmlResult
    }
    const url = uniqueUrl('missing')
    const failed = await ensureLinkPreview(me.ctx, url, { fetcher: failing, rate: RATE })
    assert.deepEqual(failed.ok ? failed.preview.status : null, 'failed')
    await ensureLinkPreview(me.ctx, url, { fetcher: failing, rate: RATE })
    assert.equal(calls, 1, '음성 캐시')
    const http = await ensureLinkPreview(me.ctx, `http://plain-${Date.now()}.example/`, { fetcher: failing, rate: RATE })
    assert.deepEqual(http.ok ? http.preview : null, { status: 'skipped', title: null, description: null, imageUrl: null, siteName: null })
    const metadata = await ensureLinkPreview(me.ctx, 'https://169.254.169.254/latest/meta-data/', { fetcher: failing, rate: RATE })
    assert.deepEqual(metadata.ok ? metadata.preview.status : null, 'failed')
    assert.equal(calls, 1, 'http · 막힌 모양은 가져오지 않았다')
  })

  test('주소가 아니면 invalid_url · 속도 제한을 넘으면 rate_limited(캐시하지 않는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const me = await someone()
    assert.deepEqual(await ensureLinkPreview(me.ctx, 'javascript:alert(1)'), { ok: false, reason: 'invalid_url' })
    const fetcher = async (u: string) => html('<title>t</title>', u)
    const tight = { limit: 1, windowSeconds: 60 }
    const a = await ensureLinkPreview(me.ctx, uniqueUrl('r1'), { fetcher, rate: tight })
    const b = await ensureLinkPreview(me.ctx, uniqueUrl('r2'), { fetcher, rate: tight })
    assert.ok(a.ok)
    // Valkey 가 없으면 fail-open 이라 통과한다 — 그때는 이 단언을 건너뛴다
    if (!b.ok) assert.equal(b.reason, 'rate_limited')
  })

  test('★ 같은 주소의 동시 요청은 하나 · 만료 뒤에는 다시 가져온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const me = await someone()
    const url = uniqueUrl('flight')
    let calls = 0
    const slow = async (u: string) => {
      calls += 1
      await new Promise((r) => setTimeout(r, 50))
      return html('<title>느린</title>', u)
    }
    const [x, y] = await Promise.all([ensureLinkPreview(me.ctx, url, { fetcher: slow, rate: RATE }), ensureLinkPreview(me.ctx, url, { fetcher: slow, rate: RATE })])
    assert.ok(x.ok && y.ok)
    assert.equal(calls, 1)
    const later = new Date(Date.now() + 8 * 86400 * 1000)
    const again = await ensureLinkPreview(me.ctx, url, { fetcher: slow, rate: RATE, now: later })
    assert.ok(again.ok)
    assert.equal(again.cached, false)
    assert.equal(calls, 2)
    assert.equal(previewKey(normalizePreviewUrl(url) as string).length, 64)
  })
})
