/**
 * 페이지 번역 — 미리 보기 · 거부 · 새 하위 페이지 · 청크마다 예약 · 본문 쓰기 (AI-4 · F-10-03 · F-10-12 · DB · 진짜 공급자를 부르지 않는다)
 *
 *   ① 번역 — 새 하위 페이지(제목 · 같은 구조 · 서식 · 링크 · 멘션 · 체크 · 코드 · 수식) · 원본 그대로 · 출처 ai · 행위자 · 청크마다 응답 하나
 *   ② 거부 — 보기 · 코멘트 · 남 · 꺼짐 · 게스트 · 빈 페이지 · 모양 · 남은 응답 부족 — 공급자를 부르지 않고 페이지를 만들지 않는다
 *   ③ 도중에 멈춤 — 한도 · 공급자 실패 · 사람이 끊음 → 번역한 데까지 + 나머지 원문 + 맨 위 콜아웃 · 실패한 청크는 세지 않는다
 *   ④ 바쁨 — 기다려 다시(한 번 바쁘면 이어 간다 · 늘 바쁘면 두 번 다시 뒤 멈춘다)
 *   ⑤ 틀린 답 — 빠진 열쇠 · 틀린 표지 · JSON 아님 → 원문을 두고 건너뜀으로 센다
 *
 * 환경(AI_BASE_URL · AI_API_KEY · AI_MODEL)은 가짜 공급자를 가리킨다 — `.env` 에 진짜 키가 있어도 닿지 않는다.
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createPage, getPage, listChildPages, titleFromPlainText } from '../block/page.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { DOC_ORIGINS } from '../collab/doc-store.ts'
import { textRun, userMentionRun, type RichTextRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import type { EditorBlock } from '../editor/document.ts'
import { asBlockId, type BlockId, type WorkspaceId } from '../ids.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import type { Level } from '../permissions/levels.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { FAKE_AI_KEY, FAKE_AI_MODEL, startFakeAiProvider, type FakeAiProvider } from '../testing/fake-ai-provider.ts'
import { readAiConfig, type AiConfig } from './config.ts'
import { createSseParser, type SseEvent } from './sse.ts'
import { aiTranslateEstimate, aiTranslateResponse } from './translate-http.ts'
import { reserveAiResponse, setAiEnabled } from './usage.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''
let fake: FakeAiProvider
let config: AiConfig
/** 단위 하나가 청크 하나 — 14자 이하의 단위는 혼자 들고(20 × 0.9 = 18 토큰), 둘은 묶음 몫(12)을 넘는다. */
let onePerChunk: AiConfig

before(async () => {
  fake = await startFakeAiProvider()
  process.env.AI_BASE_URL = fake.baseUrl
  process.env.AI_API_KEY = FAKE_AI_KEY
  process.env.AI_MODEL = FAKE_AI_MODEL
  process.env.AI_DAILY_CAP = '10000000'
  config = readAiConfig()!
  onePerChunk = { ...config, maxOutputTokens: 20 }
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

type CallOptions = { config?: AiConfig | null; now?: Date; signal?: AbortSignal; onEvent?: (e: SseEvent) => void }

const translate = (who: Actor, body: unknown, options: CallOptions = {}) => {
  const now = options.now ?? farDay()
  return aiTranslateResponse(who.ctx, body, options.signal ?? new AbortController().signal, {
    ...(options.config === undefined ? { config } : { config: options.config }),
    now: () => now,
    sleep: async (_ms, signal) => !signal.aborted,
  })
}

/** SSE 를 끝까지 읽는다 — 사건마다 `onEvent`(읽는 동안 끊기를 볼 때). */
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

type Done = {
  status: string
  pageId: string
  translated: number
  skipped: number
  untranslated: number
  done: number
  total: number
  failedFrom?: number
  reason?: string
  limit?: string
  remaining: number | null
}

const usageOf = async (ws: string) =>
  (await query<{ status: string; feature: string; page_id: string | null }>(`SELECT status, feature, page_id FROM ai_usage WHERE workspace_id = $1`, [ws])).map(
    (r) => r.status,
  ).sort()
const counted = async (ws: string) => Number((await query<{ n: string }>(`SELECT count(*) AS n FROM ai_usage WHERE workspace_id = $1 AND status <> 'failed'`, [ws]))[0]?.n)

const blk = (type: EditorBlock['type'], title: RichTextRun[], extra: Partial<EditorBlock> = {}): EditorBlock => ({
  id: randomUUID(),
  type,
  title,
  properties: {},
  format: {},
  children: [],
  ...extra,
})
const textOf = (b: EditorBlock) => b.title.map((r) => r.plain_text).join('')
const shape = (blocks: readonly EditorBlock[]): unknown[] => blocks.map((b) => [b.type, b.properties?.checked ?? null, shape(b.children ?? [])])

/** 원본 페이지 — 짧은 단위만(한 단위 = 한 청크로 나눌 수 있게). */
async function sourcePage(owner: Actor, title: string, blocks: EditorBlock[]): Promise<BlockId> {
  const page = (await createPage(owner.ctx, { title: titleFromPlainText(title) })).id
  const saved = await savePageBody(owner.ctx, page, { blocks })
  assert.ok(saved.ok, JSON.stringify(saved))
  return page
}

const childrenOf = async (owner: Actor, page: BlockId) => (await listChildPages(owner.ctx, page)).map((p) => p.id)

describe('① 번역 — 새 하위 페이지 · 같은 구조 · 원본 그대로', () => {
  test('★ 미리 보기는 청크 수 · 남은 응답 — 부르지 않는다 · 번역은 청크마다 응답 하나 · 출처 ai · 행위자는 부른 사람', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const toggleChild = blk('paragraph', [textRun('토글 안의 글')])
    const blocks = [
      blk('heading_1', [textRun('회의록')]),
      blk('paragraph', [
        textRun('굵은 글', { bold: true }),
        textRun(' 그리고 '),
        { ...textRun('링크'), href: 'https://example.com/x', text: { content: '링크', link: { url: 'https://example.com/x' } } },
        textRun(' 담당 '),
        userMentionRun(owner.userId),
      ]),
      blk('to_do', [textRun('끝낸 일')], { properties: { checked: true } }),
      blk('code', [textRun('const a = 1 // 한국어 주석')], { properties: { language: 'javascript' } }),
      blk('equation', [], { properties: { expression: 'x^2' } }),
      blk('toggle', [textRun('펼치기')], { children: [toggleChild] }),
    ]
    const page = await sourcePage(owner, '번역 원본', blocks)
    const sub = (await createPage(owner.ctx, { parentPageId: page, title: titleFromPlainText('하위 페이지') })).id
    const original = (await loadPageBody(owner.ctx, page))!.doc
    const requestsBefore = fake.requests.length

    // 출력 상한 40 — 묶음 몫 24 · 혼자 36: [제목 12 + 회의록 11] [문단 33] [끝낸 일 11 + 펼치기 11] [토글 안 13]
    const small = { ...config, maxOutputTokens: 40 }
    const estimate = await aiTranslateEstimate(owner.ctx, { pageId: page, language: 'en' }, { config: small })
    const est = (await estimate.json()) as { ok: boolean; chunks: number; units: number; remaining: number }
    assert.deepEqual([est.ok, est.units, est.chunks, est.remaining], [true, 6, 4, 20], '제목 + 본문 다섯 단위 · 네 청크 · 체험 20')
    assert.equal(fake.requests.length, requestsBefore, '미리 보기는 부르지 않는다')
    assert.equal(await counted(ws), 0)

    const res = await translate(owner, { pageId: page, language: 'en' }, { config: small })
    assert.equal(res.status, 200)
    const es = await events(res)
    const progress = dataOf<{ done: number; total: number; pageId: string }>(es, 'progress')
    assert.deepEqual(progress.map((p) => p.done), [0, 1, 2, 3, 4], '청크마다 진행')
    const done = dataOf<Done>(es, 'done')[0]!
    assert.deepEqual([done.status, done.translated, done.skipped, done.untranslated, done.done, done.total, done.remaining], ['completed', 6, 0, 0, 4, 4, 16])
    assert.equal(fake.requests.length - requestsBefore, 4, '청크 하나 = 공급자 호출 하나')
    assert.deepEqual(await usageOf(ws), Array(4).fill('completed'))
    const rows = await query<{ feature: string; page_id: string }>(`SELECT feature, page_id FROM ai_usage WHERE workspace_id = $1`, [ws])
    assert.ok(rows.every((r) => r.feature === 'translate' && r.page_id === page), '기능 translate · 원본 페이지')

    // 새 하위 페이지 — 원본 아래 · 제목 · 같은 구조
    const translated = asBlockId(done.pageId)
    assert.equal(progress[0]!.pageId, translated, '시작할 때 이미 만들었다')
    assert.deepEqual(await childrenOf(owner, page), [sub, translated])
    const detail = (await getPage(owner.ctx, translated))!
    assert.equal(detail.plainTitle, '[EN] 번역 원본 (English)')
    const body = (await loadPageBody(owner.ctx, translated))!.doc.blocks
    assert.deepEqual(shape(body), shape(original.blocks).map((s, i) => (original.blocks[i]!.type === 'page' ? ['paragraph', null, []] : s)))
    assert.equal(textOf(body[0]!), '[EN] 회의록')
    const para = body[1]!.title
    assert.equal(para.find((r) => r.plain_text.includes('굵은'))?.annotations.bold, true, '굵게 그대로')
    assert.equal(para.find((r) => r.plain_text === '링크')?.text?.link?.url, 'https://example.com/x', '링크 주소 그대로')
    assert.deepEqual(para.find((r) => r.type === 'mention')?.mention, { type: 'user', user: { id: owner.userId } }, '멘션 대상 그대로')
    assert.equal(body[2]!.properties?.checked, true, '체크 그대로')
    assert.deepEqual([textOf(body[3]!), body[3]!.properties?.language], ['const a = 1 // 한국어 주석', 'javascript'], '코드는 번역하지 않는다')
    assert.equal(body[4]!.properties?.expression, 'x^2', '수식 그대로')
    assert.equal(textOf(body[5]!.children![0]!), '[EN] 토글 안의 글', '안쪽까지')
    assert.deepEqual(body[6]!.title[0]!.mention, { type: 'page', page: { id: sub } }, '하위 페이지는 원래 페이지의 멘션')
    const originalIds = new Set(original.blocks.map((b) => b.id))
    assert.ok(body.every((b) => !originalIds.has(b.id)), '새 블록 id')

    // 원본은 그대로(번역본의 참조 한 줄만 더해졌다)
    const after = (await loadPageBody(owner.ctx, page))!.doc.blocks
    assert.deepEqual(after.slice(0, -1), original.blocks)
    assert.deepEqual([after.at(-1)!.type, after.at(-1)!.id], ['page', translated])

    const last = (await query<{ origin: string; actor_id: string }>(`SELECT origin, actor_id FROM doc_update WHERE page_id = $1 ORDER BY seq DESC LIMIT 1`, [translated]))[0]
    assert.deepEqual(last, { origin: 'ai', actor_id: owner.userId }, '★ 출처 ai · 행위자는 부른 사람')
  })

  test('★ 본문 쓰기의 출처 목록이 DB 의 CHECK 와 같다(0147 · ai 포함)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const def = (await query<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'doc_update_origin_check' AND conrelid = 'doc_update'::regclass`))[0]!.def
    const inDb = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort()
    assert.deepEqual(inDb, [...DOC_ORIGINS].sort())
    assert.ok(DOC_ORIGINS.includes('ai'))
  })
})

describe('② 거부 — 부르지 않고 만들지 않는다', () => {
  async function restrict(owner: Actor, pageId: string, grants: readonly [Actor, Level][]): Promise<void> {
    assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
    for (const [actor, level] of grants) assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: actor.userId }, level)).ok, true)
    assert.equal((await revokeAccess(owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
  }

  test('★ 보기 · 코멘트 403 cannot_create · 남 404 · 게스트 403 · 꺼짐 403 · 빈 페이지 400 · 모양 400 — 공급자 · 예약 · 새 페이지 없음', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const viewer = await joinAs(ws, await createUser('번역의 보는 사람'), 'member')
    const commenter = await joinAs(ws, await createUser('번역의 코멘트하는 사람'), 'member')
    const outsider = await joinAs(ws, await createUser('번역의 남'), 'member')
    const guest = await joinAs(ws, await createUser('번역의 손님'), 'guest')
    const page = await sourcePage(owner, '제한된 원본', [blk('paragraph', [textRun('번역할 글')])])
    await restrict(owner, page, [[viewer, 'view'], [commenter, 'comment']])
    const empty = await sourcePage(owner, '제목만 있는 페이지', [blk('paragraph', []), blk('divider', [])])
    const off = await makeFixture()
    const offPage = await sourcePage(off.owner, '꺼진 곳', [blk('paragraph', [textRun('글')])])
    const before = fake.requests.length

    const expect = async (who: Actor, body: unknown, status: number, error: string) => {
      for (const call of [() => translate(who, body), () => aiTranslateEstimate(who.ctx, body, { config })]) {
        const res = await call()
        assert.equal(res.status, status, error)
        assert.deepEqual(await res.json(), { ok: false, error })
      }
    }
    await expect(viewer, { pageId: page, language: 'en' }, 403, 'cannot_create')
    await expect(commenter, { pageId: page, language: 'en' }, 403, 'cannot_create')
    await expect(outsider, { pageId: page, language: 'en' }, 404, 'not_found')
    await expect(guest, { pageId: page, language: 'en' }, 403, 'forbidden')
    await expect(off.owner, { pageId: offPage, language: 'en' }, 403, 'ai_disabled')
    await expect(owner, { pageId: empty, language: 'en' }, 400, 'empty_page')
    await expect(owner, { pageId: page, language: 'klingon' }, 400, 'invalid_input')
    await expect(owner, { pageId: 'not-a-uuid', language: 'en' }, 400, 'invalid_input')
    const none = await aiTranslateResponse(owner.ctx, { pageId: page, language: 'en' }, new AbortController().signal, { config: null })
    assert.deepEqual([none.status, await none.json()], [503, { ok: false, error: 'ai_unavailable' }])
    assert.equal(fake.requests.length, before, '공급자를 부르지 않았다')
    assert.equal(await counted(ws), 0, '세지 않는다')
    assert.deepEqual(await childrenOf(owner, page), [], '번역본을 만들지 않았다')
    assert.deepEqual(await childrenOf(owner, empty), [])
  })

  test('★ 남은 응답이 청크 수보다 적으면 시작하지 않는다 — 429 not_enough_quota · 필요 · 남은 수', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const page = await sourcePage(owner, '원본', [blk('paragraph', [textRun('하나')]), blk('paragraph', [textRun('둘')])])
    const now = farDay()
    for (let i = 0; i < 19; i += 1) assert.ok((await reserveAiResponse(owner.ctx, { feature: 'ask' }, { config, now })).ok)
    const before = fake.requests.length
    const res = await translate(owner, { pageId: page, language: 'ja' }, { config: onePerChunk, now })
    assert.equal(res.status, 429)
    assert.deepEqual(await res.json(), { ok: false, error: 'not_enough_quota', needed: 3, remaining: 1 })
    assert.equal(fake.requests.length, before)
    assert.equal(await counted(ws), 19)
    assert.deepEqual(await childrenOf(owner, page), [])
  })
})

describe('③ 도중에 멈춤 — 번역한 데까지 + 나머지 원문 + 콜아웃', () => {
  const notice = (blocks: readonly EditorBlock[]) => (blocks[0]?.type === 'callout' ? textOf(blocks[0]) : null)

  test('★ 한도(앱 전체 하루)에 닿으면 멈춘다 — 두 청크 번역 · 셋째부터 원문 · 맨 위 콜아웃 · 응답 둘만 셌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const page = await sourcePage(owner, '원본', [blk('paragraph', [textRun('첫째')]), blk('paragraph', [textRun('둘째')]), blk('paragraph', [textRun('셋째')])])
    const res = await translate(owner, { pageId: page, language: 'en' }, { config: { ...onePerChunk, dailyCap: 2 } })
    const es = await events(res)
    const done = dataOf<Done>(es, 'done')[0]!
    assert.deepEqual([done.status, done.done, done.total, done.failedFrom, done.reason, done.limit, done.translated, done.untranslated], ['partial', 2, 4, 2, 'limit', 'daily', 2, 2])
    const body = (await loadPageBody(owner.ctx, asBlockId(done.pageId)))!.doc.blocks
    assert.equal(notice(body), '번역이 2/4 에서 멈췄습니다 — AI 한도에 닿았습니다. 나머지는 원문 그대로입니다.')
    assert.deepEqual(body.slice(1).map(textOf), ['[EN] 첫째', '둘째', '셋째'], '제목 · 첫째가 두 청크 · 나머지는 원문')
    assert.equal((await getPage(owner.ctx, asBlockId(done.pageId)))!.plainTitle, '[EN] 원본 (English)')
    assert.deepEqual(await usageOf(ws), ['completed', 'completed'])
  })

  test('★ 공급자가 실패하면 멈춘다 — 그 청크는 failed(세지 않는다) · 까닭의 콜아웃', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const page = await sourcePage(owner, '원본', [blk('paragraph', [textRun('첫째')]), blk('paragraph', [textRun('가[500]')]), blk('paragraph', [textRun('셋째')])])
    const done = dataOf<Done>(await events(await translate(owner, { pageId: page, language: 'en' }, { config: onePerChunk })), 'done')[0]!
    assert.deepEqual([done.status, done.done, done.failedFrom, done.reason], ['partial', 2, 2, 'provider'])
    const body = (await loadPageBody(owner.ctx, asBlockId(done.pageId)))!.doc.blocks
    assert.equal(notice(body), '번역이 2/4 에서 멈췄습니다 — AI 서비스가 답하지 못했습니다. 나머지는 원문 그대로입니다.')
    assert.deepEqual(body.slice(1).map(textOf), ['[EN] 첫째', '가[500]', '셋째'])
    assert.deepEqual(await usageOf(ws), ['completed', 'completed', 'failed'])
    assert.equal(await counted(ws), 2)
  })

  test('★ 사람이 끊으면 흐르던 청크는 stopped(셈에 든다) · 거기까지로 번역본을 쓴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const page = await sourcePage(owner, '원본', [blk('paragraph', [textRun('첫째')]), blk('paragraph', [textRun('[slow]')]), blk('paragraph', [textRun('셋째')])])
    const abort = new AbortController()
    const res = await translate(owner, { pageId: page, language: 'en' }, { config: onePerChunk, signal: abort.signal })
    const es = await events(res, (e) => {
      if (e.event === 'progress' && (JSON.parse(e.data) as { done: number }).done === 2) setTimeout(() => abort.abort(), 300)
    })
    const done = dataOf<Done>(es, 'done')[0]!
    assert.deepEqual([done.status, done.done, done.failedFrom, done.reason], ['partial', 2, 2, 'stopped'])
    const body = (await loadPageBody(owner.ctx, asBlockId(done.pageId)))!.doc.blocks
    assert.equal(notice(body), '번역이 2/4 에서 멈췄습니다 — 번역을 취소했습니다. 나머지는 원문 그대로입니다.')
    assert.deepEqual(body.slice(1).map(textOf), ['[EN] 첫째', '[slow]', '셋째'])
    assert.deepEqual(await usageOf(ws), ['completed', 'completed', 'stopped'], '흐르던 청크는 stopped')
    assert.ok(fake.requests.at(-1)!.closedEarly, '공급자 연결도 닫았다')
  })
})

describe('④ 바쁨 — 기다려 다시', () => {
  test('★ 한 번 바쁘면 기다렸다 같은 청크를 다시 보내 이어 간다(바쁜 응답은 failed · 세지 않는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const page = await sourcePage(owner, '원본', [blk('paragraph', [textRun(`가[429once]${Date.now() % 1000}`)])])
    const es = await events(await translate(owner, { pageId: page, language: 'de' }, { config }))
    assert.deepEqual(dataOf<{ seconds: number }>(es, 'wait'), [{ seconds: 1 }], 'Retry-After 만큼 기다린다')
    const done = dataOf<Done>(es, 'done')[0]!
    assert.deepEqual([done.status, done.translated, done.skipped], ['completed', 2, 0])
    const body = (await loadPageBody(owner.ctx, asBlockId(done.pageId)))!.doc.blocks
    assert.match(textOf(body[0]!), /^\[DE\] 가\[429once\]/)
    assert.deepEqual(await usageOf(ws), ['completed', 'failed'])
  })

  test('늘 바쁘면 두 번 다시 보낸 뒤 멈춘다(busy) — 세 응답 모두 failed', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const page = await sourcePage(owner, '원본', [blk('paragraph', [textRun('늘 [429]')])])
    const es = await events(await translate(owner, { pageId: page, language: 'en' }, { config }))
    assert.equal(dataOf(es, 'wait').length, 2)
    const done = dataOf<Done>(es, 'done')[0]!
    assert.deepEqual([done.status, done.reason, done.done, done.total], ['partial', 'busy', 0, 1])
    assert.deepEqual(await usageOf(ws), ['failed', 'failed', 'failed'])
    const body = (await loadPageBody(owner.ctx, asBlockId(done.pageId)))!.doc.blocks
    assert.equal(textOf(body[0]!), '번역이 0/1 에서 멈췄습니다 — AI 서비스가 바빴습니다. 나머지는 원문 그대로입니다.')
    assert.equal(textOf(body[1]!), '늘 [429]')
  })
})

describe('⑤ 틀린 답 — 원문을 두고 건너뜀', () => {
  test('★ 빠진 열쇠 · 틀린 표지는 그 단위만 원문 · JSON 이 아니면 그 청크 전체가 원문 — 건너뜀으로 센다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await aiWorkspace()
    const page = await sourcePage(owner, '원본', [
      blk('paragraph', [textRun('좋은 글')]),
      blk('paragraph', [textRun('빠짐 [dropkey]')]),
      blk('paragraph', [textRun('굵게', { bold: true }), textRun(' [badtag]')]),
    ])
    const done = dataOf<Done>(await events(await translate(owner, { pageId: page, language: 'en' }, { config })), 'done')[0]!
    assert.deepEqual([done.status, done.translated, done.skipped, done.total], ['completed', 2, 2, 1])
    const body = (await loadPageBody(owner.ctx, asBlockId(done.pageId)))!.doc.blocks
    assert.deepEqual(body.map(textOf), ['[EN] 좋은 글', '빠짐 [dropkey]', '굵게 [badtag]'])
    assert.equal(body[2]!.title[0]!.annotations.bold, true, '원문은 서식째')

    const bad = await sourcePage(owner, '원본 둘', [blk('paragraph', [textRun('[badjson] 글')])])
    const d2 = dataOf<Done>(await events(await translate(owner, { pageId: bad, language: 'en' }, { config })), 'done')[0]!
    assert.deepEqual([d2.status, d2.translated, d2.skipped], ['completed', 0, 2])
    assert.equal((await getPage(owner.ctx, asBlockId(d2.pageId)))!.plainTitle, '원본 둘 (English)', '제목도 원문 + 언어')
  })
})
