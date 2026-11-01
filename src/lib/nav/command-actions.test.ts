// 커맨드 팔레트의 작업(35번 트랙 CP-1 · F-07-11 · 정본 §3.9 [보강 CP-1]).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { COMMAND_ACTIONS, COMMAND_ACTION_IDS, formatCommandShortcut, matchCommandActions, normalizeCommandText } from './command-actions.ts'

const PAGE = { pageId: '11111111-1111-4111-8111-111111111111' }
const NO_PAGE = { pageId: null }
const ids = (query: string, ctx = PAGE) => matchCommandActions(query, ctx).map((a) => a.id)

describe('맞추기', () => {
  test('★ 이름 · 낱말(한국어 · 영어)을 공백 없이 · 대소문자 없이 · 빈 입력은 작업이 없다', () => {
    assert.deepEqual(ids('테마'), ['toggle-theme'])
    assert.deepEqual(ids('다크모드'), ['toggle-theme'], '공백 없이')
    assert.deepEqual(ids('DARK'), ['toggle-theme'], '대소문자 없이')
    assert.deepEqual(ids('링크'), ['copy-link'])
    assert.deepEqual(ids('   '), [])
    assert.deepEqual(ids('없는작업'), [])
  })

  test('★ 페이지가 없으면 링크 복사는 숨긴다(맥락에 맞지 않는 작업)', () => {
    assert.deepEqual(ids('링크', NO_PAGE), [])
    assert.deepEqual(ids('copy', NO_PAGE), [])
    assert.deepEqual(ids('copy'), ['copy-link'])
  })

  test('차례 — 이름이 앞으로 맞는 것 → 이름 안 → 낱말이 앞으로 → 낱말 안', () => {
    // '열기' — 설정 열기 · 인박스 열기는 이름 안(1) · 같으면 목록의 차례
    assert.deepEqual(ids('열기'), ['open-settings', 'open-inbox'])
    // '설정' — 설정 열기는 이름이 앞으로(0)
    assert.equal(ids('설정')[0], 'open-settings')
    // 'pa' — new page 의 낱말 안 · 'toggle sidebar' 에는 없다
    assert.deepEqual(ids('page'), ['new-page'])
  })
})

describe('목록 · 단축키', () => {
  test('작업의 id 는 목록과 같고 겹치지 않는다 · 단축키는 기기에 맞춰', () => {
    assert.deepEqual(COMMAND_ACTIONS.map((a) => a.id), [...COMMAND_ACTION_IDS])
    assert.equal(formatCommandShortcut({ mod: true, shift: true, key: 'L' }, true), '⌘⇧L')
    assert.equal(formatCommandShortcut({ mod: true, shift: true, key: 'L' }, false), 'Ctrl+Shift+L')
    assert.equal(formatCommandShortcut({ mod: true, key: '\\' }, false), 'Ctrl+\\')
    assert.equal(normalizeCommandText(' 새  페이지 '), '새페이지')
  })
})
