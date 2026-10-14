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
 *   ⑧ ★ 워크스페이스 게시 차단(6b-3a · 정본 ⑥) — 지금 열린 공개 링크 · 웹 공개 폼을 내린다(토큰은 남는다) · 워크스페이스 멤버만의 폼은
 *      그대로 · 효과 정책은 닫히고 설정 값은 소유자의 것 그대로(소유자가 켜도 닫힌 채) · 링크를 직접 켜도 공개 경로 · 노출 판정이 닫는다 ·
 *      새로 게시 · 웹에 열기는 publishing_blocked · 다른 워크스페이스는 그대로 · 조치 한 줄 · 두 번은 already · 풀어도 다시 열지 않는다
 *      (소유자가 다시 게시하면 같은 주소) · 막혀 있지 않으면 not_blocked · 틀린 값은 아무것도 남기지 않는다 ·
 *      소유자가 보는 세 상태(6b-3b — 게시 상태 · 폼 읽기 · 설정의 안내 줄)가 잠금을 싣고 풀면 거둔다
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { createDatabase } from '../database/database.ts'
import { createFormView, readForm, updateFormSettings } from '../database/form.ts'
import { readPublicForm } from '../database/form-submit.ts'
import { query, queryOne } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import type { BlockId } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { resolvePublicPage, webExposureIn } from '../publish/public-access.ts'
import { publishPage, readPublishState, unpublishPage } from '../publish/public-link.ts'
import { PUBLISHING_BLOCKED_SETTING_NOTICE, readSettings, updateSetting } from '../settings/settings.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { readSecurityPolicyIn } from '../workspace/security-policy.ts'
import {
  blockWorkspacePublishing,
  dismissCase,
  listCases,
  readCase,
  reinstatePage,
  takeDownPage,
  unblockWorkspacePublishing,
} from './operator.ts'
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
    // 열린 목록은 오래된 순이라 상한 안에 들어야 보인다 — 검사가 남긴 열린 케이스가 쌓이는 개발 DB 에서도 서게 상한을 넉넉히(500 을 넘어
    // 떨어졌다 · 2026-10-14)
    const OPEN_ALL = 100_000
    assert.ok((await listCases('open', OPEN_ALL)).some((c) => c.id === caseId))

    assert.ok((await takeDownPage(doc, 'malware', OP)).ok)
    assert.ok(!(await listCases('open', OPEN_ALL)).some((c) => c.id === caseId), '닫힌 케이스는 열린 목록에 없다')
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

// ── ⑧ 워크스페이스 게시 차단 ────────────────────────────────────────

/** 표 하나에 폼 하나 — 열어 둔 채로. 토큰을 돌려준다. */
async function openForm(by: Actor, access: 'public' | 'workspace'): Promise<{ viewId: string; token: string }> {
  const db = await createDatabase(by.ctx, { name: unique('폼 표'), privateTop: true })
  assert.ok(db.ok, JSON.stringify(db))
  const form = await createFormView(by.ctx, db.value.id)
  assert.ok(form.ok, JSON.stringify(form))
  const opened = await updateFormSettings(by.ctx, form.value.viewId, { access })
  assert.ok(opened.ok, JSON.stringify(opened))
  return { viewId: form.value.viewId, token: opened.value.settings.token! }
}

const policyOf = (ws: string) => withReadTransaction((tx) => readSecurityPolicyIn(tx, ws))

const actionsOn = (ws: string) =>
  query<{ target_type: string; action: string; reason_code: string | null; actor: string }>(
    `SELECT target_type, action, reason_code, actor FROM moderation_action WHERE target_type = 'workspace' AND target_id = $1 ORDER BY created_at, id`,
    [ws],
  )

describe('⑧ ★ 워크스페이스 게시 차단(6b-3a)', () => {
  test('지금 열린 것을 내린다 · 멤버만의 폼은 그대로 · 효과 정책은 닫히고 설정 값은 그대로 · 우회도 닫힌다 · publishing_blocked · already', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const top = await pageNamed(boss, unique('공지'))
    const other = await pageNamed(boss, unique('안내'))
    const quiet = await pageNamed(boss, unique('게시 안 한 것'))
    const topToken = await tokenOf(boss, top)
    const otherToken = await tokenOf(boss, other)
    const web = await openForm(boss, 'public')
    const inner = await openForm(boss, 'workspace')
    const elsewhere = await office()
    const theirs = await tokenOf(elsewhere.boss, await pageNamed(elsewhere.boss, unique('남의 공지')))

    const blocked = await blockWorkspacePublishing(ws, 'spam', { actor: '운영자 김', note: '반복 위반' })
    assert.ok(blocked.ok, JSON.stringify(blocked))
    assert.deepEqual([blocked.value.unpublishedPages, blocked.value.closedForms], [2, 1], '켜진 링크 둘 · 웹 공개 폼 하나')

    assert.deepEqual([await opens(topToken), await opens(otherToken)], ['not_found', 'not_found'])
    const links = await query<{ node_id: string; enabled: boolean; token: string }>(
      `SELECT node_id, enabled, token FROM public_link WHERE node_id = ANY($1::uuid[]) ORDER BY token`,
      [[top, other]],
    )
    assert.deepEqual(links.map((l) => [l.enabled, l.token]).sort(), [[false, otherToken], [false, topToken]].sort(), '끄기만 한다 — 토큰은 남는다')
    const forms = await query<{ view_id: string; access: string; token: string }>(
      `SELECT view_id, access, token FROM form_view WHERE view_id = ANY($1::uuid[])`,
      [[web.viewId, inner.viewId]],
    )
    assert.deepEqual(
      Object.fromEntries(forms.map((f) => [f.view_id, [f.access, f.token]])),
      { [web.viewId]: ['closed', web.token], [inner.viewId]: ['workspace', inner.token] },
      '웹 공개 폼만 닫는다 — 워크스페이스 멤버만의 폼은 밖으로 내보내는 것이 아니다',
    )
    assert.equal(await readPublicForm(web.token), null)
    assert.notEqual(await readPublicForm(inner.token), null, '멤버만의 폼은 그대로 받는다')
    assert.equal(await opens(theirs), 'open', '다른 워크스페이스는 그대로')

    // 효과 정책은 닫히고, 설정 값은 소유자의 것 그대로 — 소유자가 켜도 닫힌 채
    assert.deepEqual(await policyOf(ws), { ...(await policyOf(ws)), allowPublish: false, allowPublishSetting: true, publishingBlocked: true })
    assert.ok((await updateSetting(boss.ctx, 'workspace.allow_publish_sites_and_forms', true)).ok)
    assert.equal((await policyOf(ws)).allowPublish, false, '설정으로 되돌릴 수 없다')
    const setting = (await readSettings(boss.ctx)).find((item) => item.key === 'workspace.allow_publish_sites_and_forms')
    assert.equal(setting?.value, true, '설정 화면은 소유자의 값 그대로 — 잠금이 설정을 바꾸지 않는다')
    // 소유자가 보는 세 상태(6b-3b) — 설정의 안내 줄 · 게시 상태 · 폼 읽기
    assert.equal(setting?.notice, PUBLISHING_BLOCKED_SETTING_NOTICE, '그 줄 아래에 운영 정책의 안내')
    assert.equal((await readSettings(boss.ctx)).find((item) => item.key === 'workspace.allow_export')?.notice, null, '다른 줄은 안내가 없다')
    const shown = await readPublishState(boss.ctx, top)
    assert.ok(shown.ok)
    assert.deepEqual([shown.value.policyAllows, shown.value.publishingBlocked, shown.value.published], [false, true, false])
    const formShown = await readForm(boss.ctx, web.viewId)
    assert.ok(formShown.ok)
    assert.deepEqual([formShown.value.policyAllows, formShown.value.publishingBlocked], [false, true])

    // 링크를 직접 켜도(우회) 공개 경로 · 노출 판정이 닫는다
    await query(`UPDATE public_link SET enabled = true WHERE node_id = $1`, [top])
    assert.equal(await opens(topToken), 'not_found', '공개 경로의 SQL 이 잠금을 본다')
    assert.deepEqual(await withReadTransaction((tx) => webExposureIn(tx, ws, top)), { own: false, open: false })
    await query(`UPDATE public_link SET enabled = false WHERE node_id = $1`, [top])

    assert.deepEqual(await publishPage(boss.ctx, quiet), { ok: false, reason: 'publishing_blocked' }, '새로 게시 — 소유자 정책과 가른다')
    assert.deepEqual(await updateFormSettings(boss.ctx, web.viewId, { access: 'public' }), { ok: false, reason: 'publishing_blocked' })
    assert.ok((await updateFormSettings(boss.ctx, web.viewId, { access: 'workspace' })).ok, '멤버만으로는 연다')

    assert.deepEqual(await blockWorkspacePublishing(ws, 'spam', { actor: '운영자 김' }), { ok: false, reason: 'already' })
    assert.deepEqual(
      (await actionsOn(ws)).map((a) => [a.target_type, a.action, a.reason_code, a.actor]),
      [['workspace', 'block_publishing', 'spam', '운영자 김']],
    )
  })

  test('풀어도 다시 열지 않는다 — 잠금만 지운다 · 소유자가 다시 게시하면 같은 주소 · 막혀 있지 않으면 not_blocked', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const page = await pageNamed(boss, unique('공지'))
    const token = await tokenOf(boss, page)
    assert.deepEqual(await unblockWorkspacePublishing(ws, { actor: '운영자 김' }), { ok: false, reason: 'not_blocked' })
    assert.ok((await blockWorkspacePublishing(ws, 'phishing', { actor: '운영자 김' })).ok)

    const freed = await unblockWorkspacePublishing(ws, { actor: '운영자 이', note: '이의 받아들임' })
    assert.ok(freed.ok, JSON.stringify(freed))
    const after = await readPublishState(boss.ctx, page)
    assert.deepEqual(after.ok && [after.value.policyAllows, after.value.publishingBlocked], [true, false], '풀면 게시 상태가 거둔다')
    assert.equal((await readSettings(boss.ctx)).find((item) => item.key === 'workspace.allow_publish_sites_and_forms')?.notice, null, '안내 줄도')
    assert.deepEqual([(await policyOf(ws)).allowPublish, (await policyOf(ws)).publishingBlocked], [true, false])
    assert.equal(await opens(token), 'not_found', '내린 게시는 그대로 — 소유자가 다시 연다(17 Q14)')
    assert.equal(await tokenOf(boss, page), token, '다시 게시하면 같은 주소')
    assert.equal(await opens(token), 'open')
    assert.deepEqual(
      (await actionsOn(ws)).map((a) => [a.action, a.reason_code, a.actor]),
      [['block_publishing', 'phishing', '운영자 김'], ['unblock_publishing', null, '운영자 이']],
    )
  })

  test('틀린 값은 invalid_input · 없는 워크스페이스는 not_found — 아무것도 남기지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const token = await tokenOf(boss, await pageNamed(boss, unique('공지')))
    for (const [reason, actor] of [['nope', '운영자'], [undefined, '운영자'], ['spam', '  '], ['spam', 'x'.repeat(101)]] as const) {
      assert.deepEqual(await blockWorkspacePublishing(ws, reason, { actor }), { ok: false, reason: 'invalid_input' }, `${reason} · ${actor.length}`)
    }
    assert.deepEqual(await blockWorkspacePublishing('not-a-uuid', 'spam', { actor: '운영자' }), { ok: false, reason: 'not_found' })
    assert.deepEqual(await blockWorkspacePublishing('0190a3f1-0000-7000-8000-000000000000', 'spam', { actor: '운영자' }), { ok: false, reason: 'not_found' })
    assert.deepEqual(await unblockWorkspacePublishing(ws, { actor: '' }), { ok: false, reason: 'invalid_input' })
    assert.deepEqual([await opens(token), (await policyOf(ws)).publishingBlocked, (await actionsOn(ws)).length], ['open', false, 0])
  })
})
