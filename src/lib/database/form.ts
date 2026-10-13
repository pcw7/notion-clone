/**
 * 폼 — 데이터베이스의 뷰 · 질문은 속성 (인접 제품 7a-1 · F-13-01)
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ①~⑤ · 마이그레이션 0094
 *       13 F-13-01 *"폼은 독립 엔티티가 아니라 데이터베이스의 뷰다 · 질문 1개 = 프로퍼티 1개 · 응답 = DB 행 그 자체"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이 파일은 폼을 **만들고 고치기만** 한다 — 공개 제출은 7a-2
 * ──────────────────────────────────────────────────────────────────────
 *
 * 폼은 `view.type = 'form'` 인 뷰 하나와 그 설정(`form_view`) · 질문(`form_question`)이다. 행을 그리지 않는다.
 *
 *   · 누가 — 만들기 · 설정 · 질문은 데이터베이스의 구조를 고치는 사람(`edit_structure` — 뷰와 같다 · 잠기면 `locked`). 읽기는 표를 여는
 *     사람(`canOpenDatabase`). **공개로 여는 것**은 데이터베이스의 `manage_perm` + 워크스페이스 정책(웹 게시와 같은 문 · 정본 ③).
 *     공개 주소의 토큰은 공개를 바꿀 수 있는 사람에게만 준다(웹 게시의 토큰과 같다).
 *   · 질문 — 그 data source 의 살아 있는 속성 · 받는 타입만(`FORM_QUESTION_TYPES` · 정본 ②). 목록을 통째로 바꾼다 — 휴지통의 속성에 걸린
 *     질문 행은 남긴다(되살리면 돌아온다).
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { recordForContextIn } from '../audit/audit.ts'
import { orderKeyBetween } from '../block/order-key.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can, type CapSet } from '../permissions/levels.ts'
import { isLocked } from '../permissions/lock.ts'
import { newPublicToken } from '../publish/public-token.ts'
import { readSecurityPolicyIn } from '../workspace/security-policy.ts'
import { formClosedReason, parseClosesAt, parseMaxResponses, type FormClosedReason } from './form-limits.ts'
import { canOpenDatabase } from './row-access.ts'

/** 질문으로 받는 속성 타입(v1 — 정본 ②). 상태 · 사람 · 관계형 · 파일 · 계산 열은 받지 않는다. */
export const FORM_QUESTION_TYPES = ['title', 'rich_text', 'number', 'select', 'checkbox', 'date'] as const
export type FormQuestionType = (typeof FORM_QUESTION_TYPES)[number]
export const isFormQuestionType = (t: unknown): t is FormQuestionType => (FORM_QUESTION_TYPES as readonly unknown[]).includes(t)

export const DEFAULT_FORM_NAME = '폼'
const MAX_VIEW_NAME = 100
/** 0094 의 CHECK 과 같은 길이. */
const LIMITS = { title: 200, description: 2000, submitLabel: 40, confirmationTitle: 200, confirmationBody: 2000, label: 200, helpText: 1000 }
export const MAX_FORM_QUESTIONS = 50

/** 닫힘 · 웹 공개(익명) · 워크스페이스 멤버만(응답자를 남긴다 — 7b-1 · 정본 ⑨). */
export type FormAccess = 'closed' | 'public' | 'workspace'
export type { FormClosedReason }

export const FORM_ACCESS: readonly FormAccess[] = ['closed', 'public', 'workspace']

export type FormSettings = {
  readonly title: string | null
  readonly description: string | null
  readonly submitLabel: string | null
  readonly confirmationTitle: string | null
  readonly confirmationBody: string | null
  readonly access: FormAccess
  /** 공개 주소의 토큰 — 공개를 바꿀 수 있는 사람에게만(웹 게시와 같다). 아직 만들지 않았으면 null. */
  readonly token: string | null
  /** 응답 상한(7b-2 · 정본 ⑩) — 비면 없다. */
  readonly maxResponses: number | null
  /** 마감 시각(ISO) — 비면 없다. */
  readonly closesAt: string | null
  /** 한 사람당 한 번(7b-3 · 정본 ⑪) — 워크스페이스 멤버만의 폼에서만 막는다(웹 공개 폼은 응답자를 모른다). */
  readonly onePerRespondent: boolean
}

export type FormQuestion = {
  readonly propertyId: string
  /** 속성의 지금 이름 — 질문 제목이 비면 이것이 제목이다. */
  readonly propertyName: string
  readonly type: FormQuestionType
  readonly label: string | null
  readonly helpText: string | null
  readonly required: boolean
}

export type FormDetail = {
  readonly viewId: string
  readonly databaseId: string
  readonly dataSourceId: string
  readonly name: string
  readonly settings: FormSettings
  /** 살아 있는 속성의 질문 — 순서대로. 휴지통의 속성에 걸린 질문은 빠진다(행은 남는다). */
  readonly questions: readonly FormQuestion[]
  /** 질문으로 더할 수 있는 속성(받는 타입 · 아직 질문이 아닌 것) — 스키마 순. */
  readonly candidates: readonly { readonly propertyId: string; readonly name: string; readonly type: FormQuestionType }[]
  /** 설정 · 질문을 고칠 수 있는가(`edit_structure` · 잠기지 않았다). */
  readonly canEdit: boolean
  /** 공개 · 닫기를 바꿀 수 있는가(`manage_perm`). */
  readonly canPublish: boolean
  /** 워크스페이스 정책이 공개를 허용하는가 — 막으면 공개된 폼도 열리지 않는다(7a-2). */
  readonly policyAllows: boolean
  /** 이 폼으로 받은 살아 있는 응답의 수(7b-2 — 상한이 세는 것). */
  readonly responseCount: number
  /** 닫혔다면 그 까닭(상한 · 마감 시각) — `access` 와 따로다(닫힘은 판정이다 · 정본 ⑩). */
  readonly closedBecause: FormClosedReason | null
}

export type FormFailure =
  | 'not_found'
  | 'forbidden'
  | 'locked'
  | 'invalid_input'
  /** 받지 않는 속성 타입이거나 그 data source 의 살아 있는 속성이 아니다. */
  | 'unsupported_type'
  /** 워크스페이스 정책이 공개를 막았다. */
  | 'policy_disabled'

export type FormResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: FormFailure }

export function formFailureStatus(reason: FormFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'locked':
    case 'policy_disabled':
      return 409
    case 'invalid_input':
    case 'unsupported_type':
      return 400
  }
}

const fail = (reason: FormFailure): { readonly ok: false; readonly reason: FormFailure } => ({ ok: false, reason })

// ── 문 ────────────────────────────────────────────────────────────────

type DatabaseGate = { readonly databaseId: string; readonly caps: CapSet; readonly locked: boolean }

/** 이 워크스페이스의 살아 있는 데이터베이스를 열 수 있는가 — 열 수 없으면 null(없는 것과 같다). */
async function openDatabaseIn(tx: Tx, ctx: SessionContext, databaseId: string): Promise<DatabaseGate | null> {
  if (!isUuid(databaseId)) return null
  const row = await tx.queryMaybe<{ id: string }>(
    `SELECT d.id FROM database d JOIN block b ON b.id = d.id
      WHERE d.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'`,
    [databaseId, ctx.workspaceId],
  )
  if (row === null) return null
  const caps = await effectiveCaps(tx, ctx, databaseId)
  if (!canOpenDatabase(caps)) return null
  return { databaseId, caps, locked: await isLocked(tx, databaseId) }
}

type FormGate = DatabaseGate & { readonly viewId: string; readonly dataSourceId: string; readonly name: string }

/** 폼 뷰를 연다 — 폼이 아니거나 열 수 없으면 null. 붙인 소스의 폼은 없다(만들 때 소유한 소스만 받는다). */
async function openFormIn(tx: Tx, ctx: SessionContext, viewId: string): Promise<FormGate | null> {
  if (!isUuid(viewId)) return null
  const view = await tx.queryMaybe<{ database_id: string; data_source_id: string; name: string | null }>(
    `SELECT v.database_id, v.data_source_id, v.name
       FROM view v
       JOIN form_view f ON f.view_id = v.id
       JOIN data_source ds ON ds.id = v.data_source_id
      WHERE v.id = $1 AND v.type = 'form' AND v.owner_kind = 'database_view' AND ds.lifecycle = 'live'`,
    [viewId],
  )
  if (view === null) return null
  const gate = await openDatabaseIn(tx, ctx, view.database_id)
  if (gate === null) return null
  return { ...gate, viewId, dataSourceId: view.data_source_id, name: view.name ?? DEFAULT_FORM_NAME }
}

function editDenied(gate: DatabaseGate): FormFailure | null {
  if (!can(gate.caps, 'edit_structure')) return 'forbidden'
  if (gate.locked) return 'locked'
  return null
}

// ── 읽기 ──────────────────────────────────────────────────────────────

async function readFormIn(tx: Tx, ctx: SessionContext, gate: FormGate): Promise<FormDetail> {
  const settings = await tx.queryOne<{
    title: string | null
    description: string | null
    submit_label: string | null
    confirmation_title: string | null
    confirmation_body: string | null
    access: FormAccess
    token: string | null
    max_responses: number | null
    closes_at: Date | null
    one_per_respondent: boolean
  }>(
    `SELECT title, description, submit_label, confirmation_title, confirmation_body, access, token, max_responses, closes_at, one_per_respondent
       FROM form_view WHERE view_id = $1`,
    [gate.viewId],
  )
  const responseCount = await countFormResponsesIn(tx, gate.viewId)
  const limits = { maxResponses: settings.max_responses, closesAt: settings.closes_at === null ? null : settings.closes_at.toISOString() }
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
      WHERE q.view_id = $1 AND p.deleted_at IS NULL AND p.type::text = ANY($2::text[])
      ORDER BY q.order_key`,
    [gate.viewId, FORM_QUESTION_TYPES],
  )
  const asked = new Set(questions.map((q) => q.property_id))
  const properties = await tx.query<{ id: string; name: string; type: FormQuestionType }>(
    `SELECT id, name, type FROM property
      WHERE data_source_id = $1 AND deleted_at IS NULL AND type::text = ANY($2::text[])
      ORDER BY order_idx, id`,
    [gate.dataSourceId, FORM_QUESTION_TYPES],
  )
  const canPublish = can(gate.caps, 'manage_perm')
  const policy = await readSecurityPolicyIn(tx, ctx.workspaceId)
  return {
    viewId: gate.viewId,
    databaseId: gate.databaseId,
    dataSourceId: gate.dataSourceId,
    name: gate.name,
    settings: {
      title: settings.title,
      description: settings.description,
      submitLabel: settings.submit_label,
      confirmationTitle: settings.confirmation_title,
      confirmationBody: settings.confirmation_body,
      access: settings.access,
      token: canPublish ? settings.token : null,
      maxResponses: limits.maxResponses,
      closesAt: limits.closesAt,
      onePerRespondent: settings.one_per_respondent,
    },
    questions: questions.map((q) => ({
      propertyId: q.property_id,
      propertyName: q.name,
      type: q.type,
      label: q.label,
      helpText: q.help_text,
      required: q.required,
    })),
    candidates: properties.filter((p) => !asked.has(p.id)).map((p) => ({ propertyId: p.id, name: p.name, type: p.type })),
    canEdit: editDenied(gate) === null,
    canPublish,
    policyAllows: policy.allowPublish,
    responseCount,
    closedBecause: formClosedReason(limits, responseCount),
  }
}

/**
 * 이 폼으로 받은 살아 있는 응답의 수(7b-2 · 정본 ⑩) — 메타 사이드카로 센다(공개 · 워크스페이스 멤버만 모두 남긴다). 휴지통의 행은 세지
 * 않는다 — 지운 응답은 자리를 돌려준다.
 */
export async function countFormResponsesIn(tx: Tx, viewId: string): Promise<number> {
  const row = await tx.queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM form_submission_meta m JOIN block b ON b.id = m.page_id
      WHERE m.view_id = $1 AND b.lifecycle = 'live'`,
    [viewId],
  )
  return row.n
}

/**
 * 그 사람이 이 폼으로 낸 살아 있는 응답이 있는가(7b-3 · 정본 ⑪ — 한 사람당 한 번) — 응답의 만든 사람으로 본다(워크스페이스 멤버만의 폼이
 * 남긴다 · 공개 폼의 응답은 NULL). 셈은 `countFormResponsesIn` 과 같다 — 휴지통의 응답은 빼고(지우면 다시 낸다), 켜기 전의 응답도 넣는다.
 */
export async function hasRespondedIn(tx: Tx, viewId: string, userId: string): Promise<boolean> {
  const row = await tx.queryOne<{ answered: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM form_submission_meta m JOIN block b ON b.id = m.page_id
        WHERE m.view_id = $1 AND b.created_by = $2 AND b.lifecycle = 'live'
     ) AS answered`,
    [viewId, userId],
  )
  return row.answered
}

/** 폼을 읽는다 — 표를 여는 사람. 폼이 아니면 not_found. */
export async function readForm(ctx: SessionContext, viewId: string): Promise<FormResult<FormDetail>> {
  return withReadTransaction(async (tx) => {
    const gate = await openFormIn(tx, ctx, viewId)
    if (gate === null) return fail('not_found')
    return { ok: true, value: await readFormIn(tx, ctx, gate) } as const
  })
}

// ── 만들기 ────────────────────────────────────────────────────────────

/**
 * 폼 뷰를 만든다 — 그 데이터베이스가 **소유한** data source 의 뷰 탭 끝에. 첫 질문은 제목 속성(응답의 이름 칸)이다. 뷰의 열(`view_property`)도
 * 다른 뷰처럼 심는다 — 폼을 다른 종류로 바꾸는 길은 없지만 뷰 행의 모양은 같게 둔다.
 */
export async function createFormView(
  ctx: SessionContext,
  databaseId: string,
  input: { readonly name?: unknown; readonly dataSourceId?: unknown } = {},
): Promise<FormResult<FormDetail>> {
  const name = input.name === undefined ? DEFAULT_FORM_NAME : typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : null
  if (name === null || name.length === 0 || name.length > MAX_VIEW_NAME) return fail('invalid_input')
  if (input.dataSourceId !== undefined && (typeof input.dataSourceId !== 'string' || !isUuid(input.dataSourceId))) return fail('invalid_input')

  return withCommandTransaction(async (tx) => {
    const gate = await openDatabaseIn(tx, ctx, databaseId)
    if (gate === null) return fail('not_found')
    const denied = editDenied(gate)
    if (denied !== null) return fail(denied)

    // 소유한 살아 있는 소스만 — 붙인 소스(다른 데이터베이스의 행)에 응답을 쓰게 두지 않는다
    const source = await tx.queryMaybe<{ id: string }>(
      `SELECT ds.id FROM database_data_source dds JOIN data_source ds ON ds.id = dds.data_source_id
        WHERE dds.database_id = $1 AND ds.owner_database_id = $1 AND ds.lifecycle = 'live'
          AND ($2::uuid IS NULL OR ds.id = $2::uuid)
        ORDER BY dds.order_idx, ds.id LIMIT 1`,
      [databaseId, (input.dataSourceId as string | undefined) ?? null],
    )
    if (source === null) return fail('not_found')

    const last = await tx.queryMaybe<{ order_idx: string }>(
      `SELECT order_idx FROM view WHERE database_id = $1 AND owner_kind = 'database_view' ORDER BY order_idx DESC LIMIT 1`,
      [databaseId],
    )
    const viewId = randomUUID()
    await tx.query(
      `INSERT INTO view (id, owner_kind, database_id, data_source_id, name, type, order_idx, configuration, created_at, updated_at)
       VALUES ($1, 'database_view', $2, $3, $4, 'form', $5, '{}'::jsonb, now(), now())`,
      [viewId, databaseId, source.id, name, orderKeyBetween(last?.order_idx ?? null, null)],
    )
    await tx.query(
      `INSERT INTO view_property (view_id, property_id, visible, order_idx)
       SELECT $1, p.id, true, p.order_idx FROM property p WHERE p.data_source_id = $2 AND p.deleted_at IS NULL`,
      [viewId, source.id],
    )
    await tx.query(`INSERT INTO form_view (view_id, updated_by) VALUES ($1, $2)`, [viewId, ctx.userId])
    // 첫 질문 — 제목(응답의 이름 칸)
    await tx.query(
      `INSERT INTO form_question (view_id, property_id, order_key)
       SELECT $1, p.id, $3 FROM property p WHERE p.data_source_id = $2 AND p.type = 'title' AND p.deleted_at IS NULL LIMIT 1`,
      [viewId, source.id, orderKeyBetween(null, null)],
    )
    const form = await openFormIn(tx, ctx, viewId)
    if (form === null) return fail('not_found')
    return { ok: true, value: await readFormIn(tx, ctx, form) } as const
  })
}

// ── 설정 ──────────────────────────────────────────────────────────────

export type FormSettingsPatch = {
  readonly title?: string | null
  readonly description?: string | null
  readonly submitLabel?: string | null
  readonly confirmationTitle?: string | null
  readonly confirmationBody?: string | null
  readonly access?: FormAccess
}

const TEXT_FIELDS = [
  ['title', 'title', LIMITS.title],
  ['description', 'description', LIMITS.description],
  ['submitLabel', 'submit_label', LIMITS.submitLabel],
  ['confirmationTitle', 'confirmation_title', LIMITS.confirmationTitle],
  ['confirmationBody', 'confirmation_body', LIMITS.confirmationBody],
] as const

/** 글 칸 — 앞뒤 공백을 걷고 비면 null(기본 문구를 쓴다). 길이를 넘으면 undefined(틀렸다). */
function normalizeText(raw: unknown, max: number): string | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'string') return undefined
  const text = raw.trim()
  if (text === '') return null
  return text.length > max ? undefined : text
}

/**
 * 폼의 설정을 고친다 — 글 칸은 구조를 고치는 사람, **공개 · 닫기**는 `manage_perm`(정본 ③). 공개로 처음 열 때 토큰을 만든다 · 닫아도
 * 토큰은 남는다(다시 열면 같은 주소). 공개 · 닫기는 감사 로그(`page.publish_changed` — 웹 게시와 같은 종류).
 */
export async function updateFormSettings(ctx: SessionContext, viewId: string, patch: unknown): Promise<FormResult<FormDetail>> {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return fail('invalid_input')
  const input = patch as Record<string, unknown>
  const known = new Set<string>([...TEXT_FIELDS.map(([key]) => key), 'access', 'maxResponses', 'closesAt', 'onePerRespondent'])
  if (Object.keys(input).length === 0 || Object.keys(input).some((key) => !known.has(key))) return fail('invalid_input')
  if (input.access !== undefined && !(FORM_ACCESS as readonly unknown[]).includes(input.access)) return fail('invalid_input')
  const sets: { column: string; value: string | number | boolean | null }[] = []
  for (const [key, column, max] of TEXT_FIELDS) {
    if (!(key in input)) continue
    const value = normalizeText(input[key], max)
    if (value === undefined) return fail('invalid_input')
    sets.push({ column, value })
  }
  // 응답 상한 · 마감 시각(7b-2 · 정본 ⑩) — 글 칸과 같은 문(구조를 고치는 사람)
  if ('maxResponses' in input) {
    const value = parseMaxResponses(input.maxResponses)
    if (value === undefined) return fail('invalid_input')
    sets.push({ column: 'max_responses', value })
  }
  if ('closesAt' in input) {
    const value = parseClosesAt(input.closesAt)
    if (value === undefined) return fail('invalid_input')
    sets.push({ column: 'closes_at', value })
  }
  // 한 사람당 한 번(7b-3 · 정본 ⑪) — 받는 규칙이다(상한과 같은 문) · 공유와 따로 둔다(웹 공개 폼에 켜 두어도 막지 않는다)
  if ('onePerRespondent' in input) {
    if (typeof input.onePerRespondent !== 'boolean') return fail('invalid_input')
    sets.push({ column: 'one_per_respondent', value: input.onePerRespondent })
  }

  return withCommandTransaction(async (tx) => {
    const gate = await openFormIn(tx, ctx, viewId)
    if (gate === null) return fail('not_found')
    const before = await tx.queryOne<{ access: FormAccess; token: string | null }>(
      `SELECT access, token FROM form_view WHERE view_id = $1 FOR UPDATE`,
      [viewId],
    )
    const access = input.access as FormAccess | undefined
    const accessChanges = access !== undefined && access !== before.access
    if (sets.length > 0) {
      const denied = editDenied(gate)
      if (denied !== null) return fail(denied)
    }
    if (accessChanges) {
      if (!can(gate.caps, 'manage_perm')) return fail('forbidden')
      // 웹에 여는 것만 정책을 묻는다 — 닫는 것은 언제나 된다(웹 게시와 같다) · 워크스페이스 멤버만은 밖으로 내보내는 것이 아니다(⑨)
      if (access === 'public' && !(await readSecurityPolicyIn(tx, ctx.workspaceId)).allowPublish) return fail('policy_disabled')
    }

    const params: unknown[] = [viewId, ctx.userId]
    const assignments = sets.map(({ column, value }) => {
      params.push(value)
      return `${column} = $${params.length}`
    })
    if (accessChanges) {
      params.push(access, before.token ?? newPublicToken())
      assignments.push(`access = $${params.length - 1}`, `token = $${params.length}`)
    }
    if (assignments.length > 0) {
      await tx.query(
        `UPDATE form_view SET ${assignments.join(', ')}, updated_by = $2, updated_at = now() WHERE view_id = $1`,
        params,
      )
    }
    if (accessChanges) {
      await recordForContextIn(tx, ctx, 'page.publish_changed', {
        target: { type: 'page', id: gate.databaseId },
        metadata: { change: access === 'public' ? 'form_open' : access === 'workspace' ? 'form_open_workspace' : 'form_close', viewId },
      })
    }
    return { ok: true, value: await readFormIn(tx, ctx, gate) } as const
  })
}

// ── 질문 ──────────────────────────────────────────────────────────────

export type FormQuestionInput = {
  readonly propertyId: string
  readonly label?: string | null
  readonly helpText?: string | null
  readonly required?: boolean
}

/**
 * 질문 목록을 통째로 바꾼다 — 순서대로. 같은 속성 두 번 · 받지 않는 타입 · 다른 표의 속성 · 지운 속성은 거부한다(아무것도 바꾸지 않는다).
 * 휴지통의 속성에 걸린 질문 행은 남긴다(되살리면 돌아온다 · 정본 ②) — 새 질문은 그 뒤의 키를 받는다.
 */
export async function setFormQuestions(ctx: SessionContext, viewId: string, raw: unknown): Promise<FormResult<FormDetail>> {
  if (!Array.isArray(raw) || raw.length > MAX_FORM_QUESTIONS) return fail('invalid_input')
  const questions: { propertyId: string; label: string | null; helpText: string | null; required: boolean }[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return fail('invalid_input')
    const q = item as Record<string, unknown>
    if (typeof q.propertyId !== 'string' || q.propertyId === '') return fail('invalid_input')
    if (q.required !== undefined && typeof q.required !== 'boolean') return fail('invalid_input')
    const label = q.label === undefined ? null : normalizeText(q.label, LIMITS.label)
    const helpText = q.helpText === undefined ? null : normalizeText(q.helpText, LIMITS.helpText)
    if (label === undefined || helpText === undefined) return fail('invalid_input')
    questions.push({ propertyId: q.propertyId, label, helpText, required: q.required === true })
  }
  if (new Set(questions.map((q) => q.propertyId)).size !== questions.length) return fail('invalid_input')

  return withCommandTransaction(async (tx) => {
    const gate = await openFormIn(tx, ctx, viewId)
    if (gate === null) return fail('not_found')
    const denied = editDenied(gate)
    if (denied !== null) return fail(denied)
    await tx.query(`SELECT 1 FROM form_view WHERE view_id = $1 FOR UPDATE`, [viewId])

    const ids = questions.map((q) => q.propertyId)
    const live = await tx.query<{ id: string }>(
      `SELECT id FROM property
        WHERE id = ANY($1::text[]) AND data_source_id = $2 AND deleted_at IS NULL AND type::text = ANY($3::text[])`,
      [ids, gate.dataSourceId, FORM_QUESTION_TYPES],
    )
    if (live.length !== ids.length) return fail('unsupported_type')

    // 살아 있는 속성의 질문만 지우고(휴지통의 것은 남긴다) 새 목록을 그 뒤에 넣는다
    await tx.query(
      `DELETE FROM form_question q USING property p
        WHERE q.view_id = $1 AND p.id = q.property_id AND p.deleted_at IS NULL`,
      [viewId],
    )
    const kept = await tx.queryMaybe<{ order_key: string }>(
      `SELECT order_key FROM form_question WHERE view_id = $1 ORDER BY order_key DESC LIMIT 1`,
      [viewId],
    )
    let previous = kept?.order_key ?? null
    for (const q of questions) {
      const key = orderKeyBetween(previous, null)
      await tx.query(
        `INSERT INTO form_question (view_id, property_id, order_key, label, help_text, required) VALUES ($1, $2, $3, $4, $5, $6)`,
        [viewId, q.propertyId, key, q.label, q.helpText, q.required],
      )
      previous = key
    }
    await tx.query(`UPDATE form_view SET updated_by = $2, updated_at = now() WHERE view_id = $1`, [viewId, ctx.userId])
    return { ok: true, value: await readFormIn(tx, ctx, gate) } as const
  })
}
