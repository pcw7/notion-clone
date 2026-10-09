/**
 * 이 속성을 읽는 수식 · 롤업 — 2j-1조각 (F-03-13, DB 필요)
 *
 *   ① 수식 — 바로 읽는 것만(그것을 다시 읽는 수식은 빈 값을 받을 뿐이다) · 지운 수식은 없다
 *   ② 롤업 — 이 표의 relation 을 타는 롤업(같은 표) · 이 속성을 모으는 롤업(**다른 표** — 그 표의 이름과 함께)
 *   ③ 다른 표를 볼 수 없으면 이름 없이 개수만(`hidden`) · 휴지통의 표의 롤업은 세지도 않는다
 *   ④ 표를 볼 수 없거나 속성이 없으면 없는 것과 같은 답
 *   ⑤ 순서 — 이 표의 것이 먼저(속성 순서) · 다른 표는 이름순
 *
 * 반사실(HANDOFF §3.3): 다른 표의 권한을 안 보면 ③ 의 이름이 새고, 표의 수명을 안 보면 ③ 의 휴지통이 "볼 수 없음"으로 세어진다.
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createDatabase } from './database.ts'
import { addProperty, deleteProperty, getSchema } from './property.ts'
import type { MvpPropertyType } from './property-types.ts'
import { addRelationProperty } from './relation.ts'
import { addRollupProperty } from './rollup.ts'
import { addDataSource, trashDataSource } from './data-source.ts'
import { addFormulaProperty } from './formula-property.ts'
import { listPropertyDependents } from './property-dependents.ts'

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

async function table(name: string) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = created.dataSourceId
  return {
    databaseId: created.id,
    ds,
    prop: async (propName: string, type: MvpPropertyType) =>
      unwrap(await addProperty(fx.owner.ctx, ds, { name: propName, type })).properties.find((p) => p.name === propName)!.id,
    formula: async (propName: string, expression: string) => unwrap(await addFormulaProperty(fx.owner.ctx, ds, { name: propName, expression })).propertyId,
  }
}

/** 작업(시간) → 프로젝트. 프로젝트 표에 역방향 "작업들"과 그것을 타는 롤업 "총 시간". */
async function world(projectsName = '프로젝트') {
  const tasks = await table('작업')
  const projects = await table(projectsName)
  const hours = await tasks.prop('시간', 'number')
  const made = unwrap(
    await addRelationProperty(fx.owner.ctx, tasks.ds, { name: '프로젝트', targetDataSourceId: projects.ds, twoWay: { name: '작업들' } }),
  )
  const back = made.syncedPropertyId!
  const total = unwrap(
    await addRollupProperty(fx.owner.ctx, projects.ds, { name: '총 시간', relationPropertyId: back, targetPropertyId: hours, function: 'sum' }),
  ).propertyId
  return { tasks, projects, hours, back, total }
}

const listed = async (ds: string, propertyId: string, actor: Actor = fx.owner) => unwrap(await listPropertyDependents(actor.ctx, ds, propertyId))
const names = (value: { dependents: readonly { name: string; type: string; tableName: string | null }[] }) =>
  value.dependents.map((d) => `${d.type}:${d.name}${d.tableName === null ? '' : `@${d.tableName}`}`)

describe('① 수식', () => {
  test('★ 바로 읽는 수식만 — 그것을 다시 읽는 수식은 아니다 · 지운 수식은 없다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table('수식 의존')
    const qty = await t.prop('수량', 'number')
    const price = await t.prop('단가', 'number')
    await t.formula('금액', 'prop("수량") * prop("단가")')
    await t.formula('두 배 금액', 'prop("금액") * 2') // 수량을 바로 읽지 않는다
    const gone = await t.formula('지울 것', 'prop("수량") + 1')
    unwrap(await deleteProperty(fx.owner.ctx, t.ds, gone))

    assert.deepEqual(names(await listed(t.ds, qty)), ['formula:금액'])
    assert.deepEqual(names(await listed(t.ds, price)), ['formula:금액'])
    assert.deepEqual(await listed(t.ds, await t.prop('메모', 'rich_text')), { dependents: [], hidden: 0 })
  })
})

describe('② 롤업', () => {
  test('★ 이 표의 relation 을 타는 롤업(같은 표) · 이 속성을 모으는 롤업(다른 표 — 그 표 이름과 함께)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    assert.deepEqual(names(await listed(w.projects.ds, w.back)), ['rollup:총 시간'], 'relation 을 지우면 그것을 타는 롤업이 끊긴다')
    assert.deepEqual(names(await listed(w.tasks.ds, w.hours)), ['rollup:총 시간@프로젝트'], '다른 표의 롤업이 이 속성을 모은다')
  })
})

describe('③ 권한 · 휴지통', () => {
  test('★ 다른 표를 볼 수 없으면 이름 없이 개수만 — 이 표의 수식은 그대로 보인다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world('기밀 프로젝트')
    await w.tasks.formula('시간 두 배', 'prop("시간") * 2')
    // 프로젝트 표를 소유자만 보게 — 다른 멤버는 작업 표만 본다
    assert.equal((await stopInheriting(fx.owner.ctx, w.projects.databaseId)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, w.projects.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, w.projects.databaseId, { type: 'workspace_everyone', id: null })).ok, true)

    const seen = await listed(w.tasks.ds, w.hours, other)
    assert.deepEqual(names(seen), ['formula:시간 두 배'])
    assert.equal(seen.hidden, 1, '볼 수 없는 표의 롤업 하나')
    assert.ok(!JSON.stringify(seen).includes('총 시간') && !JSON.stringify(seen).includes('기밀'), '이름이 새지 않는다')
    assert.deepEqual(names(await listed(w.tasks.ds, w.hours)), ['formula:시간 두 배', 'rollup:총 시간@기밀 프로젝트'], '볼 수 있는 사람에게는 이름')
  })

  test('★ 휴지통의 표의 롤업은 세지도 않는다("볼 수 없음"으로 읽히면 안 된다)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const tasks = await table('작업')
    const hours = await tasks.prop('시간', 'number')
    const projects = await table('두 소스 프로젝트')
    // 소스가 둘인 데이터베이스 — 두 번째 소스만 휴지통에 넣는다(마지막 소스는 넣을 수 없다)
    const second = unwrap(await addDataSource(fx.owner.ctx, projects.databaseId, { name: '보관' })).dataSource.id
    const made = unwrap(await addRelationProperty(fx.owner.ctx, tasks.ds, { name: '보관 프로젝트', targetDataSourceId: second, twoWay: { name: '작업들' } }))
    unwrap(await addRollupProperty(fx.owner.ctx, second, { name: '보관 합', relationPropertyId: made.syncedPropertyId!, targetPropertyId: hours, function: 'sum' }))
    assert.deepEqual(names(await listed(tasks.ds, hours)), ['rollup:보관 합@두 소스 프로젝트'])

    unwrap(await trashDataSource(fx.owner.ctx, second))
    assert.deepEqual(await listed(tasks.ds, hours), { dependents: [], hidden: 0 })
  })
})

describe('④ 없는 것과 같은 답', () => {
  test('표를 볼 수 없다 · 다른 표의 속성 · 지운 속성 · 없는 속성', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table('숨은 표')
    const qty = await t.prop('수량', 'number')
    const elsewhere = await table('다른 표')
    const otherProp = await elsewhere.prop('값', 'number')
    const gone = await t.prop('지운 것', 'number')
    unwrap(await deleteProperty(fx.owner.ctx, t.ds, gone))

    for (const [ds, id] of [[t.ds, otherProp], [t.ds, gone], [t.ds, 'no-such-property']] as const) {
      const r = await listPropertyDependents(fx.owner.ctx, ds, id)
      assert.equal(r.ok === false && r.reason, 'not_found', id)
    }
    assert.equal((await stopInheriting(fx.owner.ctx, t.databaseId)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, t.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, t.databaseId, { type: 'workspace_everyone', id: null })).ok, true)
    const hiddenTable = await listPropertyDependents(other.ctx, t.ds, qty)
    assert.equal(hiddenTable.ok === false && hiddenTable.reason, 'not_found')
  })
})

describe('⑤ 순서', () => {
  test('이 표의 것이 먼저(속성 순서) · 다른 표는 이름순', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const tasks = await table('작업')
    const hours = await tasks.prop('시간', 'number')
    await tasks.formula('나중 수식', 'prop("시간") + 2')
    for (const tableName of ['나 표', '가 표']) {
      const p = await table(tableName)
      const made = unwrap(await addRelationProperty(fx.owner.ctx, tasks.ds, { name: `→ ${tableName}`, targetDataSourceId: p.ds, twoWay: { name: '작업들' } }))
      unwrap(await addRollupProperty(fx.owner.ctx, p.ds, { name: '합', relationPropertyId: made.syncedPropertyId!, targetPropertyId: hours, function: 'sum' }))
    }
    await tasks.formula('먼저 수식', 'prop("시간") + 1')
    const schema = unwrap(await getSchema(fx.owner.ctx, tasks.ds))
    assert.ok(schema.properties.findIndex((p) => p.name === '나중 수식') < schema.properties.findIndex((p) => p.name === '먼저 수식'))
    assert.deepEqual(names(await listed(tasks.ds, hours)), ['formula:나중 수식', 'formula:먼저 수식', 'rollup:합@가 표', 'rollup:합@나 표'])
  })
})
