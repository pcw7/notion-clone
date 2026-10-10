/**
 * 공용 스케줄러 — 히스토리 · 활동 4a-1 (DB 필요)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 넣기 — 살아 있는 일은 키마다 하나 · 죽은 일은 키를 막지 않는다
 *   ② 때가 된 일만 돈다 — 끝나면 행이 지워진다 · 주기 일은 같은 키로 다음 실행이 다시 들어간다
 *   ③ 실패하면 물러난다 — 1분 · 2분 … · 다섯 번째에 멈춘다(`dead_at` · 행은 남는다) · 죽은 일은 돌지 않는다
 *   ④ 임대 — 한 일은 한 워커만 돈다(동시에 돌려도) · 임대가 지난 일(죽은 워커)은 다시 가져간다
 *   ⑤ 주기 일 넣기는 멱등이다
 *
 * 검사는 `version_gc` 종류에 일을 바꿔 끼운다(`handlers`) — 진짜 GC 는 다른 검사의 버전 · 휴지통을 건드린다. 검사마다 표를 비운다
 * (이 표를 쓰는 검사는 이 파일뿐이다).
 *
 * 반사실(HANDOFF §3.3): 임대를 안 걸면 ④ 의 동시 실행이, 키를 안 보면 ① 이, 다섯 번에 멈추지 않으면 ③ 이 실패한다.
 */

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { enqueueJob, ensureRecurringJobs, MAX_ATTEMPTS, RECURRING, runDueJobs, type JobHandler } from './scheduler.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

beforeEach(async () => {
  if (!skipReason) await query(`DELETE FROM scheduled_job`)
})

after(async () => {
  if (!skipReason) {
    await query(`DELETE FROM scheduled_job`)
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const NOW = new Date('2030-01-01T00:00:00Z')
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)
const put = (runAt: Date, dedupeKey?: string, payload: Record<string, unknown> = {}) =>
  withTransaction((tx) => enqueueJob(tx, { kind: 'version_gc', runAt, payload, ...(dedupeKey === undefined ? {} : { dedupeKey }) }))
type JobRow = { id: string; run_at: Date; dedupe_key: string | null; attempts: number; locked_until: Date | null; last_error: string | null; dead_at: Date | null }
const jobs = () => query<JobRow>(`SELECT id, run_at, dedupe_key, attempts, locked_until, last_error, dead_at FROM scheduled_job ORDER BY run_at, id`)
const once: JobHandler = async () => ({ again: null })

describe('① 넣기', () => {
  test('★ 살아 있는 일은 키마다 하나 — 다른 키 · 키 없는 일은 따로 · 죽은 일은 키를 막지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    assert.equal(await put(at(0), 'k'), true)
    assert.equal(await put(at(5), 'k'), false, '같은 키의 일이 살아 있다')
    assert.equal(await put(at(0), 'other'), true)
    assert.equal(await put(at(0)), true)
    assert.equal(await put(at(0)), true, '키 없는 일은 몇 개든')
    await query(`UPDATE scheduled_job SET dead_at = now() WHERE dedupe_key = 'k'`)
    assert.equal(await put(at(0), 'k'), true, '죽은 일은 키를 막지 않는다')
  })
})

describe('② 때가 된 일', () => {
  test('★ 때가 된 일만 돌고 끝나면 지워진다 · 주기 일은 같은 키로 다음 실행이 들어간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    await put(at(-1), undefined, { n: 1 })
    await put(at(60), 'later')
    const seen: unknown[] = []
    const result = await runDueJobs({ now: NOW, handlers: { version_gc: async (payload) => (seen.push(payload), { again: null }) } })
    assert.deepEqual([result.ran, result.failed, seen], [1, 0, [{ n: 1 }]])
    assert.deepEqual((await jobs()).map((j) => j.dedupe_key), ['later'], '끝난 일은 지워지고 때가 안 된 일은 남는다')

    await query(`DELETE FROM scheduled_job`)
    await put(at(0), 'every-hour', { p: true })
    await runDueJobs({ now: NOW, handlers: { version_gc: async () => ({ again: at(60) }) } })
    const [next] = await jobs()
    assert.deepEqual([next?.dedupe_key, next?.run_at.getTime(), next?.attempts], ['every-hour', at(60).getTime(), 0], '같은 키로 다음 실행')
  })
})

describe('③ 실패', () => {
  test('★ 실패하면 1분 · 2분 … 뒤로 물러나고 다섯 번째에 멈춘다 — 죽은 일은 돌지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    await put(at(0), 'flaky')
    const boom: JobHandler = async () => {
      throw new Error('터졌다')
    }
    let now = NOW
    const delays: number[] = []
    for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
      const result = await runDueJobs({ now, handlers: { version_gc: boom } })
      assert.deepEqual([result.ran, result.failed], [1, 1], `${i}번째`)
      const [job] = await jobs()
      assert.deepEqual([job?.attempts, job?.last_error, job?.locked_until], [i, '터졌다', null])
      delays.push((job!.run_at.getTime() - now.getTime()) / 60_000)
      now = job!.run_at
    }
    assert.deepEqual(delays, [1, 2, 4, 8, 16])
    const [dead] = await jobs()
    assert.ok(dead?.dead_at !== null, '다섯 번째에 멈춘다 — 행은 남는다')
    const later = await runDueJobs({ now: at(10_000), handlers: { version_gc: once } })
    assert.equal(later.ran, 0, '죽은 일은 돌지 않는다')
  })
})

describe('④ 임대', () => {
  test('★ 한 일은 한 워커만 돈다 — 도는 동안 다른 판은 그 일을 가져가지 못한다 · 임대가 지나면 다시 가져간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    await put(at(0), 'slow')
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    let calls = 0
    const slow: JobHandler = async () => {
      calls += 1
      await gate
      return { again: null }
    }
    const first = runDueJobs({ now: NOW, handlers: { version_gc: slow } })
    // 첫 판이 일을 가져갈 때까지 기다린다
    for (let i = 0; i < 50 && (await jobs())[0]?.locked_until === null; i += 1) await new Promise((r) => setTimeout(r, 20))
    // 둘째 판은 곧바로 끝나는 일로 — 임대가 깨져 그 일을 가져가면 멈추지 않고 떨어진다(같은 `slow` 를 쓰면 열리지 않는 문 앞에서 멈춘다)
    const second = await runDueJobs({ now: NOW, handlers: { version_gc: once } })
    assert.equal(second.ran, 0, '임대 중인 일은 다른 판이 가져가지 못한다')
    release()
    assert.equal((await first).ran, 1)
    assert.deepEqual([calls, (await jobs()).length], [1, 0])

    // 죽은 워커 — 임대가 지난 일은 다시 가져간다
    await put(at(0), 'orphan')
    await query(`UPDATE scheduled_job SET locked_until = $1 WHERE dedupe_key = 'orphan'`, [at(-1)])
    assert.equal((await runDueJobs({ now: NOW, handlers: { version_gc: once } })).ran, 1)
  })
})

describe('⑤ 주기 일 넣기', () => {
  test('멱등이다 — 이미 살아 있으면 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    assert.equal(await ensureRecurringJobs(NOW), RECURRING.length)
    assert.equal(await ensureRecurringJobs(at(5)), 0)
    assert.deepEqual((await jobs()).map((j) => j.dedupe_key).sort(), ['data_retention', 'reminder_fire', 'trash_hard_delete', 'trash_purge', 'version_gc'])
  })
})
