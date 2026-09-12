/**
 * 저장 큐가 서버에 대해 세운 가정 — F-05-04
 *
 * `page-sync.ts` 의 "ack 를 못 받은 저장"을 구분하는 방법은 **보낸 문서와 서버의
 * 문서를 비교하는 것**이고, 그것은 하나의 가정 위에 서 있다:
 *
 *   > 저장 왕복은 무손실이다. 우리가 보낸 문서를 다시 읽으면 **같은 문서**다.
 *
 * 이 가정이 깨지면 비교는 늘 "다르다"가 되고, 끊긴 네트워크에서 저장한 사용자는
 * 아무도 편집하지 않았는데 "다른 곳에서 먼저 저장했습니다"를 본다. 추측으로 둘 수
 * 없어서 실제 DB 로 확인한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { textRun } from '../contracts/rich-text.ts'
import { sameDoc, stableJson } from './outbox.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import type { BlockId } from '../ids.ts'

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

const block = (type: EditorBlock['type'], text: string, extra: Partial<EditorBlock> = {}): EditorBlock => ({
  id: randomUUID(),
  type,
  title: text === '' ? [] : [textRun(text)],
  properties: {},
  format: {},
  children: [],
  ...extra,
})

async function newPage(): Promise<BlockId> {
  const page = await createPage(fx.owner.ctx, { title: titleFromPlainText('저장 큐') })
  return page.id
}

describe('★ 저장 왕복이 무손실인가 — 비교가 성립하는 근거', () => {
  test('보낸 문서와 다시 읽은 문서가 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const doc: EditorDoc = {
      blocks: [
        block('heading_1', '제목'),
        block('to_do', '할 일', {
          properties: { checked: true },
          format: { block_color: 'red' },
          children: [block('paragraph', '자식')],
        }),
        block('divider', ''),
        block('image', '', { properties: { source: { type: 'external', url: 'https://a/b.png' } } }),
        block('bulleted_list_item', '목록'),
      ],
    }

    const saved = await savePageBody(fx.owner.ctx, pageId, doc)
    assert.ok(saved.ok, JSON.stringify(saved))

    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    assert.ok(loaded)
    assert.ok(
      sameDoc(doc, loaded.doc),
      `왕복이 달라졌다\n보낸 것: ${stableJson(doc).slice(0, 400)}\n받은 것: ${stableJson(loaded.doc).slice(0, 400)}`,
    )
  })

  test('내용이 다르면 다르다고 한다 — 비교가 무조건 true 면 의미가 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const mine: EditorDoc = { blocks: [block('paragraph', '내가 쓴 글')] }
    const theirs: EditorDoc = { blocks: [block('paragraph', '남이 쓴 글')] }

    assert.ok((await savePageBody(fx.owner.ctx, pageId, theirs)).ok)
    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    assert.ok(loaded)
    assert.equal(sameDoc(mine, loaded.doc), false)
  })
})

describe('★ ack 를 못 받은 저장 — 실제 서버가 주는 답', () => {
  test('같은 문서를 같은 버전으로 두 번 보내면 두 번째는 409 다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const before = await loadPageBody(fx.owner.ctx, pageId)
    assert.ok(before)

    const doc: EditorDoc = { blocks: [block('paragraph', '한 번만 도착한 글')] }

    // ① 저장은 성공했지만 응답이 오는 길에 끊겼다고 하자.
    const first = await savePageBody(fx.owner.ctx, pageId, doc, { expectedVersion: before.version })
    assert.ok(first.ok)

    // ② 큐가 같은 문서를 같은 기준 버전으로 다시 보낸다.
    const second = await savePageBody(fx.owner.ctx, pageId, doc, { expectedVersion: before.version })
    assert.equal(second.ok, false)
    assert.ok(second.ok === false && second.reason === 'version_conflict', JSON.stringify(second))

    // ③ 그래서 큐는 서버 문서를 읽어 비교한다. 같으면 우리 저장이 도착했던 것이다.
    const remote = await loadPageBody(fx.owner.ctx, pageId)
    assert.ok(remote)
    assert.ok(sameDoc(doc, remote.doc), '이게 false 면 사용자에게 없는 충돌을 보여주게 된다')
    assert.equal(remote.version, first.version, '받아 온 버전으로 이어서 저장할 수 있어야 한다')
  })

  test('진짜로 남이 저장했으면 문서가 다르다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const before = await loadPageBody(fx.owner.ctx, pageId)
    assert.ok(before)

    // 남이 먼저 저장했다.
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [block('paragraph', '남의 글')] })).ok)

    const mine: EditorDoc = { blocks: [block('paragraph', '내 글')] }
    const result = await savePageBody(fx.owner.ctx, pageId, mine, { expectedVersion: before.version })
    assert.ok(result.ok === false && result.reason === 'version_conflict')

    const remote = await loadPageBody(fx.owner.ctx, pageId)
    assert.ok(remote)
    assert.equal(sameDoc(mine, remote.doc), false, '진짜 충돌을 조용히 삼키면 남의 글을 지운다')
  })

  test('버전을 빼고 보내면 덮어쓴다 — 사용자가 "내 것으로"를 고른 경우', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [block('paragraph', '남의 글')] })).ok)

    const mine: EditorDoc = { blocks: [block('paragraph', '내 글')] }
    const forced = await savePageBody(fx.owner.ctx, pageId, mine)
    assert.ok(forced.ok)

    const remote = await loadPageBody(fx.owner.ctx, pageId)
    assert.ok(remote && sameDoc(mine, remote.doc))
  })
})
