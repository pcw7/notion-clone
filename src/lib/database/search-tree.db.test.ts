/**
 * 검색 중 하위 항목 트리 (22번 트랙 H-1 · F-04-27 · F-04-22, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 뷰 검색 ⑧
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 층마다 맞은 행과 맞은 자손을 가진 행 — 맞은 손자의 조상 사슬이 최상위 · 자식 · 손자 층에 선다. 행마다 `treeMatch`(스스로
 *        맞았는가 · 아래에 맞은 행이 있는가) · 맞은 것이 없는 행은 서지 않는다(자식이 있어도)
 *   ② ★ 사슬은 읽을 수 있는 살아 있는 행으로 — 가운데 행이 필터에 걸려도 회색으로 선다(P-1 이 바꿨다 — 처음엔 사슬이 끊겼다)
 *   ③ 휴지통 부모에서 멈춘다 — 그 자식이 최상위로 서고(스스로 맞으면) 휴지통 부모의 조상은 맥락 행이 아니다
 *   ④ 맞춤을 묻지 않으면(부모만 그리는 뷰) 예전 그대로 — 맞은 최상위 행만 · `treeMatch` 가 없다
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { getSchema } from './property.ts'
import { createRow, trashRow } from './row.ts'
import { queryRows } from './query.ts'
import { linkRows } from './relation.ts'
import { enableSubItems } from './sub-items.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
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

type Extra = Partial<Parameters<typeof queryRows>[2]>

/**
 * 프로젝트 ─ 설계 ─ 보고서 초안(맞음) · 보고 체계(맞음) ─ 회의 · 예산. 검색어는 "보고".
 * `level(under)` 은 그 층의 [제목, 맞았는가, 아래에 맞은 행이 있는가].
 */
async function forest(name: string) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = created.dataSourceId
  const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  const { parentPropertyId } = unwrap(await enableSubItems(fx.owner.ctx, ds))
  const row = async (title: string, parent?: string) => {
    const id = unwrap(await createRow(fx.owner.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] })).id
    if (parent !== undefined) unwrap(await linkRows(fx.owner.ctx, id, parentPropertyId, { add: [parent] }))
    return id
  }
  const project = await row('프로젝트')
  const design = await row('설계', project)
  const draft = await row('보고서 초안', design)
  const system = await row('보고 체계')
  await row('회의', system)
  await row('예산')
  const level = async (under: string | null, extra: Extra = {}) =>
    unwrap(
      await queryRows(fx.owner.ctx, ds, {
        tree: { parentPropertyId, under },
        search: '보고',
        treeScope: { parentPropertyId, scope: 'both' },
        ...extra,
      }),
    ).rows.map((r) => [r.title, r.treeMatch?.matched, r.treeMatch?.below])
  return { ds, titleId, parentPropertyId, project, design, draft, system, level }
}

describe('① 층마다 맞은 행과 맞은 자손을 가진 행', () => {
  test('★ 맞은 손자의 조상 사슬이 층마다 선다 · 맞은 것이 없는 행은 서지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('검색 트리 ①')
    assert.deepEqual(await f.level(null), [
      ['프로젝트', false, true],
      ['보고 체계', true, false],
    ], '최상위 — 프로젝트는 맥락 행 · 예산은 서지 않는다')
    assert.deepEqual(await f.level(f.project), [['설계', false, true]], '자식 층 — 설계도 맥락 행')
    assert.deepEqual(await f.level(f.design), [['보고서 초안', true, false]], '손자 층 — 맞은 행')
    assert.deepEqual(await f.level(f.system), [], '맞은 행의 자식이라도 맞지 않으면 서지 않는다')
  })
})

describe('② 사슬은 읽을 수 있는 살아 있는 행으로', () => {
  test('★ 가운데 행이 필터에 걸려도 회색으로 선다(P-1 — 필터의 조상 강제 포함)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('검색 트리 ②')
    const filter = { property_id: f.titleId, operator: 'does_not_equal', value: '설계' } as const
    assert.deepEqual(await f.level(null, { filter }), [
      ['프로젝트', false, true],
      ['보고 체계', true, false],
    ])
    assert.deepEqual(await f.level(f.project, { filter }), [['설계', false, true]], '설계는 필터에 걸렸지만 맞은 손자의 맥락 행')
    assert.deepEqual(await f.level(f.design, { filter }), [['보고서 초안', true, false]])
  })
})

describe('③ 휴지통 부모에서 멈춘다', () => {
  test('휴지통 부모의 자식은 최상위로 서고, 그 위의 조상은 맥락 행이 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('검색 트리 ③')
    unwrap(await trashRow(fx.owner.ctx, f.design))
    const top = (await f.level(null)).map((r) => JSON.stringify(r)).sort()
    assert.deepEqual(top, [JSON.stringify(['보고 체계', true, false]), JSON.stringify(['보고서 초안', true, false])].sort())
  })
})

describe('④ 맞춤을 묻지 않으면 예전 그대로', () => {
  test('맞은 최상위 행만 · treeMatch 가 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('검색 트리 ④')
    const rows = unwrap(await queryRows(fx.owner.ctx, f.ds, { tree: { parentPropertyId: f.parentPropertyId, under: null }, search: '보고' })).rows
    assert.deepEqual(rows.map((r) => [r.title, r.treeMatch]), [['보고 체계', undefined]])
  })
})
