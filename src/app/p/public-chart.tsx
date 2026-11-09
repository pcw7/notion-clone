/**
 * 공개 차트 — 서버가 SVG 를 그린다 (공개 화면의 뷰 PV-3 · F-06-08)
 *
 * 정본: 00-canonical-data-model.md [보강 PV-1] ④ · [보강 CH-2] ~ [보강 CH-4]
 *
 * 앱의 차트(`database-chart.tsx`)와 같은 순수 기하(`chart-geometry.ts`)로 같은 모양을 그리되 서버 컴포넌트다 — 스크립트 · 상호작용 없음.
 * 막대 · 조각 위에 두면 `<title>`(이름 · 값)이 뜬다. 쌓기는 그리지 않는다(`public-chart.ts` — 그룹 합계 막대).
 */

import type { ReactNode } from 'react'

import { CALCULATION_LABEL, formatCalculation } from '@/lib/database/calculations'
import {
  ACCENT_FILL,
  accumulate,
  arcPath,
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
} from '@/lib/database/chart-geometry'
import type { PublicChart } from '@/lib/publish/public-database'
import { chartSeriesOf } from '@/lib/publish/public-chart'

const W = 640
const LABEL_FONT = 11
const tickText = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
const markTitle = (d: ChartDatum) => `${d.label} · ${d.text}`

export function PublicChartView({ chart }: { chart: PublicChart }): ReactNode {
  const series = chartSeriesOf(chart.groups, chart.calculation?.function ?? null)
  const drawCumulative = chart.cumulative && cumulativeAllowed(chart.kind, chart.calculation?.function ?? null, chart.groupSort)
  const data = drawCumulative ? accumulate(series.data) : series.data
  return (
    <div className="pub-chart" data-testid="public-db-chart" data-kind={chart.kind}>
      {chart.kind === 'number' ? (
        <NumberTile chart={chart} />
      ) : series.empty ? (
        <p className="pub-note" data-testid="public-chart-empty">
          데이터가 없습니다
        </p>
      ) : chart.kind === 'donut' ? (
        <Donut data={data} labels={chart.dataLabels} />
      ) : chart.kind === 'bar' ? (
        <HBars data={data} integer={series.integer} labels={chart.dataLabels} />
      ) : (
        <VChart data={data} integer={series.integer} line={chart.kind === 'line'} labels={chart.dataLabels} />
      )}
    </div>
  )
}

/** 값 하나(CH-4) — 범위 안의 모든 행의 계산. 큰 글자 + 작은 이름줄. */
function NumberTile({ chart }: { chart: PublicChart }): ReactNode {
  const total = chart.total
  const numeric = total !== null && total.kind !== 'date' && total.value !== null ? total.value : null
  const calc = chart.calculation
  const caption = calc === null || calc.propertyName === null ? '행 개수' : `${CALCULATION_LABEL[calc.function]} · ${calc.propertyName}`
  return (
    <div className="pub-chart-number-tile">
      <span className="pub-chart-number" data-testid="public-chart-number" data-value={numeric ?? undefined}>
        {total === null ? '—' : formatCalculation(total)}
      </span>
      <span className="pub-chart-caption">{caption}</span>
    </div>
  )
}

/** 세로 막대 · 선 — 같은 축을 쓴다. */
function VChart({ data, integer, line, labels }: { data: readonly ChartDatum[]; integer: boolean; line: boolean; labels: boolean }): ReactNode {
  const rotate = data.length > 8
  const m = { l: 56, r: 16, t: 16, b: rotate ? 72 : 44 }
  const H = 320
  const scale = niceScale(data.map((d) => d.value), integer)
  const y = scaleLinear(scale, H - m.b, m.t)
  const band = (W - m.l - m.r) / data.length
  const cx = (i: number) => m.l + band * (i + 0.5)
  const zero = y(0)
  const barW = Math.min(band * 0.6, 56)
  const maxChars = rotate ? 10 : Math.max(2, Math.floor(band / 9))
  return (
    <svg role="img" aria-label={chartSummaryLabel(line ? 'line' : 'column', data.length)} viewBox={`0 0 ${W} ${H}`} className="pub-chart-svg">
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
          <polyline fill="none" stroke={ACCENT_FILL} strokeWidth={2} strokeLinejoin="round" points={data.map((d, i) => `${cx(i)},${y(d.value)}`).join(' ')} />
          {data.map((d, i) => (
            <circle
              key={d.key}
              data-testid="public-chart-point"
              data-group={d.key}
              data-value={d.value}
              cx={cx(i)}
              cy={y(d.value)}
              r={5}
              fill={fillOf(d, i, false)}
              stroke="white"
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
            data-testid="public-chart-bar"
            data-group={d.key}
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
            data-testid="public-chart-label"
            data-group={d.key}
            x={cx(i)}
            y={d.value < 0 ? Math.max(y(d.value), zero) + LABEL_FONT + 3 : Math.min(y(d.value), zero) - (line ? 9 : 4)}
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
function HBars({ data, integer, labels }: { data: readonly ChartDatum[]; integer: boolean; labels: boolean }): ReactNode {
  const m = { l: 128, r: 24, t: 8, b: 28 }
  const row = 30
  const H = m.t + m.b + data.length * row
  const scale = niceScale(data.map((d) => d.value), integer)
  const x = scaleLinear(scale, m.l, W - m.r)
  const zero = x(0)
  return (
    <svg role="img" aria-label={chartSummaryLabel('bar', data.length)} viewBox={`0 0 ${W} ${H}`} className="pub-chart-svg">
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
              data-testid="public-chart-bar"
              data-group={d.key}
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
                data-testid="public-chart-label"
                data-group={d.key}
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

/** 도넛 — 양수인 값만 조각이 된다. 조각 이름 · 값은 옆의 범례에 모두 적는다. */
function Donut({ data, labels }: { data: readonly ChartDatum[]; labels: boolean }): ReactNode {
  const size = 240
  const c = size / 2
  const slices = donutSlices(data.map((d) => d.value))
  const total = slices.reduce((sum, s) => sum + data[s.index].value, 0)
  const optionColors = donutUsesOptionColors(data)
  return (
    <div className="pub-chart-donut">
      <svg role="img" aria-label={chartSummaryLabel('donut', data.length)} viewBox={`0 0 ${size} ${size}`} className="pub-chart-donut-svg">
        {slices.map((s) => {
          const d = data[s.index]
          return (
            <path
              key={d.key}
              data-testid="public-chart-slice"
              data-group={d.key}
              data-value={d.value}
              d={arcPath(c, c, 108, 64, s.start, s.end)}
              fill={fillOf(d, s.index, true, optionColors)}
              fillRule="evenodd"
              stroke="white"
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
                  data-testid="public-chart-label"
                  data-group={data[s.index].key}
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
        <text x={c} y={c} textAnchor="middle" dominantBaseline="middle" fontSize={18} fill="currentColor">
          {total.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}
        </text>
      </svg>
      <ul aria-label="범례" className="pub-chart-legend" data-testid="public-chart-legend">
        {data.map((d, i) => (
          <li key={d.key}>
            <span aria-hidden="true" className="pub-chart-swatch" style={{ background: fillOf(d, i, true, optionColors) }} />
            <span>{d.label}</span>
            <span className="pub-chart-legend-value">{d.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
