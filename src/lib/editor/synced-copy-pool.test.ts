/**
 * 사본의 embed 연결 묶음 (SB-2 · 정본 [보강 SB-0] ⑧ · DOM 없음 · 가짜 연결)
 *
 *   ① 원본 페이지 하나에 연결 하나 — 같은 페이지의 사본 둘이 나눈다 · 늦게 온 사본도 마지막 스냅숏을 곧바로 받는다
 *   ② 화면에 들 때 연다 — 보이지 않은 사본은 열지 않는다
 *   ③ 상한을 넘으면 보이는 사본이 없는 것 중 가장 오래 안 보인 것부터 끊는다(그 사본은 null) · 모두 보이면 끊지 않는다 · 다시 보이면 새로 연다
 *   ④ 마지막 사본이 떠나면 닫는다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { CollabConnection, CollabSnapshot } from '../collab/collab-connection.ts'
import { createEmbedPool } from './synced-copy-pool.ts'

function harness(cap = 2) {
  let clock = 0
  const opened: string[] = []
  const destroyed: string[] = []
  const emitters = new Map<string, (snapshot: CollabSnapshot) => void>()
  const pool = createEmbedPool({
    cap,
    now: () => (clock += 1),
    open: async (pageId, onChange) => {
      opened.push(pageId)
      emitters.set(pageId, onChange)
      return { destroy: async () => void destroyed.push(pageId) } as unknown as CollabConnection
    },
  })
  const emit = (pageId: string, tag: string) => emitters.get(pageId)?.({ closed: null, tag } as unknown as CollabSnapshot)
  return { pool, opened, destroyed, emit }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))
const tagOf = (snapshot: CollabSnapshot | null) => (snapshot === null ? null : (snapshot as unknown as { tag: string }).tag)

describe('사본의 연결 묶음 (⑧)', () => {
  test('★ ① 원본 페이지 하나에 연결 하나 · ② 화면에 들 때 연다', async () => {
    const { pool, opened, emit } = harness()
    const seenA: (string | null)[] = []
    const a = pool.acquire('A', (s) => seenA.push(tagOf(s)))
    assert.deepEqual(opened, [], '보이지 않으면 열지 않는다')
    a.setVisible(true)
    const b = pool.acquire('A', () => undefined)
    b.setVisible(true)
    assert.deepEqual(opened, ['A'], '같은 페이지의 사본 둘이 나눈다')
    emit('A', 's1')
    assert.deepEqual(seenA, ['s1'])
    const late: (string | null)[] = []
    pool.acquire('A', (s) => late.push(tagOf(s)))
    assert.deepEqual(late, ['s1'], '늦게 온 사본도 마지막 스냅숏을 받는다')
  })

  test('★ ③ 상한 — 보이는 사본이 없는 것 중 가장 오래 안 보인 것부터 끊는다 · 다시 보이면 새로 연다', async () => {
    const { pool, opened, destroyed, emit } = harness(2)
    const seen = new Map<string, (string | null)[]>()
    const lease = (page: string) => pool.acquire(page, (s) => seen.set(page, [...(seen.get(page) ?? []), tagOf(s)]))
    const [a, b, c] = [lease('A'), lease('B'), lease('C')]
    a.setVisible(true)
    emit('A', 'a1')
    a.setVisible(false) // A 가 가장 오래 안 보였다
    b.setVisible(true)
    b.setVisible(false)
    c.setVisible(true)
    await tick()
    assert.deepEqual(opened, ['A', 'B', 'C'])
    assert.deepEqual(pool.openPages().sort(), ['B', 'C'], '상한 2 — A 를 끊었다')
    assert.deepEqual(destroyed, ['A'])
    assert.deepEqual(seen.get('A'), ['a1', null], '끊긴 페이지의 사본은 null 을 받는다')

    a.setVisible(true)
    await tick()
    assert.deepEqual(opened, ['A', 'B', 'C', 'A'], '다시 보이면 새로 연다')
    assert.deepEqual(pool.openPages().sort(), ['A', 'C'], '이번에는 B 가 가장 오래 안 보였다')

    // 모두 보이는 중이면 넘겨도 끊지 않는다
    const d = lease('D')
    d.setVisible(true)
    assert.deepEqual(pool.openPages().sort(), ['A', 'C', 'D'])
  })

  test('★ ④ 마지막 사본이 떠나면 닫는다', async () => {
    const { pool, destroyed } = harness()
    const [a1, a2] = [pool.acquire('A', () => undefined), pool.acquire('A', () => undefined)]
    a1.setVisible(true)
    a1.release()
    await tick()
    assert.deepEqual(destroyed, [], '다른 사본이 남았다')
    a2.release()
    await tick()
    assert.deepEqual(destroyed, ['A'])
    assert.deepEqual(pool.openPages(), [])
  })
})
