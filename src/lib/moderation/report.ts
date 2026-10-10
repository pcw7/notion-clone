/**
 * 공개 페이지 신고 — 받기 · 케이스로 묶기 (게시 · 공유 6b-1a · F-17-08 · F-17-09)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 페이지 신고 ①~⑧
 *       17-ops-governance.md F-17-08 *"신고 자체가 공격 벡터다"* · *"자동 테이크다운 금지(사람 검토 필수)"*
 *
 * 신고는 **공개 경로로만** 들어온다 — 토큰(과 하위 페이지 id)을 받아 공개 화면과 같은 읽기(`readPublicPage`)를 지난 페이지만. 그 읽기가
 * 그린 재료가 곧 신고 시점 스냅샷이다(공개 밖은 이미 가려져 있다). 신고자는 주체가 아니다 — 세션을 읽지 않고, 원문 IP · UA 대신
 * `AUTH_SECRET` 키의 HMAC 하나만 남긴다.
 *
 *   검사 → 보내는 사람의 레이트리밋 → 공개 판정 · 스냅샷 → 대상 페이지의 레이트리밋 → (한 트랜잭션) 케이스에 붙이기 · 신고 한 줄 ·
 *   대상의 `moderation_state` 를 `reported` 로(none · reinstated 일 때만) → 운영자 로그 한 줄
 *
 * 신고만으로 내리지 않는다 — 공개 경로는 `reported` 를 연다. 내리는 것은 사람(6b-2)이다.
 */

import { createHmac, randomUUID } from 'node:crypto'

import { toPlainText } from '../contracts/rich-text.ts'
import { withTransaction } from '../db/tx.ts'
import { readPublicPage } from '../publish/public-read.ts'
import { consume, type RateLimitRule } from '../rate-limit.ts'

export const REPORT_REASONS = ['phishing_spam', 'inappropriate', 'dmca', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value)
}

/** 상세의 길이 상한 — 0085 `ck_abuse_report_detail` 과 같다. */
export const MAX_REPORT_DETAIL = 2000
/** 스냅샷의 크기 상한 — 넘으면 제목만(정본 ③). */
export const MAX_REPORT_SNAPSHOT_BYTES = 256 * 1024

/** 보내는 사람마다 — 10분에 5건(정본 ⑥). 모르는 사람(IP · UA 없음)은 한 통이다. */
export const REPORTER_RATE_LIMIT: RateLimitRule = { limit: 5, windowSeconds: 600 }
/** 대상 페이지마다 — 1시간에 30건(정본 ⑥). 같은 페이지로 몰려드는 신고가 케이스 하나를 무한히 키우지 않게. */
export const TARGET_RATE_LIMIT: RateLimitRule = { limit: 30, windowSeconds: 3600 }

export type ReportFailure =
  /** 공개 경로로 열 수 없다(없음 · 해제 · 정책 · 만료 · 테이크다운 …) — 이유를 말하지 않는다. */
  | 'not_found'
  /** 사유가 넷 중 하나가 아니다. */
  | 'invalid_reason'
  /** 상세가 너무 길다. */
  | 'detail_too_long'
  /** 너무 자주 — 잠시 뒤에. */
  | 'rate_limited'

export type ReportResult =
  | { readonly ok: true; readonly value: { readonly caseId: string; readonly reportId: string } }
  | { readonly ok: false; readonly reason: ReportFailure }

export type ReportInput = {
  readonly token: string
  readonly pageId?: string
  readonly reason: unknown
  readonly detail?: unknown
  /** 요청에서 뽑은 것(`requestMeta`) — 해시로만 남긴다. */
  readonly reporter: { readonly ip: string | null; readonly userAgent: string | null }
}

/** 실패를 HTTP 상태로. */
export function reportFailureStatus(reason: ReportFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'invalid_reason':
    case 'detail_too_long':
      return 400
    case 'rate_limited':
      return 429
  }
}

/** 신고자의 지문 — `AUTH_SECRET` 키의 HMAC. 원문 IP · UA 는 어디에도 남지 않는다. */
export function reporterHashOf(reporter: ReportInput['reporter']): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET 이 설정되지 않았습니다. .env.example 참조.')
  return createHmac('sha256', secret)
    .update(`report:${reporter.ip ?? ''}|${reporter.userAgent ?? ''}`)
    .digest('hex')
}

/** 공개 페이지를 신고한다. */
export async function submitReport(input: ReportInput): Promise<ReportResult> {
  if (!isReportReason(input.reason)) return { ok: false, reason: 'invalid_reason' }
  const detail = typeof input.detail === 'string' ? input.detail.trim() : ''
  if (detail.length > MAX_REPORT_DETAIL) return { ok: false, reason: 'detail_too_long' }
  const reason = input.reason

  const reporterHash = reporterHashOf(input.reporter)
  if (!(await consume('report:who', reporterHash, REPORTER_RATE_LIMIT)).allowed) return { ok: false, reason: 'rate_limited' }

  const read = await readPublicPage(input.token, input.pageId)
  if (!read.ok) return { ok: false, reason: 'not_found' }
  const view = read.value
  if (!(await consume('report:page', view.target.pageId, TARGET_RATE_LIMIT)).allowed) return { ok: false, reason: 'rate_limited' }

  const title = toPlainText(view.title)
  const full = { title, doc: view.doc }
  const snapshot = Buffer.byteLength(JSON.stringify(full)) > MAX_REPORT_SNAPSHOT_BYTES ? { title, truncated: true } : full

  const ids = await withTransaction(async (tx) => {
    const kase = await tx.queryOne<{ id: string }>(
      `INSERT INTO moderation_case (id, target_type, target_id, workspace_id, state, report_count, first_reported_at, last_reported_at)
       VALUES ($1, 'page', $2, $3, 'open', 1, now(), now())
       ON CONFLICT (target_type, target_id) WHERE state IN ('open', 'investigating')
       DO UPDATE SET report_count = moderation_case.report_count + 1, last_reported_at = now()
       RETURNING id`,
      [randomUUID(), view.target.pageId, view.target.workspaceId],
    )
    const reportId = randomUUID()
    await tx.query(
      `INSERT INTO abuse_report (id, case_id, target_type, target_id, via_root_id, reason, detail, reporter_hash, content_snapshot)
       VALUES ($1, $2, 'page', $3, $4, $5, $6, $7, $8::jsonb)`,
      [reportId, kase.id, view.target.pageId, view.target.rootId, reason, detail, reporterHash, JSON.stringify(snapshot)],
    )
    // 큐를 좁히는 표지 — 이미 제한 · 테이크다운이면 건드리지 않는다(정본 ⑤)
    await tx.query(
      `UPDATE block SET moderation_state = 'reported' WHERE id = $1 AND moderation_state IN ('none', 'reinstated')`,
      [view.target.pageId],
    )
    return { caseId: kase.id, reportId }
  })

  // 운영자에게 알리는 길(정본 ⑦) — 대상의 내용은 싣지 않는다(케이스 · 신고 id 로 찾아본다)
  console.warn(`[moderation] 새 신고 case=${ids.caseId} report=${ids.reportId} page=${view.target.pageId} reason=${reason}`)
  return { ok: true, value: ids }
}
