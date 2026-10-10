/**
 * 공개 페이지 신고 — 게시 · 공유 6b-1a조각 (F-17-08 · F-17-09 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.3 끝 [보강] 공개 페이지 신고).
 *
 *   ① 신고하면 케이스가 열리고 신고 한 줄 — 신고 시점 스냅샷(제목 · 본문 · 공개 밖은 가려진 채) · 원문 IP 는 어디에도 없다 ·
 *      대상은 `reported` · 하위 페이지는 그 페이지가 대상이고 들어온 루트가 남는다
 *   ② ★ 케이스는 대상마다 하나 열린다 — 두 번째 신고는 같은 케이스 · 동시에 와도 하나 · 닫힌 뒤의 신고는 새 케이스
 *   ③ ★ 공개 경로로만 — 공개 밖 · 해제 · 만료 · 모양이 틀린 토큰은 not_found 이고 아무것도 남지 않는다
 *   ④ 검사 — 사유는 넷 · 상세는 2000자까지
 *   ⑤ ★ 신고만으로 내리지 않는다 — 신고된 페이지도 공개 경로가 연다 · 복구됐던(reinstated) 페이지는 다시 reported
 *   ⑥ ★ 레이트리밋 — 같은 사람 10분에 5건 · 같은 페이지 1시간에 30건
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { pageMentionRun, textRun } from '../contracts/rich-text.ts'
import { query, queryOne } from '../db/pool.ts'
import type { BlockId } from '../ids.ts'
import { resolvePublicPage } from '../publish/public-access.ts'
import { publishPage, unpublishPage } from '../publish/public-link.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { submitReport, MAX_REPORT_DETAIL, type ReportInput } from './report.ts'

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
  const ws = await createBareWorkspace('신고')
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

/** 테스트마다 다른 사람 — UA 로 지문을 가른다(레이트리밋이 서로 간섭하지 않게). */
const someone = (label = unique('브라우저')) => ({ ip: '203.0.113.7', userAgent: label })

const report = (token: string, extra: Partial<ReportInput> = {}) =>
  submitReport({ token, reason: 'phishing_spam', detail: '가짜 로그인 화면', reporter: someone(), ...extra })

const countFor = async (table: 'abuse_report' | 'moderation_case', targetId: string) =>
  (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE target_id = $1`, [targetId])).n

// ── ① 받기 ────────────────────────────────────────────────────────────

describe('① 신고하면 케이스 · 신고 한 줄', () => {
  test('스냅샷은 공개 화면이 그린 재료 · 원문 IP 는 없다 · 대상은 reported', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, '수상한 페이지')
    const secret = await pageNamed(boss, unique('비밀 계획'))
    const saved = await savePageBody(boss.ctx, doc, { blocks: [{ id: crypto.randomUUID(), type: 'paragraph', title: [textRun('여기 로그인 '), pageMentionRun(secret)] }] })
    assert.ok(saved.ok, JSON.stringify(saved))
    const token = await tokenOf(boss, doc)

    const done = await report(token, { reporter: { ip: '198.51.100.23', userAgent: unique('UA') } })
    assert.ok(done.ok, JSON.stringify(done))

    const kase = await queryOne<{ state: string; report_count: number; target_id: string }>(
      `SELECT state, report_count, target_id FROM moderation_case WHERE id = $1`,
      [done.value.caseId],
    )
    assert.deepEqual(kase, { state: 'open', report_count: 1, target_id: doc })
    const row = await queryOne<{ reason: string; detail: string; reporter_hash: string; content_snapshot: { title: string; doc: unknown }; via_root_id: string }>(
      `SELECT reason, detail, reporter_hash, content_snapshot, via_root_id FROM abuse_report WHERE id = $1`,
      [done.value.reportId],
    )
    assert.equal(row.reason, 'phishing_spam')
    assert.equal(row.detail, '가짜 로그인 화면')
    assert.equal(row.via_root_id, doc)
    assert.equal(row.content_snapshot.title, '수상한 페이지')
    const snapshot = JSON.stringify(row.content_snapshot)
    assert.ok(snapshot.includes('여기 로그인'), '본문이 남는다')
    assert.ok(!snapshot.includes('비밀 계획'), '공개 밖은 가려진 채로')
    assert.match(row.reporter_hash, /^[0-9a-f]{64}$/)
    // 이 페이지의 신고 · 케이스만 본다 — 표 전체를 훑으면 다른 판(반사실)이 남긴 행에 흔들린다
    const leaked = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM abuse_report r JOIN moderation_case c ON c.id = r.case_id
        WHERE r.target_id = $1 AND (row_to_json(r)::text LIKE '%198.51.100.23%' OR row_to_json(c)::text LIKE '%198.51.100.23%')`,
      [doc],
    )
    assert.equal(leaked.n, 0, '원문 IP 는 어디에도 없다')

    const state = await queryOne<{ moderation_state: string }>(`SELECT moderation_state FROM block WHERE id = $1`, [doc])
    assert.equal(state.moderation_state, 'reported')
  })

  test('하위 페이지 — 그 페이지가 대상이고 들어온 루트가 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('루트'))
    const sub = await pageNamed(boss, '하위', doc)
    const token = await tokenOf(boss, doc)
    const done = await report(token, { pageId: sub, reason: 'inappropriate', detail: '' })
    assert.ok(done.ok)
    const row = await queryOne<{ target_id: string; via_root_id: string }>(`SELECT target_id, via_root_id FROM abuse_report WHERE id = $1`, [done.value.reportId])
    assert.deepEqual(row, { target_id: sub, via_root_id: doc })
  })
})

// ── ② 케이스 ──────────────────────────────────────────────────────────

describe('② ★ 케이스는 대상마다 하나 열린다', () => {
  test('두 번째 신고는 같은 케이스 · 동시에 와도 하나 · 닫힌 뒤의 신고는 새 케이스', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('여러 번'))
    const token = await tokenOf(boss, doc)

    const a = await report(token)
    const b = await report(token, { reason: 'other' })
    assert.ok(a.ok && b.ok)
    assert.equal(a.value.caseId, b.value.caseId)
    const together = await Promise.all([report(token), report(token), report(token)])
    assert.ok(together.every((r) => r.ok && r.value.caseId === a.value.caseId), JSON.stringify(together))
    const kase = await queryOne<{ report_count: number }>(`SELECT report_count FROM moderation_case WHERE id = $1`, [a.value.caseId])
    assert.equal(kase.report_count, 5)
    assert.equal(await countFor('moderation_case', doc), 1)

    await query(`UPDATE moderation_case SET state = 'dismissed', closed_at = now() WHERE id = $1`, [a.value.caseId])
    const after = await report(token)
    assert.ok(after.ok)
    assert.notEqual(after.value.caseId, a.value.caseId, '닫힌 케이스는 다시 열지 않는다')
    assert.equal(await countFor('moderation_case', doc), 2)
  })
})

// ── ③ 공개 경로로만 ──────────────────────────────────────────────────

describe('③ ★ 공개 경로로만', () => {
  test('공개 밖 · 해제 · 만료 · 모양이 틀린 토큰은 not_found — 아무것도 남지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('게시'))
    const elsewhere = await pageNamed(boss, unique('비공개'))
    const token = await tokenOf(boss, doc)

    assert.deepEqual(await report(token, { pageId: elsewhere }), { ok: false, reason: 'not_found' })
    assert.deepEqual(await report('A'.repeat(22)), { ok: false, reason: 'not_found' })
    assert.deepEqual(await report('짧다'), { ok: false, reason: 'not_found' })
    assert.ok((await unpublishPage(boss.ctx, doc)).ok)
    assert.deepEqual(await report(token), { ok: false, reason: 'not_found' })
    await tokenOf(boss, doc)
    await query(`UPDATE public_link SET expires_at = now() - interval '1 minute' WHERE node_id = $1`, [doc])
    assert.deepEqual(await report(token), { ok: false, reason: 'not_found' })

    assert.equal(await countFor('abuse_report', doc), 0)
    assert.equal(await countFor('abuse_report', elsewhere), 0)
    assert.equal(await countFor('moderation_case', elsewhere), 0)
  })
})

// ── ④ 검사 ────────────────────────────────────────────────────────────

describe('④ 검사', () => {
  test('사유는 넷 · 상세는 2000자까지(앞뒤 공백은 뗀다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('검사'))
    const token = await tokenOf(boss, doc)
    for (const reason of ['spam', '', null, undefined, 'constructor']) {
      assert.deepEqual(await report(token, { reason }), { ok: false, reason: 'invalid_reason' }, String(reason))
    }
    assert.deepEqual(await report(token, { detail: 'x'.repeat(MAX_REPORT_DETAIL + 1) }), { ok: false, reason: 'detail_too_long' })
    const edge = await report(token, { detail: `  ${'x'.repeat(MAX_REPORT_DETAIL)}  `, reason: 'dmca' })
    assert.ok(edge.ok, JSON.stringify(edge))
  })
})

// ── ⑤ 내리지 않는다 ───────────────────────────────────────────────────

describe('⑤ ★ 신고만으로 내리지 않는다', () => {
  test('신고된 페이지도 공개 경로가 연다 · 복구됐던 페이지는 다시 reported', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('열린 채'))
    const token = await tokenOf(boss, doc)
    assert.ok((await report(token)).ok)
    assert.ok((await resolvePublicPage(token)).ok, '신고만으로 닫히지 않는다')

    await query(`UPDATE block SET moderation_state = 'reinstated' WHERE id = $1`, [doc])
    assert.ok((await report(token)).ok)
    const state = await queryOne<{ moderation_state: string }>(`SELECT moderation_state FROM block WHERE id = $1`, [doc])
    assert.equal(state.moderation_state, 'reported')
  })
})

// ── ⑥ 레이트리밋 ──────────────────────────────────────────────────────

describe('⑥ ★ 레이트리밋', () => {
  test('같은 사람은 10분에 5건 — 여섯째는 rate_limited 이고 남지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('같은 사람'))
    const token = await tokenOf(boss, doc)
    const me = someone()
    for (let i = 0; i < 5; i += 1) assert.ok((await report(token, { reporter: me })).ok, `${i + 1}번째`)
    assert.deepEqual(await report(token, { reporter: me }), { ok: false, reason: 'rate_limited' })
    assert.equal(await countFor('abuse_report', doc), 5)
    assert.ok((await report(token)).ok, '다른 사람은 된다')
  })

  test('같은 페이지는 1시간에 30건 — 서른한째는 rate_limited', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('몰려드는'))
    const token = await tokenOf(boss, doc)
    for (let i = 0; i < 30; i += 1) assert.ok((await report(token)).ok, `${i + 1}번째`)
    assert.deepEqual(await report(token), { ok: false, reason: 'rate_limited' })
    assert.equal(await countFor('abuse_report', doc), 30)
  })
})
