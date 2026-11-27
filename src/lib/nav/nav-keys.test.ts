/**
 * 이동 단축키 — 키 고르기 · 위 칸 · 히스토리 끝 (NV-1 · F-07-12 · 정본 §3.9 [보강 NV-0] ② ③ ④)
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { breadcrumbTrail, databaseTrail, rowTrail, templateTrail } from '../block/breadcrumb.ts'
import { COMMAND_ACTIONS } from './command-actions.ts'
import { mayStep, navKeyOf, noticeBackOf, upHrefOf, type NavKeyEvent } from './nav-keys.ts'

const WS = 'ws-1'

function ev(key: string, code: string, mods: Partial<NavKeyEvent> = {}): NavKeyEvent {
  return { key, code, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, isComposing: false, defaultPrevented: false, ...mods }
}

describe('navKeyOf — 이동 단축키를 고른다', () => {
  test('Ctrl/Cmd + [ · ] · Shift+U · L', () => {
    assert.equal(navKeyOf(ev('[', 'BracketLeft')), 'back')
    assert.equal(navKeyOf(ev(']', 'BracketRight')), 'forward')
    assert.equal(navKeyOf(ev('U', 'KeyU', { shiftKey: true })), 'up')
    assert.equal(navKeyOf(ev('l', 'KeyL')), 'copy-link')
    // 맥의 Cmd
    assert.equal(navKeyOf(ev('[', 'BracketLeft', { ctrlKey: false, metaKey: true })), 'back')
    assert.equal(navKeyOf(ev('u', 'KeyU', { ctrlKey: false, metaKey: true, shiftKey: true })), 'up')
  })

  test('★ 한글 입력기가 켜져도 선다 — key 가 한글이면 code 로', () => {
    assert.equal(navKeyOf(ev('ㅕ', 'KeyU', { shiftKey: true })), 'up')
    assert.equal(navKeyOf(ev('ㅣ', 'KeyL')), 'copy-link')
  })

  test('code 가 다른 배열이면 key 로', () => {
    assert.equal(navKeyOf(ev('[', 'Digit8')), 'back')
    assert.equal(navKeyOf(ev(']', 'Digit9')), 'forward')
  })

  test('★ 받지 않는 키 — Ctrl/Cmd 없이 · Alt 와 함께(AltGr) · 한글 조합 중 · 이미 막힌 키', () => {
    assert.equal(navKeyOf(ev('[', 'BracketLeft', { ctrlKey: false })), null)
    assert.equal(navKeyOf(ev('[', 'Digit8', { altKey: true })), null)
    assert.equal(navKeyOf(ev('[', 'BracketLeft', { isComposing: true })), null)
    assert.equal(navKeyOf(ev('[', 'BracketLeft', { defaultPrevented: true })), null)
  })

  test('★ Shift 가 함께면 뒤로 · 앞으로 · 복사가 아니다 — Ctrl+Shift+L 은 테마(8h)', () => {
    assert.equal(navKeyOf(ev('L', 'KeyL', { shiftKey: true })), null)
    assert.equal(navKeyOf(ev('{', 'BracketLeft', { shiftKey: true })), null)
    assert.equal(navKeyOf(ev('}', 'BracketRight', { shiftKey: true })), null)
  })

  test('★ 팔레트가 "링크 복사" 줄에 적은 단축키가 실제로 링크 복사다(학습 유도가 거짓말하지 않게)', () => {
    const shortcut = COMMAND_ACTIONS.find((a) => a.id === 'copy-link')?.shortcut
    assert.ok(shortcut)
    assert.equal(navKeyOf(ev(shortcut.key, `Key${shortcut.key.toUpperCase()}`, { shiftKey: shortcut.shift === true })), 'copy-link')
  })

  test('Shift 없는 U(밑줄)는 위 칸이 아니다 · 다른 글자는 아무것도 아니다', () => {
    assert.equal(navKeyOf(ev('u', 'KeyU')), null)
    assert.equal(navKeyOf(ev('k', 'KeyK')), null)
    assert.equal(navKeyOf(ev('j', 'KeyJ', { shiftKey: true })), null)
  })
})

describe('upHrefOf — 경로 줄의 바로 위 칸', () => {
  const page = (id: string) => ({ id, plainTitle: id })

  test('조상이 있으면 부모 페이지', () => {
    const trail = breadcrumbTrail({ workspaceId: WS, teamspace: null, ancestors: [page('g'), page('p')], page: page('me') })
    assert.equal(upHrefOf(trail), `/w/${WS}/p`)
  })

  test('★ 루트 페이지면 워크스페이스 홈 — 07 엣지 "홈 또는 무시" 중 홈', () => {
    const trail = breadcrumbTrail({ workspaceId: WS, teamspace: null, ancestors: [], page: page('me') })
    assert.equal(upHrefOf(trail), `/w/${WS}`)
  })

  test('팀스페이스의 루트 페이지면 그 팀스페이스(멤버에게만 서는 칸)', () => {
    const trail = breadcrumbTrail({ workspaceId: WS, teamspace: { id: 't1', name: '팀' }, ancestors: [], page: page('me') })
    assert.equal(upHrefOf(trail), `/w/${WS}/teamspaces/t1`)
  })

  test('★ 행이면 그 데이터베이스 · 못 여는 데이터베이스면 그 위(볼 수 있는 조상 또는 홈)', () => {
    const row = { id: 'r1', title: '행', icon: null }
    const db = { id: 'd1', name: '표', icon: null }
    assert.equal(upHrefOf(rowTrail({ workspaceId: WS, database: db, row })), `/w/${WS}/db/d1`)
    assert.equal(upHrefOf(rowTrail({ workspaceId: WS, database: null, row, ancestors: [page('host')] })), `/w/${WS}/host`)
    assert.equal(upHrefOf(rowTrail({ workspaceId: WS, database: null, row })), `/w/${WS}`)
  })

  test('데이터베이스 화면은 놓인 페이지 · 템플릿 화면은 그 데이터베이스', () => {
    const db = { id: 'd1', name: '표', icon: null }
    assert.equal(upHrefOf(databaseTrail({ workspaceId: WS, ancestors: [page('host')], database: db })), `/w/${WS}/host`)
    assert.equal(upHrefOf(databaseTrail({ workspaceId: WS, ancestors: [], database: db })), `/w/${WS}`)
    assert.equal(upHrefOf(templateTrail({ workspaceId: WS, database: db, templateId: 'tpl' })), `/w/${WS}/db/d1`)
  })

  test('링크가 아닌 칸은 건너뛴다 · 줄이 없으면 갈 곳이 없다', () => {
    const trail = [
      { kind: 'workspace' as const, id: WS, label: '워크스페이스', icon: null, href: `/w/${WS}` },
      { kind: 'page' as const, id: 'x', label: 'x', icon: null, href: null },
      { kind: 'current' as const, id: 'me', label: 'me', icon: null, href: null },
    ]
    assert.equal(upHrefOf(trail), `/w/${WS}`)
    assert.equal(upHrefOf([]), null)
    assert.equal(upHrefOf([trail[2]!]), null)
  })
})

describe('mayStep — 히스토리 끝은 무시한다', () => {
  test('★ 같은 출처의 앞 항목이 없으면 뒤로 가지 않는다 — 앱 밖으로 나가지 않게', () => {
    assert.equal(mayStep('back', { canGoBack: false, canGoForward: true }), false)
    assert.equal(mayStep('forward', { canGoBack: true, canGoForward: false }), false)
    assert.equal(mayStep('back', { canGoBack: true, canGoForward: false }), true)
    assert.equal(mayStep('forward', { canGoBack: false, canGoForward: true }), true)
  })

  test('Navigation API 가 없는 브라우저는 브라우저에 맡긴다', () => {
    assert.equal(mayStep('back', null), true)
    assert.equal(mayStep('forward', null), true)
  })
})

describe('noticeBackOf — 안내 화면의 "뒤로"(NV-2 · ⑥)', () => {
  test('★ 같은 출처의 앞 항목이 있으면 한 칸 뒤로 · 없으면 앱 안의 대신 갈 곳 — 앱 밖으로 나가지 않는다', () => {
    assert.equal(noticeBackOf({ canGoBack: true, canGoForward: false }, 3), 'back')
    // 앞이 다른 사이트(history.length 는 그것도 센다) — API 가 이긴다
    assert.equal(noticeBackOf({ canGoBack: false, canGoForward: false }, 5), 'fallback')
  })

  test('API 가 없는 브라우저 — 앞 항목이 있으면 뒤로(브라우저에 맡긴다) · 새 탭이면 대신 갈 곳(누르면 아무 일 없는 단추가 되지 않게)', () => {
    assert.equal(noticeBackOf(null, 2), 'back')
    assert.equal(noticeBackOf(null, 1), 'fallback')
  })
})
