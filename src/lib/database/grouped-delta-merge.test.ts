/**
 * 바뀐 행만 그룹 화면에 합친다 (DB 실시간 동기화 RT-5조각 · F-05-16 · F-05-06)
 *
 *   ① 그룹 안 — 정렬 값이 바뀐 행이 같은 그룹 안에서 자리를 옮긴다 · 다른 그룹은 그대로
 *   ② 그룹 사이 — 옛 그룹에서 빠지고 새 그룹의 이웃 사이에 선다 · 빈 그룹(보이는) · 숨긴 그룹(빠지기만) · 읽지 않은 범위(빠지기만)
 *   ③ 확신이 없으면 다시 읽는다 — 이웃이 어긋났다 · 여러 값(그룹 자리 없음) · 그룹 목록이 다르다(생김 · 사라짐 · 숨김) · 목록에 없는 그룹
 *   ④ 덩이의 몫(`deltaForGroup`) — 그 그룹에 서는 행은 그룹 안의 자리로 · 다른 그룹 · 뷰 밖은 그 덩이의 뷰 밖 · 내가 고친 행은 옛 덩이에 남는다
 *   ⑤ 더 보기 커서 — 숨긴 그룹 · 다 읽은 그룹은 싣지 않는다 · 상한을 넘으면 null
 *   ⑥ 응답의 모양 — 그룹 자리 · 머리를 읽는다 · 틀린 모양은 null
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { RowJson } from './http.ts'
import { mergeDelta, parseDelta, type DeltaJson, type DeltaRowJson } from './delta-merge.ts'
import {
  deltaForGroup,
  groupedDeltaFallback,
  groupPages,
  MAX_GROUP_PAGES,
  mergeGroupedDelta,
  sameGroupHeads,
  type ShownGroup,
} from './grouped-delta-merge.ts'

const row = (id: string, version = '1'): RowJson => ({
  id,
  title: id,
  icon: null,
  properties: {},
  uniqueSeq: null,
  createdAt: '2026-11-26T00:00:00Z',
  createdBy: null,
  lastEditedAt: '2026-11-26T00:00:00Z',
  lastEditedBy: null,
  version,
})
/** 그룹 `key` 에 서는 바뀐 행 — 그 그룹 안의 앞 · 뒤. */
const at = (id: string, key: string, before: string | null, after: string | null, beyond = false): DeltaRowJson => ({
  ...row(id, '2'),
  kind: 'row_upsert',
  inView: true,
  group: { key, before, after, beyond },
})
const out = (id: string): DeltaRowJson => ({ ...row(id, '2'), kind: 'row_upsert', inView: false })
const group = (key: string, ids: string[], extra: Partial<ShownGroup> = {}): ShownGroup => ({
  key,
  hidden: false,
  rows: ids.map((id) => row(id)),
  hasMore: false,
  nextCursor: null,
  ...extra,
})
const head = (key: string, count: number, hidden = false) => ({ key, count, hidden, calculation: null })
const delta = (rows: DeltaRowJson[], heads = [head('', 0), head('a', 2), head('b', 2)], extra: Partial<DeltaJson> = {}): DeltaJson => ({
  cursor: 'c1.9',
  reset: false,
  behind: false,
  schemaChanged: false,
  viewChanged: false,
  orderChanged: false,
  personalChanged: false,
  rows,
  groupPlaced: true,
  groups: heads,
  ...extra,
})
const ids = (merged: ReturnType<typeof mergeGroupedDelta>, key: string) => merged?.rows.get(key)?.map((r) => r.id)

describe('① 그룹 안', () => {
  test('정렬 값이 바뀐 행이 같은 그룹 안에서 자리를 옮긴다 — 다른 그룹은 그대로', () => {
    const groups = [group('', []), group('a', ['a1', 'a2', 'a3']), group('b', ['b1'])]
    const merged = mergeGroupedDelta(groups, [at('a1', 'a', 'a3', null)])
    assert.deepEqual(ids(merged, 'a'), ['a2', 'a3', 'a1'])
    assert.deepEqual(ids(merged, 'b'), ['b1'])
    assert.equal(merged?.changed, true)
  })

  test('값만 바뀐 행은 제자리에 새 값', () => {
    const groups = [group('a', ['a1', 'a2'])]
    const merged = mergeGroupedDelta(groups, [at('a2', 'a', 'a1', null)])
    assert.deepEqual(ids(merged, 'a'), ['a1', 'a2'])
    assert.equal(merged?.rows.get('a')?.[1]?.version, '2')
  })
})

describe('② 그룹 사이', () => {
  test('옛 그룹에서 빠지고 새 그룹의 이웃 사이에 선다', () => {
    const groups = [group('a', ['a1', 'x', 'a2']), group('b', ['b1', 'b2'])]
    const merged = mergeGroupedDelta(groups, [at('x', 'b', 'b1', 'b2')])
    assert.deepEqual(ids(merged, 'a'), ['a1', 'a2'])
    assert.deepEqual(ids(merged, 'b'), ['b1', 'x', 'b2'])
  })

  test('빈 그룹(보이는)으로 — 앞 · 뒤가 없다', () => {
    const groups = [group('', []), group('a', ['x', 'a1'])]
    const merged = mergeGroupedDelta(groups, [at('x', '', null, null)])
    assert.deepEqual(ids(merged, ''), ['x'])
    assert.deepEqual(ids(merged, 'a'), ['a1'])
  })

  test('숨긴 그룹으로 — 빠지기만 한다(숨긴 그룹은 행이 없다)', () => {
    const groups = [group('a', ['x', 'a1']), group('h', [], { hidden: true })]
    const merged = mergeGroupedDelta(groups, [at('x', 'h', 'h1', null)])
    assert.deepEqual(ids(merged, 'a'), ['a1'])
    assert.equal(merged?.rows.has('h'), false)
  })

  test('새 그룹의 읽지 않은 범위로 — 빠지기만 한다(더 보기가 가져온다)', () => {
    const groups = [group('a', ['x', 'a1']), group('b', ['b1'], { hasMore: true, nextCursor: 'k' })]
    const merged = mergeGroupedDelta(groups, [at('x', 'b', 'b9', 'b10', true)])
    assert.deepEqual(ids(merged, 'a'), ['a1'])
    assert.deepEqual(ids(merged, 'b'), ['b1'])
  })

  test('새 그룹의 읽은 끝 바로 뒤(다음이 읽지 않은 범위) — 끝에 선다', () => {
    const groups = [group('a', ['x']), group('b', ['b1'], { hasMore: true, nextCursor: 'k' })]
    const merged = mergeGroupedDelta(groups, [at('x', 'b', 'b1', 'b2')])
    assert.deepEqual(ids(merged, 'b'), ['b1', 'x'])
    assert.deepEqual(ids(merged, 'a'), [])
  })

  test('뷰 밖이 된 행 · 지운 행은 모든 그룹에서 빠진다', () => {
    const groups = [group('a', ['x', 'a1']), group('b', ['y'])]
    const merged = mergeGroupedDelta(groups, [out('x'), { id: 'y', kind: 'row_delete', inView: false }])
    assert.deepEqual(ids(merged, 'a'), ['a1'])
    assert.deepEqual(ids(merged, 'b'), [])
  })
})

describe('③ 확신이 없으면 다시 읽는다', () => {
  test('이웃이 화면에서 이웃이 아니다 — 보드 전체를 다시 읽는다(null)', () => {
    const groups = [group('a', ['x']), group('b', ['b1', 'b2'])]
    // 서버는 b1 · b3 사이라 하는데 화면의 b1 다음은 b2 — 화면이 서버의 지금과 어긋났다
    assert.equal(mergeGroupedDelta(groups, [at('x', 'b', 'b1', 'b3')]), null)
  })

  test('여러 값 · 하위 그룹 · 부모만 — 서버가 그룹 자리를 주지 않았다(unplaced)', () => {
    const screen = [group('', []), group('a', []), group('b', [])]
    assert.equal(groupedDeltaFallback(delta([at('x', 'a', null, null)], undefined, { groupPlaced: false, groups: undefined }), screen), 'unplaced')
    // 자리가 없는 행이 섞였다
    assert.equal(groupedDeltaFallback(delta([{ ...row('x'), kind: 'row_upsert', inView: true }]), screen), 'unplaced')
  })

  test('그룹 목록이 화면과 다르다 — 생김 · 사라짐 · 숨김 · 차례', () => {
    const screen = [group('', []), group('a', []), group('b', [])]
    const rows = [at('x', 'a', null, null)]
    assert.equal(groupedDeltaFallback(delta(rows), screen), null)
    assert.equal(groupedDeltaFallback(delta(rows, [head('', 0), head('a', 1), head('b', 1), head('c', 1)]), screen), 'groups')
    assert.equal(groupedDeltaFallback(delta(rows, [head('a', 1), head('b', 1)]), screen), 'groups')
    assert.equal(groupedDeltaFallback(delta(rows, [head('', 0), head('a', 1), head('b', 1, true)]), screen), 'groups')
    assert.equal(groupedDeltaFallback(delta(rows, [head('', 0), head('b', 1), head('a', 1)]), screen), 'groups')
    assert.equal(sameGroupHeads(screen, [head('', 0), head('a', 5), head('b', 0)]), true, '개수만 다른 것은 같은 목록')
  })

  test('바뀐 행의 그룹이 목록에 없다 — groups', () => {
    const screen = [group('a', []), group('b', [])]
    assert.equal(groupedDeltaFallback(delta([at('x', 'z', null, null)], [head('a', 1), head('b', 1)]), screen), 'groups')
  })

  test('평평한 것의 까닭이 먼저 — 개인 설정 · reset · 스키마 · 이 뷰 · 바뀐 행이 없으면 null', () => {
    const screen = [group('a', [])]
    assert.equal(groupedDeltaFallback(delta([], [head('a', 0)], { personalChanged: true }), screen), 'personal')
    assert.equal(groupedDeltaFallback(delta([], [head('a', 0)], { reset: true }), screen), 'reset')
    assert.equal(groupedDeltaFallback(delta([], [head('a', 0)], { schemaChanged: true }), screen), 'schema')
    assert.equal(groupedDeltaFallback(delta([], [head('a', 0)], { viewChanged: true }), screen), 'view')
    assert.equal(groupedDeltaFallback(delta([], undefined, { groupPlaced: true, groups: undefined }), screen), null)
  })
})

describe('④ 덩이의 몫', () => {
  test('그 그룹에 서는 행은 그룹 안의 자리로 · 다른 그룹은 뷰 밖 · 지운 행은 그대로', () => {
    const rows = [at('x', 'a', 'a1', null, true), at('y', 'b', null, 'b1'), { id: 'z', kind: 'row_delete', inView: false } as DeltaRowJson]
    const forA = deltaForGroup(rows, 'a')
    assert.deepEqual(forA.map((r) => [r.id, r.inView, r.kind === 'row_upsert' ? r.place : undefined]), [
      ['x', true, { before: 'a1', after: null, beyond: true }],
      ['y', false, undefined],
      ['z', false, undefined],
    ])
    assert.ok(forA.every((r) => !('group' in r)), '그룹 자리는 떼어 낸다(행에 남지 않는다)')
  })

  test('그룹 표 — 내가 고쳐 다른 그룹이 된 행은 옛 덩이에 "조건 밖"으로 남고 새 덩이에 선다(G-1 ④)', () => {
    const rows = [at('x', 'b', 'b1', null)]
    const oldChunk = mergeDelta({ previous: [row('x'), row('a1')], outside: new Set(), touched: new Set(['x']), rows: deltaForGroup(rows, 'a'), hasMore: false })
    assert.ok(oldChunk.ok)
    assert.deepEqual(oldChunk.rows.map((r) => r.id), ['x', 'a1'])
    assert.deepEqual([...oldChunk.outside], ['x'])
    const newChunk = mergeDelta({ previous: [row('b1')], outside: new Set(), touched: new Set(), rows: deltaForGroup(rows, 'b'), hasMore: false })
    assert.ok(newChunk.ok)
    assert.deepEqual(newChunk.rows.map((r) => r.id), ['b1', 'x'])
  })
})

describe('⑤ 더 보기 커서', () => {
  test('보이고 더 볼 것이 남은 그룹만 · 상한을 넘으면 null', () => {
    const groups = [
      group('a', ['a1'], { hasMore: true, nextCursor: 'ka' }),
      group('b', ['b1']),
      group('h', [], { hidden: true, hasMore: true, nextCursor: 'kh' }),
    ]
    assert.deepEqual(groupPages(groups), { a: 'ka' })
    const many = Array.from({ length: MAX_GROUP_PAGES + 1 }, (_, i) => group(`g${i}`, ['r'], { hasMore: true, nextCursor: `k${i}` }))
    assert.equal(groupPages(many), null)
    assert.equal(Object.keys(groupPages(many.slice(0, MAX_GROUP_PAGES)) ?? {}).length, MAX_GROUP_PAGES)
  })
})

describe('⑥ 응답의 모양', () => {
  test('그룹 자리 · 머리 · 덩이 집계 · 미리보기를 읽는다', () => {
    const parsed = parseDelta({
      cursor: 'c1.9',
      reset: false,
      behind: false,
      schemaChanged: false,
      viewChanged: false,
      orderChanged: false,
      groupPlaced: true,
      groups: [head('a', 3)],
      groupCalculations: { a: {} },
      covers: { x: '/f/1' },
      rows: [at('x', 'a', null, null)],
    })
    assert.ok(parsed !== null)
    assert.equal(parsed.groupPlaced, true)
    assert.deepEqual(parsed.groups, [head('a', 3)])
    assert.deepEqual(parsed.groupCalculations, { a: {} })
    assert.deepEqual(parsed.covers, { x: '/f/1' })
    const r = parsed.rows[0]!
    assert.deepEqual(r.kind === 'row_upsert' ? r.group : null, { key: 'a', before: null, after: null, beyond: false })
  })

  test('틀린 모양은 null — 그룹 자리 · 머리 · 깃발', () => {
    const base = { cursor: 'c1.9', reset: false, behind: false, schemaChanged: false, viewChanged: false, orderChanged: false, rows: [] }
    assert.equal(parseDelta({ ...base, groupPlaced: 'yes' }), null)
    assert.equal(parseDelta({ ...base, groups: [{ key: 'a' }] }), null)
    assert.equal(parseDelta({ ...base, rows: [{ ...row('x'), kind: 'row_upsert', inView: true, group: { key: 1 } }] }), null)
  })
})
