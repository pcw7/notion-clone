/**
 * 올린 이미지 커버의 파일 참조 — 34번 트랙 PC-2 (F-02-06 · DB)
 *
 * 정본: §3.4 [보강 PC-2] 올린 이미지 커버 · §3.10 `file.ref_count`(불변식 FS1 — `ref_count > 0` 은 지우지 않는다)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 커버로 단 파일은 그 파일의 참조다 — 바꾸면 옛 파일은 내리고 새 파일은 올린다 · 같은 파일이면 그대로 · 지우면 내린다
 *   ② 받지 않는 것(없는 파일 · 다른 워크스페이스의 파일 · 이미지가 아닌 파일)은 아무것도 바꾸지 않는다
 *   ③ 아이콘과 커버가 같은 파일이면 참조가 둘이다 — 한쪽을 바꿔도 다른 쪽의 참조는 남는다
 *   ④ 복제한 페이지 · 템플릿으로 만든 행 · 복제한 데이터베이스의 행은 같은 파일을 가리키고 참조가 하나 더 생긴다(다시 올리지 않는다)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createPage, getPage, setPageCover, setPageIcon, titleFromPlainText, PageError } from '../block/page.ts'
import { duplicatePage } from '../block/duplicate.ts'
import { pageCoverOfFormat, type PageCover } from '../block/page-cover.ts'
import { createDatabase } from '../database/database.ts'
import { duplicateDatabase } from '../database/duplicate-database.ts'
import { createRow } from '../database/row.ts'
import { createRowFromTemplate, createTemplate } from '../database/template.ts'
import type { BlockId } from '../ids.ts'
import { setFileStorage, type FileStorage } from './storage.ts'
import { uploadFile } from './file.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let other: Fixture

function memoryStorage(): FileStorage {
  const store = new Map<string, Uint8Array>()
  return {
    kind: 'memory',
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

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  setFileStorage(memoryStorage())
  fx = await makeFixture()
  other = await makeFixture()
})

after(async () => {
  setFileStorage(null)
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}
const fileCover = (fileId: string): PageCover => ({ type: 'file', file_id: fileId })

async function upload(f: Fixture = fx): Promise<string> {
  const out = await uploadFile(f.owner.ctx, { bytes: new Uint8Array(16).fill(137), mime: 'image/png', originalName: 'cover.png' })
  assert.equal(out.ok, true)
  if (!out.ok) throw new Error('unreachable')
  return out.file.id
}

async function refCount(fileId: string): Promise<number> {
  const [row] = await query<{ ref_count: number }>(`SELECT ref_count FROM file WHERE id = $1`, [fileId])
  return row.ref_count
}

async function storedCover(pageId: string): Promise<PageCover | null> {
  const [row] = await query<{ format: unknown }>(`SELECT format FROM block WHERE id = $1`, [pageId])
  return pageCoverOfFormat(row.format)
}

const newPage = async (title: string): Promise<BlockId> => (await createPage(fx.owner.ctx, { title: titleFromPlainText(title) })).id

describe('① 바꾸기의 장부', () => {
  test('★ 커버로 단 파일은 참조가 하나 — 바꾸면 옛 파일은 내리고 새 파일은 올린다 · 같은 파일이면 그대로 · 지우면 내린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('커버 장부')
    const [a, b] = [await upload(), await upload()]

    assert.deepEqual(await setPageCover(fx.owner.ctx, page, fileCover(a.toUpperCase())), fileCover(a), 'id 는 소문자로 저장된다')
    assert.equal(await refCount(a), 1)
    assert.deepEqual((await getPage(fx.owner.ctx, page))?.cover, fileCover(a))

    await setPageCover(fx.owner.ctx, page, fileCover(a))
    assert.equal(await refCount(a), 1, '같은 파일 — 다시 세지 않는다')

    await setPageCover(fx.owner.ctx, page, fileCover(b))
    assert.deepEqual([await refCount(a), await refCount(b)], [0, 1], '바꾸면 옛 파일 −1 · 새 파일 +1')

    await setPageCover(fx.owner.ctx, page, { type: 'gallery', gallery: 'gradient_1' })
    assert.equal(await refCount(b), 0, '내장 커버로 — 옛 파일을 내린다')
    await setPageCover(fx.owner.ctx, page, fileCover(b))
    await setPageCover(fx.owner.ctx, page, null)
    assert.equal(await refCount(b), 0, '지우면 — 옛 파일을 내린다')
    assert.equal(await storedCover(page), null)
  })
})

describe('② 받지 않는 것', () => {
  test('★ 없는 파일 · 다른 워크스페이스의 파일 · 이미지가 아닌 파일 — invalid_cover · 아무것도 바뀌지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('거부')
    const mine = await upload()
    await setPageCover(fx.owner.ctx, page, fileCover(mine))
    const theirs = await upload(other)
    const pdf = randomUUID()
    await query(
      `INSERT INTO file (id, workspace_id, region_id, storage_key, mime, size_bytes, ref_count, created_at)
       SELECT $1, $2, region_id, $3, 'application/pdf', 10, 0, now() FROM workspace WHERE id = $2`,
      [pdf, fx.workspaceId, `test/${pdf}.pdf`],
    )
    for (const [fileId, label] of [
      [randomUUID(), '없는 파일'],
      [theirs, '다른 워크스페이스의 파일'],
      [pdf, '이미지가 아닌 파일'],
    ] as const) {
      await assert.rejects(
        () => setPageCover(fx.owner.ctx, page, fileCover(fileId)),
        (e: unknown) => e instanceof PageError && e.code === 'invalid_cover',
        label,
      )
    }
    assert.deepEqual(await storedCover(page), fileCover(mine))
    assert.deepEqual([await refCount(mine), await refCount(theirs), await refCount(pdf)], [1, 0, 0], '거부한 뒤에 장부가 움직였다')
  })
})

describe('③ 아이콘과 커버가 같은 파일', () => {
  test('참조가 둘이다 — 커버를 바꿔도 아이콘의 참조는 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('같은 그림')
    const a = await upload()
    await setPageIcon(fx.owner.ctx, page, { type: 'file', file_id: a })
    await setPageCover(fx.owner.ctx, page, fileCover(a))
    assert.equal(await refCount(a), 2)
    await setPageCover(fx.owner.ctx, page, null)
    assert.equal(await refCount(a), 1, '아이콘의 참조는 남는다')
  })
})

describe('④ 복제 · 템플릿 · 데이터베이스 복제', () => {
  test('★ 복제한 페이지는 같은 파일을 가리키고 참조가 하나 더 — 아이콘과 커버가 같은 파일이면 둘 더', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('복제할 커버')
    const [a, b] = [await upload(), await upload()]
    await setPageCover(fx.owner.ctx, page, fileCover(a))
    const copy = await duplicatePage(fx.owner.ctx, page)
    assert.deepEqual(await storedCover(copy.page.id), fileCover(a), '사본은 같은 파일을 가리킨다(다시 올리지 않는다)')
    assert.equal(await refCount(a), 2)

    const both = await newPage('아이콘과 커버가 같은 그림')
    await setPageIcon(fx.owner.ctx, both, { type: 'file', file_id: b })
    await setPageCover(fx.owner.ctx, both, fileCover(b))
    await duplicatePage(fx.owner.ctx, both)
    assert.equal(await refCount(b), 4, '원본 둘 · 사본 둘')
  })

  test('★ 템플릿으로 만든 행 · 내용째 복제한 데이터베이스의 행도 참조가 하나 더', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = unwrap(await createDatabase(fx.owner.ctx, { name: '커버 템플릿 표' }))
    const template = unwrap(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '커버 틀' }))
    const a = await upload()
    await setPageCover(fx.owner.ctx, template.id as BlockId, fileCover(a))
    const made = unwrap(await createRowFromTemplate(fx.owner.ctx, table.dataSourceId, template.id))
    assert.deepEqual(await storedCover(made.row.id), fileCover(a))
    assert.equal(await refCount(a), 2, '템플릿 · 그것으로 만든 행')

    const shelf = unwrap(await createDatabase(fx.owner.ctx, { name: '복제할 커버 표' }))
    const row = unwrap(await createRow(fx.owner.ctx, shelf.dataSourceId))
    const b = await upload()
    await setPageCover(fx.owner.ctx, row.id as BlockId, fileCover(b))
    unwrap(await duplicateDatabase(fx.owner.ctx, shelf.id, { content: true }))
    assert.equal(await refCount(b), 2, '원본 행 · 복제한 데이터베이스의 행')
  })
})
