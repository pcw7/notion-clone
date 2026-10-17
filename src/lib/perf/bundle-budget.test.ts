/**
 * 번들 예산 — 플랫폼 잔여 10g-1 (F-12-07 · 정본 §3.10 끝 [보강] 성능 계측 ⑥)
 *
 *   ① 처음 받는 파일 — 모든 경로의 것 ∪ 레이아웃 · 페이지의 것 · 겹치면 한 번
 *   ② 규칙 — 데이터베이스 · 페이지 · 워크스페이스의 다른 화면 · 나머지(앞에서부터 처음 맞는 것 · 마지막은 모든 것)
 *   ③ 견주기 — 넘으면 over · 상한과 같으면 넘지 않았다
 *   ④ ★ 여유는 가장 작은 무거운 덩어리보다 작다 — 정할 때의 크기에 그것이 들어오면 넘는다
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { BUNDLE_BUDGETS, HEAVY_CHUNK_KB, budgetFor, initialFiles, judge } from './bundle-budget.ts'

test('① 처음 받는 파일 — 모든 경로의 것 ∪ 레이아웃 · 페이지의 것 · 겹치면 한 번', () => {
  const files = initialFiles(['static/chunks/main.js', 'static/chunks/react.js'], {
    '[project]/src/app/layout': ['static/chunks/main.js'],
    '[project]/src/app/w/[workspaceId]/layout': ['static/chunks/main.js', 'static/chunks/sidebar.js'],
    '[project]/src/app/w/[workspaceId]/[pageId]/page': ['static/chunks/sidebar.js', 'static/chunks/editor.js'],
  })
  assert.deepEqual(files, ['static/chunks/main.js', 'static/chunks/react.js', 'static/chunks/sidebar.js', 'static/chunks/editor.js'])
  assert.deepEqual(initialFiles(['static/chunks/main.js'], {}), ['static/chunks/main.js'], '진입 청크가 없는 경로')
})

test('② 규칙 — 앞에서부터 처음 맞는 것 · 마지막은 모든 것', () => {
  const max = (route: string) => budgetFor(route).maxKB
  assert.equal(max('/w/[workspaceId]/db/[databaseId]/page'), 520)
  assert.equal(max('/w/[workspaceId]/db/[databaseId]/templates/[templateId]/page'), 470, '템플릿 편집은 데이터베이스 화면보다 작아 따로')
  assert.equal(max('/w/[workspaceId]/[pageId]/page'), 450)
  assert.equal(max('/w/[workspaceId]/settings/page'), 230)
  assert.equal(max('/w/[workspaceId]/page'), 230, '워크스페이스 홈은 편집기가 없다')
  assert.equal(max('/login/page'), 160)
  assert.equal(max('/p/[token]/[pageId]/page'), 160, '공개 화면은 서버에서 그린다')
  assert.equal(max('/page'), 160)
  assert.ok(BUNDLE_BUDGETS[BUNDLE_BUDGETS.length - 1].pattern.test('/anything/at/all'), '마지막 규칙은 모든 경로에 맞는다')
})

test('③ 견주기 — 넘으면 over · 상한과 같으면 넘지 않았다', () => {
  const at = (route: string, kb: number) => ({ route, files: 3, gzipBytes: kb * 1024, rawBytes: kb * 3 * 1024 })
  const [same, over, under] = judge([at('/w/[workspaceId]/[pageId]/page', 450), at('/login/page', 160.01), at('/w/[workspaceId]/page', 100)])
  assert.deepEqual([same.over, over.over, under.over], [false, true, false])
  assert.deepEqual([same.maxKB, over.maxKB, under.maxKB], [450, 160, 230])
  assert.equal(same.files, 3, '잰 값은 그대로 싣는다')
})

test('④ ★ 여유는 가장 작은 무거운 덩어리보다 작다 — 정할 때의 크기에 그것이 들어오면 넘는다', () => {
  for (const rule of BUNDLE_BUDGETS) {
    const headroom = rule.maxKB - rule.baselineKB
    assert.ok(headroom > 0, `${rule.why} — 예산이 정할 때의 크기보다 작다`)
    assert.ok(headroom < HEAVY_CHUNK_KB, `${rule.why} — 여유 ${headroom}KB 는 KaTeX(${HEAVY_CHUNK_KB}KB)가 들어와도 넘지 않는다`)
  }
})
