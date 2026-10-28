/**
 * 하위 항목의 표시 범위 · 방식 — 저장값 ↔ 값 · 고르개의 이름 (23번 트랙 P-1 · P-2 · P-3 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 P-1] ① ④ ⑦
 *
 *   ① ★ 기본은 NULL 하나 — 읽기는 NULL · 모르는 값을 `both` 로, 쓰기는 `both` 를 NULL 로(CHECK 0119 와 같은 규칙)
 *   ② 고르개 — 셋 모두 이름과 한 줄이 있고, 이름은 노션의 셋 그대로
 *   ③ ★ 표시 방식(P-3) — 기본(토글로 중첩)은 NULL 하나 · 평평한 목록이면 범위 고르개가 "포함" 이고 한 줄이 들어오는 행을 말한다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SUB_ITEM_FILTER_SCOPES,
  isSubItemDisplay,
  isSubItemFilterScope,
  readSubItemDisplay,
  readSubItemFilterScope,
  storedSubItemDisplay,
  storedSubItemFilterScope,
  subItemScopeCaption,
  subItemScopeHintFor,
  subItemFilterScopeHint,
  subItemFilterScopeLabel,
} from './sub-item-scope.ts'

test('① ★ 기본은 NULL 하나 — 읽기는 NULL · 모르는 값을 both 로, 쓰기는 both 를 NULL 로', () => {
  assert.equal(readSubItemFilterScope(null), 'both')
  assert.equal(readSubItemFilterScope('both'), 'both', '적혀 있어도(CHECK 이 막지만) 기본으로 읽는다')
  assert.equal(readSubItemFilterScope('sideways'), 'both')
  assert.equal(readSubItemFilterScope('parents'), 'parents')
  assert.equal(readSubItemFilterScope('sub_items'), 'sub_items')
  assert.equal(storedSubItemFilterScope('both'), null)
  assert.equal(storedSubItemFilterScope('parents'), 'parents')
  assert.equal(storedSubItemFilterScope('sub_items'), 'sub_items')
  assert.equal(isSubItemFilterScope('both'), true)
  assert.equal(isSubItemFilterScope('children'), false)
  assert.equal(isSubItemFilterScope(null), false)
})

test('② 고르개 — 셋 모두 이름과 한 줄이 있다', () => {
  assert.deepEqual(SUB_ITEM_FILTER_SCOPES.map(subItemFilterScopeLabel), ['부모와 하위 항목', '부모만', '하위 항목만'])
  for (const scope of SUB_ITEM_FILTER_SCOPES) assert.ok(subItemFilterScopeHint(scope).length > 0, scope)
})

test('③ ★ 표시 방식(P-3) — 기본은 NULL 하나 · 평평한 목록이면 "포함"', () => {
  assert.equal(readSubItemDisplay(null), 'nested')
  assert.equal(readSubItemDisplay('card'), 'nested')
  assert.equal(readSubItemDisplay('flattened'), 'flattened')
  assert.equal(storedSubItemDisplay('nested'), null)
  assert.equal(storedSubItemDisplay('flattened'), 'flattened')
  assert.equal(isSubItemDisplay('flattened'), true)
  assert.equal(isSubItemDisplay('card'), false)
  assert.equal(subItemScopeCaption('nested'), '필터 적용')
  assert.equal(subItemScopeCaption('flattened'), '포함')
  assert.equal(subItemScopeHintFor('flattened', 'sub_items'), '하위 항목만 보입니다')
  assert.notEqual(subItemScopeHintFor('nested', 'sub_items'), subItemScopeHintFor('flattened', 'sub_items'))
})
