/**
 * 개인 뷰 상태의 전달 · 지운 속성의 조건 정리 (DB 실시간 동기화 RT-3조각 · F-05-16 · F-05-06, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 `view_user_override` [보강 RT-3] · 마이그레이션 0154
 *
 *   ① ★ 속성을 지우면 같은 트랜잭션에서 그 조건만 빠진다 — 공유 층 · 모든 사람의 개인 층 · 알림(개인 층은 그 사람 · 공유 층은 보는 모두 ·
 *        지운 사람은 빼고) · 되돌린 트랜잭션은 아무것도 남기지 않는다
 *   ② 알림 — 그 층이 걸린 사람에게만 · 한 번(본 뒤에는 없다) · 남의 개인 알림은 적지 못한다 · 30일이 지나면 보관 정리가 지운다
 *   ③ 타입 바꾸기도 개인 층에서 그 속성의 규칙을 뺀다(정렬은 남는다 · 이유 type_changed)
 *   ④ ★ 지운 속성을 가리키는 옛 필터 · 정렬(정리 전의 행)은 오류 없이 그 조건만 무시한다 — 행 질의 · 보드 · 열 집계
 *   ⑤ ★ 개인 신호 — 실제 LISTEN 으로 그 표의 **그 사람**의 구독(둘)에게만 · 남은 아무것도(changed 도) 받지 않는다 · 변경 기록에 쓰지 않는다 ·
 *        바꾼 탭을 싣는다
 *   ⑥ 놓친 신호 — 델타의 personalChanged 는 그 사람에게만 · 한 번 · 렌더 뒤의 틈(`personalChangedSince`)
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { withCommandTransaction } from '../db/tx.ts'
import { query } from '../db/pool.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, deleteProperty, deletePropertyIn, getSchema } from './property.ts'
import { convertProperty } from './property-convert.ts'
import type { CellValue } from './property-types.ts'
import { createRow } from './row.ts'
import { ackViewNotices, createView, getView, listViewNotices, resetPersonalView, setPersonalView, updateView } from './view.ts'
import { queryRows } from './query.ts'
import { queryGroups } from './group.ts'
import { computeCalculations } from './calculate.ts'
import type { FilterNode, SortKey } from './filter.ts'
import { closeRowFeed, subscribeRows, type RowFeedListener } from './row-feed.ts'
import { currentChangeCursor, decodeChangeCursor, personalChangedSince } from './change-log.ts'
import { readRowDelta } from './row-delta.ts'
import { runDataRetention } from '../notification/retention.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let amy: Actor
let ben: Actor
let cat: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  amy = await joinAs(fx.workspaceId, await createUser('에이미'), 'member')
  ben = await joinAs(fx.workspaceId, await createUser('벤'), 'member')
  cat = await joinAs(fx.workspaceId, await createUser('캣'), 'member')
})

after(async () => {
  await closeRowFeed()
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const leaf = (property_id: string, operator: string, value?: unknown): FilterNode =>
  value === undefined ? { property_id, operator } : { property_id, operator, value }
const asc = (property_id: string): SortKey => ({ property_id, direction: 'asc' })
const desc = (property_id: string): SortKey => ({ property_id, direction: 'desc' })

/** 점수(숫자) · 단계(선택 — 기획) · 메모(글). 행: 가 10 기획 · 나 20 · 다 30 기획. */
async function table() {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `정리 ${Date.now()}` }))
  const ds = created.dataSourceId
  const add = async (name: string, type: 'number' | 'select' | 'rich_text') =>
    unwrap(await addProperty(fx.owner.ctx, ds, { name, type })).properties.find((p) => p.name === name)!.id
  const score = await add('점수', 'number')
  const stage = await add('단계', 'select')
  const memo = await add('메모', 'rich_text')
  const plan = unwrap(await addSelectOption(fx.owner.ctx, ds, stage, { name: '기획' })).option.id
  const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  for (const [t, n, s] of [['가', 10, true], ['나', 20, false], ['다', 30, true]] as const) {
    const cells: { propertyId: string; value: CellValue }[] = [
      { propertyId: titleId, value: { type: 'title', title: [textRun(t)] } },
      { propertyId: score, value: { type: 'number', number: n } },
      ...(s ? [{ propertyId: stage, value: { type: 'select', select: { id: plan } } as CellValue }] : []),
    ]
    unwrap(await createRow(fx.owner.ctx, ds, { cells }))
  }
  return { databaseId: created.id, ds, viewId: created.defaultViewId, score, stage, memo, plan }
}

async function titlesFor(actor: Actor, viewId: string): Promise<string[]> {
  const view = unwrap(await getView(actor.ctx, viewId))
  const page = unwrap(await queryRows(actor.ctx, view.dataSourceId, { filter: view.effectiveFilter, sorts: view.effectiveSorts }))
  return page.rows.map((r) => r.title)
}

async function overrideOf(viewId: string, userId: string) {
  return (await query<{ filter: FilterNode | null; sorts: SortKey[] | null }>(
    `SELECT filter, sorts FROM view_user_override WHERE view_id = $1 AND user_id = $2`,
    [viewId, userId],
  ))[0] ?? null
}

async function noticesOf(viewId: string) {
  return query<{ user_id: string | null; reason: string; filters: number; sorts: number; property_name: string }>(
    `SELECT user_id, reason, filters, sorts, property_name FROM view_filter_notice WHERE view_id = $1 ORDER BY user_id NULLS FIRST`,
    [viewId],
  )
}

describe('① 속성을 지우면 그 조건만', () => {
  test('★ 공유 층 · 모든 사람의 개인 층에서 같은 트랜잭션으로 · 알림(지운 사람은 빼고)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, ds, viewId, score, stage, memo, plan } = await table()
    const untouched = unwrap(await createView(fx.owner.ctx, databaseId, { name: '안 쓰는 뷰', type: 'table' })).id
    unwrap(await updateView(fx.owner.ctx, untouched, { filter: leaf(score, 'greater_than', 0) }))
    unwrap(await updateView(fx.owner.ctx, viewId, {
      filter: { op: 'and', children: [leaf(score, 'greater_than', 5), leaf(stage, 'equals', plan)] },
      sorts: [asc(stage), desc(score)],
    }))
    unwrap(await setPersonalView(amy.ctx, viewId, { filter: { op: 'and', children: [leaf(stage, 'equals', plan), leaf(score, 'less_than', 25)] }, sorts: [desc(stage)] }))
    unwrap(await setPersonalView(ben.ctx, viewId, { filter: { op: 'or', children: [leaf(stage, 'equals', plan), leaf(memo, 'is_not_empty')] } }))
    unwrap(await setPersonalView(fx.owner.ctx, viewId, { filter: leaf(stage, 'is_not_empty') }))
    assert.deepEqual(await titlesFor(amy, viewId), ['가'], '전제 — 에이미는 기획 · 25 미만')

    // 되돌린 트랜잭션은 아무것도 남기지 않는다 — 속성 · 조건 · 알림이 한 트랜잭션이다
    await assert.rejects(withCommandTransaction(async (tx) => {
      unwrap(await deletePropertyIn(tx, fx.owner.ctx, ds, stage))
      throw new Error('되돌린다')
    }), /되돌린다/)
    assert.ok(JSON.stringify(unwrap(await getView(fx.owner.ctx, viewId)).filter).includes(stage), '되돌리면 공유 필터는 그대로')
    assert.ok(JSON.stringify(await overrideOf(viewId, amy.userId)).includes(stage), '되돌리면 개인 필터도 그대로')
    assert.equal((await noticesOf(viewId)).length, 0, '되돌리면 알림도 없다')

    unwrap(await deleteProperty(fx.owner.ctx, ds, stage))
    const shared = unwrap(await getView(fx.owner.ctx, viewId))
    assert.deepEqual(shared.filter, { op: 'and', children: [leaf(score, 'greater_than', 5)] }, '★ 공유 — 그 규칙만 빠진다')
    assert.deepEqual(shared.sorts, [desc(score)], '공유 정렬은 그 키만')
    assert.deepEqual(await overrideOf(viewId, amy.userId), { filter: { op: 'and', children: [leaf(score, 'less_than', 25)] }, sorts: [] },
      '★ 에이미 — 남은 조건(< 25)은 그대로 · 정렬은 빈 것(공유 것으로 돌아가지 않는다)')
    assert.deepEqual(await overrideOf(viewId, ben.userId), { filter: { op: 'or', children: [leaf(memo, 'is_not_empty')] }, sorts: null }, '벤 — OR 의 다른 규칙은 그대로')
    assert.deepEqual(await overrideOf(viewId, fx.owner.userId), { filter: { op: 'and', children: [] }, sorts: null }, '다 빠진 개인 필터는 "필터 없음"')
    assert.deepEqual(await titlesFor(amy, viewId), ['가', '나'], '★ 에이미 — 남은 조건이 그대로 걸린다(뷰 전체가 풀리지 않는다)')
    assert.deepEqual(unwrap(await getView(fx.owner.ctx, untouched)).filter, leaf(score, 'greater_than', 0), '그 속성을 안 쓰는 뷰는 그대로')

    const notes = await noticesOf(viewId)
    assert.deepEqual(
      notes.map((n) => [n.user_id, n.reason, n.filters, n.sorts, n.property_name]),
      [
        [null, 'property_deleted', 1, 1, '단계'],
        ...[[amy.userId, 1, 1], [ben.userId, 1, 0]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([u, f, s]) => [u, 'property_deleted', f, s, '단계']),
      ],
      '★ 알림 — 공유 층 하나 · 에이미 · 벤(지운 사람의 개인 층은 없다)',
    )
    const ownerSeen = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM view_filter_notice_seen s JOIN view_filter_notice n ON n.id = s.notice_id WHERE n.view_id = $1 AND s.user_id = $2`,
      [viewId, fx.owner.userId],
    )
    assert.equal(ownerSeen[0]!.n, 1, '지운 사람은 공유 알림을 본 것으로')
  })
})

describe('② 알림', () => {
  test('★ 그 층이 걸린 사람에게만 · 한 번 · 남의 개인 알림은 적지 못한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, viewId, score, stage, plan } = await table()
    unwrap(await updateView(fx.owner.ctx, viewId, { filter: { op: 'and', children: [leaf(score, 'greater_than', 5), leaf(stage, 'equals', plan)] } }))
    unwrap(await setPersonalView(amy.ctx, viewId, { filter: leaf(stage, 'equals', plan) }))
    unwrap(await setPersonalView(ben.ctx, viewId, { filter: leaf(score, 'greater_than', 1) })) // 벤의 필터는 단계를 쓰지 않는다
    unwrap(await deleteProperty(fx.owner.ctx, ds, stage))

    const forAmy = await listViewNotices(amy.ctx, viewId)
    assert.deepEqual(forAmy.map((n) => [n.personal, n.filters, n.propertyName]), [[true, 1, '단계']], '에이미 — 자기 개인 층(공유 필터는 에이미에게 걸려 있지 않다)')
    assert.deepEqual(await listViewNotices(ben.ctx, viewId), [], '벤 — 개인 필터가 공유 것을 대체해 그 변화를 보지 않았다')
    assert.deepEqual((await listViewNotices(cat.ctx, viewId)).map((n) => n.personal), [false], '캣 — 공유 층(개인 것 없음)')
    assert.deepEqual(await listViewNotices(fx.owner.ctx, viewId), [], '지운 사람 — 없다')

    assert.equal(unwrap(await ackViewNotices(ben.ctx, viewId, forAmy.map((n) => n.id))).seen, 0, '★ 남의 개인 알림은 적지 못한다')
    assert.deepEqual((await listViewNotices(amy.ctx, viewId)).length, 1, '그래서 에이미에게 남는다')
    assert.equal(unwrap(await ackViewNotices(amy.ctx, viewId, forAmy.map((n) => n.id))).seen, 1)
    assert.deepEqual(await listViewNotices(amy.ctx, viewId), [], '★ 본 뒤에는 없다(한 번)')
    assert.equal(unwrap(await ackViewNotices(amy.ctx, viewId, forAmy.map((n) => n.id))).seen, 0, '두 번 적어도 그대로')
  })

  test('★ 뷰를 볼 수 없는 사람에게는 없다 — 공유 층 알림이 있어도(지운 속성의 이름이 새지 않는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, viewId, stage, plan } = await table()
    const guest = await joinAs(fx.workspaceId, await createUser('손님'), 'guest')
    unwrap(await updateView(fx.owner.ctx, viewId, { filter: leaf(stage, 'equals', plan) }))
    unwrap(await deleteProperty(fx.owner.ctx, ds, stage))
    assert.equal((await listViewNotices(cat.ctx, viewId)).length, 1, '전제 — 볼 수 있는 사람에게는 있다')
    assert.equal((await getView(guest.ctx, viewId)).ok, false, '전제 — 손님은 이 뷰를 볼 수 없다')
    assert.deepEqual(await listViewNotices(guest.ctx, viewId), [], '★ 볼 수 없으면 없다')
    assert.equal((await ackViewNotices(guest.ctx, viewId, [])).ok, false, '적기도 거절')
  })

  test('30일 — 화면은 띄우지 않고 보관 정리가 지운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, viewId, stage, plan } = await table()
    unwrap(await updateView(fx.owner.ctx, viewId, { filter: leaf(stage, 'equals', plan) }))
    unwrap(await deleteProperty(fx.owner.ctx, ds, stage))
    assert.equal((await listViewNotices(cat.ctx, viewId)).length, 1, '전제')
    await query(`UPDATE view_filter_notice SET created_at = now() - interval '31 days' WHERE view_id = $1`, [viewId])
    assert.deepEqual(await listViewNotices(cat.ctx, viewId), [], '30일이 지난 것은 띄우지 않는다')
    const swept = await runDataRetention(new Date(), { workspaces: [fx.workspaceId], partitions: false })
    assert.ok(swept.viewNotices >= 1, '보관 정리 ⑬')
    assert.equal((await noticesOf(viewId)).length, 0)
  })
})

describe('③ 타입 바꾸기', () => {
  test('개인 층에서도 그 속성의 규칙을 뺀다 · 정렬은 남는다 · 이유 type_changed', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, viewId, score, memo } = await table()
    unwrap(await setPersonalView(amy.ctx, viewId, { filter: { op: 'and', children: [leaf(memo, 'contains', '가'), leaf(score, 'greater_than', 1)] }, sorts: [asc(memo)] }))
    const done = await convertProperty(fx.owner.ctx, ds, memo, { type: 'number', confirmLoss: true })
    assert.equal(done.ok, true)
    if (done.ok) assert.equal(done.value.filtersRemoved, 1, '개인 층의 규칙도 센다')
    assert.deepEqual(await overrideOf(viewId, amy.userId), { filter: { op: 'and', children: [leaf(score, 'greater_than', 1)] }, sorts: [asc(memo)] })
    assert.deepEqual((await listViewNotices(amy.ctx, viewId)).map((n) => [n.reason, n.filters, n.sorts]), [['type_changed', 1, 0]])
  })
})

describe('④ 지운 속성을 가리키는 옛 행', () => {
  test('★ 오류 없이 그 조건만 무시한다 — 행 질의 · 보드 · 열 집계 · 개인 층', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, ds, viewId, score, stage } = await table()
    const ghost = 'g'.repeat(21) // 없는 속성 — 정리 전에 남은 행(또는 정리와 엇갈린 저장)
    await query(`UPDATE view SET filter = $2::jsonb, sorts = $3::jsonb WHERE id = $1`, [
      viewId,
      JSON.stringify({ op: 'and', children: [leaf(ghost, 'equals', 'x'), { op: 'or', children: [leaf(ghost, 'is_empty'), leaf(score, 'greater_than', 15)] }] }),
      JSON.stringify([asc(ghost), desc(score)]),
    ])
    assert.deepEqual(await titlesFor(cat, viewId), ['다', '나'], '★ 남은 조건(> 15)과 정렬(점수 내림)만')
    const board = unwrap(await createView(fx.owner.ctx, databaseId, { name: '보드', type: 'board', groupBy: { property_id: stage } }))
    await query(`UPDATE view SET filter = $2::jsonb WHERE id = $1`, [board.id, JSON.stringify(leaf(ghost, 'equals', 'x'))])
    const groups = unwrap(await queryGroups(cat.ctx, board.id))
    assert.equal(groups.groups.reduce((n, g) => n + g.count, 0), 3, '보드 — 오류 없이(조건 하나뿐이면 모두)')
    const view = unwrap(await getView(cat.ctx, viewId))
    const calc = await computeCalculations(cat.ctx, ds, view.effectiveFilter, view.columns, null, null, null)
    assert.ok(calc !== null, '열 집계도 돈다')
    await query(`INSERT INTO view_user_override (view_id, user_id, filter) VALUES ($1, $2, $3::jsonb)`, [viewId, amy.userId, JSON.stringify(leaf(ghost, 'equals', 'x'))])
    assert.deepEqual((await titlesFor(amy, viewId)).sort(), ['가', '나', '다'], '개인 층의 옛 조건도 무시(조건 하나뿐이면 모두 — 칩이 "지워진 속성 (무시됨)")')
  })
})

describe('⑤ 개인 신호 — 실제 LISTEN', () => {
  test('★ 그 표의 그 사람의 구독(둘)에게만 · 남은 아무것도 받지 않는다 · 변경 기록에 쓰지 않는다 · 바꾼 탭을 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, viewId, score } = await table()
    const other = await table()
    const seen: string[] = []
    const listener = (name: string, dataSourceId: string, actor: Actor): RowFeedListener => ({
      dataSourceId,
      workspaceId: fx.workspaceId,
      userId: actor.userId,
      onChanged: () => seen.push(`${name}:changed`),
      onAccess: () => undefined,
      onSession: () => undefined,
      onPersonal: (v, origin) => seen.push(`${name}:personal:${v === viewId ? 'view' : v}:${origin}`),
    })
    const offs = [
      await subscribeRows(listener('amy1', ds, amy)),
      await subscribeRows(listener('amy2', ds, amy)),
      await subscribeRows(listener('ben', ds, ben)),
      await subscribeRows(listener('amyElsewhere', other.ds, amy)),
    ]
    try {
      const logBefore = await query<{ n: number }>(`SELECT count(*)::int AS n FROM data_source_change WHERE data_source_id = $1`, [ds])
      unwrap(await setPersonalView(amy.ctx, viewId, { filter: leaf(score, 'less_than', 25) }, { origin: 'tab-aaaaaaaa' }))
      for (let i = 0; i < 60 && seen.filter((s) => s.includes('personal')).length < 2; i++) await sleep(50)
      await sleep(300) // 남에게 늦게 가는 것이 없는지
      assert.deepEqual(seen.sort(), ['amy1:personal:view:tab-aaaaaaaa', 'amy2:personal:view:tab-aaaaaaaa'], '★ 에이미의 두 구독에게만 — 벤 · 다른 표 · changed 없음')
      const logAfter = await query<{ n: number }>(`SELECT count(*)::int AS n FROM data_source_change WHERE data_source_id = $1`, [ds])
      assert.equal(logAfter[0]!.n, logBefore[0]!.n, '★ 변경 기록에 쓰지 않는다(쓰면 모두의 델타가 된다)')

      seen.length = 0
      unwrap(await resetPersonalView(amy.ctx, viewId))
      for (let i = 0; i < 60 && seen.length < 2; i++) await sleep(50)
      await sleep(300)
      assert.deepEqual(seen.sort(), ['amy1:personal:view:null', 'amy2:personal:view:null'], '초기화도 · 바꾼 탭이 없으면 null')
    } finally {
      for (const off of offs) off()
    }
  })
})

describe('⑥ 놓친 신호', () => {
  test('★ 델타의 personalChanged — 그 사람에게만 · 한 번 · 렌더 뒤의 틈', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, viewId, score } = await table()
    const rendered = await currentChangeCursor()
    unwrap(await setPersonalView(amy.ctx, viewId, { filter: leaf(score, 'less_than', 25) }))
    assert.equal(await personalChangedSince(ds, amy.userId, decodeChangeCursor(rendered)!), true, '렌더 뒤의 틈 — 에이미')
    assert.equal(await personalChangedSince(ds, ben.userId, decodeChangeCursor(rendered)!), false, '벤은 아니다')

    // 지평이 다른 검사의 열린 트랜잭션에 묶여 있으면 아직 못 줄 수 있다 — 같은 커서로 다시 묻는다(커서는 그대로 안전하다)
    let amyDelta = unwrap(await readRowDelta(amy.ctx, ds, viewId, rendered))
    for (let i = 0; i < 40 && !amyDelta.personalChanged; i++) {
      await sleep(100)
      amyDelta = unwrap(await readRowDelta(amy.ctx, ds, viewId, rendered))
    }
    assert.equal(amyDelta.personalChanged, true, '★ 에이미의 델타는 안다')
    assert.equal(unwrap(await readRowDelta(ben.ctx, ds, viewId, rendered)).personalChanged, false, '★ 벤의 델타는 모른다(남의 개인 설정)')
    assert.equal(unwrap(await readRowDelta(amy.ctx, ds, viewId, amyDelta.cursor)).personalChanged, false, '한 번만 — 그 뒤 커서에서는 없다')

    // 초기화(행이 사라져도)도 놓치지 않는다
    const before = amyDelta.cursor
    unwrap(await resetPersonalView(amy.ctx, viewId))
    let again = unwrap(await readRowDelta(amy.ctx, ds, viewId, before))
    for (let i = 0; i < 40 && !again.personalChanged; i++) {
      await sleep(100)
      again = unwrap(await readRowDelta(amy.ctx, ds, viewId, before))
    }
    assert.equal(again.personalChanged, true, '초기화도 안다')
  })
})
