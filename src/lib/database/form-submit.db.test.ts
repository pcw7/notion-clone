/**
 * 폼 — 공개 제출 — 인접 제품 7a-2a조각 (F-13-02 · F-17-10 · DB · Valkey)
 *
 * 이 파일이 지키는 것(정본 §3.6 끝 [보강] 폼 ④⑥).
 *
 *   ① ★ 받는다 — 공개 폼을 세션 없이 읽는다(제목은 비면 데이터베이스 이름 · 질문 제목은 비면 속성 이름 · 선택의 옵션) · 응답은 행이다
 *      (만든 사람 · 활동의 행위자 NULL · 그 폼의 질문만 — 다른 칸은 버린다) · 메타는 사이드카(지문 · 작성 시간)
 *   ② ★ 방어 — 다른 출처 · 허니팟(받은 척 · 아무것도 남기지 않는다) · 제출 토큰(틀림 · 다른 폼의 것 · 오래됨 · 너무 빠름 · 한 번만) ·
 *      값이 틀린 제출은 토큰을 쓰지 않는다 · 레이트리밋(제출자 × 폼 10건)
 *   ③ 값 — 필수 · 선택은 그 속성의 옵션 · 숫자 · 날짜 · 길이 · 필수 체크박스 — 질문마다 까닭
 *   ④ ★ 열 수 없으면 not_found — 닫힘 · 정책 · 데이터베이스 휴지통 · 폼을 지움 · 토큰 모양
 *   ⑥ ★ 응답 상한 · 마감 시각(7b-2 · 정본 ⑩) — 상한에 닿으면 form_closed(공개 읽기가 까닭을 싣는다 · 토큰 검사 전) · 휴지통의 응답은 세지
 *      않는다 · 동시 제출이 상한을 넘지 않는다 · 마감 시각이 지나면 닫히고 미루면 다시 받는다
 *   ⑤ ★ 워크스페이스 멤버만의 폼(7b-1 · 정본 ⑨) — 응답자를 정한다(로그인 없음 · 게스트 · 다른 워크스페이스 · 멤버) · 멤버만 내고 만든 사람 ·
 *      활동의 행위자가 그 사람 · 정책이 웹 공개를 막아도 열린다 · 웹 공개 폼은 세션을 실어 내도 익명
 *   ⑦ ★ 한 사람당 한 번(7b-3 · 정본 ⑪) — 둘째는 already_submitted(토큰 검사 전) · 켜기 전의 응답도 센다 · 다른 멤버는 낸다 · 그 사람의
 *      살아 있는 응답이 하나라도 있으면 막고 모두 지우면 다시 낸다 · 끄면 다시 받는다 · 같은 사람의 동시 제출은 하나만 · 웹 공개 폼은
 *      켜 두어도 막지 않는다(같은 지문 · 같은 세션도) — 워크스페이스로 바꾸면 그때부터(공개 때의 익명 응답은 그 사람의 것이 아니다)
 *   ⑧ ★ 제출 뒤 응답자 권한(7b-4 · 정본 ⑫) — 데이터베이스를 못 보는 멤버가 자기 응답 하나를 그 레벨로 연다(다른 응답 · 표는 아니다) ·
 *      ACL 행 하나(준 사람 없음) · 결과가 그 행의 주소를 싣는다 · 레벨대로(댓글은 고치지 못한다 · 편집은 고친다) · 바꿔도 이미 준 것은
 *      그대로 · 없음이면 주지 않는다 · 웹 공개 응답은 받지 않는다(멤버의 세션을 실어도)
 *   ⑨ ★ 조건부 보이기(7b-5a · 정본 ⑬) — 공개 읽기가 조건을 싣는다 · 서버가 다시 평가한다: 숨은 질문은 필수도 묻지 않고 답을 버린다(숨은
 *      근거에 걸린 질문도) · 보이면 필수를 묻는다 · 옵션을 지우면 끊어진 조건이라 질문이 보인다(필수도 다시) · 근거의 타입이 바뀌어도(7b-5b)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can, type Capability } from '../permissions/levels.ts'
import { updateSetting } from '../settings/settings.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { addDataSource, trashDataSource } from './data-source.ts'
import { convertProperty } from './property-convert.ts'
import { createDatabase } from './database.ts'
import { createFormView, setFormQuestions, updateFormSettings } from './form.ts'
import { alreadyResponded, issueSubmissionToken, readPublicForm, resolveFormRespondent, submitFormResponse, type SubmitInput } from './form-submit.ts'
import { addProperty, addSelectOption, deleteProperty, getSchema } from './property.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { deleteView } from './view.ts'
import { trashPage } from '../block/trash.ts'

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

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

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

let seq = 0
/** 검사마다 다른 제출자 — 레이트리밋이 섞이지 않게. */
const submitter = () => ({ ip: `10.7.${Math.floor((seq += 1) / 250)}.${seq % 250}`, userAgent: 'form-test' })

/** 대표의 신청 표(이름 · 메모 · 나이 · 분류 · 동의 · 날짜 · 상태) · 공개한 폼(상태는 질문이 아니다). */
async function publicForm() {
  const ws = await createBareWorkspace('공개 폼')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const db = unwrap(await createDatabase(boss.ctx, { name: '참가 신청', privateTop: true }))
  const ds = db.dataSourceId
  for (const [name, type] of [['메모', 'rich_text'], ['나이', 'number'], ['분류', 'select'], ['동의', 'checkbox'], ['날짜', 'date'], ['상태', 'status']] as const) {
    unwrap(await addProperty(boss.ctx, ds, { name, type }))
  }
  const schema = unwrap(await getSchema(boss.ctx, ds))
  const id = (name: string) => schema.properties.find((p) => p.name === name)!.id
  const title = schema.properties.find((p) => p.type === 'title')!.id
  const kind = id('분류')
  const optionA = unwrap(await addSelectOption(boss.ctx, ds, kind, { name: '개인' })).option.id
  const form = unwrap(await createFormView(boss.ctx, db.id, { name: '신청서' }))
  unwrap(
    await setFormQuestions(boss.ctx, form.viewId, [
      { propertyId: title, required: true, label: '이름' },
      { propertyId: id('메모') },
      { propertyId: id('나이') },
      { propertyId: kind, required: true },
      { propertyId: id('동의'), required: true },
      { propertyId: id('날짜') },
    ]),
  )
  const token = unwrap(await updateFormSettings(boss.ctx, form.viewId, { access: 'public' })).settings.token!
  return { ws, boss, db, ds, form, token, title, memo: id('메모'), age: id('나이'), kind, optionA, agree: id('동의'), day: id('날짜'), status: id('상태') }
}

type Fx = Awaited<ReturnType<typeof publicForm>>

const goodAnswers = (fx: Fx) => ({
  [fx.title]: '  김하나 ',
  [fx.memo]: '잘 부탁드립니다',
  [fx.age]: '31',
  [fx.kind]: fx.optionA,
  [fx.agree]: true,
  [fx.day]: '2026-11-01',
  // 질문이 아닌 칸 — 버린다
  [fx.status]: 'whatever',
})

/** 5초 전에 받은 화면의 제출. */
const submit = (fx: Fx, patch: Partial<SubmitInput> = {}, now = Date.now()) =>
  submitFormResponse(
    {
      token: fx.token,
      submission: issueSubmissionToken(fx.form.viewId, now - 5000),
      answers: goodAnswers(fx),
      trap: '',
      origin: null,
      serverOrigin: 'http://localhost:3000',
      submitter: submitter(),
      ...patch,
    },
    now,
  )

const rowsOf = (ds: string) =>
  query<{ id: string; created_by: string | null; last_edited_by: string | null }>(
    `SELECT p.id, b.created_by, b.last_edited_by FROM page p JOIN block b ON b.id = p.id WHERE p.data_source_id = $1 AND NOT p.is_template`,
    [ds],
  )

// ── ① 받는다 ──────────────────────────────────────────────────────────

describe('① ★ 받는다', () => {
  test('공개 폼을 읽는다 · 응답은 행(만든 사람 NULL · 질문만) · 메타는 사이드카', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    const read = await readPublicForm(fx.token)
    assert.ok(read !== null)
    assert.equal(read.title, '참가 신청', '폼 제목이 비면 데이터베이스 이름')
    assert.deepEqual(read.questions.map((q) => [q.label, q.required, q.type]), [
      ['이름', true, 'title'], ['메모', false, 'rich_text'], ['나이', false, 'number'], ['분류', true, 'select'], ['동의', true, 'checkbox'], ['날짜', false, 'date'],
    ])
    assert.deepEqual(read.questions[3]!.options.map((o) => o.name), ['개인'])
    assert.deepEqual([read.submitLabel, read.confirmationTitle], ['제출', '제출했습니다'])

    const result = await submit(fx)
    assert.ok(result.ok && result.value.pageId !== null, JSON.stringify(result))
    const pageId = result.value.pageId!
    assert.deepEqual((await rowsOf(fx.ds)).map((r) => [r.id, r.created_by, r.last_edited_by]), [[pageId, null, null]], '만든 사람 · 고친 사람이 없다')
    const cells = await query<{ property_id: string; value: Record<string, unknown> }>(
      `SELECT property_id, value FROM page_property_value WHERE page_id = $1`,
      [pageId],
    )
    const valueOf = (property: string) => cells.find((c) => c.property_id === property)?.value
    assert.equal((valueOf(fx.title)?.title as { plain_text: string }[])[0]!.plain_text, '김하나', '앞뒤 공백을 걷는다')
    assert.deepEqual(valueOf(fx.age), { type: 'number', number: 31 })
    assert.deepEqual(valueOf(fx.kind), { type: 'select', select: { id: fx.optionA } })
    assert.deepEqual(valueOf(fx.agree), { type: 'checkbox', checkbox: true })
    assert.deepEqual(valueOf(fx.day), { type: 'date', date: { start: '2026-11-01' } })
    // 상태는 새 행의 기본 옵션을 받는다(정상) — 보낸 'whatever' 가 아니다
    assert.notEqual(((valueOf(fx.status) as { status?: { id?: string } } | undefined)?.status?.id ?? null), 'whatever', '질문이 아닌 칸은 버린다')

    const activity = await query<{ actor_id: string | null }>(`SELECT actor_id FROM activity_event WHERE page_id = $1 AND type = 'page.created'`, [pageId])
    assert.deepEqual(activity.map((a) => a.actor_id), [null], '활동의 행위자도 없다')
    const meta = await query<{ view_id: string; submitter_hash: string; dwell_ms: number }>(
      `SELECT view_id, submitter_hash, dwell_ms FROM form_submission_meta WHERE page_id = $1`,
      [pageId],
    )
    assert.equal(meta.length, 1)
    assert.equal(meta[0]!.view_id, fx.form.viewId)
    assert.match(meta[0]!.submitter_hash, /^[0-9a-f]{64}$/)
    assert.ok(meta[0]!.dwell_ms >= 5000 && meta[0]!.dwell_ms < 6000, String(meta[0]!.dwell_ms))
  })
})

// ── ② 방어 ────────────────────────────────────────────────────────────

describe('② ★ 방어', () => {
  test('출처 · 허니팟 · 토큰(틀림 · 다른 폼 · 오래됨 · 너무 빠름 · 한 번만) · 값이 틀리면 토큰을 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    const other = await publicForm()
    const now = Date.now()
    assert.deepEqual(await submit(fx, { origin: 'https://evil.example' }), { ok: false, reason: 'bad_origin' })
    assert.deepEqual(await submit(fx, { origin: 'http://localhost:3000' }).then((r) => r.ok), true, '같은 출처는 받는다')
    assert.deepEqual(await submit(fx, { trap: 'http://spam.example' }), { ok: true, value: { pageId: null, responsePath: null } }, '허니팟 — 받은 척')
    assert.equal((await rowsOf(fx.ds)).length, 1, '허니팟은 아무것도 남기지 않는다')

    assert.deepEqual(await submit(fx, { submission: 'garbage' }), { ok: false, reason: 'invalid_token' })
    assert.deepEqual(await submit(fx, { submission: issueSubmissionToken(other.form.viewId, now - 5000) }), { ok: false, reason: 'invalid_token' }, '다른 폼의 토큰')
    const forged = issueSubmissionToken(fx.form.viewId, now - 5000).replace(/^\d+/, String(now - 10_000))
    assert.deepEqual(await submit(fx, { submission: forged }), { ok: false, reason: 'invalid_token' }, '시각을 고친 토큰(서명이 맞지 않는다)')
    assert.deepEqual(await submit(fx, { submission: issueSubmissionToken(fx.form.viewId, now - 3 * 60 * 60 * 1000) }), { ok: false, reason: 'expired' })
    assert.deepEqual(await submit(fx, { submission: issueSubmissionToken(fx.form.viewId, now - 1000) }), { ok: false, reason: 'too_fast' })

    const once = issueSubmissionToken(fx.form.viewId, now - 5000)
    const wrong = await submit(fx, { submission: once, answers: { ...goodAnswers(fx), [fx.age]: '서른' } })
    assert.equal(wrong.ok ? 'ok' : wrong.reason, 'invalid_value')
    assert.equal((await submit(fx, { submission: once })).ok, true, '값이 틀렸던 토큰으로 고쳐 다시 낸다')
    assert.deepEqual(await submit(fx, { submission: once }), { ok: false, reason: 'invalid_token' }, '★ 한 번만')
    assert.equal((await rowsOf(fx.ds)).length, 2)
  })

  test('레이트리밋 — 같은 제출자는 한 폼에 10분 10건', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    const who = submitter()
    const results: string[] = []
    for (let i = 0; i < 11; i += 1) {
      const r = await submit(fx, { submitter: who })
      results.push(r.ok ? 'ok' : r.reason)
    }
    assert.deepEqual(results, [...Array(10).fill('ok'), 'rate_limited'])
    assert.equal((await submit(fx)).ok, true, '다른 제출자는 받는다')
  })
})

// ── ③ 값 ──────────────────────────────────────────────────────────────

describe('③ 값 — 질문마다 까닭', () => {
  test('필수 · 옵션 · 숫자 · 날짜 · 길이 · 체크박스', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    const r = await submit(fx, {
      answers: { [fx.title]: '   ', [fx.memo]: 'x'.repeat(2001), [fx.age]: '서른', [fx.kind]: 'no-such-option', [fx.agree]: false, [fx.day]: '11월 1일' },
    })
    assert.ok(!r.ok && r.reason === 'invalid_value')
    assert.deepEqual(
      (r.issues ?? []).map((i) => i.path).sort(),
      [fx.title, fx.memo, fx.age, fx.kind, fx.agree, fx.day].sort(),
      JSON.stringify(r.issues),
    )
    assert.equal((await rowsOf(fx.ds)).length, 0, '틀린 제출은 아무것도 남기지 않는다')
    const optional = await submit(fx, { answers: { [fx.title]: '이름만', [fx.kind]: fx.optionA, [fx.agree]: 'on' } })
    assert.equal(optional.ok, true, '필수만 채운 제출')
  })
})

// ── ④ 열 수 없으면 ─────────────────────────────────────────────────────

describe('④ ★ 열 수 없으면 not_found', () => {
  test('닫힘 · 정책 · 휴지통 · 폼을 지움 · 토큰 모양', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const notFound = { ok: false, reason: 'not_found' }
    assert.deepEqual(await submit({ ...(await publicForm()), token: 'short' }), notFound)

    const closed = await publicForm()
    unwrap(await updateFormSettings(closed.boss.ctx, closed.form.viewId, { access: 'closed' }))
    assert.equal(await readPublicForm(closed.token), null)
    assert.deepEqual(await submit(closed), notFound, '닫힌 폼')

    const policy = await publicForm()
    unwrap(await updateSetting(policy.boss.ctx, 'workspace.allow_publish_sites_and_forms', false))
    assert.deepEqual(await submit(policy), notFound, '정책이 막으면')

    const trashed = await publicForm()
    // 응답이 쌓이는 소스를 휴지통에 — 마지막 소스는 버리지 못하니 하나를 더한 뒤(데이터베이스 블록 자체는 수명이 없다 · X-3)
    unwrap(await addDataSource(trashed.boss.ctx, trashed.db.id, { name: '둘째' }))
    unwrap(await trashDataSource(trashed.boss.ctx, trashed.ds))
    assert.deepEqual(await submit(trashed), notFound, '응답의 소스가 휴지통')

    const deleted = await publicForm()
    unwrap(await deleteView(deleted.boss.ctx, deleted.form.viewId))
    assert.deepEqual(await submit(deleted), notFound, '폼을 지웠다')
    for (const fx of [closed, policy, trashed, deleted]) assert.equal((await rowsOf(fx.ds)).length, 0)
  })
})

// ── ⑤ 워크스페이스 멤버만의 폼 ────────────────────────────────────────

describe('⑤ ★ 워크스페이스 멤버만의 폼(7b-1)', () => {
  test('응답자를 정한다 · 멤버만 낸다 — 만든 사람 · 활동의 행위자가 그 사람 · 정책이 웹 공개를 막아도 열린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    const opened = unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { access: 'workspace' }))
    assert.equal(opened.settings.token, fx.token, '주소는 그대로다')
    unwrap(await updateSetting(fx.boss.ctx, 'workspace.allow_publish_sites_and_forms', false))
    const mate = await joinAs(fx.ws, await createUser('응답하는 멤버'), 'member')
    const guest = await joinAs(fx.ws, await createUser('손님'), 'guest')
    const stranger = await joinAs(await createBareWorkspace('남의 곳'), await createUser('남'), 'owner')

    const form = await readPublicForm(fx.token)
    assert.equal(form?.access, 'workspace', '정책은 웹 공개만 막는다')
    assert.deepEqual(await resolveFormRespondent(form!, null), { kind: 'login' })
    assert.deepEqual(await resolveFormRespondent(form!, 'no-such-session'), { kind: 'login' })
    assert.deepEqual(await resolveFormRespondent(form!, guest.token), { kind: 'denied' }, '게스트')
    assert.deepEqual(await resolveFormRespondent(form!, stranger.token), { kind: 'denied' }, '다른 워크스페이스')
    const asMate = await resolveFormRespondent(form!, mate.token)
    assert.ok(asMate.kind === 'member' && asMate.name === '응답하는 멤버' && asMate.context.userId === mate.userId)

    for (const [label, sessionToken] of [['로그인 없음', null], ['게스트', guest.token], ['다른 워크스페이스', stranger.token]] as const) {
      assert.deepEqual(await submit(fx, { sessionToken }), { ok: false, reason: 'not_found' }, label)
    }
    const sent = await submit(fx, { sessionToken: mate.token })
    assert.ok(sent.ok, JSON.stringify(sent))
    const pageId = sent.value.pageId!
    assert.deepEqual((await rowsOf(fx.ds)).map((r) => [r.id, r.created_by]), [[pageId, mate.userId]], '응답자가 만든 사람이다')
    const activity = await query<{ actor_id: string | null }>(`SELECT actor_id FROM activity_event WHERE page_id = $1 AND type = 'page.created'`, [pageId])
    assert.deepEqual(activity.map((a) => a.actor_id), [mate.userId], '활동의 행위자도 그 사람이다')
  })

  test('웹 공개 폼은 세션을 보지 않는다 — 멤버의 세션을 실어 내도 익명 · 닫으면 멤버도 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    const mate = await joinAs(fx.ws, await createUser('세션을 실은 멤버'), 'member')
    const sent = await submit(fx, { sessionToken: mate.token })
    assert.ok(sent.ok, JSON.stringify(sent))
    assert.deepEqual((await rowsOf(fx.ds)).map((r) => r.created_by), [null], '강제 익명')
    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { access: 'workspace' }))
    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { access: 'closed' }))
    assert.deepEqual(await submit(fx, { sessionToken: mate.token }), { ok: false, reason: 'not_found' })
  })
})

// ── ⑥ 응답 상한 · 마감 시각 ──────────────────────────────────────────

describe('⑥ ★ 응답 상한 · 마감 시각(7b-2)', () => {
  test('상한에 닿으면 form_closed — 공개 읽기가 까닭을 싣는다 · 토큰 검사 전 · 휴지통의 응답은 세지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { maxResponses: 1 }))
    const first = await submit(fx)
    assert.ok(first.ok, JSON.stringify(first))
    assert.equal((await readPublicForm(fx.token))?.closedBecause, 'limit')
    assert.deepEqual(await submit(fx), { ok: false, reason: 'form_closed' })
    assert.deepEqual(await submit(fx, { submission: 'not-a-token' }), { ok: false, reason: 'form_closed' }, '닫힌 폼은 토큰 검사 전에 말한다')

    await trashPage(fx.boss.ctx, first.value.pageId! as never)
    assert.equal((await readPublicForm(fx.token))?.closedBecause, null, '지운 응답은 자리를 돌려준다')
    assert.ok((await submit(fx)).ok)
  })

  test('동시 제출이 상한을 넘지 않는다 — 폼 행을 잠그고 다시 센다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { maxResponses: 2 }))
    const results = await Promise.all([submit(fx), submit(fx), submit(fx), submit(fx)])
    assert.equal(results.filter((r) => r.ok).length, 2, JSON.stringify(results))
    assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'form_closed'))
    assert.equal((await rowsOf(fx.ds)).length, 2)
  })

  test('마감 시각이 지나면 닫히고 미루면 다시 받는다 — access 는 그대로다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    const past = new Date(Date.now() - 60_000).toISOString()
    const closed = unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { closesAt: past }))
    assert.deepEqual([closed.settings.access, closed.closedBecause], ['public', 'time'], '닫힘은 판정이다 — 공유는 그대로')
    assert.deepEqual(await submit(fx), { ok: false, reason: 'form_closed' })
    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { closesAt: new Date(Date.now() + 3_600_000).toISOString() }))
    assert.ok((await submit(fx)).ok, '미루면 다시 받는다')
  })
})

// ── ⑦ 한 사람당 한 번 ──────────────────────────────────────────────

describe('⑦ ★ 한 사람당 한 번(7b-3)', () => {
  test('둘째는 already_submitted(토큰 검사 전) · 켜기 전의 응답도 센다 · 다른 멤버는 낸다 · 모두 지우면 다시 낸다 · 끄면 다시 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { access: 'workspace' }))
    const mate = await joinAs(fx.ws, await createUser('한 번 내는 멤버'), 'member')
    const other = await joinAs(fx.ws, await createUser('다른 멤버'), 'member')
    assert.ok((await submit(fx, { sessionToken: mate.token })).ok)
    assert.ok((await submit(fx, { sessionToken: mate.token })).ok, '끈 채로는 두 번 낸다')

    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { onePerRespondent: true }))
    const form = (await readPublicForm(fx.token))!
    assert.equal(form.onePerRespondent, true)
    const answered = async (sessionToken: string) => alreadyResponded(form, await resolveFormRespondent(form, sessionToken))
    assert.deepEqual([await answered(mate.token), await answered(other.token)], [true, false], '켜기 전에 낸 응답도 센다')
    assert.deepEqual(await submit(fx, { sessionToken: mate.token }), { ok: false, reason: 'already_submitted' })
    assert.deepEqual(
      await submit(fx, { sessionToken: mate.token, submission: 'not-a-token' }),
      { ok: false, reason: 'already_submitted' },
      '토큰 검사 전에 말한다',
    )
    assert.ok((await submit(fx, { sessionToken: other.token })).ok, '다른 멤버는 낸다')
    assert.deepEqual(await submit(fx, { sessionToken: other.token }), { ok: false, reason: 'already_submitted' })

    // 살아 있는 응답이 하나라도 있으면 막는다 — 모두 지우면 다시 낸다
    const mine = (await rowsOf(fx.ds)).filter((r) => r.created_by === mate.userId)
    assert.equal(mine.length, 2)
    await trashPage(fx.boss.ctx, mine[0]!.id as never)
    assert.equal(await answered(mate.token), true, '하나 남았다')
    await trashPage(fx.boss.ctx, mine[1]!.id as never)
    assert.equal(await answered(mate.token), false, '지운 응답은 세지 않는다')
    assert.ok((await submit(fx, { sessionToken: mate.token })).ok)

    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { onePerRespondent: false }))
    assert.ok((await submit(fx, { sessionToken: mate.token })).ok, '끄면 다시 받는다')
  })

  test('같은 사람이 동시에 내도 하나만 — 폼 행을 잠근 채 다시 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { access: 'workspace', onePerRespondent: true }))
    const mate = await joinAs(fx.ws, await createUser('두 탭의 멤버'), 'member')
    const results = await Promise.all([1, 2, 3, 4].map(() => submit(fx, { sessionToken: mate.token })))
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results))
    assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'already_submitted'), JSON.stringify(results))
    assert.equal((await rowsOf(fx.ds)).length, 1)
  })

  test('웹 공개 폼은 켜 두어도 막지 않는다 — 워크스페이스로 바꾸면 그때부터(공개 때의 익명 응답은 그 사람의 것이 아니다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { onePerRespondent: true }))
    const mate = await joinAs(fx.ws, await createUser('공개 폼의 멤버'), 'member')
    const same = submitter()
    assert.ok((await submit(fx, { sessionToken: mate.token, submitter: same })).ok)
    assert.ok((await submit(fx, { sessionToken: mate.token, submitter: same })).ok, '같은 지문 · 같은 세션이어도 받는다(지문은 열쇠가 아니다)')
    const form = (await readPublicForm(fx.token))!
    assert.equal(await alreadyResponded(form, await resolveFormRespondent(form, mate.token)), false, '익명 응답자는 모른다')

    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { access: 'workspace' }))
    assert.ok((await submit(fx, { sessionToken: mate.token })).ok, '공개 때의 익명 응답은 세지 않는다')
    assert.deepEqual(await submit(fx, { sessionToken: mate.token }), { ok: false, reason: 'already_submitted' })
  })
})

// ── ⑧ 제출 뒤 응답자 권한 ──────────────────────────────────────────

/** 그 사람이 그 노드에서 할 수 있는 것 — 물을 것만. */
const capsOf = async (who: { ctx: Parameters<typeof effectiveCaps>[1] }, nodeId: string, asked: readonly Capability[]) => {
  const caps = await withReadTransaction((tx) => effectiveCaps(tx, who.ctx, nodeId))
  return asked.filter((c) => can(caps, c))
}

const grantsOn = (pageId: string) =>
  query<{ principal_id: string; level: string; granted_by: string | null }>(
    `SELECT principal_id, level, granted_by FROM acl_entry WHERE node_kind = 'block' AND node_id = $1 ORDER BY principal_id`,
    [pageId],
  )

describe('⑧ ★ 제출 뒤 응답자 권한(7b-4)', () => {
  test('데이터베이스를 못 보는 멤버가 자기 응답 하나를 그 레벨로 연다 — ACL 행 하나(준 사람 없음) · 결과가 주소를 싣는다 · 다른 응답 · 표는 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { access: 'workspace', respondentAccess: 'comment' }))
    const mate = await joinAs(fx.ws, await createUser('응답을 받는 멤버'), 'member')
    const other = await joinAs(fx.ws, await createUser('옆자리 멤버'), 'member')
    assert.deepEqual(await capsOf(mate, fx.db.id, ['view']), [], '전제 — 개인 표라 못 본다')

    const mine = await submit(fx, { sessionToken: mate.token })
    assert.ok(mine.ok, JSON.stringify(mine))
    const pageId = mine.value.pageId!
    assert.equal(mine.value.responsePath, `/w/${fx.ws}/${pageId}`, '확인 화면의 "내 응답 보기"')
    assert.deepEqual(await grantsOn(pageId), [{ principal_id: mate.userId, level: 'comment', granted_by: null }], '폼의 칸이 준다 — 사람이 아니다')
    assert.deepEqual(await capsOf(mate, pageId, ['view', 'comment', 'edit_content']), ['view', 'comment'], '댓글 — 고치지는 못한다')

    const theirs = await submit(fx, { sessionToken: other.token })
    assert.ok(theirs.ok)
    assert.deepEqual(await capsOf(mate, theirs.value.pageId!, ['view']), [], '다른 응답은 열리지 않는다')
    assert.deepEqual(await capsOf(mate, fx.db.id, ['view']), [], '표도 열리지 않는다')
    assert.deepEqual(await capsOf(fx.boss, pageId, ['view', 'edit_content']), ['view', 'edit_content'], '표의 주인은 그대로 — 상속은 이어진다')
  })

  test('편집이면 고친다 · 바꿔도 이미 준 것은 그대로 · 없음이면 주지 않는다 · 웹 공개 응답은 받지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { access: 'workspace', respondentAccess: 'edit' }))
    const mate = await joinAs(fx.ws, await createUser('고치는 멤버'), 'member')
    const first = await submit(fx, { sessionToken: mate.token })
    assert.ok(first.ok)
    assert.deepEqual(await capsOf(mate, first.value.pageId!, ['view', 'edit_content']), ['view', 'edit_content'])

    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { respondentAccess: null }))
    assert.deepEqual(await capsOf(mate, first.value.pageId!, ['edit_content']), ['edit_content'], '바꿔도 이미 준 것은 그대로')
    const second = await submit(fx, { sessionToken: mate.token })
    assert.ok(second.ok)
    assert.deepEqual([second.value.responsePath, await grantsOn(second.value.pageId!)], [null, []], '없음이면 주지 않는다')

    unwrap(await updateFormSettings(fx.boss.ctx, fx.form.viewId, { access: 'public', respondentAccess: 'view' }))
    const anonymous = await submit(fx, { sessionToken: mate.token })
    assert.ok(anonymous.ok)
    assert.deepEqual([anonymous.value.responsePath, await grantsOn(anonymous.value.pageId!)], [null, []], '웹 공개 응답은 익명이라 줄 사람이 없다')
  })
})

// ── ⑨ 조건부 보이기 ────────────────────────────────────────────────

describe('⑨ ★ 조건부 보이기(7b-5a)', () => {
  test('서버가 다시 평가한다 — 숨은 질문은 필수도 묻지 않고 답을 버린다 · 보이면 묻는다 · 옵션을 지우면 끊어진 조건이라 보인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    unwrap(await setWorkspacePlan(fx.ws, 'business'))
    const optionB = unwrap(await addSelectOption(fx.boss.ctx, fx.ds, fx.kind, { name: '단체' })).option.id
    unwrap(
      await setFormQuestions(fx.boss.ctx, fx.form.viewId, [
        { propertyId: fx.title, required: true },
        { propertyId: fx.kind, required: true },
        // 분류가 "개인" 일 때만 · 필수
        { propertyId: fx.memo, required: true, showWhen: { propertyId: fx.kind, operator: 'equals', optionId: fx.optionA } },
        // 메모에 글이 있을 때만 — 메모가 숨으면 이것도 숨는다
        { propertyId: fx.age, showWhen: { propertyId: fx.memo, operator: 'is_not_empty' } },
      ]),
    )
    const read = await readPublicForm(fx.token)
    assert.deepEqual(read?.questions.map((q) => q.showWhen), [
      null,
      null,
      { propertyId: fx.kind, operator: 'equals', optionId: fx.optionA },
      { propertyId: fx.memo, operator: 'is_not_empty', optionId: null },
    ])
    const cellsOf = async (pageId: string) =>
      (await query<{ property_id: string }>(`SELECT property_id FROM page_property_value WHERE page_id = $1`, [pageId])).map((c) => c.property_id)

    // 단체 — 메모 · 나이가 숨는다: 필수도 묻지 않고, 넣어 보낸 답도 버린다
    const hidden = await submit(fx, { answers: { [fx.title]: '단체 응답', [fx.kind]: optionB, [fx.memo]: '몰래 넣은 글', [fx.age]: '99' } })
    assert.ok(hidden.ok, JSON.stringify(hidden))
    const hiddenCells = await cellsOf(hidden.value.pageId!)
    assert.ok(!hiddenCells.includes(fx.memo) && !hiddenCells.includes(fx.age), JSON.stringify(hiddenCells))

    // 개인 — 메모가 보인다: 필수를 묻는다
    const missing = await submit(fx, { answers: { [fx.title]: '개인 응답', [fx.kind]: fx.optionA } })
    assert.ok(!missing.ok && missing.reason === 'invalid_value' && missing.issues?.some((i) => i.path === fx.memo), JSON.stringify(missing))
    const shown = await submit(fx, { answers: { [fx.title]: '개인 응답', [fx.kind]: fx.optionA, [fx.memo]: '안녕하세요', [fx.age]: '7' } })
    assert.ok(shown.ok, JSON.stringify(shown))
    const shownCells = await cellsOf(shown.value.pageId!)
    assert.ok(shownCells.includes(fx.memo) && shownCells.includes(fx.age), JSON.stringify(shownCells))

    // 근거의 옵션이 지워졌다(지우는 명령은 아직 없다 — 속성이 영구 삭제될 때 함께 사라진다) — 끊어진 조건이라 메모가 보인다(필수도 다시)
    await query(`DELETE FROM select_option WHERE id = $1`, [fx.optionA])
    assert.equal((await readPublicForm(fx.token))?.questions[2]?.showWhen, null)
    const broken = await submit(fx, { answers: { [fx.title]: '끊긴 뒤', [fx.kind]: optionB } })
    assert.ok(!broken.ok && broken.reason === 'invalid_value' && broken.issues?.some((i) => i.path === fx.memo), JSON.stringify(broken))

    // 근거의 속성을 휴지통에 — 그 질문이 폼에서 빠지고, 거기에 걸린 조건은 끊어져 지워 싣는다(나이가 조건 없이 보인다)
    unwrap(await deleteProperty(fx.boss.ctx, fx.ds, fx.memo))
    const afterTrash = await readPublicForm(fx.token)
    assert.deepEqual(
      afterTrash?.questions.map((q) => [q.propertyId, q.showWhen]),
      [[fx.title, null], [fx.kind, null], [fx.age, null]],
    )
  })
})

describe('⑩ 조건부 보이기 — 근거의 타입이 바뀌면(7b-5b)', () => {
  test('선택 → 체크박스로 바꾸면 "같다" · "비었다" 조건이 끊어진다 — 공개 읽기가 지워 싣고 질문이 보인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await publicForm()
    unwrap(await setWorkspacePlan(fx.ws, 'business'))
    unwrap(
      await setFormQuestions(fx.boss.ctx, fx.form.viewId, [
        { propertyId: fx.title, required: true },
        { propertyId: fx.kind },
        { propertyId: fx.memo, showWhen: { propertyId: fx.kind, operator: 'equals', optionId: fx.optionA } },
        // 옵션이 없는 조건 — 옵션만 보면 살아남는다(연산자가 근거의 타입의 것인지 봐야 끊어진다)
        { propertyId: fx.age, showWhen: { propertyId: fx.kind, operator: 'is_empty' } },
      ]),
    )
    assert.deepEqual(
      (await readPublicForm(fx.token))?.questions.map((q) => q.showWhen?.operator ?? null),
      [null, null, 'equals', 'is_empty'],
      '전제 — 조건이 섰다',
    )
    const converted = await convertProperty(fx.boss.ctx, fx.ds, fx.kind, { type: 'checkbox', confirmLoss: true })
    assert.ok(converted.ok, JSON.stringify(converted))
    assert.deepEqual((await readPublicForm(fx.token))?.questions.map((q) => q.showWhen), [null, null, null, null], '맞지 않는 조건은 지워 싣는다')
  })
})
