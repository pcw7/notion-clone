/**
 * AI 가 읽는 페이지의 동기화 블록 사본 (SB-5 · F-01-11 · 정본 §3.4 [보강 SB-0] ⑲ [SB-5 고침] ⓒ · SY10 · DB · 진짜 공급자를 부르지 않는다)
 *
 *   ① 묻기 · 채팅 · 이어 쓰기의 문맥(`readAskPage`) — 요청자가 원본 페이지 A 를 볼 수 있으면 사본 자리에 원본의 글 · 아니면 사본째 뺀다(A 의 글 ·
 *      블록 id 없음)
 *   ② AI 블록 — 공급자에 보낸 메시지에 A 의 글이 볼 수 있을 때만 있다 · 원문 해시는 펴기 전의 원문(편집기와 같은 값)
 *
 * 환경(AI_BASE_URL · AI_API_KEY · AI_MODEL)은 가짜 공급자를 가리킨다 — `.env` 에 진짜 키가 있어도 닿지 않는다. 한도 게이트(F-10-12)는 그대로 지난다.
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { SYNCED_BLOCK_TYPE } from '../block/synced-block.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import type { BlockId } from '../ids.ts'
import { grantAccess } from '../permissions/acl.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { FAKE_AI_KEY, FAKE_AI_MODEL, startFakeAiProvider, type FakeAiProvider } from '../testing/fake-ai-provider.ts'
import { readAskPage } from './ask-context.ts'
import { aiBlockResponse } from './block-http.ts'
import { aiSourceText, aiTextHash, findBlockIn, readAiBlock } from './block-source.ts'
import { readAiConfig, type AiConfig } from './config.ts'
import { setAiEnabled } from './usage.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''
let fake: FakeAiProvider
let config: AiConfig

before(async () => {
  fake = await startFakeAiProvider()
  process.env.AI_BASE_URL = fake.baseUrl
  process.env.AI_API_KEY = FAKE_AI_KEY
  process.env.AI_MODEL = FAKE_AI_MODEL
  process.env.AI_DAILY_CAP = '10000000'
  config = readAiConfig()!
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  await fake.close()
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

/** 겹치지 않는 먼 UTC 날 — 하루 카운터를 이 시험만 쓴다. */
const farDay = (): Date =>
  new Date(Date.UTC(2200 + Math.floor(Math.random() * 700), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28), 10))

const para = (id: string, text: string): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)], properties: {}, format: {}, children: [] })

async function newPage(by: Actor, title: string, blocks: EditorBlock[], privateTop: boolean): Promise<BlockId> {
  const page = (await createPage(by.ctx, { title: titleFromPlainText(title), privateTop })).id
  const saved = await savePageBody(by.ctx, page, { blocks })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return page
}

/** 대표의 개인 페이지 A(동료는 볼 수 없다)의 원본 X · 동료의 페이지 B 에 X 의 사본 + AI 블록. */
async function scenario() {
  const ws = await createBareWorkspace(`AI 읽는 길 ${randomUUID().slice(0, 6)}`)
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  assert.ok((await setAiEnabled(boss.ctx, true)).ok)
  const mark = `원본비밀${randomUUID().slice(0, 6)}`
  const [x, a1, copy, ai] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  const a = await newPage(boss, '원본 A', [
    { id: x, type: SYNCED_BLOCK_TYPE, title: [], properties: {}, format: {}, children: [para(a1, `${mark} 회의 결정: 출시는 화요일`)] },
  ], true)
  const b = await newPage(mate, '사본 B', [
    para(randomUUID(), 'B 의 글 — 이 페이지에서 직접 쓴 서른 글자 넘는 문장입니다'),
    { id: copy, type: SYNCED_BLOCK_TYPE, title: [], properties: { synced_from: x }, format: {}, children: [] },
    { id: ai, type: 'ai_block', title: [], properties: { kind: 'summary' }, format: {}, children: [] },
  ], false)
  return { boss, mate, a, b, x, a1, copy, ai, mark }
}

describe('① 묻기의 문맥 (readAskPage)', () => {
  test('★ 원본을 볼 수 있으면 사본 자리에 원본의 글 · 아니면 사본째 뺀다(A 의 글 · 블록 id 없음) · 권한을 받으면 편다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await scenario()
    const denied = await readAskPage(s.mate.ctx, s.b)
    assert.ok(denied !== null)
    const deniedJson = JSON.stringify(denied)
    for (const [what, value] of [['글', s.mark], ['원본 안의 블록 id', s.a1], ['A 의 페이지 id', s.a]] as const) {
      assert.ok(!deniedJson.includes(value), `못 보는 쪽 — ${what}가 없다`)
    }
    assert.ok(!denied.doc.blocks.some((b) => b.id === s.copy), '사본째 뺀다(자리 글도 없다)')

    const own = await readAskPage(s.boss.ctx, s.b)
    assert.deepEqual(own?.doc.blocks.find((b) => b.id === s.copy)?.children?.map((c) => c.id), [s.a1], '볼 수 있으면 원본의 자식')
    assert.ok((await grantAccess(s.boss.ctx, s.a, { type: 'user', id: s.mate.userId }, 'view')).ok)
    assert.ok(JSON.stringify(await readAskPage(s.mate.ctx, s.b)).includes(s.mark), '권한을 받으면 편다')
  })
})

describe('② AI 블록', () => {
  const generate = async (who: Actor, page: string, block: string) => {
    const now = farDay()
    const res = await aiBlockResponse(who.ctx, { pageId: page, blockId: block }, new AbortController().signal, { config, now: () => now })
    await res.text()
    return res.status
  }

  test('★ 공급자에 보낸 원문에 원본의 글은 요청자가 원본을 볼 때만 — 원문 해시는 펴기 전의 원문(편집기와 같은 값)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await scenario()
    const before = fake.requests.length
    assert.equal(await generate(s.mate, s.b, s.ai), 200)
    assert.equal(fake.requests.length - before, 1, '공급자 호출 하나(가짜)')
    const deniedSent = JSON.stringify(fake.requests.at(-1)!.body.messages)
    assert.ok(deniedSent.includes('이 페이지에서 직접 쓴'), 'B 의 글은 간다')
    assert.ok(!deniedSent.includes(s.mark) && !deniedSent.includes(s.a1), '★ 못 보는 원본의 글 · id 는 가지 않는다')

    assert.ok((await grantAccess(s.boss.ctx, s.a, { type: 'user', id: s.mate.userId }, 'view')).ok)
    assert.equal(await generate(s.mate, s.b, s.ai), 200)
    assert.ok(JSON.stringify(fake.requests.at(-1)!.body.messages).includes(`${s.mark} 회의 결정`), '볼 수 있으면 원본의 글이 간다')

    // 해시 — 편집기는 사본을 펴지 않은 문서로 짓는다. 서버가 적은 값이 그것과 같아야 "원문이 바뀌었다" 가 서지 않는다
    const doc = (await loadPageBody(s.mate.ctx, s.b))!.doc
    const props = readAiBlock(findBlockIn(doc.blocks, s.ai)!.properties)
    assert.equal(props.sourceHash, aiTextHash(aiSourceText(doc)))
  })
})
