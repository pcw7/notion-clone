/**
 * 옮긴 카드가 보드의 조건 밖으로 나가면 — §7 정리 10n-15 (F-04-03 · F-04-24)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 옮긴 카드가 보드의 조건 밖으로 나가면
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 이동의 답이 "아직 이 보드에 서는가"(`inView`)를 싣는다 — 필터 밖으로 옮기면 거짓 · 안이면 참 · 셀은 그래도 바뀐다
 *   ② ★ 판정은 옮긴 사람이 실제로 보는 필터다 — 개인 필터가 있으면 그것(공유 필터를 대체한다)
 *   ③ 화면이 보낸 뷰 검색어도 판정에 들어간다 — 이동 자체에는 상관없다
 *   ④ 정렬된 보드(자리를 쓰지 않는다)에서도 같다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import { createRow, type RowSummary } from './row.ts'
import { createView, setPersonalView, updateView } from './view.ts'
import { moveRow, queryGroups } from './group.ts'

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

type Board = {
  viewId: string
  statusId: string
  titleId: string
  todo: string
  doing: string
  done: string
  row: (title: string, status: string) => Promise<RowSummary>
}

/** 상태(select · 할 일 · 진행 중 · 완료)로 묶인 보드. */
async function newBoard(): Promise<Board> {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: '이동 판정 보드' }))
  const ds = created.dataSourceId
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '상태', type: 'select' }))
  const schema = unwrap(await getSchema(fx.owner.ctx, ds))
  const statusId = schema.properties.find((p) => p.name === '상태')!.id
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const opt = async (name: string) => unwrap(await addSelectOption(fx.owner.ctx, ds, statusId, { name })).option.id
  const todo = await opt('할 일')
  const doing = await opt('진행 중')
  const done = await opt('완료')
  const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'board' }))
  return {
    viewId: view.id,
    statusId,
    titleId,
    todo,
    doing,
    done,
    row: async (title, status) =>
      unwrap(
        await createRow(fx.owner.ctx, ds, {
          cells: [
            { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
            { propertyId: statusId, value: { type: 'select', select: { id: status } } },
          ],
        }),
      ),
  }
}

const notDone = (b: Board) => ({ property_id: b.statusId, operator: 'does_not_equal', value: b.done })

describe('옮긴 카드가 보드의 조건 밖으로 나가면 (10n-15)', () => {
  test('★ ① 필터 밖으로 옮기면 inView 거짓 · 안이면 참 · 셀은 그래도 바뀐다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await newBoard()
    unwrap(await updateView(fx.owner.ctx, b.viewId, { filter: notDone(b) }))
    const card = await b.row('보고서 쓰기', b.todo)

    const inside = unwrap(await moveRow(fx.owner.ctx, b.viewId, { rowId: card.id, groupKey: b.doing }))
    assert.equal(inside.inView, true, '진행 중은 필터 안')
    const outside = unwrap(await moveRow(fx.owner.ctx, b.viewId, { rowId: card.id, groupKey: b.done }))
    assert.equal(outside.inView, false, '완료는 필터 밖')
    assert.equal(outside.groupKey, b.done, '그래도 옮겨진다')
    const page = unwrap(await queryGroups(fx.owner.ctx, b.viewId))
    assert.ok(!page.groups.some((g) => g.rows.some((r) => r.id === card.id)), '다음 읽기에는 없다(판정과 같은 답)')
  })

  test('★ ② 판정은 옮긴 사람이 실제로 보는 필터다 — 개인 필터가 공유 필터를 대체한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await newBoard()
    unwrap(await updateView(fx.owner.ctx, b.viewId, { filter: notDone(b) }))
    // 동료는 개인 필터로 "할 일만" 본다 — 공유 필터(완료가 아닌 것)를 대체한다
    unwrap(await setPersonalView(mate.ctx, b.viewId, { filter: { property_id: b.statusId, operator: 'equals', value: b.todo } }))
    const card = await b.row('회의 준비', b.todo)

    const mine = unwrap(await moveRow(fx.owner.ctx, b.viewId, { rowId: card.id, groupKey: b.doing }))
    assert.equal(mine.inView, true, '소유자의 공유 필터로는 안')
    unwrap(await moveRow(fx.owner.ctx, b.viewId, { rowId: card.id, groupKey: b.todo }))
    const theirs = unwrap(await moveRow(mate.ctx, b.viewId, { rowId: card.id, groupKey: b.doing }))
    assert.equal(theirs.inView, false, '동료의 개인 필터로는 밖')
    const back = unwrap(await moveRow(mate.ctx, b.viewId, { rowId: card.id, groupKey: b.todo }))
    assert.equal(back.inView, true)
  })

  test('③ 화면이 보낸 뷰 검색어도 판정에 들어간다 — 이동 자체에는 상관없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await newBoard()
    const card = await b.row('예산 검토', b.todo)
    const matched = unwrap(await moveRow(fx.owner.ctx, b.viewId, { rowId: card.id, groupKey: b.doing, search: '예산' }))
    assert.equal(matched.inView, true, '검색어에 맞는다')
    const missed = unwrap(await moveRow(fx.owner.ctx, b.viewId, { rowId: card.id, groupKey: b.todo, search: '출장' }))
    assert.deepEqual([missed.inView, missed.groupKey], [false, b.todo], '검색어에 안 맞아도 옮겨진다')
    const plain = unwrap(await moveRow(fx.owner.ctx, b.viewId, { rowId: card.id, groupKey: b.doing }))
    assert.equal(plain.inView, true, '검색어가 없으면 필터만')
  })

  test('④ 정렬된 보드에서도 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await newBoard()
    unwrap(await updateView(fx.owner.ctx, b.viewId, { filter: notDone(b), sorts: [{ property_id: b.titleId, direction: 'asc' }] }))
    const card = await b.row('정리', b.todo)
    const out = unwrap(await moveRow(fx.owner.ctx, b.viewId, { rowId: card.id, groupKey: b.done }))
    assert.deepEqual([out.positioned, out.inView], [false, false], '자리를 쓰지 않고 · 필터 밖')
  })
})
