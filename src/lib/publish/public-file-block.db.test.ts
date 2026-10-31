// 공개 화면의 파일 블록(F-1a · 정본 §3.4 [보강 F-1] ⑤) — 블록 id 로 열고 · 종류와 타입이 맞아야 · 카드의 이름 · 크기.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { uploadFile } from '../file/file.ts'
import { setFileStorage, type FileStorage } from '../file/storage.ts'
import type { BlockId } from '../ids.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { readPublicBlockFile } from './public-file.ts'
import { publishPage } from './public-link.ts'
import { readPublicPage } from './public-read.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

const memoryStorage = (): FileStorage => {
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
})

after(async () => {
  setFileStorage(null)
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

async function office() {
  const ws = await createBareWorkspace('공개 파일 블록')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  return { ws, boss }
}

const PDF = new TextEncoder().encode('%PDF-1.4 가짜')

async function pdfOf(by: Actor, name: string): Promise<string> {
  const result = await uploadFile(by.ctx, { bytes: PDF, mime: 'application/pdf', originalName: name, kind: 'file' })
  assert.ok(result.ok, JSON.stringify(result))
  return result.file.id
}

const pageNamed = async (by: Actor, title: string): Promise<BlockId> =>
  (await createPage(by.ctx, { privateTop: true, title: titleFromPlainText(title) })).id

/** 파일 블록 하나(+ 이미지 블록 하나)를 본문으로 쓴다. 두 블록의 id. */
async function withBlocks(by: Actor, pageId: BlockId, fileSource: Record<string, unknown>, imageFileId: string | null) {
  const file = crypto.randomUUID()
  const image = crypto.randomUUID()
  const blocks: EditorBlock[] = [
    { id: crypto.randomUUID(), type: 'paragraph', title: [textRun('첨부')] },
    { id: file, type: 'file', title: [], properties: { source: fileSource, caption: [textRun('회의록')] } } as EditorBlock,
    ...(imageFileId === null ? [] : [{ id: image, type: 'image', title: [], properties: { source: { type: 'file', file_id: imageFileId } } } as EditorBlock]),
  ]
  const saved = await savePageBody(by.ctx, pageId, { blocks })
  assert.ok(saved.ok, JSON.stringify(saved))
  return { file, image }
}

async function tokenOf(by: Actor, pageId: string): Promise<string> {
  const result = await publishPage(by.ctx, pageId)
  assert.ok(result.ok, JSON.stringify(result))
  return result.value.token!
}

describe('① 파일 블록의 파일 — kind=file 로 연다', () => {
  test('★ 바이트 · MIME · 원본 이름을 준다 · 종류가 어긋나면(image) 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const page = await pageNamed(boss, '보고')
    const fileId = await pdfOf(boss, '보고서.pdf')
    const { file } = await withBlocks(boss, page, { type: 'file', file_id: fileId }, null)
    const token = await tokenOf(boss, page)
    const found = await readPublicBlockFile(token, file, 'file')
    assert.ok(found !== null)
    assert.equal(found.mime, 'application/pdf')
    assert.equal(found.originalName, '보고서.pdf')
    assert.equal(found.sizeBytes, PDF.byteLength)
    assert.deepEqual([...found.bytes], [...PDF])
    // 종류 ↔ 타입이 어긋나면 없는 것과 같다
    assert.equal(await readPublicBlockFile(token, file, 'image'), null)
  })

  test('이미지 블록을 kind=file 로 열면 없다 · 바깥 주소의 파일 블록은 파일이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const page = await pageNamed(boss, '섞임')
    const imagePng = await uploadFile(boss.ctx, {
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]),
      mime: 'image/png',
      originalName: null,
    })
    assert.ok(imagePng.ok)
    const { file, image } = await withBlocks(boss, page, { type: 'external', url: 'https://a.test/x.zip' }, imagePng.file.id)
    const token = await tokenOf(boss, page)
    assert.equal(await readPublicBlockFile(token, image, 'file'), null)
    assert.notEqual(await readPublicBlockFile(token, image, 'image'), null)
    assert.equal(await readPublicBlockFile(token, file, 'file'), null)
  })
})

describe('② 공개 읽기의 카드 메타', () => {
  test('★ view.files 에 이 워크스페이스 파일의 이름 · 크기 — 남의 워크스페이스 id 는 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const other = await office()
    const page = await pageNamed(boss, '메타')
    const mine = await pdfOf(boss, '내것.pdf')
    const theirs = await pdfOf(other.boss, '남의것.pdf')
    const a = crypto.randomUUID()
    const b = crypto.randomUUID()
    const blocks: EditorBlock[] = [
      { id: a, type: 'file', title: [], properties: { source: { type: 'file', file_id: mine } } } as EditorBlock,
      { id: b, type: 'file', title: [], properties: { source: { type: 'file', file_id: theirs } } } as EditorBlock,
    ]
    const saved = await savePageBody(boss.ctx, page, { blocks })
    assert.ok(saved.ok, JSON.stringify(saved))
    const token = await tokenOf(boss, page)
    const view = await readPublicPage(token)
    assert.ok(view.ok, JSON.stringify(view))
    assert.deepEqual(view.value.files.get(mine), { name: '내것.pdf', sizeBytes: PDF.byteLength })
    assert.equal(view.value.files.has(theirs), false)
    // 블록 자체는 문서에 남는다 — 카드를 그릴지는 화면이 메타로 정한다(없으면 그리지 않는다)
    assert.ok(view.value.doc.blocks.some((block) => block.id === b))
  })
})
