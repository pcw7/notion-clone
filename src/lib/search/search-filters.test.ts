/**
 * 검색 필터 — 값 다듬기 (10a-1 · F-07-03 · 순수)
 *
 *   ① 받는 값 — 제목만(참 · '1' · 'true') · 내가 만든('me') · 기간(넷) · 이 페이지 아래(uuid — 소문자로)
 *   ② 틀린 값은 그 필터가 없는 것 — 400 을 내지 않는다
 *   ③ 검색어 없이 찾을 수 있는가 — 좁히는 필터가 있을 때만(제목만은 세지 않는다)
 *   ④ 덮개(10a-2) — 걸린 필터의 수 · 라우트의 쿼리(걸린 것만) · 페이지 화면의 페이지 id
 *   ⑤ ★ 사람 · 팀스페이스(10a-3a) — 만든 사람 · 최종 편집자는 'me' 또는 사람 id · 팀스페이스는 uuid · 셋 모두 좁힌다 · 수와 쿼리에 든다
 *   ⑥ ★ 덮개가 거는 필터(10a-3b) — 이 페이지 안에서는 지금 페이지일 때만 · 팀스페이스는 후보에 있고 요금제가 허락할 때만 · 나머지는 그대로
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EDITED_RANGE_DAYS,
  NO_SEARCH_FILTERS,
  activeFilterCount,
  effectiveSearchFilters,
  narrowsWithoutQuery,
  normalizeSearchFilters,
  pageIdInPath,
  searchFilterParams,
} from './search-filters.ts'

const PAGE = '0190A3F1-1111-7000-8000-000000000001'
const PERSON = '0190A3F1-2222-7000-8000-000000000002'
const TEAMSPACE = '0190A3F1-3333-7000-8000-000000000003'

test('① 받는 값', () => {
  assert.deepEqual(normalizeSearchFilters({ titleOnly: '1', createdBy: 'me', edited: 'week', within: PAGE }), {
    titleOnly: true,
    createdBy: 'me',
    editedBy: null,
    edited: 'week',
    within: PAGE.toLowerCase(),
    teamspace: null,
  })
  assert.equal(normalizeSearchFilters({ titleOnly: true }).titleOnly, true)
  assert.equal(normalizeSearchFilters({ titleOnly: 'true' }).titleOnly, true)
  assert.deepEqual(EDITED_RANGE_DAYS, { day: 1, week: 7, month: 30, year: 365 })
})

test('② 틀린 값은 그 필터가 없는 것', () => {
  assert.deepEqual(normalizeSearchFilters({}), NO_SEARCH_FILTERS)
  assert.deepEqual(
    normalizeSearchFilters({ titleOnly: '0', createdBy: 'someone', editedBy: 'ME', edited: 'decade', within: 'not-a-uuid', teamspace: 'all' }),
    NO_SEARCH_FILTERS,
  )
  assert.equal(normalizeSearchFilters({ within: `${PAGE}' OR 1=1 --` }).within, null, '주입처럼 보이는 값도 그대로 버린다')
})

test('③ 검색어 없이 찾을 수 있는가', () => {
  assert.equal(narrowsWithoutQuery(NO_SEARCH_FILTERS), false)
  assert.equal(narrowsWithoutQuery({ ...NO_SEARCH_FILTERS, titleOnly: true }), false, '제목만은 검색어가 있어야 뜻이 있다')
  for (const patch of [{ createdBy: 'me' as const }, { edited: 'day' as const }, { within: PAGE }]) {
    assert.equal(narrowsWithoutQuery({ ...NO_SEARCH_FILTERS, ...patch }), true, JSON.stringify(patch))
  }
})

test('④ 덮개(10a-2) — 걸린 필터의 수 · 라우트의 쿼리 · 페이지 화면의 페이지 id', () => {
  const all = normalizeSearchFilters({ titleOnly: true, createdBy: 'me', edited: 'month', within: PAGE })
  assert.equal(activeFilterCount(NO_SEARCH_FILTERS), 0)
  assert.equal(activeFilterCount(all), 4)
  assert.deepEqual(searchFilterParams(NO_SEARCH_FILTERS), [], '걸린 것만')
  assert.deepEqual(searchFilterParams(all), [['titleOnly', '1'], ['createdBy', 'me'], ['edited', 'month'], ['within', PAGE.toLowerCase()]])
  assert.deepEqual(normalizeSearchFilters(Object.fromEntries(searchFilterParams(all))), all, '라우트가 같은 값으로 다시 읽는다')
  assert.equal(pageIdInPath(`/w/ws/${PAGE}`), PAGE.toLowerCase())
  for (const path of ['/w/ws', `/w/ws/db/${PAGE}`, `/w/ws/${PAGE}/x`, '/w/ws/settings', null]) assert.equal(pageIdInPath(path), null, String(path))
})

test('⑤ ★ 사람 · 팀스페이스(10a-3a)', () => {
  const all = normalizeSearchFilters({ createdBy: PERSON, editedBy: 'me', teamspace: TEAMSPACE })
  assert.equal(all.createdBy, PERSON.toLowerCase(), '사람 id — 소문자로')
  assert.equal(all.editedBy, 'me')
  assert.equal(all.teamspace, TEAMSPACE.toLowerCase())
  assert.equal(normalizeSearchFilters({ editedBy: PERSON }).editedBy, PERSON.toLowerCase())
  assert.equal(normalizeSearchFilters({ createdBy: `${PERSON} ` }).createdBy, null, '모양이 틀리면 버린다')
  for (const patch of [{ editedBy: 'me' }, { editedBy: PERSON }, { createdBy: PERSON }, { teamspace: TEAMSPACE }]) {
    assert.equal(narrowsWithoutQuery({ ...NO_SEARCH_FILTERS, ...patch }), true, JSON.stringify(patch))
  }
  assert.equal(activeFilterCount(all), 3)
  assert.deepEqual(searchFilterParams(all), [['createdBy', PERSON.toLowerCase()], ['editedBy', 'me'], ['teamspace', TEAMSPACE.toLowerCase()]])
  assert.deepEqual(normalizeSearchFilters(Object.fromEntries(searchFilterParams(all))), all, '라우트가 같은 값으로 다시 읽는다')
})

test('⑥ ★ 덮개가 거는 필터(10a-3b)', () => {
  const chosen = normalizeSearchFilters({ titleOnly: true, createdBy: PERSON, editedBy: 'me', edited: 'week', within: PAGE, teamspace: TEAMSPACE })
  const here = { currentPageId: PAGE.toLowerCase(), teamspaceIds: [TEAMSPACE.toLowerCase()], teamspaceAllowed: true }
  assert.deepEqual(effectiveSearchFilters(chosen, here), chosen, '맥락이 맞으면 고른 그대로')
  const moved = effectiveSearchFilters(chosen, { ...here, currentPageId: null })
  assert.equal(moved.within, null, '다른 화면 — 이 페이지 안에서는 효과가 없다')
  assert.equal(moved.teamspace, chosen.teamspace)
  assert.equal(effectiveSearchFilters(chosen, { ...here, teamspaceIds: [] }).teamspace, null, '후보에서 빠진 팀스페이스(나갔다 · 보관)')
  assert.equal(effectiveSearchFilters(chosen, { ...here, teamspaceAllowed: false }).teamspace, null, '요금제가 허락하지 않는다')
  const rest = effectiveSearchFilters(chosen, { currentPageId: null, teamspaceIds: [], teamspaceAllowed: false })
  assert.deepEqual([rest.titleOnly, rest.createdBy, rest.editedBy, rest.edited], [true, PERSON.toLowerCase(), 'me', 'week'], '나머지는 그대로')
})
