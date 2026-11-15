/**
 * 다시 붙을 때의 서버 판 묻기 — OF-3 (F-12-04 · 정본 §3.7 [보강 OF-1] ④ · DB)
 *
 *   ① ★ 볼 수 있는 페이지는 지금의 판 — 로그의 마지막 seq · 내려받기(OF-2)가 싣는 것과 같다 · 남이 고치면 커진다
 *   ② ★ 휴지통 · 권한을 거둔 · 처음부터 볼 수 없는 · 없는 · uuid 가 아닌 페이지는 `gone` — 내려받기가 거부하는 것과 같다(가르지 않는다)
 *   ③ ★ 다른 워크스페이스의 페이지는 `gone` — 그곳의 소유자여도
 *   ④ ★ 내보내기 정책을 끄면 멤버에게는 모두 `gone` · 소유자는 그대로
 *   ⑤ ★ 한 번에 묻는 수의 상한 — 넘으면 묻지 않는다(`too_many`) · 겹친 id 는 하나로 센다
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { trashPage } from '../block/trash.ts'
import { textRun } from '../contracts/rich-text.ts'
import { queryOne } from '../db/pool.ts'
import type { BlockId } from '../ids.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import { updateSetting } from '../settings/settings.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { readOfflinePage } from './offline-page.ts'
import { MAX_STATUS_PAGES, offlinePageStatus, type OfflinePageStatus } from './offline-status.ts'

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
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

// ── 도우미 ────────────────────────────────────────────────────────────

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)} ${Date.now()}`

async function office() {
  const ws = await createBareWorkspace('오프라인 판')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  return { ws, boss, mate }
}

const body = (text: string) => ({ blocks: [{ id: randomUUID(), type: 'paragraph' as const, title: [textRun(text)] }] })

/** 본문이 있는 대표의 개인 페이지 — 동료에게 읽기를 준다(거둘 수 있게). */
async function sharedPage(boss: Actor, mate: Actor, text: string): Promise<BlockId> {
  const page = await createPage(boss.ctx, { title: titleFromPlainText(unique('받아 둘 문서')), privateTop: true })
  const saved = await savePageBody(boss.ctx, page.id, body(text))
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.ok((await grantAccess(boss.ctx, page.id, { type: 'user', id: mate.userId }, 'view')).ok)
  return page.id
}

const lastSeq = async (page: string): Promise<string> =>
  (await queryOne<{ seq: string }>(`SELECT max(seq)::text AS seq FROM doc_update WHERE page_id = $1`, [page])).seq

async function statusOf(actor: Actor, ids: readonly string[]): Promise<Record<string, OfflinePageStatus>> {
  const result = await offlinePageStatus(actor.ctx, ids)
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.pages
}

// ── ① 지금의 판 ───────────────────────────────────────────────────────

describe('① ★ 볼 수 있는 페이지는 지금의 판', () => {
  test('로그의 마지막 seq · 내려받기가 싣는 것과 같다 · 고치면 커진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await office()
    const page = await sharedPage(boss, mate, '처음 본문')
    const downloaded = await readOfflinePage(mate.ctx, page)
    assert.equal(downloaded.ok, true)
    if (!downloaded.ok) return

    const first = await statusOf(mate, [page])
    assert.deepEqual(first, { [page]: { seq: downloaded.value.seq } }, '내려받기의 판과 같다')
    assert.equal(downloaded.value.seq, await lastSeq(page))

    assert.equal((await savePageBody(boss.ctx, page, body('대표가 고친 본문'))).ok, true)
    const after = await statusOf(mate, [page])
    const now = after[page]
    assert.ok(now !== 'gone' && BigInt(now.seq) > BigInt(downloaded.value.seq), `판이 커진다: ${JSON.stringify(after)}`)
    assert.equal(now !== 'gone' && now.seq, await lastSeq(page))
  })
})

// ── ② gone ────────────────────────────────────────────────────────────

describe('② ★ 휴지통 · 거둔 · 볼 수 없는 · 없는 페이지는 gone', () => {
  test('내려받기가 거부하는 것과 같다 — 가르지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await office()
    const kept = await sharedPage(boss, mate, '남는 본문')
    const trashed = await sharedPage(boss, mate, '버릴 본문')
    const revoked = await sharedPage(boss, mate, '거둘 본문')
    const secret = (await createPage(boss.ctx, { title: titleFromPlainText(unique('대표만 보는 문서')), privateTop: true })).id
    const missing = randomUUID()
    assert.equal((await statusOf(mate, [trashed, revoked]))[revoked] !== 'gone', true, '거두기 전에는 보인다')

    await trashPage(boss.ctx, trashed)
    assert.ok((await revokeAccess(boss.ctx, revoked, { type: 'user', id: mate.userId })).ok)

    const pages = await statusOf(mate, [kept, trashed, revoked, secret, missing, 'not-a-uuid'])
    assert.notEqual(pages[kept], 'gone', '남은 페이지는 판')
    for (const id of [trashed, revoked, secret, missing, 'not-a-uuid']) {
      assert.equal(pages[id], 'gone', `${id} 는 gone`)
      assert.equal((await readOfflinePage(mate.ctx, id)).ok, false, `${id} 는 내려받기도 거부한다(같은 게이트)`)
    }
    assert.equal((await statusOf(boss, [trashed]))[trashed], 'gone', '휴지통의 페이지는 소유자에게도 gone')
  })
})

// ── ③ 다른 워크스페이스 ───────────────────────────────────────────────

describe('③ ★ 다른 워크스페이스의 페이지는 gone', () => {
  test('그곳의 소유자여도 — 묻는 워크스페이스의 페이지만 답한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const elsewhere = await createBareWorkspace('다른 곳')
    const bossThere = await joinAs(elsewhere, { userId: boss.userId }, 'owner')
    const there = (await createPage(bossThere.ctx, { title: titleFromPlainText(unique('다른 곳의 문서')) })).id
    assert.equal((await savePageBody(bossThere.ctx, there, body('다른 곳의 본문'))).ok, true)

    assert.notEqual((await statusOf(bossThere, [there]))[there], 'gone', '그 워크스페이스에서 물으면 판')
    assert.equal((await statusOf(boss, [there]))[there], 'gone', '이 워크스페이스에서 물으면 gone')
  })
})

// ── ④ 내보내기 정책 ───────────────────────────────────────────────────

describe('④ ★ 내보내기 정책을 끄면 멤버에게는 모두 gone', () => {
  test('소유자는 그대로 · 켜면 다시 판', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await office()
    const page = await sharedPage(boss, mate, '정책 본문')
    const setExport = async (value: boolean) => assert.deepEqual(await updateSetting(boss.ctx, 'workspace.allow_export', value), { ok: true, value })

    await setExport(false)
    try {
      assert.deepEqual(await statusOf(mate, [page]), { [page]: 'gone' })
      assert.equal((await readOfflinePage(mate.ctx, page)).ok, false, '내려받기도 거부한다(같은 게이트)')
      assert.notEqual((await statusOf(boss, [page]))[page], 'gone', '소유자는 정책과 상관없이')
    } finally {
      await setExport(true)
    }
    assert.notEqual((await statusOf(mate, [page]))[page], 'gone')
  })
})

// ── ⑤ 상한 ────────────────────────────────────────────────────────────

describe('⑤ ★ 한 번에 묻는 수의 상한', () => {
  test('넘으면 too_many · 상한까지는 답한다 · 겹친 id 는 하나로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await office()
    const page = await sharedPage(boss, mate, '상한 본문')
    const many = Array.from({ length: MAX_STATUS_PAGES + 1 }, () => randomUUID())
    assert.deepEqual(await offlinePageStatus(mate.ctx, many), { ok: false, reason: 'too_many' })

    const full = [page, ...many.slice(0, MAX_STATUS_PAGES - 1)]
    const pages = await statusOf(mate, full)
    assert.equal(Object.keys(pages).length, MAX_STATUS_PAGES)
    assert.notEqual(pages[page], 'gone')

    const repeated = await statusOf(mate, [...Array.from({ length: MAX_STATUS_PAGES + 5 }, () => page)])
    assert.deepEqual(Object.keys(repeated), [page], '겹친 id 는 하나로 센다')
  })
})
