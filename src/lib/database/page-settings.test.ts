/**
 * 페이지 설정의 검사 (3b-1 · F-16-09 · F-16-10)
 *
 *   ① 준 칸만 읽는다(부분) · 모르는 칸은 읽지 않는다
 *   ② 아는 칸의 값이 틀리면 전체가 null — 반쯤 받지 않는다
 *   ③ 기본값은 `page_layout` 칸의 기본값과 같다(0044) — 머리가 없을 때 그것으로 읽는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_PAGE_SETTINGS, parsePageSettings, samePageSettings } from './page-settings.ts'

test('① 준 칸만 읽는다 · 모르는 칸은 읽지 않는다', () => {
  assert.deepEqual(parsePageSettings({}), {})
  assert.deepEqual(parsePageSettings({ fullWidth: true }), { fullWidth: true })
  assert.deepEqual(
    parsePageSettings({ backlinks: 'off', inlineComments: 'minimal', showDiscussions: false, showPropertyIcons: false, fullWidth: false }),
    { backlinks: 'off', inlineComments: 'minimal', showDiscussions: false, showPropertyIcons: false, fullWidth: false },
  )
  assert.deepEqual(parsePageSettings({ fullWidth: true, structure: 'tabbed' }), { fullWidth: true })
})

test('② 아는 칸의 값이 틀리면 null — 객체가 아니어도', () => {
  for (const raw of [null, undefined, 'x', 3, [], { backlinks: 'sometimes' }, { inlineComments: 'loud' }, { fullWidth: 'yes' }, { showDiscussions: 1 }, { fullWidth: true, backlinks: 'never' }]) {
    assert.equal(parsePageSettings(raw), null, JSON.stringify(raw))
  }
})

test('③ 기본값은 0044 의 칸 기본값 — hover · default · 토론 보임 · 아이콘 보임 · 좁게', () => {
  assert.deepEqual(DEFAULT_PAGE_SETTINGS, {
    backlinks: 'hover',
    inlineComments: 'default',
    showDiscussions: true,
    showPropertyIcons: true,
    fullWidth: false,
  })
  assert.equal(samePageSettings(DEFAULT_PAGE_SETTINGS, { ...DEFAULT_PAGE_SETTINGS }), true)
  assert.equal(samePageSettings(DEFAULT_PAGE_SETTINGS, { ...DEFAULT_PAGE_SETTINGS, fullWidth: true }), false)
})
