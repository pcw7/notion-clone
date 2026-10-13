/**
 * 폼 — 데이터베이스의 뷰 · 질문은 속성 — 인접 제품 7a-1조각 (F-13-01 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.6 끝 [보강] 폼).
 *
 *   ① ★ 만들기 — 구조를 고치는 사람만(내용 편집 · 보기는 forbidden · 잠기면 locked) · 뷰 탭 끝의 `form` 뷰 · 첫 질문은 제목 · 닫힌 채로
 *      시작(토큰 없음) · 더할 수 있는 속성은 받는 타입만(상태 · 사람은 없다) · 붙인 소스가 아니라 소유한 소스
 *   ② ★ 질문 — 목록을 통째로 · 순서 · 필수 · 제목 · 설명 · 같은 속성 두 번은 invalid_input · 받지 않는 타입 · 다른 표 · 지운 속성은
 *      unsupported_type(아무것도 바꾸지 않는다) · 속성을 휴지통에 넣으면 빠지고 되살리면 돌아온다(질문을 다시 정한 뒤에도)
 *   ③ ★ 설정 · 공개 — 글 칸(앞뒤 공백 · 비면 기본 · 길이) · 공개는 manage_perm(구조를 고쳐도 forbidden) · 정책이 막으면 policy_disabled ·
 *      워크스페이스 멤버만(7b-1)은 같은 문이되 정책을 묻지 않는다 ·
 *      처음 열 때 토큰 · 닫아도 토큰은 남고 다시 열면 같은 주소 · 토큰은 공개를 바꿀 수 있는 사람에게만 · 감사 로그
 *   ④ 다른 길 — 폼은 다른 종류로 바꾸지 않는다 · 폼이 아닌 뷰는 폼으로 읽지 않는다 · 뷰를 지우면 설정 · 질문도 지워진다 · 볼 수 없으면
 *      not_found
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setDatabaseLock } from '../permissions/lock.ts'
import { updateSetting } from '../settings/settings.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { createFormView, readForm, setFormQuestions, updateFormSettings } from './form.ts'
import { addProperty, deleteProperty, getSchema, restoreProperty } from './property.ts'
import { deleteView, listViews, updateView } from './view.ts'

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

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

/** 대표의 개인 표(이름 · 메모 · 점수 · 분류 · 상태 · 담당) · 구조를 고치는 편집자 · 내용만 고치는 동료 · 보는 사람. */
async function workspace() {
  const ws = await createBareWorkspace('폼')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const editor = await joinAs(ws, await createUser('편집자'), 'member')
  const writer = await joinAs(ws, await createUser('작성자'), 'member')
  const viewer = await joinAs(ws, await createUser('보는 사람'), 'member')
  const db = unwrap(await createDatabase(boss.ctx, { name: '신청', privateTop: true }))
  for (const [name, type] of [['메모', 'rich_text'], ['점수', 'number'], ['분류', 'select'], ['상태', 'status'], ['담당', 'people']] as const) {
    unwrap(await addProperty(boss.ctx, db.dataSourceId, { name, type }))
  }
  assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: editor.userId }, 'edit')).ok)
  assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: writer.userId }, 'edit_content')).ok)
  assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: viewer.userId }, 'view')).ok)
  const schema = unwrap(await getSchema(boss.ctx, db.dataSourceId))
  const id = (name: string) => schema.properties.find((p) => p.name === name)!.id
  const title = schema.properties.find((p) => p.type === 'title')!.id
  return { ws, boss, editor, writer, viewer, db, title, memo: id('메모'), score: id('점수'), kind: id('분류'), status: id('상태'), owner: id('담당') }
}

// ── ① 만들기 ──────────────────────────────────────────────────────────

describe('① ★ 만들기', () => {
  test('구조를 고치는 사람만 · form 뷰 · 첫 질문은 제목 · 닫힌 채로 · 더할 수 있는 속성은 받는 타입만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, editor, writer, viewer, db, title, memo, score, kind } = await workspace()
    assert.deepEqual(await createFormView(writer.ctx, db.id), { ok: false, reason: 'forbidden' }, '내용 편집은 구조가 아니다')
    assert.deepEqual(await createFormView(viewer.ctx, db.id), { ok: false, reason: 'forbidden' })
    const stranger = await joinAs(await createBareWorkspace('남의 곳'), await createUser('남'), 'owner')
    assert.deepEqual(await createFormView(stranger.ctx, db.id), { ok: false, reason: 'not_found' })
    assert.deepEqual(await createFormView(boss.ctx, db.id, { name: '  ' }), { ok: false, reason: 'invalid_input' })

    const form = unwrap(await createFormView(editor.ctx, db.id, { name: '  참가 신청  ' }))
    assert.equal(form.name, '참가 신청')
    assert.equal(form.dataSourceId, db.dataSourceId)
    assert.deepEqual(form.questions.map((q) => [q.propertyId, q.label, q.required]), [[title, null, false]], '첫 질문은 제목')
    assert.deepEqual(form.settings, {
      title: null, description: null, submitLabel: null, confirmationTitle: null, confirmationBody: null, access: 'closed', token: null,
      maxResponses: null, closesAt: null,
    })
    assert.deepEqual(form.candidates.map((c) => c.propertyId), [memo, score, kind], '상태 · 사람은 질문이 아니다')
    assert.deepEqual([form.canEdit, form.canPublish, form.policyAllows], [true, false, true], '편집(edit)은 구조를 고치지만 공유는 아니다(공개는 전체 권한)')

    const views = unwrap(await listViews(boss.ctx, db.id))
    assert.deepEqual(views.at(-1), { ...views.at(-1)!, id: form.viewId, type: 'form' }, '뷰 탭의 끝')
    const read = unwrap(await readForm(viewer.ctx, form.viewId))
    assert.deepEqual([read.canEdit, read.canPublish], [false, false], '보는 사람은 읽기만')

    unwrap(await setDatabaseLock(boss.ctx, db.id, true))
    assert.deepEqual(await createFormView(boss.ctx, db.id), { ok: false, reason: 'locked' })
    assert.equal(unwrap(await readForm(boss.ctx, form.viewId)).canEdit, false, '잠기면 고칠 수 없다')
  })
})

// ── ② 질문 ────────────────────────────────────────────────────────────

describe('② ★ 질문', () => {
  test('통째로 · 순서 · 필수 · 제목 · 설명 · 거부 · 휴지통의 속성은 빠지고 되살리면 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, writer, db, title, memo, score, kind, status, owner } = await workspace()
    const form = unwrap(await createFormView(boss.ctx, db.id))
    const set = unwrap(
      await setFormQuestions(boss.ctx, form.viewId, [
        { propertyId: score, required: true, label: '  나이  ', helpText: '숫자로' },
        { propertyId: title, label: '' },
        { propertyId: memo },
      ]),
    )
    assert.deepEqual(
      set.questions.map((q) => [q.propertyId, q.label, q.helpText, q.required]),
      [[score, '나이', '숫자로', true], [title, null, null, false], [memo, null, null, false]],
      '순서 · 앞뒤 공백 · 빈 제목은 속성 이름을 따른다',
    )
    assert.deepEqual(set.candidates.map((c) => c.propertyId), [kind])

    const before = JSON.stringify(set.questions)
    assert.deepEqual(await setFormQuestions(boss.ctx, form.viewId, [{ propertyId: memo }, { propertyId: memo }]), { ok: false, reason: 'invalid_input' })
    assert.deepEqual(await setFormQuestions(boss.ctx, form.viewId, [{ propertyId: status }]), { ok: false, reason: 'unsupported_type' }, '상태')
    assert.deepEqual(await setFormQuestions(boss.ctx, form.viewId, [{ propertyId: owner }]), { ok: false, reason: 'unsupported_type' }, '사람')
    const other = unwrap(await createDatabase(boss.ctx, { name: '다른 표', privateTop: true }))
    const otherTitle = unwrap(await getSchema(boss.ctx, other.dataSourceId)).properties[0]!.id
    assert.deepEqual(await setFormQuestions(boss.ctx, form.viewId, [{ propertyId: otherTitle }]), { ok: false, reason: 'unsupported_type' }, '다른 표')
    assert.deepEqual(await setFormQuestions(boss.ctx, form.viewId, [{ propertyId: memo, required: 'yes' }]), { ok: false, reason: 'invalid_input' })
    assert.deepEqual(await setFormQuestions(writer.ctx, form.viewId, [{ propertyId: memo }]), { ok: false, reason: 'forbidden' })
    assert.equal(JSON.stringify(unwrap(await readForm(boss.ctx, form.viewId)).questions), before, '거부는 아무것도 바꾸지 않는다')

    unwrap(await deleteProperty(boss.ctx, db.dataSourceId, score))
    const trashed = unwrap(await readForm(boss.ctx, form.viewId))
    assert.deepEqual(trashed.questions.map((q) => q.propertyId), [title, memo], '휴지통의 속성은 빠진다')
    assert.deepEqual(await setFormQuestions(boss.ctx, form.viewId, [{ propertyId: score }]), { ok: false, reason: 'unsupported_type' }, '지운 속성')
    unwrap(await setFormQuestions(boss.ctx, form.viewId, [{ propertyId: memo }, { propertyId: kind }]))
    unwrap(await restoreProperty(boss.ctx, db.dataSourceId, score))
    const restored = unwrap(await readForm(boss.ctx, form.viewId))
    assert.deepEqual(
      restored.questions.map((q) => [q.propertyId, q.required]),
      [[score, true], [memo, false], [kind, false]],
      '되살리면 돌아온다 — 질문을 다시 정한 뒤에도(제자리 · 설정 그대로)',
    )
  })
})

// ── ③ 설정 · 공개 ──────────────────────────────────────────────────────

describe('③ ★ 설정 · 공개', () => {
  test('글 칸 · 공개는 manage_perm · 정책 · 토큰 · 닫아도 남는 주소 · 감사 로그', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, editor, writer, viewer, db } = await workspace()
    const form = unwrap(await createFormView(boss.ctx, db.id))

    const texts = unwrap(
      await updateFormSettings(boss.ctx, form.viewId, { title: '  참가 신청서 ', description: '', submitLabel: '보내기', confirmationTitle: '고맙습니다' }),
    )
    assert.deepEqual(
      [texts.settings.title, texts.settings.description, texts.settings.submitLabel, texts.settings.confirmationTitle],
      ['참가 신청서', null, '보내기', '고맙습니다'],
    )
    for (const bad of [{}, { nope: 1 }, { submitLabel: 'x'.repeat(41) }, { title: 7 }, { access: 'everyone' }]) {
      assert.deepEqual(await updateFormSettings(boss.ctx, form.viewId, bad), { ok: false, reason: 'invalid_input' }, JSON.stringify(bad))
    }
    assert.deepEqual(await updateFormSettings(writer.ctx, form.viewId, { title: '바꿈' }), { ok: false, reason: 'forbidden' })

    // 공개 — manage_perm 이 없으면 구조를 고칠 수 있어도 forbidden(내용 편집 · 보기는 물론)
    assert.deepEqual(await updateFormSettings(editor.ctx, form.viewId, { access: 'public' }), { ok: false, reason: 'forbidden' }, '구조를 고쳐도')
    assert.deepEqual(await updateFormSettings(viewer.ctx, form.viewId, { access: 'public' }), { ok: false, reason: 'forbidden' })
    unwrap(await updateSetting(boss.ctx, 'workspace.allow_publish_sites_and_forms', false))
    assert.deepEqual(await updateFormSettings(boss.ctx, form.viewId, { access: 'public' }), { ok: false, reason: 'policy_disabled' })
    unwrap(await updateSetting(boss.ctx, 'workspace.allow_publish_sites_and_forms', true))

    const opened = unwrap(await updateFormSettings(boss.ctx, form.viewId, { access: 'public' }))
    const token = opened.settings.token
    assert.match(token ?? '', /^[A-Za-z0-9_-]{22}$/, '처음 열 때 토큰')
    assert.equal(unwrap(await readForm(viewer.ctx, form.viewId)).settings.token, null, '토큰은 공개를 바꿀 수 있는 사람에게만')
    const closed = unwrap(await updateFormSettings(boss.ctx, form.viewId, { access: 'closed' }))
    assert.deepEqual([closed.settings.access, closed.settings.token], ['closed', token], '닫아도 토큰은 남는다')
    assert.equal(unwrap(await updateFormSettings(boss.ctx, form.viewId, { access: 'public' })).settings.token, token, '다시 열면 같은 주소')
    unwrap(await updateFormSettings(boss.ctx, form.viewId, { access: 'public' }))

    const audits = await query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_event WHERE workspace_id = $1 AND event_type = 'page.publish_changed' ORDER BY occurred_at, id`,
      [ws],
    )
    assert.deepEqual(audits.map((a) => a.metadata.change), ['form_open', 'form_close', 'form_open'], '바뀌었을 때만')
  })

  test('★ 워크스페이스 멤버만(7b-1) — manage_perm · 정책은 묻지 않는다 · 처음 열 때 토큰 · 감사는 form_open_workspace', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, editor, db } = await workspace()
    const form = unwrap(await createFormView(boss.ctx, db.id))
    assert.deepEqual(await updateFormSettings(editor.ctx, form.viewId, { access: 'workspace' }), { ok: false, reason: 'forbidden' }, '구조를 고쳐도')
    unwrap(await updateSetting(boss.ctx, 'workspace.allow_publish_sites_and_forms', false))
    const opened = unwrap(await updateFormSettings(boss.ctx, form.viewId, { access: 'workspace' }))
    assert.equal(opened.settings.access, 'workspace', '정책이 웹 공개를 막아도 연다 — 밖으로 내보내는 것이 아니다')
    assert.match(opened.settings.token ?? '', /^[A-Za-z0-9_-]{22}$/, '처음 열 때 토큰')
    assert.deepEqual(await updateFormSettings(boss.ctx, form.viewId, { access: 'public' }), { ok: false, reason: 'policy_disabled' }, '웹 공개는 여전히 막힌다')
    const closed = unwrap(await updateFormSettings(boss.ctx, form.viewId, { access: 'closed' }))
    assert.equal(closed.settings.token, opened.settings.token, '닫아도 토큰은 남는다')
    const audits = await query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_event WHERE workspace_id = $1 AND event_type = 'page.publish_changed' ORDER BY occurred_at, id`,
      [ws],
    )
    assert.deepEqual(audits.map((a) => a.metadata.change), ['form_open_workspace', 'form_close'])
  })

  test('★ 응답 상한 · 마감 시각(7b-2) — 구조를 고치는 사람 · 값의 모양 · 읽기가 받은 수 · 닫힌 까닭을 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, editor, writer, db } = await workspace()
    const form = unwrap(await createFormView(boss.ctx, db.id))
    const fresh = unwrap(await readForm(boss.ctx, form.viewId))
    assert.deepEqual([fresh.settings.maxResponses, fresh.settings.closesAt, fresh.responseCount, fresh.closedBecause], [null, null, 0, null])

    assert.deepEqual(await updateFormSettings(writer.ctx, form.viewId, { maxResponses: 5 }), { ok: false, reason: 'forbidden' }, '내용 편집은 아니다')
    const set = unwrap(await updateFormSettings(editor.ctx, form.viewId, { maxResponses: 5, closesAt: '2030-01-01T09:00+09:00' }))
    assert.deepEqual([set.settings.maxResponses, set.settings.closesAt], [5, '2030-01-01T00:00:00.000Z'], '구조를 고치는 사람 · 시각은 ISO Z 로')
    for (const bad of [{ maxResponses: 0 }, { maxResponses: 1.5 }, { maxResponses: '5' }, { closesAt: '2030-01-01T09:00' }, { closesAt: 'soon' }]) {
      assert.deepEqual(await updateFormSettings(editor.ctx, form.viewId, bad), { ok: false, reason: 'invalid_input' }, JSON.stringify(bad))
    }
    const cleared = unwrap(await updateFormSettings(editor.ctx, form.viewId, { maxResponses: null, closesAt: '2020-01-01T00:00:00Z' }))
    assert.deepEqual([cleared.settings.maxResponses, cleared.closedBecause], [null, 'time'], '지난 시각이면 닫혔다고 싣는다')
  })
})

// ── ④ 다른 길 ─────────────────────────────────────────────────────────

describe('④ 다른 길', () => {
  test('종류를 바꾸지 않는다 · 폼이 아닌 뷰 · 뷰를 지우면 함께 · 볼 수 없으면 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, db } = await workspace()
    const form = unwrap(await createFormView(boss.ctx, db.id))
    assert.deepEqual(await updateView(boss.ctx, form.viewId, { type: 'table' }), { ok: false, reason: 'unsupported_type' })
    assert.deepEqual(await readForm(boss.ctx, db.defaultViewId), { ok: false, reason: 'not_found' }, '표는 폼이 아니다')
    const stranger = await joinAs(await createBareWorkspace('남의 곳'), await createUser('남'), 'owner')
    assert.deepEqual(await readForm(stranger.ctx, form.viewId), { ok: false, reason: 'not_found' })

    unwrap(await deleteView(boss.ctx, form.viewId))
    const left = await query<{ n: number }>(
      `SELECT (SELECT count(*) FROM form_view WHERE view_id = $1)::int + (SELECT count(*) FROM form_question WHERE view_id = $1)::int AS n`,
      [form.viewId],
    )
    assert.equal(left[0]!.n, 0, '뷰를 지우면 설정 · 질문도')
  })
})
