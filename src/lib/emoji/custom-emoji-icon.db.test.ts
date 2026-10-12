/**
 * 커스텀 이모지를 아이콘으로 — 인접 제품 7c-2a조각 (F-13-16 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.4 [보강] 커스텀 이모지 ⑤ · 마이그레이션 0097).
 *
 *   ① ★ 페이지 아이콘 — 살아 있는 이모지를 단다(저장 모양은 id 만) · 이모지 파일의 참조는 그대로 · 올린 파일 아이콘에서 바꾸면 그
 *      파일의 참조가 내린다
 *   ② ★ 거부 — 다른 워크스페이스의 이모지 · 지운 이모지 · 없는 id 는 `invalid_icon`
 *   ③ 데이터베이스 아이콘도 같다
 *   ④ ★ 지워도 달린 아이콘은 남는다 — 그림은 더 주지 않는다(살아 있을 때는 게스트도 받는다 · 다른 워크스페이스는 못 받는다)
 *   ⑤ ★ 공개 화면 — 아이콘의 공개 파일 경로가 이모지의 그림을 준다 · 지우면 경로도 닫히고 화면의 아이콘이 없어진다
 *   ⑥ DB 가 모양을 막는다 — 이름 · 주소를 실은 모양 · 안쪽이 객체가 아닌 모양
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, PageError, setPageIcon, titleFromPlainText } from '../block/page.ts'
import { pageIconOfFormat, type PageIcon } from '../block/page-icon.ts'
import { createDatabase, getDatabase, setDatabaseIcon } from '../database/database.ts'
import { query } from '../db/pool.ts'
import { uploadFile } from '../file/file.ts'
import { setFileStorage, type FileStorage } from '../file/storage.ts'
import type { BlockId } from '../ids.ts'
import { readPublicBlockFile } from '../publish/public-file.ts'
import { publishPage } from '../publish/public-link.ts'
import { readPublicPage } from '../publish/public-read.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createCustomEmoji, deleteCustomEmoji, readCustomEmojiImage } from './custom-emoji.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''

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
})

after(async () => {
  setFileStorage(null)
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

// ── 도우미 ────────────────────────────────────────────────────────────

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

let seq = 0

async function team() {
  const ws = await createBareWorkspace('이모지 아이콘')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const guest = await joinAs(ws, await createUser('손님'), 'guest')
  return { ws, boss, guest }
}

/** 그림 한 장 — 바이트 9번째 칸이 `fill` 이다(어느 그림이 왔는지 읽는다). */
async function imageOf(who: Actor, fill: number): Promise<string> {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, fill, fill, fill, fill])
  const out = await uploadFile(who.ctx, { bytes, mime: 'image/png', originalName: 'emoji.png' })
  assert.ok(out.ok, JSON.stringify(out))
  return out.file.id
}

async function emojiOf(who: Actor, fill = 7): Promise<{ id: string; fileId: string }> {
  const fileId = await imageOf(who, fill)
  const emoji = unwrap(await createCustomEmoji(who.ctx, { name: `party-${(seq += 1)}`, fileId }))
  return { id: emoji.id, fileId }
}

const iconOf = (id: string): PageIcon => ({ type: 'custom_emoji', custom_emoji: { id } })

const pageOf = async (who: Actor): Promise<BlockId> =>
  (await createPage(who.ctx, { privateTop: true, title: titleFromPlainText(`이모지 아이콘 ${(seq += 1)}`) })).id

async function refCount(fileId: string): Promise<number> {
  const [row] = await query<{ ref_count: number }>(`SELECT ref_count FROM file WHERE id = $1`, [fileId])
  return row!.ref_count
}

async function storedIcon(pageId: string): Promise<unknown> {
  const [row] = await query<{ format: Record<string, unknown> | null }>(`SELECT format FROM block WHERE id = $1`, [pageId])
  return row!.format?.page_icon ?? null
}

async function rejection(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    if (error instanceof PageError) return error.code
    throw error
  }
  return 'accepted'
}

// ── ① 페이지 아이콘 ───────────────────────────────────────────────────

describe('① ★ 페이지 아이콘', () => {
  test('살아 있는 이모지를 단다 — 저장 모양은 id 만 · 이모지 파일의 참조는 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await team()
    const emoji = await emojiOf(boss)
    const page = await pageOf(boss)
    assert.equal(await refCount(emoji.fileId), 1, '이모지가 쥔 참조 하나')

    assert.deepEqual(await setPageIcon(boss.ctx, page, iconOf(emoji.id.toUpperCase())), iconOf(emoji.id), '받을 때 소문자로')
    assert.deepEqual(await storedIcon(page), { type: 'custom_emoji', custom_emoji: { id: emoji.id } })
    assert.deepEqual(pageIconOfFormat({ page_icon: await storedIcon(page) }), iconOf(emoji.id))
    assert.equal(await refCount(emoji.fileId), 1, '아이콘이 따로 올리지 않는다')
  })

  test('올린 파일 아이콘에서 이모지로 바꾸면 그 파일의 참조가 내린다 — 이모지 파일은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await team()
    const emoji = await emojiOf(boss)
    const page = await pageOf(boss)
    const plain = await imageOf(boss, 3)
    await setPageIcon(boss.ctx, page, { type: 'file', file_id: plain })
    assert.equal(await refCount(plain), 1)

    await setPageIcon(boss.ctx, page, iconOf(emoji.id))
    assert.deepEqual([await refCount(plain), await refCount(emoji.fileId)], [0, 1])
    await setPageIcon(boss.ctx, page, null)
    assert.deepEqual([await refCount(plain), await refCount(emoji.fileId)], [0, 1], '지워도 이모지 파일은 그대로')
  })
})

// ── ② 거부 ────────────────────────────────────────────────────────────

describe('② ★ 거부', () => {
  test('다른 워크스페이스의 이모지 · 지운 이모지 · 없는 id — invalid_icon · 아이콘은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await team()
    const elsewhere = await team()
    const theirs = await emojiOf(elsewhere.boss)
    const gone = await emojiOf(boss)
    unwrap(await deleteCustomEmoji(boss.ctx, gone.id))
    const page = await pageOf(boss)

    for (const id of [theirs.id, gone.id, crypto.randomUUID()]) {
      assert.equal(await rejection(() => setPageIcon(boss.ctx, page, iconOf(id))), 'invalid_icon', id)
    }
    assert.equal(
      await rejection(() => setPageIcon(boss.ctx, page, { type: 'custom_emoji', custom_emoji: { id: 'party' } } as PageIcon)),
      'invalid_icon',
      '모양이 아니다',
    )
    assert.equal(await storedIcon(page), null)
  })
})

// ── ③ 데이터베이스 아이콘 ─────────────────────────────────────────────

describe('③ 데이터베이스 아이콘', () => {
  test('같다 — 단다 · 지운 이모지는 invalid_icon', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await team()
    const emoji = await emojiOf(boss)
    const gone = await emojiOf(boss)
    unwrap(await deleteCustomEmoji(boss.ctx, gone.id))
    const db = unwrap(await createDatabase(boss.ctx, { name: '이모지 표' }))

    assert.deepEqual(unwrap(await setDatabaseIcon(boss.ctx, db.id, iconOf(emoji.id))), iconOf(emoji.id))
    assert.deepEqual(unwrap(await getDatabase(boss.ctx, db.id)).icon, iconOf(emoji.id))
    assert.deepEqual(await setDatabaseIcon(boss.ctx, db.id, iconOf(gone.id)), { ok: false, reason: 'invalid_icon' })
    assert.equal(await refCount(emoji.fileId), 1)
  })
})

// ── ④ 지워도 남는다 · 그림 ────────────────────────────────────────────

describe('④ ★ 지워도 달린 아이콘은 남는다 · 그림', () => {
  test('살아 있을 때는 그림을 준다(게스트도) · 다른 워크스페이스는 못 받는다 · 지우면 아이콘은 남고 그림은 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, guest } = await team()
    const elsewhere = await team()
    const emoji = await emojiOf(boss, 42)
    const page = await pageOf(boss)
    await setPageIcon(boss.ctx, page, iconOf(emoji.id))

    assert.equal((await readCustomEmojiImage(boss.ctx, emoji.id))?.bytes[8], 42)
    assert.equal((await readCustomEmojiImage(guest.ctx, emoji.id))?.mime, 'image/png', '게스트도 — 쓰인 이모지를 그려야 한다')
    assert.equal(await readCustomEmojiImage(elsewhere.boss.ctx, emoji.id), null, '다른 워크스페이스')
    assert.equal(await readCustomEmojiImage(boss.ctx, 'not-a-uuid'), null)

    unwrap(await deleteCustomEmoji(boss.ctx, emoji.id))
    assert.deepEqual(await storedIcon(page), { type: 'custom_emoji', custom_emoji: { id: emoji.id } }, '쓰인 곳을 찾아 고치지 않는다')
    assert.equal(await readCustomEmojiImage(boss.ctx, emoji.id), null, '지운 이모지의 그림은 없다')
  })
})

// ── ⑤ 공개 화면 ───────────────────────────────────────────────────────

describe('⑤ ★ 공개 화면', () => {
  test('아이콘의 공개 파일 경로가 이모지의 그림을 준다 · 지우면 경로가 닫히고 화면의 아이콘이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await team()
    const emoji = await emojiOf(boss, 55)
    const page = await pageOf(boss)
    await setPageIcon(boss.ctx, page, iconOf(emoji.id))
    const published = await publishPage(boss.ctx, page)
    assert.ok(published.ok, JSON.stringify(published))
    const token = published.value.token!

    assert.equal((await readPublicBlockFile(token, page, 'icon'))?.bytes[8], 55)
    const before = await readPublicPage(token)
    assert.ok(before.ok)
    assert.deepEqual(before.value.icon, iconOf(emoji.id))

    unwrap(await deleteCustomEmoji(boss.ctx, emoji.id))
    assert.equal(await readPublicBlockFile(token, page, 'icon'), null)
    const after = await readPublicPage(token)
    assert.ok(after.ok)
    assert.equal(after.value.icon, null, '깨진 그림 대신 아이콘이 없다')
  })
})

// ── ⑥ DB 가 막는다 ────────────────────────────────────────────────────

describe('⑥ DB 가 모양을 막는다', () => {
  test('이름 · 주소를 실은 모양 · 안쪽이 객체가 아닌 모양 · 대문자 id — 23514', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await team()
    const page = await pageOf(boss)
    const id = crypto.randomUUID()
    for (const icon of [
      { type: 'custom_emoji', custom_emoji: { id, name: 'party' } },
      { type: 'custom_emoji', custom_emoji: { id }, url: 'https://example.com/a.png' },
      { type: 'custom_emoji', custom_emoji: id },
      { type: 'custom_emoji' },
      { type: 'custom_emoji', custom_emoji: { id: id.toUpperCase() } },
    ]) {
      await assert.rejects(
        query(`UPDATE block SET format = jsonb_set(coalesce(format, '{}'::jsonb), '{page_icon}', $2::jsonb) WHERE id = $1`, [page, JSON.stringify(icon)]),
        (error: { code?: string }) => error.code === '23514',
        JSON.stringify(icon),
      )
    }
    await query(`UPDATE block SET format = jsonb_set(coalesce(format, '{}'::jsonb), '{page_icon}', $2::jsonb) WHERE id = $1`, [
      page,
      JSON.stringify({ type: 'custom_emoji', custom_emoji: { id } }),
    ])
    assert.deepEqual(await storedIcon(page), { type: 'custom_emoji', custom_emoji: { id } }, '이 모양은 받는다(살아 있는지는 명령이 본다)')
  })
})
