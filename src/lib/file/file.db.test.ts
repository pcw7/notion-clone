/**
 * 파일 업로드 · 조회 — F-12-09 / F-09-08 (정본 §3.10)
 *
 * 이 파일이 지키는 것 셋.
 *
 *   ① **다른 워크스페이스의 파일은 없는 것과 같다.** id 를 찍어보는 것으로 존재를
 *      알아낼 수 없어야 한다 — 파일 id 는 uuid 라 추측이 어렵지만, 어렵다는 것은
 *      막았다는 뜻이 아니다.
 *   ② **행과 바이트가 어긋나지 않는다.** 스토리지에 먼저 쓰고 행을 만든다.
 *   ③ 정본이 요구한 값이 실제로 저장된다 — `storage_key`(URL 이 아니다) · `checksum` ·
 *      `ref_count` 0 · 리전.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { getFile, readFile, uploadFile } from './file.ts'
import { setFileStorage, type FileStorage } from './storage.ts'
import { MAX_UPLOAD_BYTES } from './limits.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture

/** 디스크를 건드리지 않는 드라이버. 무엇이 저장됐는지 그대로 들여다본다. */
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

const png = (size = 8): Uint8Array => new Uint8Array(size).fill(137)

describe('uploadFile — 받아서 저장한다', () => {
  test('행과 바이트가 함께 생긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const result = await uploadFile(fx.owner.ctx, {
      bytes: png(16),
      mime: 'image/png',
      originalName: '사진.png',
    })
    assert.ok(result.ok, JSON.stringify(result))
    assert.equal(result.file.sizeBytes, 16)
    assert.equal(result.file.originalName, '사진.png')
    assert.equal(result.file.refCount, 0, '붙기 전에는 아무도 참조하지 않는다')
    assert.equal(storage.store.get(result.file.storageKey)?.byteLength, 16)
  })

  test('★ 저장하는 것은 storage_key 다 — URL 이 아니다 (정본 §3.10)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const result = await uploadFile(fx.owner.ctx, { bytes: png(), mime: 'image/png', originalName: null })
    assert.ok(result.ok)
    assert.ok(!result.file.storageKey.includes('://'), result.file.storageKey)
    // 워크스페이스 접두어 + 파일 id + MIME 이 정한 확장자.
    assert.equal(result.file.storageKey, `${fx.owner.ctx.workspaceId}/${result.file.id}.png`)
  })

  test('checksum 은 같은 바이트를 같은 값으로 만든다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const a = await uploadFile(fx.owner.ctx, { bytes: png(32), mime: 'image/png', originalName: null })
    const b = await uploadFile(fx.owner.ctx, { bytes: png(32), mime: 'image/png', originalName: null })
    assert.ok(a.ok && b.ok)
    assert.equal(a.file.checksum, b.file.checksum)
    assert.notEqual(a.file.id, b.file.id, '같은 바이트라도 별개의 파일이다')
    assert.notEqual(a.file.storageKey, b.file.storageKey)
  })

  test('거부한 업로드는 스토리지에도 남기지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const before = storage.store.size
    const tooBig = await uploadFile(fx.owner.ctx, {
      bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1),
      mime: 'image/png',
      originalName: null,
    })
    const wrongType = await uploadFile(fx.owner.ctx, {
      bytes: png(),
      mime: 'image/svg+xml',
      originalName: null,
    })
    assert.equal(tooBig.ok, false)
    assert.equal(wrongType.ok, false)
    assert.equal(storage.store.size, before)
  })
})

describe('읽기 — 워크스페이스 밖은 없는 것과 같다', () => {
  test('올린 것을 그대로 읽는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const uploaded = await uploadFile(fx.owner.ctx, { bytes: png(4), mime: 'image/gif', originalName: null })
    assert.ok(uploaded.ok)
    const read = await readFile(fx.owner.ctx, uploaded.file.id)
    assert.ok(read)
    assert.deepEqual(read.bytes, png(4))
    assert.equal(read.file.mime, 'image/gif')
  })

  test('★ 다른 워크스페이스의 파일은 보이지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const other = await makeFixture()
    const uploaded = await uploadFile(other.owner.ctx, { bytes: png(), mime: 'image/png', originalName: null })
    assert.ok(uploaded.ok)
    // 바이트는 스토리지에 있지만(같은 드라이버) 다른 워크스페이스에서는 조회되지 않는다.
    assert.ok(storage.store.has(uploaded.file.storageKey))
    assert.equal(await getFile(fx.owner.ctx, uploaded.file.id), null)
    assert.equal(await readFile(fx.owner.ctx, uploaded.file.id), null)
  })

  test('없는 id 는 null', async (t) => {
    if (skipReason) return t.skip(skipReason)
    assert.equal(await getFile(fx.owner.ctx, randomUUID()), null)
  })

  test('★ 행은 있는데 바이트가 없으면 null — 빈 내용으로 둔갑시키지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const uploaded = await uploadFile(fx.owner.ctx, { bytes: png(), mime: 'image/png', originalName: null })
    assert.ok(uploaded.ok)
    storage.store.delete(uploaded.file.storageKey) // 저장 폴더를 지운 상황
    assert.ok(await getFile(fx.owner.ctx, uploaded.file.id), '메타데이터는 남아 있다')
    assert.equal(await readFile(fx.owner.ctx, uploaded.file.id), null)
  })
})
