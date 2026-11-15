/**
 * 설정 → 오프라인의 목록 — OF-5 (F-12-04 · 정본 §3.7 [보강 OF-1] ⑥ · 순수)
 *
 *   ① ★ 기록 → 줄 — 페이지 · 데이터베이스(이름) · 크기는 기록의 `bytes` · 까닭은 정해진 차례(직접 · 즐겨찾기 · 최근) · 받은 때의 역순
 *   ② ★ 찾기 — 낱말이 모두 든 제목 · 대소문자 · 공백 · 빈 제목은 "제목 없음"으로
 *   ③ 크기 — B · KB · MB · 합계
 *   ④ 지운 결과의 말 — 못 보낸 편집이 있어 남긴 수를 말한다
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { filterOfflineItems, formatBytes, offlineListItems, reasonLabel, removedMessage, totalBytes } from './offline-list.ts'
import type { OfflineDatabaseRecord, OfflinePageRecord, OfflineReason } from './offline-store.ts'

const page = (pageId: string, title: string, savedAt: number, bytes: number, reasons: OfflineReason[]): OfflinePageRecord => ({
  key: `u:${pageId}`,
  userId: 'u',
  workspaceId: 'w',
  pageId,
  title,
  icon: null,
  cover: null,
  state: new Uint8Array(bytes),
  seq: '1',
  reasons,
  savedAt,
  bytes,
})

const database = (pageId: string, name: string, savedAt: number, bytes: number): OfflineDatabaseRecord => ({
  kind: 'database',
  key: `u:${pageId}`,
  userId: 'u',
  workspaceId: 'w',
  pageId,
  name,
  icon: { type: 'emoji', emoji: '📊' },
  viewName: '표',
  columns: [],
  rows: [],
  truncated: false,
  savedVersion: '2026-11-15T00:00:00Z',
  reasons: ['toggled'],
  savedAt,
  bytes,
})

test('① ★ 기록 → 줄 — 종류 · 크기 · 까닭의 차례 · 받은 때의 역순(같으면 제목)', () => {
  const items = offlineListItems([
    page('p1', 'Beta 회의록', 1000, 2048, ['recent', 'toggled']),
    database('d1', '할 일 표', 3000, 512),
    page('p2', 'Alpha 계획', 1000, 100, ['favorited']),
    page('p3', '', 2000, 0, []),
  ])
  assert.deepEqual(items.map((i) => i.pageId), ['d1', 'p3', 'p2', 'p1'])
  const [db, untitled, alpha, beta] = items
  assert.deepEqual([db.kind, db.title, db.bytes, db.icon], ['database', '할 일 표', 512, { type: 'emoji', emoji: '📊' }])
  assert.deepEqual([beta.kind, beta.title, beta.bytes], ['page', 'Beta 회의록', 2048])
  assert.deepEqual(beta.reasons, ['toggled', 'recent'], '저장된 차례와 상관없이 직접 · 즐겨찾기 · 최근')
  assert.deepEqual(beta.reasons.map(reasonLabel), ['직접', '최근'])
  assert.deepEqual(alpha.reasons.map(reasonLabel), ['즐겨찾기'])
  assert.deepEqual(untitled.reasons, [], '못 보낸 편집으로 남은 사본은 까닭이 없다')
})

test('② ★ 찾기 — 낱말이 모두 · 대소문자 · 공백 · 빈 제목', () => {
  const items = offlineListItems([
    page('p1', 'Beta 회의록', 1, 1, ['toggled']),
    page('p2', 'Alpha 계획', 2, 1, ['toggled']),
    page('p3', '', 3, 1, ['toggled']),
    database('d1', '회의 일정 표', 4, 1),
  ])
  const ids = (q: string) => filterOfflineItems(items, q).map((i) => i.pageId)
  assert.deepEqual(ids(''), ['d1', 'p3', 'p2', 'p1'])
  assert.deepEqual(ids('   '), ['d1', 'p3', 'p2', 'p1'])
  assert.deepEqual(ids('회의'), ['d1', 'p1'])
  assert.deepEqual(ids('beta'), ['p1'])
  assert.deepEqual(ids('  ALPHA   계획 '), ['p2'])
  assert.deepEqual(ids('회의 표'), ['d1'], '낱말이 모두 들어야 한다')
  assert.deepEqual(ids('제목 없음'), ['p3'])
  assert.deepEqual(ids('없는 말'), [])
})

test('③ 크기 — B · KB · MB · 합계', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1023), '1023 B')
  assert.equal(formatBytes(1024), '1 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(12 * 1024 + 300), '12 KB')
  assert.equal(formatBytes(3.25 * 1024 * 1024), '3.3 MB')
  assert.equal(formatBytes(-5), '0 B')
  assert.equal(formatBytes(Number.NaN), '0 B')
  const items = offlineListItems([page('p1', 'a', 1, 1000, ['toggled']), database('d1', 'b', 2, 24)])
  assert.equal(totalBytes(items), 1024)
  assert.equal(formatBytes(totalBytes(items)), '1 KB')
})

test('④ 지운 결과의 말', () => {
  assert.equal(removedMessage({ removed: 1, kept: 0 }), '1개를 이 기기에서 지웠습니다.')
  assert.equal(removedMessage({ removed: 0, kept: 0 }), '지울 것이 없습니다.')
  assert.match(removedMessage({ removed: 2, kept: 1 }), /^2개를 이 기기에서 지웠습니다\. 보내지 못한 편집이 있는 1개는 남겨 두었습니다/)
})
