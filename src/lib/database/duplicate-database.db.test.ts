/**
 * 데이터베이스 복제 — 내용 없이 (29번 트랙 D-1 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 D-1]
 *
 *   ① ★ 모양을 새 id 로 — 같은 이름 · 타입 · 순서의 속성 · 옵션 · 상태의 기본값 · 수식의 토큰 · 같은 표의 relation 짝 · 그 relation 의 rollup ·
 *      뷰의 필터 · 정렬 · 열이 사본의 것을 가리킨다 · 행은 없다 · 원본은 그대로 · 이름은 "… (1)" · 같은 자리
 *   ② ★ 바깥 표를 가리키는 양방향 relation 은 한쪽으로 — 대상은 그대로 · 바깥 표에 짝을 만들지 않는다 · 그것을 거치는 rollup 의 대상도 그대로
 *   ③ 인라인 — 원본 참조 바로 뒤 · 같은 페이지 밑 · 인라인
 *   ④ ★ 볼 수 없으면 없는 것과 같다 — 아무것도 쓰지 않는다
 *   ⑤ 폼은 닫힌 채 — 공개 주소는 사본의 것이 아니다 · 질문은 사본의 속성
 *   ⑥ 붙인 소스 — 부착과 그 뷰가 함께 · 원본의 소스는 그대로(새 소스를 만들지 않는다)
 *   ⑦ 개인 최상위의 사본은 복제한 사람의 개인 최상위
 *   ⑧ ★ 내용과 함께(D-2) — 살아 있는 행만(템플릿 · 휴지통은 빼고) · 칸은 사본의 속성 · 옵션 · 같은 표의 relation 은 사본 행끼리 두 방향 ·
 *      바깥 relation 은 한쪽으로 원본의 바깥 행을 · 바깥 표에 거울상을 만들지 않는다 · 수동 순서 · 고유 ID 번호 · 이름 색인 · 원본은 그대로
 *   ⑨ ★ 본문(D-3) — 행의 본문 · 하위 페이지(그 본문까지) · 템플릿과 그 본문 · 뷰의 기본 템플릿은 사본의 템플릿 · 내용 없이도 템플릿은 함께(행은 없다)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { textRun } from '../contracts/rich-text.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { createDatabase, createInlineDatabase, getDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import { addFormulaProperty } from './formula-property.ts'
import { addRelationProperty } from './relation.ts'
import { addRollupProperty } from './rollup.ts'
import { createRow, trashRow } from './row.ts'
import { linkRows } from './relation.ts'
import { createTemplate } from './template.ts'
import { moveViewRow } from './row-order.ts'
import { queryRows } from './query.ts'
import { getView, listViews, updateView } from './view.ts'
import { createFormView } from './form.ts'
import { attachLinkedDataSource } from './data-source.ts'
import { duplicateDatabase } from './duplicate-database.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let other: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  other = await joinAs(fx.workspaceId, await createUser('다른 멤버'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)}`

const copy = async (actor: Actor, id: string) => unwrap(await duplicateDatabase(actor.ctx, id, { content: false }))
const sourceOf = async (databaseId: string) =>
  (await query<{ id: string }>(`SELECT id FROM data_source WHERE owner_database_id = $1`, [databaseId]))[0]!.id
const propsOf = async (dataSourceId: string) =>
  (await query<{ id: string; name: string; type: string; config: Record<string, unknown> }>(
    `SELECT id, name, type::text AS type, config FROM property WHERE data_source_id = $1 AND deleted_at IS NULL ORDER BY order_idx, id`, [dataSourceId]))

describe('① 모양을 새 id 로', () => {
  test('★ 속성 · 옵션 · 상태 · 수식 · 같은 표의 relation · rollup · 뷰가 사본을 가리킨다 · 행은 없다 · 원본은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const made = unwrap(await createDatabase(fx.owner.ctx, { name: unique('원본 업무') }))
    const ds = made.dataSourceId
    unwrap(await addProperty(fx.owner.ctx, ds, { name: '숫자', type: 'number' }))
    unwrap(await addProperty(fx.owner.ctx, ds, { name: '단계', type: 'select' }))
    unwrap(await addProperty(fx.owner.ctx, ds, { name: '상태', type: 'status' }))
    const schema = unwrap(await getSchema(fx.owner.ctx, ds))
    const numberId = schema.properties.find((p) => p.name === '숫자')!.id
    const stageId = schema.properties.find((p) => p.name === '단계')!.id
    const doing = unwrap(await addSelectOption(fx.owner.ctx, ds, stageId, { name: '진행 중' })).option.id
    unwrap(await addFormulaProperty(fx.owner.ctx, ds, { name: '두 배', expression: 'prop("숫자") * 2' }))
    const relation = unwrap(await addRelationProperty(fx.owner.ctx, ds, { name: '관련', targetDataSourceId: ds, twoWay: { name: '역관련' } }))
    unwrap(await addRollupProperty(fx.owner.ctx, ds, { name: '합', relationPropertyId: relation.propertyId, targetPropertyId: numberId, function: 'sum' }))
    unwrap(await updateView(fx.owner.ctx, made.defaultViewId, {
      filter: { property_id: stageId, operator: 'equals', value: doing },
      sorts: [{ property_id: numberId, direction: 'desc' }],
    }))
    unwrap(await createRow(fx.owner.ctx, ds))
    const before = await propsOf(ds)

    const copied = await copy(fx.owner, made.id)
    const copyDs = await sourceOf(copied.id)
    const after = await propsOf(copyDs)
    assert.deepEqual(after.map((p) => [p.name, p.type]), before.map((p) => [p.name, p.type]), '같은 이름 · 타입 · 순서')
    const originalIds = new Set(before.map((p) => p.id))
    assert.ok(after.every((p) => !originalIds.has(p.id)), '새 id')
    const byName = new Map(after.map((p) => [p.name, p]))

    const copyStage = byName.get('단계')!.id
    const copyOptions = await query<{ id: string; name: string }>(`SELECT id, name FROM select_option WHERE property_id = $1`, [copyStage])
    assert.deepEqual(copyOptions.map((o) => o.name), ['진행 중'])
    assert.notEqual(copyOptions[0]!.id, doing, '옵션도 새 id')
    const status = byName.get('상태')!
    const statusOptions = await query<{ id: string; group_id: string }>(`SELECT id, group_id FROM select_option WHERE property_id = $1`, [status.id])
    assert.ok(statusOptions.some((o) => o.id === status.config.default_option_id), '상태의 기본값은 사본의 옵션')
    const groups = await query<{ id: string }>(`SELECT id FROM status_group WHERE property_id = $1`, [status.id])
    assert.ok(statusOptions.every((o) => groups.some((g) => g.id === o.group_id)), '상태 옵션의 그룹은 사본의 그룹')
    assert.equal(byName.get('두 배')!.config.expression, `⟦${byName.get('숫자')!.id}⟧ * 2`, '수식의 토큰은 사본의 속성')
    const copyRelation = byName.get('관련')!
    assert.equal(copyRelation.config.target_data_source_id, copyDs, '같은 표의 relation 은 사본을 가리킨다')
    assert.equal(copyRelation.config.synced_property_id, byName.get('역관련')!.id, '짝도 사본의 것')
    assert.deepEqual(
      [byName.get('합')!.config.relation_property_id, byName.get('합')!.config.target_property_id],
      [copyRelation.id, byName.get('숫자')!.id], 'rollup 도 사본을 모은다')
    const deps = await query<{ n: string }>(`SELECT count(*) AS n FROM property_dependency WHERE dependent_property_id = $1`, [byName.get('두 배')!.id])
    assert.equal(Number(deps[0]!.n) > 0, true, '수식의 의존 간선도')

    const views = unwrap(await listViews(fx.owner.ctx, copied.id))
    assert.equal(views.length, 1)
    const view = unwrap(await getView(fx.owner.ctx, views[0]!.id))
    assert.equal(view.dataSourceId, copyDs)
    assert.deepEqual(view.filter, { property_id: copyStage, operator: 'equals', value: copyOptions[0]!.id }, '필터는 사본의 속성 · 옵션')
    assert.deepEqual(view.sorts, [{ property_id: byName.get('숫자')!.id, direction: 'desc' }])
    assert.ok(view.columns.every((c) => !originalIds.has(c.propertyId)), '열도 사본의 속성')
    assert.equal(copied.defaultViewId, view.id)

    assert.deepEqual(unwrap(await queryRows(fx.owner.ctx, copyDs)).rows, [], '행은 없다(내용 없이)')
    assert.deepEqual((await propsOf(ds)).map((p) => p.id), before.map((p) => p.id), '원본은 그대로')
    assert.equal(unwrap(await queryRows(fx.owner.ctx, ds)).rows.length, 1)

    const detail = unwrap(await getDatabase(fx.owner.ctx, copied.id))
    assert.equal(detail.name, `${unwrap(await getDatabase(fx.owner.ctx, made.id)).name} (1)`)
    const place = await query<{ parent_type: string; parent_id: string }>(`SELECT parent_type, parent_id FROM block WHERE id = ANY($1::uuid[]) ORDER BY id = $2`, [[made.id, copied.id], copied.id])
    assert.deepEqual(place[0], place[1], '같은 자리')
  })
})

describe('② 바깥 relation', () => {
  test('★ 한쪽으로 — 대상 그대로 · 바깥에 짝을 만들지 않는다 · rollup 의 대상도 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const outside = unwrap(await createDatabase(fx.owner.ctx, { name: unique('바깥') }))
    unwrap(await addProperty(fx.owner.ctx, outside.dataSourceId, { name: '점수', type: 'number' }))
    const score = unwrap(await getSchema(fx.owner.ctx, outside.dataSourceId)).properties.find((p) => p.name === '점수')!.id
    const made = unwrap(await createDatabase(fx.owner.ctx, { name: unique('안') }))
    const relation = unwrap(await addRelationProperty(fx.owner.ctx, made.dataSourceId, { name: '바깥으로', targetDataSourceId: outside.dataSourceId, twoWay: { name: '안에서' } }))
    unwrap(await addRollupProperty(fx.owner.ctx, made.dataSourceId, { name: '점수 합', relationPropertyId: relation.propertyId, targetPropertyId: score, function: 'sum' }))
    const outsideBefore = (await propsOf(outside.dataSourceId)).map((p) => p.id)

    const copied = await copy(fx.owner, made.id)
    assert.equal(copied.oneWayRelations, 1)
    const byName = new Map((await propsOf(await sourceOf(copied.id))).map((p) => [p.name, p]))
    assert.deepEqual(byName.get('바깥으로')!.config, { target_data_source_id: outside.dataSourceId }, '한쪽 relation · 대상은 그대로')
    assert.deepEqual(
      [byName.get('점수 합')!.config.relation_property_id, byName.get('점수 합')!.config.target_property_id],
      [byName.get('바깥으로')!.id, score])
    assert.deepEqual((await propsOf(outside.dataSourceId)).map((p) => p.id), outsideBefore, '바깥 표에 짝을 만들지 않았다')
    assert.equal(byName.has('안에서'), false, '바깥의 짝은 바깥 표의 것이다')
  })
})

describe('③ 인라인', () => {
  test('원본 참조 바로 뒤 · 같은 페이지 밑 · 인라인', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const host = (await createPage(fx.owner.ctx, { title: titleFromPlainText(unique('호스트')) })).id as string
    const made = unwrap(await createInlineDatabase(fx.owner.ctx, { parentPageId: host, name: '본문의 표' }))
    unwrap(await createInlineDatabase(fx.owner.ctx, { parentPageId: host, name: '뒤의 표' }))
    const copied = await copy(fx.owner, made.id)
    const body = await loadPageBody(fx.owner.ctx, host as never)
    const order = body!.doc.blocks.filter((b) => b.type === 'database').map((b) => b.id)
    assert.deepEqual(order.slice(0, 2), [made.id, copied.id], '원본 바로 뒤')
    const row = (await query<{ parent_id: string; is_inline: boolean }>(
      `SELECT b.parent_id, d.is_inline FROM block b JOIN database d ON d.id = b.id WHERE b.id = $1`, [copied.id]))[0]
    assert.deepEqual(row, { parent_id: host, is_inline: true })
  })
})

describe('④ 권한', () => {
  test('★ 볼 수 없으면 없는 것과 같다 — 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const made = unwrap(await createDatabase(fx.owner.ctx, { name: unique('비밀') }))
    assert.equal((await stopInheriting(fx.owner.ctx, made.id)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, made.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, made.id, { type: 'workspace_everyone', id: null })).ok, true)
    const count = async () => Number((await query<{ n: string }>(`SELECT count(*) AS n FROM block WHERE workspace_id = $1 AND type = 'database'`, [fx.workspaceId]))[0]!.n)
    const beforeCount = await count()
    assert.deepEqual(await duplicateDatabase(other.ctx, made.id, { content: false }), { ok: false, reason: 'not_found' })
    assert.deepEqual(await duplicateDatabase(other.ctx, 'nope', { content: false }), { ok: false, reason: 'not_found' })
    assert.equal(await count(), beforeCount)
  })
})

describe('⑤ 폼', () => {
  test('닫힌 채 · 질문은 사본의 속성', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const made = unwrap(await createDatabase(fx.owner.ctx, { name: unique('설문 표') }))
    const form = unwrap(await createFormView(fx.owner.ctx, made.id, { name: '설문' }))
    await query(`UPDATE form_view SET access = 'public', token = $2 WHERE view_id = $1`, [form.viewId, randomBytes(16).toString('base64url').slice(0, 22)])
    const originalQuestions = await query<{ property_id: string }>(`SELECT property_id FROM form_question WHERE view_id = $1`, [form.viewId])

    const copied = await copy(fx.owner, made.id)
    const copyForm = (await query<{ view_id: string; access: string; token: string | null }>(
      `SELECT f.view_id, f.access, f.token FROM form_view f JOIN view v ON v.id = f.view_id WHERE v.database_id = $1`, [copied.id]))[0]
    assert.deepEqual(copyForm && { access: copyForm.access, token: copyForm.token }, { access: 'closed', token: null })
    const copyProps = new Set((await propsOf(await sourceOf(copied.id))).map((p) => p.id))
    const questions = await query<{ property_id: string }>(`SELECT property_id FROM form_question WHERE view_id = $1`, [copyForm!.view_id])
    assert.equal(questions.length, originalQuestions.length)
    assert.ok(questions.every((q) => copyProps.has(q.property_id)), '질문은 사본의 속성')
  })
})

describe('⑥ 붙인 소스', () => {
  test('부착과 그 뷰가 함께 · 원본의 소스는 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const linkedFrom = unwrap(await createDatabase(fx.owner.ctx, { name: unique('붙일 원본') }))
    const made = unwrap(await createDatabase(fx.owner.ctx, { name: unique('그릇') }))
    unwrap(await attachLinkedDataSource(fx.owner.ctx, made.id, { dataSourceId: linkedFrom.dataSourceId }))
    const copied = await copy(fx.owner, made.id)
    const attached = await query<{ data_source_id: string; owned: boolean }>(
      `SELECT dds.data_source_id, ds.owner_database_id = dds.database_id AS owned FROM database_data_source dds
         JOIN data_source ds ON ds.id = dds.data_source_id WHERE dds.database_id = $1 ORDER BY dds.order_idx`, [copied.id])
    assert.equal(attached.length, 2)
    assert.deepEqual(attached.map((a) => a.owned), [true, false])
    assert.equal(attached[1]!.data_source_id, linkedFrom.dataSourceId, '붙인 소스는 원본의 것 그대로')
    const views = unwrap(await listViews(fx.owner.ctx, copied.id))
    assert.ok(views.some((v) => v.dataSourceId === linkedFrom.dataSourceId), '그 소스를 보는 뷰도')
  })
})

describe('⑦ 개인 최상위', () => {
  test('사본은 복제한 사람의 개인 최상위', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const made = unwrap(await createDatabase(other.ctx, { name: unique('남의 개인 표'), privateTop: true }))
    assert.equal((await grantAccess(other.ctx, made.id, { type: 'user', id: fx.owner.userId }, 'view')).ok, true)
    const copied = await copy(fx.owner, made.id)
    const row = (await query<{ parent_type: string; owner_user_id: string | null }>(`SELECT parent_type, owner_user_id FROM block WHERE id = $1`, [copied.id]))[0]
    assert.deepEqual(row, { parent_type: 'workspace', owner_user_id: fx.owner.userId })
  })
})

describe('⑧ 내용과 함께(D-2)', () => {
  test('★ 행 · 칸 · 같은 표 relation(두 방향) · 바깥 relation(한쪽) · 순서 · 고유 ID · 색인', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const outside = unwrap(await createDatabase(fx.owner.ctx, { name: unique('바깥 표') }))
    const outsideTitle = unwrap(await getSchema(fx.owner.ctx, outside.dataSourceId)).properties.find((p) => p.type === 'title')!.id
    const far = unwrap(await createRow(fx.owner.ctx, outside.dataSourceId, { cells: [{ propertyId: outsideTitle, value: { type: 'title', title: [textRun('바깥 행')] } }] })).id

    const made = unwrap(await createDatabase(fx.owner.ctx, { name: unique('내용 표') }))
    const ds = made.dataSourceId
    unwrap(await addProperty(fx.owner.ctx, ds, { name: '숫자', type: 'number' }))
    unwrap(await addProperty(fx.owner.ctx, ds, { name: '단계', type: 'select' }))
    unwrap(await addProperty(fx.owner.ctx, ds, { name: '번호', type: 'unique_id' }))
    const schema = unwrap(await getSchema(fx.owner.ctx, ds))
    const titleId = schema.properties.find((p) => p.type === 'title')!.id
    const numberId = schema.properties.find((p) => p.name === '숫자')!.id
    const stageId = schema.properties.find((p) => p.name === '단계')!.id
    const doing = unwrap(await addSelectOption(fx.owner.ctx, ds, stageId, { name: '진행 중' })).option.id
    const inner = unwrap(await addRelationProperty(fx.owner.ctx, ds, { name: '관련', targetDataSourceId: ds, twoWay: { name: '역관련' } }))
    const outer = unwrap(await addRelationProperty(fx.owner.ctx, ds, { name: '바깥', targetDataSourceId: outside.dataSourceId, twoWay: { name: '안쪽' } }))
    const titled = (text: string) => ({ propertyId: titleId, value: { type: 'title', title: [textRun(text)] } })
    const a = unwrap(await createRow(fx.owner.ctx, ds, { cells: [titled('가'), { propertyId: numberId, value: { type: 'number', number: 3 } },
      { propertyId: stageId, value: { type: 'select', select: { id: doing } } }] })).id
    const b = unwrap(await createRow(fx.owner.ctx, ds, { cells: [titled('나')] })).id
    const gone = unwrap(await createRow(fx.owner.ctx, ds, { cells: [titled('버린 행')] })).id
    unwrap(await linkRows(fx.owner.ctx, a, inner.propertyId, { add: [b] }))
    unwrap(await linkRows(fx.owner.ctx, a, outer.propertyId, { add: [far] }))
    unwrap(await linkRows(fx.owner.ctx, a, inner.propertyId, { add: [gone] }))
    unwrap(await trashRow(fx.owner.ctx, gone))
    unwrap(await createTemplate(fx.owner.ctx, ds, { title: '양식' }))
    unwrap(await moveViewRow(fx.owner.ctx, made.defaultViewId, { rowId: b, beforeRowId: a }))
    const originalCounter = (await query<{ n: number }>(`SELECT unique_id_counter AS n FROM data_source WHERE id = $1`, [ds]))[0]!.n

    const copied = unwrap(await duplicateDatabase(fx.owner.ctx, made.id, { content: true }))
    assert.equal(copied.rows, 2, '살아 있는 행 둘 — 템플릿 · 휴지통은 빼고')
    const copyDs = await sourceOf(copied.id)
    const byName = new Map((await propsOf(copyDs)).map((p) => [p.name, p.id]))
    const view = unwrap(await listViews(fx.owner.ctx, copied.id))[0]!
    const rows = unwrap(await queryRows(fx.owner.ctx, copyDs, { manualOrderViewId: view.id })).rows
    assert.deepEqual(rows.map((r) => r.title), ['나', '가'], '수동 순서 그대로')
    assert.ok(rows.every((r) => r.id !== a && r.id !== b), '새 id')
    const copyA = rows.find((r) => r.title === '가')!
    const copyB = rows.find((r) => r.title === '나')!
    assert.deepEqual(copyA.properties[byName.get('숫자')!], { type: 'number', number: 3 })
    const copyOption = (await query<{ id: string }>(`SELECT id FROM select_option WHERE property_id = $1`, [byName.get('단계')!]))[0]!.id
    assert.deepEqual(copyA.properties[byName.get('단계')!], { type: 'select', select: { id: copyOption } }, '선택 칸은 사본의 옵션')

    const edgesOf = async (property: string) =>
      (await query<{ from_page_id: string; to_page_id: string }>(`SELECT from_page_id, to_page_id FROM relation_edge WHERE property_id = $1`, [property]))
    assert.deepEqual(await edgesOf(byName.get('관련')!), [{ from_page_id: copyA.id, to_page_id: copyB.id }], '같은 표 — 사본 행끼리 · 휴지통 행으로의 엣지는 뺀다')
    assert.deepEqual(await edgesOf(byName.get('역관련')!), [{ from_page_id: copyB.id, to_page_id: copyA.id }], '거울상도')
    assert.deepEqual(await edgesOf(byName.get('바깥')!), [{ from_page_id: copyA.id, to_page_id: far }], '바깥 — 한쪽으로 원본의 바깥 행을')
    const farEdges = await query<{ to_page_id: string }>(`SELECT to_page_id FROM relation_edge WHERE property_id = $1`, [outer.syncedPropertyId])
    assert.deepEqual(farEdges.map((e) => e.to_page_id), [a], '바깥 표의 짝은 원본만 — 사본의 거울상을 만들지 않는다')

    const seqs = await query<{ title: string; unique_seq: string }>(
      `SELECT b.properties -> 'title' -> 0 ->> 'plain_text' AS title, p.unique_seq FROM page p JOIN block b ON b.id = p.id WHERE p.data_source_id = $1 AND NOT p.is_template ORDER BY 1`, [copyDs])
    const originalSeqs = await query<{ title: string; unique_seq: string }>(
      `SELECT b.properties -> 'title' -> 0 ->> 'plain_text' AS title, p.unique_seq FROM page p JOIN block b ON b.id = p.id
        WHERE p.data_source_id = $1 AND b.lifecycle = 'live' AND NOT p.is_template ORDER BY 1`, [ds])
    assert.deepEqual(seqs, originalSeqs, '고유 ID 번호 그대로')
    assert.equal((await query<{ n: number }>(`SELECT unique_id_counter AS n FROM data_source WHERE id = $1`, [copyDs]))[0]!.n, originalCounter, '다음 번호도')
    const indexed = await query<{ title_text: string }>(`SELECT title_text FROM search_document WHERE doc_id = $1`, [copyA.id])
    assert.equal(indexed[0]?.title_text, '가', '이름 색인')
    assert.equal(unwrap(await queryRows(fx.owner.ctx, ds)).rows.length, 2, '원본은 그대로')
  })
})

describe('⑨ 본문 · 하위 페이지 · 템플릿(D-3)', () => {
  const para = (text: string) => ({ id: crypto.randomUUID(), type: 'paragraph', title: [textRun(text)] }) as never
  const bodyText = async (pageId: string) => JSON.stringify((await loadPageBody(fx.owner.ctx, pageId as never))?.doc.blocks ?? [])

  test('★ 행의 본문 · 하위 페이지 · 템플릿과 그 본문 · 기본 템플릿 · 내용 없이도 템플릿', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const made = unwrap(await createDatabase(fx.owner.ctx, { name: unique('본문 표') }))
    const ds = made.dataSourceId
    const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
    const row = unwrap(await createRow(fx.owner.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun('본문 있는 행')] } }] })).id
    assert.equal((await savePageBody(fx.owner.ctx, row as never, { blocks: [para('행의 본문 글')] })).ok, true)
    const sub = (await createPage(fx.owner.ctx, { parentPageId: row as never, title: titleFromPlainText('행의 하위') })).id as string
    assert.equal((await savePageBody(fx.owner.ctx, sub as never, { blocks: [para('하위의 본문 글')] })).ok, true)
    const template = unwrap(await createTemplate(fx.owner.ctx, ds, { title: '회의록' })).id
    assert.equal((await savePageBody(fx.owner.ctx, template as never, { blocks: [para('양식의 본문 글')] })).ok, true)
    unwrap(await updateView(fx.owner.ctx, made.defaultViewId, { defaultTemplateId: template }))

    const copied = unwrap(await duplicateDatabase(fx.owner.ctx, made.id, { content: true }))
    const copyDs = await sourceOf(copied.id)
    const copyRow = (await query<{ id: string }>(
      `SELECT p.id FROM page p WHERE p.data_source_id = $1 AND NOT p.is_template`, [copyDs]))[0]!.id
    assert.ok((await bodyText(copyRow)).includes('행의 본문 글'), '행의 본문')
    const copySub = (await query<{ id: string; title: string }>(
      `SELECT id, properties -> 'title' -> 0 ->> 'plain_text' AS title FROM block WHERE parent_id = $1 AND type = 'page' AND lifecycle = 'live'`, [copyRow]))
    assert.equal(copySub.length, 1)
    assert.notEqual(copySub[0]!.id, sub, '하위 페이지도 새 id')
    assert.equal(copySub[0]!.title, '행의 하위')
    assert.ok((await bodyText(copySub[0]!.id)).includes('하위의 본문 글'), '하위 페이지의 본문')
    assert.ok((await bodyText(copyRow)).includes(copySub[0]!.id), '행의 본문은 사본의 하위 페이지를 가리킨다')
    const copyTemplate = (await query<{ id: string }>(`SELECT p.id FROM page p WHERE p.data_source_id = $1 AND p.is_template`, [copyDs]))[0]!.id
    assert.ok((await bodyText(copyTemplate)).includes('양식의 본문 글'), '템플릿의 본문')
    const view = (await query<{ default_template_page_id: string | null }>(
      `SELECT default_template_page_id FROM view WHERE database_id = $1`, [copied.id]))[0]
    assert.equal(view?.default_template_page_id, copyTemplate, '기본 템플릿은 사본의 템플릿')
    assert.ok((await bodyText(row)).includes(sub), '원본 행의 본문은 그대로')

    const shape = unwrap(await duplicateDatabase(fx.owner.ctx, made.id, { content: false }))
    const shapeDs = await sourceOf(shape.id)
    const shapePages = await query<{ is_template: boolean }>(`SELECT is_template FROM page WHERE data_source_id = $1`, [shapeDs])
    assert.deepEqual(shapePages.map((p) => p.is_template), [true], '내용 없이 — 템플릿만(행은 없다)')
    assert.equal(shape.rows, 0)
  })
})
