/**
 * AI 블록 만들기 · 다시 만들기 — 거부 · 문맥 · 서버의 쓰기 · 셈 (AI-5 · F-10-04 · F-10-12 · DB · 진짜 공급자를 부르지 않는다)
 *
 *   ① 만들기 — 자식이 결과로 · 시각 · 원문 해시 · 결과 해시(편집기와 같은 함수) · 출처 ai · 행위자 · 응답 하나(기능 block) · 다시 만들기는 간다
 *   ② 거부 — 보기 · 잠금 403 cannot_edit · 원문 부족 400 · 빈 지시 400 · 없는 블록 404 — 공급자 · 예약 없음
 *   ③ 문맥 — 자기 · 다른 AI 블록 · 그 결과를 싣지 않는다(가짜 공급자의 [echo]) · 종류 · 지시는 서버 본문의 것
 *   ④ 멈추면 쓰지 않는다(stopped · 셈에 든다) · 복제는 결과째 · 검색은 결과의 글을 찾는다
 *
 * 환경(AI_BASE_URL · AI_API_KEY · AI_MODEL)은 가짜 공급자를 가리킨다 — `.env` 에 진짜 키가 있어도 닿지 않는다.
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { duplicatePage } from '../block/duplicate.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import type { EditorBlock } from '../editor/document.ts'
import type { BlockId, WorkspaceId } from '../ids.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { searchPages } from '../search/search.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { FAKE_AI_KEY, FAKE_AI_MODEL, startFakeAiProvider, type FakeAiProvider } from '../testing/fake-ai-provider.ts'
import { aiBlockResponse } from './block-http.ts'
import { aiResultText, aiSourceText, aiTextHash, findBlockIn } from './block-source.ts'
import { readAiConfig, type AiConfig } from './config.ts'
import { createSseParser, type SseEvent } from './sse.ts'
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

async function aiWorkspace(): Promise<{ ws: WorkspaceId; owner: Actor }> {
  const fx = await makeFixture()
  assert.ok((await setAiEnabled(fx.owner.ctx, true)).ok)
  return { ws: fx.workspaceId, owner: fx.owner }
}

const generate = (who: Actor, body: unknown, signal: AbortSignal = new AbortController().signal) => {
  const now = farDay()
  return aiBlockResponse(who.ctx, body, signal, { config, now: () => now })
}

async function events(res: Response, onEvent?: (e: SseEvent) => void): Promise<SseEvent[]> {
  const parser = createSseParser()
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const out: SseEvent[] = []
  for (;;) {
    const chunk = await reader.read()
    const got = chunk.done ? [...parser.push(decoder.decode()), ...parser.end()] : parser.push(decoder.decode(chunk.value, { stream: true }))
    for (const e of got) {
      out.push(e)
      onEvent?.(e)
    }
    if (chunk.done) return out
  }
}
const dataOf = <T = Record<string, unknown>>(es: readonly SseEvent[], name: string): T[] => es.filter((e) => e.event === name).map((e) => JSON.parse(e.data) as T)

const usageOf = async (ws: string) =>
  (await query<{ status: string; feature: string; page_id: string | null }>(`SELECT status, feature, page_id FROM ai_usage WHERE workspace_id = $1 ORDER BY created_at, id`, [ws]))

const blk = (type: EditorBlock['type'], text: string, extra: Partial<EditorBlock> = {}): EditorBlock => ({
  id: randomUUID(),
  type,
  title: text === '' ? [] : [textRun(text)],
  properties: {},
  format: {},
  children: [],
  ...extra,
})
const aiBlock = (properties: Record<string, unknown>, children: EditorBlock[] = []): EditorBlock => ({
  id: randomUUID(),
  type: 'ai_block',
  title: [],
  properties,
  format: {},
  children,
})
const textOf = (b: EditorBlock) => b.title.map((r) => r.plain_text).join('')

async function sourcePage(owner: Actor, title: string, blocks: EditorBlock[]): Promise<BlockId> {
  const page = (await createPage(owner.ctx, { title: titleFromPlainText(title) })).id
  const saved = await savePageBody(owner.ctx, page, { blocks })
  assert.ok(saved.ok, JSON.stringify(saved))
  return page
}

const bodyOf = async (who: Actor, page: BlockId) => (await loadPageBody(who.ctx, page))!.doc

const MEETING = [
  blk('heading_2', '주간 회의'),
  blk('paragraph', '결정: 출시는 다음 주 화요일로 한다'),
  blk('to_do', '김 대리가 배포 문서를 정리한다', { properties: { checked: false } }),
]

describe('① 만들기 — 서버가 결과를 자식으로 쓴다', () => {
  test('★ 만들기 → 자식 · 시각 · 두 해시 · 출처 ai · 행위자 · 응답 하나(block) — 다시 만들기는 자식을 간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const block = aiBlock({ kind: 'summary' })
    const page = await sourcePage(owner, '회의록', [...MEETING.map((b) => ({ ...b, id: randomUUID() })), block])
    const before = fake.requests.length

    const res = await generate(owner, { pageId: page, blockId: block.id })
    assert.equal(res.status, 200)
    const es = await events(res)
    const deltas = dataOf<{ text: string }>(es, 'delta').map((d) => d.text).join('')
    const done = dataOf<{ status: string; generatedAt: string; remaining: number }>(es, 'done')[0]!
    assert.equal(done.status, 'completed')
    assert.equal(fake.requests.length - before, 1, '공급자 호출 하나')
    assert.equal(deltas, '- 요약: 주간 회의\n- 요약: 결정: 출시는 다음 주 화요일로 한다\n- 요약: 김 대리가 배포 문서를 정리한다')

    const doc = await bodyOf(owner, page)
    const written = findBlockIn(doc.blocks, block.id)!
    assert.deepEqual(written.children!.map((c) => [c.type, textOf(c)]), [
      ['bulleted_list_item', '요약: 주간 회의'],
      ['bulleted_list_item', '요약: 결정: 출시는 다음 주 화요일로 한다'],
      ['bulleted_list_item', '요약: 김 대리가 배포 문서를 정리한다'],
    ])
    const props = written.properties as Record<string, unknown>
    assert.equal(props.kind, 'summary')
    assert.equal(props.generatedAt, done.generatedAt)
    assert.equal(props.sourceHash, aiTextHash(aiSourceText(doc)), '★ 원문 해시 = 편집기가 같은 문서에서 짓는 값')
    assert.equal(props.resultHash, aiTextHash(aiResultText(written.children!)), '★ 결과 해시 = 쓴 자식의 글')

    const usage = await usageOf(ws)
    assert.deepEqual(usage.map((u) => [u.status, u.feature, u.page_id]), [['completed', 'block', page]], '★ 응답 하나 · 기능 block')
    const last = (await query<{ origin: string; actor_id: string }>(`SELECT origin, actor_id FROM doc_update WHERE page_id = $1 ORDER BY seq DESC LIMIT 1`, [page]))[0]
    assert.deepEqual(last, { origin: 'ai', actor_id: owner.userId }, '★ 출처 ai · 행위자는 부른 사람')

    // 본문을 고치면 원문 해시가 달라진다(편집기의 "바뀌었다") → 다시 만들기는 자식을 간다
    const edited = { blocks: doc.blocks.map((b) => (b.type === 'paragraph' ? { ...b, title: [textRun('결정: 출시를 한 주 미룬다')] } : b)) }
    assert.ok((await savePageBody(owner.ctx, page, edited)).ok)
    assert.notEqual(aiTextHash(aiSourceText(await bodyOf(owner, page))), props.sourceHash)
    const again = await events(await generate(owner, { pageId: page, blockId: block.id }))
    assert.equal(dataOf(again, 'done').length, 1)
    const regenerated = findBlockIn((await bodyOf(owner, page)).blocks, block.id)!
    assert.deepEqual(regenerated.children!.map(textOf), ['요약: 주간 회의', '요약: 결정: 출시를 한 주 미룬다', '요약: 김 대리가 배포 문서를 정리한다'])
    assert.ok(regenerated.children!.every((c) => !written.children!.some((o) => o.id === c.id)), '새 결과 블록')
    assert.equal((regenerated.properties as Record<string, unknown>).sourceHash, aiTextHash(aiSourceText(await bodyOf(owner, page))))
    assert.equal((await usageOf(ws)).length, 2)
  })

  test('★ 할 일 뽑기는 할 일만 · 직접 지시는 서버 본문의 지시', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await aiWorkspace()
    const todo = aiBlock({ kind: 'action_items' })
    const custom = aiBlock({ kind: 'custom', instruction: '결정만 뽑아라' })
    const page = await sourcePage(owner, '회의록', [...MEETING.map((b) => ({ ...b, id: randomUUID() })), todo, custom])
    await events(await generate(owner, { pageId: page, blockId: todo.id }))
    // 편집기가 다른 지시를 보내도 서버 본문의 것을 쓴다
    await events(await generate(owner, { pageId: page, blockId: custom.id, kind: 'summary', instruction: '무시될 지시' }))
    const doc = await bodyOf(owner, page)
    const todos = findBlockIn(doc.blocks, todo.id)!.children!
    assert.ok(todos.length === 3 && todos.every((c) => c.type === 'to_do' && c.properties?.checked === false), JSON.stringify(todos.map((c) => c.type)))
    assert.equal(textOf(todos[2]!), '할 일: 김 대리가 배포 문서를 정리한다')
    const customKids = findBlockIn(doc.blocks, custom.id)!.children!
    assert.equal(textOf(customKids[0]!), '지시: 결정만 뽑아라')
    assert.ok(!JSON.stringify(fake.requests.at(-1)!.body).includes('무시될 지시'))
  })
})

describe('② 거부 — 부르지 않고 세지 않는다', () => {
  test('★ 보기만 · 잠긴 페이지 403 cannot_edit · 원문 부족 400 · 빈 지시 400 · 없는 블록 · 남의 페이지 404 · 꺼짐 403', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const viewer = await joinAs(ws, await createUser('AI 블록의 보는 사람'), 'member')
    const outsider = await joinAs(ws, await createUser('AI 블록의 남'), 'member')
    const block = aiBlock({ kind: 'summary' })
    const page = await sourcePage(owner, '제한된 회의록', [...MEETING.map((b) => ({ ...b, id: randomUUID() })), block])
    assert.equal((await grantAccess(owner.ctx, page, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
    assert.equal((await grantAccess(owner.ctx, page, { type: 'user', id: viewer.userId }, 'view')).ok, true)
    assert.equal((await revokeAccess(owner.ctx, page, { type: 'workspace_everyone' })).ok, true)

    const shortBlock = aiBlock({ kind: 'summary' })
    const short = await sourcePage(owner, '거의 빈 페이지', [blk('paragraph', '짧은 글'), aiBlock({ kind: 'summary' }, [blk('paragraph', '결과의 긴 글은 원문으로 세지 않는다 — 결과의 긴 글')]), shortBlock])
    const emptyCustom = aiBlock({ kind: 'custom', instruction: '   ' })
    const noInstruction = await sourcePage(owner, '지시 없음', [...MEETING.map((b) => ({ ...b, id: randomUUID() })), emptyCustom])
    const locked = await sourcePage(owner, '잠긴 회의록', [...MEETING.map((b) => ({ ...b, id: randomUUID() })), aiBlock({ kind: 'summary' })])
    const lockedBlock = (await bodyOf(owner, locked)).blocks.at(-1)!.id
    assert.equal((await setPageLock(owner.ctx, locked, true)).ok, true)
    const off = await makeFixture()
    const offBlock = aiBlock({ kind: 'summary' })
    const offPage = await sourcePage(off.owner, '꺼진 곳', [...MEETING.map((b) => ({ ...b, id: randomUUID() })), offBlock])
    const before = fake.requests.length

    const expect = async (who: Actor, body: unknown, status: number, error: string) => {
      const res = await generate(who, body)
      assert.equal(res.status, status, error)
      assert.deepEqual(await res.json(), { ok: false, error })
    }
    await expect(viewer, { pageId: page, blockId: block.id }, 403, 'cannot_edit')
    await expect(owner, { pageId: locked, blockId: lockedBlock }, 403, 'cannot_edit')
    await expect(outsider, { pageId: page, blockId: block.id }, 404, 'not_found')
    await expect(owner, { pageId: short, blockId: shortBlock.id }, 400, 'not_enough_content')
    await expect(owner, { pageId: noInstruction, blockId: emptyCustom.id }, 400, 'instruction_missing')
    await expect(owner, { pageId: page, blockId: randomUUID() }, 404, 'not_found')
    await expect(owner, { pageId: page, blockId: (await bodyOf(owner, page)).blocks[0]!.id }, 404, 'not_found')
    await expect(owner, { pageId: page }, 400, 'invalid_input')
    await expect(off.owner, { pageId: offPage, blockId: offBlock.id }, 403, 'ai_disabled')
    assert.equal(fake.requests.length, before, '★ 공급자를 부르지 않았다')
    assert.deepEqual(await usageOf(ws), [], '★ 세지 않았다')
  })
})

describe('③ 문맥 — AI 블록을 모두 뺀다', () => {
  test('★ 자기 · 다른 AI 블록 · 그 결과를 싣지 않는다 — 가짜 공급자의 [echo] 가 받은 메시지를 되돌린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await aiWorkspace()
    const self = aiBlock({ kind: 'summary' }, [blk('paragraph', '내 옛 결과 비밀')])
    const other = aiBlock({ kind: 'action_items' }, [blk('to_do', '남의 결과 비밀', { children: [blk('paragraph', '남의 결과의 자식 비밀')] })])
    const page = await sourcePage(owner, '문맥 시험', [
      blk('paragraph', '[echo] 이 페이지의 원문 첫 줄입니다'),
      self,
      blk('bulleted_list_item', '목록 항목', { children: [other] }),
      blk('paragraph', '원문 마지막 줄입니다'),
    ])
    await events(await generate(owner, { pageId: page, blockId: self.id }))
    const sent = JSON.stringify(fake.requests.at(-1)!.body.messages)
    assert.ok(sent.includes('이 페이지의 원문 첫 줄입니다') && sent.includes('원문 마지막 줄입니다') && sent.includes('Title: 문맥 시험'))
    assert.ok(!sent.includes('비밀'), '★ 어느 AI 블록의 결과도 보내지 않는다')
  })
})

describe('④ 멈춤 · 복제 · 검색', () => {
  test('★ 멈추면 쓰지 않는다 — stopped(셈에 든다) · 전의 결과 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const block = aiBlock({ kind: 'summary' }, [blk('paragraph', '전의 결과')])
    const page = await sourcePage(owner, '멈춤', [blk('paragraph', '[slow] 천천히 답하는 페이지의 원문 글입니다 — 서른 글자를 넘긴다'), block])
    const stop = new AbortController()
    const res = await generate(owner, { pageId: page, blockId: block.id }, stop.signal)
    let seen = 0
    await events(res, (e) => {
      if (e.event === 'delta' && (seen += 1) === 2) stop.abort()
    })
    const usage = await usageOf(ws)
    assert.deepEqual(usage.map((u) => u.status), ['stopped'])
    assert.deepEqual(findBlockIn((await bodyOf(owner, page)).blocks, block.id)!.children!.map(textOf), ['전의 결과'])
  })

  test('★ 복제는 AI 블록을 결과째 옮긴다 · 검색은 결과의 글을 찾는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await aiWorkspace()
    // 지시는 블록의 속성이라 색인하지 않는다 — 찾는 낱말은 결과(자식)에만 있다
    const block = aiBlock({ kind: 'custom', instruction: '파란하늘결론' })
    const page = await sourcePage(owner, '복제 원본', [blk('paragraph', '보라색코끼리 회의에서 정한 것들을 여기에 차례대로 적어 둔 글입니다'), block])
    assert.equal(dataOf(await events(await generate(owner, { pageId: page, blockId: block.id })), 'done').length, 1)
    const original = findBlockIn((await bodyOf(owner, page)).blocks, block.id)!
    assert.equal(textOf(original.children![0]!), '지시: 파란하늘결론')

    const copy = await duplicatePage(owner.ctx, page)
    const copied = (await bodyOf(owner, copy.page.id)).blocks.find((b) => b.type === 'ai_block')!
    assert.notEqual(copied.id, block.id)
    assert.deepEqual(copied.properties, original.properties, '속성 그대로(지시 · 시각 · 해시)')
    assert.deepEqual(copied.children!.map(textOf), original.children!.map(textOf), '결과 그대로')

    const out = await searchPages(owner.ctx, { query: '파란하늘결론' })
    assert.ok(out.ok, JSON.stringify(out))
    const hits = out.results.results.map((r) => r.pageId)
    assert.ok(hits.includes(page), `★ 결과의 글(자식)로 그 페이지를 찾는다 — ${JSON.stringify(hits)}`)
  })
})
