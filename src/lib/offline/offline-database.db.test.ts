/**
 * 오프라인 데이터베이스의 서버 쪽 — OF-4 (F-12-04 · 정본 §3.7 [보강 OF-1] ⑤ · DB)
 *
 *   ① ★ 볼 수 있는 사람은 받는다 — 첫 뷰의 이름 · 보이는 열(뷰 순서 · 숨긴 열은 없다) · 그 뷰의 필터 · 정렬대로 처음 50행 · 더 있으면
 *      truncated · 칸은 보이는 글자(옵션 이름 · 사람 이름 · 날짜 · id 가 아니다)
 *   ② ★ 행 단위 제한 — 끊겨 빠진 행은 그 사람의 사본에 없다(소유자에게는 있다 · 표 화면과 같은 행 질의)
 *   ③ ★ 첫 탭이 폼 · 대시보드면 건너뛰고 행을 그리는 첫 뷰
 *   ④ ★ 내보내기 정책 — 끄면 멤버는 policy_disabled(데이터베이스의 있고 없음을 알리지 않는다) · 소유자는 받는다
 *   ⑤ ★ 볼 수 없는 · 없는 · uuid 가 아닌 데이터베이스는 not_found(가르지 않는다)
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from '../database/database.ts'
import { createFormView } from '../database/form.ts'
import { addProperty, addSelectOption, getSchema } from '../database/property.ts'
import type { CellValue } from '../database/property-types.ts'
import { createRow } from '../database/row.ts'
import { createView, moveView, setViewColumn, updateView } from '../database/view.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { updateSetting } from '../settings/settings.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { readOfflineDatabase } from './offline-database.ts'

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

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)} ${Date.now()}`

async function office() {
  const ws = await createBareWorkspace('오프라인 데이터베이스')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  const stranger = await joinAs(ws, await createUser('남'), 'member')
  return { ws, boss, mate, stranger }
}

/**
 * 소유자의 개인 표(점수 · 상태 · 마감 · 담당 · 메모) — 동료에게 보기를 준다. 행은 `count` 개(점수 1..count · 짝수는 "끝" · 담당은 동료).
 */
async function table(boss: Actor, mate: Actor, count: number) {
  const db = unwrap(await createDatabase(boss.ctx, { name: unique('할 일'), privateTop: true }))
  const ds = db.dataSourceId
  for (const [name, type] of [['점수', 'number'], ['상태', 'select'], ['마감', 'date'], ['담당', 'people'], ['메모', 'rich_text']] as const) {
    unwrap(await addProperty(boss.ctx, ds, { name, type }))
  }
  const schema = unwrap(await getSchema(boss.ctx, ds))
  const id = (name: string) => schema.properties.find((p) => p.name === name)!.id
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const p = { title: titleId, score: id('점수'), status: id('상태'), due: id('마감'), owner: id('담당'), memo: id('메모') }
  const done = unwrap(await addSelectOption(boss.ctx, ds, p.status, { name: '끝' })).option.id
  const rows: string[] = []
  for (let i = 1; i <= count; i += 1) {
    const cells: { propertyId: string; value: CellValue }[] = [
      { propertyId: p.title, value: { type: 'title', title: [textRun(`일 ${i}`)] } },
      { propertyId: p.score, value: { type: 'number', number: i } },
      { propertyId: p.due, value: { type: 'date', date: { start: '2026-03-10' } } },
      { propertyId: p.owner, value: { type: 'people', people: [{ id: mate.userId }] } as CellValue },
      { propertyId: p.memo, value: { type: 'rich_text', rich_text: [textRun(`메모 ${i}`)] } },
      ...(i % 2 === 0 ? [{ propertyId: p.status, value: { type: 'select', select: { id: done } } as CellValue }] : []),
    ]
    rows.push(unwrap(await createRow(boss.ctx, ds, { cells })).id)
  }
  assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: mate.userId }, 'view')).ok)
  return { db, ds, p, rows }
}

// ── ① 받는다 ──────────────────────────────────────────────────────────

describe('① ★ 볼 수 있는 사람은 첫 뷰의 보이는 열 · 처음 50행을 받는다', () => {
  test('필터 · 정렬 · 숨긴 열 · 50행 · truncated · 보이는 글자', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await office()
    const { db, p } = await table(boss, mate, 60)
    // 첫 뷰 — 점수 ≥ 5 · 점수 내림차순 · 메모 숨김
    unwrap(await updateView(boss.ctx, db.defaultViewId, {
      name: '진행 중',
      filter: { property_id: p.score, operator: 'greater_than_or_equal_to', value: 5 },
      sorts: [{ property_id: p.score, direction: 'desc' }],
    }))
    unwrap(await setViewColumn(boss.ctx, db.defaultViewId, p.memo, { visible: false }))

    const read = await readOfflineDatabase(mate.ctx, db.id)
    assert.equal(read.ok, true, JSON.stringify(read))
    if (!read.ok) return
    const v = read.value
    assert.equal(v.databaseId, db.id)
    assert.match(v.name, /^할 일/)
    assert.equal(v.viewName, '진행 중')
    assert.deepEqual(v.columns.map((c) => c.id), [p.title, p.score, p.status, p.due, p.owner], '보이는 열만 · 뷰 순서 · 숨긴 메모는 없다')
    assert.equal(v.columns[0].type, 'title')
    assert.equal(v.rows.length, 50, '처음 50행')
    assert.equal(v.truncated, true, '56행이 걸러져 50행 뒤에 더 있다')
    assert.deepEqual(v.rows.map((r) => r.cells[p.score]), Array.from({ length: 50 }, (_, i) => String(60 - i)), '뷰의 정렬 · 필터대로(60 → 11)')
    const top = v.rows[0]
    assert.equal(top.title, '일 60')
    assert.deepEqual(top.cells, {
      [p.title]: '일 60',
      [p.score]: '60',
      [p.status]: '끝',
      [p.due]: '2026-03-10',
      [p.owner]: (await import('../db/pool.ts').then((m) => m.queryOne<{ name: string }>(`SELECT name FROM "user" WHERE id = $1`, [mate.userId]))).name,
    }, '옵션 이름 · 사람 이름 · 날짜 — id 가 아니다')
    assert.equal(v.rows[1].cells[p.status], '', '옵션이 없는 칸은 빈 글')
    assert.ok(!JSON.stringify(v.rows).includes(mate.userId), '사람 id 가 나가지 않는다')
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(v.savedVersion))

    // 50행 이하면 끊기지 않는다
    unwrap(await updateView(boss.ctx, db.defaultViewId, { filter: { property_id: p.score, operator: 'greater_than', value: 55 } }))
    const few = await readOfflineDatabase(mate.ctx, db.id)
    assert.ok(few.ok)
    if (few.ok) {
      assert.equal(few.value.rows.length, 5)
      assert.equal(few.value.truncated, false)
    }
  })
})

// ── ② 행 단위 제한 ────────────────────────────────────────────────────

describe('② ★ 끊겨 빠진 행은 그 사람의 사본에 없다', () => {
  test('소유자에게는 있다 · 동료에게는 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await office()
    const { db, rows } = await table(boss, mate, 3)
    assert.ok((await stopInheriting(boss.ctx, rows[1])).ok)
    assert.ok((await revokeAccess(boss.ctx, rows[1], { type: 'user', id: mate.userId })).ok)

    const mine = await readOfflineDatabase(mate.ctx, db.id)
    const owner = await readOfflineDatabase(boss.ctx, db.id)
    assert.ok(mine.ok && owner.ok)
    if (!mine.ok || !owner.ok) return
    assert.deepEqual(mine.value.rows.map((r) => r.id).sort(), [rows[0], rows[2]].sort(), '끊겨 빠진 행은 없다')
    assert.ok(!JSON.stringify(mine.value.rows).includes('"일 2"'), '그 행의 제목도 나가지 않는다')
    assert.equal(owner.value.rows.length, 3, '소유자는 셋 다')
  })
})

// ── ③ 행을 그리지 않는 첫 뷰 ─────────────────────────────────────────

describe('③ ★ 첫 탭이 폼 · 대시보드면 건너뛴다', () => {
  test('행을 그리는 첫 뷰의 이름 · 행', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await office()
    const { db, ds } = await table(boss, mate, 2)
    unwrap(await updateView(boss.ctx, db.defaultViewId, { name: '모든 일' }))
    const form = unwrap(await createFormView(boss.ctx, db.id, { name: '제출 폼', dataSourceId: ds }))
    const dashboard = unwrap(await createView(boss.ctx, db.id, { type: 'dashboard', name: '현황' }))
    // 탭 차례: 대시보드 · 폼 · 표
    unwrap(await moveView(boss.ctx, form.viewId, db.defaultViewId))
    unwrap(await moveView(boss.ctx, dashboard.id, form.viewId))

    const read = await readOfflineDatabase(mate.ctx, db.id)
    assert.ok(read.ok, JSON.stringify(read))
    if (!read.ok) return
    assert.equal(read.value.viewName, '모든 일', '폼 · 대시보드를 건너뛴 첫 뷰')
    assert.equal(read.value.rows.length, 2)
    assert.ok(read.value.columns.length > 0)
  })
})

// ── ④ 내보내기 정책 ───────────────────────────────────────────────────

describe('④ ★ 내보내기 정책을 따른다', () => {
  test('끄면 멤버는 policy_disabled · 소유자는 받는다 · 켜면 다시 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await office()
    const { db } = await table(boss, mate, 1)
    const setExport = async (value: boolean) => assert.deepEqual(await updateSetting(boss.ctx, 'workspace.allow_export', value), { ok: true, value })

    await setExport(false)
    assert.deepEqual(await readOfflineDatabase(mate.ctx, db.id), { ok: false, reason: 'policy_disabled' })
    assert.deepEqual(await readOfflineDatabase(mate.ctx, randomUUID()), { ok: false, reason: 'policy_disabled' }, '정책을 먼저 본다 — 있고 없음을 알리지 않는다')
    assert.equal((await readOfflineDatabase(boss.ctx, db.id)).ok, true, '소유자는 정책과 상관없이 받는다')
    await setExport(true)
    assert.equal((await readOfflineDatabase(mate.ctx, db.id)).ok, true)
  })
})

// ── ⑤ not_found ──────────────────────────────────────────────────────

describe('⑤ ★ 볼 수 없는 · 없는 데이터베이스는 not_found', () => {
  test('가르지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, stranger } = await office()
    const { db } = await table(boss, mate, 1)
    assert.deepEqual(await readOfflineDatabase(stranger.ctx, db.id), { ok: false, reason: 'not_found' }, '볼 수 없는 데이터베이스')
    assert.deepEqual(await readOfflineDatabase(mate.ctx, randomUUID()), { ok: false, reason: 'not_found' }, '없는 데이터베이스')
    assert.deepEqual(await readOfflineDatabase(mate.ctx, 'not-a-uuid'), { ok: false, reason: 'not_found' }, 'uuid 가 아닌 id')
    assert.ok((await revokeAccess(boss.ctx, db.id, { type: 'user', id: mate.userId })).ok)
    assert.deepEqual(await readOfflineDatabase(mate.ctx, db.id), { ok: false, reason: 'not_found' }, '공유를 거두면')
  })
})
