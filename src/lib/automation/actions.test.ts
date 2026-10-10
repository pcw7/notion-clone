/**
 * 자동화 액션의 모양 (5a-1 · F-08-07 · 순수)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ACTION_TYPES, IMPLEMENTED_ACTIONS, MAX_ACTIONS, MAX_CELLS_PER_ACTION, parseActions } from './actions.ts'

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

test('★ add_page_to 의 모양 — 대상 표 · 템플릿(없으면 null) · 셀은 비어도 된다', () => {
  const ds = '11111111-2222-3333-4444-555555555555'
  const tpl = '66666666-7777-8888-9999-000000000000'
  assert.deepEqual(parseActions([{ type: 'add_page_to', config: { v: 1, dataSourceId: ds, cells: [] } }]), {
    ok: true,
    actions: [{ type: 'add_page_to', config: { v: 1, dataSourceId: ds, cells: [], templateId: null } }],
  })
  const withTemplate = parseActions([{ type: 'add_page_to', config: { v: 1, dataSourceId: ds, cells: [cell('a')], templateId: tpl } }])
  assert.ok(withTemplate.ok && withTemplate.actions[0].type === 'add_page_to' && withTemplate.actions[0].config.templateId === tpl)
  for (const config of [{ v: 1, cells: [] }, { v: 1, dataSourceId: '표', cells: [] }, { v: 1, dataSourceId: ds, cells: [], templateId: 7 }]) {
    assert.deepEqual(parseActions([{ type: 'add_page_to', config }]), { ok: false, problem: 'invalid', index: 0 }, JSON.stringify(config))
  }
})

test('★ 상한 · 아직 실행할 수 없는 종류 · 모르는 종류', () => {
  assert.deepEqual(parseActions(Array.from({ length: MAX_ACTIONS + 1 }, () => edit([cell('a')]))), { ok: false, problem: 'too_many_actions' })
  assert.deepEqual(parseActions([edit(Array.from({ length: MAX_CELLS_PER_ACTION + 1 }, (_, i) => cell(`p${i}`)))]), {
    ok: false,
    problem: 'too_many_cells',
    index: 0,
  })
  for (const type of ACTION_TYPES.filter((t) => !IMPLEMENTED_ACTIONS.includes(t))) {
    assert.deepEqual(parseActions([{ type, config: { v: 1 } }]), { ok: false, problem: 'unsupported_action', index: 0 }, type)
  }
  assert.deepEqual(parseActions([{ type: 'drop_table', config: {} }]), { ok: false, problem: 'unsupported_action', index: 0 })
  assert.deepEqual(parseActions('아님'), { ok: false, problem: 'invalid' })
  assert.deepEqual(parseActions([]), { ok: true, actions: [] }, '액션 0개 — 눌러도 아무 일이 없다')
})
