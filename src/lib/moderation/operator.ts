/**
 * 모더레이션 — 운영자의 조치 · 목록 (게시 · 공유 6b-2 · F-17-09)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 모더레이션 조치 ①~⑥
 *       17-ops-governance.md F-17-09 클론 대안 *"운영자 콘솔 대신 관리자 CLI 1개로 시작"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 운영자는 워크스페이스의 주체가 아니다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 이 파일의 함수는 `SessionContext` 를 받지 않는다 — 셋째 발급자를 만들지 않는다(CLAUDE.md). 운영자는 서버에 셸로 들어온 사람이고
 * (`npm run moderation` · `scripts/moderation.mjs`), 워크스페이스 안의 판정(`effective()`)과 무관하다. **HTTP 라우트에서 이 파일을
 * 부르지 않는다.** 누가 했는지는 운영자가 적은 이름(`actor`)으로 남는다.
 *
 * 조치마다 `moderation_action` 에 한 줄이 쌓인다(0086 — 고치기 · 지우기를 트리거가 막는다). 지금 상태는 블록의 `moderation_state` 다.
 */

import { randomUUID } from 'node:crypto'

import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'

export const TAKEDOWN_REASONS = ['phishing', 'malware', 'illegal', 'harassment', 'copyright', 'spam', 'other'] as const
export type TakedownReason = (typeof TAKEDOWN_REASONS)[number]

export function isTakedownReason(value: unknown): value is TakedownReason {
  return typeof value === 'string' && (TAKEDOWN_REASONS as readonly string[]).includes(value)
}

/** 운영자의 이름 · 메모 — 0086 의 CHECK 과 같은 상한. */
export const MAX_ACTOR_LENGTH = 100
export const MAX_ACTION_NOTE = 2000

export type OperatorInput = { readonly actor: string; readonly note?: string }

export type OperatorFailure =
  /** 그런 페이지 · 케이스가 없다. */
  | 'not_found'
  /** 이름이 비었거나 길다 · 메모가 길다 · 까닭이 틀렸다. */
  | 'invalid_input'
  /** 이미 내려져 있다(take_down). */
  | 'already'
  /** 열린 케이스가 아니다(dismiss). */
  | 'not_open'
  /** 내려져 있지 않다(reinstate). */
  | 'not_moderated'

export type OperatorResult<T = { readonly actionId: string }> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: OperatorFailure }

function cleanInput(input: OperatorInput): { actor: string; note: string } | null {
  const actor = typeof input.actor === 'string' ? input.actor.trim() : ''
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (actor === '' || actor.length > MAX_ACTOR_LENGTH || note.length > MAX_ACTION_NOTE) return null
  return { actor, note }
}

type PageRow = { id: string; workspace_id: string; moderation_state: string }

async function lockPage(tx: Tx, pageId: string): Promise<PageRow | null> {
  if (!isUuid(pageId)) return null
  return tx.queryMaybe<PageRow>(
    `SELECT id, workspace_id, moderation_state FROM block WHERE id = $1 AND type = 'page' FOR UPDATE`,
    [pageId],
  )
}

async function recordAction(
  tx: Tx,
  row: { caseId: string | null; pageId: string; workspaceId: string; action: 'take_down' | 'dismiss' | 'reinstate'; reason: TakedownReason | null },
  who: { actor: string; note: string },
): Promise<string> {
  const id = randomUUID()
  await tx.query(
    `INSERT INTO moderation_action (id, case_id, target_type, target_id, workspace_id, action, reason_code, note, actor)
     VALUES ($1, $2, 'page', $3, $4, $5, $6, $7, $8)`,
    [id, row.caseId, row.pageId, row.workspaceId, row.action, row.reason, who.note, who.actor],
  )
  return id
}

/**
 * 페이지를 내린다(정본 ②) — `moderation_state := 'taken_down'`. 공개 경로가 그 페이지와 그 아래 전체를 닫는다. 워크스페이스 안에서는
 * 그대로다(`lifecycle` 을 건드리지 않는다). 그 페이지의 열린 케이스는 `actioned` 로 닫힌다.
 */
export async function takeDownPage(pageId: string, reason: unknown, input: OperatorInput): Promise<OperatorResult> {
  const who = cleanInput(input)
  if (who === null || !isTakedownReason(reason)) return { ok: false, reason: 'invalid_input' }
  return withCommandTransaction(async (tx) => {
    const page = await lockPage(tx, pageId)
    if (page === null) return { ok: false, reason: 'not_found' } as const
    if (page.moderation_state === 'taken_down') return { ok: false, reason: 'already' } as const

    await tx.query(`UPDATE block SET moderation_state = 'taken_down' WHERE id = $1`, [page.id])
    const closed = await tx.queryMaybe<{ id: string }>(
      `UPDATE moderation_case SET state = 'actioned', closed_at = now()
        WHERE target_type = 'page' AND target_id = $1 AND state IN ('open', 'investigating')
        RETURNING id`,
      [page.id],
    )
    const actionId = await recordAction(
      tx,
      { caseId: closed?.id ?? null, pageId: page.id, workspaceId: page.workspace_id, action: 'take_down', reason },
      who,
    )
    return { ok: true, value: { actionId } } as const
  })
}

/** 케이스를 기각한다(정본 ③) — 열린 케이스만. 그 페이지가 `reported` 였으면 `none` 으로. */
export async function dismissCase(caseId: string, input: OperatorInput): Promise<OperatorResult> {
  const who = cleanInput(input)
  if (who === null) return { ok: false, reason: 'invalid_input' }
  if (!isUuid(caseId)) return { ok: false, reason: 'not_found' }
  return withCommandTransaction(async (tx) => {
    const kase = await tx.queryMaybe<{ id: string; target_id: string; workspace_id: string; state: string }>(
      `SELECT id, target_id, workspace_id, state FROM moderation_case WHERE id = $1 FOR UPDATE`,
      [caseId],
    )
    if (kase === null) return { ok: false, reason: 'not_found' } as const
    if (kase.state !== 'open' && kase.state !== 'investigating') return { ok: false, reason: 'not_open' } as const

    await tx.query(`UPDATE moderation_case SET state = 'dismissed', closed_at = now() WHERE id = $1`, [kase.id])
    await tx.query(`UPDATE block SET moderation_state = 'none' WHERE id = $1 AND moderation_state = 'reported'`, [kase.target_id])
    const actionId = await recordAction(
      tx,
      { caseId: kase.id, pageId: kase.target_id, workspaceId: kase.workspace_id, action: 'dismiss', reason: null },
      who,
    )
    return { ok: true, value: { actionId } } as const
  })
}

/** 내린 페이지를 되살린다(정본 ④) — `taken_down` · `restricted` → `reinstated`. */
export async function reinstatePage(pageId: string, input: OperatorInput): Promise<OperatorResult> {
  const who = cleanInput(input)
  if (who === null) return { ok: false, reason: 'invalid_input' }
  return withCommandTransaction(async (tx) => {
    const page = await lockPage(tx, pageId)
    if (page === null) return { ok: false, reason: 'not_found' } as const
    if (page.moderation_state !== 'taken_down' && page.moderation_state !== 'restricted') {
      return { ok: false, reason: 'not_moderated' } as const
    }
    await tx.query(`UPDATE block SET moderation_state = 'reinstated' WHERE id = $1`, [page.id])
    const actionId = await recordAction(
      tx,
      { caseId: null, pageId: page.id, workspaceId: page.workspace_id, action: 'reinstate', reason: null },
      who,
    )
    return { ok: true, value: { actionId } } as const
  })
}

// ── 운영자가 읽는 것 ──────────────────────────────────────────────────

export type CaseSummary = {
  readonly id: string
  readonly targetId: string
  readonly workspaceId: string
  readonly state: string
  readonly reportCount: number
  readonly firstReportedAt: string
  readonly lastReportedAt: string
}

/** 케이스 목록 — 열린 것(기본)은 오래된 신고부터. `all` 이면 닫힌 것도 최근 것부터. */
export async function listCases(scope: 'open' | 'all' = 'open', limit = 50): Promise<CaseSummary[]> {
  const rows = await withReadTransaction((tx) =>
    tx.query<{ id: string; target_id: string; workspace_id: string; state: string; report_count: number; first_reported_at: Date; last_reported_at: Date }>(
      scope === 'open'
        ? `SELECT id, target_id, workspace_id, state, report_count, first_reported_at, last_reported_at FROM moderation_case
            WHERE state IN ('open', 'investigating') ORDER BY first_reported_at LIMIT $1`
        : `SELECT id, target_id, workspace_id, state, report_count, first_reported_at, last_reported_at FROM moderation_case
            ORDER BY last_reported_at DESC LIMIT $1`,
      [limit],
    ),
  )
  return rows.map((r) => ({
    id: r.id,
    targetId: r.target_id,
    workspaceId: r.workspace_id,
    state: r.state,
    reportCount: r.report_count,
    firstReportedAt: r.first_reported_at.toISOString(),
    lastReportedAt: r.last_reported_at.toISOString(),
  }))
}

export type CaseDetail = CaseSummary & {
  /** 대상 페이지의 지금 상태 — 파기됐으면 null. */
  readonly pageState: string | null
  readonly reports: readonly {
    readonly id: string
    readonly reason: string
    readonly detail: string
    readonly viaRootId: string | null
    /** 지문의 앞 12자 — 같은 사람의 반복을 알아보는 데 충분하다. */
    readonly reporter: string | null
    readonly snapshotTitle: string | null
    readonly createdAt: string
  }[]
  readonly actions: readonly { readonly action: string; readonly reasonCode: string | null; readonly actor: string; readonly note: string; readonly createdAt: string }[]
}

/** 케이스 하나 — 신고 · 조치까지. */
export async function readCase(caseId: string): Promise<CaseDetail | null> {
  if (!isUuid(caseId)) return null
  return withReadTransaction(async (tx) => {
    const r = await tx.queryMaybe<{ id: string; target_id: string; workspace_id: string; state: string; report_count: number; first_reported_at: Date; last_reported_at: Date }>(
      `SELECT id, target_id, workspace_id, state, report_count, first_reported_at, last_reported_at FROM moderation_case WHERE id = $1`,
      [caseId],
    )
    if (r === null) return null
    const page = await tx.queryMaybe<{ moderation_state: string }>(`SELECT moderation_state FROM block WHERE id = $1`, [r.target_id])
    const reports = await tx.query<{ id: string; reason: string; detail: string; via_root_id: string | null; reporter_hash: string | null; title: string | null; created_at: Date }>(
      `SELECT id, reason, detail, via_root_id, reporter_hash, content_snapshot->>'title' AS title, created_at
         FROM abuse_report WHERE case_id = $1 ORDER BY created_at`,
      [r.id],
    )
    const actions = await tx.query<{ action: string; reason_code: string | null; actor: string; note: string; created_at: Date }>(
      `SELECT action, reason_code, actor, note, created_at FROM moderation_action
        WHERE target_type = 'page' AND target_id = $1 ORDER BY created_at`,
      [r.target_id],
    )
    return {
      id: r.id,
      targetId: r.target_id,
      workspaceId: r.workspace_id,
      state: r.state,
      reportCount: r.report_count,
      firstReportedAt: r.first_reported_at.toISOString(),
      lastReportedAt: r.last_reported_at.toISOString(),
      pageState: page?.moderation_state ?? null,
      reports: reports.map((x) => ({
        id: x.id,
        reason: x.reason,
        detail: x.detail,
        viaRootId: x.via_root_id,
        reporter: x.reporter_hash === null ? null : x.reporter_hash.slice(0, 12),
        snapshotTitle: x.title,
        createdAt: x.created_at.toISOString(),
      })),
      actions: actions.map((x) => ({ action: x.action, reasonCode: x.reason_code, actor: x.actor, note: x.note, createdAt: x.created_at.toISOString() })),
    }
  })
}
