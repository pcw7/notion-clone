/**
 * 편집기 위의 목록 메뉴 — 루트가 가리킬 것 (10d-3 · F-12-13)
 *
 *   ① ★ 열린 메뉴의 목록 · 지금 항목 — 셋 중 열린 것 · 둘이면 슬래시 · 멘션 · 이모지 차례 · 닫히면 없다
 *   ② 지금 항목은 항목 수 안으로 접는다 · 항목이 없으면 목록만
 *   ③ ★ 루트의 속성 — aria-autocomplete · aria-controls · aria-activedescendant(textbox 가 받는 셋) · 닫히면 없다 · aria-expanded 는 없다
 *   ④ 플러그인 — 메타로 바뀌고 메타가 없으면 그대로 · 루트의 속성으로 나간다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@tiptap/pm/state'

import { blockSchema } from './schema.ts'
import { MENU_IDS, comboboxAttributes, comboboxPlugin, comboboxStateOf, comboboxTarget, sameTarget, setComboboxTarget } from './combobox-a11y.ts'

const closed = { open: false, index: 0, count: 0 }

test('① ★ 열린 메뉴의 목록 · 지금 항목', () => {
  assert.equal(comboboxTarget({ slash: closed, mention: closed, emoji: closed }), null)
  assert.deepEqual(comboboxTarget({ slash: closed, mention: { open: true, index: 1, count: 3 }, emoji: closed }), {
    listboxId: MENU_IDS.mention.listbox,
    activeId: MENU_IDS.mention.option(1),
  })
  assert.deepEqual(comboboxTarget({ slash: { open: true, index: 0, count: 2 }, mention: { open: true, index: 1, count: 3 }, emoji: closed })?.listboxId, MENU_IDS.slash.listbox, '둘이면 슬래시가 먼저')
  assert.equal(comboboxTarget({ slash: closed, mention: closed, emoji: { open: true, index: 0, count: 1 } })?.activeId, 'blk-emoji-option-0')
})

test('② 지금 항목은 항목 수 안으로 · 항목이 없으면 목록만', () => {
  assert.equal(comboboxTarget({ slash: { open: true, index: 9, count: 3 }, mention: closed, emoji: closed })?.activeId, MENU_IDS.slash.option(2))
  assert.deepEqual(comboboxTarget({ slash: closed, mention: { open: true, index: 0, count: 0 }, emoji: closed }), { listboxId: MENU_IDS.mention.listbox, activeId: null })
})

test('③ ★ 루트의 속성', () => {
  assert.deepEqual(comboboxAttributes(null), {})
  assert.deepEqual(comboboxAttributes({ listboxId: 'l', activeId: 'o' }), { 'aria-autocomplete': 'list', 'aria-controls': 'l', 'aria-activedescendant': 'o' })
  assert.deepEqual(comboboxAttributes({ listboxId: 'l', activeId: null }), { 'aria-autocomplete': 'list', 'aria-controls': 'l' })
  assert.equal('aria-expanded' in comboboxAttributes({ listboxId: 'l', activeId: 'o' }), false, 'textbox 의 속성이 아니다')
  assert.equal(sameTarget({ listboxId: 'l', activeId: 'o' }, { listboxId: 'l', activeId: 'o' }), true)
  assert.equal(sameTarget({ listboxId: 'l', activeId: 'o' }, { listboxId: 'l', activeId: 'p' }), false)
  assert.equal(sameTarget(null, null), true)
})

test('④ 플러그인 — 메타로 바뀌고 루트의 속성으로 나간다', () => {
  const plugin = comboboxPlugin()
  let state = EditorState.create({ schema: blockSchema, plugins: [plugin] })
  assert.equal(comboboxStateOf(state), null)
  state = state.apply(setComboboxTarget(state.tr, { listboxId: 'l', activeId: 'o' }))
  assert.deepEqual(comboboxStateOf(state), { listboxId: 'l', activeId: 'o' })
  state = state.apply(state.tr.insertText('x', 1))
  assert.deepEqual(comboboxStateOf(state), { listboxId: 'l', activeId: 'o' }, '메타가 없으면 그대로')
  const attrs = (plugin.props.attributes as (s: EditorState) => Record<string, string>)(state)
  assert.equal(attrs['aria-activedescendant'], 'o')
  state = state.apply(setComboboxTarget(state.tr, null))
  assert.equal(comboboxStateOf(state), null)
})
