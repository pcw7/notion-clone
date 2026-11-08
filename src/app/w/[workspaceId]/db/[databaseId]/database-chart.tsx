'use client'

/**
 * 차트 — 38번 트랙 CH-2 (F-04-08 Chart view)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 CH-1] · [보강 CH-2]
 *
 * 서버가 낸 그룹 요약(`queryGroupSummary` — X축 = `group_by` · Y값 = `group_by.calculation` 또는 개수)을 **SVG 를 손으로 그려** 옮긴다.
 * 차트 라이브러리는 들이지 않는다(번들 예산 · CH-2 ①). 좌표 · 눈금 · 호 · 색 · 글자는 `lib/database/chart-geometry.ts`(DOM 없이 검사)가 낸다.
 *
 * 이 화면은 상태가 없다 — 요약은 서버 렌더가 준다. 바뀌었다는 신호(`useLiveServerRefresh` — 보드 · 갤러리 · 캘린더와 같은 구독)가 오면
 * 서버 렌더를 다시 받고, 설정을 고치면 도구줄이 `router.refresh()` 로 같은 길을 탄다. 그려진 막대 · 점 · 조각은 `data-testid="chart-mark"`
 * (`data-key` = 그룹 키 · `data-value` = 그린 수)다.
 */

import { useMemo } from 'react'

import type { ChartKind } from '@/lib/database/chart'
import { CALCULATION_LABEL, formatCalculation } from '@/lib/database/calculations'
import {
  ACCENT_FILL,
  accumulate,
  arcPath,
  chartData,
  chartSummaryLabel,
  cumulativeAllowed,
  donutLabelVisible,
  donutSlices,
  donutUsesOptionColors,
  fillOf,
  niceScale,
  scaleLinear,
  truncateLabel,
  type ChartDatum,
  type SummaryInput,
} from '@/lib/database/chart-geometry'
import { useLiveServerRefresh } from './use-table-changes'

const W = 640
const TEXT = 'text-neutral-500 dark:text-neutral-400'
const tickText = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })

export function DatabaseChart({
  workspaceId,
  dataSourceId,
  renderedAt,
  kind,
  dataLabels,
  cumulative,
  groupSort,
  summary,
}: {
  workspaceId: string
  dataSourceId: string
  /** 서버 화면이 읽기 전의 시각(ms) — 구독이 붙기 전의 변경을 메운다(#250 · `use-table-changes.ts`). */
  renderedAt: number
  kind: ChartKind
  /** 값 글자를 마크에 적는다(CH-3). */
  dataLabels: boolean
  /** 저장된 누적 — 그릴 수 있을 때만 그린다(`cumulativeAllowed`). */
  cumulative: boolean
  groupSort: string | null
  summary: SummaryInput
}) {
  useLiveServerRefresh(workspaceId, dataSourceId, false, renderedAt)
  const chart = useMemo(() => chartData(summary), [summary])
  const drawCumulative = cumulative && cumulativeAllowed(kind, summary.calculation?.function ?? null, groupSort)
  const data = useMemo(() => (drawCumulative ? accumulate(chart.data) : chart.data), [chart.data, drawCumulative])

  return (
    <div data-testid="db-chart" data-kind={kind} className="flex flex-col gap-2">
      {chart.yNeedsReselect && (
        <p data-testid="db-chart-notice" className="text-sm text-amber-700 dark:text-amber-400">
          Y값을 다시 고르세요
        </p>
      )}
      {kind === 'number' ? (
        <NumberTile summary={summary} />
      ) : chart.empty ? (
        <p data-testid="db-chart-empty" className="px-2 py-8 text-center text-sm text-neutral-500">
          데이터가 없습니다
        </p>
      ) : kind === 'donut' ? (
        <Donut data={data} labels={dataLabels} />
      ) : kind === 'bar' ? (
        <HBars data={data} integer={chart.integer} labels={dataLabels} />
      ) : (
        <VChart data={data} integer={chart.integer} line={kind === 'line'} labels={dataLabels} />
      )}
    </div>
  )
}

/** 값 하나(CH-4) — 뷰의 모든 행의 계산. 큰 글자 + 작은 이름줄. 날짜 계산은 값 고르개에서 빠지지만 저장돼 있으면 글자만 보인다. */
function NumberTile({ summary }: { summary: SummaryInput }) {
  const total = summary.total
  const fn = summary.calculation?.function ?? null
  const numeric = total !== undefined && total.kind !== 'date' && total.value !== null ? total.value : null
  const caption = fn === null || summary.calculationName === null || summary.calculationName === undefined ? '행 개수' : `${CALCULATION_LABEL[fn]} · ${summary.calculationName}`
  return (
    <div className="flex flex-col items-center gap-1 px-2 py-10">
      <span data-testid="chart-number" data-value={numeric ?? undefined} className="text-6xl font-semibold tabular-nums">
        {total === undefined ? '—' : formatCalculation(total)}
      </span>
      <span data-testid="chart-number-caption" className={`text-sm ${TEXT}`}>
        {caption}
      </span>
    </div>
  )
}

const LABEL_FONT = 11

const markTitle = (d: ChartDatum) => `${d.label} · ${d.text}`

/** 세로 막대 · 선 — 같은 축을 쓴다. */
function VChart({ data, integer, line, labels }: { data: readonly ChartDatum[]; integer: boolean; line: boolean; labels: boolean }) {
  const rotate = data.length > 8
  const m = { l: 56, r: 16, t: 16, b: rotate ? 72 : 44 }
  const H = 320
  const scale = niceScale(
    data.map((d) => d.value),
    integer,
  )
  const y = scaleLinear(scale, H - m.b, m.t)
  const band = (W - m.l - m.r) / data.length
  const cx = (i: number) => m.l + band * (i + 0.5)
  const zero = y(0)
  const barW = Math.min(band * 0.6, 56)
  const maxChars = rotate ? 10 : Math.max(2, Math.floor(band / 9))

  return (
    <svg
      role="img"
      aria-label={chartSummaryLabel(line ? 'line' : 'column', data.length)}
      viewBox={`0 0 ${W} ${H}`}
      className={`h-auto w-full max-w-3xl ${TEXT}`}
    >
      {scale.ticks.map((t) => (
        <g key={t}>
          <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.5 : 0.15} />
          <text x={m.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="currentColor">
            {tickText(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => (
        <text
          key={d.key}
          x={cx(i)}
          y={H - m.b + 16}
          textAnchor={rotate ? 'end' : 'middle'}
          fontSize={11}
          fill="currentColor"
          transform={rotate ? `rotate(-35 ${cx(i)} ${H - m.b + 16})` : undefined}
        >
          {truncateLabel(d.label, maxChars)}
        </text>
      ))}
      {line ? (
        <>
          <polyline
            fill="none"
            stroke={ACCENT_FILL}
            strokeWidth={2}
            strokeLinejoin="round"
            points={data.map((d, i) => `${cx(i)},${y(d.value)}`).join(' ')}
          />
          {data.map((d, i) => (
            <circle
              key={d.key}
              data-testid="chart-mark"
              data-key={d.key}
              data-value={d.value}
              cx={cx(i)}
              cy={y(d.value)}
              r={5}
              fill={fillOf(d, i, false)}
              stroke="var(--background, white)"
              strokeWidth={1.5}
            >
              <title>{markTitle(d)}</title>
            </circle>
          ))}
        </>
      ) : (
        data.map((d, i) => (
          <rect
            key={d.key}
            data-testid="chart-mark"
            data-key={d.key}
            data-value={d.value}
            x={cx(i) - barW / 2}
            y={Math.min(y(d.value), zero)}
            width={barW}
            height={Math.abs(zero - y(d.value))}
            rx={2}
            fill={fillOf(d, i, false)}
          >
            <title>{markTitle(d)}</title>
          </rect>
        ))
      )}
      {labels &&
        data.map((d, i) => (
          <text
            key={d.key}
            data-testid="chart-label"
            data-key={d.key}
            x={cx(i)}
            y={(d.value < 0 ? Math.max(y(d.value), zero) + LABEL_FONT + 3 : Math.min(y(d.value), zero) - (line ? 9 : 4))}
            textAnchor="middle"
            fontSize={LABEL_FONT}
            fill="currentColor"
          >
            {d.text}
          </text>
        ))}
    </svg>
  )
}

/** 가로 막대. */
function HBars({ data, integer, labels }: { data: readonly ChartDatum[]; integer: boolean; labels: boolean }) {
  const m = { l: 128, r: 24, t: 8, b: 28 }
  const row = 30
  const H = m.t + m.b + data.length * row
  const scale = niceScale(
    data.map((d) => d.value),
    integer,
  )
  const x = scaleLinear(scale, m.l, W - m.r)
  const zero = x(0)

  return (
    <svg role="img" aria-label={chartSummaryLabel('bar', data.length)} viewBox={`0 0 ${W} ${H}`} className={`h-auto w-full max-w-3xl ${TEXT}`}>
      {scale.ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={m.t} y2={H - m.b} stroke="currentColor" strokeOpacity={t === 0 ? 0.5 : 0.15} />
          <text x={x(t)} y={H - m.b + 16} textAnchor="middle" fontSize={11} fill="currentColor">
            {tickText(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const top = m.t + i * row
        return (
          <g key={d.key}>
            <text x={m.l - 8} y={top + row / 2} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="currentColor">
              {truncateLabel(d.label, 14)}
            </text>
            <rect
              data-testid="chart-mark"
              data-key={d.key}
              data-value={d.value}
              x={Math.min(x(d.value), zero)}
              y={top + 5}
              width={Math.abs(x(d.value) - zero)}
              height={row - 10}
              rx={2}
              fill={fillOf(d, i, false)}
            >
              <title>{markTitle(d)}</title>
            </rect>
            {labels && (
              <text
                data-testid="chart-label"
                data-key={d.key}
                x={d.value < 0 ? Math.min(x(d.value), zero) - 4 : Math.max(x(d.value), zero) + 4}
                y={top + row / 2}
                textAnchor={d.value < 0 ? 'end' : 'start'}
                dominantBaseline="middle"
                fontSize={LABEL_FONT}
                fill="currentColor"
              >
                {d.text}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** 도넛 — 양수인 값만 조각이 된다(0 은 호가 없다). 조각 이름 · 값은 옆의 범례에도 모두 적는다. */
function Donut({ data, labels }: { data: readonly ChartDatum[]; labels: boolean }) {
  const size = 240
  const c = size / 2
  const slices = donutSlices(data.map((d) => d.value))
  const total = slices.reduce((sum, s) => sum + data[s.index].value, 0)
  const optionColors = donutUsesOptionColors(data)

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg role="img" aria-label={chartSummaryLabel('donut', data.length)} viewBox={`0 0 ${size} ${size}`} className="h-auto w-56 shrink-0">
        {slices.map((s) => {
          const d = data[s.index]
          return (
            <path
              key={d.key}
              data-testid="chart-mark"
              data-key={d.key}
              data-value={d.value}
              d={arcPath(c, c, 108, 64, s.start, s.end)}
              fill={fillOf(d, s.index, true, optionColors)}
              fillRule="evenodd"
              stroke="var(--background, white)"
              strokeWidth={1.5}
            >
              <title>{`${markTitle(d)} · ${(s.fraction * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`}</title>
            </path>
          )
        })}
        {labels &&
          slices
            .filter((s) => donutLabelVisible(s.fraction))
            .map((s) => {
              const mid = (s.start + s.end) / 2
              const r = (108 + 64) / 2
              return (
                <text
                  key={data[s.index].key}
                  data-testid="chart-label"
                  data-key={data[s.index].key}
                  x={c + r * Math.sin(mid)}
                  y={c - r * Math.cos(mid)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={LABEL_FONT}
                  fill="white"
                  stroke="rgba(0,0,0,0.45)"
                  strokeWidth={2.5}
                  paintOrder="stroke"
                >
                  {data[s.index].text}
                </text>
              )
            })}
        <text x={c} y={c} textAnchor="middle" dominantBaseline="middle" fontSize={18} fill="currentColor" className={TEXT}>
          {total.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}
        </text>
      </svg>
      <ul aria-label="범례" className="flex min-w-0 flex-col gap-1 text-sm" data-testid="chart-legend">
        {data.map((d, i) => (
          <li key={d.key} className="flex items-center gap-2">
            <span aria-hidden className="inline-block size-3 shrink-0 rounded-sm" style={{ background: fillOf(d, i, true, optionColors) }} />
            <span className="truncate">{d.label}</span>
            <span className="tabular-nums text-neutral-500">{d.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
