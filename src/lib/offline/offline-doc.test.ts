/**
 * 오프라인 편집기의 문서 — OF-2 (F-12-04 · 정본 §3.7 [보강 OF-1] ③ · CRDT 6d · 순수)
 *
 *   ① ★ 받은 상태 + 보존본을 한 문서로 — 온라인에서 남은 확인받지 못한 편집이 보인다
 *   ② ★ 친 편집은 보존본과 합친 update 하나로 — 받은 상태 · 보존본을 얹는 것은 편집으로 세지 않는다 · 쓰는 값은 늘 보존본 전부
 *   ③ ★ 다시 연결되면 — 그 update 를 그 사이 남의 편집이 쌓인 서버 상태에 얹으면 둘 다 남는다(연결이 하는 일 그대로)
 *   ④ 사본에 쓰는 상태는 문서 전체 — 그것만으로 같은 본문이 선다
 *   ⑤ 쓰기는 한 번에 하나 — 몰려 친 편집은 모아 쓰고 마지막 값이 전부를 담는다 · 멈추면 더 쓰지 않는다 · 쓰기 실패는 던지지 않는다
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import * as Y from 'yjs'

import { textRun } from '../contracts/rich-text.ts'
import { createBodyYDoc, readBodyPm } from '../collab/ydoc.ts'
import type { EditorBlock } from '../editor/document.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { openOfflineDoc, trackOfflineEdits } from './offline-doc.ts'

const A = '0a0a0a0a-0000-4000-8000-000000000001'
const B = '0a0a0a0a-0000-4000-8000-000000000002'
const para = (id: string, text: string): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)] })

const text = (doc: Y.Doc): string => readBodyPm(doc).textContent
/** 블록의 글자 맨 앞에 넣는다. */
const typeAt = (doc: Y.Doc, blockId: string, chars: string): void => edit(doc, (tr, pm) => tr.insertText(chars, findBlock(pm, blockId).pos + 2))
/** 상태들을 차례로 얹은 새 문서. */
const rebuilt = (...updates: Uint8Array[]): Y.Doc => {
  const doc = new Y.Doc()
  for (const u of updates) Y.applyUpdate(doc, u)
  return doc
}

function scene() {
  const server = createBodyYDoc({ blocks: [para(A, 'A'), para(B, 'B')] })
  // 온라인에서 쳤지만 확인받지 못한 편집 — 보존본에 남아 있다
  const online = peer(server, 11)
  typeAt(online, A, '1')
  const pending0 = changesSince(online, server)
  return { server, state: Y.encodeStateAsUpdate(server), pending0 }
}

type Write = { readonly pending: Uint8Array; readonly state: Uint8Array }
const recorder = () => {
  const writes: Write[] = []
  return { writes, sink: async (pending: Uint8Array, state: Uint8Array) => void writes.push({ pending, state }) }
}

test('① ★ 받은 상태 + 보존본을 한 문서로', () => {
  const { state, pending0 } = scene()
  assert.equal(text(openOfflineDoc(state, null)), 'AB')
  assert.equal(text(openOfflineDoc(state, pending0)), '1AB', '온라인에서 남은 편집이 보인다')
})

test('② ★ 친 편집만 쓴다 — 보존본과 합친 하나로', async () => {
  const { state, pending0 } = scene()
  const doc = openOfflineDoc(state, pending0)
  const { writes, sink } = recorder()
  const tracker = trackOfflineEdits(doc, pending0, sink)
  await tracker.flushed()
  assert.equal(writes.length, 0, '받은 상태 · 보존본을 얹는 것은 편집이 아니다')

  typeAt(doc, B, '오프')
  await tracker.flushed()
  assert.equal(writes.length, 1)
  assert.equal(text(rebuilt(state, writes[0].pending)), '1A오프B', '쓰는 값은 보존본 전부 — 앞서 남은 편집을 잃지 않는다')
  await tracker.stop()
})

test('③ ★ 다시 연결되면 — 그 사이 남의 편집이 쌓인 서버 상태에 얹어도 둘 다 남는다', async () => {
  const { server, state, pending0 } = scene()
  const doc = openOfflineDoc(state, pending0)
  const { writes, sink } = recorder()
  const tracker = trackOfflineEdits(doc, pending0, sink)
  typeAt(doc, B, '오프')
  await tracker.stop()

  // 그 사이 다른 사람이 서버에 쳤다
  const other = peer(server, 22)
  typeAt(other, A, '남')
  Y.applyUpdate(server, changesSince(other, server))

  // 연결은 서버가 준 상태 위에 보존본을 얹는다(`collab-connection.ts` — 확인 뒤 지운다)
  const reopened = rebuilt(Y.encodeStateAsUpdate(server), writes.at(-1)!.pending)
  const shown = text(reopened)
  assert.ok(shown.includes('오프') && shown.includes('남') && shown.includes('1'), shown)
  assert.equal(shown.replace(/[1남]/g, ''), 'A오프B')
})

test('④ 사본에 쓰는 상태는 문서 전체 — 그것만으로 같은 본문이 선다', async () => {
  const { state, pending0 } = scene()
  const doc = openOfflineDoc(state, pending0)
  const { writes, sink } = recorder()
  const tracker = trackOfflineEdits(doc, pending0, sink)
  typeAt(doc, A, '!')
  await tracker.stop()
  assert.equal(text(rebuilt(writes.at(-1)!.state)), text(doc))
  assert.equal(text(doc), '!1AB')
})

test('⑤ 쓰기는 한 번에 하나 — 몰려 친 편집은 모아 쓴다 · 멈추면 더 쓰지 않는다 · 실패는 던지지 않는다', async () => {
  const { state } = scene()
  const doc = openOfflineDoc(state, null)
  let running = 0
  let most = 0
  const writes: Uint8Array[] = []
  const tracker = trackOfflineEdits(doc, null, async (pending) => {
    running += 1
    most = Math.max(most, running)
    await new Promise((resolve) => setTimeout(resolve, 5))
    writes.push(pending)
    running -= 1
  })
  for (const ch of ['가', '나', '다', '라']) typeAt(doc, A, ch)
  await tracker.flushed()
  await tracker.flushed()
  assert.equal(most, 1, '겹쳐 쓰지 않는다')
  assert.ok(writes.length >= 1 && writes.length <= 2, `모아 쓴다 — ${writes.length}번`)
  assert.equal(text(rebuilt(state, writes.at(-1)!)), '라다나가AB', '마지막 값이 전부를 담는다')

  await tracker.stop()
  const count = writes.length
  typeAt(doc, A, '끝')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(writes.length, count, '멈추면 더 쓰지 않는다')

  const failingDoc = openOfflineDoc(state, null)
  let tried = 0
  const failing = trackOfflineEdits(failingDoc, null, async () => {
    tried += 1
    throw new Error('할당량 초과')
  })
  const warn = console.warn
  console.warn = () => undefined
  try {
    typeAt(failingDoc, A, 'x')
    await failing.flushed()
    typeAt(failingDoc, A, 'y')
    await failing.stop()
  } finally {
    console.warn = warn
  }
  assert.equal(tried, 2, '실패해도 다음 편집을 다시 쓴다(던지지 않는다)')
})
