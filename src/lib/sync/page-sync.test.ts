/**
 * 저장 큐 — F-05-04
 *
 * 이 파일이 지키는 것 넷. 전부 **사용자가 친 글이 사라지는** 종류다.
 *
 *   ① 네트워크가 죽어도 큐가 남고, 돌아오면 보낸다.
 *   ② **다시 보내도 소용없는 실패는 다시 보내지 않는다** — 좀비 항목 금지.
 *   ③ **ack 를 못 받은 저장을 충돌이라고 말하지 않는다.**
 *   ④ 지난 세션이 못 보낸 문서는 되살려 **화면에도** 돌려놓는다.
 *
 * 시계와 타이머를 주입받으므로 여기서는 시간이 손으로 흐른다 — 실제로 3초를
 * 기다리는 테스트는 쓰지 않는다(느리고, 느린 테스트는 결국 안 돌린다).
 */

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { createPageSync, type SendResult } from './page-sync.ts'
import { memoryOutboxStore } from './outbox-store.ts'
import {
  MAX_ATTEMPTS,
  MAX_BODY_BYTES,
  SEND_TIMEOUT_MS,
  SYNCING_AFTER_MS,
  backoffMs,
  bodyTooLarge,
  classifyFailure,
  coalesce,
  newEntry,
  sameDoc,
  syncState,
  type OutboxEntry,
  type SyncState,
} from './outbox.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorDoc } from '../editor/document.ts'

const PAGE = '11111111-1111-4111-8111-111111111111'
const WORKSPACE = '22222222-2222-4222-8222-222222222222'

const doc = (text: string): EditorDoc => ({
  blocks: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      type: 'paragraph',
      title: [textRun(text)],
      properties: {},
      format: {},
      children: [],
    },
  ],
})

/** 손으로 흐르는 시계 + 타이머. */
function fakeClock() {
  let time = 1_000
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => time,
    schedule: (fn: () => void, ms: number) => {
      const id = ++seq
      timers.set(id, { at: time + ms, fn })
      return () => timers.delete(id)
    },
    /** 시간을 흘린다. 그 사이에 걸린 타이머를 순서대로 실행한다. */
    async advance(ms: number): Promise<void> {
      const target = time + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        time = due[1].at
        due[1].fn()
        // 타이머가 만든 비동기 작업(전송 · 저장소 쓰기)이 **끝까지** 돌게 둔다.
        // `await Promise.resolve()` 몇 번으로는 부족하다 — 체인의 길이에 따라
        // 어떤 경로만 완주해서, 충돌 경로 세 개가 통과하지 못했다.
        await new Promise((resolve) => setImmediate(resolve))
      }
      time = target
      await new Promise((resolve) => setImmediate(resolve))
    },
    pending: () => timers.size,
  }
}

type Harness = ReturnType<typeof harness>

function harness(options: { results?: SendResult[]; remote?: { version: string; doc: EditorDoc } | null } = {}) {
  const clock = fakeClock()
  const store = memoryOutboxStore()
  const sent: OutboxEntry[] = []
  const states: SyncState[] = []
  const results = options.results ?? []
  let saved = 0

  const sync = createPageSync({
    workspaceId: WORKSPACE,
    pageId: PAGE,
    store,
    initialVersion: '7',
    send: async (entry) => {
      sent.push(entry)
      return results.shift() ?? { ok: true, version: String(7 + sent.length) }
    },
    fetchRemote: async () => options.remote ?? null,
    onState: (s) => states.push(s),
    onSaved: () => {
      saved += 1
    },
    now: clock.now,
    schedule: clock.schedule,
  })

  return { sync, store, sent, states, clock, saved: () => saved }
}

const lastState = (h: Harness): SyncState => h.states[h.states.length - 1]

describe('평상시 — 편집하면 잠시 뒤 보낸다', () => {
  test('디바운스 뒤 한 번 보낸다', async () => {
    const h = harness()
    h.sync.queue(doc('가'))
    assert.equal(h.sent.length, 0, '즉시 보내면 타이핑마다 왕복한다')
    await h.clock.advance(1000)
    assert.equal(h.sent.length, 1)
    assert.equal(h.sent[0].baseVersion, '7')
  })

  test('★ 연달아 치면 마지막 문서 하나만 보낸다 (coalesce)', async () => {
    const h = harness()
    h.sync.queue(doc('가'))
    await h.clock.advance(300)
    h.sync.queue(doc('가나'))
    await h.clock.advance(300)
    h.sync.queue(doc('가나다'))
    await h.clock.advance(1000)
    assert.equal(h.sent.length, 1)
    assert.equal(h.sent[0].doc.blocks[0].title[0].plain_text, '가나다')
  })

  test('보내고 나면 큐가 빈다 — 확정된 것은 남기지 않는다', async () => {
    const h = harness()
    h.sync.queue(doc('가'))
    await h.clock.advance(1000)
    assert.equal(await h.store.read(PAGE), null)
    assert.equal(lastState(h).kind, 'idle')
    assert.equal(h.saved(), 1)
  })

  test('★ 큐 적재는 전송보다 먼저 디스크에 닿는다 — 1초 안에 탭을 닫아도 남는다', async () => {
    const h = harness()
    h.sync.queue(doc('가'))
    await h.clock.advance(300)
    const stored = await h.store.read(PAGE)
    assert.ok(stored, '전송 전에는 디스크에 없다')
    assert.equal(stored.doc.blocks[0].title[0].plain_text, '가')
    assert.equal(h.sent.length, 0, '아직 보내지는 않았다')
  })

  test('flush() 는 기다리지 않고 지금 쓴다 (탭이 숨을 때)', async () => {
    const h = harness()
    h.sync.queue(doc('가'))
    await h.sync.flush()
    assert.ok(await h.store.read(PAGE))
  })

  test('저장이 끝나면 다음 저장의 기준 버전이 갱신된다', async () => {
    const h = harness()
    h.sync.queue(doc('가'))
    await h.clock.advance(1000)
    h.sync.queue(doc('나'))
    await h.clock.advance(1000)
    assert.equal(h.sent[1].baseVersion, '8')
  })
})

describe('★ 네트워크가 죽었을 때', () => {
  test('응답이 없으면 백오프로 다시 보낸다', async () => {
    const h = harness({ results: [{ ok: false, status: 0 }, { ok: false, status: 0 }] })
    h.sync.queue(doc('가'))
    await h.clock.advance(1000)
    assert.equal(h.sent.length, 1)

    await h.clock.advance(backoffMs(1))
    assert.equal(h.sent.length, 2, '첫 재시도')

    await h.clock.advance(backoffMs(2))
    assert.equal(h.sent.length, 3, '두 번째 재시도에서 성공')
    assert.equal(await h.store.read(PAGE), null)
  })

  test('재시도하는 동안 문서는 디스크에 남는다', async () => {
    const h = harness({ results: [{ ok: false, status: 0 }] })
    h.sync.queue(doc('가'))
    await h.clock.advance(1000)
    const stored = await h.store.read(PAGE)
    assert.ok(stored)
    assert.equal(stored.attempts, 1)
    assert.equal(stored.status, 'pending')
  })

  test(`★ ${MAX_ATTEMPTS}번 실패하면 격리하고 사용자에게 보여준다 — 조용히 버리지 않는다`, async () => {
    const h = harness({ results: Array.from({ length: MAX_ATTEMPTS }, () => ({ ok: false, status: 0 }) as SendResult) })
    h.sync.queue(doc('가'))
    await h.clock.advance(1000)
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) await h.clock.advance(backoffMs(i))

    assert.equal(h.sent.length, MAX_ATTEMPTS)
    const stored = await h.store.read(PAGE)
    assert.ok(stored, '격리된 항목은 디스크에 남아 있어야 한다')
    assert.equal(stored.status, 'rejected')
    assert.equal(lastState(h).kind, 'rejected')
    assert.equal(h.clock.pending(), 0, '격리한 뒤에도 타이머가 돌면 영원히 두드린다')
  })

  test('사용자가 "다시 시도"를 누르면 격리가 풀린다', async () => {
    const h = harness({ results: Array.from({ length: MAX_ATTEMPTS }, () => ({ ok: false, status: 0 }) as SendResult) })
    h.sync.queue(doc('가'))
    await h.clock.advance(1000)
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) await h.clock.advance(backoffMs(i))
    assert.equal(lastState(h).kind, 'rejected')

    await h.sync.sendNow()
    assert.equal(h.sent.length, MAX_ATTEMPTS + 1)
    assert.equal(lastState(h).kind, 'idle')
  })

  test('★ 3초 이상 밀리면 "동기화 중"이다. 그 전에는 조용하다', async () => {
    // 계속 실패해야 밀린 상태가 유지된다. 한 번만 실패시키면 백오프 재시도가
    // 성공해서 큐가 비어 버린다(처음 이 테스트를 그렇게 써서 틀렸다).
    const h = harness({ results: Array.from({ length: 3 }, () => ({ ok: false, status: 0 }) as SendResult) })
    h.sync.queue(doc('가'))
    await h.clock.advance(1000)
    assert.equal(lastState(h).kind, 'queued', '1초짜리 저장마다 표시를 띄우지 않는다')

    await h.clock.advance(backoffMs(1) + backoffMs(2))
    assert.ok(h.clock.now() - 1000 >= SYNCING_AFTER_MS, '아직 3초가 안 지났다면 시나리오가 틀린 것이다')
    assert.equal(lastState(h).kind, 'syncing')
  })
})

describe('★ 응답이 영영 오지 않을 때 (F-12-16)', () => {
  /**
   * 정본 F-12-16 엣지 케이스: *"오류 메시지 없이 실패(무응답 타임아웃) →
   * 클라이언트가 자체 타임아웃(예: 15초)을 걸고 '응답 없음' 상태를 만들어야
   * 한다. **아무것도 표시하지 않는 것이 최악이다.**"*
   *
   * 우리에게는 더 나쁜 결과가 있었다 — 전송 중 표시(`sending`)가 영영 안 풀려서
   * **그 세션의 저장이 통째로 멈췄다.** 큐에는 계속 쌓이지만 아무것도 안 나간다.
   */
  function hangingHarness() {
    const clock = fakeClock()
    const store = memoryOutboxStore()
    const states: SyncState[] = []
    let calls = 0
    let resolveSecond: ((r: SendResult) => void) | null = null

    const sync = createPageSync({
      workspaceId: WORKSPACE,
      pageId: PAGE,
      store,
      initialVersion: '7',
      send: async () => {
        calls += 1
        // 첫 요청은 영영 끝나지 않는다(끊긴 와이파이 · 죽은 프록시).
        if (calls === 1) return new Promise<SendResult>(() => {})
        return new Promise<SendResult>((resolve) => {
          resolveSecond = resolve
        })
      },
      fetchRemote: async () => null,
      onState: (s) => states.push(s),
      now: clock.now,
      schedule: clock.schedule,
    })
    return { sync, clock, states, calls: () => calls, resolveSecond: () => resolveSecond }
  }

  test('★ 15초가 지나면 포기하고 다시 보낸다 — 저장이 멈춘 채로 두지 않는다', async () => {
    const h = hangingHarness()
    h.sync.queue(doc('가'))
    await h.clock.advance(1000)
    assert.equal(h.calls(), 1)

    await h.clock.advance(SEND_TIMEOUT_MS)
    await h.clock.advance(backoffMs(1))
    assert.equal(h.calls(), 2, '첫 요청이 안 끝나 다음 전송이 영영 막혔다')
  })

  test('멈춰 있는 동안에도 상태는 "동기화 중"이다 — 아무것도 안 보여주는 것이 최악이다', async () => {
    const h = hangingHarness()
    h.sync.queue(doc('가'))
    await h.clock.advance(1000 + SYNCING_AFTER_MS)
    assert.equal(h.states[h.states.length - 1].kind, 'syncing')
  })
})

describe('★ 다시 보내도 소용없는 실패', () => {
  const noRetry: [number, string][] = [
    [403, '권한'],
    [404, '없는 페이지'],
    [400, '잘못된 문서'],
  ]

  for (const [status, what] of noRetry) {
    test(`${status}(${what})는 재시도하지 않는다 — 좀비 항목이 된다`, async () => {
      const h = harness({ results: [{ ok: false, status }] })
      h.sync.queue(doc('가'))
      await h.clock.advance(1000)
      await h.clock.advance(60_000)
      assert.equal(h.sent.length, 1)
      assert.equal(lastState(h).kind, 'rejected')
    })
  }

  test('거부돼도 문서는 디스크에 남는다 — 사용자가 복구할 수 있어야 한다', async () => {
    const h = harness({ results: [{ ok: false, status: 403 }] })
    h.sync.queue(doc('소중한 글'))
    await h.clock.advance(1000)
    const stored = await h.store.read(PAGE)
    assert.equal(stored?.doc.blocks[0].title[0].plain_text, '소중한 글')
  })

  test('거부된 뒤 새로 편집하면 다시 시도한다', async () => {
    const h = harness({ results: [{ ok: false, status: 403 }] })
    h.sync.queue(doc('가'))
    await h.clock.advance(1000)
    assert.equal(lastState(h).kind, 'rejected')

    h.sync.queue(doc('가나'))
    await h.clock.advance(1000)
    assert.equal(h.sent.length, 2)
    assert.equal(lastState(h).kind, 'idle')
  })
})

describe('★ ack 를 못 받은 저장을 충돌이라고 말하지 않는다', () => {
  test('409 인데 서버 문서가 우리가 보낸 것과 같으면 — 우리 저장이 도착했던 것이다', async () => {
    const mine = doc('내가 쓴 글')
    const h = harness({ results: [{ ok: false, status: 409, error: 'version_conflict' }], remote: { version: '9', doc: mine } })
    h.sync.queue(mine)
    await h.clock.advance(1000)

    assert.equal(lastState(h).kind, 'idle', '충돌 배너를 띄웠다')
    assert.equal(await h.store.read(PAGE), null)
    assert.equal(h.sync.version(), '9', '서버의 버전을 받아 와야 다음 저장이 또 충돌하지 않는다')
  })

  test('409 이고 서버 문서가 다르면 진짜 충돌이다', async () => {
    const h = harness({
      results: [{ ok: false, status: 409, error: 'version_conflict' }],
      remote: { version: '9', doc: doc('남이 쓴 글') },
    })
    h.sync.queue(doc('내가 쓴 글'))
    await h.clock.advance(1000)

    const state = lastState(h)
    assert.equal(state.kind, 'rejected')
    assert.ok(state.kind === 'rejected' && state.conflict)
  })

  test('충돌을 덮어쓰기로 해결하면 버전 없이 보낸다', async () => {
    const h = harness({
      results: [{ ok: false, status: 409, error: 'version_conflict' }],
      remote: { version: '9', doc: doc('남이 쓴 글') },
    })
    h.sync.queue(doc('내 글'))
    await h.clock.advance(1000)

    await h.sync.overwrite()
    assert.equal(h.sent[1].baseVersion, '', '버전을 빼야 서버가 덮어쓴다')
    assert.equal(lastState(h).kind, 'idle')
  })

  test('서버를 읽지 못하면 충돌로 둔다 — 멋대로 덮어쓰지 않는다', async () => {
    const h = harness({ results: [{ ok: false, status: 409, error: 'version_conflict' }], remote: null })
    h.sync.queue(doc('가'))
    await h.clock.advance(1000)
    assert.equal(lastState(h).kind, 'rejected')
  })
})

describe('★ 지난 세션이 못 보낸 것', () => {
  test('되살려 보내고, 화면에 돌려놓을 문서를 준다', async () => {
    const store = memoryOutboxStore()
    await store.write(
      newEntry({ pageId: PAGE, workspaceId: WORKSPACE, doc: doc('탭을 닫기 전에 친 글'), baseVersion: '3', now: 0 }),
    )

    const clock = fakeClock()
    const sent: OutboxEntry[] = []
    const sync = createPageSync({
      workspaceId: WORKSPACE,
      pageId: PAGE,
      store,
      initialVersion: '3',
      send: async (e) => {
        sent.push(e)
        return { ok: true, version: '4' }
      },
      fetchRemote: async () => null,
      onState: () => {},
      now: clock.now,
      schedule: clock.schedule,
    })

    const restored = await sync.resume()
    assert.ok(restored, '되살릴 문서를 돌려주지 않으면 화면이 낡은 채로 남는다')
    assert.equal(restored.blocks[0].title[0].plain_text, '탭을 닫기 전에 친 글')

    await clock.advance(0)
    assert.equal(sent.length, 1)
    assert.equal(await store.read(PAGE), null)
  })

  test('남은 것이 없으면 null', async () => {
    const h = harness()
    assert.equal(await h.sync.resume(), null)
  })
})

describe('★ 한도는 사후 오류가 아니라 사전 경고다 (F-12-16)', () => {
  const huge = (): EditorDoc => ({
    blocks: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        type: 'paragraph',
        // 한글 한 글자는 UTF-8 로 3바이트다. 글자 수로 셌다면 통과했을 크기.
        title: [textRun('가'.repeat(MAX_BODY_BYTES / 2))],
        properties: {},
        format: {},
        children: [],
      },
    ],
  })

  test('바이트로 잰다 — 글자 수가 아니라', () => {
    assert.equal(bodyTooLarge(doc('가')), false)
    assert.equal(bodyTooLarge(huge()), true)
  })

  test('★ 너무 크면 보내지 않고 바로 말해 준다 — 413 을 받아 보지 않는다', async () => {
    const h = harness()
    h.sync.queue(huge())
    await h.clock.advance(1000)

    assert.equal(h.sent.length, 0, '보내 봐야 413 이다')
    const state = lastState(h)
    assert.equal(state.kind, 'rejected')
    assert.ok(state.kind === 'rejected' && state.message.includes('KB'))
  })

  test('큰 문서도 디스크에는 남는다 — 사용자가 잘라낼 때까지', async () => {
    const h = harness()
    h.sync.queue(huge())
    await h.clock.advance(1000)
    assert.ok(await h.store.read(PAGE))
  })
})

describe('★ 서버가 말해 주는 retryable (F-12-16)', () => {
  test('retryable:false 면 상태 코드와 무관하게 재시도하지 않는다', async () => {
    // 503 은 보통 "다시 보낼 실패"지만, 서버가 아니라고 하면 아니다.
    const h = harness({ results: [{ ok: false, status: 503, retryable: false }] })
    h.sync.queue(doc('가'))
    await h.clock.advance(1000)
    await h.clock.advance(60_000)
    assert.equal(h.sent.length, 1)
    assert.equal(lastState(h).kind, 'rejected')
  })

  test('말해 주지 않으면 상태 코드로 유추한다', () => {
    assert.equal(classifyFailure(503, undefined, undefined), 'retry')
    assert.equal(classifyFailure(503, undefined, false), 'invalid')
    assert.equal(classifyFailure(403, undefined, false), 'forbidden')
  })

  test('★ 충돌은 retryable:false 로도 충돌이다 — 사람이 결정하면 다시 보낸다', () => {
    assert.equal(classifyFailure(409, 'version_conflict', false), 'conflict')
  })
})

describe('규칙 조각', () => {
  beforeEach(() => {})

  test('실패 분류', () => {
    assert.equal(classifyFailure(0), 'retry')
    assert.equal(classifyFailure(429), 'retry')
    assert.equal(classifyFailure(503), 'retry')
    assert.equal(classifyFailure(403), 'forbidden')
    assert.equal(classifyFailure(404), 'gone')
    assert.equal(classifyFailure(409, 'version_conflict'), 'conflict')
    assert.equal(classifyFailure(400), 'invalid')
  })

  test('★ page_ref_missing 은 409 지만 충돌이 아니다 — 다시 보내도 같다', () => {
    assert.equal(classifyFailure(409, 'page_ref_missing'), 'invalid')
  })

  test('백오프는 늘어나되 상한이 있다', () => {
    assert.equal(backoffMs(1), 1000)
    assert.equal(backoffMs(2), 2000)
    assert.ok(backoffMs(20) <= 30_000)
  })

  test('★ coalesce 는 기준 버전과 대기 시각을 유지한다', () => {
    const first = newEntry({ pageId: PAGE, workspaceId: WORKSPACE, doc: doc('가'), baseVersion: '7', now: 100 })
    const second = newEntry({ pageId: PAGE, workspaceId: WORKSPACE, doc: doc('가나'), baseVersion: '99', now: 5000 })
    const merged = coalesce(first, second)
    assert.equal(merged.baseVersion, '7', '대기 중에는 서버가 아직 우리 저장을 안 받았다')
    assert.equal(merged.queuedAt, 100, '시계가 매번 0 으로 돌아가면 "동기화 중"이 영영 안 뜬다')
    assert.equal(merged.doc.blocks[0].title[0].plain_text, '가나')
  })

  test('빈 자식 배열과 없는 자식은 같은 문서다', () => {
    const withChildren: EditorDoc = { blocks: [{ id: 'a', type: 'paragraph', title: [], properties: {}, format: {}, children: [] }] }
    const without: EditorDoc = { blocks: [{ id: 'a', type: 'paragraph', title: [], properties: {}, format: {} }] }
    assert.equal(sameDoc(withChildren, without), true)
    assert.equal(sameDoc(withChildren, doc('가')), false)
  })

  test('큐가 비면 아무것도 보여주지 않는다', () => {
    assert.equal(syncState(null, 0).kind, 'idle')
  })
})
