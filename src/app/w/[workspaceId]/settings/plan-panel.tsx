/**
 * 요금제 패널 — 설정 → 워크스페이스 → 요금제 (잔여 묶음 8k-3 · F-13-18)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 요금제 패널 · 13-adjacent-products.md F-13-18 *"설정 내 사용량 대시보드"*
 *
 * 읽기만 한다 — 서버 컴포넌트(상태가 없다). 값은 서버가 준 개요(`planOverview` — 엔타이틀먼트 표 그대로)이고, 여기는 그것을 읽는 말만
 * 붙인다(`plan-messages.ts`). 바꾸는 길은 없다 — 운영자 명령(결제 연동 없음).
 *
 *   · 지금 요금제 · 쓴 양(게스트 — 한도 판정과 같은 셈)
 *   · 네 요금제의 비교 표 — 지금 요금제의 칸에 표시
 */

import type { PlanOverview } from '@/lib/billing/overview'

import { PLAN_CHANGE_NOTE, entitlementLabel, formatEntitlement, formatPrice, guestUsageLine } from './plan-messages'

export function PlanPanel({ overview }: { overview: PlanOverview }) {
  const current = overview.plans.find((p) => p.code === overview.current)
  const guestLimit = overview.entitlements.find((e) => e.key === 'guests.max')?.values[overview.current] ?? null
  return (
    <section data-testid="plan-panel" data-plan={overview.current} className="mt-6 flex flex-col gap-3">
      <div>
        <p className="text-sm">
          지금 요금제 <strong data-testid="plan-current">{current?.displayName ?? overview.current}</strong>
        </p>
        <p className="text-xs text-neutral-500">{PLAN_CHANGE_NOTE}</p>
      </div>

      <p data-testid="plan-usage-guests" className="text-sm">
        {guestUsageLine(overview.usage.guests, guestLimit)}
      </p>

      <div className="overflow-x-auto">
        <table data-testid="plan-compare" className="w-full min-w-[32rem] border-collapse text-xs">
          <thead>
            <tr>
              <th className="border-b border-neutral-200 py-1 pr-2 text-left font-normal text-neutral-500 dark:border-neutral-800" />
              {overview.plans.map((p) => (
                <th
                  key={p.code}
                  data-plan={p.code}
                  aria-current={p.code === overview.current ? 'true' : undefined}
                  className={`border-b border-neutral-200 px-2 py-1 text-left dark:border-neutral-800 ${p.code === overview.current ? 'bg-neutral-100 dark:bg-neutral-900' : ''}`}
                >
                  <span className="block text-sm font-medium">{p.displayName}</span>
                  <span className="block font-normal text-neutral-500">{formatPrice(p.priceMonthly, p.priceAnnual, p.currency)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {overview.entitlements.map((e) => (
              <tr key={e.key} data-key={e.key}>
                <th scope="row" className="border-b border-neutral-100 py-1 pr-2 text-left font-normal text-neutral-500 dark:border-neutral-900">
                  {entitlementLabel(e.key)}
                </th>
                {overview.plans.map((p) => (
                  <td
                    key={p.code}
                    data-plan={p.code}
                    className={`border-b border-neutral-100 px-2 py-1 dark:border-neutral-900 ${p.code === overview.current ? 'bg-neutral-100 dark:bg-neutral-900' : ''}`}
                  >
                    {formatEntitlement(e.key, e.values[p.code])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
