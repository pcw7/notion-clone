/**
 * 워크스페이스의 요금제를 바꾼다 — 운영자 명령 (잔여 묶음 8k-1 · F-13-18)
 *
 * 정본: 00-canonical-data-model.md §3.10 `billing_subscription` · `workspace.plan_code`(파생 캐시) · [보강] 엔타이틀먼트 ③ · ④
 *
 * **결제 연동은 없다** — 유료 SaaS(Stripe 등)에 기대지 않는다(CLAUDE.md 절대 제약 1). 요금제는 운영자가 이 명령으로 준다
 * (`npm run plan:set -- <workspaceId> <plan>`). 사용자가 부르는 라우트는 없다.
 *
 *   · 정본은 구독이고 `workspace.plan_code` 는 캐시다 — **둘을 한 트랜잭션에서 쓰는 것은 이 명령 하나다**
 *   · 살아 있는 구독(취소되지 않은 것)은 워크스페이스마다 하나(표가 막는다) — 바꾸면 앞의 것을 취소하고 새 줄을 쓴다(이력이 남는다)
 *   · free 는 구독이 없는 상태다 — free 로 바꾸면 살아 있는 구독을 취소만 한다
 *   · 같은 요금제로 바꾸면 아무것도 쓰지 않는다
 *   · 요금제를 내려도 이미 있는 것은 지우지 않는다 — 한도는 새로 만드는 쪽에만 걸린다(13 *"기존 것은 남기되 신규 생성 차단"*). 버전의
 *     보존 기한은 만들 때 고정이다(§3.7 [보강] 버전 기록 ④)
 */

import { withTransaction } from '../db/tx.ts'

export const PLAN_CODES = ['free', 'plus', 'business', 'enterprise'] as const
export type PlanCode = (typeof PLAN_CODES)[number]

export const isPlanCode = (value: unknown): value is PlanCode => typeof value === 'string' && (PLAN_CODES as readonly string[]).includes(value)

export type SetPlanResult =
  | { readonly ok: true; readonly changed: boolean; readonly from: PlanCode; readonly to: PlanCode }
  | { readonly ok: false; readonly reason: 'not_found' | 'invalid_plan' }

export async function setWorkspacePlan(workspaceId: string, plan: unknown): Promise<SetPlanResult> {
  if (!isPlanCode(plan)) return { ok: false, reason: 'invalid_plan' }
  return withTransaction(async (tx) => {
    const current = await tx.queryMaybe<{ plan_code: PlanCode }>(
      `SELECT plan_code FROM workspace WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [workspaceId],
    )
    if (current === null) return { ok: false, reason: 'not_found' }
    if (current.plan_code === plan) return { ok: true, changed: false, from: plan, to: plan }

    await tx.query(
      `UPDATE billing_subscription SET status = 'canceled', canceled_at = now()
        WHERE workspace_id = $1 AND status <> 'canceled'`,
      [workspaceId],
    )
    if (plan !== 'free') {
      await tx.query(
        `INSERT INTO billing_subscription (workspace_id, plan_id, status)
         SELECT $1, id, 'active' FROM plan WHERE code = $2`,
        [workspaceId, plan],
      )
    }
    await tx.query(`UPDATE workspace SET plan_code = $2 WHERE id = $1`, [workspaceId, plan])
    return { ok: true, changed: true, from: current.plan_code, to: plan }
  })
}
