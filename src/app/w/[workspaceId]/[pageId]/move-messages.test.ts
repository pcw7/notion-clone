/**
 * 옮기기의 문구 — 7c-3 · 7c-13조각 (DOM · DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { moveFailureMessage, moveNeedsConfirm, movePreviewLines, previewPeople, type MovePreviewView } from './move-messages.ts'

test('거부 코드마다 할 말이 있다 · 전체 권한이 필요한 까닭을 말한다 · 모르는 코드는 일반 문구', () => {
  for (const code of ['too_deep', 'cycle', 'forbidden', 'needs_full_access', 'target_not_found']) {
    assert.notEqual(moveFailureMessage(code), '옮기지 못했습니다.', code)
  }
  assert.match(moveFailureMessage('needs_full_access'), /전체 권한/)
  assert.match(moveFailureMessage('needs_full_access'), /볼 수 있는 사람이 바뀝니다/)
  assert.equal(moveFailureMessage('something_new'), '옮기지 못했습니다.')
})

const preview = (over: Partial<MovePreviewView> = {}): MovePreviewView => ({
  noop: false,
  lose: { count: 0, names: [] },
  gain: { count: 0, names: [] },
  keep: 3,
  keptBelow: { pages: 0, people: 0 },
  web: { own: false, before: false, after: false },
  ...over,
})

test('★ 한 번 더 묻는 것은 볼 수 있는 사람이 바뀔 때뿐이다 — 하위의 공유만 있으면 묻지 않는다 · noop 도', () => {
  assert.equal(moveNeedsConfirm(preview()), false)
  assert.equal(moveNeedsConfirm(preview({ keptBelow: { pages: 2, people: 1 } })), false)
  assert.equal(moveNeedsConfirm(preview({ noop: true })), false)
  assert.equal(moveNeedsConfirm(preview({ lose: { count: 1, names: null } })), true)
  assert.equal(moveNeedsConfirm(preview({ gain: { count: 4, names: ['앤'] } })), true)
})

test('사람 한 줄 — 이름이 있으면 이름(넘치면 "외 N명") · 이름을 못 받았으면 수만', () => {
  assert.equal(previewPeople({ count: 2, names: ['앤', '밥'] }), '앤 · 밥')
  assert.equal(previewPeople({ count: 7, names: ['앤', '밥'] }), '앤 · 밥 외 5명')
  assert.equal(previewPeople({ count: 7, names: null }), '7명')
})

test('줄은 있는 것만 — 잃는 · 새로 보는 · 그대로 · 하위의 공유(옮겨도 남는다고 말한다)', () => {
  const lines = movePreviewLines(
    preview({ lose: { count: 1, names: ['앤'] }, keep: 0, keptBelow: { pages: 2, people: 1 } }),
  )
  assert.deepEqual(
    lines.map((l) => l.key),
    ['lose', 'below'],
  )
  assert.match(lines[1].text, /하위 페이지 2개.*1명이 여전히/)
  assert.match(lines[1].text, /옮겨도 남습니다/)
})

test('★ [6a-4] 웹 공개 — 바뀌면 묻는다 · 자기 게시는 옮겨도 남는다고 · 위 게시 안으로 · 밖으로', () => {
  assert.equal(moveNeedsConfirm(preview({ web: { own: false, before: false, after: true } })), true, '웹에 공개된다')
  assert.equal(moveNeedsConfirm(preview({ web: { own: false, before: true, after: false } })), true, '웹에서 내려간다')
  assert.equal(moveNeedsConfirm(preview({ web: { own: true, before: true, after: true } })), false, '그대로면 묻지 않는다(사람이 바뀌면 그쪽이 묻는다)')

  const stays = movePreviewLines(preview({ web: { own: true, before: true, after: true } }))
  assert.deepEqual(stays.map((l) => l.key), ['keep', 'web'])
  assert.match(stays[1]!.text, /웹에 게시되어 있어 옮겨도/)
  assert.match(movePreviewLines(preview({ web: { own: false, before: false, after: true } })).at(-1)!.text, /웹에 공개됩니다/)
  assert.match(movePreviewLines(preview({ web: { own: false, before: true, after: false } })).at(-1)!.text, /웹에서 더는 열리지 않습니다/)
  assert.ok(!movePreviewLines(preview()).some((l) => l.key === 'web'), '공개와 무관하면 말하지 않는다')
})
