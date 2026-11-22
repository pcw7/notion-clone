/**
 * AI 채팅의 저장 · 문맥 읽기 · 내 AI 지시 — DB (AI-6 · F-10-17 · F-10-22)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑪ · 마이그레이션 0148
 *
 * **대화는 그 사람만의 것이다** — 모든 질의가 `workspace_id = ctx.workspaceId AND user_id = ctx.userId` 로 거른다. 남의 대화 id 는 없는 것과
 * 같다(`null` → 404). 부를 수 있는 사람은 AI 를 쓸 수 있는 사람(`canUseAi` — 게스트 · 위임 · API 토큰이 아니다).
 *
 * 문맥은 그 사람이 **지금** 볼 수 있는 것만 — 범위의 페이지 · 출처 · 내 AI 지시 페이지 모두 AI-2 의 읽기(`readAskPage` — `view` · 살아 있는
 * 페이지 · 제안 마크 밖의 원문)를 지난다. 출처는 앱의 검색(`searchPages` — 권한 필터가 `WHERE` 에 · 휴지통 없음)으로 찾는다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { openPageBody } from '../block/body-write.ts'
import { createPageIn, plainTitleOf, titleFromPlainText } from '../block/page.ts'
import { textRun } from '../contracts/rich-text.ts'
import { withCommandTransaction, withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { wrapUnknownTypes, type EditorBlock } from '../editor/document.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps, membersWith, readableScopes } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { searchPages } from '../search/search.ts'
import { readAskPage } from './ask-context.ts'
import { CHAT_MAX_HISTORY, chatSearchQueries, chatSearchTerms, instructionsTextOf, type ChatFoundPage, type ChatTurn } from './chat-prompt.ts'
import {
  CHAT_LIST_LIMIT,
  CHAT_MAX_SOURCES,
  chatTitleOf,
  normalizeChatTitle,
  readChatSources,
  type ChatMessageStatus,
  type ChatMessageView,
  type ChatScope,
  type ChatSessionSummary,
  type ChatSessionView,
  type ChatSource,
} from './chat-shared.ts'
import type { TokenUsage } from './sse.ts'
import { canUseAi } from './usage.ts'

type Reader = Pick<Tx, 'query' | 'queryMaybe'>

/** 저장하는 답의 최대 글자(DB CHECK 20,000). */
export const CHAT_CONTENT_MAX = 20000
/** 다시 열 때 읽는 메시지 수(최근 것). */
const OPEN_MESSAGES_LIMIT = 400

type SessionRow = { id: string; title: string; scope: unknown; updated_at: Date; model: string | null }

const scopeOf = (raw: unknown): ChatScope => {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return r.kind === 'page' && typeof r.pageId === 'string' ? { kind: 'page', pageId: r.pageId } : { kind: 'workspace' }
}

const summaryOf = (row: SessionRow): ChatSessionSummary => ({
  id: row.id,
  title: row.title,
  scope: scopeOf(row.scope),
  updatedAt: row.updated_at.toISOString(),
  model: row.model,
})

// ── 대화 ──────────────────────────────────────────────────────────────

/** 내 대화 목록 — 최근 것부터(50). AI 를 쓸 수 없는 사람은 빈 목록. */
export async function listChatSessions(ctx: SessionContext): Promise<ChatSessionSummary[]> {
  if (!canUseAi(ctx)) return []
  const rows = await withReadTransaction((tx) =>
    tx.query<SessionRow>(
      `SELECT id, title, scope, updated_at, model FROM ai_chat_session
        WHERE workspace_id = $1 AND user_id = $2
        ORDER BY updated_at DESC, id DESC LIMIT $3`,
      [ctx.workspaceId, ctx.userId, CHAT_LIST_LIMIT],
    ),
  )
  return rows.map(summaryOf)
}

async function ownSessionIn(db: Reader, ctx: SessionContext, sessionId: string): Promise<SessionRow | null> {
  if (!isUuid(sessionId)) return null
  return db.queryMaybe<SessionRow>(
    `SELECT id, title, scope, updated_at, model FROM ai_chat_session WHERE id = $1 AND workspace_id = $2 AND user_id = $3`,
    [sessionId, ctx.workspaceId, ctx.userId],
  )
}

/** 내 대화 하나(이어 가기 전에 묻는다) — 남의 것 · 없는 것은 null. */
export async function findOwnChatSession(ctx: SessionContext, sessionId: string): Promise<ChatSessionSummary | null> {
  if (!canUseAi(ctx)) return null
  const row = await withReadTransaction((tx) => ownSessionIn(tx, ctx, sessionId))
  return row === null ? null : summaryOf(row)
}

/** 출처 페이지 중 그 사람이 **지금** 볼 수 있는 살아 있는 것(사용량 기록의 페이지도 — AI-7). */
export async function viewablePagesIn(tx: Tx, ctx: SessionContext, pageIds: readonly string[]): Promise<Set<string>> {
  if (pageIds.length === 0) return new Set()
  const scopes = await readableScopes(tx, ctx)
  if (scopes.length === 0) return new Set()
  const rows = await tx.query<{ id: string }>(
    `SELECT id FROM block
      WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live' AND perm_scope_id = ANY($3::uuid[])`,
    [pageIds, ctx.workspaceId, scopes],
  )
  return new Set(rows.map((r) => r.id))
}

/** 내 대화를 연다 — 메시지(차례대로) · 출처마다 지금 볼 수 있는가. 남의 것 · 없는 것은 null. */
export async function getChatSession(ctx: SessionContext, sessionId: string): Promise<ChatSessionView | null> {
  if (!canUseAi(ctx)) return null
  return withReadTransaction(async (tx) => {
    const session = await ownSessionIn(tx, ctx, sessionId)
    if (session === null) return null
    const rows = (
      await tx.query<{ id: string; role: 'user' | 'assistant'; content: string; status: ChatMessageStatus | null; sources: unknown; model: string | null }>(
        // 답을 쓴 모델은 원장의 것(AI-7 — 턴마다 다를 수 있다)
        `SELECT m.id, m.role, m.content, m.status, m.sources, u.model
           FROM ai_chat_message m LEFT JOIN ai_usage u ON u.id = m.usage_id
          WHERE m.session_id = $1 ORDER BY m.seq DESC LIMIT $2`,
        [session.id, OPEN_MESSAGES_LIMIT],
      )
    ).reverse()
    const sourcesOf = rows.map((r) => readChatSources(r.sources))
    const scope = scopeOf(session.scope)
    const viewable = await viewablePagesIn(tx, ctx, [...new Set([...sourcesOf.flat().map((s) => s.pageId), ...(scope.kind === 'page' ? [scope.pageId] : [])])])
    let scopeTitle: string | null = null
    if (scope.kind === 'page' && viewable.has(scope.pageId)) {
      const row = await tx.queryMaybe<{ properties: { title?: unknown } | null }>(`SELECT properties FROM block WHERE id = $1`, [scope.pageId])
      scopeTitle = row === null ? null : plainTitleOf(row.properties)
    }
    const messages: ChatMessageView[] = rows.map((r, i) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      status: r.status,
      sources: sourcesOf[i]!.map((s) => ({ ...s, viewable: viewable.has(s.pageId) })),
      ...(r.role === 'assistant' ? { model: r.model } : {}),
    }))
    return { ...summaryOf(session), messages, scopeTitle }
  })
}

export type ChatSessionCommand<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: 'not_found' | 'invalid_title' }

/** 이름을 바꾼다 — 그 사람의 대화만 · 1~60자(공백을 접는다). */
export async function renameChatSession(ctx: SessionContext, sessionId: string, raw: unknown): Promise<ChatSessionCommand<ChatSessionSummary>> {
  if (!canUseAi(ctx) || !isUuid(sessionId)) return { ok: false, reason: 'not_found' }
  const title = normalizeChatTitle(raw)
  if (title === null) return { ok: false, reason: 'invalid_title' }
  return withCommandTransaction(async (tx): Promise<ChatSessionCommand<ChatSessionSummary>> => {
    const row = await tx.queryMaybe<SessionRow>(
      `UPDATE ai_chat_session SET title = $4 WHERE id = $1 AND workspace_id = $2 AND user_id = $3 RETURNING id, title, scope, updated_at, model`,
      [sessionId, ctx.workspaceId, ctx.userId, title],
    )
    return row === null ? { ok: false, reason: 'not_found' } : { ok: true, value: summaryOf(row) }
  })
}

/** 지운다 — 대화와 메시지가 없어진다(원장은 남는다). 그 사람의 것이 아니면 false. */
export async function deleteChatSession(ctx: SessionContext, sessionId: string): Promise<boolean> {
  if (!canUseAi(ctx) || !isUuid(sessionId)) return false
  return withTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ id: string }>(
      `DELETE FROM ai_chat_session WHERE id = $1 AND workspace_id = $2 AND user_id = $3 RETURNING id`,
      [sessionId, ctx.workspaceId, ctx.userId],
    )
    return row !== null
  })
}

// ── 턴 ────────────────────────────────────────────────────────────────

/** 앞선 턴 — 질문과 그 답(실패 · 빈 답은 뺀다) · 오래된 것부터 · 최근 `CHAT_MAX_HISTORY` 개. */
export async function loadChatHistory(ctx: SessionContext, sessionId: string): Promise<ChatTurn[]> {
  return withReadTransaction(async (tx) => {
    const session = await ownSessionIn(tx, ctx, sessionId)
    if (session === null) return []
    const rows = (
      await tx.query<{ role: 'user' | 'assistant'; content: string; status: ChatMessageStatus | null }>(
        `SELECT role, content, status FROM ai_chat_message WHERE session_id = $1 ORDER BY seq DESC LIMIT $2`,
        [session.id, CHAT_MAX_HISTORY * 4],
      )
    ).reverse()
    const turns: ChatTurn[] = []
    let question: string | null = null
    for (const r of rows) {
      if (r.role === 'user') {
        question = r.content
        continue
      }
      if (question !== null && r.status !== 'failed' && r.content.trim() !== '') turns.push({ question, answer: r.content })
      question = null
    }
    return turns.slice(-CHAT_MAX_HISTORY)
  })
}

/**
 * 턴을 연다 — 첫 턴이면 대화를 만들고(제목 = 첫 질문) 아니면 범위 · 모델 · 시각을 고친다 · 질문을 적는다. 그사이 대화가 지워졌으면 null.
 *
 * @param input.model 이 대화에 남길 모델(AI-7) — null 은 자동. 허용인지는 게이트가 이미 봤다.
 */
export async function startChatTurn(
  ctx: SessionContext,
  input: { readonly sessionId: string | null; readonly question: string; readonly scope: ChatScope; readonly model: string | null },
): Promise<{ readonly sessionId: string; readonly title: string; readonly created: boolean; readonly messageId: string } | null> {
  return withTransaction(async (tx) => {
    let sessionId = input.sessionId
    let title: string
    const created = sessionId === null
    if (sessionId === null) {
      sessionId = randomUUID()
      title = chatTitleOf(input.question)
      await tx.query(
        `INSERT INTO ai_chat_session (id, workspace_id, user_id, title, scope, model) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [sessionId, ctx.workspaceId, ctx.userId, title, JSON.stringify(input.scope), input.model],
      )
    } else {
      const row = await tx.queryMaybe<{ title: string }>(
        `UPDATE ai_chat_session SET scope = $4::jsonb, model = $5, updated_at = GREATEST(now(), created_at)
          WHERE id = $1 AND workspace_id = $2 AND user_id = $3 RETURNING title`,
        [sessionId, ctx.workspaceId, ctx.userId, JSON.stringify(input.scope), input.model],
      )
      if (row === null) return null
      title = row.title
    }
    const messageId = randomUUID()
    await tx.query(`INSERT INTO ai_chat_message (id, session_id, role, content) VALUES ($1, $2, 'user', $3)`, [messageId, sessionId, input.question])
    return { sessionId, title, created, messageId }
  })
}

const tokens = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? Math.min(n, 2_000_000_000) : null)

/** 답을 적는다 — 그 상태 · 받은 데까지 · 출처 · 토큰 · 원장의 응답. 그사이 대화가 지워졌으면 적지 않는다(null). */
export async function finishChatTurn(
  ctx: SessionContext,
  input: {
    readonly sessionId: string
    readonly usageId: string
    readonly status: ChatMessageStatus
    readonly content: string
    readonly sources: readonly ChatSource[]
    readonly usage: TokenUsage | null
  },
): Promise<string | null> {
  return withTransaction(async (tx) => {
    const id = randomUUID()
    const row = await tx.queryMaybe<{ id: string }>(
      `INSERT INTO ai_chat_message (id, session_id, role, content, sources, status, input_tokens, output_tokens, usage_id)
       SELECT $1, s.id, 'assistant', $4, $5::jsonb, $6, $7, $8, $9 FROM ai_chat_session s
        WHERE s.id = $2 AND s.workspace_id = $3 AND s.user_id = $10
       RETURNING id`,
      [
        id,
        input.sessionId,
        ctx.workspaceId,
        input.content.slice(0, CHAT_CONTENT_MAX),
        JSON.stringify(input.sources.slice(0, CHAT_MAX_SOURCES)),
        input.status,
        tokens(input.usage?.inputTokens),
        tokens(input.usage?.outputTokens),
        input.usageId,
        ctx.userId,
      ],
    )
    if (row === null) return null
    await tx.query(`UPDATE ai_chat_session SET updated_at = GREATEST(now(), created_at) WHERE id = $1`, [input.sessionId])
    return row.id
  })
}

/** 범위 고르개의 페이지 — 그 사람이 지금 볼 수 있는 살아 있는 페이지의 제목. 아니면 null(화면은 워크스페이스 전체로 돌아간다). */
export async function chatScopePageOf(ctx: SessionContext, pageId: string): Promise<{ readonly id: string; readonly title: string } | null> {
  if (!isUuid(pageId)) return null
  return withReadTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ id: string; properties: { title?: unknown } | null }>(
      `SELECT id, properties FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
      [pageId.toLowerCase(), ctx.workspaceId],
    )
    if (row === null || !can(await effectiveCaps(tx, ctx, row.id), 'view')) return null
    return { id: row.id, title: plainTitleOf(row.properties) }
  })
}

// ── 문맥 ──────────────────────────────────────────────────────────────

/**
 * 출처 찾기 — 질문의 낱말로 앱의 검색을 먼저 모두(AND) · 모자라면 하나라도(OR) → 페이지만 · 위의 넷까지 → 각 원문을 다시 읽는다(볼 수 있는
 * 살아 있는 페이지만). `exclude`(내 AI 지시 페이지)는 뺀다.
 */
export async function findChatSources(
  ctx: SessionContext,
  question: string,
  exclude: readonly string[] = [],
): Promise<{ readonly terms: string[]; readonly found: ChatFoundPage[] }> {
  const terms = chatSearchTerms(question)
  const ids: string[] = []
  for (const query of chatSearchQueries(terms)) {
    if (ids.length >= CHAT_MAX_SOURCES) break
    const result = await searchPages(ctx, { query, kind: 'page', limit: CHAT_MAX_SOURCES + exclude.length })
    if (!result.ok) continue
    for (const hit of result.results.results) {
      if (ids.length >= CHAT_MAX_SOURCES) break
      if (hit.kind === 'page' && !ids.includes(hit.pageId) && !exclude.includes(hit.pageId)) ids.push(hit.pageId)
    }
  }
  const found: ChatFoundPage[] = []
  for (const pageId of ids) {
    const page = await readAskPage(ctx, pageId)
    if (page !== null) found.push({ pageId, page })
  }
  return { terms, found }
}

/** 채팅에 싣는 내 AI 지시 — 가리킨 페이지를 지금 볼 수 있고 글이 있을 때만. */
export async function readChatInstructions(ctx: SessionContext): Promise<{ readonly pageId: string; readonly title: string; readonly text: string } | null> {
  const row = await withReadTransaction((tx) =>
    tx.queryMaybe<{ instructions_page_id: string | null }>(
      `SELECT instructions_page_id FROM ai_user_setting WHERE workspace_id = $1 AND user_id = $2`,
      [ctx.workspaceId, ctx.userId],
    ),
  )
  const pageId = row?.instructions_page_id ?? null
  if (pageId === null) return null
  const page = await readAskPage(ctx, pageId)
  if (page === null) return null
  const text = instructionsTextOf(page)
  return text.trim() === '' ? null : { pageId, title: page.title, text }
}

// ── 내 AI 지시(설정) ──────────────────────────────────────────────────

/** 설정의 "내 AI 지시" — 가리킨 페이지 · 지금 볼 수 있는가 · 그 페이지를 고칠 수 있는 다른 사람 수(경고). */
export type AiInstructionsView = {
  readonly pageId: string | null
  readonly title: string | null
  /** `none` 정하지 않았다 · `ok` · `unavailable` 정했지만 지금 볼 수 없다(권한 · 휴지통 · 지워짐 — 채팅에 싣지 않는다). */
  readonly state: 'none' | 'ok' | 'unavailable'
  /** 그 페이지를 고칠 수 있는 다른 사람(활성 멤버 · 게스트) 수 — 0 보다 크면 경고. */
  readonly otherEditors: number
}

const NO_INSTRUCTIONS: AiInstructionsView = { pageId: null, title: null, state: 'none', otherEditors: 0 }

async function instructionsViewIn(tx: Tx, ctx: SessionContext): Promise<AiInstructionsView> {
  const row = await tx.queryMaybe<{ instructions_page_id: string | null }>(
    `SELECT instructions_page_id FROM ai_user_setting WHERE workspace_id = $1 AND user_id = $2`,
    [ctx.workspaceId, ctx.userId],
  )
  const pageId = row?.instructions_page_id ?? null
  if (pageId === null) return NO_INSTRUCTIONS
  const page = await tx.queryMaybe<{ properties: { title?: unknown } | null }>(
    `SELECT properties FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
    [pageId, ctx.workspaceId],
  )
  if (page === null || !can(await effectiveCaps(tx, ctx, pageId), 'view')) return { pageId, title: null, state: 'unavailable', otherEditors: 0 }
  const editors = (await membersWith(tx, ctx.workspaceId, [pageId], 'edit_content')).get(pageId) ?? new Set<string>()
  return { pageId, title: plainTitleOf(page.properties), state: 'ok', otherEditors: [...editors].filter((id) => id !== ctx.userId).length }
}

/** 지금의 내 AI 지시 — AI 를 쓸 수 없는 사람은 null(설정에 서지 않는다). */
export async function aiInstructionsViewFor(ctx: SessionContext): Promise<AiInstructionsView | null> {
  if (!canUseAi(ctx)) return null
  return withReadTransaction((tx) => instructionsViewIn(tx, ctx))
}

export type AiInstructionsResult = { readonly ok: true; readonly value: AiInstructionsView } | { readonly ok: false; readonly reason: 'forbidden' | 'not_found' | 'invalid_input' }

async function pointTo(tx: Tx, ctx: SessionContext, pageId: string | null): Promise<void> {
  await tx.query(
    `INSERT INTO ai_user_setting (workspace_id, user_id, instructions_page_id, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET instructions_page_id = EXCLUDED.instructions_page_id, updated_at = EXCLUDED.updated_at`,
    [ctx.workspaceId, ctx.userId, pageId],
  )
}

/** 내 AI 지시 페이지를 정한다(볼 수 있는 살아 있는 페이지만) · null 이면 해제. */
export async function setAiInstructionsPage(ctx: SessionContext, raw: unknown): Promise<AiInstructionsResult> {
  if (!canUseAi(ctx)) return { ok: false, reason: 'forbidden' }
  if (raw !== null && (typeof raw !== 'string' || !isUuid(raw))) return { ok: false, reason: 'invalid_input' }
  const pageId = raw === null ? null : raw.toLowerCase()
  return withCommandTransaction(async (tx): Promise<AiInstructionsResult> => {
    if (pageId !== null) {
      const live = await tx.queryMaybe<{ one: number }>(
        `SELECT 1 AS one FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
        [pageId, ctx.workspaceId],
      )
      if (live === null || !can(await effectiveCaps(tx, ctx, pageId), 'view')) return { ok: false, reason: 'not_found' }
    }
    await pointTo(tx, ctx, pageId)
    return { ok: true, value: await instructionsViewIn(tx, ctx) }
  })
}

/** "새 페이지로 만들기"의 이름과 틀 — 그 사람의 개인 페이지. */
export const AI_INSTRUCTIONS_PAGE_TITLE = '내 AI 지시'
export const AI_INSTRUCTIONS_TEMPLATE = [
  'AI 채팅이 대화마다 이 페이지를 함께 읽습니다(앞 1,500자). 바라는 말투 · 형식 · 나와 팀에 대한 맥락을 적어 두세요.',
  '답은 짧고 분명하게 써 주세요.',
  '모르는 것은 모른다고 말해 주세요.',
] as const

const templateBlock = (type: EditorBlock['type'], text: string): EditorBlock => ({
  id: randomUUID(),
  type,
  title: [textRun(text)],
  properties: {},
  format: {},
  children: [],
})

/** 새 개인 페이지 "내 AI 지시"(짧은 틀)를 만들어 가리킨다. */
export async function createAiInstructionsPage(ctx: SessionContext): Promise<AiInstructionsResult> {
  if (!canUseAi(ctx)) return { ok: false, reason: 'forbidden' }
  return withCommandTransaction(async (tx): Promise<AiInstructionsResult> => {
    const page = await createPageIn(tx, ctx, { privateTop: true, title: titleFromPlainText(AI_INSTRUCTIONS_PAGE_TITLE) })
    const body = await openPageBody(tx, ctx, page.id)
    const [lead, ...items] = AI_INSTRUCTIONS_TEMPLATE
    const doc = wrapUnknownTypes({ blocks: [templateBlock('paragraph', lead), ...items.map((t) => templateBlock('bulleted_list_item', t))] })
    const next = docToPm(doc)
    body.change((tr) => {
      tr.replaceWith(0, tr.doc.content.size, next.content)
    })
    const written = await body.finish()
    if (!written.ok) throw new Error(`내 AI 지시 페이지의 틀을 쓰지 못했다(${written.reason})`)
    await pointTo(tx, ctx, page.id)
    return { ok: true, value: await instructionsViewIn(tx, ctx) }
  })
}
