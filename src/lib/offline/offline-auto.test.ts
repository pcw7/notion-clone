/**
 * 자동 내려받기의 계획 — OF-5 (F-12-04 · 정본 §3.7 [보강 OF-1] ⑥ · 순수)
 *
 *   ① ★ 켠 스위치 — 원천에 있고 사본이 없으면 받는다(그 까닭으로 · 즐겨찾기이자 최근이면 둘 다) · 있으면 까닭을 더한다 · 원천에 없으면 뺀다
 *   ② ★ 끈 스위치는 그 까닭을 모든 워크스페이스에서 뺀다 · 켠 스위치는 이 워크스페이스의 사본만 손댄다
 *   ③ ★ 원천을 받지 못했으면 켠 까닭은 그대로 · 받지 않는다(끈 까닭은 그래도 뺀다)
 *   ④ ★ GC — 까닭이 비면 지운다 · 못 보낸 편집이 있으면 빈 채로 남고 보낸 뒤의 돌기가 지운다 · 직접(toggled)은 자동이 건드리지 않는다
 *   ⑤ 최근은 10개까지 · 원천의 답 읽기 · 스위치 읽기 · 지금 연 워크스페이스(주소)
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { AUTO_RECENT_LIMIT, anyAutoOn, NO_SOURCES, parseAutoSources, planAutoDownload, workspaceFromPath, type AutoPlan } from './offline-auto.ts'
import {
  AUTO_DOWNLOAD_OFF,
  autoDownloadKey,
  OFFLINE_REASONS,
  readAutoDownload,
  withReasonChange,
  type OfflineReason,
} from './offline-store.ts'

const WS = 'ws-here'
const OTHER = 'ws-other'
type Rec = { pageId: string; workspaceId: string; reasons: readonly OfflineReason[] }
const rec = (pageId: string, reasons: readonly OfflineReason[], workspaceId = WS): Rec => ({ pageId, workspaceId, reasons })

/** 계획을 사본들에 적용한다 — 저장소(`changeReasons`)와 같은 규칙(`withReasonChange`). 받을 것은 새 사본으로. */
function apply(records: readonly Rec[], plan: AutoPlan, unsent: ReadonlySet<string> = new Set()): Record<string, readonly OfflineReason[]> {
  const out: Record<string, readonly OfflineReason[]> = {}
  for (const record of records) {
    const change = plan.changes.find((c) => c.pageId === record.pageId)
    const next = change === undefined ? record : withReasonChange(record, change, unsent.has(record.pageId))
    if (next !== null) out[record.pageId] = next.reasons
  }
  for (const d of plan.downloads) out[d.pageId] = d.reasons
  return out
}

const ON = { favorites: true, recent: true }

test('① ★ 켠 스위치 — 없으면 받고 · 있으면 더하고 · 원천에 없으면 뺀다', () => {
  const records = [rec('a', ['toggled']), rec('b', ['favorited']), rec('c', ['recent']), rec('d', ['favorited', 'recent'])]
  const plan = planAutoDownload({
    records,
    settings: ON,
    workspaceId: WS,
    sources: { favorites: ['a', 'd', 'x'], recent: ['x', 'y', 'c'] },
  })
  assert.deepEqual(plan.downloads, [
    { pageId: 'x', reasons: ['favorited', 'recent'] },
    { pageId: 'y', reasons: ['recent'] },
  ])
  assert.deepEqual(apply(records, plan), {
    a: ['toggled', 'favorited'],
    // b — 더는 즐겨찾기가 아니다 · 남은 까닭이 없어 지운다
    c: ['recent'],
    d: ['favorited'],
    x: ['favorited', 'recent'],
    y: ['recent'],
  })
  assert.ok(!plan.changes.some((c) => c.pageId === 'c'), '바뀌지 않는 사본은 계획에 없다')
})

test('② ★ 끈 스위치는 모든 곳에서 · 켠 스위치는 이 워크스페이스에서만', () => {
  const records = [rec('a', ['recent'], OTHER), rec('b', ['favorited'], OTHER), rec('c', ['favorited', 'toggled'])]
  const plan = planAutoDownload({ records, settings: { favorites: true, recent: false }, workspaceId: WS, sources: { favorites: [], recent: ['a'] } })
  assert.deepEqual(apply(records, plan), {
    // a — 최근을 껐다: 다른 워크스페이스여도 뺀다 → 지운다
    b: ['favorited'], // 다른 워크스페이스의 즐겨찾기는 그곳을 열 때 맞춘다
    c: ['toggled'], // 이 워크스페이스에서는 더는 즐겨찾기가 아니다 · 직접은 남는다
  })
  assert.deepEqual(plan.downloads, [], '끈 스위치의 원천은 받지 않는다')

  const allOff = planAutoDownload({ records, settings: AUTO_DOWNLOAD_OFF, workspaceId: null, sources: null })
  assert.deepEqual(apply(records, allOff), { c: ['toggled'] }, '둘 다 끄면 자동 까닭이 모두 빠진다(워크스페이스를 몰라도)')
})

test('③ ★ 원천을 받지 못했으면 켠 까닭은 그대로 · 받지 않는다', () => {
  const records = [rec('a', ['favorited']), rec('b', ['recent'])]
  const plan = planAutoDownload({ records, settings: { favorites: true, recent: false }, workspaceId: WS, sources: null })
  assert.deepEqual(apply(records, plan), { a: ['favorited'] }, '최근은 꺼서 빠지고 즐겨찾기는 그대로')
  assert.deepEqual(plan.downloads, [])
  // 요금제가 막았다 — 원하는 것이 없다
  const blocked = planAutoDownload({ records, settings: ON, workspaceId: WS, sources: NO_SOURCES })
  assert.deepEqual(apply(records, blocked), {})
})

test('④ ★ GC — 못 보낸 편집이 있는 사본은 빈 채로 남고, 보낸 뒤의 돌기가 지운다', () => {
  const records = [rec('a', ['favorited']), rec('b', ['recent']), rec('c', ['toggled'])]
  const first = planAutoDownload({ records, settings: ON, workspaceId: WS, sources: NO_SOURCES })
  const afterFirst = apply(records, first, new Set(['a']))
  assert.deepEqual(afterFirst, { a: [], c: ['toggled'] }, 'a 는 편집을 못 보내 빈 채로 · b 는 지운다 · 직접은 자동이 건드리지 않는다')

  // 다음 돌기 — 아직 못 보냈다: 그대로 남는다
  const still = [rec('a', []), rec('c', ['toggled'])]
  const second = planAutoDownload({ records: still, settings: AUTO_DOWNLOAD_OFF, workspaceId: WS, sources: null })
  assert.ok(second.changes.some((c) => c.pageId === 'a'), '빈 사본은 늘 계획에 든다')
  assert.deepEqual(apply(still, second, new Set(['a'])), { a: [], c: ['toggled'] })
  // 보낸 뒤의 돌기 — 지운다
  assert.deepEqual(apply(still, second, new Set()), { c: ['toggled'] })

  // 빈 사본이 다시 즐겨찾기가 되면 까닭이 붙어 남는다
  const again = planAutoDownload({ records: still, settings: ON, workspaceId: WS, sources: { favorites: ['a'], recent: [] } })
  assert.deepEqual(apply(still, again), { a: ['favorited'], c: ['toggled'] })
  assert.deepEqual(again.downloads, [], '사본이 있으면 받지 않는다(다시 받기는 판 묻기가 한다)')
})

test('④ 까닭 바꾸기 — 같은 까닭은 한 번 · 바뀐 것이 없으면 그 기록 그대로 · 빈 채로 남길 때도 그대로', () => {
  const r = rec('a', ['toggled'])
  assert.equal(withReasonChange(r, { add: ['toggled'], drop: [] }, false), r)
  assert.deepEqual(withReasonChange(r, { add: ['recent', 'recent'], drop: [] }, false)?.reasons, ['toggled', 'recent'])
  assert.equal(withReasonChange(r, { add: [], drop: ['toggled'] }, false), null)
  assert.deepEqual(withReasonChange(r, { add: [], drop: ['toggled'] }, true)?.reasons, [])
  const empty = rec('b', [])
  assert.equal(withReasonChange(empty, { add: [], drop: [] }, true), empty)
  assert.equal(withReasonChange(empty, { add: [], drop: [] }, false), null)
  // 설정의 지우기 — 까닭을 모두 뺀다
  const all = rec('c', ['toggled', 'favorited', 'recent'])
  assert.equal(withReasonChange(all, { add: [], drop: OFFLINE_REASONS }, false), null)
  assert.deepEqual(withReasonChange(all, { add: [], drop: OFFLINE_REASONS }, true)?.reasons, [], '못 보낸 편집이 있으면 남긴다')
})

test('⑤ 최근은 10개까지 · 원천의 답 · 스위치 읽기', () => {
  const recent = Array.from({ length: 12 }, (_, i) => `r${i}`)
  const plan = planAutoDownload({ records: [], settings: { favorites: false, recent: true }, workspaceId: WS, sources: { favorites: ['f'], recent } })
  assert.equal(AUTO_RECENT_LIMIT, 10)
  assert.deepEqual(plan.downloads.map((d) => d.pageId), recent.slice(0, 10), '앞의 10개(가장 최근) · 끈 즐겨찾기는 받지 않는다')

  assert.deepEqual(parseAutoSources({ favorites: ['a'], recent }), { favorites: ['a'], recent: recent.slice(0, 10) })
  for (const bad of [null, [], 'x', { favorites: ['a'] }, { favorites: [1], recent: [] }, { favorites: [], recent: 'a' }]) {
    assert.equal(parseAutoSources(bad), null, JSON.stringify(bad))
  }

  assert.deepEqual(readAutoDownload(undefined), AUTO_DOWNLOAD_OFF)
  assert.deepEqual(readAutoDownload({ favorites: true, recent: 'yes' }), { favorites: true, recent: false })
  assert.equal(autoDownloadKey('u1'), 'auto-download:u1')
  assert.equal(anyAutoOn(AUTO_DOWNLOAD_OFF), false)
  assert.equal(anyAutoOn({ favorites: false, recent: true }), true)

  // 지금 연 워크스페이스 — 앱 주소에서
  assert.equal(workspaceFromPath('/w/ws-1'), 'ws-1')
  assert.equal(workspaceFromPath('/w/ws-1/settings'), 'ws-1')
  assert.equal(workspaceFromPath('/w/ws-1/db/x'), 'ws-1')
  assert.equal(workspaceFromPath('/offline'), undefined)
  assert.equal(workspaceFromPath('/'), undefined)
})
