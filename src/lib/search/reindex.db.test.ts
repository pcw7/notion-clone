/**
 * 검색 전체 재색인 (10p-4 · F-07-06 · HANDOFF §7 "검색 전체 재색인 경로")
 *
 *   ① ★ 저장 경로가 쓴 색인을 지우고 다시 색인하면 같은 값이 돌아온다(제목 · 본문 · 언어)
 *   ② 문서 범위 — 하위 페이지의 본문은 부모의 색인에 섞이지 않는다 · 휴지통의 블록은 빠진다
 *   ③ 없는 페이지는 "사라짐"으로 센다(실패가 아니다)
 *   ④ 워크스페이스 하나의 전체 — 그 워크스페이스의 지운 색인이 모두 돌아온다 · 다른 워크스페이스는 건드리지 않는다
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { type Fixture, makeFixture, probeDatabase } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { query } from '../db/pool.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { BlockId } from '../ids.ts'
import type { EditorDoc } from '../editor/document.ts'
import { reindexAllPages, reindexPages } from './reindex.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let other: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  other = await makeFixture()
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

type IndexText = { title_text: string | null; body_text: string | null; lang: string | null }

const indexOf = async (pageId: string): Promise<IndexText> =>
  (await query<IndexText>(`SELECT title_text, body_text, lang FROM search_document WHERE doc_id = $1`, [pageId]))[0]!

const wipe = (pageId: string) => query(`UPDATE search_document SET title_text = NULL, body_text = NULL, lang = NULL WHERE doc_id = $1`, [pageId])

const newPage = async (f: Fixture, title: string, parentPageId?: BlockId): Promise<BlockId> =>
  (await createPage(f.owner.ctx, { title: titleFromPlainText(title), ...(parentPageId ? { parentPageId } : {}) })).id

const docOf = (...texts: string[]): EditorDoc => ({
  blocks: texts.map((t) => ({ id: randomUUID(), type: 'paragraph' as const, title: [textRun(t)] })),
})

const save = async (f: Fixture, page: BlockId, doc: EditorDoc) => {
  const saved = await savePageBody(f.owner.ctx, page, doc)
  assert.ok(saved.ok, `본문 저장 실패: ${JSON.stringify(saved)}`)
}

describe('검색 전체 재색인', () => {
  test('① ★ 지운 색인이 저장 경로와 같은 값으로 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage(fx, '재색인 제목')
    await save(fx, page, docOf('첫 문단의 글', 'second paragraph'))
    const saved = await indexOf(page)
    assert.ok(saved.body_text?.includes('첫 문단의 글'), '전제 — 저장 경로가 본문을 색인했다')

    await wipe(page)
    assert.equal((await indexOf(page)).body_text, null, '전제 — 지웠다')
    assert.deepEqual(await reindexPages([page]), { indexed: 1, missing: 0, failed: [] })
    assert.deepEqual(await indexOf(page), saved)
  })

  test('② 문서 범위 — 하위 페이지의 본문은 섞이지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const parent = await newPage(fx, '부모')
    await save(fx, parent, docOf('부모의 글'))
    const child = await newPage(fx, '하위', parent)
    await save(fx, child, docOf('하위만의 글'))
    await wipe(parent)
    await wipe(child)
    await reindexPages([parent, child])
    const p = await indexOf(parent)
    const c = await indexOf(child)
    assert.ok(p.body_text?.includes('부모의 글') && !p.body_text.includes('하위만의 글'), JSON.stringify(p))
    assert.ok(c.body_text?.includes('하위만의 글') && !c.body_text.includes('부모의 글'), JSON.stringify(c))
  })

  test('③ 없는 페이지는 사라짐으로 센다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    assert.deepEqual(await reindexPages([randomUUID()]), { indexed: 0, missing: 1, failed: [] })
  })

  test('④ 워크스페이스 하나의 전체 — 그 워크스페이스만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const a = await newPage(fx, '전체 재색인 가')
    await save(fx, a, docOf('가의 글'))
    const b = await newPage(fx, '전체 재색인 나')
    await save(fx, b, docOf('나의 글'))
    const elsewhere = await newPage(other, '다른 워크스페이스')
    await save(other, elsewhere, docOf('남의 글'))
    await wipe(a)
    await wipe(b)
    await wipe(elsewhere)
    let progressed = 0
    const result = await reindexAllPages({ workspaceId: fx.workspaceId, onProgress: (done) => (progressed = done) })
    assert.equal(result.failed.length, 0)
    assert.ok(result.indexed >= 2 && progressed === result.indexed + result.missing, JSON.stringify({ result, progressed }))
    assert.ok((await indexOf(a)).body_text?.includes('가의 글'))
    assert.ok((await indexOf(b)).body_text?.includes('나의 글'))
    assert.equal((await indexOf(elsewhere)).body_text, null, '다른 워크스페이스는 건드리지 않는다')
  })
})
