/**
 * 오프라인 내려받기의 서버 쪽 — OF-2 (F-12-04 · 정본 §3.7 [보강 OF-1] ② · DB)
 *
 *   ① ★ 볼 수 있는 사람은 받는다 — 본문 상태(Y update) · 마지막 seq · 제목 · 아이콘 · 커버. 상태만으로 같은 본문이 선다 · seq 는 로그의 마지막
 *   ② ★ 볼 수 없는 페이지 · 없는 페이지 · uuid 가 아닌 id · 휴지통의 페이지는 not_found(가르지 않는다)
 *   ③ ★ 내보내기 정책을 따른다 — 끄면 멤버는 policy_disabled · 소유자는 받는다 · 켜면 다시 받는다(`exportPolicyAllows` — 내보내기와 같은 게이트)
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'

import { createPage, setPageCover, setPageIcon, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { trashPage } from '../block/trash.ts'
import { readBodyPm } from '../collab/ydoc.ts'
import { textRun } from '../contracts/rich-text.ts'
import { queryOne } from '../db/pool.ts'
import type { BlockId } from '../ids.ts'
import { grantAccess } from '../permissions/acl.ts'
import { updateSetting } from '../settings/settings.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { mayDownloadOffline, readOfflinePage } from './offline-page.ts'
import { decodeBase64 } from './offline-store.ts'

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
  const ws = await createBareWorkspace('오프라인')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  return { ws, boss, mate }
}

/** 본문이 있는 페이지 — 동료에게 읽기를 준다. */
async function pageWithBody(boss: Actor, mate: Actor, text: string): Promise<BlockId> {
  const page = await createPage(boss.ctx, { title: titleFromPlainText(unique('내려받을 문서')) })
  const saved = await savePageBody(boss.ctx, page.id, { blocks: [{ id: randomUUID(), type: 'paragraph', title: [textRun(text)] }] })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.ok((await grantAccess(boss.ctx, page.id, { type: 'user', id: mate.userId }, 'view')).ok)
  return page.id
}

const bodyText = (base64: string): string => {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, decodeBase64(base64))
  return readBodyPm(doc).textContent
}

// ── ① 받는다 ──────────────────────────────────────────────────────────

describe('① ★ 볼 수 있는 사람은 받는다', () => {
  test('본문 상태 · 마지막 seq · 제목 · 아이콘 · 커버', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await office()
    const page = await pageWithBody(boss, mate, '오프라인 본문')
    await setPageIcon(boss.ctx, page, { type: 'emoji', emoji: '🧳' })
    await setPageCover(boss.ctx, page, { type: 'gallery', gallery: 'gradient_1' })

    const read = await readOfflinePage(mate.ctx, page)
    assert.equal(read.ok, true, JSON.stringify(read))
    if (!read.ok) return
    assert.equal(read.value.pageId, page)
    assert.match(read.value.title, /^내려받을 문서/)
    assert.deepEqual(read.value.icon, { type: 'emoji', emoji: '🧳' })
    assert.deepEqual(read.value.cover, { type: 'gallery', gallery: 'gradient_1' })
    assert.equal(bodyText(read.value.state), '오프라인 본문', '상태만으로 같은 본문이 선다')
    const last = await queryOne<{ seq: string }>(`SELECT max(seq)::text AS seq FROM doc_update WHERE page_id = $1`, [page])
    assert.equal(read.value.seq, last.seq, 'seq 는 로그의 마지막')
    assert.equal(await mayDownloadOffline(mate.ctx), true)
  })
})

// ── ② not_found ──────────────────────────────────────────────────────

describe('② ★ 볼 수 없는 · 없는 · 휴지통의 페이지는 not_found', () => {
  test('가르지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await office()
    const secret = await createPage(boss.ctx, { title: titleFromPlainText(unique('대표의 개인 문서')), privateTop: true })
    assert.deepEqual(await readOfflinePage(mate.ctx, secret.id), { ok: false, reason: 'not_found' }, '볼 수 없는 페이지')
    assert.deepEqual(await readOfflinePage(mate.ctx, randomUUID()), { ok: false, reason: 'not_found' }, '없는 페이지')
    assert.deepEqual(await readOfflinePage(mate.ctx, 'not-a-uuid'), { ok: false, reason: 'not_found' }, 'uuid 가 아닌 id')

    const page = await pageWithBody(boss, mate, '버릴 본문')
    assert.equal((await readOfflinePage(mate.ctx, page)).ok, true)
    await trashPage(boss.ctx, page)
    assert.deepEqual(await readOfflinePage(mate.ctx, page), { ok: false, reason: 'not_found' }, '휴지통의 페이지')
    assert.deepEqual(await readOfflinePage(boss.ctx, page), { ok: false, reason: 'not_found' }, '소유자에게도')
  })
})

// ── ③ 내보내기 정책 ───────────────────────────────────────────────────

describe('③ ★ 내보내기 정책을 따른다', () => {
  test('끄면 멤버는 policy_disabled · 소유자는 받는다 · 켜면 다시 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await office()
    const page = await pageWithBody(boss, mate, '정책 본문')
    const setExport = async (value: boolean) => assert.deepEqual(await updateSetting(boss.ctx, 'workspace.allow_export', value), { ok: true, value })

    await setExport(false)
    assert.deepEqual(await readOfflinePage(mate.ctx, page), { ok: false, reason: 'policy_disabled' })
    assert.deepEqual(await readOfflinePage(mate.ctx, randomUUID()), { ok: false, reason: 'policy_disabled' }, '정책을 먼저 본다 — 페이지의 있고 없음을 알리지 않는다')
    assert.equal(await mayDownloadOffline(mate.ctx), false)
    const owner = await readOfflinePage(boss.ctx, page)
    assert.equal(owner.ok, true, '소유자는 정책과 상관없이 받는다')
    assert.equal(await mayDownloadOffline(boss.ctx), true)

    await setExport(true)
    assert.equal((await readOfflinePage(mate.ctx, page)).ok, true)
  })
})
