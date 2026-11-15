/**
 * 다시 붙을 때 무엇을 할지 — OF-3 (F-12-04 · 정본 §3.7 [보강 OF-1] ④ · 순수)
 *
 *   ① ★ 계획 — gone 은 지운다 · 보존본이 있으면 보낸다(판이 커도 — 보낸 뒤 다시 받는다) · 판이 크면 다시 받는다 · 아니면 그대로 · 답이 없으면 그대로
 *   ② 판 견주기는 큰 수로 — 문자열 비교가 아니다 · 숫자가 아니면 다시 받지 않는다 · 보낸 결과에 따라 다시 받는다
 *   ③ 서버의 답 읽기 — 물은 id 만 · 모양이 아니면 없는 것으로 · 워크스페이스 404 면 모두 gone
 *   ④ ★ 다시 받은 사본 = 서버 상태 + 아직 못 보낸 편집 — 오프라인에서 친 글과 그 사이 서버의 글이 둘 다 남는다 · 버린 편집은 빠진다
 *   ⑤ 다시 받은 기록 — 열쇠 · 사람 · 워크스페이스 · 까닭은 그대로, 내용 · 판 · 받은 때 · 크기는 새것
 *   ⑥ ★ 한 번에 하나 · 몰리면 한 번 — 조용해지면 한 번 돈다 · 도는 중에 몇 번을 청해도 끝난 뒤 한 번 더 · 겹쳐 돌지 않는다 · 던져도 다음이 돈다
 *   ⑦ 한 번에 n 개까지 — 넘지 않는다 · 결과는 넣은 차례 · 하나가 던져도 나머지는 돈다 · 나누기
 *   ⑧ 알림의 말 — 지운 수 · 버린 편집과 그 글 · 알릴 것이 없으면 null · 로그아웃의 물음
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import * as Y from 'yjs'

import { textRun } from '../contracts/rich-text.ts'
import { createBodyYDoc, readBodyPm } from '../collab/ydoc.ts'
import type { EditorBlock } from '../editor/document.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import {
  allGone,
  chunked,
  createResyncScheduler,
  isNewerSeq,
  parseStatusReply,
  planResync,
  refreshAfterFlush,
  resyncNotice,
  runLimited,
  unsentEditsWarning,
  type PageStatus,
  type ResyncTimers,
} from './offline-resync.ts'
import { refreshedRecord, withPendingEdits } from './offline-merge.ts'
import type { OfflinePageRecord } from './offline-store.ts'

const W = 'workspace-1'
const rec = (pageId: string, seq: string) => ({ pageId, workspaceId: W, seq })
const statuses = (entries: Record<string, PageStatus>) => new Map(Object.entries(entries))

// ── ① 계획 ───────────────────────────────────────────────────────────

test('① ★ 계획 — 지운다 · 보낸다 · 다시 받는다 · 그대로', () => {
  const plan = planResync(
    [rec('gone', '5'), rec('pending', '5'), rec('pending-newer', '5'), rec('newer', '5'), rec('same', '5'), rec('older', '5'), rec('unanswered', '5'), rec('unanswered-pending', '5')],
    statuses({ gone: 'gone', pending: { seq: '5' }, 'pending-newer': { seq: '9' }, newer: { seq: '6' }, same: { seq: '5' }, older: { seq: '4' } }),
    new Set(['pending', 'pending-newer', 'unanswered-pending', 'gone']),
  )
  assert.deepEqual(
    plan.map((s) => `${s.pageId}:${s.action}`),
    [
      'gone:delete', // 보존본이 있어도 지운다 — 보낼 곳이 없다
      'pending:flush',
      'pending-newer:flush', // 보낸 뒤 다시 받는다(refreshAfterFlush)
      'newer:refresh',
      'same:keep',
      'older:keep',
      'unanswered:keep', // 답을 받지 못했다 — 다음에 다시
      'unanswered-pending:keep',
    ],
  )
  assert.ok(plan.every((s) => s.workspaceId === W))
})

// ── ② 판 ─────────────────────────────────────────────────────────────

test('② 판 견주기는 큰 수로 · 보낸 결과에 따라 다시 받는다', () => {
  assert.equal(isNewerSeq('10', '9'), true, '문자열이면 "10" < "9"')
  assert.equal(isNewerSeq('9', '10'), false)
  assert.equal(isNewerSeq('90071992547409930', '90071992547409929'), true, 'Number 의 정밀도를 넘어도')
  assert.equal(isNewerSeq('7', '7'), false)
  assert.equal(isNewerSeq('x', '1'), false, '숫자가 아니면 다시 받지 않는다')

  assert.equal(refreshAfterFlush('sent', false), true, '보냈으면 서버 판이 바뀌었다')
  assert.equal(refreshAfterFlush('discarded', false), true, '버렸으면 사본이 서버와 다르다')
  assert.equal(refreshAfterFlush('kept', false), false, '못 보냈고 판도 같으면 그대로')
  assert.equal(refreshAfterFlush('kept', true), true, '못 보냈어도 판이 크면 다시 받는다(보존본을 얹어)')
})

// ── ③ 답 읽기 ────────────────────────────────────────────────────────

test('③ 서버의 답 — 물은 id 만 · 모양이 아니면 없는 것으로', () => {
  const read = parseStatusReply({ pages: { a: { seq: '3' }, b: 'gone', c: { seq: 3 }, d: { seq: '-1' }, e: 'gone', x: { seq: '1' } } }, ['a', 'b', 'c', 'd', 'f'])
  assert.deepEqual([...read], [['a', { seq: '3' }], ['b', 'gone']], '묻지 않은 x · e 는 버리고 모양이 아닌 c · d 와 답이 없는 f 는 없는 것으로')
  assert.equal(parseStatusReply(null, ['a']).size, 0)
  assert.equal(parseStatusReply({ pages: 'gone' }, ['a']).size, 0)
  assert.deepEqual([...allGone(['a', 'b'])], [['a', 'gone'], ['b', 'gone']])
})

// ── ④ 서버 상태 + 못 보낸 편집 ────────────────────────────────────────

const A = '0b0b0b0b-0000-4000-8000-000000000001'
const B = '0b0b0b0b-0000-4000-8000-000000000002'
const para = (id: string, text: string): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)] })
const typeAt = (doc: Y.Doc, blockId: string, chars: string): void => edit(doc, (tr, pm) => tr.insertText(chars, findBlock(pm, blockId).pos + 2))
const textOf = (state: Uint8Array): string => {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  return readBodyPm(doc).textContent
}

test('④ ★ 다시 받은 사본 = 서버 상태 + 아직 못 보낸 편집', () => {
  const server = createBodyYDoc({ blocks: [para(A, 'A'), para(B, 'B')] })
  const downloaded = Y.encodeStateAsUpdate(server)

  // 오프라인 — 받은 사본 위에서 친 글은 보존본에 있다
  const offline = new Y.Doc()
  Y.applyUpdate(offline, downloaded)
  typeAt(offline, B, '오프')
  const pending = Y.encodeStateAsUpdate(offline, Y.encodeStateVectorFromUpdate(downloaded))

  // 그 사이 다른 사람이 서버에 쳤다
  const other = peer(server, 33)
  typeAt(other, A, '남')
  Y.applyUpdate(server, changesSince(other, server))
  const fresh = Y.encodeStateAsUpdate(server)
  assert.equal(textOf(fresh), '남AB', '서버에는 오프라인 글이 없다')

  const merged = withPendingEdits(fresh, pending)
  assert.equal(textOf(merged), '남A오프B', '둘 다 남는다 — 오프라인 글을 잃지 않는다')
  assert.equal(textOf(withPendingEdits(fresh, null)), '남AB', '보낸(또는 서버가 거부해 버린) 편집은 보존본에 없다 — 사본에서도 빠진다')
  assert.equal(withPendingEdits(fresh, null), fresh, '보존본이 없으면 서버 상태 그대로')
  assert.equal(withPendingEdits(fresh, new Uint8Array()), fresh)
})

// ── ⑤ 다시 받은 기록 ─────────────────────────────────────────────────

test('⑤ 다시 받은 기록 — 까닭은 그대로 · 내용 · 판 · 받은 때 · 크기는 새것', () => {
  const server = createBodyYDoc({ blocks: [para(A, '새 본문')] })
  const state = Y.encodeStateAsUpdate(server)
  const previous: OfflinePageRecord = {
    key: 'u:p',
    userId: 'u',
    workspaceId: W,
    pageId: 'p',
    title: '옛 제목',
    icon: null,
    cover: null,
    state: new Uint8Array([0, 0]),
    seq: '3',
    reasons: ['toggled', 'favorited'],
    savedAt: 1,
    bytes: 2,
  }
  const payload = { pageId: 'p', title: '새 제목', icon: { type: 'emoji', emoji: '🧭' } as const, cover: null, seq: '8', state: Buffer.from(state).toString('base64') }
  const next = refreshedRecord(previous, payload, null, 1234)
  assert.equal(next.key, 'u:p')
  assert.deepEqual(next.reasons, ['toggled', 'favorited'], '남기는 까닭은 그대로')
  assert.equal(next.title, '새 제목')
  assert.deepEqual(next.icon, { type: 'emoji', emoji: '🧭' })
  assert.equal(next.seq, '8')
  assert.equal(next.savedAt, 1234)
  assert.equal(next.bytes, next.state.byteLength)
  assert.equal(textOf(next.state), '새 본문')
})

// ── ⑥ 한 번에 하나 · 몰리면 한 번 ──────────────────────────────────

/** 손으로 감는 시계 — `tick` 이 걸린 것을 모두 부른다. */
function manualTimers(): ResyncTimers & { tick(): void; readonly pending: number } {
  let queue = new Map<number, () => void>()
  let ids = 0
  return {
    set(run) {
      ids += 1
      queue.set(ids, run)
      return ids
    },
    clear(handle) {
      queue.delete(handle as number)
    },
    tick() {
      const due = queue
      queue = new Map()
      for (const run of due.values()) run()
    },
    get pending() {
      return queue.size
    },
  }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

test('⑥ ★ 한 번에 하나 · 몰리면 한 번', async () => {
  const timers = manualTimers()
  let runs = 0
  let active = 0
  let maxActive = 0
  let release: (() => void) | null = null
  const scheduler = createResyncScheduler(
    async () => {
      runs += 1
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise<void>((resolve) => (release = resolve))
      active -= 1
    },
    { delayMs: 500, timers },
  )

  // 몰려 청해도 조용해질 때 한 번(디바운스 — 앞의 시계는 지운다)
  scheduler.request()
  scheduler.request()
  scheduler.request()
  assert.equal(timers.pending, 1, '시계는 하나')
  timers.tick()
  assert.equal(runs, 1)

  // 도는 중에 청한다 — 몇 번이든 끝난 뒤 한 번 더
  scheduler.request()
  timers.tick()
  scheduler.request()
  timers.tick()
  assert.equal(runs, 1, '도는 중에는 겹쳐 돌지 않는다')
  release!()
  await settle()
  assert.equal(timers.pending, 1, '끝나면 한 번 더를 건다')
  timers.tick()
  assert.equal(runs, 2)
  release!()
  await scheduler.idle()
  await settle()
  assert.equal(timers.pending, 0, '더 청하지 않았으면 그친다')
  assert.equal(maxActive, 1)
})

test('⑥ 던져도 다음 청이 돈다', async () => {
  const timers = manualTimers()
  let runs = 0
  const scheduler = createResyncScheduler(
    async () => {
      runs += 1
      throw new Error('실패')
    },
    { delayMs: 1, timers },
  )
  scheduler.request()
  timers.tick()
  await scheduler.idle()
  await settle()
  scheduler.request()
  timers.tick()
  await scheduler.idle()
  assert.equal(runs, 2)
})

// ── ⑦ 한 번에 n 개까지 ──────────────────────────────────────────────

test('⑦ 한 번에 n 개까지 — 차례 · 실패를 가둔다 · 나누기', async () => {
  let active = 0
  let maxActive = 0
  const results = await runLimited([1, 2, 3, 4, 5], 2, async (n) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await settle()
    active -= 1
    if (n === 3) throw new Error('셋')
    return n * 10
  })
  assert.equal(maxActive, 2)
  assert.deepEqual(
    results.map((r) => (r.status === 'fulfilled' ? r.value : 'x')),
    [10, 20, 'x', 40, 50],
  )
  assert.deepEqual(await runLimited([], 2, async () => 1), [])
  assert.deepEqual(chunked([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(chunked([], 2), [])
})

// ── ⑧ 알림의 말 ──────────────────────────────────────────────────────

test('⑧ 알림의 말', () => {
  assert.equal(resyncNotice({ gone: 0, discarded: [] }), null, '알릴 것이 없으면 null')
  assert.deepEqual(resyncNotice({ gone: 2, discarded: [] }), { messages: ['권한이 없어져 오프라인 사본 2개를 지웠습니다.'], unsaved: null })
  const both = resyncNotice({ gone: 1, discarded: [{ title: '', text: '버린 글' }] })
  assert.equal(both?.messages.length, 2)
  assert.match(both!.messages[1], /서버가 받지 않은 오프라인 편집이 있어 버렸습니다\(페이지 1개\)/)
  assert.equal(both!.unsaved, '# 제목 없음\n버린 글')
  assert.match(unsentEditsWarning(3), /^보내지 못한 편집이 사라집니다 — 페이지 3개/)
})
