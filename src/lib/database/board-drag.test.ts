/**
 * 보드 드래그의 규칙 — 보드 4b조각 (F-04-03, DOM 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 드롭 자리는 (가장 가까운 열, 중앙선 기준 "이 카드 앞") 이다
 *   ② **끌고 있는 카드는 후보에서 빠진다** — 안 그러면 자기 앞에 놓으라는 요청이 생긴다
 *   ③ **제자리 드롭은 null 이다** — 헛된 요청을 보내지 않는다
 *   ④ 정렬된 보드는 열 사이 이동만이다(§3.3-149)
 *   ⑤ `moveCard` 는 카운트를 함께 옮기고, `undo` 로 되돌리면 원래대로다
 *
 * 반사실(HANDOFF §3.3-151): 끌고 있는 카드를 후보에서 빼지 않으면 ② 가, 제자리 검사를 빼면 ③ 이, 카운트를 옮기지
 * 않으면 ⑤ 가 실패한다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { fillKeyOf, groupLabel, moveCard, moveChoices, prefillCells, resolveDrop, type ColumnBox, type DropTarget } from './board-drag.ts'

const card = (id: string, top: number) => ({ id, top, bottom: top + 40 })

/** 세 열 — '' (카드 하나) · a (셋, 50px 간격) · b (빈 열). 열 사이 틈은 20px. */
const layout: ColumnBox[] = [
  { key: '', left: 0, right: 100, cards: [card('n1', 0)] },
  { key: 'a', left: 120, right: 220, cards: [card('a1', 0), card('a2', 50), card('a3', 100)] },
  { key: 'b', left: 240, right: 340, cards: [] },
]

describe('resolveDrop — 열 고르기', () => {
  test('포인터가 든 열', () => {
    assert.deepEqual(resolveDrop(layout, { id: 'n1', fromKey: '' }, 160, 500, true), { key: 'a', beforeRowId: null })
    assert.deepEqual(resolveDrop(layout, { id: 'n1', fromKey: '' }, 300, 10, true), { key: 'b', beforeRowId: null })
  })

  test('★ 열 사이 틈 · 보드 밖에서는 가장 가까운 열 — 끄는 동안 자리가 사라지지 않는다', () => {
    assert.equal(resolveDrop(layout, { id: 'n1', fromKey: '' }, 112, 500, true)?.key, 'a')
    assert.equal(resolveDrop(layout, { id: 'a1', fromKey: 'a' }, -50, 500, true)?.key, '')
    assert.equal(resolveDrop(layout, { id: 'a1', fromKey: 'a' }, 1000, 500, true)?.key, 'b')
  })

  test('열이 없으면 null', () => {
    assert.equal(resolveDrop([], { id: 'n1', fromKey: '' }, 0, 0, true), null)
  })
})

describe('resolveDrop — 열 안 자리 (수동 순서)', () => {
  const n1 = { id: 'n1', fromKey: '' }

  test('카드 중앙선보다 위면 그 카드 앞, 마지막 카드 아래면 맨 뒤', () => {
    assert.deepEqual(resolveDrop(layout, n1, 160, 10, true), { key: 'a', beforeRowId: 'a1' })
    assert.deepEqual(resolveDrop(layout, n1, 160, 30, true), { key: 'a', beforeRowId: 'a2' })
    assert.deepEqual(resolveDrop(layout, n1, 160, 75, true), { key: 'a', beforeRowId: 'a3' })
    assert.deepEqual(resolveDrop(layout, n1, 160, 200, true), { key: 'a', beforeRowId: null })
  })

  test('빈 열은 맨 뒤(= 처음)', () => {
    assert.deepEqual(resolveDrop(layout, n1, 300, 200, true), { key: 'b', beforeRowId: null })
  })

  test('★ 끌고 있는 카드는 후보에서 빠진다 — 자기 위쪽 절반에 놓아도 "자기 앞"이 아니라 제자리(null)다', () => {
    // a2 는 50~90. 60 은 a2 의 중앙선(70) 위 — a2 를 후보에 넣으면 "a2 앞" 이 되어 자기 앞에 놓으라는 요청이 된다.
    assert.equal(resolveDrop(layout, { id: 'a2', fromKey: 'a' }, 160, 60, true), null)
  })

  test('★ 제자리 드롭은 null — 원래 뒤 카드 앞 · 마지막 카드의 맨 뒤', () => {
    assert.equal(resolveDrop(layout, { id: 'a2', fromKey: 'a' }, 160, 75, true), null)
    assert.equal(resolveDrop(layout, { id: 'a3', fromKey: 'a' }, 160, 300, true), null)
    assert.equal(resolveDrop(layout, { id: 'a1', fromKey: 'a' }, 160, 45, true), null)
  })

  test('같은 열에서 한 칸 아래 · 맨 뒤 · 맨 앞', () => {
    assert.deepEqual(resolveDrop(layout, { id: 'a1', fromKey: 'a' }, 160, 75, true), { key: 'a', beforeRowId: 'a3' })
    assert.deepEqual(resolveDrop(layout, { id: 'a1', fromKey: 'a' }, 160, 300, true), { key: 'a', beforeRowId: null })
    assert.deepEqual(resolveDrop(layout, { id: 'a3', fromKey: 'a' }, 160, 5, true), { key: 'a', beforeRowId: 'a1' })
  })
})

describe('resolveDrop — 정렬된 보드 (§3.3-149)', () => {
  test('★ 같은 열은 null, 다른 열은 y 와 무관하게 맨 뒤', () => {
    assert.equal(resolveDrop(layout, { id: 'a1', fromKey: 'a' }, 160, 300, false), null)
    assert.equal(resolveDrop(layout, { id: 'a1', fromKey: 'a' }, 160, 5, false), null)
    assert.deepEqual(resolveDrop(layout, { id: 'a1', fromKey: 'a' }, 50, 5, false), { key: '', beforeRowId: null })
    assert.deepEqual(resolveDrop(layout, { id: 'n1', fromKey: '' }, 160, 10, false), { key: 'a', beforeRowId: null })
  })
})

describe('moveCard', () => {
  const row = (id: string) => ({ id })
  const state = [
    { key: '', rows: [row('n1')], count: 1 },
    // count 5 · 불러온 것은 3 — "더 보기"가 남은 열.
    { key: 'a', rows: [row('a1'), row('a2'), row('a3')], count: 5 },
    { key: 'b', rows: [], count: 0 },
  ]
  const ids = (columns: readonly { rows: readonly { id: string }[] }[]) => columns.map((c) => c.rows.map((r) => r.id))
  const counts = (columns: readonly { count: number }[]) => columns.map((c) => c.count)

  test('열 사이 — 이 카드 앞에 끼우고 카운트를 옮긴다', () => {
    const moved = moveCard(state, 'n1', { key: 'a', beforeRowId: 'a2' })
    assert.ok(moved)
    assert.deepEqual(ids(moved.columns), [[], ['a1', 'n1', 'a2', 'a3'], []])
    assert.deepEqual(counts(moved.columns), [0, 6, 0])
    assert.deepEqual(moved.undo, { key: '', beforeRowId: null })
  })

  test('빈 열의 맨 뒤', () => {
    const moved = moveCard(state, 'a1', { key: 'b', beforeRowId: null })
    assert.ok(moved)
    assert.deepEqual(ids(moved.columns), [['n1'], ['a2', 'a3'], ['a1']])
    assert.deepEqual(counts(moved.columns), [1, 4, 1])
    assert.deepEqual(moved.undo, { key: 'a', beforeRowId: 'a2' })
  })

  test('열 안 — 카운트는 그대로', () => {
    const moved = moveCard(state, 'a3', { key: 'a', beforeRowId: 'a1' })
    assert.ok(moved)
    assert.deepEqual(ids(moved.columns), [['n1'], ['a3', 'a1', 'a2'], []])
    assert.deepEqual(counts(moved.columns), [1, 5, 0])
    assert.deepEqual(moved.undo, { key: 'a', beforeRowId: null })
  })

  test('★ 그사이 사라진 카드 앞이면 맨 뒤 — 드롭이 죽지 않는다', () => {
    const moved = moveCard(state, 'n1', { key: 'a', beforeRowId: 'ghost' })
    assert.deepEqual(ids(moved?.columns ?? []), [[], ['a1', 'a2', 'a3', 'n1'], []])
  })

  test('없는 행 · 없는 열은 null', () => {
    assert.equal(moveCard(state, 'ghost', { key: 'a', beforeRowId: null }), null)
    assert.equal(moveCard(state, 'n1', { key: 'ghost', beforeRowId: null }), null)
  })

  test('★ undo 로 되돌리면 순서 · 카운트가 원래대로다 (요청이 거부됐을 때의 롤백)', () => {
    const targets: { rowId: string; target: DropTarget }[] = [
      { rowId: 'n1', target: { key: 'a', beforeRowId: 'a2' } },
      { rowId: 'n1', target: { key: 'a', beforeRowId: null } },
      { rowId: 'a1', target: { key: 'b', beforeRowId: null } },
      { rowId: 'a3', target: { key: 'a', beforeRowId: 'a1' } },
      { rowId: 'a1', target: { key: 'a', beforeRowId: null } },
      { rowId: 'a2', target: { key: '', beforeRowId: 'n1' } },
    ]
    for (const { rowId, target } of targets) {
      const moved = moveCard(state, rowId, target)
      assert.ok(moved, JSON.stringify(target))
      const back = moveCard(moved.columns, rowId, moved.undo)
      assert.ok(back)
      assert.deepEqual(ids(back.columns), ids(state), JSON.stringify(target))
      assert.deepEqual(counts(back.columns), counts(state), JSON.stringify(target))
    }
  })

  test('원래 상태를 바꾸지 않는다', () => {
    const before = JSON.stringify(state)
    moveCard(state, 'n1', { key: 'a', beforeRowId: null })
    assert.equal(JSON.stringify(state), before)
  })
})

describe('moveChoices — 끌지 않고 옮길 자리 (10m-2)', () => {
  const row = (id: string) => ({ id })
  const state = [
    { key: '', rows: [row('n1')], count: 1 },
    { key: 'a', rows: [row('a1'), row('a2'), row('a3')], count: 3 },
    { key: 'b', rows: [row('b1'), row('b2')], count: 4 }, // "더 보기"가 남은 열
  ]
  const ids = (columns: readonly { rows: readonly { id: string }[] }[]) => columns.map((c) => c.rows.map((r) => r.id))
  const apply = (rowId: string, target: DropTarget | null) => {
    assert.ok(target, '자리가 없다')
    const moved = moveCard(state, rowId, target)
    assert.ok(moved)
    return ids(moved.columns)
  }

  test('★ 다른 열마다 그 열의 맨 뒤 — 화면의 열 순서대로 · 자기 열은 없다', () => {
    const c = moveChoices(state, 'a2', true)
    assert.ok(c)
    assert.deepEqual(c.others, [
      { key: '', target: { key: '', beforeRowId: null } },
      { key: 'b', target: { key: 'b', beforeRowId: null } },
    ])
    assert.deepEqual(apply('a2', c.others[1].target), [['n1'], ['a1', 'a3'], ['b1', 'b2', 'a2']])
  })

  test('★ 위로 · 아래로는 정확히 한 칸 — moveCard 로 옮기면 이웃과 자리를 바꾼다', () => {
    const c = moveChoices(state, 'a2', true)
    assert.ok(c)
    assert.deepEqual(apply('a2', c.up), [['n1'], ['a2', 'a1', 'a3'], ['b1', 'b2']])
    assert.deepEqual(apply('a2', c.down), [['n1'], ['a1', 'a3', 'a2'], ['b1', 'b2']])
    // 둘째에서 아래로 — 다음 카드의 다음 카드 앞
    const first = moveChoices(state, 'a1', true)
    assert.ok(first)
    assert.equal(first.up, null, '맨 위에는 위로가 없다')
    assert.deepEqual(apply('a1', first.down), [['n1'], ['a2', 'a1', 'a3'], ['b1', 'b2']])
  })

  test('맨 아래에는 아래로가 없다 · 하나뿐인 열에는 둘 다 없다', () => {
    assert.equal(moveChoices(state, 'a3', true)?.down, null)
    const only = moveChoices(state, 'n1', true)
    assert.equal(only?.up, null)
    assert.equal(only?.down, null)
  })

  test('★ 불러온 끝인데 더 남은 열("더 보기")의 마지막 카드는 아래로가 없다 — 맨 뒤로 보내면 열 끝까지 간다', () => {
    const c = moveChoices(state, 'b1', true)
    assert.ok(c)
    assert.deepEqual(c.down, null, 'b1 의 다음은 b2(불러온 끝)이고 그 뒤를 모른다')
    assert.deepEqual(c.up, null)
    assert.deepEqual(moveChoices(state, 'b2', true)?.up, { key: 'b', beforeRowId: 'b1' })
  })

  test('정렬된 보드는 열 사이만 — 위로 · 아래로가 없다', () => {
    const c = moveChoices(state, 'a2', false)
    assert.ok(c)
    assert.equal(c.others.length, 2)
    assert.equal(c.up, null)
    assert.equal(c.down, null)
  })

  test('없는 카드는 null', () => {
    assert.equal(moveChoices(state, 'zz', true), null)
  })
})

describe('prefillCells · groupLabel', () => {
  test("select: 옵션 그룹은 그 옵션, '' 그룹은 셀 없음(값 없음이 곧 그 그룹)", () => {
    assert.deepEqual(prefillCells('select', 'p', 'opt1'), [{ propertyId: 'p', value: { type: 'select', select: { id: 'opt1' } } }])
    assert.deepEqual(prefillCells('select', 'p', ''), [])
  })

  test("★ status: '' 그룹은 빈 값을 **명시해** 보낸다 — 안 보내면 새 카드가 기본 옵션의 열로 가 버린다", () => {
    assert.deepEqual(prefillCells('status', 'p', ''), [{ propertyId: 'p', value: { type: 'status', status: null } }])
    assert.deepEqual(prefillCells('status', 'p', 'opt1'), [{ propertyId: 'p', value: { type: 'status', status: { id: 'opt1' } } }])
  })

  test("checkbox: 'true' · 'false'", () => {
    assert.deepEqual(prefillCells('checkbox', 'p', 'true'), [{ propertyId: 'p', value: { type: 'checkbox', checkbox: true } }])
    assert.deepEqual(prefillCells('checkbox', 'p', 'false'), [{ propertyId: 'p', value: { type: 'checkbox', checkbox: false } }])
    // 날짜(B-1) — 그 버킷의 첫 날 · 값 없음은 안 보낸다
    assert.deepEqual(prefillCells('date', 'p', '2026-10-01'), [{ propertyId: 'p', value: { type: 'date', date: { start: '2026-10-01' } } }])
    assert.deepEqual(prefillCells('date', 'p', ''), [])
    // 숫자(B-2) — 구간의 아래 끝
    assert.deepEqual(prefillCells('number', 'p', '0.5'), [{ propertyId: 'p', value: { type: 'number', number: 0.5 } }])
    assert.deepEqual(prefillCells('number', 'p', ''), [])
  })

  test('열 이름 — 옵션 이름 · "{속성} 없음" · 체크됨/체크 안 됨', () => {
    const option = { id: 'o', name: '진행 중', color: 'blue' as const }
    assert.equal(groupLabel('select', '상태', { key: 'o', option }), '진행 중')
    assert.equal(groupLabel('select', '상태', { key: '', option: null }), '상태 없음')
    // 날짜(B-1) — 그 단위의 버킷 이름 · 값 없음 · 단위를 모르면 월
    assert.equal(groupLabel('date', '마감', { key: '2026-10-26', option: null }, { dateUnit: 'week' }), '2026년 10월 26일 주')
    assert.equal(groupLabel('date', '마감', { key: '2026-10-01', option: null }), '2026년 10월')
    assert.equal(groupLabel('date', '마감', { key: '', option: null }, { dateUnit: 'year' }), '마감 없음')
    // 숫자(B-2) — 구간 · 값 없음 · 크기를 모르면 10
    assert.equal(groupLabel('number', '점수', { key: '20', option: null }, { numberSize: 5 }), '20 ~ 25')
    assert.equal(groupLabel('number', '점수', { key: '-10', option: null }), '-10 ~ 0')
    assert.equal(groupLabel('number', '점수', { key: '', option: null }), '점수 없음')
    assert.equal(groupLabel('checkbox', '완료', { key: 'true', option: null }), '체크됨')
    assert.equal(groupLabel('checkbox', '완료', { key: 'false', option: null }), '체크 안 됨')
  })
})

describe('범주 열 (10n-27)', () => {
  test('열 이름은 그룹 이름 — 옵션 열 · 없음 열은 그대로', () => {
    assert.equal(groupLabel('status', '진행', { key: 'complete', option: null, statusGroup: 'complete' }), '완료')
    assert.equal(groupLabel('status', '진행', { key: 'todo', option: null, statusGroup: 'todo' }), '할 일')
    assert.equal(groupLabel('status', '진행', { key: '', option: null, statusGroup: null }), '진행 없음')
  })

  test('★ `+` 의 키 — 범주 열은 서버가 정한 옵션 · 없으면 null(만들 수 없다) · 그 밖은 열의 키', () => {
    assert.equal(fillKeyOf({ key: 'complete', statusGroup: 'complete', fillOptionId: 'opt-done' }), 'opt-done')
    assert.equal(fillKeyOf({ key: 'complete', statusGroup: 'complete', fillOptionId: null }), null)
    assert.equal(fillKeyOf({ key: 'opt-1', statusGroup: null, fillOptionId: 'opt-1' }), 'opt-1')
    assert.equal(fillKeyOf({ key: '', statusGroup: null, fillOptionId: null }), '', '없음 열은 빈 값으로 만든다')
    assert.equal(fillKeyOf({ key: 'true' }), 'true', 'checkbox')
  })
})
