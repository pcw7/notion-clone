/**
 * 공개 화면의 파일 — 게시 · 공유 6a-2b조각 (F-06-08 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.3 끝 [보강] 공개 화면 ⑨).
 *
 *   ① 열린 페이지의 이미지 블록 · 이미지 아이콘은 그 파일을 준다 — 색인 설정과 함께
 *   ② ★ 블록이 든 페이지가 이 토큰으로 열려야 한다 — 상속을 끊은 하위 · 공개 밖의 페이지의 이미지는 없다
 *   ③ ★ 블록이 **지금** 가리키는 파일만 — 종류가 다르면(이미지 주소로 페이지 · 아이콘 주소로 이미지) 없다 · 이모지 아이콘 · 바깥
 *      주소 이미지는 없다 · 블록에 남의 워크스페이스 파일 id 를 박아도 없다
 *   ④ 해제 · 만료 · 모양이 틀린 id 는 없다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import type { EditorBlock } from '../editor/document.ts'
import { uploadFile } from '../file/file.ts'
import { setFileStorage, type FileStorage } from '../file/storage.ts'
import type { BlockId } from '../ids.ts'
import { stopInheriting } from '../permissions/acl.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { readPublicBlockFile } from './public-file.ts'
import { publishPage, unpublishPage } from './public-link.ts'

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

// ── 도우미 ────────────────────────────────────────────────────────────

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)}`

async function office() {
  const ws = await createBareWorkspace('공개 파일')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  return { ws, boss }
}

const PNG = (fill: number): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, fill, fill, fill, fill])

async function fileOf(by: Actor, fill: number): Promise<string> {
  const result = await uploadFile(by.ctx, { bytes: PNG(fill), mime: 'image/png', originalName: null })
  assert.ok(result.ok, JSON.stringify(result))
  return result.file.id
}

const pageNamed = async (by: Actor, title: string, parent?: BlockId): Promise<BlockId> =>
  (await createPage(by.ctx, parent === undefined ? { privateTop: true, title: titleFromPlainText(title) } : { parentPageId: parent, title: titleFromPlainText(title) })).id

/** 이미지 블록 하나(+ 이미 있는 하위 참조)를 본문으로 쓴다. 그 블록의 id. */
async function withImage(by: Actor, pageId: BlockId, source: Record<string, unknown>, refs: readonly string[] = []): Promise<string> {
  const id = crypto.randomUUID()
  const blocks: EditorBlock[] = [
    { id: crypto.randomUUID(), type: 'paragraph', title: [textRun('사진')] },
    { id, type: 'image', title: [], properties: { source } } as EditorBlock,
    ...refs.map((ref) => ({ id: ref, type: 'page', title: [] }) as EditorBlock),
  ]
  const saved = await savePageBody(by.ctx, pageId, { blocks })
  assert.ok(saved.ok, JSON.stringify(saved))
  return id
}

async function tokenOf(by: Actor, pageId: string): Promise<string> {
  const result = await publishPage(by.ctx, pageId)
  assert.ok(result.ok, JSON.stringify(result))
  return result.value.token!
}

const fillOf = async (token: string, blockId: string, kind: 'image' | 'icon') => {
  const file = await readPublicBlockFile(token, blockId, kind)
  return file === null ? null : file.bytes[8]
}

// ── ① 준다 ────────────────────────────────────────────────────────────

describe('① 열린 페이지의 이미지 · 아이콘', () => {
  test('이미지 블록의 파일 · 이미지 아이콘의 파일 — 색인 설정과 함께', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('사진첩'))
    const image = await withImage(boss, doc, { type: 'file', file_id: await fileOf(boss, 7) })
    const iconFile = await fileOf(boss, 9)
    await query(`UPDATE block SET format = jsonb_set(coalesce(format, '{}'::jsonb), '{page_icon}', $2::jsonb) WHERE id = $1`, [
      doc,
      JSON.stringify({ type: 'file', file_id: iconFile }),
    ])
    const token = await tokenOf(boss, doc)

    const file = await readPublicBlockFile(token, image, 'image')
    assert.ok(file)
    assert.equal(file.mime, 'image/png')
    assert.equal(file.bytes[8], 7)
    assert.equal(file.robots, 'noindex')
    assert.equal(file.aiCrawler, 'deny')
    assert.equal(await fillOf(token, doc, 'icon'), 9)
  })
})

// ── ② 블록이 든 페이지가 열려야 ───────────────────────────────────────

describe('② ★ 블록이 든 페이지가 이 토큰으로 열려야', () => {
  test('열린 하위는 준다 · 상속을 끊은 하위 · 공개 밖의 페이지의 이미지는 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('루트'))
    const open = await pageNamed(boss, '열린 하위', doc)
    const cut = await pageNamed(boss, '닫힌 하위', doc)
    const elsewhere = await pageNamed(boss, unique('공개 밖'))
    const openImage = await withImage(boss, open, { type: 'file', file_id: await fileOf(boss, 1) })
    const cutImage = await withImage(boss, cut, { type: 'file', file_id: await fileOf(boss, 2) })
    const outsideImage = await withImage(boss, elsewhere, { type: 'file', file_id: await fileOf(boss, 3) })
    assert.ok((await stopInheriting(boss.ctx, cut)).ok)
    const token = await tokenOf(boss, doc)

    assert.equal(await fillOf(token, openImage, 'image'), 1)
    assert.equal(await fillOf(token, cutImage, 'image'), null)
    assert.equal(await fillOf(token, outsideImage, 'image'), null)
  })
})

// ── ③ 지금 가리키는 파일만 ────────────────────────────────────────────

describe('③ ★ 블록이 지금 가리키는 파일만', () => {
  test('종류가 다르면 없다 · 이모지 아이콘 · 바깥 주소 이미지는 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('종류'))
    const image = await withImage(boss, doc, { type: 'file', file_id: await fileOf(boss, 4) })
    await query(`UPDATE block SET format = jsonb_set(coalesce(format, '{}'::jsonb), '{page_icon}', $2::jsonb) WHERE id = $1`, [
      doc,
      JSON.stringify({ type: 'emoji', emoji: '📷' }),
    ])
    const token = await tokenOf(boss, doc)

    assert.equal(await fillOf(token, image, 'icon'), null, '아이콘 주소로 이미지 블록')
    assert.equal(await fillOf(token, doc, 'image'), null, '이미지 주소로 페이지')
    assert.equal(await fillOf(token, doc, 'icon'), null, '이모지 아이콘에는 파일이 없다')

    const other = await pageNamed(boss, unique('바깥 주소'))
    const external = await withImage(boss, other, { type: 'external', url: 'https://example.com/a.png' })
    const otherToken = await tokenOf(boss, other)
    assert.equal(await fillOf(otherToken, external, 'image'), null)
  })

  test('블록에 남의 워크스페이스 파일 id 를 박아도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const stranger = await office()
    const theirs = await fileOf(stranger.boss, 5)
    const doc = await pageNamed(boss, unique('남의 파일'))
    const image = await withImage(boss, doc, { type: 'file', file_id: await fileOf(boss, 6) })
    await query(`UPDATE block SET properties = jsonb_set(properties, '{source,file_id}', to_jsonb($2::text)) WHERE id = $1`, [image, theirs])
    const token = await tokenOf(boss, doc)
    assert.equal(await fillOf(token, image, 'image'), null)
  })
})

// ── ④ 해제 · 만료 · 모양 ──────────────────────────────────────────────

describe('④ 해제 · 만료 · 모양', () => {
  test('해제하면 없다 · 만료되면 없다 · 모양이 틀린 id 는 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('닫기'))
    const image = await withImage(boss, doc, { type: 'file', file_id: await fileOf(boss, 8) })
    const token = await tokenOf(boss, doc)
    assert.equal(await fillOf(token, image, 'image'), 8)

    assert.ok((await unpublishPage(boss.ctx, doc)).ok)
    assert.equal(await fillOf(token, image, 'image'), null)
    await tokenOf(boss, doc)
    await query(`UPDATE public_link SET expires_at = now() - interval '1 minute' WHERE node_id = $1`, [doc])
    assert.equal(await fillOf(token, image, 'image'), null)
    assert.equal(await readPublicBlockFile(token, 'not-a-uuid', 'image'), null)
  })
})
