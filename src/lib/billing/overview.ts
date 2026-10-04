/**
 * 요금제 개요 — 설정의 요금제 절이 보이는 것 (잔여 묶음 8k-3 · F-13-18)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 엔타이틀먼트 · [보강] 요금제 게이트 · [보강] 요금제 패널
 *       13-adjacent-products.md F-13-18 *"설정 내 사용량 대시보드(크레딧·게스트·도메인 잔여)"*
 *
 *   · 누가 보는가 — 워크스페이스 소유자 · 멤버 관리자(`canSeePlan` — 역할 **이름**으로 묻는다). 요금제와 게스트 수는 운영의 정보다
 *   · 무엇을 — 지금 요금제 · 네 요금제의 가격과 **엔타이틀먼트 값(표에서 그대로 — 코드 상수가 없다)** · 쓴 양(게스트 — 한도 판정과 같은 셈)
 *   · 바꾸는 길은 없다 — 운영자 명령(`setWorkspacePlan`) · 결제 연동 없음(정본 [보강] 엔타이틀먼트 ③)
 */

import type { SessionContext, WorkspaceRole } from '../auth/session-context.ts'
import { query } from '../db/pool.ts'
import { guestSeatsUsed } from '../workspace/guest.ts'
import { ENTITLEMENTS, type EntitlementKey } from './entitlement.ts'
import { PLAN_CODES, type PlanCode } from './plan.ts'

/** 요금제 절을 보는 역할 — 소유자 · 멤버 관리자(화면 표시와 서버가 같은 답을 쓴다). */
export const canSeePlan = (role: WorkspaceRole): boolean => role === 'owner' || role === 'membership_admin'

export type PlanSummary = {
  readonly code: PlanCode
  readonly displayName: string
  /** null = 문의(Enterprise). */
  readonly priceMonthly: number | null
  /** 연 결제의 월 환산액. */
  readonly priceAnnual: number | null
  readonly currency: string | null
}

export type PlanOverview = {
  readonly current: PlanCode
  /** 가격 순(Free · Plus · Business · Enterprise). */
  readonly plans: readonly PlanSummary[]
  /** 키마다 요금제별 값 — 비교 표(`ENTITLEMENTS` 의 순서). */
  readonly entitlements: readonly { readonly key: EntitlementKey; readonly values: Readonly<Record<PlanCode, unknown>> }[]
  readonly usage: { readonly guests: number }
}

const toNumber = (value: string | number | null): number | null => (value === null ? null : Number(value))

/** 이 워크스페이스의 요금제 개요 — 볼 수 없는 역할이면 null. */
export async function planOverview(ctx: SessionContext): Promise<PlanOverview | null> {
  if (!canSeePlan(ctx.role)) return null
  const [workspace, plans, rows, guests] = await Promise.all([
    query<{ plan_code: PlanCode }>(`SELECT plan_code FROM workspace WHERE id = $1`, [ctx.workspaceId]),
    query<{ code: PlanCode; display_name: string; price_monthly: string | null; price_annual: string | null; currency: string | null }>(
      `SELECT code, display_name, price_monthly, price_annual, currency FROM plan`,
    ),
    query<{ code: PlanCode; key: string; value: unknown }>(
      `SELECT p.code, e.key, e.value FROM plan_entitlement e JOIN plan p ON p.id = e.plan_id`,
    ),
    guestSeatsUsed(ctx.workspaceId),
  ])
  const order = (code: PlanCode) => PLAN_CODES.indexOf(code)
  const keys = Object.keys(ENTITLEMENTS) as EntitlementKey[]
  return {
    current: workspace[0]?.plan_code ?? 'free',
    plans: [...plans]
      .sort((a, b) => order(a.code) - order(b.code))
      .map((p) => ({
        code: p.code,
        displayName: p.display_name,
        priceMonthly: toNumber(p.price_monthly),
        priceAnnual: toNumber(p.price_annual),
        currency: p.currency,
      })),
    entitlements: keys.map((key) => ({
      key,
      values: Object.fromEntries(PLAN_CODES.map((code) => [code, rows.find((r) => r.code === code && r.key === key)?.value ?? null])) as Record<
        PlanCode,
        unknown
      >,
    })),
    usage: { guests: guests },
  }
}
