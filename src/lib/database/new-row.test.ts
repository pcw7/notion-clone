/**
 * `New ▾` 의 문구 — 템플릿 6c-4조각 (F-08-02 · F-08-03, DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 기본 템플릿이 있으면 버튼이 그 이름을 말한다 — 그냥 누르면 무엇이 만들어지는지(F-08-03)
 *   ② 템플릿으로 만든 행에 빠진 것이 있으면 **말한다** · 없으면 말하지 않는다(§3.3-174)
 *   ③ 개수가 `NaN` 이어도 "NaN개"가 새지 않는다
 *
 * 문구는 글자 그대로 비교한다 — 상수로 비교하면 상수를 비워도 따라 비어 통과한다(§6).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { newRowLabel, templateRowNote } from './new-row.ts'

describe('newRowLabel', () => {
  test('★ 기본 템플릿이 없으면 빈 항목을 만든다고 말한다', () => {
    assert.equal(newRowLabel(null), '+ 새로 만들기')
  })

  test('★ 기본 템플릿이 있으면 그 이름을 붙인다', () => {
    assert.equal(newRowLabel({ id: 't', title: '주간 회의' }), '+ 새 주간 회의')
  })

  test('이름이 비었거나 공백뿐이면 "제목 없음" 이다 — "+ 새 " 로 끝나지 않는다', () => {
    assert.equal(newRowLabel({ id: 't', title: '' }), '+ 새 제목 없음')
    assert.equal(newRowLabel({ id: 't', title: '   ' }), '+ 새 제목 없음')
  })
})

describe('templateRowNote', () => {
  test('★ 빠진 것이 없으면 말하지 않는다', () => {
    assert.equal(templateRowNote(0, 0), null)
  })

  test('★ 하위 페이지 · 연결이 빠지면 각각 개수로 말한다', () => {
    assert.equal(
      templateRowNote(2, 0),
      '템플릿으로 만들었습니다. 볼 수 없는 하위 페이지 2개는 복제하지 못했습니다.',
    )
    assert.equal(
      templateRowNote(0, 3),
      '템플릿으로 만들었습니다. 볼 수 없는 항목 3개에는 연결하지 않았습니다.',
    )
    assert.equal(
      templateRowNote(1, 1),
      '템플릿으로 만들었습니다. 볼 수 없는 하위 페이지 1개는 복제하지 못했습니다 · 볼 수 없는 항목 1개에는 연결하지 않았습니다.',
    )
  })

  test('★ 개수가 NaN · 음수여도 "NaN개" 가 새지 않는다', () => {
    assert.equal(templateRowNote(Number.NaN, Number.NaN), null)
    assert.equal(templateRowNote(-1, 0), null)
    assert.ok(!(templateRowNote(Number.NaN, 2) ?? '').includes('NaN'))
  })
})
