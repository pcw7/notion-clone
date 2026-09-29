/**
 * 코드 블록 — 잔여 묶음 8a-1 (F-01-14 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 본문 저장(서버 명령 경로 — Y.Doc → 투영)이 코드 블록을 `type='code'` 행으로 쓴다 — 글자(줄바꿈 · 탭) · 언어(목록 밖의
 *      값도) 그대로 · 색 없음 · Y.Doc 과 행이 같은 문서
 *   ② 코드 글자가 검색 색인에 들어간다
 *   ③ 언어가 문자열이 아니면 저장을 거부한다(`validateDoc`)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { query } from '../db/pool.ts'
import { assertBodyMatchesYDoc } from '../testing/body-invariant.ts'

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

const code = (text: string, properties: Record<string, unknown> = {}, format: Record<string, unknown> = {}): EditorBlock => ({
  id: randomUUID(),
  type: 'code',
  title: [textRun(text)],
  properties,
  format,
  children: [],
})

const newPage = async () => (await createPage(fx.owner.ctx, { title: titleFromPlainText('코드 블록') })).id

describe('① 본문 저장', () => {
  test("★ 코드 블록은 type='code' 행 — 글자 · 언어(목록 밖의 값도) 그대로 · 색 없음 · Y.Doc 과 같다", async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const a = code('def f():\n\treturn "```"', { language: 'python' }, { block_color: 'red', code_wrap: true })
    const b = code('x := 1', { language: 'my weird lang' })

    const saved = await savePageBody(fx.owner.ctx, pageId, { blocks: [a, b] })
    assert.ok(saved.ok, JSON.stringify(saved))

    const rows = await query<{ id: string; type: string; properties: Record<string, unknown>; format: Record<string, unknown> }>(
      `SELECT id, type, properties, format FROM block WHERE parent_id = $1 ORDER BY order_key, id`,
      [pageId],
    )
    assert.deepEqual(
      rows.map((r) => [r.id, r.type, r.properties.language]),
      [
        [a.id, 'code', 'python'],
        [b.id, 'code', 'my weird lang'],
      ],
    )
    const text = (rows[0]?.properties.title as { plain_text: string }[]).map((r) => r.plain_text).join('')
    assert.equal(text, 'def f():\n\treturn "```"')
    assert.equal(rows[0]?.format.block_color, undefined, '색을 지원하지 않는 코드 블록에 색이 남았다')
    assert.equal(rows[0]?.format.code_wrap, true, '줄바꿈 설정이 사라졌다')

    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    assert.deepEqual(loaded?.doc.blocks.map((x) => x.type), ['code', 'code'])
    // 색은 행에서만 빠지고 Y.Doc 에 남으면 두 본문이 갈린다(8a-1 이 찾은 옛 틈 — 구분선 · 이미지도 같았다).
    const ydoc = await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
    assert.equal(ydoc.blocks[0]?.format?.block_color, undefined)
  })
})

describe('② 검색', () => {
  test('코드 글자가 본문 색인에 들어간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [code('const answerToEverything = 42')] })).ok)
    const [row] = await query<{ body_text: string }>(`SELECT body_text FROM search_document WHERE doc_id = $1`, [pageId])
    assert.ok(row?.body_text.includes('answerToEverything'), row?.body_text)
  })
})

describe('③ 검증', () => {
  test('언어가 문자열이 아니면 저장을 거부한다 — 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const saved = await savePageBody(fx.owner.ctx, pageId, { blocks: [code('x', { language: 42 })] })
    assert.equal(saved.ok, false)
    const rows = await query(`SELECT 1 FROM block WHERE parent_id = $1`, [pageId])
    assert.equal(rows.length, 0)
  })
})
