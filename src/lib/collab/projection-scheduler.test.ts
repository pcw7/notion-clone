/**
 * 밀린 투영의 창 — CRDT 5d (DB 없음 · 시계를 손으로 돌린다)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **창은 처음 청한 때부터 잰다** — 창 안에서 여러 번 청해도 한 번 돌고, 뒤따른 청이 창을 밀지 않는다
 *   ② **한 페이지에 하나만 돈다** — 도는 동안 청하면 끝난 뒤 창을 한 번 더 열고, 청하지 않았으면 열지 않는다
 *   ③ **마지막으로 청한 사람의 세션으로 돈다** · 페이지마다 따로 · 실패는 기록하고 다음 청을 막지 않는다
 *   ④ **`flush` 는 창을 기다리지 않고 돌리고, 도는 동안 청한 것까지 끝나기를 기다린다**
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { SessionContext } from '../auth/session-context.ts'
import { createProjectionScheduler } from './projection-scheduler.ts'

/** 손으로 돌리는 시계 — 창의 타이머만 흉내 낸다. */
function manualClock() {
  let now = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  let next = 1
  return {
    setTimer: (run: () => void, ms: number): unknown => {
      const id = next++
      timers.set(id, { at: now + ms, run })
      return id
    },
    clearTimer: (id: unknown): void => void timers.delete(id as number),
    /** `ms` 만큼 흘려 그때까지 닿은 타이머를 돌린다. */
    advance(ms: number): void {
      now += ms
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now) continue
        timers.delete(id)
        timer.run()
      }
    },
    pending: (): number => timers.size,
  }
}

/** 부를 때마다 기록하고, 끝내기는 검사가 정한다. */
function recordingProject() {
  const calls: { pageId: string; user: string; finish(error?: Error): void }[] = []
  const project = (pageId: string, ctx: SessionContext): Promise<void> =>
    new Promise((resolve, reject) => {
      calls.push({ pageId, user: ctx.userId, finish: (error) => (error === undefined ? resolve() : reject(error)) })
    })
  return { calls, project }
}

const ctxOf = (userId: string): SessionContext => ({ userId, workspaceId: 'ws' }) as unknown as SessionContext
const settle = () => new Promise((resolve) => setImmediate(resolve))

describe('① 창은 처음 청한 때부터', () => {
  test('★ 창 안에서 여러 번 청해도 한 번 돌고, 뒤따른 청이 창을 밀지 않는다', async () => {
    const clock = manualClock()
    const { calls, project } = recordingProject()
    const scheduler = createProjectionScheduler({ project, delayMs: 1000, ...clock })

    scheduler.request('p', ctxOf('a'))
    clock.advance(600)
    scheduler.request('p', ctxOf('a'))
    clock.advance(300)
    scheduler.request('p', ctxOf('a'))
    assert.equal(calls.length, 0, '창이 지나기 전에 돌았다')
    clock.advance(100)
    assert.equal(calls.length, 1, '처음 청한 때부터 창이 지났는데 돌지 않았다 — 뒤따른 청이 창을 밀었다')
    calls[0].finish()
    await settle()
    assert.equal(clock.pending(), 0, '돌기 전에 청한 것은 그 투영이 옮기는데 창을 또 열었다')
  })
})

describe('② 한 페이지에 하나만', () => {
  test('★ 도는 동안 청하면 끝난 뒤 창을 한 번 더 열고, 그 창도 처음 청한 때가 아니라 끝난 때부터 잰다', async () => {
    const clock = manualClock()
    const { calls, project } = recordingProject()
    const scheduler = createProjectionScheduler({ project, delayMs: 1000, ...clock })

    scheduler.request('p', ctxOf('a'))
    clock.advance(1000)
    assert.equal(calls.length, 1)
    scheduler.request('p', ctxOf('b'))
    scheduler.request('p', ctxOf('b'))
    clock.advance(5000)
    assert.equal(calls.length, 1, '도는 동안 같은 페이지를 또 돌렸다')

    calls[0].finish()
    await settle()
    assert.equal(clock.pending(), 1, '도는 동안 청한 것을 위한 창을 열지 않았다')
    assert.equal(calls.length, 1, '끝나자마자 또 돌았다 — 창을 끝난 때부터 재지 않았다')
    clock.advance(1000)
    assert.equal(calls.length, 2)
    assert.equal(calls[1].user, 'b', '마지막으로 청한 사람의 세션으로 돌지 않았다')
    calls[1].finish()
    await settle()
    assert.equal(clock.pending(), 0)
  })
})

describe('③ 페이지마다 따로 · 실패', () => {
  test('페이지마다 창이 따로다 — 한 페이지의 실패는 기록하고 다음 청을 막지 않는다', async () => {
    const clock = manualClock()
    const { calls, project } = recordingProject()
    const errors: string[] = []
    const scheduler = createProjectionScheduler({ project, delayMs: 1000, ...clock, onError: (pageId) => void errors.push(pageId) })

    scheduler.request('p', ctxOf('a'))
    clock.advance(500)
    scheduler.request('q', ctxOf('a'))
    clock.advance(500)
    assert.deepEqual(calls.map((c) => c.pageId), ['p'])
    calls[0].finish(new Error('투영 실패'))
    await settle()
    assert.deepEqual(errors, ['p'])
    clock.advance(500)
    assert.deepEqual(calls.map((c) => c.pageId), ['p', 'q'])
    calls[1].finish()

    scheduler.request('p', ctxOf('a'))
    clock.advance(1000)
    assert.deepEqual(calls.map((c) => c.pageId), ['p', 'q', 'p'], '실패한 페이지의 다음 청이 돌지 않았다')
    calls[2].finish()
  })
})

describe('④ flush', () => {
  test('★ 창을 기다리지 않고 돌리고, 도는 동안 청한 것까지 끝나기를 기다린다', async () => {
    const clock = manualClock()
    const { calls, project } = recordingProject()
    const scheduler = createProjectionScheduler({ project, delayMs: 1000, ...clock })

    scheduler.request('p', ctxOf('a'))
    scheduler.request('q', ctxOf('a'))
    let flushed = false
    const flushing = scheduler.flush().then(() => {
      flushed = true
    })
    await settle()
    assert.deepEqual(calls.map((c) => c.pageId).sort(), ['p', 'q'], '창을 기다렸다')

    scheduler.request('p', ctxOf('b')) // 도는 동안 청한다
    calls[0].finish()
    calls[1].finish()
    await settle()
    assert.equal(flushed, false, '도는 동안 청한 것을 두고 끝났다')
    assert.equal(calls.length, 3)
    assert.equal(calls[2].user, 'b')
    calls[2].finish()
    await flushing
    assert.equal(clock.pending(), 0)
  })
})
