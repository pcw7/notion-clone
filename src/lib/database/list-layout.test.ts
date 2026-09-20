/**
 * List 뷰의 배치 규칙 — 보드 4c-2조각 (F-04-04, DOM 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① List 는 제목이 맨 앞이다 — 뷰의 컬럼 순서와 무관하게. 표는 건드리지 않는다
 *   ② **빈 칸은 접는다**(F-04-04 "빈 배지 렌더 금지") — 단 선택 · 편집 중인 칸은 비어 있어도 보인다
 *   ③ 제목은 비어도, 체크박스는 `false` 여도 접지 않는다
 *
 * 반사실(HANDOFF §3.3-157): `active` 예외를 빼면 ② 의 "선택된 빈 칸" 이, 체크박스를 빈 값으로 보면 ③ 이 실패한다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { isCollapsed, isRelationCollapsed, listColumns, variantOf } from './list-layout.ts'
import { emptyValue, type CellValue, type MvpPropertyType } from './property-types.ts'
import { textRun } from '../contracts/rich-text.ts'

describe('variantOf', () => {
  test('list 만 list 이고 나머지(table · 모르는 값)는 table 이다', () => {
    assert.equal(variantOf('list'), 'list')
    assert.equal(variantOf('table'), 'table')
    assert.equal(variantOf('calendar'), 'table')
  })
})

describe('listColumns', () => {
  const columns: { id: string; type: MvpPropertyType }[] = [
    { id: 'a', type: 'number' },
    { id: 't', type: 'title' },
    { id: 'b', type: 'status' },
  ]

  test('★ List 는 제목이 맨 앞 — 나머지는 뷰 순서 그대로', () => {
    assert.deepEqual(listColumns('list', columns).map((c) => c.id), ['t', 'a', 'b'])
  })

  test('표는 뷰 순서 그대로다 · 원래 배열을 바꾸지 않는다', () => {
    assert.deepEqual(listColumns('table', columns).map((c) => c.id), ['a', 't', 'b'])
    listColumns('list', columns)
    assert.deepEqual(columns.map((c) => c.id), ['a', 't', 'b'])
  })
})

describe('isCollapsed', () => {
  const filled: Record<Exclude<MvpPropertyType, 'title'>, CellValue> = {
    rich_text: { type: 'rich_text', rich_text: [textRun('메모')] },
    number: { type: 'number', number: 0 },
    select: { type: 'select', select: { id: 'o' } },
    status: { type: 'status', status: { id: 'o' } },
    checkbox: { type: 'checkbox', checkbox: true },
    date: { type: 'date', date: { start: '2026-09-20' } },
  }

  test('표에서는 아무것도 접지 않는다', () => {
    for (const type of Object.keys(filled) as (keyof typeof filled)[]) {
      assert.equal(isCollapsed('table', type, emptyValue(type), false), false, type)
    }
  })

  test('★ List 에서 빈 칸은 접고 값이 있는 칸은 세운다 — 숫자 0 도 값이다', () => {
    for (const type of ['rich_text', 'number', 'select', 'status', 'date'] as const) {
      assert.equal(isCollapsed('list', type, emptyValue(type), false), true, `빈 ${type}`)
      assert.equal(isCollapsed('list', type, filled[type], false), false, `값 있는 ${type}`)
    }
  })

  test('★ 선택 · 편집 중인 칸은 비어 있어도 보인다 — 키보드로 옮겨 간 자리가 화면에 있어야 한다', () => {
    for (const type of ['rich_text', 'number', 'select', 'status', 'date'] as const) {
      assert.equal(isCollapsed('list', type, emptyValue(type), true), false, type)
    }
  })

  test('★ 체크박스는 false 여도 접지 않는다 — 접으면 누를 곳이 없다', () => {
    assert.equal(isCollapsed('list', 'checkbox', { type: 'checkbox', checkbox: false }, false), false)
    assert.equal(isCollapsed('list', 'checkbox', filled.checkbox, false), false)
  })

  test('제목은 비어도 접지 않는다 — 항목이 사라지면 안 된다', () => {
    assert.equal(isCollapsed('list', 'title', emptyValue('title'), false), false)
  })
})

describe('isRelationCollapsed (relation 5b-1)', () => {
  const none = { type: 'relation' as const, relation: [], count: 0 }
  // 캐시의 id 가 전부 볼 수 없는 행이어도 count 는 남는다 — 화면이 "볼 수 없는 연결 N개"를 말한다.
  const hiddenOnly = { type: 'relation' as const, relation: [{ id: 'x' }], count: 1 }

  test('★ 연결이 하나도 없을 때만 접는다 — 개수를 본다(그릴 수 있는 칩의 수가 아니다)', () => {
    assert.equal(isRelationCollapsed('list', none, false), true)
    assert.equal(isRelationCollapsed('list', hiddenOnly, false), false)
  })

  test('선택된 칸 · 표에서는 접지 않는다', () => {
    assert.equal(isRelationCollapsed('list', none, true), false)
    assert.equal(isRelationCollapsed('table', none, false), false)
  })
})
