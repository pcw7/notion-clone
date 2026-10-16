/**
 * Library — 탭 · 검색어 · 펴기 · 이름 맞추기 · 주소 (10c-2 · F-07-19 · 순수)
 *
 *   ① 탭 — 여섯 · 모르는 값은 기본(최근 방문) · 이름이 모두 다르다
 *   ② 검색어 — 공백을 접고 다듬고 100자
 *   ③ ★ 트리를 편다 — 부모 다음에 그 아래 · 루트의 위치는 무리의 이름 · 그 아래는 부모의 제목(없으면 "제목 없음") · 종류를 지닌다
 *   ④ ★ 이름 맞추기 — 대소문자 무시 · 제목 없는 페이지는 "제목 없음" 으로 · 빈 말이면 모두
 *   ⑤ 주소 — 기본 탭 · 빈 검색어는 뺀다 · 데이터베이스 항목은 데이터베이스 화면
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_LIBRARY_TAB,
  LIBRARY_TABS,
  MAX_LIBRARY_QUERY,
  flattenTree,
  libraryHref,
  libraryItemHref,
  libraryTabLabel,
  matchesName,
  normalizeLibraryQuery,
  normalizeLibraryTab,
} from './library.ts'

const node = (id: string, title: string, children: ReturnType<typeof node>[] = [], kind: 'page' | 'database' = 'page') => ({ id, title, icon: null, kind, children })

test('① 탭', () => {
  assert.equal(DEFAULT_LIBRARY_TAB, 'recent')
  for (const tab of LIBRARY_TABS) assert.equal(normalizeLibraryTab(tab), tab)
  for (const raw of ['', 'all', null, 3, undefined]) assert.equal(normalizeLibraryTab(raw), 'recent', String(raw))
  assert.equal(new Set(LIBRARY_TABS.map(libraryTabLabel)).size, LIBRARY_TABS.length)
})

test('② 검색어', () => {
  assert.equal(normalizeLibraryQuery('  회의   노트 '), '회의 노트')
  assert.equal(normalizeLibraryQuery(null), '')
  assert.equal(normalizeLibraryQuery('가'.repeat(MAX_LIBRARY_QUERY + 20)).length, MAX_LIBRARY_QUERY)
})

test('③ ★ 트리를 편다', () => {
  const items = flattenTree([node('a', '위', [node('b', '', [node('c', '깊이')]), node('d', '표', [], 'database')]), node('e', '둘째')], '디자인 팀')
  assert.deepEqual(items.map((i) => i.id), ['a', 'b', 'c', 'd', 'e'], '부모 다음에 그 아래')
  assert.deepEqual(items.map((i) => i.where), ['디자인 팀', '위', '제목 없음', '위', '디자인 팀'])
  assert.equal(items.find((i) => i.id === 'd')?.kind, 'database')
})

test('④ ★ 이름 맞추기', () => {
  assert.equal(matchesName({ title: 'Weekly 회의' }, 'weekly'), true, '대소문자 무시')
  assert.equal(matchesName({ title: 'Weekly 회의' }, '회의'), true)
  assert.equal(matchesName({ title: 'Weekly 회의' }, '노트'), false)
  assert.equal(matchesName({ title: '' }, '제목 없'), true, '제목 없는 페이지는 "제목 없음" 으로')
  assert.equal(matchesName({ title: '' }, ''), true, '빈 말이면 모두')
})

test('⑤ 주소', () => {
  assert.equal(libraryHref('ws', {}), '/w/ws/library')
  assert.equal(libraryHref('ws', { tab: 'recent', q: '' }), '/w/ws/library', '기본 탭 · 빈 검색어는 뺀다')
  assert.equal(libraryHref('ws', { tab: 'private', q: '회의 노트' }), '/w/ws/library?tab=private&q=%ED%9A%8C%EC%9D%98+%EB%85%B8%ED%8A%B8')
  assert.equal(libraryItemHref('ws', { id: 'p', kind: 'page' }), '/w/ws/p')
  assert.equal(libraryItemHref('ws', { id: 'd', kind: 'database' }), '/w/ws/db/d')
})
