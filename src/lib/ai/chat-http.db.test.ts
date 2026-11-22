/**
 * AI 채팅의 한 턴 · 대화 · 내 AI 지시 — 게이트 → 문맥 → 가짜 공급자 → 저장 · SSE (AI-6 · F-10-17 · F-10-22 · DB · 진짜 공급자를 부르지 않는다)
 *
 *   ① 첫 턴 — session 사건이 먼저 · 조각 · done 의 출처 · 대화(제목 = 첫 질문) · 질문 · 답(completed · 토큰 · 원장의 응답) · 원장 한 줄(chat)
 *   ② 이어 가기 — 공급자가 앞선 턴을 받는다(user · assistant) · 제목은 그대로 · 턴마다 원장 한 줄
 *   ③ 그 사람만의 것 — 남의 대화는 목록 · 열기 · 이름 · 지우기 · 이어 가기 모두 없는 것(404) · 공급자를 부르지 않고 세지 않는다
 *   ④ 지우기 — 메시지가 함께 없어진다 · 원장은 남는다 · 이름 바꾸기
 *   ⑤ 멈추기 · 실패 — 멈추면 stopped(셈에 든다 · 받은 데까지) · 도중 실패는 failed(셈에서 빠진다) · 처음부터 거절이면 아무것도 적지 않는다
 *   ⑥ 출처 — 앱의 검색(권한 필터) · 볼 수 없는 페이지는 같은 낱말이 있어도 출처 · 공급자의 글 어디에도 없다
 *   ⑦ 페이지 범위 — 볼 수 있어야 한다(아니면 404 · 셈에서 빠진다) · 그 페이지의 원문이 실린다 · 원장의 page_id
 *   ⑧ 내 AI 지시 — 정하면 따로 감싸 실린다 · 볼 수 없게 되면 빠진다(설정은 unavailable) · 다른 사람이 고칠 수 있으면 경고 수 · 새 페이지로
 *      만들기(개인 · 틀 · 경고 없음) · 출처에서 뺀다
 *   ⑨ 거부 — 꺼짐 · 게스트 · 모양 · 긴 글 · 게스트는 대화를 읽지 못한다
 *   ⑩ 계정 삭제 — 그 사람의 대화 · 지시를 지운다(원장은 남는다)
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { deleteAccount } from '../auth/account-deletion.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import type { EditorBlock } from '../editor/document.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { FAKE_AI_KEY, FAKE_AI_MODEL, fakeAnswer, startFakeAiProvider, type FakeAiProvider } from '../testing/fake-ai-provider.ts'
import { aiChatResponse } from './chat-http.ts'
import { CHAT_SYSTEM_PROMPT } from './chat-prompt.ts'
import {
  AI_INSTRUCTIONS_TEMPLATE,
  aiInstructionsViewFor,
  createAiInstructionsPage,
  deleteChatSession,
  getChatSession,
  listChatSessions,
  renameChatSession,
  setAiInstructionsPage,
} from './chat-store.ts'
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
  assert.equal(config.baseUrl, fake.baseUrl, '환경이 가짜 공급자를 가리킨다')
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

const farDay = (): Date =>
  new Date(Date.UTC(2200 + Math.floor(Math.random() * 700), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28), 10))

const call = (who: Actor, body: unknown, signal: AbortSignal = new AbortController().signal) => {
  const now = farDay()
  return aiChatResponse(who.ctx, body, signal, { config, now: () => now })
}

async function events(res: Response): Promise<SseEvent[]> {
  const parser = createSseParser()
  return [...parser.push(await res.text()), ...parser.end()]
}
const deltas = (es: SseEvent[]) => es.filter((e) => e.event === 'delta').map((e) => (JSON.parse(e.data) as { text: string }).text).join('')
const dataOf = (es: SseEvent[], name: string) => {
  const e = es.find((x) => x.event === name)
  return e === undefined ? null : (JSON.parse(e.data) as Record<string, unknown>)
}
/** 공급자가 마지막으로 받은 메시지. */
const lastSent = () => fake.requests.at(-1)!.body.messages as { role: string; content: string }[]
const sentText = () => lastSent().map((m) => m.content).join('\n')

const b = (type: EditorBlock['type'], text: string): EditorBlock => ({ id: randomUUID(), type, title: [textRun(text)], properties: {}, format: {}, children: [] })

/** 페이지 하나 — 워크스페이스 최상위(멤버 모두 본다) 또는 만든 사람의 개인 페이지 · 본문(검색 색인도 함께 쓴다). */
async function pageWith(who: Actor, title: string, lines: string[], privateTop = false): Promise<string> {
  const id = (await createPage(who.ctx, { privateTop, title: titleFromPlainText(title) })).id
  const saved = await savePageBody(who.ctx, id, { blocks: lines.map((l) => b('paragraph', l)) })
  assert.ok(saved.ok, JSON.stringify(saved))
  return id
}

async function aiWorkspace() {
  const fx = await makeFixture()
  assert.ok((await setAiEnabled(fx.owner.ctx, true)).ok)
  const member = await joinAs(fx.workspaceId, await createUser('채팅의 멤버'), 'member')
  return { ws: fx.workspaceId, owner: fx.owner, member }
}

const usageRows = async (ws: string) =>
  query<{ id: string; feature: string; status: string; page_id: string | null; user_id: string }>(
    `SELECT id, feature, status, page_id, user_id FROM ai_usage WHERE workspace_id = $1 ORDER BY created_at, finished_at`,
    [ws],
  )
const messagesOf = async (sessionId: string) =>
  query<{ role: string; content: string; status: string | null; usage_id: string | null; input_tokens: number | null; output_tokens: number | null; sources: unknown }>(
    `SELECT role, content, status, usage_id, input_tokens, output_tokens, sources FROM ai_chat_message WHERE session_id = $1 ORDER BY seq`,
    [sessionId],
  )

describe('① · ② 첫 턴 · 이어 가기', () => {
  test('★ 첫 턴 — session 이 먼저 · 조각 · done 의 출처 · 대화 · 질문 · 답(completed · 토큰 · 원장) · 원장 한 줄(chat)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await aiWorkspace()
    const plan = await pageWith(owner, '알파 출시 계획', ['알파의 마감은 12월 3일', '담당은 김 대리'])
    const res = await call(member, { message: '알파 마감은 언제인가요?\n자세히' })
    assert.equal(res.status, 200)
    const es = await events(res)
    assert.equal(es[0]!.event, 'session', 'session 사건이 맨 먼저')
    const opened = JSON.parse(es[0]!.data) as { sessionId: string; title: string; created: boolean }
    assert.deepEqual([opened.title, opened.created], ['알파 마감은 언제인가요?', true])
    assert.equal(deltas(es), fakeAnswer('알파 마감은 언제인가요?\n자세히'))
    const done = dataOf(es, 'done')!
    assert.equal(done.status, 'completed')
    assert.deepEqual(done.sources, [{ n: 1, pageId: plan, title: '알파 출시 계획', cited: false }])
    assert.equal(done.remaining, 19)
    // 공급자가 받은 것 — 지시 · 출처 · 질문
    const sent = lastSent()
    assert.equal(sent[0]!.content, CHAT_SYSTEM_PROMPT)
    assert.ok(sentText().includes('[1] 알파 출시 계획\n알파의 마감은 12월 3일'), sentText())
    assert.equal(sent.at(-1)!.content, '알파 마감은 언제인가요?\n자세히')
    // 저장
    const listed = await listChatSessions(member.ctx)
    assert.deepEqual(listed.map((s) => [s.id, s.title, s.scope.kind]), [[opened.sessionId, '알파 마감은 언제인가요?', 'workspace']])
    const usage = await usageRows(ws)
    assert.deepEqual(usage.map((u) => [u.feature, u.status, u.page_id, u.user_id]), [['chat', 'completed', null, member.userId]])
    const msgs = await messagesOf(opened.sessionId)
    assert.deepEqual(msgs.map((m) => [m.role, m.status]), [['user', null], ['assistant', 'completed']])
    assert.equal(msgs[1]!.content, fakeAnswer('알파 마감은 언제인가요?\n자세히'))
    assert.equal(msgs[1]!.usage_id, usage[0]!.id, '답은 원장의 그 응답을 가리킨다')
    assert.ok((msgs[1]!.output_tokens ?? 0) > 0 && (msgs[1]!.input_tokens ?? 0) > 0)
    assert.deepEqual(msgs[1]!.sources, [{ n: 1, pageId: plan, title: '알파 출시 계획', cited: false }])
    const view = await getChatSession(member.ctx, opened.sessionId)
    assert.ok(view !== null && view.messages.length === 2 && view.messages[1]!.sources[0]!.viewable === true)
  })

  test('★ 이어 가기 — 공급자가 앞선 턴(user · assistant)을 받는다 · 제목 그대로 · 턴마다 원장 한 줄 · 실패한 답은 앞선 턴에 싣지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, member } = await aiWorkspace()
    const first = await events(await call(member, { message: '첫 질문' }))
    const sessionId = (dataOf(first, 'session') as { sessionId: string }).sessionId
    await events(await call(member, { sessionId, message: '[midfail] 실패할 질문' }))
    const second = await events(await call(member, { sessionId, message: '둘째 질문' }))
    assert.equal((dataOf(second, 'session') as { created: boolean; title: string }).created, false)
    assert.equal((dataOf(second, 'session') as { title: string }).title, '첫 질문')
    const sent = lastSent()
    assert.deepEqual(
      sent.filter((m) => m.role !== 'system' && !m.content.startsWith('Sources')).map((m) => [m.role, m.content]),
      [['user', '첫 질문'], ['assistant', fakeAnswer('첫 질문')], ['user', '둘째 질문']],
      '실패한 턴은 빠진다',
    )
    // 호출마다 시각이 먼 다른 날이라 차례 없이 견준다
    assert.deepEqual((await usageRows(ws)).map((u) => `${u.feature}:${u.status}`).sort(), ['chat:completed', 'chat:completed', 'chat:failed'])
    assert.equal((await messagesOf(sessionId)).length, 6)
  })
})

describe('③ · ④ 그 사람만의 것 · 지우기', () => {
  test('★ 남의 대화 — 목록 · 열기 · 이름 · 지우기 · 이어 가기 모두 없는 것(404) · 공급자를 부르지 않고 세지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await aiWorkspace()
    const mine = (dataOf(await events(await call(member, { message: '내 비밀 질문' })), 'session') as { sessionId: string }).sessionId
    await events(await call(owner, { message: '소유자의 질문' }))
    assert.deepEqual((await listChatSessions(member.ctx)).map((s) => s.title), ['내 비밀 질문'])
    assert.deepEqual((await listChatSessions(owner.ctx)).map((s) => s.title), ['소유자의 질문'], '소유자도 남의 대화를 보지 않는다')
    assert.equal(await getChatSession(owner.ctx, mine), null)
    assert.deepEqual(await renameChatSession(owner.ctx, mine, '가로채기'), { ok: false, reason: 'not_found' })
    assert.equal(await deleteChatSession(owner.ctx, mine), false)
    const before = fake.requests.length
    const usedBefore = (await usageRows(ws)).length
    const res = await call(owner, { sessionId: mine, message: '이어 쓰기' })
    assert.equal(res.status, 404)
    assert.equal(((await res.json()) as { error: string }).error, 'not_found')
    assert.equal(fake.requests.length, before, '공급자를 부르지 않았다')
    assert.equal((await usageRows(ws)).length, usedBefore, '세지 않았다')
    assert.equal((await messagesOf(mine)).length, 2, '남의 대화에 아무것도 붙지 않았다')
    assert.equal((await getChatSession(member.ctx, mine))?.title, '내 비밀 질문')
  })

  test('★ 지우기 — 메시지가 함께 없어진다 · 원장은 남는다 · 이름 바꾸기(1~60)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, member } = await aiWorkspace()
    const id = (dataOf(await events(await call(member, { message: '지울 대화' })), 'session') as { sessionId: string }).sessionId
    assert.deepEqual(await renameChatSession(member.ctx, id, '   '), { ok: false, reason: 'invalid_title' })
    const renamed = await renameChatSession(member.ctx, id, '  새   이름 ')
    assert.ok(renamed.ok && renamed.value.title === '새 이름')
    assert.equal(await deleteChatSession(member.ctx, id), true)
    assert.equal(await getChatSession(member.ctx, id), null)
    assert.equal((await messagesOf(id)).length, 0, '메시지도 없다(CASCADE)')
    assert.equal((await usageRows(ws)).length, 1, '원장은 남는다')
    assert.equal(await deleteChatSession(member.ctx, id), false, '두 번 지우면 없다')
  })
})

describe('⑤ 멈추기 · 실패', () => {
  test('★ 멈추면 stopped — 받은 데까지 적고 셈에 든다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, member } = await aiWorkspace()
    const stop = new AbortController()
    const res = await call(member, { message: '[slow] 길게' }, stop.signal)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    while (!seen.includes('event: delta')) seen += decoder.decode((await reader.read()).value)
    const sessionId = /"sessionId":"([0-9a-f-]+)"/.exec(seen)![1]!
    stop.abort()
    await reader.cancel().catch(() => undefined)
    let msgs: Awaited<ReturnType<typeof messagesOf>> = []
    for (let i = 0; i < 100 && msgs.length < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 50))
      msgs = await messagesOf(sessionId)
    }
    assert.deepEqual(msgs.map((m) => [m.role, m.status]), [['user', null], ['assistant', 'stopped']])
    assert.ok(msgs[1]!.content.startsWith('조각0'), msgs[1]!.content)
    assert.deepEqual((await usageRows(ws)).map((u) => u.status), ['stopped'])
  })

  test('★ 도중 실패는 failed(셈에서 빠진다) · 처음부터 거절이면 아무것도 적지 않는다(대화 · 질문 없음)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, member } = await aiWorkspace()
    const mid = await events(await call(member, { message: '[midfail] 도중에' }))
    assert.equal(mid.at(-1)!.event, 'error')
    const sessionId = (dataOf(mid, 'session') as { sessionId: string }).sessionId
    assert.deepEqual((await messagesOf(sessionId)).map((m) => [m.role, m.status]), [['user', null], ['assistant', 'failed']])
    const refused = await call(member, { message: '[500] 처음부터' })
    assert.equal(refused.status, 502)
    const busy = await call(member, { message: '[429] 바쁨' })
    assert.equal(busy.status, 503)
    assert.equal(((await busy.json()) as { error: string }).error, 'ai_busy')
    assert.deepEqual((await listChatSessions(member.ctx)).map((s) => s.title), ['[midfail] 도중에'], '거절된 첫 턴은 대화를 만들지 않는다')
    assert.deepEqual((await usageRows(ws)).map((u) => u.status), ['failed', 'failed', 'failed'])
  })
})

describe('⑥ · ⑦ 출처 · 페이지 범위', () => {
  test('★ 출처는 그 사람이 볼 수 있는 것만 — 같은 낱말의 개인 페이지는 출처에도 공급자의 글에도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await aiWorkspace()
    const open = await pageWith(owner, '바나나 계획 공개', ['바나나 수확은 6월', '공개된 줄'])
    const secret = await pageWith(owner, '바나나 계획 비밀', ['바나나 원가는 비밀 숫자 4242'], true)
    const es = await events(await call(member, { message: '바나나 계획은 어디에 있나요?' }))
    const sources = (dataOf(es, 'done') as { sources: { pageId: string }[] }).sources
    assert.deepEqual(sources.map((s) => s.pageId), [open])
    assert.ok(sentText().includes('바나나 수확은 6월'))
    assert.ok(!sentText().includes('4242') && !sentText().includes('바나나 계획 비밀'), '볼 수 없는 페이지의 글 · 제목이 새지 않는다')
    // 소유자는 둘 다 본다
    const mine = await events(await call(owner, { message: '바나나 계획' }))
    assert.deepEqual(new Set((dataOf(mine, 'done') as { sources: { pageId: string }[] }).sources.map((s) => s.pageId)), new Set([open, secret]))
    // 다시 열 때 — 볼 수 없게 된 출처는 viewable false
    const sessionId = (dataOf(es, 'session') as { sessionId: string }).sessionId
    assert.ok((await grantAccess(owner.ctx, open, { type: 'user', id: owner.userId }, 'full_access')).ok)
    assert.ok((await revokeAccess(owner.ctx, open, { type: 'workspace_everyone' })).ok)
    assert.equal((await getChatSession(member.ctx, sessionId))!.messages[1]!.sources[0]!.viewable, false)
  })

  test('★ 찾은 것이 없으면 없다고 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { member } = await aiWorkspace()
    const es = await events(await call(member, { message: '존재하지않는낱말쿼크 이야기' }))
    assert.deepEqual((dataOf(es, 'done') as { sources: unknown[] }).sources, [])
    assert.ok(sentText().includes('No related pages were found'))
  })

  test('★ 페이지 범위 — 볼 수 없으면 404(셈에서 빠진다 · 대화 없음) · 볼 수 있으면 그 원문 · 원장의 page_id · 대화의 범위', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await aiWorkspace()
    const secret = await pageWith(owner, '비밀 회의록', ['비밀 결정'], true)
    const shared = await pageWith(owner, '공개 회의록', ['결정: 출시는 화요일'])
    const before = fake.requests.length
    const denied = await call(member, { message: '요약해 줘', scope: { kind: 'page', pageId: secret } })
    assert.equal(denied.status, 404)
    assert.equal(fake.requests.length, before)
    assert.deepEqual(await listChatSessions(member.ctx), [])
    const es = await events(await call(member, { message: '요약해 줘', scope: { kind: 'page', pageId: shared } }))
    assert.ok(sentText().includes('<page>\nTitle: 공개 회의록\n결정: 출시는 화요일\n</page>'), sentText())
    assert.deepEqual((dataOf(es, 'done') as { sources: unknown[] }).sources, [], '페이지 범위는 번호 출처가 없다')
    // 볼 수 없는 범위는 게이트가 예약 전에 거부한다(아무것도 적지 않는다) — 남는 것은 볼 수 있는 범위의 응답 하나
    assert.deepEqual((await usageRows(ws)).map((u) => [u.feature, u.status, u.page_id]), [['chat', 'completed', shared]])
    const sessionId = (dataOf(es, 'session') as { sessionId: string }).sessionId
    const view = await getChatSession(member.ctx, sessionId)
    assert.deepEqual([view?.scope, view?.scopeTitle], [{ kind: 'page', pageId: shared }, '공개 회의록'])
  })
})

describe('⑧ 내 AI 지시', () => {
  test('★ 정하면 따로 감싸 실린다 · 출처에서 뺀다 · 다른 사람이 고칠 수 있으면 경고 수 · 볼 수 없게 되면 빠진다(unavailable)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await aiWorkspace()
    const shared = await pageWith(owner, '팀 지시 해적', ['해적 말투로 답한다'])
    assert.deepEqual(await aiInstructionsViewFor(member.ctx), { pageId: null, title: null, state: 'none', otherEditors: 0 })
    const set = await setAiInstructionsPage(member.ctx, shared)
    assert.ok(set.ok && set.value.state === 'ok' && set.value.title === '팀 지시 해적')
    assert.ok(set.value.otherEditors >= 1, `소유자가 고칠 수 있다 — 경고 ${set.value.otherEditors}`)
    await events(await call(member, { message: '해적 이야기' }))
    const sent = lastSent()
    assert.equal(sent[1]!.role, 'user')
    assert.ok(sent[1]!.content.includes('<standing_instructions>\n해적 말투로 답한다\n</standing_instructions>'), sent[1]!.content)
    assert.ok(!sent[0]!.content.includes('해적'), '시스템 지시에 잇지 않는다')
    assert.ok(!sentText().includes('[1] 팀 지시 해적'), '지시 페이지는 출처가 아니다')
    // 볼 수 없게 되면 — 빠지고 설정은 unavailable
    assert.ok((await grantAccess(owner.ctx, shared, { type: 'user', id: owner.userId }, 'full_access')).ok)
    assert.ok((await revokeAccess(owner.ctx, shared, { type: 'workspace_everyone' })).ok)
    await events(await call(member, { message: '다시 해적 이야기' }))
    assert.ok(!sentText().includes('해적 말투로 답한다') && !lastSent().slice(1).some((m) => m.content.includes('<standing_instructions>')))
    assert.equal((await aiInstructionsViewFor(member.ctx))?.state, 'unavailable')
    // 볼 수 없는 페이지는 고를 수 없다 · 해제
    assert.deepEqual(await setAiInstructionsPage(member.ctx, shared), { ok: false, reason: 'not_found' })
    assert.deepEqual(await setAiInstructionsPage(member.ctx, 'nope'), { ok: false, reason: 'invalid_input' })
    const cleared = await setAiInstructionsPage(member.ctx, null)
    assert.ok(cleared.ok && cleared.value.state === 'none')
  })

  test('★ 새 페이지로 만들기 — 그 사람의 개인 페이지 "내 AI 지시"(틀) · 경고 없음 · 다음 턴에 실린다 · 채팅에만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await aiWorkspace()
    const made = await createAiInstructionsPage(member.ctx)
    assert.ok(made.ok, JSON.stringify(made))
    assert.deepEqual([made.value.state, made.value.title, made.value.otherEditors], ['ok', '내 AI 지시', 0])
    const row = (await query<{ owner_user_id: string | null }>(`SELECT owner_user_id FROM block WHERE id = $1`, [made.value.pageId]))[0]
    assert.equal(row?.owner_user_id, member.userId, '그 사람의 개인 페이지')
    await events(await call(member, { message: '안녕' }))
    for (const line of AI_INSTRUCTIONS_TEMPLATE) assert.ok(lastSent()[1]!.content.includes(line), line)
    assert.equal((await aiInstructionsViewFor(owner.ctx))?.state, 'none', '다른 사람의 설정은 그대로')
  })
})

describe('⑨ · ⑩ 거부 · 계정 삭제', () => {
  test('★ 꺼짐 403 · 게스트 403(대화를 읽지 못한다) · 모양 400 · 긴 글 400 — 공급자를 부르지 않고 세지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const off = await makeFixture()
    const { ws, member } = await aiWorkspace()
    const guest = await joinAs(ws, await createUser('채팅의 손님'), 'guest')
    const before = fake.requests.length
    const expect = async (res: Response, status: number, error: string) => {
      assert.equal(res.status, status, error)
      assert.equal(((await res.json()) as { error: string }).error, error)
    }
    await expect(await call(off.owner, { message: 'x' }), 403, 'ai_disabled')
    await expect(await call(guest, { message: 'x' }), 403, 'forbidden')
    await expect(await call(member, { message: '' }), 400, 'invalid_input')
    await expect(await call(member, { message: 'x', scope: { kind: 'page' } }), 400, 'invalid_input')
    await expect(await call(member, { message: 'x'.repeat(5000) }), 400, 'input_too_long')
    assert.equal(fake.requests.length, before)
    assert.equal((await usageRows(ws)).length, 0)
    assert.deepEqual(await listChatSessions(guest.ctx), [])
    assert.equal(await aiInstructionsViewFor(guest.ctx), null)
    assert.deepEqual(await setAiInstructionsPage(guest.ctx, null), { ok: false, reason: 'forbidden' })
  })

  test('★ 계정을 지우면 그 사람의 대화 · 지시를 지운다(원장은 남는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const leaver = await createUser('떠날 사람')
    const actor = await joinAs(ws, leaver, 'member')
    await events(await call(actor, { message: '떠나기 전 질문' }))
    assert.ok((await createAiInstructionsPage(actor.ctx)).ok)
    await events(await call(owner, { message: '남는 사람의 질문' }))
    const deleted = await deleteAccount(actor.userId, { confirmEmail: leaver.email })
    assert.ok(deleted.ok, JSON.stringify(deleted))
    const left = await query<{ n: string }>(`SELECT count(*) AS n FROM ai_chat_session WHERE user_id = $1`, [actor.userId])
    const setting = await query<{ n: string }>(`SELECT count(*) AS n FROM ai_user_setting WHERE user_id = $1`, [actor.userId])
    assert.deepEqual([Number(left[0]!.n), Number(setting[0]!.n)], [0, 0])
    assert.equal((await listChatSessions(owner.ctx)).length, 1, '다른 사람의 대화는 그대로')
    assert.equal((await usageRows(ws)).filter((u) => u.user_id === actor.userId).length, 1, '원장은 남는다')
  })
})
