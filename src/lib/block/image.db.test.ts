/**
 * 이미지 블록의 파일 참조 카운트 — F-01-15 / 불변식 FS1
 *
 * 정본 FS1: *"`ref_count > 0` 인 객체를 지우지 않는다."* 그 약속은 **카운트가
 * 맞을 때만** 의미가 있다. 이 파일은 프로젝터가 카운트를 실제로 유지하는지 본다.
 *
 * 여기서 잡으려는 사고는 하나다 — **아직 쓰이고 있는 이미지의 바이트가 사라지는 것.**
 * 그러려면 카운트가 (a) 붙을 때 오르고 (b) 떼일 때 내리되 (c) 같은 파일을 둘이
 * 가리키면 하나를 떼어도 0 이 되지 않아야 한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { savePageBody } from './save-page-body.ts'
import { uploadFile } from '../file/file.ts'
import { setFileStorage, type FileStorage } from '../file/storage.ts'
import { withImageSource } from './image.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { BlockId } from '../ids.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture

const memoryStorage = (): FileStorage => {
  const store = new Map<string, Uint8Array>()
  return {
    kind: 'memory',
    async put(key, bytes) {
      store.set(key, bytes)
    },
    async read(key) {
      return store.get(key) ?? null
    },
    async remove(key) {
      store.delete(key)
    },
  }
}

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  setFileStorage(memoryStorage())
})

after(async () => {
  setFileStorage(null)
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

async function newFileId(): Promise<string> {
  const result = await uploadFile(fx.owner.ctx, {
    bytes: new Uint8Array(4).fill(1),
    mime: 'image/png',
    originalName: null,
  })
  assert.ok(result.ok, '업로드 실패')
  assert.equal(result.file.refCount, 0, '업로드 직후에는 아무도 가리키지 않는다')
  return result.file.id
}

async function refCount(fileId: string): Promise<number> {
  const { withReadTransaction } = await import('../db/tx.ts')
  return withReadTransaction(async (tx) => {
    const row = await tx.queryOne<{ ref_count: number }>(`SELECT ref_count FROM file WHERE id = $1`, [
      fileId,
    ])
    return row.ref_count
  })
}

function imageBlock(fileId: string | null): EditorBlock {
  return {
    id: randomUUID(),
    type: 'image',
    title: [],
    properties: withImageSource({}, fileId === null ? null : { kind: 'file', fileId }),
  }
}

const para = (text: string): EditorBlock => ({
  id: randomUUID(),
  type: 'paragraph',
  title: [textRun(text)],
  properties: {},
})

async function newPage(): Promise<BlockId> {
  const page = await createPage(fx.owner.ctx, { title: titleFromPlainText('이미지 테스트') })
  return page.id
}

async function save(pageId: BlockId, blocks: EditorBlock[]): Promise<void> {
  const doc: EditorDoc = { blocks }
  const result = await savePageBody(fx.owner.ctx, pageId, doc)
  assert.ok(result.ok, JSON.stringify(result))
}

describe('ref_count — 붙으면 오르고 떼면 내린다', () => {
  test('이미지 블록을 넣으면 1 이 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fileId = await newFileId()
    const pageId = await newPage()

    await save(pageId, [imageBlock(fileId)])
    assert.equal(await refCount(fileId), 1)
  })

  test('★ 안 바뀐 저장은 카운트를 올리지 않는다 — 자동 저장은 1초마다 돈다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fileId = await newFileId()
    const pageId = await newPage()
    const block = imageBlock(fileId)

    await save(pageId, [block])
    await save(pageId, [block])
    await save(pageId, [block])
    assert.equal(await refCount(fileId), 1, '저장할 때마다 올랐다')
  })

  test('블록을 지우면 0 이 된다 — 그때부터 GC 대상이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fileId = await newFileId()
    const pageId = await newPage()

    await save(pageId, [imageBlock(fileId)])
    await save(pageId, [para('이미지 대신 글')])
    assert.equal(await refCount(fileId), 0)
  })

  test('★ 같은 파일을 둘이 가리키면 2 — 하나를 지워도 0 이 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fileId = await newFileId()
    const pageId = await newPage()

    const first = imageBlock(fileId)
    await save(pageId, [first, imageBlock(fileId)])
    assert.equal(await refCount(fileId), 2, '복제한 이미지 블록도 참조다')

    await save(pageId, [first])
    assert.equal(await refCount(fileId), 1, '남은 하나가 GC 에 쓸려 갈 뻔했다')
  })

  test('다른 파일로 갈아끼우면 하나는 내리고 하나는 오른다 (LWW)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const oldFile = await newFileId()
    const newFile = await newFileId()
    const pageId = await newPage()

    const block = imageBlock(oldFile)
    await save(pageId, [block])
    await save(pageId, [{ ...block, properties: withImageSource({}, { kind: 'file', fileId: newFile }) }])

    assert.equal(await refCount(oldFile), 0, '이전 파일은 ref_count 감소 — 정본 엣지 케이스')
    assert.equal(await refCount(newFile), 1)
  })

  test('자식 블록으로 들어간 이미지도 센다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fileId = await newFileId()
    const pageId = await newPage()

    await save(pageId, [{ id: randomUUID(), type: 'toggle', title: [], children: [imageBlock(fileId)] }])
    assert.equal(await refCount(fileId), 1)
  })

  test('빈 이미지 블록은 아무것도 가리키지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    await save(pageId, [imageBlock(null)])
    // 저장이 성공하는 것 자체가 검증이다 — 빈 이미지 블록은 정상 상태다.
  })

  test('★ 다른 워크스페이스의 파일 id 를 적어 넣어도 그 카운터는 움직이지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const other = await makeFixture()
    const foreign = await (async () => {
      const result = await uploadFile(other.owner.ctx, {
        bytes: new Uint8Array(2),
        mime: 'image/png',
        originalName: null,
      })
      assert.ok(result.ok)
      return result.file.id
    })()

    const pageId = await newPage()
    await save(pageId, [imageBlock(foreign)])
    assert.equal(await refCount(foreign), 0, '남의 워크스페이스 파일의 카운터를 움직였다')
  })

  test('★ javascript: URL 은 저장 자체가 거부된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const result = await savePageBody(fx.owner.ctx, pageId, {
      blocks: [
        {
          id: randomUUID(),
          type: 'image',
          title: [],
          properties: { source: { type: 'external', url: 'javascript:alert(1)' } },
        },
      ],
    })
    assert.equal(result.ok, false)
    assert.ok(result.ok === false && result.reason === 'invalid_document', JSON.stringify(result))
  })
})
