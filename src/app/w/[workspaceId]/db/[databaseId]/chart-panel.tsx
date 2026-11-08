'use client'

/**
 * 차트 패널의 내용 (CH-2 · CH-6) — 도구줄(데이터베이스 화면에 늘 실린다)에서 "차트" 단추를 누를 때에야 읽는 조각이다
 * (`next/dynamic` · 번들 예산 `check:bundle`). 테스트 id 와 하는 일은 도구줄에 있을 때와 같다.
 */

import { CHART_KINDS, type ChartLayout } from '@/lib/database/chart'
import { CHART_KIND_LABEL, chartCalculationsFor, cumulativeAllowed, defaultChartCalculation, isNumericCalculation } from '@/lib/database/chart-geometry'
import { CALCULATION_LABEL, type Calculation } from '@/lib/database/calculations'
import type { GroupBy } from '@/lib/database/group'
import { isGroupableType } from '@/lib/database/property-types'
import type { ViewColumn } from '@/lib/database/view-columns'
import { BucketControls, FIELD, Popover, SubGroupDetail } from './group-controls'
import type { ChartSettings } from './view-toolbar'

/**
 * 차트 패널(CH-2) — 종류 넷 · X축(= 묶을 속성 · 보드의 그룹 기준과 같은 후보 · 같은 버킷 고르개) · Y값(개수 또는 속성 + 수로 나오는 계산) · 그룹 보이기.
 * 고치는 것은 PATCH 뷰의 `chart` · `groupBy` 그대로다. Y값은 `groupBy.calculation` 이라 X축을 바꿔도 남긴다.
 */
export default function ChartPanel({
  columns,
  chart,
  locked,
  onSaveLayout,
  onSaveGroupBy,
  onSaveSub,
  onClose,
}: {
  columns: ViewColumn[]
  chart: ChartSettings
  locked: boolean
  onSaveLayout: (patch: Partial<ChartLayout>) => Promise<boolean>
  onSaveGroupBy: (next: GroupBy) => Promise<boolean>
  onSaveSub: (next: GroupBy | null) => Promise<boolean>
  onClose: () => void
}) {
  const groupable = columns.filter((c) => isGroupableType(c.type))
  const current = chart.groupBy
  const dead = current !== null && !groupable.some((c) => c.propertyId === current.property_id)
  // Y값으로 고를 수 있는 속성 — 수로 나오는 계산이 하나라도 있는 타입
  const calculable = columns.filter((c) => chartCalculationsFor(c.type).length > 0)
  const calc = current?.calculation ?? null
  const calcColumn = calc === null ? undefined : calculable.find((c) => c.propertyId === calc.property_id)
  const liveCalc = calc !== null && calcColumn !== undefined && chartCalculationsFor(calcColumn.type).includes(calc.function) ? calc : null
  // 저장된 계산이 수가 아니면(날짜 · 기간) 고르개에 내지 않는다 — 개수로 보이고 화면이 "다시 고르세요" 를 적는다
  const stacked = chart.subGroupBy !== null && chart.subGroupBy.property_id !== current?.property_id
  const cumulativeOk = cumulativeAllowed(chart.layout.kind, calc?.function ?? null, current?.sort, stacked)
  const savedNonNumeric = calc !== null && !isNumericCalculation(calc.function)

  const toggleHidden = (key: string, hidden: boolean) => {
    if (current === null) return
    const next = new Set(current.hidden ?? [])
    if (hidden) next.add(key)
    else next.delete(key)
    void onSaveGroupBy({ ...current, hidden: [...next] })
  }

  return (
    <Popover label="차트" testId="chart-panel" onClose={onClose}>
      <div className="flex flex-wrap items-center gap-1 text-sm" role="group" aria-label="차트 종류">
        <span className="mr-1">종류</span>
        {CHART_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            data-testid={`chart-kind-${kind}`}
            aria-pressed={chart.layout.kind === kind}
            disabled={locked}
            onClick={() => {
              if (chart.layout.kind !== kind) void onSaveLayout({ kind })
            }}
            className={`rounded-md px-2 py-1 text-sm disabled:opacity-50 ${
              chart.layout.kind === kind
                ? 'bg-[rgba(33,27,23,0.1)] font-medium dark:bg-white/15'
                : 'hover:bg-[rgba(33,27,23,0.05)] dark:hover:bg-white/5'
            }`}
          >
            {CHART_KIND_LABEL[kind]}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="chart-data-labels"
          checked={chart.layout.data_labels && chart.layout.kind !== 'number'}
          disabled={locked || chart.layout.kind === 'number'}
          onChange={(e) => void onSaveLayout({ data_labels: e.target.checked })}
        />
        데이터 라벨
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="chart-cumulative"
          checked={cumulativeOk && chart.layout.cumulative}
          disabled={locked || !cumulativeOk}
          onChange={(e) => void onSaveLayout({ cumulative: e.target.checked })}
        />
        누적
        {!cumulativeOk && <span className="text-xs text-neutral-400">개수 · 합계를 오름차순으로 볼 때만</span>}
      </label>

      <label className="flex items-center gap-2 text-sm">
        X축
        <select
          aria-label="X축"
          data-testid="chart-x-axis"
          value={current?.property_id ?? ''}
          disabled={locked}
          onChange={(e) => {
            if (e.target.value === '') return
            void onSaveGroupBy({
              property_id: e.target.value,
              ...(current?.hide_empty ? { hide_empty: true } : {}),
              ...(current?.calculation ? { calculation: current.calculation } : {}),
            })
          }}
          className={FIELD}
        >
          {current === null && <option value="">속성을 고르세요…</option>}
          {dead && <option value={current.property_id}>지워진 속성</option>}
          {groupable.map((c) => (
            <option key={c.propertyId} value={c.propertyId}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {groupable.length === 0 && (
        <p className="text-sm text-neutral-400">선택 · 상태 · 체크박스 · 날짜 · 숫자 · 글 속성이 없습니다. 속성을 먼저 만드세요.</p>
      )}

      {current !== null && !dead && (
        // X축의 버킷 고르개(날짜 단위 · 숫자 구간 · 글 방식 · 순서) — 그룹 패널과 같은 것
        <BucketControls
          type={groupable.find((c) => c.propertyId === current.property_id)?.type}
          value={current}
          locked={locked}
          testPrefix="chart-x"
          axisLabel="X축의 "
          onChange={(patch) =>
            void onSaveGroupBy({
              property_id: current.property_id,
              ...(current.hide_empty ? { hide_empty: true } : {}),
              ...(current.calculation ? { calculation: current.calculation } : {}),
              ...patch,
            })
          }
        />
      )}

      {current !== null && !dead && (
        <>
          <label className="flex items-center gap-2 text-sm">
            쌓기
            <select
              aria-label="쌓기"
              data-testid="chart-stack"
              value={stacked ? (chart.subGroupBy?.property_id ?? '') : ''}
              disabled={locked}
              onChange={(e) => void onSaveSub(e.target.value === '' ? null : { property_id: e.target.value })}
              className={FIELD}
            >
              <option value="">없음</option>
              {groupable
                .filter((c) => c.propertyId !== current.property_id)
                .map((c) => (
                  <option key={c.propertyId} value={c.propertyId}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          {stacked && chart.subGroupBy !== null && (
            // 쌓기의 세부(CH-6) — 하위 그룹의 날짜 단위 · 숫자 구간 · 글의 방식 · 숨김 · 빈 줄 숨기기(보드의 하위 그룹 패널과 같은 고르개)
            <div data-testid="chart-stack-detail" className="flex flex-col gap-2 border-l-2 border-neutral-200 pl-2 dark:border-neutral-700">
              <SubGroupDetail
                type={groupable.find((c) => c.propertyId === chart.subGroupBy?.property_id)?.type}
                now={chart.subGroupBy}
                lanes={chart.stackGroups}
                locked={locked}
                testPrefix="chart-stack"
                axisLabel="쌓기의 "
                hideEmptyLabel="빈 칸 숨기기"
                listLabel="쌓기 표시"
                onSave={onSaveSub}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            Y값
            <select
              aria-label="Y값"
              data-testid="chart-y-axis"
              value={liveCalc?.property_id ?? ''}
              disabled={locked}
              onChange={(e) => {
                const column = calculable.find((c) => c.propertyId === e.target.value)
                if (column === undefined) {
                  // 개수로 — `calculation` 만 뺀다(나머지는 그대로)
                  void onSaveGroupBy({ ...current, calculation: null })
                  return
                }
                void onSaveGroupBy({ ...current, calculation: { property_id: column.propertyId, function: defaultChartCalculation(column.type) } })
              }}
              className={FIELD}
            >
              <option value="">{savedNonNumeric ? '개수 (Y값을 다시 고르세요)' : '개수'}</option>
              {calculable.map((c) => (
                <option key={c.propertyId} value={c.propertyId}>
                  {c.name}
                </option>
              ))}
            </select>
            {liveCalc !== null && calcColumn !== undefined && (
              <select
                aria-label="Y값의 계산"
                data-testid="chart-y-function"
                value={liveCalc.function}
                disabled={locked}
                onChange={(e) =>
                  void onSaveGroupBy({ ...current, calculation: { property_id: liveCalc.property_id, function: e.target.value as Calculation } })
                }
                className={FIELD}
              >
                {chartCalculationsFor(calcColumn.type).map((fn) => (
                  <option key={fn} value={fn}>
                    {CALCULATION_LABEL[fn]}
                  </option>
                ))}
              </select>
            )}
          </div>

          <ul aria-label="그룹 표시" className="flex flex-col gap-1">
            {chart.groups.map((g) => (
              <li key={g.key}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-testid="chart-group-visible"
                    data-group-key={g.key}
                    checked={!g.hidden}
                    disabled={locked}
                    onChange={(e) => toggleHidden(g.key, !e.target.checked)}
                  />
                  {g.label}
                  <span className="text-xs tabular-nums text-neutral-400">{g.count}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </Popover>
  )
}
