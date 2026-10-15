/**
 * Home 의 섹션 — 차례 · 빈 섹션 · 접기 (10c-1 · F-07-19 · 순수)
 *
 *   ① ★ 차례 — 최근 방문 · 즐겨찾기 · 팀스페이스(그 순서대로) · 공유됨 · 개인 · 워크스페이스
 *   ② ★ 빈 섹션은 세우지 않는다(페이지 없는 팀스페이스도) · 모두 비면 빈 목록(화면이 시작 카드)
 *   ③ 같은 페이지가 여러 섹션에 — 빼지 않는다
 *   ④ 처음 보이는 수 · 접힌 수 · 펴면 다
 *   ⑤ 주소 — 데이터베이스면 데이터베이스 화면
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { HOME_SECTION_LIMIT, homeItemHref, homeSections, visibleItems, type HomeItem } from './home-sections.ts'

const item = (id: string): HomeItem => ({ id, title: `제목 ${id}`, icon: null })
const NONE = { recent: [], favorites: [], teamspaces: [], shared: [], privatePages: [], workspacePages: [] }

test('① ★ 차례', () => {
  const sections = homeSections({
    recent: [item('r')],
    favorites: [item('f')],
    teamspaces: [
      { id: 't1', name: '디자인', pages: [item('a')] },
      { id: 't2', name: '개발', pages: [item('b')] },
    ],
    shared: [item('s')],
    privatePages: [item('p')],
    workspacePages: [item('w')],
  })
  assert.deepEqual(sections.map((s) => s.key), ['recent', 'favorites', 'teamspace:t1', 'teamspace:t2', 'shared', 'private', 'workspace'])
  assert.deepEqual(sections.map((s) => s.title), ['최근 방문', '즐겨찾기', '디자인', '개발', '공유된 페이지', '개인 페이지', '워크스페이스 페이지'])
})

test('② ★ 빈 섹션은 세우지 않는다 · 모두 비면 빈 목록', () => {
  assert.deepEqual(homeSections(NONE), [])
  const sections = homeSections({ ...NONE, teamspaces: [{ id: 't', name: '빈 팀', pages: [] }], privatePages: [item('p')] })
  assert.deepEqual(sections.map((s) => s.kind), ['private'], '페이지 없는 팀스페이스도 세우지 않는다')
})

test('③ 같은 페이지가 여러 섹션에 — 빼지 않는다', () => {
  const sections = homeSections({ ...NONE, recent: [item('x')], favorites: [item('x')], workspacePages: [item('x')] })
  assert.deepEqual(sections.map((s) => s.items.map((i) => i.id)), [['x'], ['x'], ['x']])
})

test('④ 처음 보이는 수 · 접힌 수 · 펴면 다', () => {
  const many = Array.from({ length: HOME_SECTION_LIMIT + 3 }, (_, i) => item(String(i)))
  assert.deepEqual([visibleItems(many, false).shown.length, visibleItems(many, false).hidden], [HOME_SECTION_LIMIT, 3])
  assert.deepEqual([visibleItems(many, true).shown.length, visibleItems(many, true).hidden], [many.length, 0])
  const few = many.slice(0, HOME_SECTION_LIMIT)
  assert.deepEqual([visibleItems(few, false).shown.length, visibleItems(few, false).hidden], [HOME_SECTION_LIMIT, 0], '상한까지면 접지 않는다')
})

test('⑤ 주소 — 데이터베이스면 데이터베이스 화면', () => {
  assert.equal(homeItemHref('ws', item('p')), '/w/ws/p')
  assert.equal(homeItemHref('ws', { ...item('d'), kind: 'database' }), '/w/ws/db/d')
})
