/**
 * 고친 행이 아직 이 뷰에 서는가 — §7 정리 10n-16 (F-04-24 · F-04-03)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 고친 카드가 뷰의 조건 밖으로 나가면
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 필터 밖으로 고치면 거짓 · 안이면 참
 *   ② ★ 판정은 그 사람이 실제로 보는 필터다 — 개인 필터가 공유 필터를 대체한다
 *   ③ 뷰 검색어도 판정에 들어간다(다듬은 값으로)
 *   ④ ★ 수식 필터는 고친 값으로 다시 계산한 뒤 판정한다(행 질의가 파생 값을 먼저 채운다)
 *   ⑤ 판정할 수 없으면 null — 다른 data source 의 뷰 · 볼 수 없는 뷰
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { getSchema } from './property.ts'
import { createRow, updateCells } from './row.ts'
import { createView, setPersonalView, updateView } from './view.ts'
import { addFormulaProperty } from './formula-property.ts'
import { rowStandsInView } from './row-in-view.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let mate: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  mate = await joinAs(fx.workspaceId, await createUser('동료'), 'member')
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

type Table = { databaseId: string; dataSourceId: string; titleId: string; viewId: string; row: (title: string) => Promise<string>; rename: (id: string, title: string) => Promise<void> }

async function newTable(name: string): Promise<Table> {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = created.dataSourceId
  const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  const title = (text: string) => [{ propertyId: titleId, value: { type: 'title' as const, title: [textRun(text)] } }]
  return {
    databaseId: created.id,
    dataSourceId: ds,
    titleId,
    viewId: created.defaultViewId,
    row: async (text) => unwrap(await createRow(fx.owner.ctx, ds, { cells: title(text) })).id,
    rename: async (id, text) => void unwrap(await updateCells(fx.owner.ctx, id, { cells: title(text) })),
  }
}

const titleContains = (t: Table, value: string) => ({ property_id: t.titleId, operator: 'contains', value })

describe('고친 행이 아직 이 뷰에 서는가 (10n-16)', () => {
  test('★ ① 필터 밖으로 고치면 거짓 · 안이면 참', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('판정 표')
    unwrap(await updateView(fx.owner.ctx, table.viewId, { filter: titleContains(table, '긴급') }))
    const row = await table.row('긴급 보고')
    await table.row('긴급 다른 일') // 필터 안에 남는 행 — 판정은 그 행 하나만 본다
    assert.equal(await rowStandsInView(fx.owner.ctx, table.viewId, row), true)
    await table.rename(row, '보통 보고')
    assert.equal(await rowStandsInView(fx.owner.ctx, table.viewId, row), false, '다른 행이 필터 안에 있어도 그 행은 밖')
  })

  test('★ ② 판정은 그 사람이 실제로 보는 필터다 — 개인 필터가 공유 필터를 대체한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('개인 필터 표')
    unwrap(await updateView(fx.owner.ctx, table.viewId, { filter: titleContains(table, '긴급') }))
    unwrap(await setPersonalView(mate.ctx, table.viewId, { filter: titleContains(table, '보고') }))
    const row = await table.row('보통 보고')
    assert.equal(await rowStandsInView(fx.owner.ctx, table.viewId, row), false, '소유자의 공유 필터로는 밖')
    assert.equal(await rowStandsInView(mate.ctx, table.viewId, row), true, '동료의 개인 필터로는 안')
  })

  test('③ 뷰 검색어도 판정에 들어간다(다듬은 값으로)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('검색 표')
    const row = await table.row('예산 검토')
    assert.equal(await rowStandsInView(fx.owner.ctx, table.viewId, row, '  예산 '), true)
    assert.equal(await rowStandsInView(fx.owner.ctx, table.viewId, row, '출장'), false)
    assert.equal(await rowStandsInView(fx.owner.ctx, table.viewId, row, 42), true, '문자열이 아니면 검색어가 없는 것')
  })

  test('★ ④ 수식 필터는 고친 값으로 다시 계산한 뒤 판정한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('수식 표')
    const label = unwrap(await addFormulaProperty(fx.owner.ctx, table.dataSourceId, { name: '표시', expression: 'prop("이름") + "!"' })).propertyId
    unwrap(await updateView(fx.owner.ctx, table.viewId, { filter: { property_id: label, operator: 'contains', value: '긴급!' } }))
    const row = await table.row('긴급')
    assert.equal(await rowStandsInView(fx.owner.ctx, table.viewId, row), true)
    await table.rename(row, '보통')
    assert.equal(await rowStandsInView(fx.owner.ctx, table.viewId, row), false, '파생 값을 다시 계산했다')
  })

  test('⑤ 판정할 수 없으면 null — 다른 data source 의 뷰 · 볼 수 없는 뷰', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const a = await newTable('가 표')
    const b = await newTable('나 표')
    const row = await a.row('행')
    assert.equal(await rowStandsInView(fx.owner.ctx, b.viewId, row), null, '다른 data source 의 뷰')

    const secret = await newTable('비밀 표')
    const hidden = await secret.row('비밀 행')
    assert.equal((await stopInheriting(fx.owner.ctx, secret.databaseId)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, secret.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, secret.databaseId, { type: 'workspace_everyone', id: null })).ok, true)
    assert.equal(await rowStandsInView(mate.ctx, secret.viewId, hidden), null, '볼 수 없는 뷰')
    assert.equal(await rowStandsInView(fx.owner.ctx, secret.viewId, hidden), true)
    const another = unwrap(await createView(fx.owner.ctx, a.databaseId, { type: 'gallery' }))
    assert.equal(await rowStandsInView(fx.owner.ctx, another.id, row), true, '같은 data source 의 다른 뷰')
  })
})
