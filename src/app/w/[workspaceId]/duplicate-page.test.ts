/**
 * "복제"가 사람에게 말하는 법 — 복제 6b조각 (F-02-09, DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **빠진 것이 있으면 멈춰서 말한다** — 사본으로 옮겨 가면 그 말이 화면과 함께 사라진다
 *   ② 빠진 것이 없으면 말하지 않고 옮겨 간다 — 잘된 일에 문구를 띄우지 않는다
 *   ③ 실패의 이유는 서버의 어휘를 사람의 말로 옮긴다. 모르는 이유도 문장이 된다(빈 화면이 아니라)
 *
 * 반사실(HANDOFF §3.3-174): 빠진 것이 있어도 옮겨 가게 하면 ①, 모르는 이유에 빈 문자열을 주면 ③ 이 실패한다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { duplicateError, duplicateNote } from './duplicate-page.ts'

describe('① · ② 복제한 뒤 할 말', () => {
  test('★ 빠진 하위 페이지가 있으면 **멈춰서** 개수를 말한다', () => {
    const note = duplicateNote(2)
    assert.equal(note.navigate, false, '옮겨 가면 이 말이 사라진다')
    assert.match(note.text ?? '', /2개/)
    assert.match(note.text ?? '', /복제하지 못했/)
  })

  test('★ 빠진 것이 없으면 말하지 않고 사본으로 옮겨 간다', () => {
    assert.deepEqual(duplicateNote(0), { text: null, navigate: true })
  })

  test('음수 · NaN 도 "없음"으로 읽는다 — 서버가 주지 않은 값이 문구를 만들지 않게', () => {
    assert.equal(duplicateNote(-1).navigate, true)
    assert.equal(duplicateNote(Number.NaN).navigate, true)
  })

  test('하나만 빠져도 말한다 — 개수는 그대로 쓴다', () => {
    assert.match(duplicateNote(1).text ?? '', /1개/)
  })
})

describe('③ 실패의 이유', () => {
  test('★ 서버의 어휘를 사람의 말로 — 이유마다 다른 문장이다', () => {
    const codes = ['not_found', 'target_not_found', 'cycle', 'too_deep', 'too_large']
    const said = codes.map((code) => duplicateError(400, code))
    assert.equal(new Set(said).size, codes.length, '같은 문장을 두 이유에 쓰지 않는다')
    for (const text of said) assert.ok(text.length > 0)
    assert.match(duplicateError(413, 'too_large'), /너무 커서/)
    assert.match(duplicateError(400, 'cycle'), /자기 자신/)
  })

  test('★ 모르는 이유도 문장이 된다 — 500 은 서버 탓이라고 말한다', () => {
    assert.match(duplicateError(500, undefined), /서버/)
    assert.equal(duplicateError(400, 'nonsense').length > 0, true)
    assert.equal(duplicateError(400, null).length > 0, true)
  })
})
