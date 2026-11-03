// 페이지의 모습(36번 트랙 PL-1 · F-02-07 · 정본 §3.4 [보강 PL-1]).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DEFAULT_PAGE_APPEARANCE, appearanceFormatEntries, pageAppearanceOfFormat, parsePageAppearancePatch, samePageAppearance } from './page-appearance.ts'

describe('읽기 · 받기 · 적기', () => {
  test('★ 기본값이면 키가 없다 — 서체는 serif · mono 만 · 토글은 켰을 때만 true', () => {
    assert.deepEqual(appearanceFormatEntries(DEFAULT_PAGE_APPEARANCE), { page_font: null, page_small_text: null, page_full_width: null })
    assert.deepEqual(appearanceFormatEntries({ font: 'mono', smallText: true, fullWidth: false }), { page_font: 'mono', page_small_text: true, page_full_width: null })
    assert.deepEqual(pageAppearanceOfFormat({ page_font: 'serif', page_full_width: true }), { font: 'serif', smallText: false, fullWidth: true })
    assert.deepEqual(pageAppearanceOfFormat({ page_font: 'comic', page_small_text: 'yes' }), DEFAULT_PAGE_APPEARANCE, '모르는 값은 기본(관대하게)')
    assert.deepEqual(pageAppearanceOfFormat(null), DEFAULT_PAGE_APPEARANCE)
  })

  test('받기는 준 칸만 · 틀린 값 · 빈 객체는 null · 모르는 칸은 읽지 않는다', () => {
    assert.deepEqual(parsePageAppearancePatch({ font: 'serif' }), { font: 'serif' })
    assert.deepEqual(parsePageAppearancePatch({ smallText: true, other: 1 }), { smallText: true })
    for (const bad of [{ font: 'comic' }, { fullWidth: 'yes' }, {}, null, [], 'serif']) assert.equal(parsePageAppearancePatch(bad), null, JSON.stringify(bad))
    assert.equal(samePageAppearance(DEFAULT_PAGE_APPEARANCE, { font: 'default', smallText: false, fullWidth: false }), true)
  })
})
