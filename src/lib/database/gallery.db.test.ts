/**
 * 갤러리 뷰 — 뷰 타입 (DB 심화 2f-1조각 · F-04-05, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 갤러리
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 갤러리 뷰를 만들고 · 표를 갤러리로 바꾸고 · 갤러리를 표로 되돌린다 — 그룹이 필요 없다
 *   ② 아직 받지 않는 뷰 타입(캘린더)은 거부한다(`unsupported_type`) — CHECK(`ck_view_type`)은 받지만 명령이 막는다
 *
 * 부모만 그리는 규칙(하위 항목)은 행 라우트 · 서버 렌더의 일이라 e2e 가 본다.
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { createView, getView, updateView, type MvpViewType } from './view.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

describe('① 갤러리 뷰', () => {
  test('★ 만들고 · 표에서 바꾸고 · 표로 되돌린다 — 그룹이 필요 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: `갤러리 ${Date.now()}` }))
    const gallery = unwrap(await createView(fx.owner.ctx, db.id, { type: 'gallery', name: '갤러리' }))
    assert.equal(gallery.type, 'gallery')
    assert.equal(gallery.groupBy, null)
    assert.equal(unwrap(await getView(fx.owner.ctx, gallery.id)).type, 'gallery')

    const switched = unwrap(await updateView(fx.owner.ctx, db.defaultViewId, { type: 'gallery' }))
    assert.equal(switched.type, 'gallery')
    assert.equal(unwrap(await updateView(fx.owner.ctx, db.defaultViewId, { type: 'table' })).type, 'table')
  })
})

describe('② 아직 받지 않는 뷰 타입', () => {
  test('캘린더는 거부한다 — CHECK 은 받는 이름이지만 명령이 막는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: `갤러리 ${Date.now()}` }))
    const r = await createView(fx.owner.ctx, db.id, { type: 'calendar' as MvpViewType })
    assert.equal(!r.ok && r.reason, 'unsupported_type')
  })
})
