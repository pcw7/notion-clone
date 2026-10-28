/**
 * 그룹의 순서 — 오름 · 내림 (그룹 순서 트랙 S-1 · 04 F-04-11)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] `view.group_by` 의 [보강 S-1]
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 날짜 · 숫자 · 글 그룹 — 내림이면 거꾸로 · 값 없음은 그래도 맨 앞 · 오름은 저장하지 않는다(없음과 같다)
 *   ② ★ 가로줄(하위 그룹)도 같은 규칙
 *   ③ 선택 · 상태 · 체크박스에는 받지 않는다(옵션 순서 — 뷰별 `group_order` 를 두지 않는다) · 모르는 값도
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import { createRow } from './row.ts'
import { createView, getView, updateView } from './view.ts'
import { queryGroups } from './group.ts'
import { convertProperty } from './property-convert.ts'

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

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

/** 행 넷 — 마감(1월 · 3월 · 2월 · 없음) · 점수(5 · 25 · 15 · 없음) · 메모(나 · 가 · 다 · 없음) · 단계(선택 — 하나 · 둘). */
async function world() {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `그룹 순서 ${Date.now()}` }))
  const ds = created.dataSourceId
  for (const [name, type] of [['마감', 'date'], ['점수', 'number'], ['메모', 'rich_text'], ['단계', 'select'], ['완료', 'checkbox']] as const) {
    unwrap(await addProperty(fx.owner.ctx, ds, { name, type }))
  }
  const schema = unwrap(await getSchema(fx.owner.ctx, ds))
  const id = (name: string) => schema.properties.find((p) => p.name === name)!.id
  const [titleId, due, score, memo, step, done] = [schema.properties.find((p) => p.type === 'title')!.id, id('마감'), id('점수'), id('메모'), id('단계'), id('완료')]
  const one = unwrap(await addSelectOption(fx.owner.ctx, ds, step, { name: '하나' })).option.id
  const two = unwrap(await addSelectOption(fx.owner.ctx, ds, step, { name: '둘' })).option.id
  const rows: readonly [string, string | null, number | null, string | null, string][] = [
    ['A', '2026-01-10', 5, '나', one],
    ['B', '2026-03-10', 25, '가', two],
    ['C', '2026-02-10', 15, '다', one],
    ['D', null, null, null, two],
  ]
  for (const [title, date, n, text, option] of rows) {
    unwrap(
      await createRow(fx.owner.ctx, ds, {
        cells: [
          { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
          ...(date === null ? [] : [{ propertyId: due, value: { type: 'date' as const, date: { start: date } } }]),
          ...(n === null ? [] : [{ propertyId: score, value: { type: 'number' as const, number: n } }]),
          ...(text === null ? [] : [{ propertyId: memo, value: { type: 'rich_text' as const, rich_text: [textRun(text)] } }]),
          { propertyId: step, value: { type: 'select', select: { id: option } } },
        ],
      }),
    )
  }
  const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'board', groupBy: { property_id: due } }))
  const keysOf = async () => unwrap(await queryGroups(fx.owner.ctx, view.id)).groups.map((g) => g.key)
  return { ds, viewId: view.id, due, score, memo, step, done, one, two, keysOf }
}

describe('① 데이터에서 나온 그룹', () => {
  test('★ 날짜 — 내림이면 3월 · 2월 · 1월 · 값 없음은 맨 앞 · 오름은 저장하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.deepEqual(await w.keysOf(), ['', '2026-01-01', '2026-02-01', '2026-03-01'], '없으면 오름')
    const saved = unwrap(await updateView(fx.owner.ctx, w.viewId, { groupBy: { property_id: w.due, sort: 'descending' } }))
    assert.deepEqual(saved.groupBy, { property_id: w.due, sort: 'descending' })
    assert.deepEqual(await w.keysOf(), ['', '2026-03-01', '2026-02-01', '2026-01-01'])
    const back = unwrap(await updateView(fx.owner.ctx, w.viewId, { groupBy: { property_id: w.due, sort: 'ascending' } }))
    assert.deepEqual(back.groupBy, { property_id: w.due }, '오름은 없음과 같다 — 저장하지 않는다')
    assert.deepEqual(await w.keysOf(), ['', '2026-01-01', '2026-02-01', '2026-03-01'])
  })

  test('★ 숫자 · 글 · 상대 날짜도 — 내림이면 거꾸로(숫자는 수의 차례 · 글은 한국어 차례를 뒤집는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    unwrap(await updateView(fx.owner.ctx, w.viewId, { groupBy: { property_id: w.score, sort: 'descending' } }))
    assert.deepEqual(await w.keysOf(), ['', '20', '10', '0'])
    unwrap(await updateView(fx.owner.ctx, w.viewId, { groupBy: { property_id: w.memo, sort: 'descending' } }))
    assert.deepEqual(await w.keysOf(), ['', '다', '나', '가'])
    unwrap(await updateView(fx.owner.ctx, w.viewId, { groupBy: { property_id: w.due, date_unit: 'year', sort: 'descending' } }))
    assert.deepEqual(await w.keysOf(), ['', '2026-01-01'], '단위와 함께')
  })
})

describe('② 가로줄', () => {
  test('★ 하위 그룹도 같은 규칙 — 내림이면 가로줄이 거꾸로 · 값 없음이 맨 위', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    unwrap(await updateView(fx.owner.ctx, w.viewId, { groupBy: { property_id: w.step }, subGroupBy: { property_id: w.score, sort: 'descending' } }))
    assert.deepEqual((await getView(fx.owner.ctx, w.viewId)).ok, true)
    const page = unwrap(await queryGroups(fx.owner.ctx, w.viewId))
    assert.deepEqual(page.sub?.groups.map((l) => l.key), ['', '20', '10', '0'])
    assert.deepEqual(page.groups.map((g) => g.key), ['', w.one, w.two], '열은 옵션 순서 그대로')
  })
})

describe('③ 받지 않는 곳', () => {
  test('선택 · 체크박스에는 받지 않는다(옵션 순서) · 모르는 값도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.equal((await updateView(fx.owner.ctx, w.viewId, { groupBy: { property_id: w.step, sort: 'descending' } })).ok, false, '선택')
    assert.equal((await updateView(fx.owner.ctx, w.viewId, { groupBy: { property_id: w.done, sort: 'descending' } })).ok, false, '체크박스')
    assert.equal((await updateView(fx.owner.ctx, w.viewId, { groupBy: { property_id: w.due, sort: 'sideways' } })).ok, false, '모르는 값')
    assert.equal((await updateView(fx.owner.ctx, w.viewId, { subGroupBy: { property_id: w.step, sort: 'descending' } })).ok, false, '가로줄도')
    assert.deepEqual(await w.keysOf(), ['', '2026-01-01', '2026-02-01', '2026-03-01'], '아무것도 바뀌지 않았다')
  })

  test('★ 타입을 바꾼 뒤 — 뷰는 그 타입의 키만 보여 주고(낡은 단위 · 순서가 빠진다) 그것에 얹은 저장이 걸리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    unwrap(await updateView(fx.owner.ctx, w.viewId, { groupBy: { property_id: w.due, date_unit: 'week', week_start: 'sunday', sort: 'descending' } }))
    unwrap(await convertProperty(fx.owner.ctx, w.ds, w.due, { type: 'rich_text' }))
    const view = unwrap(await getView(fx.owner.ctx, w.viewId))
    assert.deepEqual(view.groupBy, { property_id: w.due, sort: 'descending' }, '글에도 순서는 있다 — 날짜의 단위 · 주의 시작만 빠진다')
    // 화면이 하듯 지금 설정에 얹어 저장한다(빈 그룹 숨기기)
    const saved = unwrap(await updateView(fx.owner.ctx, w.viewId, { groupBy: { ...view.groupBy!, hide_empty: true } }))
    assert.deepEqual(saved.groupBy, { property_id: w.due, hide_empty: true, sort: 'descending' })
    unwrap(await convertProperty(fx.owner.ctx, w.ds, w.due, { type: 'select' }))
    assert.deepEqual(unwrap(await getView(fx.owner.ctx, w.viewId)).groupBy, { property_id: w.due, hide_empty: true }, '선택이면 순서도 빠진다(옵션 순서)')
  })
})
