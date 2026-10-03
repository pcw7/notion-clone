/**
 * 페이지의 경로 — 잔여 묶음 8b-2 (F-01-16 · 순수 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것(`breadcrumb.ts` 머리말).
 *
 *   ① ★ 줄의 순서 — 워크스페이스 · teamspace(받았을 때만) · 조상(받은 순서 그대로) · 지금 페이지(링크 아님)
 *   ② 제목이 빈 페이지는 '제목 없음' · 링크 주소
 *   ③ 템플릿 편집 화면의 경로 — 워크스페이스 · 표 · 템플릿
 *   ④ ★ 같은 경로인가 — 새 배열이어도 내용이 같으면 같다(노드 뷰가 다시 그리지 않게)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { breadcrumbTrail, sameTrail, templateTrail } from './breadcrumb.ts'

const WS = '00000000-0000-4000-8000-0000000000aa'
const TS = '00000000-0000-4000-8000-0000000000bb'
const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
const C = '00000000-0000-4000-8000-000000000003'

describe('① ② 페이지의 경로', () => {
  test('★ 워크스페이스 · teamspace · 조상 · 지금 페이지 — 지금 페이지는 링크가 아니다', () => {
    const trail = breadcrumbTrail({
      workspaceId: WS,
      teamspace: { id: TS, name: '제품팀' },
      ancestors: [{ id: A, plainTitle: '기획' }, { id: B, plainTitle: '' }],
      page: { id: C, plainTitle: '회의록' },
    })
    assert.deepEqual(trail.map((i) => [i.kind, i.label, i.href]), [
      ['workspace', '워크스페이스', `/w/${WS}`],
      ['teamspace', '제품팀', `/w/${WS}/teamspaces/${TS}`],
      ['page', '기획', `/w/${WS}/${A}`],
      ['page', '제목 없음', `/w/${WS}/${B}`],
      ['current', '회의록', null],
    ])
  })

  test('teamspace 를 받지 않으면(멤버가 아니다 · 워크스페이스 직속) 세우지 않는다 · 최상위 페이지는 둘뿐', () => {
    const trail = breadcrumbTrail({ workspaceId: WS, teamspace: null, ancestors: [], page: { id: C, plainTitle: '' } })
    assert.deepEqual(trail.map((i) => [i.kind, i.label]), [['workspace', '워크스페이스'], ['current', '제목 없음']])
  })
})

describe('③ 템플릿', () => {
  test('템플릿 편집 화면 — 워크스페이스 · 표 · 템플릿', () => {
    const trail = templateTrail({ workspaceId: WS, database: { id: A, name: '', icon: null }, templateId: C })
    assert.deepEqual(trail.map((i) => [i.kind, i.label, i.href]), [
      ['workspace', '워크스페이스', `/w/${WS}`],
      ['database', '제목 없음', `/w/${WS}/db/${A}`],
      ['current', '템플릿', null],
    ])
  })

  test('표의 아이콘(8c-3b)을 그 줄에 싣는다 — 없으면 null', () => {
    const books = { type: 'emoji', emoji: '📚' } as const
    const trail = templateTrail({ workspaceId: WS, database: { id: A, name: '서가', icon: books }, templateId: C })
    assert.deepEqual(trail.map((i) => [i.kind, i.icon]), [['workspace', null], ['database', books], ['current', null]])
  })
})

describe('④ 같은 경로', () => {
  test('★ 새 배열이어도 내용이 같으면 같다 — 이름 · 주소 · 줄 수 · 종류가 다르면 다르다', () => {
    const input = { workspaceId: WS, teamspace: null, ancestors: [{ id: A, plainTitle: '기획' }], page: { id: C, plainTitle: '회의록' } }
    const a = breadcrumbTrail(input)
    assert.equal(sameTrail(a, breadcrumbTrail(input)), true)
    assert.equal(sameTrail(a, breadcrumbTrail({ ...input, page: { id: C, plainTitle: '회의록 2' } })), false)
    assert.equal(sameTrail(a, breadcrumbTrail({ ...input, ancestors: [] })), false)
    assert.equal(sameTrail(a, breadcrumbTrail({ ...input, teamspace: { id: TS, name: '팀' } })), false)
    assert.equal(sameTrail(a, null), false)
    assert.equal(sameTrail(null, null), true)
  })
})
