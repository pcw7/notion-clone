/**
 * 성능 계측 — 쌓기 · 보고 (10e-1a · F-12-18)
 *
 *   ① ★ 쌓기 — 다듬은 측정값을 한 번에 · 경로는 틀만(id · 제목 없음) · 표본 비율 · 끝났는가가 함께 남는다
 *   ② ★ 표가 모양을 막는다 — 모르는 지표 · 틀이 아닌 경로(대문자 · 한글 · uuid 그대로) · 범위 밖의 값 · 표본 비율
 *   ③ ★ 보고 — 끝난 측정의 p50 · p75 · p95 · 끝나지 않은 비율 · 표본 비율로 되돌린 수 · 기간 밖은 빠진다
 *   ④ 받는 쪽의 문 — 살아 있는 세션의 사람만(없는 · 지난 토큰은 null)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { normalizePerfBatch } from './perf-events.ts'
import { perfReport, recordPerfEvents, sessionUserOf } from './perf-store.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

/** 이 검사만의 경로 — 다른 검사의 줄과 섞이지 않게 정적 조각 하나를 더 붙인다(보고는 경로마다). */
const ROUTE_TAIL = 'templates'

describe('성능 계측', () => {
  test('① ★ 쌓기 — 경로는 틀만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const id = randomUUID()
    const events = normalizePerfBatch([
      { metric: 'LCP', value: 1500, route: `/w/${id}/${id}?q=제목`, navigation: 'navigate', sampleRate: 0.25 },
      { metric: 'editor_ready', value: 900, route: `/w/${id}/${id}`, completed: false, sampleRate: 0.25 },
    ])
    const before = (await query<{ max: string | null }>(`SELECT max(id)::text AS max FROM perf_event`))[0]?.max ?? '0'
    assert.equal(await recordPerfEvents(events), 2)
    const rows = await query<{ metric_key: string; route: string; completed: boolean; sample_rate: number; navigation: string | null }>(
      `SELECT metric_key, route, completed, sample_rate, navigation FROM perf_event WHERE id > $1 ORDER BY id`,
      [before],
    )
    assert.deepEqual(rows, [
      { metric_key: 'LCP', route: '/w/[id]/[id]', completed: true, sample_rate: 0.25, navigation: 'navigate' },
      { metric_key: 'editor_ready', route: '/w/[id]/[id]', completed: false, sample_rate: 0.25, navigation: null },
    ])
    assert.equal(await recordPerfEvents([]), 0)
  })

  test('② ★ 표가 모양을 막는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const insert = (metric: string, value: number, route: string, rate: number) =>
      query(`INSERT INTO perf_event (metric_key, value, route, sample_rate) VALUES ($1, $2, $3, $4)`, [metric, value, route, rate])
    await assert.rejects(insert('FID', 1, '/w/[id]', 1), /ck_perf_event_metric/)
    await assert.rejects(insert('LCP', 1, `/w/${randomUUID()}`, 1), /ck_perf_event_route/, 'uuid 그대로')
    await assert.rejects(insert('LCP', 1, '/s/회의록', 1), /ck_perf_event_route/, '한글(제목)')
    await assert.rejects(insert('LCP', 1, '/P/Token', 1), /ck_perf_event_route/, '대문자(토큰)')
    await assert.rejects(insert('LCP', -1, '/w/[id]', 1), /ck_perf_event_value/)
    await assert.rejects(insert('LCP', 600000, '/w/[id]', 1), /ck_perf_event_value/)
    await assert.rejects(insert('LCP', 1, '/w/[id]', 0), /ck_perf_event_sample_rate/)
    await insert('LCP', 1, '/', 1)
  })

  test('③ ★ 보고 — 백분위 · 끝나지 않은 비율 · 추정 수 · 기간', async (t) => {
    if (skipReason) return t.skip(skipReason)
    // 이 검사만의 경로 틀 — 틀은 id 를 접으므로 지난 실행의 줄이 같은 틀에 쌓인다. 먼저 비운다
    const template = `/w/[id]/${ROUTE_TAIL}/[x]`
    await query(`DELETE FROM perf_event WHERE route = $1`, [template])
    const route = `/w/${randomUUID()}/${ROUTE_TAIL}/${randomUUID().slice(0, 8)}x`
    const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 100)
    await recordPerfEvents(normalizePerfBatch(values.map((value) => ({ metric: 'INP', value, route, sampleRate: 0.5 }))))
    await recordPerfEvents(normalizePerfBatch([{ metric: 'INP', value: 99999, route, completed: false, sampleRate: 0.5 }]))
    // 기간 밖 — 40일 전
    await query(`INSERT INTO perf_event (metric_key, value, route, sample_rate, recorded_at) VALUES ('INP', 1, $1, 0.5, now() - interval '40 days')`, [template])
    const mine = (await perfReport(30)).filter((r) => r.metric === 'INP' && r.route === template)
    assert.equal(mine.length, 1)
    const row = mine[0]!
    assert.equal(row.samples, 21, '기간 밖은 빠진다')
    assert.deepEqual([row.p50, row.p75, row.p95], [1000, 1500, 1900], '끝나지 않은 99999 는 백분위에 들지 않는다')
    assert.equal(row.estimated, 42, '표본 비율 0.5 — 21줄은 42')
    assert.ok(Math.abs(row.incompleteRate - 1 / 21) < 1e-9, '끝나지 않은 비율')
  })

  test('④ 받는 쪽의 문 — 살아 있는 세션의 사람만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const actor = await joinAs(await createBareWorkspace('계측'), await createUser('계측의 사람'), 'member')
    assert.equal(await sessionUserOf(actor.token), actor.userId)
    assert.equal(await sessionUserOf(null), null)
    assert.equal(await sessionUserOf('없는-토큰'), null)
    await query(`UPDATE user_session SET revoked_at = now() WHERE user_id = $1`, [actor.userId])
    assert.equal(await sessionUserOf(actor.token), null, '폐기된 세션')
  })
})
