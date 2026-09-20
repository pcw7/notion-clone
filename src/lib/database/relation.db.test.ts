/**
 * relation — relation 5a조각 (F-03-10, DB 필요)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 프로퍼티의 네 모양(단방향 · 양방향 · 같은 표 하나 · 같은 표 둘) — 짝은 `config.synced_property_id` 다(정본 E1)
 *   ② **relation 은 셀로 쓸 수 없다**(불변식 C2) — 값은 엣지이고 `properties_cache` 에만 투영된다(앞 25개 + 개수)
 *   ③ 값은 집합이다 — 더하고 뺀다. 두 사람이 각각 더한 것이 둘 다 남는다
 *   ④ **양방향은 거울상과 함께 쓴다** — 한쪽에서 더하고 빼면 반대쪽 칸이 따라간다. 상대 행의 버전은 올리지 않는다
 *   ⑤ `limit: 'one'` 은 하나를 더하면 그것으로 바뀐다 — 바뀐 연결의 거울상도 함께 빠진다
 *   ⑥ 더할 수 있는 것은 **대상 표의 · 살아 있는 · 볼 수 있는** 행뿐이고, 아니면 전부 같은 답이다
 *   ⑦ 읽기가 거른다 — 휴지통의 행은 빠지고(복원하면 돌아온다), 대상 표를 못 보면 개수만 받는다
 *   ⑧ DB 가 지킨다 — 거울상 없는 엣지는 커밋되지 않는다(E1 의 지연 제약 트리거)
 *   ⑨ 화면이 그릴 것(5b-1) — 뷰의 컬럼에 relation 이 서고, 제목 맵은 제목 · null(볼 수 없다) · 키 없음(휴지통)으로 갈린다
 *
 * 반사실(HANDOFF §3.3-159~161): 거울상을 안 쓰면 ④ ⑤ 가 **커밋에서** 죽고, 빼기의 거울상을 안 지우면 ④ 의 빼기가,
 * 볼 수 있는지 안 보면 ⑥ 의 권한 검사가, 읽기가 lifecycle 을 안 보면 ⑦ 이 실패한다.
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { getSchema } from './property.ts'
import { readRelationValue } from './property-types.ts'
import { createRow, trashRow, updateCells } from './row.ts'
import {
  addRelationProperty,
  linkRows,
  loadRelationLabels,
  readRelation,
  readRelationConfig,
  relationIdsIn,
  MAX_LINKS_PER_REQUEST,
} from './relation.ts'
import { createView, getView } from './view.ts'
import { queryRows } from './query.ts'

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string; issues?: readonly unknown[] }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? `${r.reason} ${JSON.stringify(r.issues ?? '')}` : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

type Table = { databaseId: string; dataSourceId: string; titleId: string; row: (title: string) => Promise<string> }

async function newTable(name: string): Promise<Table> {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const schema = unwrap(await getSchema(fx.owner.ctx, created.dataSourceId))
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  return {
    databaseId: created.id,
    dataSourceId: created.dataSourceId,
    titleId,
    row: async (title) =>
      unwrap(
        await createRow(fx.owner.ctx, created.dataSourceId, {
          cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }],
        }),
      ).id,
  }
}

/** 작업 → 프로젝트. `twoWay` 면 프로젝트 쪽에 "작업들"이 생긴다. */
async function tasksAndProjects(options: { twoWay?: boolean; limit?: 'one' } = {}) {
  const tasks = await newTable('작업')
  const projects = await newTable('프로젝트')
  const made = unwrap(
    await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, {
      name: '프로젝트',
      targetDataSourceId: projects.dataSourceId,
      ...(options.twoWay ? { twoWay: { name: '작업들' } } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
    }),
  )
  return { tasks, projects, relId: made.propertyId, backId: made.syncedPropertyId }
}

const relationOf = async (rowId: string, propertyId: string) =>
  withReadTransaction(async (tx) => {
    const row = await tx.queryOne<{ properties_cache: Record<string, unknown>; version: string }>(
      `SELECT p.properties_cache, b.version FROM page p JOIN block b ON b.id = p.id WHERE p.id = $1`,
      [rowId],
    )
    return { ...readRelationValue(row.properties_cache[propertyId]), version: row.version }
  })
const idsOf = async (rowId: string, propertyId: string) => (await relationOf(rowId, propertyId)).relation.map((r) => r.id)

const makePrivate = async (databaseId: string, level?: 'view' | 'edit') => {
  assert.equal((await stopInheriting(fx.owner.ctx, databaseId)).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(fx.owner.ctx, databaseId, { type: 'workspace_everyone', id: null })).ok, true)
  if (level !== undefined) {
    assert.equal((await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: other.userId }, level)).ok, true)
  }
}

describe('① 프로퍼티의 네 모양', () => {
  test('다른 표 · 단방향(기본) — 짝이 없고 대상 표는 그대로다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId, backId } = await tasksAndProjects()
    assert.equal(backId, null)
    const schema = unwrap(await getSchema(fx.owner.ctx, tasks.dataSourceId))
    const rel = schema.properties.find((p) => p.id === relId)!
    assert.equal(rel.type, 'relation')
    assert.deepEqual(readRelationConfig(rel.config), { target_data_source_id: projects.dataSourceId })
    const target = unwrap(await getSchema(fx.owner.ctx, projects.dataSourceId))
    assert.deepEqual(target.properties.map((p) => p.type), ['title'])
  })

  test('★ 다른 표 · 양방향 — 두 표에 하나씩 생기고 서로가 짝이다(E1) · 대상 표의 스키마 버전도 오른다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const tasks = await newTable('작업')
    const projects = await newTable('프로젝트')
    const before = unwrap(await getSchema(fx.owner.ctx, projects.dataSourceId)).schemaVersion
    const made = unwrap(
      await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, {
        name: '프로젝트',
        targetDataSourceId: projects.dataSourceId,
        twoWay: { name: '작업들' },
        limit: 'one',
      }),
    )
    const target = unwrap(await getSchema(fx.owner.ctx, projects.dataSourceId))
    const back = target.properties.find((p) => p.id === made.syncedPropertyId)!
    assert.equal(back.name, '작업들')
    // 역방향은 제한을 물려받지 않는다 — 한 작업은 프로젝트 하나여도 프로젝트는 작업을 여럿 갖는다.
    assert.deepEqual(readRelationConfig(back.config), { target_data_source_id: tasks.dataSourceId, synced_property_id: made.propertyId })
    const own = made.schema.properties.find((p) => p.id === made.propertyId)!
    assert.deepEqual(readRelationConfig(own.config), {
      target_data_source_id: projects.dataSourceId,
      synced_property_id: made.syncedPropertyId,
      limit: 'one',
    })
    assert.notEqual(target.schemaVersion, before)
  })

  test('★ 같은 표 · 프로퍼티 하나 — 자기 자신이 짝이다 · 방향을 가르면 둘이 같은 표에 생긴다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const tasks = await newTable('작업')
    const one = unwrap(await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, { name: '관련', targetDataSourceId: tasks.dataSourceId }))
    assert.equal(one.syncedPropertyId, null)
    assert.equal(readRelationConfig(one.schema.properties.find((p) => p.id === one.propertyId)!.config)?.synced_property_id, one.propertyId)

    const two = unwrap(
      await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, { name: '다음 작업', targetDataSourceId: tasks.dataSourceId, twoWay: { name: '이전 작업' } }),
    )
    const names = two.schema.properties.filter((p) => p.type === 'relation').map((p) => p.name)
    assert.deepEqual(names, ['관련', '다음 작업', '이전 작업'])
  })

  test('★ 대상이 없거나 볼 수 없으면 같은 답(invalid_target) · 양방향인데 대상 표를 못 고치면 forbidden · 실패하면 아무것도 안 생긴다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const tasks = await newTable('작업')
    const ghost = await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, { name: 'a', targetDataSourceId: randomUUID() })
    assert.equal(ghost.ok === false && ghost.reason, 'invalid_target')
    const malformed = await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, { name: 'a', targetDataSourceId: 'nope' })
    assert.equal(malformed.ok === false && malformed.reason, 'invalid_target')

    // other 는 "작업"은 고칠 수 있고 "비밀"은 못 본다 · "읽기만"은 볼 수만 있다.
    const secret = await newTable('비밀')
    await makePrivate(secret.databaseId)
    const readable = await newTable('읽기만')
    await makePrivate(readable.databaseId, 'view')
    const hidden = await addRelationProperty(other.ctx, tasks.dataSourceId, { name: 'b', targetDataSourceId: secret.dataSourceId })
    assert.equal(hidden.ok === false && hidden.reason, 'invalid_target')
    const hiddenTwoWay = await addRelationProperty(other.ctx, tasks.dataSourceId, { name: 'c', targetDataSourceId: secret.dataSourceId, twoWay: { name: 'x' } })
    assert.equal(hiddenTwoWay.ok === false && hiddenTwoWay.reason, 'invalid_target')
    const oneWay = await addRelationProperty(other.ctx, tasks.dataSourceId, { name: 'd', targetDataSourceId: readable.dataSourceId })
    assert.equal(oneWay.ok, true, '볼 수 있으면 단방향은 된다')
    const twoWay = await addRelationProperty(other.ctx, tasks.dataSourceId, { name: 'e', targetDataSourceId: readable.dataSourceId, twoWay: { name: 'y' } })
    assert.equal(twoWay.ok === false && twoWay.reason, 'forbidden')

    // 역방향 이름이 대상 표의 기존 이름과 겹치면 — 이 표에도 아무것도 안 생긴다(한 트랜잭션).
    const projects = await newTable('프로젝트')
    const dup = await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, { name: 'f', targetDataSourceId: projects.dataSourceId, twoWay: { name: '이름' } })
    assert.equal(dup.ok === false && dup.reason, 'duplicate_name')
    const names = unwrap(await getSchema(fx.owner.ctx, tasks.dataSourceId)).properties.map((p) => p.name)
    assert.deepEqual(names, ['이름', 'd'])
  })
})

describe('② relation 은 셀이 아니다 (C2)', () => {
  test('★ 셀 쓰기로는 거부된다 — 값은 엣지에만 있고 EAV 에는 행이 없다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId } = await tasksAndProjects()
    const task = await tasks.row('T')
    const project = await projects.row('P')
    const viaCell = await updateCells(fx.owner.ctx, task, {
      cells: [{ propertyId: relId, value: { type: 'relation', relation: [{ id: project }] } as never }],
    })
    assert.equal(viaCell.ok === false && viaCell.reason, 'unknown_property')

    unwrap(await linkRows(fx.owner.ctx, task, relId, { add: [project] }))
    const eav = await withReadTransaction((tx) =>
      tx.query(`SELECT 1 FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [task, relId]),
    )
    assert.equal(eav.length, 0)
  })

  test('★ 캐시에 렌더용 배열로 투영된다 — 준 순서대로 · 앞 25개 + 전체 개수', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId } = await tasksAndProjects()
    const task = await tasks.row('T')
    const many: string[] = []
    for (let i = 0; i < 27; i += 1) many.push(await projects.row(`P${String(i).padStart(2, '0')}`))

    const linked = unwrap(await linkRows(fx.owner.ctx, task, relId, { add: many }))
    const value = readRelationValue(linked.properties[relId])
    assert.equal(value.count, 27)
    assert.deepEqual(value.relation.map((r) => r.id), many.slice(0, 25))

    // 셀을 고쳐도(EAV 트리거가 재생성) relation 이 캐시에서 사라지지 않는다 — 두 트리거가 같은 함수를 부른다.
    const retitled = unwrap(
      await updateCells(fx.owner.ctx, task, { cells: [{ propertyId: tasks.titleId, value: { type: 'title', title: [textRun('T2')] } }] }),
    )
    assert.equal(readRelationValue(retitled.properties[relId]).count, 27)
    assert.equal(retitled.title, 'T2')
  })
})

describe('③ 값은 집합이다', () => {
  test('★ 두 사람이 각각 더한 것이 둘 다 남는다 · 같은 것을 또 더해도 하나이고 버전이 오르지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId } = await tasksAndProjects()
    const task = await tasks.row('T')
    const [x, y] = [await projects.row('X'), await projects.row('Y')]
    unwrap(await linkRows(fx.owner.ctx, task, relId, { add: [x] }))
    unwrap(await linkRows(other.ctx, task, relId, { add: [y] }))
    assert.deepEqual(await idsOf(task, relId), [x, y])

    const before = (await relationOf(task, relId)).version
    const again = unwrap(await linkRows(fx.owner.ctx, task, relId, { add: [x], remove: [] }))
    assert.equal(again.version, before, '바뀐 것이 없으면 버전을 올리지 않는다')
    assert.deepEqual(await idsOf(task, relId), [x, y])

    unwrap(await linkRows(fx.owner.ctx, task, relId, { remove: [x, randomUUID()] }))
    assert.deepEqual(await idsOf(task, relId), [y], '없는 연결을 빼는 것은 아무 일도 아니다')
  })

  test('틀린 입력 — uuid 가 아닌 id · 더하면서 빼기 · 상한 초과 · 없는 행 · relation 이 아닌 프로퍼티', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId } = await tasksAndProjects()
    const task = await tasks.row('T')
    const p = await projects.row('P')
    const reasons: (string | false)[] = []
    for (const input of [{ add: ['nope'] }, { add: [p], remove: [p] }, { add: Array.from({ length: MAX_LINKS_PER_REQUEST + 1 }, () => randomUUID()) }]) {
      const r = await linkRows(fx.owner.ctx, task, relId, input)
      reasons.push(r.ok === false && r.reason)
    }
    assert.deepEqual(reasons, ['invalid_value', 'invalid_value', 'invalid_value'])
    const noRow = await linkRows(fx.owner.ctx, randomUUID(), relId, { add: [p] })
    assert.equal(noRow.ok === false && noRow.reason, 'not_found')
    const notRelation = await linkRows(fx.owner.ctx, task, tasks.titleId, { add: [p] })
    assert.equal(notRelation.ok === false && notRelation.reason, 'unknown_property')
  })
})

describe('④ 양방향 — 거울상', () => {
  test('★ 한쪽에서 더하면 반대쪽 칸에 보이고, 반대쪽에서 빼면 이쪽에서도 빠진다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId, backId } = await tasksAndProjects({ twoWay: true })
    const [t1, t2] = [await tasks.row('T1'), await tasks.row('T2')]
    const p = await projects.row('P')

    unwrap(await linkRows(fx.owner.ctx, t1, relId, { add: [p] }))
    unwrap(await linkRows(fx.owner.ctx, t2, relId, { add: [p] }))
    assert.deepEqual(await idsOf(p, backId!), [t1, t2], '프로젝트의 "작업들"에 더한 순서대로')

    unwrap(await linkRows(fx.owner.ctx, p, backId!, { remove: [t1] }))
    assert.deepEqual(await idsOf(t1, relId), [])
    assert.deepEqual(await idsOf(t2, relId), [p])
    assert.deepEqual(await idsOf(p, backId!), [t2])
  })

  test('★ 상대 행의 버전은 올리지 않는다 — 고친 것은 이 행이다(캐시는 따라간다)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId, backId } = await tasksAndProjects({ twoWay: true })
    const t = await tasks.row('T')
    const p = await projects.row('P')
    const before = { t: (await relationOf(t, relId)).version, p: (await relationOf(p, backId!)).version }
    unwrap(await linkRows(fx.owner.ctx, t, relId, { add: [p] }))
    const after = { t: await relationOf(t, relId), p: await relationOf(p, backId!) }
    assert.equal(BigInt(after.t.version), BigInt(before.t) + 1n)
    assert.equal(after.p.version, before.p)
    assert.equal(after.p.count, 1)
  })

  test('★ 같은 표 · 프로퍼티 하나 — A 에 B 를 더하면 B 에도 A 가 보인다 · 자기 자신도 연결된다(엣지 하나)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const tasks = await newTable('작업')
    const rel = unwrap(await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, { name: '관련', targetDataSourceId: tasks.dataSourceId })).propertyId
    const [a, b] = [await tasks.row('A'), await tasks.row('B')]
    unwrap(await linkRows(fx.owner.ctx, a, rel, { add: [b, a] }))
    assert.deepEqual(await idsOf(a, rel), [b, a])
    assert.deepEqual(await idsOf(b, rel), [a])
    const edges = await withReadTransaction((tx) => tx.query(`SELECT 1 FROM relation_edge WHERE property_id = $1`, [rel]))
    assert.equal(edges.length, 3, 'a→b · b→a · a→a')

    unwrap(await linkRows(fx.owner.ctx, b, rel, { remove: [a] }))
    assert.deepEqual(await idsOf(a, rel), [a])
  })
})

describe("⑤ limit: 'one'", () => {
  test('★ 하나를 더하면 그것으로 바뀐다 — 바뀐 연결의 거울상도 빠진다 · 둘을 한 번에 더하면 거부', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId, backId } = await tasksAndProjects({ twoWay: true, limit: 'one' })
    const t = await tasks.row('T')
    const [p1, p2] = [await projects.row('P1'), await projects.row('P2')]
    unwrap(await linkRows(fx.owner.ctx, t, relId, { add: [p1] }))
    unwrap(await linkRows(fx.owner.ctx, t, relId, { add: [p2] }))
    assert.deepEqual(await idsOf(t, relId), [p2])
    assert.deepEqual(await idsOf(p1, backId!), [], '바뀐 프로젝트의 "작업들"에서도 빠진다')
    assert.deepEqual(await idsOf(p2, backId!), [t])

    const two = await linkRows(fx.owner.ctx, t, relId, { add: [p1, p2] })
    assert.equal(two.ok === false && two.reason, 'invalid_value')
    // 역방향은 제한이 없다 — 프로젝트에는 작업을 여럿 더할 수 있다.
    const t2 = await tasks.row('T2')
    unwrap(await linkRows(fx.owner.ctx, p2, backId!, { add: [t2] }))
    assert.deepEqual(await idsOf(p2, backId!), [t, t2])
  })
})

describe('⑥ 더할 수 있는 행', () => {
  test('★ 다른 표의 행 · 휴지통의 행 · 볼 수 없는 표의 행은 전부 같은 답이다(invalid_value)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId } = await tasksAndProjects()
    const task = await tasks.row('T')
    const elsewhere = await (await newTable('딴 표')).row('X')
    const trashed = await projects.row('버린 것')
    unwrap(await trashRow(fx.owner.ctx, trashed))

    for (const id of [elsewhere, trashed, randomUUID()]) {
      const r = await linkRows(fx.owner.ctx, task, relId, { add: [id] })
      assert.equal(r.ok === false && r.reason, 'invalid_value', id)
    }
    // 하나라도 틀리면 아무것도 더하지 않는다.
    const ok = await projects.row('P')
    const mixed = await linkRows(fx.owner.ctx, task, relId, { add: [ok, elsewhere] })
    assert.equal(mixed.ok === false && mixed.reason, 'invalid_value')
    assert.deepEqual(await idsOf(task, relId), [])
  })

  test('★ 권한 — 못 보면 not_found · 볼 수만 있으면 forbidden · 대상 표를 못 보면 그 행은 "연결할 수 없는 행"이다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId } = await tasksAndProjects()
    const task = await tasks.row('T')
    const project = await projects.row('P')

    // 대상 표만 비공개 — other 는 작업은 고칠 수 있지만 그 프로젝트를 볼 수 없다.
    await makePrivate(projects.databaseId)
    const blind = await linkRows(other.ctx, task, relId, { add: [project] })
    assert.equal(blind.ok === false && blind.reason, 'invalid_value')

    await makePrivate(tasks.databaseId, 'view')
    const viewOnly = await linkRows(other.ctx, task, relId, { remove: [project] })
    assert.equal(viewOnly.ok === false && viewOnly.reason, 'forbidden')

    const hiddenTable = await newTable('숨긴 작업')
    const made = unwrap(await addRelationProperty(fx.owner.ctx, hiddenTable.dataSourceId, { name: 'r', targetDataSourceId: hiddenTable.dataSourceId }))
    const hiddenRow = await hiddenTable.row('H')
    await makePrivate(hiddenTable.databaseId)
    const unseen = await linkRows(other.ctx, hiddenRow, made.propertyId, { add: [hiddenRow] })
    assert.equal(unseen.ok === false && unseen.reason, 'not_found')
  })
})

describe('⑦ 읽기가 거른다', () => {
  test('★ 제목과 함께 칸의 순서대로 · 커서로 이어 읽는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId } = await tasksAndProjects()
    const task = await tasks.row('T')
    const ids = [await projects.row('가'), await projects.row('나'), await projects.row('다')]
    unwrap(await linkRows(fx.owner.ctx, task, relId, { add: ids }))

    const first = unwrap(await readRelation(fx.owner.ctx, task, relId, { limit: 2 }))
    assert.deepEqual(first.items.map((i) => i.title), ['가', '나'])
    assert.deepEqual([first.total, first.hidden, first.hasMore], [3, 0, true])
    const rest = unwrap(await readRelation(fx.owner.ctx, task, relId, { limit: 2, cursor: first.nextCursor }))
    assert.deepEqual(rest.items.map((i) => i.title), ['다'])
    assert.equal(rest.hasMore, false)
  })

  test('★ 휴지통에 간 행은 빠지고 복원하면 돌아온다 — 엣지는 지우지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId } = await tasksAndProjects()
    const task = await tasks.row('T')
    const [keep, gone] = [await projects.row('남는 것'), await projects.row('버릴 것')]
    unwrap(await linkRows(fx.owner.ctx, task, relId, { add: [keep, gone] }))
    unwrap(await trashRow(fx.owner.ctx, gone))

    const page = unwrap(await readRelation(fx.owner.ctx, task, relId))
    assert.deepEqual(page.items.map((i) => i.title), ['남는 것'])
    assert.equal(page.total, 2, '엣지는 그대로다 — 캐시의 id 는 걸러지지 않았다')
    assert.equal((await relationOf(task, relId)).count, 2)

    await withTransaction((tx) =>
      tx.query(
        `UPDATE block SET lifecycle = 'live', trashed_at = NULL, trashed_by = NULL, trash_root_id = NULL,
                          purge_after = NULL WHERE id = $1`,
        [gone],
      ),
    )
    const restored = unwrap(await readRelation(fx.owner.ctx, task, relId))
    assert.deepEqual(restored.items.map((i) => i.title), ['남는 것', '버릴 것'])
  })

  test('★ 대상 표를 못 보면 제목 없이 개수만 받는다 — "N개 항목 접근 불가"', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId } = await tasksAndProjects()
    const task = await tasks.row('T')
    unwrap(await linkRows(fx.owner.ctx, task, relId, { add: [await projects.row('비밀 1'), await projects.row('비밀 2')] }))
    await makePrivate(projects.databaseId)

    const page = unwrap(await readRelation(other.ctx, task, relId))
    assert.deepEqual([page.items.length, page.total, page.hidden], [0, 2, 2])
    assert.ok(!JSON.stringify(page).includes('비밀'))
  })

  test('영구 삭제는 양쪽 엣지를 함께 지우고 상대 칸의 캐시가 따라간다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId, backId } = await tasksAndProjects({ twoWay: true })
    const t = await tasks.row('T')
    const [p1, p2] = [await projects.row('P1'), await projects.row('P2')]
    unwrap(await linkRows(fx.owner.ctx, t, relId, { add: [p1, p2] }))
    await withTransaction((tx) => tx.query(`DELETE FROM block WHERE id = $1`, [p1]))
    assert.deepEqual(await idsOf(t, relId), [p2])
    assert.deepEqual(await idsOf(p2, backId!), [t])
  })
})

describe('⑧ DB 가 지킨다 (마이그레이션 0024)', () => {
  test('★ 거울상 없는 엣지는 커밋되지 않는다 — 라이브러리가 빠뜨려도 어긋난 채 남지 않는다(E1)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId } = await tasksAndProjects({ twoWay: true })
    const t = await tasks.row('T')
    const p = await projects.row('P')
    await assert.rejects(
      withTransaction((tx) =>
        tx.query(`INSERT INTO relation_edge (property_id, from_page_id, to_page_id, order_idx) VALUES ($1, $2, $3, 'a0')`, [relId, t, p]),
      ),
      (e: unknown) => (e as { code?: string }).code === '23514',
    )
    assert.deepEqual(await idsOf(t, relId), [])

    // 한쪽만 지우는 것도 마찬가지다.
    unwrap(await linkRows(fx.owner.ctx, t, relId, { add: [p] }))
    await assert.rejects(
      withTransaction((tx) => tx.query(`DELETE FROM relation_edge WHERE property_id = $1 AND from_page_id = $2`, [relId, t])),
      (e: unknown) => (e as { code?: string }).code === '23514',
    )
    assert.deepEqual(await idsOf(t, relId), [p])
  })
})

describe('⑨ 화면이 그릴 것 (relation 5b-1)', () => {
  test('★ 뷰의 컬럼에 relation 이 선다 — 대상 표 · 제한 · 짝이 있는지를 싣고, 셀 컬럼과 타입으로 갈린다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId, backId } = await tasksAndProjects({ twoWay: true, limit: 'one' })
    const view = unwrap(await createView(fx.owner.ctx, tasks.databaseId, { type: 'table' }))
    const column = unwrap(await getView(fx.owner.ctx, view.id)).columns.find((c) => c.propertyId === relId)!
    assert.equal(column.type, 'relation')
    assert.deepEqual(column.type === 'relation' && column.relation, {
      targetDataSourceId: projects.dataSourceId,
      limit: 'one',
      synced: true,
    })
    // 역방향 컬럼은 대상 표의 뷰에 선다 — 제한을 물려받지 않는다.
    const back = unwrap(await createView(fx.owner.ctx, projects.databaseId, { type: 'list' }))
    const backColumn = unwrap(await getView(fx.owner.ctx, back.id)).columns.find((c) => c.propertyId === backId)!
    assert.deepEqual(backColumn.type === 'relation' && backColumn.relation, {
      targetDataSourceId: tasks.dataSourceId,
      limit: 'none',
      synced: true,
    })
  })

  test('★ 제목 맵 — 볼 수 있으면 제목 · 볼 수 없으면 null · 휴지통에 갔으면 키가 없다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const { tasks, projects, relId } = await tasksAndProjects()
    const secrets = await newTable('비밀 표')
    const secretRel = unwrap(
      await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, { name: '비밀', targetDataSourceId: secrets.dataSourceId }),
    ).propertyId
    const task = await tasks.row('T')
    const [seen, untitled, gone] = [await projects.row('보이는 것'), await projects.row(''), await projects.row('버릴 것')]
    const secret = await secrets.row('비밀 제목')
    unwrap(await linkRows(fx.owner.ctx, task, relId, { add: [seen, untitled, gone] }))
    unwrap(await linkRows(fx.owner.ctx, task, secretRel, { add: [secret] }))
    unwrap(await trashRow(fx.owner.ctx, gone))
    await makePrivate(secrets.databaseId)

    // 화면이 하는 대로: 행의 캐시에서 id 를 모아 한 번에 묻는다.
    const page = unwrap(await queryRows(other.ctx, tasks.dataSourceId, { filter: null, sorts: [] }))
    const ids = relationIdsIn(page.rows, [relId, secretRel])
    assert.deepEqual([...ids].sort(), [seen, untitled, gone, secret].sort(), '캐시의 id 는 걸러지지 않았다')

    const labels = await loadRelationLabels(other.ctx, ids)
    assert.equal(labels[seen], '보이는 것')
    assert.equal(labels[untitled], '', '제목이 빈 행은 빈 문자열이다 — 화면이 "제목 없음"을 고른다')
    assert.equal(labels[secret], null, '살아 있지만 볼 수 없다')
    assert.equal(gone in labels, false, '휴지통에 간 행은 키가 없다 — "볼 수 없는 연결"로 세지 않는다')
    assert.ok(!JSON.stringify(labels).includes('비밀 제목'))

    // 소유자는 비밀 표의 제목도 본다.
    assert.equal((await loadRelationLabels(fx.owner.ctx, ids))[secret], '비밀 제목')
  })

  test('제목 맵은 이 워크스페이스의 **행**만 답한다 — 없는 id · uuid 가 아닌 값 · 일반 페이지는 키가 없다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const tasks = await newTable('작업')
    const row = await tasks.row('행')
    const labels = await loadRelationLabels(fx.owner.ctx, [row, randomUUID(), 'nope', tasks.databaseId])
    assert.deepEqual(labels, { [row]: '행' })
    assert.deepEqual(await loadRelationLabels(fx.owner.ctx, []), {})
  })
})
