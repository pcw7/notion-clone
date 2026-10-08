/**
 * 개인 필터 · 정렬 — 나에게만 적용하는 뷰 설정 (DB 심화 2h-1조각 · F-04-17, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 `view_user_override` · [보강] 개인 필터 · 정렬
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 볼 수만 있는 사람도 건다 — 그 사람의 행만 바뀐다 · 다른 사람은 공유 것
 *   ② ★ 대체다 — 공유 필터의 조건이 사라지고 개인 것만 · "필터 없음"(null)은 공유 필터를 끈다 · 정렬만 걸면 필터는 공유 것
 *   ③ 초기화 — 공유 것으로 돌아간다
 *   ④ ★ 모두에게 저장 — 편집자만(볼 수만 있는 사람은 거부) · 덮어쓴 쪽만 옮기고 개인 것은 지운다
 *   ⑤ 편집자가 공유 필터를 바꾸면 자기 개인 필터는 지워진다(정렬은 남는다)
 *   ⑥ ★ 보드 · 캘린더 · 열 집계도 개인 필터를 따른다
 *   ⑦ 틀린 필터는 거부한다(공유 것과 같은 검증)
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import type { CellValue } from './property-types.ts'
import { createRow } from './row.ts'
import { createView, getView, publishPersonalView, resetPersonalView, setPersonalView, updateView } from './view.ts'
import { queryRows } from './query.ts'
import { queryGroups } from './group.ts'
import { queryCalendar } from './calendar-query.ts'
import type { FilterNode } from './filter.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let viewer: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  viewer = await joinAs(fx.workspaceId, await createUser('보는 사람'), 'member')
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

/** 점수(숫자) · 단계(선택) · 마감(날짜). 행: 가 10 · 나 20 · 다 30. 볼 수만 있는 사람에게 'view' 를 준다. 공유 필터는 "점수 > 15". */
async function table() {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `개인 필터 ${Date.now()}` }))
  const ds = created.dataSourceId
  const add = async (name: string, type: 'number' | 'select' | 'date') =>
    unwrap(await addProperty(fx.owner.ctx, ds, { name, type })).properties.find((p) => p.name === name)!.id
  const score = await add('점수', 'number')
  const stage = await add('단계', 'select')
  const due = await add('마감', 'date')
  const opt = unwrap(await addSelectOption(fx.owner.ctx, ds, stage, { name: '기획' })).option.id
  const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  for (const [t, n, d] of [['가', 10, '2026-03-01'], ['나', 20, '2026-03-02'], ['다', 30, '2026-03-03']] as const) {
    const cells: { propertyId: string; value: CellValue }[] = [
      { propertyId: titleId, value: { type: 'title', title: [textRun(t)] } },
      { propertyId: score, value: { type: 'number', number: n } },
      { propertyId: stage, value: { type: 'select', select: { id: opt } } },
      { propertyId: due, value: { type: 'date', date: { start: d } } },
    ]
    unwrap(await createRow(fx.owner.ctx, ds, { cells }))
  }
  assert.equal((await stopInheriting(fx.owner.ctx, created.id)).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, created.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(fx.owner.ctx, created.id, { type: 'workspace_everyone', id: null })).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, created.id, { type: 'user', id: viewer.userId }, 'view')).ok, true)
  const viewId = created.defaultViewId
  unwrap(await updateView(fx.owner.ctx, viewId, { filter: { property_id: score, operator: 'greater_than', value: 15 } }))
  return { databaseId: created.id, ds, viewId, score, stage, due }
}

/** 그 사람이 보는 행의 제목 — 실제로 쓰는 필터 · 정렬로 묻는다(행 라우트 · 서버 렌더와 같은 길). */
async function titlesFor(actor: Actor, viewId: string): Promise<string[]> {
  const view = unwrap(await getView(actor.ctx, viewId))
  const page = unwrap(await queryRows(actor.ctx, view.dataSourceId, { filter: view.effectiveFilter, sorts: view.effectiveSorts }))
  return page.rows.map((r) => r.title)
}

const lessThan = (property_id: string, value: number): FilterNode => ({ property_id, operator: 'less_than', value })

describe('① 볼 수만 있는 사람도', () => {
  test('★ 개인 필터를 건다 — 그 사람의 행만 바뀐다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { viewId, score } = await table()
    assert.deepEqual(await titlesFor(viewer, viewId), ['나', '다'], '공유 필터')
    const set = unwrap(await setPersonalView(viewer.ctx, viewId, { filter: lessThan(score, 25) }))
    assert.deepEqual(set.personal, { filter: true, sorts: false })
    assert.deepEqual(await titlesFor(viewer, viewId), ['가', '나'], '★ 대체 — 공유 조건(> 15)이 사라지고 개인 것(< 25)만')
    assert.deepEqual(await titlesFor(fx.owner, viewId), ['나', '다'], '다른 사람은 공유 것')
    const shared = unwrap(await getView(fx.owner.ctx, viewId))
    assert.equal(shared.personal, null)
  })
})

describe('② 대체 · 필터 없음 · 정렬만', () => {
  test('★ "필터 없음"은 공유 필터를 끈다 · 정렬만 걸면 필터는 공유 것', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { viewId, score } = await table()
    unwrap(await setPersonalView(viewer.ctx, viewId, { sorts: [{ property_id: score, direction: 'desc' }] }))
    assert.deepEqual(await titlesFor(viewer, viewId), ['다', '나'], '정렬만 — 필터는 공유 것(> 15)')
    unwrap(await setPersonalView(viewer.ctx, viewId, { filter: null }))
    assert.deepEqual(await titlesFor(viewer, viewId), ['다', '나', '가'], '"필터 없음" — 정렬은 앞에서 건 것이 남는다')
  })
})

describe('③ 초기화', () => {
  test('공유 것으로 돌아간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { viewId, score } = await table()
    unwrap(await setPersonalView(viewer.ctx, viewId, { filter: lessThan(score, 15) }))
    const reset = unwrap(await resetPersonalView(viewer.ctx, viewId))
    assert.equal(reset.personal, null)
    assert.deepEqual(await titlesFor(viewer, viewId), ['나', '다'])
  })
})

describe('④ 모두에게 저장', () => {
  test('★ 편집자만 — 덮어쓴 쪽만 옮기고 개인 것은 지운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { viewId, score } = await table()
    unwrap(await setPersonalView(viewer.ctx, viewId, { filter: lessThan(score, 25) }))
    const refused = await publishPersonalView(viewer.ctx, viewId)
    assert.equal(!refused.ok && refused.reason, 'forbidden', '볼 수만 있는 사람은 모두에게 저장하지 못한다')

    unwrap(await setPersonalView(fx.owner.ctx, viewId, { sorts: [{ property_id: score, direction: 'desc' }] }))
    const published = unwrap(await publishPersonalView(fx.owner.ctx, viewId))
    assert.equal(published.personal, null, '내 개인 것은 지워졌다')
    assert.deepEqual(published.sorts, [{ property_id: score, direction: 'desc' }])
    assert.deepEqual(published.filter, { property_id: score, operator: 'greater_than', value: 15 }, '덮어쓰지 않은 필터는 공유 것 그대로')
    assert.deepEqual(await titlesFor(fx.owner, viewId), ['다', '나'])

    unwrap(await setPersonalView(fx.owner.ctx, viewId, { filter: null }))
    const cleared = unwrap(await publishPersonalView(fx.owner.ctx, viewId))
    assert.equal(cleared.filter, null, '"필터 없음"을 모두에게 — 공유 필터를 지운다')
  })
})

describe('⑤ 편집자가 공유 필터를 바꾸면', () => {
  test('자기 개인 필터는 지워지고 정렬은 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { viewId, score } = await table()
    unwrap(await setPersonalView(fx.owner.ctx, viewId, { filter: lessThan(score, 15), sorts: [{ property_id: score, direction: 'desc' }] }))
    const updated = unwrap(await updateView(fx.owner.ctx, viewId, { filter: lessThan(score, 35) }))
    assert.deepEqual(updated.personal, { filter: false, sorts: true })
    assert.deepEqual(await titlesFor(fx.owner, viewId), ['다', '나', '가'], '새 공유 필터(< 35) · 개인 정렬(내림)')
  })
})

describe('⑥ 보드 · 캘린더 · 열 집계', () => {
  test('★ 개인 필터를 따른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, score, stage } = await table()
    const board = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'board', groupBy: { property_id: stage } }))
    const calendar = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'calendar' }))
    for (const id of [board.id, calendar.id]) unwrap(await updateView(fx.owner.ctx, id, { filter: { property_id: score, operator: 'greater_than', value: 15 } }))

    unwrap(await setPersonalView(viewer.ctx, board.id, { filter: lessThan(score, 15) }))
    const groups = unwrap(await queryGroups(viewer.ctx, board.id))
    assert.equal(groups.groups.reduce((n, g) => n + g.count, 0), 1, '보드 — 개인 필터(< 15)')
    assert.equal(unwrap(await queryGroups(fx.owner.ctx, board.id)).groups.reduce((n, g) => n + g.count, 0), 2, '다른 사람은 공유 것')

    unwrap(await setPersonalView(viewer.ctx, calendar.id, { filter: null }))
    const month = unwrap(await queryCalendar(viewer.ctx, calendar.id, { from: '2026-03-01', to: '2026-03-31' }))
    assert.equal(month.rows.length, 3, '캘린더 — "필터 없음"')
  })
})

describe('⑦ 거부', () => {
  test('틀린 필터 · 정렬은 공유 것과 같은 이유로 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { viewId } = await table()
    const bad = await setPersonalView(viewer.ctx, viewId, { filter: { property_id: 'p'.repeat(21), operator: 'equals', value: 1 } })
    assert.equal(!bad.ok && bad.reason, 'invalid_filter')
    const nothing = await setPersonalView(viewer.ctx, viewId, {})
    assert.equal(nothing.ok, false, '바꿀 것이 없다')
  })
})
