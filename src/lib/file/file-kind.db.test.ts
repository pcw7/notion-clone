// 올리기의 쓰임 `kind`(F-1a · 정본 §3.4 [보강 F-1] ②) — 이미지는 4종만 · 파일은 무엇이든 · 저장 키는 bin · MIME 이 비면 octet-stream.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { getFile, uploadFile } from './file.ts'
import { MAX_UPLOAD_BYTES, OCTET_STREAM } from './limits.ts'
import { setFileStorage, type FileStorage } from './storage.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''
let fx: Fixture

function memoryStorage(): FileStorage & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>()
  return {
    kind: 'memory',
    store,
    async put(key, bytes) {
      store.set(key, bytes)
    },
    async read(key) {
      return store.get(key) ?? null
    },
    async remove(key) {
      store.delete(key)
    },
  }
}
const storage = memoryStorage()

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  setFileStorage(storage)
})

after(async () => {
  setFileStorage(null)
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const text = (): Uint8Array => new TextEncoder().encode('<html>안녕</html>')

describe('uploadFile — kind (F-1a)', () => {
  test('★ kind=file 은 MIME 을 제한하지 않는다 — 저장 키는 .bin · 이름 · MIME 은 그대로 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const result = await uploadFile(fx.owner.ctx, { bytes: text(), mime: 'text/html', originalName: '악성.html', kind: 'file' })
    assert.ok(result.ok, JSON.stringify(result))
    assert.equal(result.file.mime, 'text/html')
    assert.equal(result.file.originalName, '악성.html')
    assert.ok(result.file.storageKey.endsWith('.bin'), result.file.storageKey)
    assert.ok(storage.store.has(result.file.storageKey))
    const again = await getFile(fx.owner.ctx, result.file.id)
    assert.equal(again?.mime, 'text/html')
  })

  test('MIME 이 비면 octet-stream 으로 적는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const result = await uploadFile(fx.owner.ctx, { bytes: text(), mime: '', originalName: 'noext', kind: 'file' })
    assert.ok(result.ok, JSON.stringify(result))
    assert.equal(result.file.mime, OCTET_STREAM)
  })

  test('kind 가 없으면 이미지다 — 텍스트는 지금처럼 거부한다 · kind=image 도 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const implicit = await uploadFile(fx.owner.ctx, { bytes: text(), mime: 'text/plain', originalName: 'a.txt' })
    assert.deepEqual(implicit, { ok: false, reason: 'unsupported_type' })
    const explicit = await uploadFile(fx.owner.ctx, { bytes: text(), mime: 'text/plain', originalName: 'a.txt', kind: 'image' })
    assert.deepEqual(explicit, { ok: false, reason: 'unsupported_type' })
  })

  test('크기 · 빈 파일 · 이름 한도는 둘이 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const big = await uploadFile(fx.owner.ctx, { bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1), mime: 'application/zip', originalName: 'a.zip', kind: 'file' })
    assert.deepEqual(big, { ok: false, reason: 'too_large' })
    const empty = await uploadFile(fx.owner.ctx, { bytes: new Uint8Array(0), mime: 'application/zip', originalName: 'a.zip', kind: 'file' })
    assert.deepEqual(empty, { ok: false, reason: 'empty_file' })
    const longName = await uploadFile(fx.owner.ctx, { bytes: text(), mime: 'application/zip', originalName: '가'.repeat(301), kind: 'file' })
    assert.deepEqual(longName, { ok: false, reason: 'name_too_long' })
  })

  test('kind=file 로 올린 PNG 는 MIME 이 이미지라 저장 키도 png 다(서빙이 inline 으로 연다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const result = await uploadFile(fx.owner.ctx, { bytes: png, mime: 'image/png', originalName: 'a.png', kind: 'file' })
    assert.ok(result.ok, JSON.stringify(result))
    assert.ok(result.file.storageKey.endsWith('.png'), result.file.storageKey)
  })
})
