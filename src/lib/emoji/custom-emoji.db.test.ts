/**
 * 커스텀 이모지 — 인접 제품 7c-1조각 (F-13-16 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.4 [보강] 커스텀 이모지).
 *
 *   ① ★ 올리기 — 멤버가 이름 · 이미지로 올린다(이름은 소문자로 · 양 끝의 `:` 는 걷는다) · 파일 참조가 하나 오른다 · 목록은 워크스페이스의
 *      누구나(게스트도) · 이름 순
 *   ② ★ 누가 — 게스트는 못 올린다 · "소유자만" 설정을 켜면 멤버는 forbidden · 이름 바꾸기 · 지우기는 올린 사람이나 소유자
 *   ③ 이름 · 파일 — 모양 · 살아 있는 것끼리 하나(지운 이름은 다시 쓴다) · 다른 워크스페이스의 파일 · 이미지가 아닌 파일 · 1MB
 *   ④ ★ 지우기는 표시만 — 행은 남고 목록에서 빠지며 파일 참조가 내린다
 *   ⑤ 500개 — 넘으면 too_many
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { setFileStorage, type FileStorage } from '../file/storage.ts'
import { uploadFile } from '../file/file.ts'
import { updateSetting } from '../settings/settings.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { MAX_CUSTOM_EMOJI, createCustomEmoji, deleteCustomEmoji, listCustomEmoji, renameCustomEmoji } from './custom-emoji.ts'

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

async function team() {
  const ws = await createBareWorkspace('이모지')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  const other = await joinAs(ws, await createUser('다른 동료'), 'member')
  const guest = await joinAs(ws, await createUser('손님'), 'guest')
  return { ws, boss, mate, other, guest }
}

const image = async (who: Actor, bytes = 16, mime = 'image/png') => {
  const out = await uploadFile(who.ctx, { bytes: new Uint8Array(bytes).fill(137), mime, originalName: 'emoji.png' })
  assert.ok(out.ok, JSON.stringify(out))
  return out.file.id
}

const refCount = async (fileId: string) => (await query<{ n: number }>(`SELECT ref_count AS n FROM file WHERE id = $1`, [fileId]))[0]!.n

// ── ① 올리기 ──────────────────────────────────────────────────────────

describe('① ★ 올리기', () => {
  test('이름 · 이미지 · 파일 참조 · 목록은 누구나 · 이름 순', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate, guest } = await team()
    const fileA = await image(mate)
    const party = unwrap(await createCustomEmoji(mate.ctx, { name: '  :Party-Parrot: ', fileId: fileA }))
    assert.equal(party.name, 'party-parrot', '소문자 · 양 끝의 : 를 걷는다')
    assert.equal(party.canManage, true)
    assert.equal(await refCount(fileA), 1, '이모지가 파일을 참조한다')
    unwrap(await createCustomEmoji(mate.ctx, { name: 'ack', fileId: await image(mate) }))

    const seen = await listCustomEmoji(guest.ctx)
    assert.deepEqual(seen.map((e) => [e.name, e.canManage]), [['ack', false], ['party-parrot', false]], '게스트도 본다 · 이름 순 · 바꿀 수는 없다')
  })
})

// ── ② 누가 ────────────────────────────────────────────────────────────

describe('② ★ 누가', () => {
  test('게스트는 못 올린다 · 소유자만 설정 · 바꾸기 · 지우기는 올린 사람이나 소유자', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, other, guest } = await team()
    assert.deepEqual(await createCustomEmoji(guest.ctx, { name: 'hi', fileId: await image(boss) }), { ok: false, reason: 'forbidden' })

    unwrap(await updateSetting(boss.ctx, 'workspace.emoji_owners_only', true))
    assert.deepEqual(await createCustomEmoji(mate.ctx, { name: 'hi', fileId: await image(mate) }), { ok: false, reason: 'forbidden' }, '소유자만')
    const owners = unwrap(await createCustomEmoji(boss.ctx, { name: 'boss', fileId: await image(boss) }))
    unwrap(await updateSetting(boss.ctx, 'workspace.emoji_owners_only', false))
    const mine = unwrap(await createCustomEmoji(mate.ctx, { name: 'mine', fileId: await image(mate) }))

    assert.deepEqual(await renameCustomEmoji(other.ctx, mine.id, 'theirs'), { ok: false, reason: 'forbidden' }, '다른 멤버는 못 바꾼다')
    assert.deepEqual(await deleteCustomEmoji(other.ctx, mine.id), { ok: false, reason: 'forbidden' })
    assert.equal(unwrap(await renameCustomEmoji(mate.ctx, mine.id, 'Mine-2')).name, 'mine-2', '올린 사람')
    assert.equal(unwrap(await renameCustomEmoji(boss.ctx, mine.id, 'mine-3')).name, 'mine-3', '소유자는 누가 올렸든')
    assert.deepEqual(await deleteCustomEmoji(mate.ctx, owners.id), { ok: false, reason: 'forbidden' }, '멤버는 소유자의 것을 못 지운다')
    unwrap(await deleteCustomEmoji(boss.ctx, mine.id))
  })
})

// ── ③ 이름 · 파일 ─────────────────────────────────────────────────────

describe('③ 이름 · 파일', () => {
  test('모양 · 하나뿐 · 지운 이름은 다시 · 다른 워크스페이스의 파일 · 이미지가 아닌 파일 · 1MB', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team()
    for (const bad of ['', 'has space', 'x'.repeat(41), '이모지', 7]) {
      assert.deepEqual(await createCustomEmoji(mate.ctx, { name: bad, fileId: await image(mate) }), { ok: false, reason: 'invalid_name' }, String(bad))
    }
    const first = unwrap(await createCustomEmoji(mate.ctx, { name: 'wave', fileId: await image(mate) }))
    assert.deepEqual(await createCustomEmoji(mate.ctx, { name: 'WAVE', fileId: await image(mate) }), { ok: false, reason: 'duplicate_name' })
    const second = unwrap(await createCustomEmoji(mate.ctx, { name: 'wave-2', fileId: await image(mate) }))
    assert.deepEqual(await renameCustomEmoji(mate.ctx, second.id, 'wave'), { ok: false, reason: 'duplicate_name' })
    unwrap(await deleteCustomEmoji(mate.ctx, first.id))
    assert.equal(unwrap(await renameCustomEmoji(mate.ctx, second.id, 'wave')).name, 'wave', '지운 이름은 다시 쓴다')

    const stranger = await joinAs(await createBareWorkspace('남의 곳'), await createUser('남'), 'owner')
    assert.deepEqual(await createCustomEmoji(mate.ctx, { name: 'theirs', fileId: await image(stranger) }), { ok: false, reason: 'invalid_file' })
    assert.deepEqual(await createCustomEmoji(mate.ctx, { name: 'nope', fileId: 'not-a-uuid' }), { ok: false, reason: 'invalid_file' })
    const pdf = await uploadFile(mate.ctx, { bytes: new Uint8Array(16), mime: 'application/pdf', originalName: 'a.pdf' })
    if (pdf.ok) assert.deepEqual(await createCustomEmoji(mate.ctx, { name: 'pdf', fileId: pdf.file.id }), { ok: false, reason: 'invalid_file' }, '이미지가 아니다')
    assert.deepEqual(await createCustomEmoji(mate.ctx, { name: 'big', fileId: await image(mate, 1024 * 1024 + 1) }), { ok: false, reason: 'too_large' })
  })
})

// ── ④ 지우기 ──────────────────────────────────────────────────────────

describe('④ ★ 지우기는 표시만', () => {
  test('행은 남고 목록에서 빠지며 파일 참조가 내린다 · 지운 것은 다시 바꾸거나 지울 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team()
    const fileId = await image(mate)
    const emoji = unwrap(await createCustomEmoji(mate.ctx, { name: 'bye', fileId }))
    unwrap(await deleteCustomEmoji(mate.ctx, emoji.id))
    assert.deepEqual((await listCustomEmoji(mate.ctx)).map((e) => e.name), [])
    const row = await query<{ name: string; deleted_at: Date | null }>(`SELECT name, deleted_at FROM custom_emoji WHERE id = $1`, [emoji.id])
    assert.ok(row[0]!.deleted_at !== null && row[0]!.name === 'bye', '행은 남는다(쓰인 곳이 이름을 찾는다)')
    assert.equal(await refCount(fileId), 0, '파일 참조가 내린다')
    assert.deepEqual(await deleteCustomEmoji(mate.ctx, emoji.id), { ok: false, reason: 'not_found' })
    assert.deepEqual(await renameCustomEmoji(mate.ctx, emoji.id, 'back'), { ok: false, reason: 'not_found' })
  })
})

// ── ⑤ 500개 ───────────────────────────────────────────────────────────

describe('⑤ 500개', () => {
  test('넘으면 too_many', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await team()
    const fileId = await image(boss)
    // 499개를 바로 넣는다(명령으로 499번은 느리다 — 개수만 본다)
    await query(
      `INSERT INTO custom_emoji (id, workspace_id, name, file_id, created_by)
       SELECT gen_random_uuid(), $1, 'e' || g, $2, $3 FROM generate_series(1, $4::int - 1) g`,
      [ws, fileId, boss.userId, MAX_CUSTOM_EMOJI],
    )
    unwrap(await createCustomEmoji(boss.ctx, { name: 'last', fileId: await image(boss) }))
    assert.deepEqual(await createCustomEmoji(boss.ctx, { name: 'over', fileId: await image(boss) }), { ok: false, reason: 'too_many' })
  })
})
