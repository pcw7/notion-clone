/**
 * 페이지 열기 모드 — 주소 (게시 · 공유 8n-1 · F-02-20 · 순수)
 *
 *   ① 데이터베이스 화면의 주소 — 뷰 · 검색 · 달만 지닌다(빈 값은 뺀다 · 글자는 주소에 맞게)
 *   ② ★ 행을 여는 주소 — 전체 페이지면 행 화면 · 아니면 그 주소에 peek(있으면 바꾼다 — 쌓지 않는다)
 *   ③ 열기 방식의 값 — 셋만
 *   ④ 고르개의 이름(8n-2) — 셋 모두 다른 말
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_OPEN_PAGES_IN, OPEN_PAGES_IN, databaseHref, isOpenPagesIn, openPagesInLabel, rowOpenHref } from './open-pages.ts'

test('① 데이터베이스 화면의 주소', () => {
  assert.equal(databaseHref('ws', 'db', {}), '/w/ws/db/db')
  assert.equal(databaseHref('ws', 'db', { v: 'view', q: '', m: null }), '/w/ws/db/db?v=view')
  assert.equal(databaseHref('ws', 'db', { v: 'view', q: '김 하나&', m: '2026-10' }), '/w/ws/db/db?v=view&q=%EA%B9%80+%ED%95%98%EB%82%98%26&m=2026-10')
})

test('② ★ 행을 여는 주소 — 전체 페이지 · 피크(쌓지 않는다)', () => {
  assert.equal(rowOpenHref('ws', 'row', null), '/w/ws/row', '전체 페이지')
  assert.equal(rowOpenHref('ws', 'row', '/w/ws/db/db'), '/w/ws/db/db?peek=row')
  assert.equal(rowOpenHref('ws', 'row', '/w/ws/db/db?v=view&q=a'), '/w/ws/db/db?v=view&q=a&peek=row', '뷰 · 검색을 지닌 채')
  assert.equal(rowOpenHref('ws', 'two', '/w/ws/db/db?v=view&peek=one'), '/w/ws/db/db?v=view&peek=two', '바꿔 연다 — 쌓지 않는다')
})

test('③ 열기 방식의 값', () => {
  assert.equal(DEFAULT_OPEN_PAGES_IN, 'side_peek')
  for (const value of ['side_peek', 'center_peek', 'full_page']) assert.equal(isOpenPagesIn(value), true, value)
  for (const value of ['peek', '', null, 1]) assert.equal(isOpenPagesIn(value), false, String(value))
})

test('④ 고르개의 이름(8n-2) — 셋 모두 다른 말', () => {
  assert.equal(new Set(OPEN_PAGES_IN.map(openPagesInLabel)).size, 3)
  assert.match(openPagesInLabel('full_page'), /전체 페이지/)
})
