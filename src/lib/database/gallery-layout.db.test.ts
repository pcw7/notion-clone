/**
 * 갤러리 레이아웃 · 카드 미리보기 (DB 심화 2f-2조각 · F-04-05, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 갤러리 ④
 *
 * 이 파일이 지키는 것.
 *
 *   ① 레이아웃 — 기본값(본문의 첫 이미지 · 보통 · 채우기) · ★ 키 단위로 합친다(한 키를 바꿔도 다른 키는 그대로) · 다른 설정
 *      (`configuration` 의 다른 키)을 덮지 않는다 · 틀린 키 · 값은 거부(`invalid_layout`)
 *   ② ★ 카드 미리보기 — 본문 최상위의 첫 이미지(우리 파일은 내용 경로 · 외부는 그 URL) · 이미지가 없는 행은 빠진다 · 첫 이미지가
 *      비어 있으면 미리보기 없음 · 토글 안의 이미지는 보지 않는다 · 휴지통의 행 · 읽을 수 없는 스코프는 빠진다
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { withTransaction } from '../db/tx.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import type { EditorBlock } from '../editor/document.ts'
import { uploadFile } from '../file/file.ts'
import { createDatabase } from './database.ts'
import { createRow, trashRow } from './row.ts'
import { createView, getView, updateView } from './view.ts'
import { DEFAULT_GALLERY_LAYOUT, type GalleryLayout } from './gallery.ts'
import { readCardCovers } from './gallery-covers.ts'

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

describe('① 레이아웃', () => {
  test('★ 기본값 · 키 단위로 합친다 · 다른 설정을 덮지 않는다 · 틀린 것은 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: `갤러리 레이아웃 ${Date.now()}` }))
    const view = unwrap(await createView(fx.owner.ctx, db.id, { type: 'gallery' }))
    assert.deepEqual(view.gallery, DEFAULT_GALLERY_LAYOUT)

    // 다른 키가 configuration 에 이미 있다고 하자(다른 뷰 종류의 설정 · 다른 사람이 바꾼 것)
    await withTransaction((tx) => tx.query(`UPDATE view SET configuration = configuration || '{"other": 1}'::jsonb WHERE id = $1`, [view.id]))

    unwrap(await updateView(fx.owner.ctx, view.id, { gallery: { cover_size: 'large' } }))
    unwrap(await updateView(fx.owner.ctx, view.id, { gallery: { cover: 'none' } }))
    const expected: GalleryLayout = { cover: 'none', cover_size: 'large', cover_aspect: 'cover' }
    assert.deepEqual(unwrap(await getView(fx.owner.ctx, view.id)).gallery, expected, '앞에서 바꾼 크기가 남는다')
    const stored = await withTransaction((tx) => tx.queryOne<{ configuration: Record<string, unknown> }>(`SELECT configuration FROM view WHERE id = $1`, [view.id]))
    assert.equal(stored.configuration.other, 1, 'configuration 의 다른 키를 덮지 않는다')

    for (const bad of [{ cover: 'page_cover' }, { cover_size: 'huge' }, { color: 'red' }, {}]) {
      const r = await updateView(fx.owner.ctx, view.id, { gallery: bad as Partial<GalleryLayout> })
      assert.equal(!r.ok && r.reason, 'invalid_layout', JSON.stringify(bad))
    }
  })
})

describe('② 카드 미리보기 — 본문의 첫 이미지', () => {
  test('★ 최상위의 첫 이미지 · 없으면 빠진다 · 첫 이미지가 비면 없음 · 토글 안은 보지 않는다 · 휴지통의 행은 빠진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: `미리보기 ${Date.now()}` }))
    const row = async () => unwrap(await createRow(fx.owner.ctx, db.dataSourceId, {})).id
    const [withFile, withUrl, plain, emptyFirst, inToggle, trashed] = [await row(), await row(), await row(), await row(), await row(), await row()]

    const uploaded = await uploadFile(fx.owner.ctx, { bytes: randomBytes(64), mime: 'image/png', originalName: 'a.png' })
    assert.ok(uploaded.ok)
    const image = (source: unknown): EditorBlock => ({ id: randomUUID(), type: 'image', title: [], properties: source === null ? {} : { source } })
    const para = (): EditorBlock => ({ id: randomUUID(), type: 'paragraph', title: [] })
    const save = async (pageId: string, blocks: EditorBlock[]) => {
      const body = await loadPageBody(fx.owner.ctx, pageId as never)
      assert.ok(body !== null)
      const saved = await savePageBody(fx.owner.ctx, pageId as never, { blocks }, { expectedVersion: body.version })
      assert.equal(saved.ok, true, JSON.stringify(saved))
    }
    await save(withFile, [para(), image({ type: 'file', file_id: uploaded.file.id }), image({ type: 'external', url: 'https://example.com/second.png' })])
    await save(withUrl, [image({ type: 'external', url: 'https://example.com/a.png' })])
    await save(plain, [para()])
    await save(emptyFirst, [image(null), image({ type: 'external', url: 'https://example.com/later.png' })])
    await save(inToggle, [{ id: randomUUID(), type: 'toggle', title: [], children: [image({ type: 'external', url: 'https://example.com/inner.png' })] }])
    await save(trashed, [image({ type: 'external', url: 'https://example.com/trashed.png' })])
    unwrap(await trashRow(fx.owner.ctx, trashed))

    const covers = await readCardCovers(fx.owner.ctx, [withFile, withUrl, plain, emptyFirst, inToggle, trashed])
    assert.deepEqual(covers, {
      [withFile]: `/api/workspaces/${fx.owner.ctx.workspaceId}/files/${uploaded.file.id}/content`,
      [withUrl]: 'https://example.com/a.png',
    })
  })

  test('읽을 수 없는 워크스페이스의 행 id 를 주어도 아무것도 나오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: `미리보기 남의 것 ${Date.now()}` }))
    const id = unwrap(await createRow(fx.owner.ctx, db.dataSourceId, {})).id
    const body = await loadPageBody(fx.owner.ctx, id as never)
    assert.ok(body !== null)
    const saved = await savePageBody(
      fx.owner.ctx,
      id as never,
      { blocks: [{ id: randomUUID(), type: 'image', title: [], properties: { source: { type: 'external', url: 'https://example.com/x.png' } } }] },
      { expectedVersion: body.version },
    )
    assert.equal(saved.ok, true)
    assert.ok(Object.keys(await readCardCovers(fx.owner.ctx, [id])).length === 1, '주인에게는 보인다')
    const other = await makeFixture()
    assert.deepEqual(await readCardCovers(other.owner.ctx, [id]), {}, '다른 워크스페이스의 세션')
  })
})
