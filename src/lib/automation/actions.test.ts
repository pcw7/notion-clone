/**
 * 자동화 액션의 모양 (5a-1 · F-08-07 · 순수)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ACTION_TYPES, MAX_ACTIONS, MAX_CELLS_PER_ACTION, parseActions } from './actions.ts'

const edit = (cells: unknown[]) => ({ type: 'edit_property', config: { v: 1, cells } })
const cell = (propertyId: string) => ({ propertyId, value: { type: 'number', number: 1 } })

test('★ edit_property 의 모양 — 판 · 셀 목록 · 같은 속성 두 번은 안 된다', () => {
  const ok = parseActions([edit([cell('a'), cell('b')])])
  assert.ok(ok.ok)
  assert.deepEqual(ok.actions, [{ type: 'edit_property', config: { v: 1, cells: [cell('a'), cell('b')] } }])
  assert.deepEqual(parseActions([edit([cell('a'), cell('a')])]), { ok: false, problem: 'invalid', index: 0 })
  assert.deepEqual(parseActions([{ type: 'edit_property', config: { v: 2, cells: [cell('a')] } }]), { ok: false, problem: 'invalid', index: 0 })
  assert.deepEqual(parseActions([edit([{ propertyId: 'a' }])]), { ok: false, problem: 'invalid', index: 0 })
  assert.deepEqual(parseActions([edit([])]), { ok: false, problem: 'empty_cells', index: 0 })
})

test('★ 상한 · 아직 실행할 수 없는 종류 · 모르는 종류', () => {
  assert.deepEqual(parseActions(Array.from({ length: MAX_ACTIONS + 1 }, () => edit([cell('a')]))), { ok: false, problem: 'too_many_actions' })
  assert.deepEqual(parseActions([edit(Array.from({ length: MAX_CELLS_PER_ACTION + 1 }, (_, i) => cell(`p${i}`)))]), {
    ok: false,
    problem: 'too_many_cells',
    index: 0,
  })
  for (const type of ACTION_TYPES.filter((t) => t !== 'edit_property')) {
    assert.deepEqual(parseActions([{ type, config: { v: 1 } }]), { ok: false, problem: 'unsupported_action', index: 0 }, type)
  }
  assert.deepEqual(parseActions([{ type: 'drop_table', config: {} }]), { ok: false, problem: 'unsupported_action', index: 0 })
  assert.deepEqual(parseActions('아님'), { ok: false, problem: 'invalid' })
  assert.deepEqual(parseActions([]), { ok: true, actions: [] }, '액션 0개 — 눌러도 아무 일이 없다')
})
