/**
 * 버전 GC — 히스토리 · 활동 4a-1 (F-11-03, DB 필요)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 만료된 버전을 지운다 — 바이트도 저장소에서 · 만료 안 된 버전과 **가장 최근 버전**은 남긴다
 *   ② 파일 참조(S5) — 지운 버전이 담은 이미지의 참조가 내려간다 · 바이트가 이미 없으면 행은 지우고 참조는 그대로(센다)
 *   ③ 복원이 가리키는 버전은 남긴다 — 가리키는 쪽이 지워진 다음 판에 지워진다
 *   ④ 한 판의 상한 — 꽉 차면 "더 있다"
 *
 * 반사실(HANDOFF §3.3): 가장 최근을 남기지 않으면 ① 이, 참조를 내리지 않으면 ② 가, 복원 대상을 안 가리면 ③ 이 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { setFileStorage, type FileStorage } from '../file/storage.ts'
import { uploadFile } from '../file/file.ts'
import type { BlockId } from '../ids.ts'
import { restoreVersion } from './restore.ts'
import { runVersionGc } from './gc.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
const store = new Map<string, Uint8Array>()

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  const memory: FileStorage = {
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
  setFileStorage(memory)
  fx = await makeFixture()
})

after(async () => {
  setFileStorage(null)
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const para = (text: string): EditorBlock => ({ id: randomUUID(), type: 'paragraph', title: [textRun(text)], properties: {}, format: {}, children: [] })

async function newPage(title: string): Promise<string> {
  return (await createPage(fx.owner.ctx, { title: titleFromPlainText(title) })).id
}

async function write(pageId: string, blocks: EditorBlock[]): Promise<void> {
  const saved = await savePageBody(fx.owner.ctx, pageId as BlockId, { blocks })
  assert.equal(saved.ok, true, JSON.stringify(saved))
}

/** 쉬었다가 쓴다 — 쓰기 전의 상태가 버전으로 남는다(쉼 2분). */
async function restAndWrite(pageId: string, blocks: EditorBlock[]): Promise<void> {
  await query(`UPDATE doc_update SET created_at = created_at - interval '3 minutes' WHERE page_id = $1`, [pageId])
  await write(pageId, blocks)
}

type Row = { id: string; reason: string; state_ref: string; restored_from: string | null }
const versionsOf = (pageId: string) =>
  query<Row>(`SELECT id, reason, state_ref, restored_from FROM page_version WHERE page_id = $1 ORDER BY through_seq`, [pageId])

/** 이 페이지의 버전을 모두 만료시킨다(어제로). */
const expireAll = (pageId: string) => query(`UPDATE page_version SET expires_at = now() - interval '1 day' WHERE page_id = $1`, [pageId])

/** 이 페이지만의 GC — 다른 검사(따로 도는 파일들)의 버전을 건드리지 않게 범위를 준다. */
const gcOnly = (pageId: string, batch?: number) =>
  runVersionGc(new Date(), { only: [pageId], ...(batch === undefined ? {} : { batch }) })

describe('① 만료된 버전을 지운다', () => {
  test('★ 만료된 버전과 그 바이트가 지워진다 — 만료 안 된 버전 · 가장 최근 버전은 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('GC')
    await write(page, [para('하나')])
    await restAndWrite(page, [para('둘')])
    await restAndWrite(page, [para('셋')])
    await restAndWrite(page, [para('넷')])
    const [v1, v2, v3] = await versionsOf(page)
    assert.ok(v1 && v2 && v3, '전제 — 버전 셋')
    await query(`UPDATE page_version SET expires_at = now() - interval '1 day' WHERE id = ANY($1::uuid[])`, [[v1!.id, v2!.id]])

    const swept = await gcOnly(page)
    assert.deepEqual([swept.deleted, swept.more], [2, false])
    assert.deepEqual((await versionsOf(page)).map((v) => v.id), [v3!.id], '만료 안 된 버전은 남는다')
    assert.ok(!store.has(v1!.state_ref) && !store.has(v2!.state_ref) && store.has(v3!.state_ref), '지운 버전의 바이트만 저장소에서 사라진다')

    await expireAll(page)
    const again = await gcOnly(page)
    assert.equal(again.deleted, 0, '가장 최근 버전은 만료돼도 남는다(최소 하나)')
    assert.deepEqual((await versionsOf(page)).map((v) => v.id), [v3!.id])
  })
})

describe('② 파일 참조(S5)', () => {
  test('★ 지운 버전이 담은 이미지의 참조가 내려간다 · 바이트가 없으면 행만 지우고 센다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('GC 이미지')
    const up = await uploadFile(fx.owner.ctx, { bytes: new Uint8Array(16).fill(7), mime: 'image/png', originalName: 'g.png' })
    assert.equal(up.ok, true)
    if (!up.ok) return
    const image: EditorBlock = { id: randomUUID(), type: 'image', title: [], properties: { source: { type: 'file', file_id: up.file.id } }, format: {}, children: [] }
    const refCount = async () => (await query<{ ref_count: number }>(`SELECT ref_count FROM file WHERE id = $1`, [up.file.id]))[0]!.ref_count
    await write(page, [para('사진'), image])
    await restAndWrite(page, [para('사진 지움')]) // 버전 v1(이미지를 담았다) — 본문 −1 · 버전 +1
    await restAndWrite(page, [para('또')]) // 버전 v2(이미지 없음)
    await restAndWrite(page, [para('또또')]) // 버전 v3 — 가장 최근
    assert.equal(await refCount(), 1, '전제 — 본문에서는 지웠고 버전 v1 이 담았다')

    await expireAll(page)
    const swept = await gcOnly(page)
    assert.deepEqual([swept.deleted, swept.missingBytes], [2, 0])
    assert.equal(await refCount(), 0, '지운 버전이 담은 참조가 내려갔다')

    // 바이트가 이미 없는 버전 — 행은 지우고 센다(참조는 셀 수 없다)
    await restAndWrite(page, [para('다섯')])
    const [oldest] = await versionsOf(page)
    store.delete(oldest!.state_ref)
    await expireAll(page)
    const lost = await gcOnly(page)
    assert.deepEqual([lost.deleted, lost.missingBytes], [1, 1])
  })
})

describe('③ 복원이 가리키는 버전', () => {
  test('★ 복원이 가리키는 버전은 남는다 — 가리키는 쪽이 지워진 다음 판에 지워진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('GC 복원')
    await write(page, [para('처음')])
    await restAndWrite(page, [para('둘째')])
    await restAndWrite(page, [para('셋째')])
    const [target] = await versionsOf(page)
    const restored = await restoreVersion(fx.owner.ctx, page, target!.id)
    assert.equal(restored.ok, true, JSON.stringify(restored))
    await restAndWrite(page, [para('복원 뒤에 고침')])
    await restAndWrite(page, [para('또 고침')])
    const pointer = (await versionsOf(page)).find((v) => v.reason === 'restore')
    assert.equal(pointer?.restored_from, target!.id, '전제 — 복원 버전이 첫 버전을 가리킨다')

    await expireAll(page)
    await gcOnly(page)
    const afterFirst = (await versionsOf(page)).map((v) => v.id)
    assert.ok(!afterFirst.includes(pointer!.id), '가리키는 쪽(복원 버전)은 지워졌다')
    assert.ok(afterFirst.includes(target!.id), '그 판에서 가리킴을 받던 버전은 남았다')

    await gcOnly(page)
    assert.ok(!(await versionsOf(page)).some((v) => v.id === target!.id), '다음 판에 지워진다')
  })
})

describe('④ 한 판의 상한', () => {
  test('꽉 차면 "더 있다" — 남은 것은 다음 판에', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('GC 상한')
    await write(page, [para('1')])
    await restAndWrite(page, [para('2')])
    await restAndWrite(page, [para('3')])
    await restAndWrite(page, [para('4')])
    await expireAll(page)
    const first = await gcOnly(page, 1)
    assert.deepEqual([first.deleted, first.more], [1, true])
    const second = await gcOnly(page, 5)
    assert.deepEqual([second.deleted, second.more], [1, false])
  })
})
