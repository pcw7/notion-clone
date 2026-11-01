/**
 * 페이지 커버 — 달고 · 바꾸고 · 지운다 (34번 트랙 PC-1 · F-02-06 · 정본 §3.4 [보강 PC-1] · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 자리는 `format.page_cover` 하나 — 다른 키(아이콘 포함)는 그대로 · 지우면 키가 없다 · 바뀔 때만 version 이 오른다
 *   ② 권한 · 잠금 · 모양은 아이콘과 같다 — 거부는 아무것도 바꾸지 않는다 · 없는 파일 · 표에 없는 내장 커버도 거부(올린 이미지의 장부는 file/cover-reference.db.test.ts)
 *   ③ DB 행도 받는다(표를 고칠 수 있는 사람)
 *   ④ 상세(`getPage`)만 커버를 싣는다 — 사이드바 · 하위 목록의 요약에는 없다
 *   ⑤ 본문은 커버를 싣지 않는다 — 행에서 부모의 Y.Doc 을 지어도 · 부모의 본문을 저장해도 하위 페이지의 커버는 그 행에 그대로
 *   ⑥ 복제는 커버를 옮긴다
 *   ⑦ 위치(PC-3) — 그림 커버만 · 0~1 · 같으면 쓰지 않음 · 커버를 바꾸거나 지우면 위치도 지운다 · 복제는 위치를 옮긴다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import * as Y from 'yjs'

import { createUser, joinAs, probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import {
  createPage,
  getPage,
  listChildPages,
  setPageCover,
  setPageCoverPosition,
  setPageIcon,
  titleFromPlainText,
  PageError,
  type PageDetail,
} from './page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'
import { duplicatePage } from './duplicate.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { createDatabase } from '../database/database.ts'
import { createRow } from '../database/row.ts'
import { loadDocState } from '../collab/doc-store.ts'
import { BODY_FRAGMENT } from '../collab/ydoc.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import type { PageCover } from './page-cover.ts'
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

const gallery = (id: string): PageCover => ({ type: 'gallery', gallery: id })
const newPage = async (title: string, more: { parentPageId?: BlockId; privateTop?: boolean } = {}): Promise<PageDetail> =>
  createPage(fx.owner.ctx, { title: titleFromPlainText(title), ...more })

async function rowOf(id: string): Promise<{ format: Record<string, unknown>; version: string; last_edited_by: string | null }> {
  const rows = await query<{ format: Record<string, unknown>; version: string; last_edited_by: string | null }>(
    `SELECT format, version, last_edited_by FROM block WHERE id = $1`,
    [id],
  )
  return rows[0]
}

async function rejects(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, (e: unknown) => e instanceof PageError && e.code === code)
}

function rawBody(ydoc: Y.Doc): string {
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlHook): unknown =>
    node instanceof Y.XmlText
      ? node.toString()
      : node instanceof Y.XmlElement
        ? { name: node.nodeName, attrs: node.getAttributes(), children: node.toArray().map(walk) }
        : null
  return JSON.stringify(ydoc.getXmlFragment(BODY_FRAGMENT).toArray().map(walk))
}

describe('① 달고 · 바꾸고 · 지운다', () => {
  test('★ format.page_cover 하나만 — 아이콘 · 다른 키는 그대로 · 지우면 키가 없다 · 바뀔 때만 version 이 오른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('커버 단 페이지')
    await setPageIcon(fx.owner.ctx, page.id, { type: 'emoji', emoji: '🌱' })
    const v0 = (await rowOf(page.id)).version

    assert.deepEqual(await setPageCover(fx.owner.ctx, page.id, gallery('gradient_2')), gallery('gradient_2'))
    const r1 = await rowOf(page.id)
    assert.deepEqual(r1.format, { page_icon: { type: 'emoji', emoji: '🌱' }, page_cover: { type: 'gallery', gallery: 'gradient_2' } })
    assert.equal(BigInt(r1.version), BigInt(v0) + 1n)
    assert.equal(r1.last_edited_by, fx.owner.userId)

    await setPageCover(fx.owner.ctx, page.id, gallery('gradient_2'))
    assert.equal((await rowOf(page.id)).version, r1.version, '같은 커버에 version 이 올랐다')

    // 바꾸기 — 받은 객체의 다른 키 · 앞뒤 공백은 싣지 않는다
    await setPageCover(fx.owner.ctx, page.id, { type: 'external', url: ' https://example.com/c.png ', extra: 1 } as unknown as PageCover)
    assert.deepEqual((await rowOf(page.id)).format.page_cover, { type: 'external', url: 'https://example.com/c.png' })
    assert.deepEqual((await getPage(fx.owner.ctx, page.id))?.cover, { type: 'external', url: 'https://example.com/c.png' })

    assert.equal(await setPageCover(fx.owner.ctx, page.id, null), null)
    assert.deepEqual((await rowOf(page.id)).format, { page_icon: { type: 'emoji', emoji: '🌱' } })
    assert.equal((await getPage(fx.owner.ctx, page.id))?.cover, null)
  })
})

describe('② 거부는 아무것도 바꾸지 않는다', () => {
  test('★ 볼 수만 있는 사람 forbidden · 볼 수 없는 사람 not_found · 잠긴 페이지 locked · 모양 · 표에 없는 커버 · 없는 파일 invalid_cover', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('지키는 페이지', { privateTop: true })
    await setPageCover(fx.owner.ctx, page.id, gallery('solid_blue'))
    const before = await rowOf(page.id)

    const reader = await joinAs(fx.workspaceId, await createUser('읽기만'), 'member')
    const outsider = await joinAs(fx.workspaceId, await createUser('못 보는 사람'), 'member')
    assert.ok((await grantAccess(fx.owner.ctx, page.id, { type: 'user', id: reader.userId }, 'view')).ok)

    await rejects(() => setPageCover(reader.ctx, page.id, gallery('solid_red')), 'forbidden')
    await rejects(() => setPageCover(outsider.ctx, page.id, gallery('solid_red')), 'not_found')
    for (const bad of [
      gallery('gradient_99'),
      { type: 'external', url: 'javascript:alert(1)' },
      { type: 'file', file_id: randomUUID() },
      { type: 'emoji', emoji: '🌱' },
    ]) {
      await rejects(() => setPageCover(fx.owner.ctx, page.id, bad as PageCover), 'invalid_cover')
    }

    assert.ok((await setPageLock(fx.owner.ctx, page.id, true)).ok)
    await rejects(() => setPageCover(fx.owner.ctx, page.id, gallery('solid_red')), 'locked')
    await rejects(() => setPageCover(fx.owner.ctx, page.id, null), 'locked')

    assert.deepEqual(await rowOf(page.id), before, '거부한 뒤에 행이 바뀌었다')
    assert.ok((await setPageLock(fx.owner.ctx, page.id, false)).ok)
    await setPageCover(fx.owner.ctx, page.id, gallery('solid_red'))
    assert.deepEqual((await getPage(fx.owner.ctx, page.id))?.cover, gallery('solid_red'), '잠금을 풀면 다시 고친다')
  })
})

describe('③ DB 행', () => {
  test('표를 고칠 수 있는 사람은 행에 커버를 단다 — 표를 볼 수만 있는 사람은 forbidden', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await createDatabase(fx.owner.ctx, { name: '커버 표', privateTop: true })
    assert.ok(table.ok)
    const row = await createRow(fx.owner.ctx, table.value.dataSourceId)
    assert.ok(row.ok)
    const rowId = row.value.id as BlockId

    assert.deepEqual(await setPageCover(fx.owner.ctx, rowId, gallery('gradient_5')), gallery('gradient_5'))
    assert.deepEqual((await rowOf(rowId)).format.page_cover, { type: 'gallery', gallery: 'gradient_5' })

    const reader = await joinAs(fx.workspaceId, await createUser('표 읽기만'), 'member')
    assert.ok((await grantAccess(fx.owner.ctx, table.value.id, { type: 'user', id: reader.userId }, 'view')).ok)
    const before = await rowOf(rowId)
    await rejects(() => setPageCover(reader.ctx, rowId, gallery('solid_red')), 'forbidden')
    assert.deepEqual(await rowOf(rowId), before)
  })
})

describe('④ 상세만 싣는다', () => {
  test('getPage 는 커버를 싣고 하위 목록의 요약에는 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const parent = await newPage('부모')
    const child = await newPage('커버 단 자식', { parentPageId: parent.id })
    await setPageCover(fx.owner.ctx, child.id, gallery('gradient_1'))
    assert.deepEqual((await getPage(fx.owner.ctx, child.id))?.cover, gallery('gradient_1'))
    const [summary] = (await listChildPages(fx.owner.ctx, parent.id)).filter((p) => p.id === child.id)
    assert.ok(summary !== undefined)
    assert.equal('cover' in summary, false, '요약(사이드바 · 목록)에 커버가 실렸다')
  })
})

describe('⑤ 본문은 커버를 싣지 않는다', () => {
  test('★ 행에서 부모의 Y.Doc 을 지어도 하위 페이지 참조에 커버가 없다 · 부모의 본문을 저장해도 자식의 커버는 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const parent = await newPage('옮기지 않은 부모')
    const child = await newPage('커버 단 자식', { parentPageId: parent.id })
    await setPageCover(fx.owner.ctx, child.id, gallery('gradient_7'))
    await query(`DELETE FROM doc_update WHERE page_id = $1`, [parent.id])
    await query(`DELETE FROM doc_snapshot WHERE page_id = $1`, [parent.id])

    const state = await loadDocState(fx.owner.ctx, parent.id)
    assert.ok(state.ok)
    const json = rawBody(state.value.ydoc)
    assert.ok(json.includes(child.id), '전제 — 부모의 본문에 하위 페이지 참조가 있다')
    assert.ok(!json.includes('gradient_7') && !json.includes('page_cover'), `하위 페이지의 커버가 부모의 Y.Doc 에 들어갔다: ${json}`)

    const loaded = await loadPageBody(fx.owner.ctx, parent.id)
    assert.ok(loaded !== null)
    const saved = await savePageBody(fx.owner.ctx, parent.id, {
      blocks: [...loaded.doc.blocks, { id: randomUUID(), type: 'paragraph', title: [textRun('덧붙인 줄')] }],
    })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.deepEqual((await rowOf(child.id)).format.page_cover, { type: 'gallery', gallery: 'gradient_7' }, '부모의 본문을 저장하자 자식의 커버가 사라졌다')
  })
})

describe('⑥ 복제', () => {
  test('복제는 커버를 옮긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('꾸민 원본')
    await setPageCover(fx.owner.ctx, page.id, gallery('gradient_4'))
    const copy = await duplicatePage(fx.owner.ctx, page.id)
    assert.deepEqual((await getPage(fx.owner.ctx, copy.page.id))?.cover, gallery('gradient_4'))
  })
})

describe('⑦ 위치(PC-3)', () => {
  test('★ 그림 커버에 위치를 정한다 — 같으면 쓰지 않음 · 상세가 싣는다 · 내장 커버 · 커버 없음 · 범위 밖은 invalid_cover_position', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('위치 정할 페이지')
    await rejects(() => setPageCoverPosition(fx.owner.ctx, page.id, 0.3), 'invalid_cover_position')
    await setPageCover(fx.owner.ctx, page.id, gallery('solid_red'))
    await rejects(() => setPageCoverPosition(fx.owner.ctx, page.id, 0.3), 'invalid_cover_position')

    await setPageCover(fx.owner.ctx, page.id, { type: 'external', url: 'https://example.com/tall.png' })
    assert.equal((await getPage(fx.owner.ctx, page.id))?.coverPosition, 0.5, '정하지 않으면 가운데')
    const v0 = (await rowOf(page.id)).version
    assert.equal(await setPageCoverPosition(fx.owner.ctx, page.id, 0.123456), 0.1235)
    const r1 = await rowOf(page.id)
    assert.equal(r1.format.page_cover_position, 0.1235)
    assert.equal(BigInt(r1.version), BigInt(v0) + 1n)
    await setPageCoverPosition(fx.owner.ctx, page.id, 0.1235)
    assert.equal((await rowOf(page.id)).version, r1.version, '같은 위치에 version 이 올랐다')
    assert.equal((await getPage(fx.owner.ctx, page.id))?.coverPosition, 0.1235)
    for (const bad of [-0.1, 1.5, Number.NaN]) await rejects(() => setPageCoverPosition(fx.owner.ctx, page.id, bad), 'invalid_cover_position')

    const copy = await duplicatePage(fx.owner.ctx, page.id)
    assert.equal((await getPage(fx.owner.ctx, copy.page.id))?.coverPosition, 0.1235, '복제는 위치를 옮긴다')

    await setPageCover(fx.owner.ctx, page.id, { type: 'external', url: 'https://example.com/other.png' })
    assert.equal('page_cover_position' in (await rowOf(page.id)).format, false, '커버를 바꾸면 위치를 지운다')
    await setPageCoverPosition(fx.owner.ctx, page.id, 0.8)
    await setPageCover(fx.owner.ctx, page.id, null)
    assert.deepEqual(Object.keys((await rowOf(page.id)).format).filter((k) => k.startsWith('page_cover')), [], '커버를 지우면 위치도')
  })

  test('볼 수만 있는 사람은 forbidden · 잠기면 locked', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('위치 지키는 페이지', { privateTop: true })
    await setPageCover(fx.owner.ctx, page.id, { type: 'external', url: 'https://example.com/tall.png' })
    const reader = await joinAs(fx.workspaceId, await createUser('위치 읽기만'), 'member')
    assert.ok((await grantAccess(fx.owner.ctx, page.id, { type: 'user', id: reader.userId }, 'view')).ok)
    await rejects(() => setPageCoverPosition(reader.ctx, page.id, 0.2), 'forbidden')
    assert.ok((await setPageLock(fx.owner.ctx, page.id, true)).ok)
    await rejects(() => setPageCoverPosition(fx.owner.ctx, page.id, 0.2), 'locked')
    assert.ok((await setPageLock(fx.owner.ctx, page.id, false)).ok)
  })
})
