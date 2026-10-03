/**
 * 페이지 버전 기록 · 목록 · 미리보기 — 잔여 묶음 8d-1 (F-11-01 · DB)
 *
 * 시각은 로그의 `created_at` 을 뒤로 밀어 흉내 낸다 — 판정이 DB 의 `now()` 와 그 값을 견준다(`record.ts`).
 *
 *   ① ★ 쉼 — 마지막 편집에서 2분이 지난 뒤의 첫 쓰기가 **쓰기 전의 상태**를 남긴다 · 내용의 시각 · 고친 사람 · 곧바로 쓰면 남기지 않는다
 *   ② ★ 주기 — 버전이 담지 않은 첫 편집에서 10분이 지나면 쉬지 않아도 남긴다
 *   ③ ★ 목록 열기도 판정한다 — 쓰지 않아도 끝난 세션이 선다 · 두 번 열어도 하나 · 최신순 · 미리보기
 *   ④ ★ 옮긴 내용 — 비어 있지 않으면 첫 쓰기 때 남긴다 · 새 빈 페이지 · 목록 열기는 남기지 않는다
 *   ⑤ ★ 권한 — 볼 수만 있으면 forbidden · 못 보면 not_found · 잠긴 페이지도 기록은 본다 · 다른 페이지의 버전 id 는 not_found
 *   ⑥ 보관 — 요금제의 일수 · Enterprise 는 무제한 · 지난 버전은 목록에 없고 열면 expired
 *   ⑦ ★ S5 — 버전이 담은 이미지의 파일은 참조가 하나 더 · 버전의 바이트는 파일 저장소에(없으면 not_found)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createUser, joinAs, makeFixture, probeDatabase, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { textRun, toPlainText } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { setFileStorage, type FileStorage } from '../file/storage.ts'
import { uploadFile } from '../file/file.ts'
import type { BlockId } from '../ids.ts'
import { listVersions, readVersion } from './version.ts'
import { versionStorageKey } from './record.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let mate: Actor
const store = new Map<string, Uint8Array>()

function memoryStorage(): FileStorage {
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
  mate = await joinAs(fx.workspaceId, await createUser('버전 동료'), 'member')
})

after(async () => {
  setFileStorage(null)
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const para = (text: string): EditorBlock => ({ id: randomUUID(), type: 'paragraph', title: [textRun(text)], properties: {}, format: {}, children: [] })

async function newPage(title: string, options: { privateTop?: true } = {}): Promise<string> {
  return (await createPage(fx.owner.ctx, { title: titleFromPlainText(title), ...options })).id
}

async function write(pageId: string, texts: readonly string[], actor: Actor = fx.owner, extra: EditorBlock[] = []): Promise<void> {
  const saved = await savePageBody(actor.ctx, pageId as BlockId, { blocks: [...texts.map(para), ...extra] })
  assert.equal(saved.ok, true, JSON.stringify(saved))
}

/** 이 페이지의 로그를 뒤로 민다 — `fromSeq` 를 주면 그 seq 만. */
async function age(pageId: string, by: string, onlySeq?: number): Promise<void> {
  await query(
    `UPDATE doc_update SET created_at = created_at - $2::interval WHERE page_id = $1 AND ($3::bigint IS NULL OR seq = $3::bigint)`,
    [pageId, by, onlySeq ?? null],
  )
}

type Row = { id: string; reason: string; through_seq: string; created_at: Date; expires_at: Date; editor_ids: string[]; state_ref: string }
const versionsOf = (pageId: string) =>
  query<Row>(`SELECT id, reason, through_seq, created_at, expires_at, editor_ids, state_ref FROM page_version WHERE page_id = $1 ORDER BY through_seq`, [
    pageId,
  ])
const createdAtOf = async (pageId: string, seq: string): Promise<Date> =>
  (await query<{ created_at: Date }>(`SELECT created_at FROM doc_update WHERE page_id = $1 AND seq = $2`, [pageId, seq]))[0].created_at

async function textsOf(pageId: string, versionId: string): Promise<string[]> {
  const read = await readVersion(fx.owner.ctx, pageId, versionId)
  assert.equal(read.ok, true, read.ok ? '' : read.reason)
  if (!read.ok) throw new Error('unreachable')
  return read.value.doc.blocks.map((b) => toPlainText(b.title))
}

describe('① 쉼', () => {
  test('★ 2분 쉰 뒤의 첫 쓰기가 쓰기 전의 상태를 남긴다 — 내용의 시각 · 고친 사람 · 곧바로 쓰면 남기지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('쉼')
    await write(page, ['첫 줄'])
    await write(page, ['첫 줄', '곧바로'])
    assert.deepEqual(await versionsOf(page), [], '쉬지 않았다 — 남길 때가 아니다')

    await age(page, '3 minutes')
    const lastBefore = await createdAtOf(page, '3')
    await write(page, ['첫 줄', '곧바로', '쉰 뒤'], mate)
    const [idle, ...rest] = await versionsOf(page)
    assert.equal(rest.length, 0)
    assert.deepEqual([idle.reason, idle.through_seq], ['idle', '3'])
    assert.equal(idle.created_at.getTime(), lastBefore.getTime(), '버전의 시각은 담은 내용의 시각이다(마지막 편집 때)')
    assert.deepEqual(idle.editor_ids, [fx.owner.userId], '쉰 뒤에 쓴 사람은 이 버전의 구간이 아니다')
    assert.deepEqual(await textsOf(page, idle.id), ['첫 줄', '곧바로'], '쓰기 전의 상태다')

    await write(page, ['곧바로 또'], mate)
    assert.equal((await versionsOf(page)).length, 1, '곧바로 쓰면 남기지 않는다')
  })
})

describe('② 주기', () => {
  test('★ 버전이 담지 않은 첫 편집에서 10분이 지나면 쉬지 않아도 남긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('주기')
    await write(page, ['하나'])
    await age(page, '3 minutes')
    await write(page, ['하나', '둘']) // 쉼 버전(through 2)
    await write(page, ['하나', '둘', '셋'])
    assert.deepEqual((await versionsOf(page)).map((v) => [v.reason, v.through_seq]), [['idle', '2']])

    // 버전 뒤의 첫 편집(seq 3)이 11분 전 · 마지막 편집(seq 4)은 방금 — 쉬지 않았지만 주기가 찼다.
    await age(page, '11 minutes', 3)
    await write(page, ['하나', '둘', '셋', '넷'])
    const versions = await versionsOf(page)
    assert.deepEqual(versions.map((v) => [v.reason, v.through_seq]), [['idle', '2'], ['interval', '4']])
    assert.deepEqual(await textsOf(page, versions[1].id), ['하나', '둘', '셋'])
  })
})

describe('③ 목록', () => {
  test('★ 목록 열기도 판정한다 — 쓰지 않아도 끝난 세션이 선다 · 두 번 열어도 하나 · 최신순 · 고친 사람의 이름', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('목록')
    await write(page, ['처음'])
    await age(page, '3 minutes')
    await write(page, ['처음', '다음'], mate) // 쉼 버전(through 2 — 주인)

    const fresh = await listVersions(fx.owner.ctx, page)
    assert.equal(fresh.ok, true)
    if (!fresh.ok) return
    assert.equal(fresh.value.versions.length, 1, '마지막 편집이 방금이다 — 그 세션은 아직 버전이 아니다')

    await age(page, '3 minutes')
    const listed = await listVersions(fx.owner.ctx, page)
    assert.equal(listed.ok, true)
    if (!listed.ok) return
    assert.deepEqual(listed.value.versions.map((v) => v.reason), ['idle', 'idle'], '최신순 — 쓰지 않았지만 끝난 세션이 섰다')
    assert.deepEqual(listed.value.versions[0].editors.map((e) => e.id), [mate.userId])
    assert.equal(listed.value.versions[0].editors[0].name, '버전 동료')
    assert.equal(listed.value.versions[0].restoredFrom, null)
    assert.equal(listed.value.canRestore, true)
    assert.deepEqual(await textsOf(page, listed.value.versions[0].id), ['처음', '다음'])

    const again = await listVersions(fx.owner.ctx, page)
    assert.equal(again.ok && again.value.versions.length, 2, '두 번 열어도 하나다(한 위치에 버전 하나)')
  })
})

describe('④ 옮긴 내용', () => {
  test('★ 비어 있지 않으면 첫 쓰기 때 남긴다 · 새 빈 페이지와 목록 열기는 남기지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    // Phase 0 의 페이지 — 행만 있고 로그가 없다(본문을 저장한 뒤 로그 · 스냅샷 · 버전을 지운다).
    const old = await newPage('옛 페이지')
    await write(old, ['원래 내용'])
    for (const table of ['doc_update', 'doc_snapshot', 'page_version']) await query(`DELETE FROM ${table} WHERE page_id = $1`, [old])

    const listed = await listVersions(fx.owner.ctx, old)
    assert.equal(listed.ok && listed.value.versions.length, 0, '목록 열기는 옮긴 내용을 남기지 않는다(편집이 아니다)')
    await write(old, [])
    const [baseline] = await versionsOf(old)
    assert.deepEqual([baseline?.reason, baseline?.through_seq, baseline?.editor_ids], ['idle', '1', []])
    assert.deepEqual(await textsOf(old, baseline.id), ['원래 내용'], '다 지운 첫 쓰기 전의 내용을 되돌릴 수 있다')

    const blank = await newPage('새 페이지')
    await write(blank, ['처음 쓴 글'])
    await age(blank, '3 minutes')
    const blankList = await listVersions(fx.owner.ctx, blank)
    assert.deepEqual(blankList.ok && (await versionsOf(blank)).map((v) => v.through_seq), ['2'], '빈 옮기기(seq 1)는 버전이 아니다')
  })
})

describe('⑤ 권한', () => {
  test('★ 볼 수만 있으면 forbidden · 못 보면 not_found · 잠긴 페이지도 기록은 본다 · 다른 페이지의 버전은 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('권한', { privateTop: true })
    await write(page, ['비밀'])
    await age(page, '3 minutes')
    await write(page, ['비밀', '더'])
    const [version] = await versionsOf(page)
    const viewer = await joinAs(fx.workspaceId, await createUser('보기만'), 'member')
    const stranger = await joinAs(fx.workspaceId, await createUser('못 보는 사람'), 'member')
    assert.ok((await grantAccess(fx.owner.ctx, page, { type: 'user', id: viewer.userId }, 'view')).ok)

    assert.deepEqual(await listVersions(viewer.ctx, page), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await readVersion(viewer.ctx, page, version.id), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await listVersions(stranger.ctx, page), { ok: false, reason: 'not_found' })
    assert.deepEqual(await readVersion(stranger.ctx, page, version.id), { ok: false, reason: 'not_found' })

    assert.ok((await setPageLock(fx.owner.ctx, page, true)).ok)
    const locked = await listVersions(fx.owner.ctx, page)
    assert.equal(locked.ok && locked.value.versions.length, 1, '잠긴 페이지도 기록은 본다')
    assert.equal(locked.ok && locked.value.canRestore, false, '잠긴 페이지는 되돌릴 수 없다(8d-3)')

    const other = await newPage('다른 페이지')
    assert.deepEqual(await readVersion(fx.owner.ctx, other, version.id), { ok: false, reason: 'not_found' })
    assert.deepEqual(await readVersion(fx.owner.ctx, page, 'not-a-uuid'), { ok: false, reason: 'not_found' })
  })
})

describe('⑥ 보관', () => {
  test('요금제의 일수 · Enterprise 는 무제한 · 지난 버전은 목록에 없고 열면 expired', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('보관')
    await write(page, ['가'])
    await age(page, '3 minutes')
    await write(page, ['가', '나'])
    const [free] = await versionsOf(page)
    assert.equal(free.expires_at.getTime() - free.created_at.getTime(), 7 * 24 * 60 * 60 * 1000, 'Free — 7일')

    await query(`UPDATE workspace SET plan_code = 'enterprise' WHERE id = $1`, [fx.workspaceId])
    try {
      await age(page, '3 minutes')
      await write(page, ['가', '나', '다'])
      const [unlimited] = await query<{ infinite: boolean }>(
        `SELECT expires_at = 'infinity'::timestamptz AS infinite FROM page_version WHERE page_id = $1 AND through_seq = 3`,
        [page],
      )
      assert.equal(unlimited?.infinite, true, 'Enterprise — 무제한')
    } finally {
      await query(`UPDATE workspace SET plan_code = 'free' WHERE id = $1`, [fx.workspaceId])
    }

    await query(`UPDATE page_version SET expires_at = now() - interval '1 second' WHERE id = $1`, [free.id])
    const listed = await listVersions(fx.owner.ctx, page)
    assert.ok(listed.ok && !listed.value.versions.some((v) => v.id === free.id), '지난 버전은 목록에 없다')
    assert.deepEqual(await readVersion(fx.owner.ctx, page, free.id), { ok: false, reason: 'expired' })
  })
})

describe('⑦ 바이트 · 파일 참조', () => {
  test('★ 버전이 담은 이미지의 파일은 참조가 하나 더 · 버전의 바이트는 파일 저장소에 · 없으면 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('이미지 버전')
    const up = await uploadFile(fx.owner.ctx, { bytes: new Uint8Array(16).fill(137), mime: 'image/png', originalName: 'a.png' })
    assert.equal(up.ok, true)
    if (!up.ok) return
    const image: EditorBlock = {
      id: randomUUID(),
      type: 'image',
      title: [],
      properties: { source: { type: 'file', file_id: up.file.id } },
      format: {},
      children: [],
    }
    await write(page, ['사진'], fx.owner, [image])
    const refCount = async () => (await query<{ ref_count: number }>(`SELECT ref_count FROM file WHERE id = $1`, [up.file.id]))[0].ref_count
    assert.equal(await refCount(), 1, '전제 — 본문의 이미지 블록 하나')

    await age(page, '3 minutes')
    await write(page, ['사진 지움'])
    const [version] = await versionsOf(page)
    assert.equal(await refCount(), 1, '본문에서 지웠지만(−1) 버전이 담았다(+1)')
    assert.equal(version.state_ref, versionStorageKey(fx.workspaceId, page, version.id))
    assert.ok(store.has(version.state_ref), '버전의 바이트는 파일 저장소에 있다')

    store.delete(version.state_ref)
    assert.deepEqual(await readVersion(fx.owner.ctx, page, version.id), { ok: false, reason: 'not_found' })
  })
})
