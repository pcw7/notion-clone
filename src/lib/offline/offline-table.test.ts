/**
 * 내려받은 데이터베이스 — OF-4 (F-12-04 · 정본 §3.7 [보강 OF-1] ⑤ · 순수)
 *
 *   ① ★ 저장소의 호환 — `kind` 가 없는 옛 기록(OF-2 · OF-3)은 페이지 · 데이터베이스 기록은 `kind: 'database'` · 모양이 아니면 빠진다
 *   ② 데이터베이스 기록 — 열쇠는 `{사용자}:{데이터베이스}` · 까닭의 집합은 페이지와 같은 규칙 · 다시 받으면 까닭 · 열쇠는 그대로
 *   ③ 라우트의 답 읽기 — 칸이 글자가 아니거나 모양이 아니면 null
 *   ④ ★ 표 모델 — 열 차례대로 칸 · 50행에서 끊겼으면 "처음 50행" · 제목이 비면 "제목 없음" · 행을 그리는 뷰가 없으면(열 없음) 그렇다고 · 행이 없으면 그렇다고
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isDatabaseRecord,
  isPageRecord,
  offlineDatabaseRecord,
  offlinePageKey,
  offlineRecord,
  parseOfflineDatabasePayload,
  readStoredRecord,
  refreshedDatabaseRecord,
  withoutReason,
  type OfflineDatabasePayload,
} from './offline-store.ts'
import { OFFLINE_DATABASE_ROWS, offlineTable, ROW_ONLINE_ONLY } from './offline-table.ts'

const USER = '11111111-1111-4111-8111-111111111111'
const WS = '22222222-2222-4222-8222-222222222222'
const DB = '44444444-4444-4444-8444-444444444444'
const PAGE = '33333333-3333-4333-8333-333333333333'

const payload = (over: Partial<OfflineDatabasePayload> = {}): OfflineDatabasePayload => ({
  databaseId: DB,
  name: '할 일',
  icon: { type: 'emoji', emoji: '🗂' },
  viewName: '진행 중',
  columns: [
    { id: 'p-title', name: '이름', type: 'title' },
    { id: 'p-score', name: '점수', type: 'number' },
  ],
  rows: [
    { id: 'r1', title: '첫 일', cells: { 'p-title': '첫 일', 'p-score': '3' } },
    { id: 'r2', title: '', cells: { 'p-title': '', 'p-score': '' } },
  ],
  truncated: false,
  savedVersion: '2026-11-15T00:00:00.000Z',
  ...over,
})

test('① ★ 저장소의 호환 — kind 가 없는 옛 기록은 페이지 · 데이터베이스는 kind 로 · 모양이 아니면 빠진다', () => {
  const page = offlineRecord(
    { pageId: PAGE, title: '문서', icon: null, cover: null, seq: '3', state: Buffer.from([1, 2]).toString('base64') },
    { userId: USER, workspaceId: WS, reason: 'toggled', now: 1, previous: null },
  )
  assert.equal('kind' in page, false, 'OF-2 의 기록 그대로 — kind 를 쓰지 않는다')
  const stored = readStoredRecord({ ...page, state: page.state.buffer })
  assert.ok(stored !== null && isPageRecord(stored) && !isDatabaseRecord(stored), '옛 기록은 페이지')
  assert.ok(stored.state instanceof Uint8Array && stored.state.byteLength === 2, '바이트는 Uint8Array 로 맞춘다')
  assert.ok(readStoredRecord({ ...page, kind: 'page' }) !== null, 'kind: page 도 페이지')

  const database = offlineDatabaseRecord(payload(), { userId: USER, workspaceId: WS, reason: 'toggled', now: 1, previous: null })
  const back = readStoredRecord(JSON.parse(JSON.stringify(database)))
  assert.ok(back !== null && isDatabaseRecord(back) && !isPageRecord(back), '데이터베이스 기록은 본문 상태가 없어도 읽힌다')
  assert.deepEqual(back, database)

  for (const bad of [null, 'x', { ...page, state: 'abc' }, { ...database, rows: null }, { ...database, kind: 'other' }, { ...database, pageId: 1 }]) {
    assert.equal(readStoredRecord(bad), null, JSON.stringify(bad)?.slice(0, 80))
  }
})

test('② 데이터베이스 기록 — 열쇠 · 내용 · 크기 · 까닭(페이지와 같은 규칙) · 다시 받기', () => {
  const record = offlineDatabaseRecord(payload(), { userId: USER, workspaceId: WS, reason: 'toggled', now: 1_700_000_000_000, previous: null })
  assert.equal(record.key, offlinePageKey(USER, DB))
  assert.equal(record.kind, 'database')
  assert.equal(record.pageId, DB)
  assert.equal('databaseId' in record, false, '데이터베이스 id 는 pageId 하나로')
  assert.equal(record.name, '할 일')
  assert.equal(record.viewName, '진행 중')
  assert.deepEqual(record.reasons, ['toggled'])
  assert.equal(record.savedAt, 1_700_000_000_000)
  assert.equal(record.bytes, new TextEncoder().encode(JSON.stringify({ columns: payload().columns, rows: payload().rows })).byteLength)

  const auto = offlineDatabaseRecord(payload(), { userId: USER, workspaceId: WS, reason: 'favorited', now: 1, previous: null })
  const both = offlineDatabaseRecord(payload({ name: '바뀐 이름' }), { userId: USER, workspaceId: WS, reason: 'toggled', now: 2, previous: auto })
  assert.deepEqual(both.reasons, ['favorited', 'toggled'])
  assert.equal(both.name, '바뀐 이름')
  assert.deepEqual(withoutReason(both, 'toggled')?.reasons, ['favorited'], '스위치를 꺼도 다른 까닭이 남으면 남는다')
  assert.equal(withoutReason(record, 'toggled'), null, '마지막 까닭을 빼면 지운다(GC)')

  const refreshed = refreshedDatabaseRecord(both, payload({ rows: [], truncated: true, viewName: '새 뷰' }), 9)
  assert.deepEqual(refreshed.reasons, ['favorited', 'toggled'], '다시 받아도 까닭은 그대로')
  assert.equal(refreshed.key, both.key)
  assert.equal(refreshed.savedAt, 9)
  assert.equal(refreshed.viewName, '새 뷰')
  assert.equal(refreshed.truncated, true)
  assert.deepEqual(refreshed.rows, [])
})

test('③ 라우트의 답 읽기 — 모양이 아니면 null', () => {
  const ok = payload()
  assert.deepEqual(parseOfflineDatabasePayload(ok), ok)
  assert.deepEqual(parseOfflineDatabasePayload({ ...ok, icon: 'x' }), { ...ok, icon: null })
  const bads = [
    null,
    [],
    { ...ok, databaseId: 1 },
    { ...ok, truncated: 'no' },
    { ...ok, columns: [{ id: 'a', name: 'b' }] },
    { ...ok, rows: [{ id: 'r', title: 't', cells: { a: 1 } }] },
    { ...ok, rows: [{ id: 'r', title: 't' }] },
    { ...ok, savedVersion: null },
  ]
  for (const bad of bads) assert.equal(parseOfflineDatabasePayload(bad), null, JSON.stringify(bad)?.slice(0, 80))
})

test('④ ★ 표 모델 — 열 차례 · 처음 50행 · 제목 없음 · 빈 열 · 빈 행', () => {
  const table = offlineTable(payload())
  assert.deepEqual(table.columns, [{ id: 'p-title', name: '이름' }, { id: 'p-score', name: '점수' }])
  assert.deepEqual(table.rows, [
    { id: 'r1', cells: ['첫 일', '3'] },
    { id: 'r2', cells: ['제목 없음', ''] },
  ])
  assert.equal(table.note, null, '끊기지 않았으면 알리지 않는다')
  assert.equal(table.empty, null)

  const truncated = offlineTable(payload({ truncated: true }))
  assert.equal(truncated.note, `처음 ${OFFLINE_DATABASE_ROWS}행만 내려받았습니다 — 나머지는 온라인에서 볼 수 있습니다.`)
  assert.equal(OFFLINE_DATABASE_ROWS, 50, '노션과 같은 상한')

  const noView = offlineTable(payload({ viewName: '', columns: [], rows: [] }))
  assert.deepEqual(noView.columns, [])
  assert.deepEqual(noView.rows, [])
  assert.ok(noView.empty?.includes('뷰가 없어'), noView.empty ?? '(없음)')

  const noRows = offlineTable(payload({ rows: [] }))
  assert.equal(noRows.columns.length, 2)
  assert.equal(noRows.empty, '이 뷰에 보이는 행이 없습니다.')

  const missing = offlineTable(payload({ rows: [{ id: 'r3', title: '칸 없음', cells: {} }] }))
  assert.deepEqual(missing.rows[0].cells, ['칸 없음', ''], '칸이 없으면 빈 글 · 제목 열은 행의 제목')
  assert.equal(ROW_ONLINE_ONLY, '행 페이지는 온라인에서 열 수 있습니다.')
})
