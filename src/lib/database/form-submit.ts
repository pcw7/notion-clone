/**
 * 폼 — 공개 제출 (인접 제품 7a-2a · F-13-02 · F-17-10)
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ④⑥ · 마이그레이션 0095
 *       17 F-17-10 *"인증 없이 데이터를 생성할 수 있는 유일한 경로 — 8개 계층을 폼 제출 경로 한 곳에 순서대로 꿰는 미들웨어"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 제출자는 주체가 아니다 — 세션 컨텍스트를 만들지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 쓰기의 자격은 **그 폼**이다(토큰 · 공개 · 정책 · 데이터베이스와 소스가 살아 있다 · 그 폼의 질문만). 행은 세션 없는 넣기
 * (`createAnonymousRowIn` — 만든 사람 · 활동의 행위자 NULL)로 들어가고, 남용 메타는 행의 속성이 아니라 `form_submission_meta` 에 남는다.
 *
 *   같은 출처 → 허니팟(받은 척) → 공개 판정(폼 찾기) → 제출 토큰(서명 · 그 폼 · 2시간) → 최소 작성 시간(3초) → 레이트리밋(제출자 × 폼 ·
 *   폼 전체) → 값 검증(질문마다 까닭) → 토큰을 한 번만(Valkey) → 한 트랜잭션: 다시 공개인지 · 행 · 칸 · 메타
 *
 * 토큰을 쓰는 것은 값 검증 **뒤**다 — 값이 틀려 고쳐 다시 내는 사람이 같은 화면의 토큰으로 낸다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 워크스페이스 멤버만의 폼(7b-1 · 정본 ⑨) — 같은 길에 응답자 하나를 더한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `access = 'workspace'` 면 공개 판정 다음에 **로그인 세션**을 묻는다(`resolveFormRespondent` — `resolveSessionContext` 그대로 · 발급자를
 * 늘리지 않는다). 그 워크스페이스의 멤버(게스트가 아닌)만 내고, 행의 만든 사람 · 활동의 행위자가 그 사람이다(`createRespondentRowIn`).
 * 방어 계층은 그대로 지난다 — 레이트리밋의 제출자는 그 사람이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 한 사람당 한 번(7b-3 · 정본 ⑪) — 열쇠는 로그인한 응답자 하나
 * ──────────────────────────────────────────────────────────────────────
 *
 * 폼이 켰고 응답자가 멤버면, 그 사람이 이 폼으로 낸 살아 있는 응답이 있을 때 `already_submitted` 다(마감 다음 · 토큰 전). 웹 공개 폼은
 * 응답자를 모른다 — 켜 두어도 막지 않는다(브라우저 지문은 쓰지 않는다). 넣는 트랜잭션에서 폼 행을 잠근 채 다시 본다(두 탭의 동시 제출).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import type { RequestMeta } from '../auth/request-meta.ts'
import { resolveSessionContext, type SessionContext } from '../auth/session-context.ts'
import { plainTitleOf } from '../block/page.ts'
import { textRun, type ValidationIssue } from '../contracts/rich-text.ts'
import { withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import type { WorkspaceId } from '../ids.ts'
import { claimOnce, consume, type RateLimitRule } from '../rate-limit.ts'
import { readSecurityPolicyIn } from '../workspace/security-policy.ts'
import { FORM_QUESTION_TYPES, countFormResponsesIn, hasRespondedIn, type FormQuestionType } from './form.ts'
import { formClosedReason, type FormClosedReason } from './form-limits.ts'
import { readOptionsOf } from './options.ts'
import type { CellValue } from './property-types.ts'
import { createAnonymousRowIn, createRespondentRowIn } from './row.ts'

/** 제출 토큰의 수명 — 화면을 받고 이 안에 내야 한다(17 *"1회용 + TTL(예: 2시간)"*). */
export const SUBMISSION_TTL_MS = 2 * 60 * 60 * 1000
/** 최소 작성 시간 — 이보다 빠르면 봇으로 본다(17 *"임계값 3초 권고"*). */
export const MIN_DWELL_MS = 3000
/** 제출자 × 폼. */
export const SUBMITTER_RATE_LIMIT: RateLimitRule = { limit: 10, windowSeconds: 600 }
/** 폼 전체. */
export const FORM_RATE_LIMIT: RateLimitRule = { limit: 500, windowSeconds: 3600 }
/** 글 답의 길이. */
export const MAX_ANSWER_LENGTH = 2000

const FORM_TOKEN = /^[A-Za-z0-9_-]{22}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export type PublicFormQuestion = {
  readonly propertyId: string
  /** 질문 제목 — 비었으면 속성 이름. */
  readonly label: string
  readonly helpText: string | null
  readonly required: boolean
  readonly type: FormQuestionType
  /** 선택 질문의 옵션 — 이름 · 색. 다른 타입은 빈 목록. */
  readonly options: readonly { readonly id: string; readonly name: string; readonly color: string }[]
}

export type PublicForm = {
  readonly viewId: string
  /** 웹 공개(익명)인가 · 워크스페이스 멤버만인가(7b-1). 닫힌 폼은 읽히지 않는다. */
  readonly access: 'public' | 'workspace'
  readonly workspaceId: WorkspaceId
  readonly dataSourceId: string
  /** 폼 제목 — 비었으면 데이터베이스 이름. */
  readonly title: string
  readonly description: string | null
  readonly submitLabel: string
  readonly confirmationTitle: string
  readonly confirmationBody: string | null
  readonly questions: readonly PublicFormQuestion[]
  /** 닫혔다면 그 까닭(상한 · 마감 시각 — 7b-2 · 정본 ⑩). 닫힌 폼도 읽힌다 — 화면이 "마감했습니다" 라고 말한다. */
  readonly closedBecause: FormClosedReason | null
  /** 한 사람당 한 번(7b-3 · 정본 ⑪) — 막는 것은 멤버 응답자뿐이다(`alreadyResponded`). */
  readonly onePerRespondent: boolean
}

export const DEFAULT_SUBMIT_LABEL = '제출'
export const DEFAULT_CONFIRMATION_TITLE = '제출했습니다'

/**
 * 토큰으로 폼을 읽는다 — 세션을 보지 않는다. 열 수 없으면 null(닫힘 · 정책 · 휴지통 — 이유를 말하지 않는다 · 정본 ⑥ ⓒ). 워크스페이스
 * 멤버만의 폼도 읽는다(`access`) — 누가 볼 수 있는지는 부르는 쪽이 `resolveFormRespondent` 로 정한다.
 */
export async function readPublicForm(token: string): Promise<PublicForm | null> {
  if (!FORM_TOKEN.test(token)) return null
  return withReadTransaction((tx) => readPublicFormIn(tx, token))
}

async function readPublicFormIn(tx: Tx, token: string): Promise<PublicForm | null> {
  const row = await tx.queryMaybe<{
    view_id: string
    access: 'public' | 'workspace'
    workspace_id: WorkspaceId
    data_source_id: string
    title: string | null
    description: string | null
    submit_label: string | null
    confirmation_title: string | null
    confirmation_body: string | null
    database_title: Record<string, unknown> | null
    max_responses: number | null
    closes_at: Date | null
    one_per_respondent: boolean
  }>(
    `SELECT f.view_id, f.access, b.workspace_id, v.data_source_id, f.title, f.description, f.submit_label, f.confirmation_title, f.confirmation_body,
            b.properties AS database_title, f.max_responses, f.closes_at, f.one_per_respondent
       FROM form_view f
       JOIN view v ON v.id = f.view_id AND v.type = 'form'
       JOIN block b ON b.id = v.database_id AND b.lifecycle = 'live'
       JOIN data_source ds ON ds.id = v.data_source_id AND ds.lifecycle = 'live'
      WHERE f.token = $1 AND f.access IN ('public', 'workspace')
        -- 세션이 없어 권한 판정을 지나지 않는다 — 위의 페이지가 휴지통이면 닫는다(데이터베이스 블록은 수명이 없다 · X-3)
        AND NOT EXISTS (SELECT 1 FROM block a WHERE a.id = ANY(b.ancestor_path) AND a.lifecycle <> 'live')`,
    [token],
  )
  if (row === null) return null
  // 정책은 웹에 여는 것만 막는다 — 워크스페이스 멤버만의 폼은 밖으로 내보내는 것이 아니다(⑨)
  if (row.access === 'public' && !(await readSecurityPolicyIn(tx, row.workspace_id)).allowPublish) return null

  const questions = await tx.query<{
    property_id: string
    name: string
    type: FormQuestionType
    label: string | null
    help_text: string | null
    required: boolean
  }>(
    `SELECT q.property_id, p.name, p.type, q.label, q.help_text, q.required
       FROM form_question q
       JOIN property p ON p.id = q.property_id
      WHERE q.view_id = $1 AND p.data_source_id = $2 AND p.deleted_at IS NULL AND p.type::text = ANY($3::text[])
      ORDER BY q.order_key`,
    [row.view_id, row.data_source_id, FORM_QUESTION_TYPES],
  )
  const options = await readOptionsOf(
    tx,
    questions.filter((q) => q.type === 'select').map((q) => q.property_id),
  )
  return {
    viewId: row.view_id,
    access: row.access,
    workspaceId: row.workspace_id,
    dataSourceId: row.data_source_id,
    title: row.title ?? (plainTitleOf(row.database_title ?? {}) || '제목 없음'),
    description: row.description,
    submitLabel: row.submit_label ?? DEFAULT_SUBMIT_LABEL,
    confirmationTitle: row.confirmation_title ?? DEFAULT_CONFIRMATION_TITLE,
    confirmationBody: row.confirmation_body,
    closedBecause: formClosedReason(
      { maxResponses: row.max_responses, closesAt: row.closes_at === null ? null : row.closes_at.toISOString() },
      row.max_responses === null ? 0 : await countFormResponsesIn(tx, row.view_id),
    ),
    onePerRespondent: row.one_per_respondent,
    questions: questions.map((q) => ({
      propertyId: q.property_id,
      label: q.label ?? q.name,
      helpText: q.help_text,
      required: q.required,
      type: q.type,
      options: (options.get(q.property_id) ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color })),
    })),
  }
}

// ── 응답자 ────────────────────────────────────────────────────────────

/**
 * 이 폼에 누가 내는가(7b-1 · 정본 ⑨) —
 *   · 웹 공개면 `anonymous`(세션을 보지 않는다 — 강제 익명 ④)
 *   · 워크스페이스 멤버만이면 로그인 세션을 그 워크스페이스로 해석한다: 멤버(게스트가 아닌)면 `member` · 로그인하지 않았다(만료 ·
 *     폐기 · 둘째 단계가 남았다)면 `login` · 그 밖(멤버가 아니다 · 게스트 · 멈췄다)이면 `denied`(화면은 404 — 이유를 말하지 않는다)
 */
export type FormRespondent =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'member'; readonly context: SessionContext; readonly name: string }
  | { readonly kind: 'login' }
  | { readonly kind: 'denied' }

export async function resolveFormRespondent(form: Pick<PublicForm, 'access' | 'workspaceId'>, sessionToken: string | null): Promise<FormRespondent> {
  if (form.access === 'public') return { kind: 'anonymous' }
  const session = await resolveSessionContext(sessionToken, form.workspaceId)
  if (!session.ok) {
    const reason = session.reason
    return reason === 'no_session' || reason === 'expired' || reason === 'revoked' || reason === 'mfa_required' ? { kind: 'login' } : { kind: 'denied' }
  }
  if (session.context.role === 'guest') return { kind: 'denied' }
  const user = await withReadTransaction((tx) =>
    tx.queryMaybe<{ name: string }>(`SELECT name FROM "user" WHERE id = $1`, [session.context.userId]),
  )
  return { kind: 'member', context: session.context, name: user?.name ?? '' }
}

/**
 * 이 응답자가 이미 냈는가(7b-3 · 정본 ⑪) — 폼이 한 사람당 한 번을 켰고 응답자가 멤버일 때만 묻는다(익명은 모른다 — 언제나 거짓).
 * 화면은 폼 대신 "이미 응답했습니다" 를 보이고, 제출은 `already_submitted` 로 막는다.
 */
export async function alreadyResponded(form: Pick<PublicForm, 'viewId' | 'onePerRespondent'>, respondent: FormRespondent): Promise<boolean> {
  if (!form.onePerRespondent || respondent.kind !== 'member') return false
  return withReadTransaction((tx) => hasRespondedIn(tx, form.viewId, respondent.context.userId))
}

// ── 제출 토큰 ─────────────────────────────────────────────────────────

function secret(): string {
  const value = process.env.AUTH_SECRET
  if (!value) throw new Error('AUTH_SECRET 이 설정되지 않았습니다. .env.example 참조.')
  return value
}

const sign = (viewId: string, payload: string): string =>
  createHmac('sha256', secret()).update(`form-submission:${viewId}:${payload}`).digest('base64url')

/**
 * 제출 토큰 — 화면이 폼을 줄 때 만든다(정본 ⑥ ⓐ). `{발급 시각}.{난수}.{서명}` — 서명은 그 폼에 묶인다(다른 폼에 낼 수 없다). DB 에 쓰지
 * 않는다 — 폼을 여는 것마다 행이 쌓이면 그것이 남용 경로다. 한 번만 쓰는 것은 제출할 때 Valkey 가 본다.
 */
export function issueSubmissionToken(viewId: string, now: number = Date.now()): string {
  const payload = `${now}.${randomBytes(16).toString('base64url')}`
  return `${payload}.${sign(viewId, payload)}`
}

type TokenCheck = { readonly issuedAt: number; readonly nonce: string } | 'invalid_token' | 'expired' | 'too_fast'

function checkSubmissionToken(viewId: string, raw: unknown, now: number): TokenCheck {
  if (typeof raw !== 'string' || raw.length > 200) return 'invalid_token'
  const parts = raw.split('.')
  if (parts.length !== 3) return 'invalid_token'
  const [issued, nonce, signature] = parts as [string, string, string]
  if (!/^\d{1,16}$/.test(issued) || !/^[A-Za-z0-9_-]{22}$/.test(nonce)) return 'invalid_token'
  const expected = Buffer.from(sign(viewId, `${issued}.${nonce}`))
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'invalid_token'
  const issuedAt = Number(issued)
  if (now - issuedAt > SUBMISSION_TTL_MS) return 'expired'
  if (now - issuedAt < MIN_DWELL_MS) return 'too_fast'
  return { issuedAt, nonce }
}

/** 제출자의 지문 — `AUTH_SECRET` 키의 HMAC(원문 IP · UA 는 남지 않는다 · 신고와 같은 방식 · 다른 이름 공간). */
export function submitterHashOf(submitter: RequestMeta): string {
  return createHmac('sha256', secret())
    .update(`form:${submitter.ip ?? ''}|${submitter.userAgent ?? ''}`)
    .digest('hex')
}

// ── 제출 ──────────────────────────────────────────────────────────────

export type SubmitFailure =
  /** 열 수 없는 폼(없음 · 닫힘 · 정책 · 휴지통 — 이유를 말하지 않는다). */
  | 'not_found'
  /** 다른 사이트에서 보낸 요청. */
  | 'bad_origin'
  /** 제출 토큰이 없거나 틀렸거나 이미 썼다 — 화면을 다시 열어야 한다. */
  | 'invalid_token'
  /** 제출 토큰이 오래됐다(2시간). */
  | 'expired'
  /** 너무 빨리 냈다(3초) — 다시 내면 된다. */
  | 'too_fast'
  | 'rate_limited'
  /** 값이 틀렸다 — `issues` 가 질문마다 까닭을 말한다(`path` = 속성 id). */
  | 'invalid_value'
  /** 응답을 마감했다 — 상한에 닿았거나 마감 시각이 지났다(7b-2 · 정본 ⑩). */
  | 'form_closed'
  /** 이미 냈다 — 한 사람당 한 번인 폼(7b-3 · 정본 ⑪). */
  | 'already_submitted'

export type SubmitResult =
  | { readonly ok: true; readonly value: { readonly pageId: string | null } }
  | { readonly ok: false; readonly reason: SubmitFailure; readonly issues?: readonly ValidationIssue[] }

export type SubmitInput = {
  readonly token: string
  readonly submission: unknown
  /** 속성 id → 답. 그 폼의 질문이 아닌 칸은 버린다. */
  readonly answers: unknown
  /** 허니팟 — 사람에게 보이지 않는 칸. 차 있으면 받은 척한다. */
  readonly trap: unknown
  /** 요청의 `Origin` 헤더(없으면 null) · 이 서버의 출처. */
  readonly origin: string | null
  readonly serverOrigin: string
  readonly submitter: RequestMeta
  /** 로그인 세션의 토큰(쿠키) — 워크스페이스 멤버만의 폼(7b-1)에서만 읽는다. 웹 공개 폼은 보지 않는다. */
  readonly sessionToken?: string | null
}

export function submitFailureStatus(reason: SubmitFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'form_closed':
      return 410
    case 'already_submitted':
      return 409
    case 'rate_limited':
      return 429
    case 'bad_origin':
      return 403
    case 'invalid_token':
    case 'expired':
    case 'too_fast':
    case 'invalid_value':
      return 400
  }
}

/** 공개 폼의 응답을 받는다(정본 ⑥ ⓐ 의 순서). 허니팟에 걸리면 받은 척한다(`pageId: null`). */
export async function submitFormResponse(input: SubmitInput, now: number = Date.now()): Promise<SubmitResult> {
  if (input.origin !== null && input.origin !== input.serverOrigin) return { ok: false, reason: 'bad_origin' }
  // 허니팟 — 받은 척한다(봇이 실패를 보고 고쳐 오지 않게 · 신고와 같다)
  if (typeof input.trap === 'string' && input.trap.trim() !== '') return { ok: true, value: { pageId: null } }

  const form = await readPublicForm(input.token)
  if (form === null) return { ok: false, reason: 'not_found' }
  // 워크스페이스 멤버만의 폼 — 멤버가 아니면(로그인하지 않았어도) 열 수 없는 폼과 같다(이유를 말하지 않는다 · ⑨)
  const respondent = await resolveFormRespondent(form, input.sessionToken ?? null)
  if (respondent.kind === 'login' || respondent.kind === 'denied') return { ok: false, reason: 'not_found' }
  const member = respondent.kind === 'member' ? respondent.context : null
  // 마감 — 열 수 있는 폼에만 말한다(토큰 · 값 검사 전에 · 정본 ⑩)
  if (form.closedBecause !== null) return { ok: false, reason: 'form_closed' }
  // 한 사람당 한 번 — 마감 다음 · 토큰 전(정본 ⑪). 익명이면 묻지 않는다
  if (await alreadyResponded(form, respondent)) return { ok: false, reason: 'already_submitted' }

  const token = checkSubmissionToken(form.viewId, input.submission, now)
  if (typeof token === 'string') return { ok: false, reason: token }

  const hash = submitterHashOf(input.submitter)
  // 제출자 × 폼 — 멤버면 그 사람이 제출자다(같은 사람이 여러 기기에서 내도 하나로 센다)
  const who = member === null ? hash : `user:${member.userId}`
  if (!(await consume('form:who', `${form.viewId}:${who}`, SUBMITTER_RATE_LIMIT)).allowed) return { ok: false, reason: 'rate_limited' }
  if (!(await consume('form:all', form.viewId, FORM_RATE_LIMIT)).allowed) return { ok: false, reason: 'rate_limited' }

  const parsed = parseAnswers(form, input.answers)
  if (!parsed.ok) return { ok: false, reason: 'invalid_value', issues: parsed.issues }

  // 값이 맞을 때만 토큰을 쓴다 — 고쳐 다시 내는 사람이 같은 화면의 토큰으로 낸다
  if (!(await claimOnce('form-submission', token.nonce, Math.ceil(SUBMISSION_TTL_MS / 1000)))) {
    return { ok: false, reason: 'invalid_token' }
  }

  return withTransaction(async (tx): Promise<SubmitResult> => {
    // 토큰을 읽은 뒤 닫혔을 수 있다 — 같은 트랜잭션에서 다시 본다(닫기와 줄을 세운다)
    // 폼 행을 잠근다 — 동시 제출이 상한을 넘지 않게 그 사이 세기를 줄 세운다(7b-2 · 정본 ⑩)
    const still = await tx.queryMaybe<{ max_responses: number | null; closes_at: Date | null; one_per_respondent: boolean }>(
      `SELECT max_responses, closes_at, one_per_respondent FROM form_view WHERE view_id = $1 AND access = $3 AND token = $2 FOR UPDATE`,
      [form.viewId, input.token, form.access],
    )
    if (still === null) return { ok: false, reason: 'not_found' }
    const closed = formClosedReason(
      { maxResponses: still.max_responses, closesAt: still.closes_at === null ? null : still.closes_at.toISOString() },
      still.max_responses === null ? 0 : await countFormResponsesIn(tx, form.viewId),
      now,
    )
    if (closed !== null) return { ok: false, reason: 'form_closed' }
    // 같은 잠금 아래에서 다시 본다 — 같은 사람이 두 탭에서 동시에 내도 하나만(정본 ⑪)
    if (member !== null && still.one_per_respondent && (await hasRespondedIn(tx, form.viewId, member.userId))) {
      return { ok: false, reason: 'already_submitted' }
    }
    const row =
      member === null
        ? await createAnonymousRowIn(tx, form.workspaceId, form.dataSourceId, parsed.cells)
        : await createRespondentRowIn(tx, member, form.dataSourceId, parsed.cells)
    if (!row.ok) {
      // 질문의 속성이 그사이 바뀌었다 — 값이 맞지 않는다
      return { ok: false, reason: 'invalid_value', issues: 'issues' in row ? row.issues : [] }
    }
    await tx.query(
      `INSERT INTO form_submission_meta (page_id, view_id, submitter_hash, dwell_ms) VALUES ($1, $2, $3, $4)`,
      [row.value.id, form.viewId, hash, Math.max(0, now - token.issuedAt)],
    )
    return { ok: true, value: { pageId: row.value.id } }
  })
}

type ParsedAnswers =
  | { readonly ok: true; readonly cells: { readonly propertyId: string; readonly value: CellValue }[] }
  | { readonly ok: false; readonly issues: ValidationIssue[] }

/** 답 → 칸 값. 그 폼의 질문만 · 필수 · 타입마다 모양 · 선택은 그 속성의 옵션 id. */
function parseAnswers(form: PublicForm, raw: unknown): ParsedAnswers {
  const answers = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const cells: { propertyId: string; value: CellValue }[] = []
  const issues: ValidationIssue[] = []
  const issue = (propertyId: string, message: string) => issues.push({ path: propertyId, message })

  for (const q of form.questions) {
    const answer = Object.hasOwn(answers, q.propertyId) ? answers[q.propertyId] : undefined
    switch (q.type) {
      case 'title':
      case 'rich_text': {
        if (answer !== undefined && answer !== null && typeof answer !== 'string') {
          issue(q.propertyId, '글이어야 합니다')
          break
        }
        const text = typeof answer === 'string' ? answer.trim() : ''
        if (text.length > MAX_ANSWER_LENGTH) issue(q.propertyId, `${MAX_ANSWER_LENGTH}자까지입니다`)
        else if (text === '') {
          if (q.required) issue(q.propertyId, '답해야 하는 질문입니다')
        } else {
          cells.push({
            propertyId: q.propertyId,
            value: q.type === 'title' ? { type: 'title', title: [textRun(text)] } : { type: 'rich_text', rich_text: [textRun(text)] },
          })
        }
        break
      }
      case 'number': {
        const text = typeof answer === 'number' ? String(answer) : typeof answer === 'string' ? answer.trim() : ''
        if (answer !== undefined && answer !== null && typeof answer !== 'string' && typeof answer !== 'number') issue(q.propertyId, '숫자여야 합니다')
        else if (text === '') {
          if (q.required) issue(q.propertyId, '답해야 하는 질문입니다')
        } else {
          const n = Number(text)
          if (!Number.isFinite(n)) issue(q.propertyId, '숫자여야 합니다')
          else cells.push({ propertyId: q.propertyId, value: { type: 'number', number: n } })
        }
        break
      }
      case 'select': {
        const id = typeof answer === 'string' ? answer : ''
        if (id === '') {
          if (q.required) issue(q.propertyId, '답해야 하는 질문입니다')
        } else if (!q.options.some((o) => o.id === id)) issue(q.propertyId, '고를 수 있는 답이 아닙니다')
        else cells.push({ propertyId: q.propertyId, value: { type: 'select', select: { id } } })
        break
      }
      case 'checkbox': {
        const checked = answer === true || answer === 'true' || answer === 'on'
        if (q.required && !checked) issue(q.propertyId, '확인해야 하는 질문입니다')
        else cells.push({ propertyId: q.propertyId, value: { type: 'checkbox', checkbox: checked } })
        break
      }
      case 'date': {
        const text = typeof answer === 'string' ? answer.trim() : ''
        if (text === '') {
          if (q.required) issue(q.propertyId, '답해야 하는 질문입니다')
        } else if (!DATE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) issue(q.propertyId, '날짜가 아닙니다')
        else cells.push({ propertyId: q.propertyId, value: { type: 'date', date: { start: text } } })
        break
      }
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, cells }
}
