/**
 * rollup — rollup 5c-1조각 (F-03-11, DB 필요)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 만들기 — relation 은 **이 표의** 것, 대상은 **그 대상 표의 셀 타입**, 함수는 그 타입이 고를 수 있는 것.
 *      아니면 거부하고 **아무것도 남기지 않는다**. 대상 표를 못 보면 없는 것과 같은 답이다
 *   ② rollup 은 셀이 아니다 — 셀 쓰기로 거부되고, config 는 통째로 덮어쓸 수 없다(relation 도)
 *   ③ 계산 — 행 묶음에 대해 한 번. 엣지 케이스 표(연결 0개 · null 섞임)가 DB 를 지나서도 맞다
 *   ④ **권한 · 휴지통은 집계 안에서 거른다** — 볼 수 없는 행은 빠지고 `hidden` 으로 세어진다. 값도 옵션 이름도 새지 않는다
 *   ⑤ 설정이 끊겨도 rollup 은 남는다 — 지우면 `*_missing`, 복원하면 돌아온다. 맞지 않는 함수는 `show_original` 로 접힌다
 *   ⑥ 상한 — 한 칸의 연결이 상한을 넘으면 틀린 합 대신 `too_many`
 *   ⑦ 화면이 그릴 것(5c-2) — 뷰의 컬럼에 rollup 이 서고(설정이 끊겨도 선다 · 손상된 config 는 빠진다) 셀 컬럼과 갈린다
 *
 * 반사실(HANDOFF §3.3-168~169): 읽을 수 있는지 안 보면 ④ 가(값이 샌다), lifecycle 을 안 보면 ④ 의 휴지통이, relation 이
 * 이 표의 것인지 안 보면 ① 이, 대상 표를 안 맞춰 보면 ① 이, 상한을 안 보면 ⑥ 이 실패한다.
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { textRun, toPlainText } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, deleteProperty, getSchema, restoreProperty, updateProperty } from './property.ts'
import type { CellValue, MvpPropertyType } from './property-types.ts'
import { createRow, trashRow, updateCells } from './row.ts'
import { addRelationProperty, linkRows } from './relation.ts'
import { createView, getView } from './view.ts'
import { isCellColumn } from './view-columns.ts'
import { addRollupProperty, computeRollups, readRollupConfig, MAX_ROLLUP_ROWS, type RollupCell, type RollupFunction } from './rollup.ts'

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

type Table = {
  databaseId: string
  dataSourceId: string
  titleId: string
  /** 셀 타입 프로퍼티를 더하고 id 를 준다. */
  prop: (name: string, type: MvpPropertyType) => Promise<string>
  row: (title: string, cells?: Record<string, CellValue>) => Promise<string>
}

async function newTable(name: string): Promise<Table> {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const schema = unwrap(await getSchema(fx.owner.ctx, created.dataSourceId))
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  return {
    databaseId: created.id,
    dataSourceId: created.dataSourceId,
    titleId,
    prop: async (propName, type) => {
      const next = unwrap(await addProperty(fx.owner.ctx, created.dataSourceId, { name: propName, type }))
      return next.properties.find((p) => p.name === propName)!.id
    },
    row: async (title, cells = {}) =>
      unwrap(
        await createRow(fx.owner.ctx, created.dataSourceId, {
          cells: [
            { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
            ...Object.entries(cells).map(([propertyId, value]) => ({ propertyId, value })),
          ],
        }),
      ).id,
  }
}

/**
 * 프로젝트 ← 작업. 작업 표에 "프로젝트"(→ 프로젝트), 프로젝트 표에 역방향 "작업들". rollup 은 프로젝트 표에서 "작업들"을
 * 타고 작업의 값을 모은다 — "프로젝트/작업" 템플릿의 모양이다(F-03-11 우선순위의 근거).
 */
async function world() {
  const tasks = await newTable('작업')
  const projects = await newTable('프로젝트')
  const hours = await tasks.prop('시간', 'number')
  const done = await tasks.prop('완료', 'checkbox')
  const due = await tasks.prop('마감', 'date')
  const made = unwrap(
    await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, {
      name: '프로젝트',
      targetDataSourceId: projects.dataSourceId,
      twoWay: { name: '작업들' },
    }),
  )
  const rollup = async (name: string, targetPropertyId: string, fn: RollupFunction) =>
    unwrap(
      await addRollupProperty(fx.owner.ctx, projects.dataSourceId, {
        name,
        relationPropertyId: made.syncedPropertyId!,
        targetPropertyId,
        function: fn,
      }),
    ).propertyId
  return { tasks, projects, hours, done, due, forward: made.propertyId, back: made.syncedPropertyId!, rollup }
}

const num = (n: number | null): CellValue => ({ type: 'number', number: n })
const box = (b: boolean): CellValue => ({ type: 'checkbox', checkbox: b })
const day = (start: string): CellValue => ({ type: 'date', date: { start } })

const makePrivate = async (databaseId: string, level?: 'view' | 'edit') => {
  assert.equal((await stopInheriting(fx.owner.ctx, databaseId)).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(fx.owner.ctx, databaseId, { type: 'workspace_everyone', id: null })).ok, true)
  if (level !== undefined) {
    assert.equal((await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: other.userId }, level)).ok, true)
  }
}

const ok = (cell: RollupCell | undefined) => {
  assert.equal(cell?.state, 'ok')
  if (cell?.state !== 'ok') throw new Error('unreachable')
  return cell
}

describe('① 만들기', () => {
  test('★ rollup 프로퍼티가 생긴다 — config 는 relation · 대상 · 함수, 값은 어디에도 저장되지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const project = await w.projects.row('P')
    const task = await w.tasks.row('T', { [w.hours]: num(3) })
    unwrap(await linkRows(fx.owner.ctx, task, w.forward, { add: [project] }))

    const before = unwrap(await getSchema(fx.owner.ctx, w.projects.dataSourceId)).schemaVersion
    const id = await w.rollup('총 시간', w.hours, 'sum')
    const schema = unwrap(await getSchema(fx.owner.ctx, w.projects.dataSourceId))
    const property = schema.properties.find((p) => p.id === id)!
    assert.equal(property.type, 'rollup')
    assert.deepEqual(readRollupConfig(property.config), {
      relation_property_id: w.back,
      target_property_id: w.hours,
      function: 'sum',
    })
    assert.notEqual(schema.schemaVersion, before, '스키마 버전이 오른다')

    // 값은 셀에도 캐시에도 없다(정본 C1 · [보강] rollup v1).
    const stored = await withReadTransaction(async (tx) => ({
      cells: await tx.query(`SELECT 1 FROM page_property_value WHERE property_id = $1`, [id]),
      cache: await tx.queryOne<{ cache: Record<string, unknown> }>(`SELECT properties_cache AS cache FROM page WHERE id = $1`, [project]),
    }))
    assert.equal(stored.cells.length, 0)
    assert.equal(id in stored.cache.cache, false)
  })

  test('★ relation 은 **이 표의** relation 이어야 한다 — 다른 표의 것 · relation 이 아닌 것 · 없는 것은 같은 답이다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const before = unwrap(await getSchema(fx.owner.ctx, w.projects.dataSourceId))
    const attempt = (relationPropertyId: string, targetPropertyId: string) =>
      addRollupProperty(fx.owner.ctx, w.projects.dataSourceId, { name: 'x', relationPropertyId, targetPropertyId, function: 'count' })

    // `forward` 는 작업 표의 relation 이다 — 프로젝트 표의 rollup 이 탈 수 없다.
    for (const relationId of [w.forward, w.projects.titleId, 'no-such-property-id-000', '']) {
      const r = await attempt(relationId, w.hours)
      assert.equal(r.ok === false && r.reason, 'invalid_target', `relation=${relationId}`)
    }
    // ★ 대상까지 그 relation 에 맞춰 줘도 안 된다 — `forward` 의 대상 표는 프로젝트이고 제목은 그 표의 프로퍼티다.
    //   이 검사가 없으면 위의 경우들은 "대상이 안 맞아서" 거부될 뿐, relation 이 남의 것이라서가 아니다.
    const matched = await attempt(w.forward, w.projects.titleId)
    assert.equal(matched.ok === false && matched.reason, 'invalid_target')

    const after = unwrap(await getSchema(fx.owner.ctx, w.projects.dataSourceId))
    assert.equal(after.schemaVersion, before.schemaVersion, '거부된 명령은 아무것도 바꾸지 않는다')
    assert.deepEqual(after.properties.map((p) => p.name), before.properties.map((p) => p.name))
  })

  test('★ 대상은 **그 relation 의 대상 표의 셀 타입**이어야 한다 — 이 표의 프로퍼티 · relation · rollup 은 안 된다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const count = await w.rollup('개수', w.tasks.titleId, 'count')
    const attempt = (targetPropertyId: string) =>
      addRollupProperty(fx.owner.ctx, w.projects.dataSourceId, {
        name: 'x',
        relationPropertyId: w.back,
        targetPropertyId,
        function: 'count',
      })
    // 프로젝트 표 자신의 제목(대상 표는 작업이다) · 작업 표의 relation · rollup(rollup 의 rollup) · 없는 것
    const selfRollup = unwrap(
      await addRollupProperty(fx.owner.ctx, w.tasks.dataSourceId, {
        name: '프로젝트 이름',
        relationPropertyId: w.forward,
        targetPropertyId: w.projects.titleId,
        function: 'show_original',
      }),
    ).propertyId
    for (const target of [w.projects.titleId, w.forward, selfRollup, count, 'no-such-property-id-000']) {
      const r = await attempt(target)
      assert.equal(r.ok === false && r.reason, 'invalid_target', `target=${target}`)
    }
  })

  test('★ 함수는 대상 타입이 고를 수 있는 것이어야 한다 — sum × 제목은 거부된다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const attempt = (targetPropertyId: string, fn: string) =>
      addRollupProperty(fx.owner.ctx, w.projects.dataSourceId, {
        name: `x ${fn}`,
        relationPropertyId: w.back,
        targetPropertyId,
        function: fn as RollupFunction,
      })
    for (const [target, fn] of [[w.tasks.titleId, 'sum'], [w.hours, 'percent_checked'], [w.done, 'earliest_date'], [w.hours, 'median']] as const) {
      const r = await attempt(target, fn)
      assert.equal(r.ok === false && r.reason, 'invalid_config', `${fn}`)
    }
    assert.equal((await attempt(w.hours, 'max')).ok, true)
    assert.equal((await attempt(w.done, 'percent_checked')).ok, true)
    assert.equal((await attempt(w.due, 'latest_date')).ok, true)
  })

  test('이름 규칙은 다른 프로퍼티와 같다 — 빈 이름 · 겹치는 이름', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const attempt = (name: string) =>
      addRollupProperty(fx.owner.ctx, w.projects.dataSourceId, {
        name,
        relationPropertyId: w.back,
        targetPropertyId: w.hours,
        function: 'sum',
      })
    const blank = await attempt('   ')
    assert.equal(blank.ok === false && blank.reason, 'invalid_name')
    const dup = await attempt('작업들')
    assert.equal(dup.ok === false && dup.reason, 'duplicate_name')
  })

  test('★ 권한 — 이 표의 `edit_structure` 가 필요하고, 대상 표를 못 보면 없는 것과 같은 답이다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const asOther = (dataSourceId: string, relationPropertyId: string, targetPropertyId: string) =>
      addRollupProperty(other.ctx, dataSourceId, { name: `o ${randomUUID().slice(0, 8)}`, relationPropertyId, targetPropertyId, function: 'count' })

    assert.equal((await asOther(w.projects.dataSourceId, w.back, w.hours)).ok, true, '둘 다 고칠 수 있으면 된다')

    // 작업 표를 못 보게 되면: 프로젝트 표는 여전히 고칠 수 있지만 작업의 프로퍼티를 가리킬 수 없다.
    await makePrivate(w.tasks.databaseId)
    const hidden = await asOther(w.projects.dataSourceId, w.back, w.hours)
    assert.equal(hidden.ok === false && hidden.reason, 'invalid_target')

    // 볼 수만 있는 표에는 만들 수 없다.
    await makePrivate(w.projects.databaseId, 'view')
    const viewOnly = await asOther(w.projects.dataSourceId, w.back, w.hours)
    assert.equal(viewOnly.ok === false && viewOnly.reason, 'forbidden')
  })
})

describe('② rollup 은 셀이 아니다', () => {
  test('★ 셀 쓰기로는 거부된다 — 읽기 전용 칸이다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const id = await w.rollup('총 시간', w.hours, 'sum')
    const project = await w.projects.row('P')
    const written = await updateCells(fx.owner.ctx, project, { cells: [{ propertyId: id, value: num(99) }] })
    assert.equal(written.ok === false && written.reason, 'unknown_property')
  })

  test('★ config 는 통째로 덮어쓸 수 없다 — rollup 도 relation 도(불변식이 걸린 설정이다). 이름은 바꿀 수 있다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const id = await w.rollup('총 시간', w.hours, 'sum')
    const viaRollup = await updateProperty(fx.owner.ctx, w.projects.dataSourceId, id, {
      config: { relation_property_id: w.forward, target_property_id: w.projects.titleId, function: 'sum' },
    })
    assert.equal(viaRollup.ok === false && viaRollup.reason, 'invalid_config')
    const viaRelation = await updateProperty(fx.owner.ctx, w.projects.dataSourceId, w.back, {
      config: { target_data_source_id: w.projects.dataSourceId },
    })
    assert.equal(viaRelation.ok === false && viaRelation.reason, 'invalid_config')

    const schema = unwrap(await getSchema(fx.owner.ctx, w.projects.dataSourceId))
    assert.equal(readRollupConfig(schema.properties.find((p) => p.id === id)!.config)?.target_property_id, w.hours)

    const renamed = unwrap(await updateProperty(fx.owner.ctx, w.projects.dataSourceId, id, { name: '시간 합계' }))
    assert.equal(renamed.properties.find((p) => p.id === id)!.name, '시간 합계')
  })
})

describe('③ 계산', () => {
  test('★ 프로젝트마다 작업의 값을 모은다 — 합 · 평균 · 개수 · 비율 · 가장 이른 날 · 원본', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const sum = await w.rollup('합', w.hours, 'sum')
    const average = await w.rollup('평균', w.hours, 'average')
    const count = await w.rollup('개수', w.hours, 'count')
    const filled = await w.rollup('적힌 것', w.hours, 'count_values')
    const percent = await w.rollup('진행률', w.done, 'percent_checked')
    const earliest = await w.rollup('첫 마감', w.due, 'earliest_date')
    const names = await w.rollup('작업 이름', w.tasks.titleId, 'show_original')

    const [p1, p2] = [await w.projects.row('P1'), await w.projects.row('P2')]
    const t1 = await w.tasks.row('설계', { [w.hours]: num(3), [w.done]: box(true), [w.due]: day('2026-03-01') })
    const t2 = await w.tasks.row('구현', { [w.done]: box(false) })
    const t3 = await w.tasks.row('검증', { [w.hours]: num(4.5), [w.done]: box(true), [w.due]: day('2026-01-15') })
    // 프로젝트 쪽에서 연결한다 — 칸의 순서가 곧 엣지의 순서다.
    unwrap(await linkRows(fx.owner.ctx, p1, w.back, { add: [t1, t2, t3] }))

    const page = unwrap(await computeRollups(fx.owner.ctx, w.projects.dataSourceId, [p1, p2]))
    assert.deepEqual(Object.keys(page.values).sort(), [p1, p2].sort())

    const a = page.values[p1]
    assert.deepEqual(ok(a[sum]).result, { kind: 'number', number: 7.5 })
    assert.deepEqual(ok(a[average]).result, { kind: 'number', number: 3.75 }, 'null 은 분모에 들지 않는다')
    assert.deepEqual(ok(a[count]).result, { kind: 'number', number: 3 })
    assert.deepEqual(ok(a[filled]).result, { kind: 'number', number: 2 })
    assert.deepEqual(ok(a[percent]).result, { kind: 'percent', percent: Number((2 / 3).toPrecision(15)) })
    assert.deepEqual(ok(a[earliest]).result, { kind: 'date', date: '2026-01-15' })
    const original = ok(a[names]).result
    assert.equal(original.kind, 'values')
    if (original.kind !== 'values') return
    assert.deepEqual(
      original.values.map((v) => (v.type === 'title' ? toPlainText(v.title) : '?')),
      ['설계', '구현', '검증'],
      '엣지 순서대로',
    )
    assert.equal(ok(a[sum]).hidden, 0)

    // 연결 0개 — 0 과 "없음"이 갈린다.
    const b = page.values[p2]
    assert.deepEqual(ok(b[sum]).result, { kind: 'number', number: 0 })
    assert.deepEqual(ok(b[average]).result, { kind: 'number', number: null })
    assert.deepEqual(ok(b[count]).result, { kind: 'number', number: 0 })
    assert.deepEqual(ok(b[percent]).result, { kind: 'percent', percent: null })
    assert.deepEqual(ok(b[earliest]).result, { kind: 'date', date: null })
    assert.deepEqual(ok(b[names]).result, { kind: 'values', values: [], count: 0 })

    // 컬럼의 상태: 적용한 함수와 대상 타입.
    const column = page.columns[percent]
    assert.equal(column.state, 'ok')
    if (column.state !== 'ok') return
    assert.deepEqual(
      { fn: column.function, type: column.targetType, relation: column.relationPropertyId, target: column.targetPropertyId },
      { fn: 'percent_checked', type: 'checkbox', relation: w.back, target: w.done },
    )
  })

  test('★ 단방향 relation 과 같은 표를 가리키는 relation 도 탄다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    // 작업 → 프로젝트(정방향)로 프로젝트의 제목을 가져온다.
    const projectName = unwrap(
      await addRollupProperty(fx.owner.ctx, w.tasks.dataSourceId, {
        name: '프로젝트 이름',
        relationPropertyId: w.forward,
        targetPropertyId: w.projects.titleId,
        function: 'count_values',
      }),
    ).propertyId
    const project = await w.projects.row('P')
    const task = await w.tasks.row('T')
    unwrap(await linkRows(fx.owner.ctx, task, w.forward, { add: [project] }))

    // 같은 표: 하위 작업의 시간을 상위 작업이 모은다.
    const children = unwrap(
      await addRelationProperty(fx.owner.ctx, w.tasks.dataSourceId, { name: '하위', targetDataSourceId: w.tasks.dataSourceId, twoWay: { name: '상위' } }),
    ).propertyId
    const childHours = unwrap(
      await addRollupProperty(fx.owner.ctx, w.tasks.dataSourceId, {
        name: '하위 시간',
        relationPropertyId: children,
        targetPropertyId: w.hours,
        function: 'sum',
      }),
    ).propertyId
    const [c1, c2] = [await w.tasks.row('c1', { [w.hours]: num(1) }), await w.tasks.row('c2', { [w.hours]: num(2) })]
    unwrap(await linkRows(fx.owner.ctx, task, children, { add: [c1, c2] }))

    const page = unwrap(await computeRollups(fx.owner.ctx, w.tasks.dataSourceId, [task, c1]))
    assert.deepEqual(ok(page.values[task][projectName]).result, { kind: 'number', number: 1 })
    assert.deepEqual(ok(page.values[task][childHours]).result, { kind: 'number', number: 3 })
    assert.deepEqual(ok(page.values[c1][childHours]).result, { kind: 'number', number: 0 }, '하위가 없는 행')
  })

  test('★ select 를 모으면 컬럼이 옵션 목록을 싣는다 — 값은 옵션 id 다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const stage = await w.tasks.prop('단계', 'select')
    const option = unwrap(await addSelectOption(fx.owner.ctx, w.tasks.dataSourceId, stage, { name: '검토' })).option
    const stages = await w.rollup('단계들', stage, 'show_original')
    const project = await w.projects.row('P')
    const task = await w.tasks.row('T', { [stage]: { type: 'select', select: { id: option.id } } })
    unwrap(await linkRows(fx.owner.ctx, project, w.back, { add: [task] }))

    const page = unwrap(await computeRollups(fx.owner.ctx, w.projects.dataSourceId, [project]))
    const column = page.columns[stages]
    assert.equal(column.state === 'ok' && column.targetOptions.map((o) => o.name).join(), '검토')
    assert.deepEqual(ok(page.values[project][stages]).result, {
      kind: 'values',
      values: [{ type: 'select', select: { id: option.id } }],
      count: 1,
    })
  })

  test('이 표의 살아 있는 행이 아닌 id 는 키가 없다 · 모양이 틀린 요청은 거부한다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    await w.rollup('개수', w.hours, 'count')
    const project = await w.projects.row('P')
    const task = await w.tasks.row('T')
    const gone = await w.projects.row('버릴 것')
    unwrap(await trashRow(fx.owner.ctx, gone))

    const page = unwrap(await computeRollups(fx.owner.ctx, w.projects.dataSourceId, [project, task, gone, randomUUID()]))
    assert.deepEqual(Object.keys(page.values), [project], '다른 표의 행 · 휴지통의 행 · 없는 id')

    const malformed = await computeRollups(fx.owner.ctx, w.projects.dataSourceId, ['nope'])
    assert.equal(malformed.ok === false && malformed.reason, 'invalid_value')
    const tooMany = await computeRollups(
      fx.owner.ctx,
      w.projects.dataSourceId,
      Array.from({ length: MAX_ROLLUP_ROWS + 1 }, () => randomUUID()),
    )
    assert.equal(tooMany.ok === false && tooMany.reason, 'invalid_value')
  })

  test('rollup 이 없는 표는 빈 답이다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const table = await newTable('빈 표')
    const row = await table.row('R')
    assert.deepEqual(unwrap(await computeRollups(fx.owner.ctx, table.dataSourceId, [row])), { columns: {}, values: {} })
  })
})

describe('④ 권한 · 휴지통은 집계 안에서 거른다', () => {
  test('★ 대상 표를 못 보는 사람 — 연결은 전부 `hidden` 이고 값도 옵션 이름도 오지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const stage = await w.tasks.prop('단계', 'select')
    const option = unwrap(await addSelectOption(fx.owner.ctx, w.tasks.dataSourceId, stage, { name: '기밀 단계' })).option
    const sum = await w.rollup('합', w.hours, 'sum')
    const max = await w.rollup('최대', w.hours, 'max')
    const names = await w.rollup('작업 이름', w.tasks.titleId, 'show_original')
    const stages = await w.rollup('단계들', stage, 'show_original')
    const project = await w.projects.row('P')
    const t1 = await w.tasks.row('기밀 작업', { [w.hours]: num(987654), [stage]: { type: 'select', select: { id: option.id } } })
    const t2 = await w.tasks.row('둘째', { [w.hours]: num(2) })
    unwrap(await linkRows(fx.owner.ctx, project, w.back, { add: [t1, t2] }))
    await makePrivate(w.tasks.databaseId)

    const page = unwrap(await computeRollups(other.ctx, w.projects.dataSourceId, [project]))
    const cells = page.values[project]
    assert.deepEqual(ok(cells[sum]), { state: 'ok', result: { kind: 'number', number: 0 }, hidden: 2 })
    assert.deepEqual(ok(cells[max]), { state: 'ok', result: { kind: 'number', number: null }, hidden: 2 }, 'max 는 원본을 그대로 보여 주는 함수다')
    assert.deepEqual(ok(cells[names]), { state: 'ok', result: { kind: 'values', values: [], count: 0 }, hidden: 2 })
    const column = page.columns[stages]
    assert.equal(column.state === 'ok' && column.targetOptions.length, 0, '옵션 이름은 그 표의 내용이다')
    const wire = JSON.stringify(page)
    // id 는 무작위라 짧은 숫자는 우연히 들어 있을 수 있다 — 값은 눈에 띄는 숫자로 둔다.
    assert.ok(!wire.includes('기밀') && !wire.includes('987654'), wire)

    // 소유자는 전부 본다.
    const mine = unwrap(await computeRollups(fx.owner.ctx, w.projects.dataSourceId, [project]))
    assert.deepEqual(ok(mine.values[project][sum]), { state: 'ok', result: { kind: 'number', number: 987656 }, hidden: 0 })
    const mineColumn = mine.columns[stages]
    assert.equal(mineColumn.state === 'ok' && mineColumn.targetOptions.map((o) => o.name).join(), '기밀 단계')
  })

  test('★ 휴지통에 간 행은 집계에서 빠지고(hidden 도 아니다) 복원하면 돌아온다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const sum = await w.rollup('합', w.hours, 'sum')
    const count = await w.rollup('개수', w.hours, 'count')
    const project = await w.projects.row('P')
    const [keep, gone] = [await w.tasks.row('남는 것', { [w.hours]: num(1) }), await w.tasks.row('버릴 것', { [w.hours]: num(10) })]
    unwrap(await linkRows(fx.owner.ctx, project, w.back, { add: [keep, gone] }))
    unwrap(await trashRow(fx.owner.ctx, gone))

    const trashed = unwrap(await computeRollups(fx.owner.ctx, w.projects.dataSourceId, [project])).values[project]
    assert.deepEqual(ok(trashed[sum]), { state: 'ok', result: { kind: 'number', number: 1 }, hidden: 0 })
    assert.deepEqual(ok(trashed[count]).result, { kind: 'number', number: 1 })

    await withTransaction((tx) =>
      tx.query(
        `UPDATE block SET lifecycle = 'live', trashed_at = NULL, trashed_by = NULL, trash_root_id = NULL,
                          purge_after = NULL WHERE id = $1`,
        [gone],
      ),
    )
    const restored = unwrap(await computeRollups(fx.owner.ctx, w.projects.dataSourceId, [project])).values[project]
    assert.deepEqual(ok(restored[sum]).result, { kind: 'number', number: 11 })
  })

  test('★ 이 표를 못 보면 not_found — rollup 이 있는지도 알려 주지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    await w.rollup('합', w.hours, 'sum')
    const project = await w.projects.row('P')
    await makePrivate(w.projects.databaseId)
    const denied = await computeRollups(other.ctx, w.projects.dataSourceId, [project])
    assert.equal(denied.ok === false && denied.reason, 'not_found')
    const ghost = await computeRollups(fx.owner.ctx, randomUUID(), [project])
    assert.equal(ghost.ok === false && ghost.reason, 'not_found')
  })
})

describe('⑤ 설정이 끊겨도 rollup 은 남는다', () => {
  test('★ relation 을 지우면 relation_missing, 대상을 지우면 target_missing — 복원하면 돌아온다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const sum = await w.rollup('합', w.hours, 'sum')
    const project = await w.projects.row('P')
    const task = await w.tasks.row('T', { [w.hours]: num(5) })
    unwrap(await linkRows(fx.owner.ctx, project, w.back, { add: [task] }))
    const read = async () => unwrap(await computeRollups(fx.owner.ctx, w.projects.dataSourceId, [project]))

    unwrap(await deleteProperty(fx.owner.ctx, w.tasks.dataSourceId, w.hours))
    let page = await read()
    assert.deepEqual(page.columns[sum], { state: 'target_missing' })
    assert.equal(sum in (page.values[project] ?? {}), false, '끊긴 컬럼은 칸을 싣지 않는다')
    unwrap(await restoreProperty(fx.owner.ctx, w.tasks.dataSourceId, w.hours))
    assert.deepEqual(ok((await read()).values[project][sum]).result, { kind: 'number', number: 5 })

    unwrap(await deleteProperty(fx.owner.ctx, w.projects.dataSourceId, w.back))
    page = await read()
    assert.deepEqual(page.columns[sum], { state: 'relation_missing' })
    // rollup 프로퍼티 자체는 스키마에 남아 있다.
    const schema = unwrap(await getSchema(fx.owner.ctx, w.projects.dataSourceId))
    assert.ok(schema.properties.some((p) => p.id === sum))
    unwrap(await restoreProperty(fx.owner.ctx, w.projects.dataSourceId, w.back))
    assert.deepEqual(ok((await read()).values[project][sum]).result, { kind: 'number', number: 5 })
  })

  test('★ 맞지 않는 함수는 읽을 때 show_original 로 접힌다 · 어긋난 config 는 끊긴 것으로 읽는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const folded = await w.rollup('접힐 것', w.tasks.titleId, 'count')
    const crossed = await w.rollup('어긋날 것', w.hours, 'sum')
    const broken = await w.rollup('깨질 것', w.hours, 'sum')
    const foreign = await w.rollup('남의 relation', w.hours, 'sum')
    const project = await w.projects.row('P')
    const task = await w.tasks.row('T', { [w.hours]: num(5) })
    unwrap(await linkRows(fx.owner.ctx, project, w.back, { add: [task] }))

    // 만들 때의 검사를 지나서 저장소가 어긋난 상태 — 타입 변환(F-03-09)이 들어오면 실제로 생긴다.
    const setConfig = (id: string, config: unknown) =>
      withTransaction((tx) => tx.query(`UPDATE property SET config = $2::jsonb WHERE id = $1`, [id, JSON.stringify(config)]))
    await setConfig(folded, { relation_property_id: w.back, target_property_id: w.tasks.titleId, function: 'sum' })
    // 대상이 **그 relation 의 대상 표**(작업)가 아니라 이 표(프로젝트)의 프로퍼티다.
    await setConfig(crossed, { relation_property_id: w.back, target_property_id: w.projects.titleId, function: 'count' })
    await setConfig(broken, { nonsense: true })
    // relation 이 **다른 표의 것**이다(대상은 그 relation 에 맞다) — 이 표의 행에서 탈 수 없는 relation 이다.
    await setConfig(foreign, { relation_property_id: w.forward, target_property_id: w.projects.titleId, function: 'count' })

    const page = unwrap(await computeRollups(fx.owner.ctx, w.projects.dataSourceId, [project]))
    const column = page.columns[folded]
    assert.equal(column.state === 'ok' && column.function, 'show_original')
    assert.equal(ok(page.values[project][folded]).result.kind, 'values')
    assert.deepEqual(page.columns[crossed], { state: 'target_missing' })
    assert.deepEqual(page.columns[broken], { state: 'relation_missing' })
    assert.deepEqual(page.columns[foreign], { state: 'relation_missing' })
  })
})

describe('⑥ 상한', () => {
  test('★ 한 칸의 연결이 상한을 넘으면 too_many — 앞의 것만 더한 틀린 합을 주지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const sum = await w.rollup('합', w.hours, 'sum')
    const [big, small] = [await w.projects.row('큰 것'), await w.projects.row('작은 것')]
    const tasks = []
    for (let i = 0; i < 4; i += 1) tasks.push(await w.tasks.row(`t${i}`, { [w.hours]: num(1) }))
    unwrap(await linkRows(fx.owner.ctx, big, w.back, { add: tasks }))
    unwrap(await linkRows(fx.owner.ctx, small, w.back, { add: tasks.slice(0, 3) }))

    const page = unwrap(await computeRollups(fx.owner.ctx, w.projects.dataSourceId, [big, small], { maxLinks: 3 }))
    assert.deepEqual(page.values[big][sum], { state: 'too_many' })
    assert.deepEqual(ok(page.values[small][sum]).result, { kind: 'number', number: 3 }, '상한과 같으면 계산한다')

    // 휴지통의 행은 상한에 들지 않는다 — 살아 있는 연결을 센다.
    unwrap(await trashRow(fx.owner.ctx, tasks[3]))
    const after = unwrap(await computeRollups(fx.owner.ctx, w.projects.dataSourceId, [big], { maxLinks: 3 }))
    assert.deepEqual(ok(after.values[big][sum]).result, { kind: 'number', number: 3 })
  })
})

describe('⑦ 화면이 그릴 것 (5c-2)', () => {
  test('★ 뷰의 컬럼에 rollup 이 선다 — 설정을 싣고, 셀 컬럼과 타입으로 갈린다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const sum = await w.rollup('총 시간', w.hours, 'sum')
    const view = unwrap(await createView(fx.owner.ctx, w.projects.databaseId, { type: 'table' }))
    const column = unwrap(await getView(fx.owner.ctx, view.id)).columns.find((c) => c.propertyId === sum)!
    assert.equal(column.type, 'rollup')
    assert.equal(isCellColumn(column), false, '셀 컬럼이 아니다 — 셀의 규칙에 넘어가면 안 된다')
    assert.deepEqual(column.type === 'rollup' && column.rollup, {
      relationPropertyId: w.back,
      targetPropertyId: w.hours,
      function: 'sum',
    })
  })

  test('★ 설정이 끊겨도 컬럼은 선다 — 값이 "끊겼다"고 말하려면 칸이 있어야 한다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const sum = await w.rollup('총 시간', w.hours, 'sum')
    unwrap(await deleteProperty(fx.owner.ctx, w.tasks.dataSourceId, w.hours))
    const view = unwrap(await createView(fx.owner.ctx, w.projects.databaseId, { type: 'table' }))
    const columns = unwrap(await getView(fx.owner.ctx, view.id)).columns
    assert.ok(columns.some((c) => c.propertyId === sum && c.type === 'rollup'))
  })

  test('손상된 config 의 rollup 컬럼은 빠진다 — 모르는 타입과 같은 취급이다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const w = await world()
    const sum = await w.rollup('총 시간', w.hours, 'sum')
    await withTransaction((tx) => tx.query(`UPDATE property SET config = '{}'::jsonb WHERE id = $1`, [sum]))
    const view = unwrap(await createView(fx.owner.ctx, w.projects.databaseId, { type: 'table' }))
    const columns = unwrap(await getView(fx.owner.ctx, view.id)).columns
    assert.equal(columns.some((c) => c.propertyId === sum), false)
    assert.ok(columns.some((c) => c.type === 'title'), '다른 컬럼은 그대로 선다')
  })
})
