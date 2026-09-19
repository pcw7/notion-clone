/**
 * 인라인 코멘트의 앵커 — 동시 편집을 견디는가 (F-05-07 · 코멘트 2조각)
 *
 * DB 를 쓰지 않는다. 여기서 확인하는 것은 **Yjs 상대 위치가 우리 본문 구조 위에서 어떻게 움직이는가** 하나다 —
 * 05 F-05-07 의 엣지 케이스 표를 그대로 옮겼다.
 *
 *   | 앵커 텍스트가 전부 삭제됨 | 스레드는 생존. 길이 0 |
 *   | 앵커 중간만 삭제        | 남은 범위로 축소       |
 *
 * 블록이 통째로 사라진 경우와 **아직 서버에 도착하지 않은 글자를 가리키는 경우**도 함께 본다. 뒤의 것이
 * "앵커는 Y.Doc 을 가진 쪽이 만든다"는 설계의 근거다(`anchor.ts` 머리말).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import * as Y from 'yjs'

import { createBodyYDoc } from '../collab/ydoc.ts'
import { textRun, type RichTextRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import {
  acceptAnchor,
  anchorFromStored,
  MAX_QUOTED_TEXT,
  resolveTextRangeAnchor,
  storedAnchor,
  textRangeAnchor,
} from './anchor.ts'

const A = 'aaaaaaaa-1111-4111-8111-111111111111'
const B = 'bbbbbbbb-1111-4111-8111-111111111111'

const para = (id: string, title: readonly RichTextRun[]): EditorBlock => ({ id, type: 'paragraph', title })

/** '가나다라마바사' + 둘째 문단. */
function body(): Y.Doc {
  return createBodyYDoc({ blocks: [para(A, [textRun('가나다라마바사')]), para(B, [textRun('둘째 문단')])] })
}

/** 블록 안 `offset` 자리에 글자를 넣는다 — 편집기가 하는 것과 같은 경로(`collab-peers.ts`). */
function typeAt(ydoc: Y.Doc, blockId: string, offset: number, text: string): void {
  edit(ydoc, (tr: Transaction, doc: PmNode) => {
    tr.insertText(text, findBlock(doc, blockId).pos + 2 + offset)
  })
}

function deleteRange(ydoc: Y.Doc, blockId: string, from: number, to: number): void {
  edit(ydoc, (tr: Transaction, doc: PmNode) => {
    const { pos } = findBlock(doc, blockId)
    tr.delete(pos + 2 + from, pos + 2 + to)
  })
}

/** '다라마' 를 가리키는 앵커. */
function anchorOnA(ydoc: Y.Doc) {
  const anchor = textRangeAnchor(ydoc, A, 2, 5)
  assert.ok(anchor !== null, '앵커를 만들지 못했다')
  return anchor
}

describe('앵커는 동시 편집을 견딘다', () => {
  test('만든 자리를 그대로 가리킨다 — 원문도 함께 남긴다', () => {
    const ydoc = body()
    const anchor = anchorOnA(ydoc)
    assert.equal(anchor.quotedText, '다라마')
    assert.deepEqual(resolveTextRangeAnchor(ydoc, A, anchor), { start: 2, end: 5, text: '다라마' })
  })

  test('★ 앞에 친 글자는 범위를 밀고, 안에 친 글자는 범위를 늘린다 — 바로 뒤에 이어 친 글자도 들어온다', () => {
    const ydoc = body()
    const anchor = anchorOnA(ydoc)

    typeAt(ydoc, A, 0, '앞앞')
    assert.deepEqual(resolveTextRangeAnchor(ydoc, A, anchor), { start: 4, end: 7, text: '다라마' }, '밀렸을 뿐 같은 글자다')

    typeAt(ydoc, A, 5, 'XX') // '다' 와 '라' 사이
    assert.deepEqual(resolveTextRangeAnchor(ydoc, A, anchor), { start: 4, end: 9, text: '다XX라마' }, '안에 친 글자는 들어온다')

    // 오른쪽 끝의 자람은 **재 보고 알았다**(`anchor.ts` 머리말 · §3.3-129). 명세가 요구한 것은 "가운데만 지우면 축소"이고,
    // 그것을 지키는 표현에서는 이어 친 글자가 들어온다. 틀린 기대를 적었다가 측정에 맞춰 고쳤다.
    typeAt(ydoc, A, 9, 'ZZ') // '마' 바로 뒤
    assert.deepEqual(resolveTextRangeAnchor(ydoc, A, anchor), { start: 4, end: 11, text: '다XX라마ZZ' })
  })

  test('가운데만 지우면 남은 범위로 줄고, 전부 지우면 길이 0 이 된다', () => {
    const ydoc = body()
    const anchor = anchorOnA(ydoc)

    deleteRange(ydoc, A, 3, 4) // '라'
    assert.deepEqual(resolveTextRangeAnchor(ydoc, A, anchor), { start: 2, end: 4, text: '다마' })

    deleteRange(ydoc, A, 2, 4) // 남은 '다마'
    assert.deepEqual(resolveTextRangeAnchor(ydoc, A, anchor), { start: 2, end: 2, text: '' }, '스레드는 살아 있고 범위만 비었다')
  })

  test('★ 블록을 통째로 지우면 풀리지 않는다 — 다른 블록의 글자를 가리키지 않는다', () => {
    const ydoc = body()
    const anchor = anchorOnA(ydoc)
    edit(ydoc, (tr: Transaction, doc: PmNode) => {
      const { pos, node } = findBlock(doc, A)
      tr.delete(pos, pos + node.nodeSize)
    })
    assert.equal(resolveTextRangeAnchor(ydoc, A, anchor), null)
    assert.equal(resolveTextRangeAnchor(ydoc, B, anchor), null, '살아 있는 다른 블록으로 흘러가지도 않는다')
  })

  test('★ 같은 blockId 를 가진 블록이 둘이면 풀지 않는다 — 어느 쪽인지 알 수 없다', () => {
    // 동시 편집은 blockId 중복을 만든다(y-prosemirror 에는 옮기기가 없어 지우고 새로 넣는다 — §2 "1조각에서 확인한 것").
    // 정규화가 뒤의 것에 새 id 를 주지만, 앵커를 푸는 변환은 **고치지 않은 문서**를 본다. 그때 둘째 블록의 글자를
    // 가리키는 앵커를 첫째 블록의 것으로 읽으면 엉뚱한 자리에 하이라이트가 그려진다.
    const ydoc = body()
    const anchor = textRangeAnchor(ydoc, B, 0, 2)
    assert.ok(anchor !== null)
    assert.deepEqual(resolveTextRangeAnchor(ydoc, B, anchor), { start: 0, end: 2, text: '둘째' })

    const group = ydoc.getXmlFragment('body').get(0) as Y.XmlElement
    const second = group.get(1) as Y.XmlElement
    second.setAttribute('blockId', A)

    assert.equal(resolveTextRangeAnchor(ydoc, A, anchor), null, '첫째 블록의 범위로 읽어 주면 안 된다')
  })

  test('★ 아직 도착하지 않은 글자를 가리키면 풀리지 않다가, 그 update 가 오면 스스로 풀린다', () => {
    const server = body()
    const client = peer(server, 7777)
    typeAt(client, A, 0, '새글')
    // 보낸 사람은 자기 문서에서 방금 친 글자를 고른다.
    const anchor = textRangeAnchor(client, A, 0, 2)
    assert.ok(anchor !== null)
    assert.equal(anchor.quotedText, '새글')

    assert.equal(resolveTextRangeAnchor(server, A, anchor), null, '서버는 아직 그 글자를 모른다')
    Y.applyUpdate(server, changesSince(client, server))
    assert.deepEqual(resolveTextRangeAnchor(server, A, anchor), { start: 0, end: 2, text: '새글' })
  })

  test('인라인 원자(멘션)를 건너뛰는 범위도 가리킨다 — 원자는 한 자로 센다', () => {
    // 원자가 있으면 한 블록의 글자가 Y.XmlText 하나에 있지 않다 — 오프셋을 Y 인덱스로 셀 수 없다는 근거다(머리말).
    const mention: RichTextRun = { ...textRun('@'), type: 'mention', mention: { type: 'user', user_id: 'u1' } }
    const ydoc = createBodyYDoc({ blocks: [para(A, [textRun('앞'), mention, textRun('뒤글자')])] })
    const anchor = textRangeAnchor(ydoc, A, 0, 4)
    assert.ok(anchor !== null, '원자를 낀 범위를 만들지 못했다')
    assert.deepEqual([resolveTextRangeAnchor(ydoc, A, anchor)?.start, resolveTextRangeAnchor(ydoc, A, anchor)?.end], [0, 4])

    typeAt(ydoc, A, 0, '새') // 범위 앞
    assert.deepEqual([resolveTextRangeAnchor(ydoc, A, anchor)?.start, resolveTextRangeAnchor(ydoc, A, anchor)?.end], [1, 5])
    // 자리로는 원자도 한 자다(범위 0..6 이 블록 전체다). 다만 **원문 스냅샷에는 원자의 글자가 들어가지 않는다** —
    // `textBetween` 이 잎 노드의 글자를 내주지 않는다(측정). 스냅샷은 표시용이므로 그대로 둔다.
    assert.equal(textRangeAnchor(ydoc, A, 0, 6)?.quotedText, '새앞뒤글자')
    assert.equal(textRangeAnchor(ydoc, A, 0, 7), null, '블록은 6자리뿐이다')
  })
})

describe('만들 수 없는 범위', () => {
  test('빈 범위 · 뒤집힌 범위 · 블록 밖 · 없는 블록', () => {
    const ydoc = body()
    assert.equal(textRangeAnchor(ydoc, A, 2, 2), null, '빈 범위')
    assert.equal(textRangeAnchor(ydoc, A, 5, 2), null, '뒤집힌 범위')
    assert.equal(textRangeAnchor(ydoc, A, -1, 3), null, '음수')
    assert.equal(textRangeAnchor(ydoc, A, 1.5 as number, 3), null, '정수가 아님')
    assert.equal(textRangeAnchor(ydoc, A, 0, 8), null, '블록의 글자 수를 넘는다')
    assert.equal(textRangeAnchor(ydoc, '00000000-0000-4000-8000-000000000000', 0, 1), null, '없는 블록')
  })
})

describe('밖에서 들어온 앵커', () => {
  test('바이트가 아무것도 가리키지 않으면 받지 않는다 — 던지지 않는 쓰레기가 있다', () => {
    const ydoc = body()
    const good = anchorOnA(ydoc)
    assert.ok(acceptAnchor(good) !== null)

    // `[9,9,9,9]` 는 던지지 않고 `{assoc: 9}` 가 된다(측정). 영원히 풀리지 않으므로 받지 않는다.
    const junk = Buffer.from(new Uint8Array([9, 9, 9, 9])).toString('base64')
    assert.equal(acceptAnchor({ ...good, start: junk }), null)
    assert.equal(acceptAnchor({ ...good, end: '!!!not base64!!!' }), null)
    assert.equal(acceptAnchor({ ...good, start: '' }), null)
    assert.equal(acceptAnchor({ start: good.start, end: good.end, quotedText: '' }), null, '원문 스냅샷은 반드시 있다')
    assert.equal(acceptAnchor(null), null)
  })

  test('긴 원문 스냅샷은 자른다 — 내용이 아니라 미리보기다', () => {
    const ydoc = body()
    const good = anchorOnA(ydoc)
    const taken = acceptAnchor({ ...good, quotedText: '가'.repeat(MAX_QUOTED_TEXT + 50) })
    assert.equal(taken?.quotedText.length, MAX_QUOTED_TEXT)
  })

  test('행에 넣는 모양과 읽는 모양이 왕복한다', () => {
    const ydoc = body()
    const anchor = anchorOnA(ydoc)
    const stored = storedAnchor(anchor)
    assert.equal(stored.quoted_text, '다라마', '정본 §3.9 의 키 이름을 쓴다')
    assert.deepEqual(anchorFromStored(JSON.parse(JSON.stringify(stored))), anchor)
    assert.equal(anchorFromStored({ kind: '몰라', start: 'a', end: 'b', quoted_text: 'c' }), null)
    assert.equal(anchorFromStored(null), null)
  })
})
