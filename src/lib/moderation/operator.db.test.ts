/**
 * 모더레이션 — 운영자의 조치 — 게시 · 공유 6b-2조각 (F-17-09 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.3 끝 [보강] 모더레이션 조치).
 *
 *   ① ★ 테이크다운 — 공개 경로가 그 페이지와 그 아래를 닫는다 · 워크스페이스 안에서는 그대로(lifecycle · 권한) · 열린 케이스는 actioned ·
 *      조치 한 줄(까닭 · 이름) · 두 번은 already
 *   ② 복구 — 다시 열린다 · 내려져 있지 않으면 not_moderated
 *   ③ 기각 — 케이스 dismissed · reported 표지를 지운다 · 닫힌 케이스는 not_open · 없는 것은 not_found
 *   ④ ★ 조치는 쌓기만 한다 — 고치기 · 지우기를 DB 가 거부한다
 *   ⑤ ★ 소유자가 안다 — 게시 상태의 moderation(위 페이지가 내려져도) · 다시 게시는 moderated · 복구하면 게시된다
 *   ⑥ 검사 — 이름 · 메모 · 까닭이 틀리면 invalid_input 이고 아무것도 남지 않는다
 *   ⑦ 운영자가 읽는 것 — 목록 · 케이스 하나(신고 · 조치 · 지문은 앞 12자)
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { query, queryOne } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import type { BlockId } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { resolvePublicPage } from '../publish/public-access.ts'
import { publishPage, readPublishState, unpublishPage } from '../publish/public-link.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { dismissCase, listCases, readCase, reinstatePage, takeDownPage } from './operator.ts'
import { submitReport } from './report.ts'

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
    const { closeValkey } = await import('../valkey.ts')
    await closeValkey()
  }
})

// ── 도우미 ────────────────────────────────────────────────────────────

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)} ${Date.now()}`

async function office() {
  const ws = await createBareWorkspace('모더레이션')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  return { ws, boss }
}

const pageNamed = async (by: Actor, title: string, parent?: BlockId): Promise<BlockId> =>
  (await createPage(by.ctx, parent === undefined ? { privateTop: true, title: titleFromPlainText(title) } : { parentPageId: parent, title: titleFromPlainText(title) })).id

async function tokenOf(by: Actor, pageId: string): Promise<string> {
  const result = await publishPage(by.ctx, pageId)
  assert.ok(result.ok, JSON.stringify(result))
  return result.value.token!
}

const opens = async (token: string, pageId?: string) => {
  const access = await resolvePublicPage(token, pageId)
  return access.ok ? 'open' : access.reason
}

const reportOn = async (token: string, pageId?: string) => {
  const done = await submitReport({ token, pageId, reason: 'phishing_spam', detail: '가짜', reporter: { ip: null, userAgent: unique('UA') } })
  assert.ok(done.ok, JSON.stringify(done))
  return done.value
}

const OP = { actor: '운영자 김', note: '법무팀 요청' }
const stateOf = async (id: string) => (await queryOne<{ moderation_state: string }>(`SELECT moderation_state FROM block WHERE id = $1`, [id])).moderation_state

// ── ① 테이크다운 ──────────────────────────────────────────────────────

describe('① ★ 테이크다운', () => {
  test('공개 경로가 그 페이지와 그 아래를 닫는다 · 워크스페이스 안에서는 그대로 · 열린 케이스는 actioned · 조치 한 줄', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('내릴 페이지'))
    const sub = await pageNamed(boss, '그 아래', doc)
    const token = await tokenOf(boss, doc)
    const { caseId } = await reportOn(token)

    const done = await takeDownPage(doc, 'phishing', OP)
    assert.ok(done.ok, JSON.stringify(done))
    assert.equal(await opens(token), 'not_found')
    assert.equal(await opens(token, sub), 'not_found', '그 아래도 닫힌다')

    const page = await queryOne<{ lifecycle: string }>(`SELECT lifecycle FROM block WHERE id = $1`, [doc])
    assert.equal(page.lifecycle, 'live', 'lifecycle 은 건드리지 않는다')
    const caps = await withReadTransaction((tx) => effectiveCaps(tx, boss.ctx, doc))
    assert.ok(can(caps, 'edit_content'), '워크스페이스 안에서는 그대로 고친다')

    const kase = await queryOne<{ state: string; closed: boolean }>(`SELECT state, closed_at IS NOT NULL AS closed FROM moderation_case WHERE id = $1`, [caseId])
    assert.deepEqual(kase, { state: 'actioned', closed: true })
    const action = await queryOne<{ action: string; reason_code: string; actor: string; note: string; case_id: string }>(
      `SELECT action, reason_code, actor, note, case_id FROM moderation_action WHERE id = $1`,
      [done.value.actionId],
    )
    assert.deepEqual(action, { action: 'take_down', reason_code: 'phishing', actor: '운영자 김', note: '법무팀 요청', case_id: caseId })

    assert.deepEqual(await takeDownPage(doc, 'spam', OP), { ok: false, reason: 'already' })
  })

  test('신고 없이도 내린다(법적 요청) — 케이스 없는 조치', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('요청'))
    const token = await tokenOf(boss, doc)
    const done = await takeDownPage(doc, 'copyright', { actor: '운영자' })
    assert.ok(done.ok)
    assert.equal(await opens(token), 'not_found')
    const row = await queryOne<{ case_id: string | null; note: string }>(`SELECT case_id, note FROM moderation_action WHERE id = $1`, [done.value.actionId])
    assert.deepEqual(row, { case_id: null, note: '' })
  })
})

// ── ② 복구 ────────────────────────────────────────────────────────────

describe('② 복구', () => {
  test('되살리면 다시 열린다 · 내려져 있지 않으면 not_moderated · 없는 페이지는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('되살릴'))
    const token = await tokenOf(boss, doc)
    assert.deepEqual(await reinstatePage(doc, OP), { ok: false, reason: 'not_moderated' })
    assert.ok((await takeDownPage(doc, 'other', OP)).ok)
    const back = await reinstatePage(doc, OP)
    assert.ok(back.ok)
    assert.equal(await stateOf(doc), 'reinstated')
    assert.equal(await opens(token), 'open')
    assert.deepEqual(await reinstatePage(crypto.randomUUID(), OP), { ok: false, reason: 'not_found' })
  })
})

// ── ③ 기각 ────────────────────────────────────────────────────────────

describe('③ 기각', () => {
  test('케이스 dismissed · reported 표지를 지운다 · 닫힌 케이스는 not_open · 없는 것은 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('기각'))
    const token = await tokenOf(boss, doc)
    const { caseId } = await reportOn(token)
    assert.equal(await stateOf(doc), 'reported')

    assert.ok((await dismissCase(caseId, OP)).ok)
    const kase = await queryOne<{ state: string }>(`SELECT state FROM moderation_case WHERE id = $1`, [caseId])
    assert.equal(kase.state, 'dismissed')
    assert.equal(await stateOf(doc), 'none')
    assert.equal(await opens(token), 'open')
    assert.deepEqual(await dismissCase(caseId, OP), { ok: false, reason: 'not_open' })
    assert.deepEqual(await dismissCase(crypto.randomUUID(), OP), { ok: false, reason: 'not_found' })
    assert.deepEqual(await dismissCase('not-a-uuid', OP), { ok: false, reason: 'not_found' })
  })
})

// ── ④ 쌓기만 ──────────────────────────────────────────────────────────

describe('④ ★ 조치는 쌓기만 한다', () => {
  test('고치기 · 지우기를 DB 가 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('기록'))
    const done = await takeDownPage(doc, 'spam', OP)
    assert.ok(done.ok)
    await assert.rejects(query(`UPDATE moderation_action SET note = '고침' WHERE id = $1`, [done.value.actionId]), /append-only/)
    await assert.rejects(query(`DELETE FROM moderation_action WHERE id = $1`, [done.value.actionId]), /append-only/)
  })
})

// ── ⑤ 소유자가 안다 ───────────────────────────────────────────────────

describe('⑤ ★ 소유자가 안다', () => {
  test('게시 상태의 moderation(위 페이지가 내려져도) · 다시 게시는 moderated · 복구하면 게시된다 · 신고만 된 것은 말하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('소유자'))
    const sub = await pageNamed(boss, '아래', doc)
    const token = await tokenOf(boss, doc)
    await reportOn(token)
    const reported = await readPublishState(boss.ctx, doc)
    assert.ok(reported.ok)
    assert.equal(reported.value.moderation, null, '신고만 된 것은 소유자에게 말하지 않는다')

    assert.ok((await takeDownPage(doc, 'illegal', OP)).ok)
    const own = await readPublishState(boss.ctx, doc)
    const below = await readPublishState(boss.ctx, sub)
    assert.ok(own.ok && below.ok)
    assert.equal(own.value.moderation, 'taken_down')
    assert.equal(below.value.moderation, 'taken_down', '위 페이지가 내려지면 아래도')

    assert.ok((await unpublishPage(boss.ctx, doc)).ok)
    assert.deepEqual(await publishPage(boss.ctx, doc), { ok: false, reason: 'moderated' }, '해제 · 다시 게시로 우회할 수 없다')
    assert.deepEqual(await publishPage(boss.ctx, sub), { ok: false, reason: 'moderated' })

    assert.ok((await reinstatePage(doc, OP)).ok)
    const again = await publishPage(boss.ctx, doc)
    assert.ok(again.ok)
    assert.equal(again.value.moderation, null)
    assert.equal(await opens(token), 'open', '같은 주소로 다시 열린다')
  })
})

// ── ⑥ 검사 ────────────────────────────────────────────────────────────

describe('⑥ 검사', () => {
  test('이름 · 메모 · 까닭이 틀리면 invalid_input — 아무것도 남지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('검사'))
    for (const [reason, input] of [
      ['spam', { actor: '' }],
      ['spam', { actor: '   ' }],
      ['spam', { actor: 'x'.repeat(101) }],
      ['spam', { actor: '운영자', note: 'x'.repeat(2001) }],
      ['악성', { actor: '운영자' }],
      [undefined, { actor: '운영자' }],
    ] as const) {
      assert.deepEqual(await takeDownPage(doc, reason, input), { ok: false, reason: 'invalid_input' }, JSON.stringify([reason, input]))
    }
    assert.equal(await stateOf(doc), 'none')
    const count = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM moderation_action WHERE target_id = $1`, [doc])
    assert.equal(count.n, 0)
  })
})

// ── ⑦ 읽기 ────────────────────────────────────────────────────────────

describe('⑦ 운영자가 읽는 것', () => {
  test('열린 목록에 서고 · 케이스 하나는 신고 · 조치 · 지문 앞 12자', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('읽기'))
    const token = await tokenOf(boss, doc)
    const { caseId } = await reportOn(token)
    assert.ok((await listCases('open', 500)).some((c) => c.id === caseId))

    assert.ok((await takeDownPage(doc, 'malware', OP)).ok)
    assert.ok(!(await listCases('open', 500)).some((c) => c.id === caseId), '닫힌 케이스는 열린 목록에 없다')
    const detail = await readCase(caseId)
    assert.ok(detail)
    assert.equal(detail.state, 'actioned')
    assert.equal(detail.pageState, 'taken_down')
    assert.equal(detail.reports.length, 1)
    assert.equal(detail.reports[0]!.reporter?.length, 12)
    assert.match(detail.reports[0]!.snapshotTitle ?? '', /^읽기/)
    assert.deepEqual(detail.actions.map((a) => [a.action, a.reasonCode, a.actor]), [['take_down', 'malware', '운영자 김']])
    assert.equal(await readCase(crypto.randomUUID()), null)
  })
})
