/**
 * 페이지의 모습 — 서체 · 작은 글씨 · 전체 폭 (36번 트랙 PL-1 · F-02-07 · 정본 §3.4 [보강 PL-1] · DB)
 *
 *   ① 준 칸만 바꾸고 합친다 · 기본값인 칸은 키를 지운다 · 같으면 쓰지 않는다 · 상세가 싣는다
 *   ② 권한 · 잠금 · 데이터베이스 행(레이아웃이 정한다)은 거부 — 아무것도 바꾸지 않는다
 *   ③ 본문 저장이 페이지 행의 모습을 지우지 않는다 · 복제는 옮긴다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createUser, joinAs, probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, getPage, setPageAppearance, titleFromPlainText, PageError } from './page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'
import { duplicatePage } from './duplicate.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { createDatabase } from '../database/database.ts'
import { createRow } from '../database/row.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
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

const newPage = async (title: string, more: { privateTop?: boolean } = {}) => createPage(fx.owner.ctx, { title: titleFromPlainText(title), ...more })
const formatOf = async (id: string) => (await query<{ format: Record<string, unknown>; version: string }>(`SELECT format, version FROM block WHERE id = $1`, [id]))[0]
const rejects = (run: () => Promise<unknown>, code: string) => assert.rejects(run, (e: unknown) => e instanceof PageError && e.code === code)

describe('① 바꾸고 합친다', () => {
  test('★ 준 칸만 · 기본값이면 키를 지운다 · 같으면 version 이 오르지 않는다 · 상세가 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('모습')
    const v0 = (await formatOf(page.id)).version
    assert.deepEqual(await setPageAppearance(fx.owner.ctx, page.id, { font: 'serif', fullWidth: true }), { font: 'serif', smallText: false, fullWidth: true })
    const r1 = await formatOf(page.id)
    assert.deepEqual(r1.format, { page_font: 'serif', page_full_width: true })
    assert.equal(BigInt(r1.version), BigInt(v0) + 1n)
    await setPageAppearance(fx.owner.ctx, page.id, { font: 'serif' })
    assert.equal((await formatOf(page.id)).version, r1.version, '같은 모습에 version 이 올랐다')
    await setPageAppearance(fx.owner.ctx, page.id, { smallText: true, font: 'default' })
    assert.deepEqual((await formatOf(page.id)).format, { page_small_text: true, page_full_width: true }, '기본 서체는 키를 지운다 · 준 칸만 바꾼다')
    assert.deepEqual((await getPage(fx.owner.ctx, page.id))?.appearance, { font: 'default', smallText: true, fullWidth: true })
    await setPageAppearance(fx.owner.ctx, page.id, { smallText: false, fullWidth: false })
    assert.deepEqual((await formatOf(page.id)).format, {}, '모두 기본이면 키가 없다')
  })
})

describe('② 거부는 아무것도 바꾸지 않는다', () => {
  test('★ 볼 수만 있는 사람 forbidden · 잠긴 페이지 locked · 데이터베이스 행 invalid_appearance', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('지키는 모습', { privateTop: true })
    await setPageAppearance(fx.owner.ctx, page.id, { font: 'mono' })
    const before = await formatOf(page.id)
    const reader = await joinAs(fx.workspaceId, await createUser('모습 읽기만'), 'member')
    assert.ok((await grantAccess(fx.owner.ctx, page.id, { type: 'user', id: reader.userId }, 'view')).ok)
    await rejects(() => setPageAppearance(reader.ctx, page.id, { font: 'serif' }), 'forbidden')
    assert.ok((await setPageLock(fx.owner.ctx, page.id, true)).ok)
    await rejects(() => setPageAppearance(fx.owner.ctx, page.id, { font: 'serif' }), 'locked')
    assert.deepEqual(await formatOf(page.id), before)
    assert.ok((await setPageLock(fx.owner.ctx, page.id, false)).ok)

    const table = await createDatabase(fx.owner.ctx, { name: '모습 표', privateTop: true })
    assert.ok(table.ok)
    const row = await createRow(fx.owner.ctx, table.value.dataSourceId)
    assert.ok(row.ok)
    await rejects(() => setPageAppearance(fx.owner.ctx, row.value.id as BlockId, { fullWidth: true }), 'invalid_appearance')
  })
})

describe('③ 본문 · 복제', () => {
  test('본문을 저장해도 페이지 행의 모습은 그대로 · 복제는 옮긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('모습 본문')
    await setPageAppearance(fx.owner.ctx, page.id, { font: 'serif', smallText: true })
    const loaded = await loadPageBody(fx.owner.ctx, page.id)
    assert.ok(loaded !== null)
    const saved = await savePageBody(fx.owner.ctx, page.id, { blocks: [...loaded.doc.blocks, { id: randomUUID(), type: 'paragraph', title: [textRun('덧붙임')] }] })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.deepEqual((await getPage(fx.owner.ctx, page.id))?.appearance, { font: 'serif', smallText: true, fullWidth: false })
    const copy = await duplicatePage(fx.owner.ctx, page.id)
    assert.deepEqual((await getPage(fx.owner.ctx, copy.page.id))?.appearance, { font: 'serif', smallText: true, fullWidth: false })
  })
})
