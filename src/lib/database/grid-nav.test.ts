/**
 * 표 그리드 키보드 내비게이션 — W8-b (F-03-16, DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① F-03-16 의 키 규약: 화살표 · Tab · Enter · Esc
 *   ② **편집 중의 Enter 는 저장하고 아래 칸이다.** 선택 중의 Enter 는 편집 시작이다
 *   ③ **표 끝의 Tab 은 표 밖으로 보낸다**(선택 중) — 키보드 사용자를 가두지 않는다
 *   ④ **IME 조합 중에는 아무것도 하지 않는다** — 한글 마지막 글자가 사라진다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { clampPos, handleGridKey, type GridMode, type GridSize } from './grid-nav.ts'

const size: GridSize = { rows: 3, cols: 4 }
const selected = (row: number, col: number): GridMode => ({ kind: 'selected', at: { row, col } })
const editing = (row: number, col: number): GridMode => ({ kind: 'editing', at: { row, col } })

describe('선택 상태 — 이동', () => {
  test('화살표로 한 칸씩 움직인다', () => {
    assert.deepEqual(handleGridKey(selected(1, 1), { key: 'ArrowUp' }, size).mode, selected(0, 1))
    assert.deepEqual(handleGridKey(selected(1, 1), { key: 'ArrowDown' }, size).mode, selected(2, 1))
    assert.deepEqual(handleGridKey(selected(1, 1), { key: 'ArrowLeft' }, size).mode, selected(1, 0))
    assert.deepEqual(handleGridKey(selected(1, 1), { key: 'ArrowRight' }, size).mode, selected(1, 2))
  })

  test('★ 경계에서는 멈추지만 키는 처리한다 — 안 그러면 페이지가 스크롤된다', () => {
    const r = handleGridKey(selected(0, 0), { key: 'ArrowUp' }, size)
    assert.deepEqual(r.mode, selected(0, 0))
    assert.equal(r.handled, true)
  })

  test('Tab 은 오른쪽, 줄 끝이면 다음 줄 첫 칸', () => {
    assert.deepEqual(handleGridKey(selected(0, 1), { key: 'Tab' }, size).mode, selected(0, 2))
    assert.deepEqual(handleGridKey(selected(0, 3), { key: 'Tab' }, size).mode, selected(1, 0))
  })

  test('Shift+Tab 은 왼쪽, 줄 처음이면 윗줄 마지막 칸', () => {
    assert.deepEqual(handleGridKey(selected(1, 2), { key: 'Tab', shift: true }, size).mode, selected(1, 1))
    assert.deepEqual(handleGridKey(selected(1, 0), { key: 'Tab', shift: true }, size).mode, selected(0, 3))
  })

  test('★ 표 끝의 Tab 은 처리하지 않는다 — 브라우저가 다음 포커스로 넘긴다 (WCAG 2.1.2)', () => {
    const last = handleGridKey(selected(2, 3), { key: 'Tab' }, size)
    assert.equal(last.handled, false)
    assert.deepEqual(last.mode, { kind: 'idle' })

    const first = handleGridKey(selected(0, 0), { key: 'Tab', shift: true }, size)
    assert.equal(first.handled, false)
    assert.deepEqual(first.mode, { kind: 'idle' })
  })

  test('Esc 는 선택을 푼다', () => {
    const r = handleGridKey(selected(1, 1), { key: 'Escape' }, size)
    assert.deepEqual(r.mode, { kind: 'idle' })
    assert.equal(r.handled, true)
  })
})

describe('선택 상태 — 동작', () => {
  test('★ Enter 는 편집을 시작한다 — 아래 칸으로 가는 것은 편집 중의 Enter 다', () => {
    const r = handleGridKey(selected(1, 2), { key: 'Enter' }, size)
    assert.deepEqual(r.mode, editing(1, 2))
    assert.equal(r.effect, 'edit')
    assert.deepEqual(r.target, { row: 1, col: 2 })
  })

  test('F2 도 편집을 시작한다 (스프레드시트 관례)', () => {
    assert.equal(handleGridKey(selected(0, 0), { key: 'F2' }, size).effect, 'edit')
  })

  test('Backspace · Delete 는 칸을 비운다', () => {
    for (const key of ['Backspace', 'Delete']) {
      const r = handleGridKey(selected(2, 1), { key }, size)
      assert.equal(r.effect, 'clear')
      assert.deepEqual(r.target, { row: 2, col: 1 })
      assert.deepEqual(r.mode, selected(2, 1))
    }
  })

  test('★ Ctrl/Cmd 조합은 처리하지 않는다 — 복사·붙여넣기를 막으면 안 된다', () => {
    for (const key of ['c', 'v', 'z', 'ArrowDown', 'Enter']) {
      const r = handleGridKey(selected(1, 1), { key, mod: true }, size)
      assert.equal(r.handled, false, key)
      assert.deepEqual(r.mode, selected(1, 1))
    }
  })

  test('글자 키는 처리하지 않는다', () => {
    assert.equal(handleGridKey(selected(1, 1), { key: 'a' }, size).handled, false)
  })
})

describe('편집 상태', () => {
  test('★ Enter 는 저장하고 아래 칸을 선택한다 (F-03-16 "Enter 아래 셀")', () => {
    const r = handleGridKey(editing(0, 2), { key: 'Enter' }, size)
    assert.equal(r.effect, 'commit')
    assert.deepEqual(r.target, { row: 0, col: 2 }, '저장 대상은 편집하던 칸이다')
    assert.deepEqual(r.mode, selected(1, 2))
  })

  test('마지막 줄의 Enter 는 제자리에 머문다 — 새 행을 몰래 만들지 않는다', () => {
    const r = handleGridKey(editing(2, 1), { key: 'Enter' }, size)
    assert.equal(r.effect, 'commit')
    assert.deepEqual(r.mode, selected(2, 1))
  })

  test('Tab 은 저장하고 오른쪽, Shift+Tab 은 저장하고 왼쪽', () => {
    const right = handleGridKey(editing(1, 1), { key: 'Tab' }, size)
    assert.equal(right.effect, 'commit')
    assert.deepEqual(right.mode, selected(1, 2))

    const left = handleGridKey(editing(1, 1), { key: 'Tab', shift: true }, size)
    assert.equal(left.effect, 'commit')
    assert.deepEqual(left.mode, selected(1, 0))
  })

  test('★ 편집 중에는 표 끝의 Tab 도 처리한다 — 저장하고 그 칸에 머문다', () => {
    const r = handleGridKey(editing(2, 3), { key: 'Tab' }, size)
    assert.equal(r.handled, true)
    assert.equal(r.effect, 'commit')
    assert.deepEqual(r.mode, selected(2, 3))
  })

  test('★ Esc 는 버리고 같은 칸을 선택한 채로 남는다', () => {
    const r = handleGridKey(editing(1, 3), { key: 'Escape' }, size)
    assert.equal(r.effect, 'cancel')
    assert.deepEqual(r.mode, selected(1, 3))
  })

  test('화살표는 처리하지 않는다 — 입력칸의 캐럿이 움직여야 한다', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      const r = handleGridKey(editing(1, 1), { key }, size)
      assert.equal(r.handled, false, key)
      assert.deepEqual(r.mode, editing(1, 1))
    }
  })

  test('Shift+Enter 는 처리하지 않는다', () => {
    assert.equal(handleGridKey(editing(1, 1), { key: 'Enter', shift: true }, size).handled, false)
  })

  test('Backspace 는 입력칸의 것이다 — 칸을 비우지 않는다', () => {
    const r = handleGridKey(editing(1, 1), { key: 'Backspace' }, size)
    assert.equal(r.handled, false)
    assert.equal(r.effect, 'none')
  })
})

describe('★ IME 조합 중', () => {
  test('조합 중의 Enter · Tab · Esc 는 아무것도 하지 않는다 — 한글 후보 확정이다', () => {
    for (const mode of [editing(1, 1), selected(1, 1)]) {
      for (const key of ['Enter', 'Tab', 'Escape', 'ArrowDown']) {
        const r = handleGridKey(mode, { key, composing: true }, size)
        assert.equal(r.handled, false, `${mode.kind} ${key}`)
        assert.equal(r.effect, 'none')
        assert.deepEqual(r.mode, mode)
      }
    }
  })
})

describe('방어', () => {
  test('선택이 없으면 어떤 키도 처리하지 않는다', () => {
    for (const key of ['Enter', 'Tab', 'ArrowDown', 'Escape']) {
      assert.equal(handleGridKey({ kind: 'idle' }, { key }, size).handled, false, key)
    }
  })

  test('행이 지워져 선택이 격자 밖에 남으면 안으로 끌어온다', () => {
    const r = handleGridKey(selected(9, 9), { key: 'ArrowLeft' }, size)
    assert.deepEqual(r.mode, selected(2, 2))
  })

  test('격자가 비면 선택이 풀린다', () => {
    const r = handleGridKey(selected(0, 0), { key: 'ArrowDown' }, { rows: 0, cols: 4 })
    assert.equal(r.handled, false)
    assert.deepEqual(r.mode, { kind: 'idle' })
    assert.equal(clampPos({ row: 0, col: 0 }, { rows: 0, cols: 4 }), null)
  })
})
