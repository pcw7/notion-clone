/**
 * 링크를 누른 것 — 원자 링크 · 글 속 링크 (NV-3 · F-07-12 · 정본 §3.9 [보강 NV-0] ⑪ [NV-3 고침])
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { atomLinkClick, textLinkClick, type LinkPointer } from './link-click.ts'

function press(mods: Partial<LinkPointer> = {}): LinkPointer {
  return { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods }
}

describe('atomLinkClick — 노드 뷰의 링크(멘션 칩 · 하위 페이지 · 데이터베이스)', () => {
  test('★ 그냥 누르면 앱 안(라우터)', () => {
    assert.equal(atomLinkClick(press()), 'in-app')
  })

  test('★ Ctrl/Cmd · 가운데 단추는 브라우저의 것(새 탭)', () => {
    assert.equal(atomLinkClick(press({ ctrlKey: true })), 'browser')
    assert.equal(atomLinkClick(press({ metaKey: true })), 'browser')
    assert.equal(atomLinkClick(press({ button: 1 })), 'browser')
    // Ctrl+Shift — 앞에 서는 새 탭도 브라우저가
    assert.equal(atomLinkClick(press({ ctrlKey: true, shiftKey: true })), 'browser')
  })

  test('Shift(새 창) · Alt 도 브라우저에 맡긴다 — Next Link 와 같은 규칙', () => {
    assert.equal(atomLinkClick(press({ shiftKey: true })), 'browser')
    assert.equal(atomLinkClick(press({ altKey: true })), 'browser')
  })

  test('오른쪽 · 뒤로/앞으로 단추는 건드리지 않는다', () => {
    assert.equal(atomLinkClick(press({ button: 2 })), 'ignore')
    assert.equal(atomLinkClick(press({ button: 3 })), 'ignore')
  })
})

describe('textLinkClick — 글 속 링크(link 서식)', () => {
  test('★ 편집 중에 그냥 누르면 글자다 — 캐럿을 둔다(열지 않는다)', () => {
    assert.equal(textLinkClick(press(), true), 'pass')
  })

  test('★ 편집 중 Ctrl/Cmd + 클릭 · 가운데 클릭은 편집기가 새 탭으로', () => {
    assert.equal(textLinkClick(press({ ctrlKey: true }), true), 'new-tab')
    assert.equal(textLinkClick(press({ metaKey: true }), true), 'new-tab')
    assert.equal(textLinkClick(press({ button: 1 }), true), 'new-tab')
    assert.equal(textLinkClick(press({ ctrlKey: true, shiftKey: true }), true), 'new-tab')
  })

  test('★ 편집 중 Shift + 클릭은 선택 늘리기 — 새 창이 아니다', () => {
    assert.equal(textLinkClick(press({ shiftKey: true }), true), 'pass')
  })

  test('Alt 가 함께면 열지 않는다(브라우저의 내려받기 · AltGr)', () => {
    assert.equal(textLinkClick(press({ altKey: true }), true), 'pass')
    assert.equal(textLinkClick(press({ ctrlKey: true, altKey: true }), true), 'pass')
    assert.equal(textLinkClick(press({ button: 1, altKey: true }), true), 'pass')
  })

  test('★ 읽기 전용이면 살아 있는 링크 — 무엇을 눌러도 브라우저에 맡긴다', () => {
    for (const mods of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      assert.equal(textLinkClick(press(mods), false), 'pass', JSON.stringify(mods))
    }
  })

  test('오른쪽 단추는 글자다', () => {
    assert.equal(textLinkClick(press({ button: 2 }), true), 'pass')
    assert.equal(textLinkClick(press({ button: 2, ctrlKey: true }), true), 'pass')
  })
})
