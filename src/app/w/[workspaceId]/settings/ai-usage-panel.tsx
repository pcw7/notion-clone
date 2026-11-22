'use client'

/**
 * AI 사용량 — 설정 → AI → "사용량" (AI-7 · F-10-25) · 지연 로드(`ai-lazy.tsx` — 설정 화면의 첫 JS 에 들지 않는다)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑫
 *
 * 열 때 `GET …/ai/usage`(개요)와 `GET …/ai/usage/log`(기록 첫 쪽)를 읽는다. 소유자 · 멤버 관리자는 워크스페이스 전체, 다른 멤버는 자기
 * 것만(서버가 가른다 — `scope`). 30일 막대는 기능마다 쌓은 손으로 그린 SVG(`chart-geometry` 의 눈금). 기록은 "더 보기" 로 커서 다음 쪽 ·
 * 사람 · 기능으로 거른다. 날은 UTC · 시각은 보는 사람의 시간대.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import Link from '@/app/link'
import {
  AI_FEATURE_LABEL,
  AI_STATUS_LABEL,
  countText,
  shortDay,
  stackDay,
  type AiDailySeries,
  type AiUsageLogEntry,
  type AiUsageOverview,
} from '@/lib/ai/analytics-shared'
import { AI_FEATURES, type AiFeature, type AiQuotaView } from '@/lib/ai/quota'
import { niceScale, OPTION_FILL, scaleLinear } from '@/lib/database/chart-geometry'

const NOTE = 'text-xs text-neutral-500'
const H4 = 'text-xs font-medium text-neutral-700 dark:text-neutral-300'
const TABLE = 'min-w-full text-left text-xs'
const TH = 'whitespace-nowrap px-2 py-1 font-medium text-neutral-500'
const TD = 'whitespace-nowrap px-2 py-1'
const TD_NUM = 'whitespace-nowrap px-2 py-1 text-right tabular-nums'

/** 기능마다의 색 — 옵션 색에서(쌓는 차례는 `AI_FEATURES`). */
const FEATURE_FILL: Readonly<Record<AiFeature, string>> = {
  ask: OPTION_FILL.blue,
  edit: OPTION_FILL.orange,
  translate: OPTION_FILL.green,
  block: OPTION_FILL.purple,
  chat: OPTION_FILL.pink,
}

const timeText = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** 한도 대비 — 창 · 월 · 체험(한도가 있는 것만) · 보충의 남은 수. */
function limitRows(q: AiQuotaView): { key: string; label: string; used: number; limit: number | null }[] {
  const rows: { key: string; label: string; used: number; limit: number | null }[] = []
  if (q.window !== null && q.window.limit !== null && q.window.limit > 0) rows.push({ key: 'window', label: '6시간', used: q.window.used, limit: q.window.limit })
  if (q.month !== null && q.month.limit !== null && q.month.limit > 0) rows.push({ key: 'month', label: '이번 달', used: q.month.used, limit: q.month.limit })
  if (q.trial !== null && q.trial.limit !== null && q.trial.limit > 0) rows.push({ key: 'trial', label: '체험', used: q.trial.used, limit: q.trial.limit })
  if (q.grantsLeft > 0) rows.push({ key: 'grants', label: '보충 남음', used: q.grantsLeft, limit: null })
  return rows
}

function DailyChart({ daily }: { daily: AiDailySeries }) {
  const W = 640
  const H = 200
  const m = { l: 36, r: 8, t: 10, b: 24 }
  const scale = niceScale(daily.totals, true)
  const y = scaleLinear(scale, H - m.b, m.t)
  const n = daily.days.length
  const band = (W - m.l - m.r) / n
  const barW = Math.max(2, band * 0.7)
  const total = daily.totals.reduce((a, b) => a + b, 0)
  return (
    <figure className="flex flex-col gap-2">
      <svg
        data-testid="ai-usage-chart"
        role="img"
        aria-label={`지난 ${n}일 날마다 AI 응답 — 모두 ${countText(total)}`}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full text-neutral-500 dark:text-neutral-400"
      >
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.5 : 0.15} />
            <text x={m.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="currentColor">
              {countText(t)}
            </text>
          </g>
        ))}
        {daily.days.map((day, i) => {
          const x = m.l + band * i + (band - barW) / 2
          return (
            <g key={day} data-testid="ai-usage-chart-day" data-day={day} data-total={daily.totals[i]}>
              {stackDay(daily, i).map((seg) => (
                <rect
                  key={seg.feature}
                  data-testid="ai-usage-chart-segment"
                  data-day={day}
                  data-feature={seg.feature}
                  data-value={seg.value}
                  x={x}
                  y={y(seg.to)}
                  width={barW}
                  height={Math.max(0, y(seg.from) - y(seg.to))}
                  fill={FEATURE_FILL[seg.feature]}
                >
                  <title>{`${day} · ${AI_FEATURE_LABEL[seg.feature]} ${countText(seg.value)}`}</title>
                </rect>
              ))}
              {/* 날 글자는 닷새마다(오늘이 끝) */}
              {(n - 1 - i) % 5 === 0 && (
                <text x={m.l + band * (i + 0.5)} y={H - m.b + 15} textAnchor="middle" fontSize={11} fill="currentColor">
                  {shortDay(day)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <ul aria-label="범례" className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {AI_FEATURES.map((f) => (
          <li key={f} className="flex items-center gap-1">
            <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: FEATURE_FILL[f] }} />
            {AI_FEATURE_LABEL[f]}
          </li>
        ))}
      </ul>
    </figure>
  )
}

function Breakdown({ testId, title, rows }: { testId: string; title: string; rows: { key: string; label: string; responses: number; inputTokens: number; outputTokens: number }[] }) {
  return (
    <div className="min-w-0">
      <h4 className={H4}>{title}</h4>
      {rows.length === 0 ? (
        <p className={NOTE}>이번 달에는 없습니다</p>
      ) : (
        <div className="overflow-x-auto">
          <table data-testid={testId} className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>{title.split(' ')[0]}</th>
                <th className={`${TH} text-right`}>응답</th>
                <th className={`${TH} text-right`}>토큰(입력/출력)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid={`${testId}-row`} data-key={r.key} data-responses={r.responses}>
                  <td className={`${TD} max-w-[14rem] truncate`}>{r.label}</td>
                  <td className={TD_NUM}>{countText(r.responses)}</td>
                  <td className={TD_NUM}>
                    {countText(r.inputTokens)} / {countText(r.outputTokens)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function AiUsagePanel({ workspaceId }: { workspaceId: string }) {
  const [overview, setOverview] = useState<AiUsageOverview | null>(null)
  const [failed, setFailed] = useState(false)
  const [entries, setEntries] = useState<AiUsageLogEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [logBusy, setLogBusy] = useState(true)
  const [logFailed, setLogFailed] = useState(false)
  const [member, setMember] = useState('')
  const [feature, setFeature] = useState('')
  const rootRef = useRef<HTMLElement>(null)
  const base = `/api/workspaces/${workspaceId}/ai/usage`

  useEffect(() => {
    let live = true
    fetch(base)
      .then((res) => (res.ok ? (res.json() as Promise<{ usage?: AiUsageOverview }>) : null))
      .then((body) => {
        if (!live) return
        if (body?.usage === undefined) setFailed(true)
        else setOverview(body.usage)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [base])

  /** 기록 한 쪽을 읽는다 — `after` 가 없으면 처음부터. 실패면 null. */
  const fetchLog = useCallback(
    async (after: string | null, who: string, what: string): Promise<{ entries: AiUsageLogEntry[]; nextCursor: string | null } | null> => {
      const q = new URLSearchParams()
      if (after !== null) q.set('cursor', after)
      if (who !== '') q.set('member', who)
      if (what !== '') q.set('feature', what)
      try {
        const res = await fetch(`${base}/log?${q.toString()}`)
        const body = (await res.json().catch(() => null)) as { entries?: AiUsageLogEntry[]; nextCursor?: string | null } | null
        return res.ok && Array.isArray(body?.entries) ? { entries: body.entries, nextCursor: body.nextCursor ?? null } : null
      } catch {
        return null
      }
    },
    [base],
  )

  // 첫 쪽 — 거르기가 바뀌면 처음부터(바쁨 표시는 바꾸는 쪽이 켠다)
  useEffect(() => {
    let live = true
    void fetchLog(null, member, feature).then((page) => {
      if (!live) return
      setLogFailed(page === null)
      if (page !== null) {
        setEntries(page.entries)
        setCursor(page.nextCursor)
      }
      setLogBusy(false)
    })
    return () => {
      live = false
    }
  }, [fetchLog, member, feature])

  const more = async () => {
    if (cursor === null) return
    setLogBusy(true)
    const page = await fetchLog(cursor, member, feature)
    setLogFailed(page === null)
    if (page !== null) {
      setEntries((list) => [...list, ...page.entries])
      setCursor(page.nextCursor)
    }
    setLogBusy(false)
  }

  const refilter = (who: string, what: string) => {
    setLogBusy(true)
    setMember(who)
    setFeature(what)
  }

  // 다 읽었다는 표지(시험이 기다린다)
  useEffect(() => {
    if (overview !== null && !logBusy) rootRef.current?.setAttribute('data-ready', 'true')
  }, [overview, logBusy])

  return (
    <section ref={rootRef} data-testid="ai-usage-analytics" data-scope={overview?.scope ?? ''} aria-label="AI 사용량" className="flex flex-col gap-3">
      <h3 className="text-xs font-medium">사용량</h3>
      {failed && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          사용량을 읽지 못했습니다.
        </p>
      )}
      {overview === null ? (
        !failed && <p className={NOTE}>사용량을 불러오는 중…</p>
      ) : (
        <>
          <p data-testid="ai-usage-scope" className={NOTE}>
            {overview.scope === 'workspace' ? '워크스페이스 전체 · 이번 달(UTC)' : '내 사용량만 보입니다 · 이번 달(UTC)'} — 질문과 답의 글은 기록하지 않습니다.
          </p>
          <dl data-testid="ai-usage-month" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['responses', '응답', overview.month.responses],
              ['input', '입력 토큰', overview.month.inputTokens],
              ['output', '출력 토큰', overview.month.outputTokens],
              ['failed', '실패', overview.month.failed],
            ].map(([key, label, value]) => (
              <div key={key} data-key={key} data-value={value} className="rounded border border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
                <dt className={NOTE}>{label}</dt>
                <dd className="text-sm font-medium tabular-nums">{countText(Number(value))}</dd>
              </div>
            ))}
          </dl>
          {limitRows(overview.quota).length > 0 && (
            <ul data-testid="ai-usage-limits" aria-label="한도 대비" className="flex flex-col gap-1 text-xs">
              {limitRows(overview.quota).map((r) => (
                <li key={r.key} data-testid="ai-usage-limit" data-key={r.key} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-neutral-500">{r.label}</span>
                  {r.limit === null ? (
                    <span className="tabular-nums">{countText(r.used)}</span>
                  ) : (
                    <>
                      <span aria-hidden className="h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
                        <span className="block h-full bg-blue-500" style={{ width: `${Math.min(100, (r.used / r.limit) * 100)}%` }} />
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {countText(r.used)} / {countText(r.limit)}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div>
            <h4 className={H4}>지난 30일 · 날마다 응답(UTC)</h4>
            <DailyChart daily={overview.daily} />
          </div>

          <div className="min-w-0">
            <h4 className={H4}>사람마다 · 이번 달</h4>
            {overview.members.length === 0 ? (
              <p className={NOTE}>이번 달에는 없습니다</p>
            ) : (
              <div className="overflow-x-auto">
                <table data-testid="ai-usage-members" className={TABLE}>
                  <thead>
                    <tr>
                      <th className={TH}>사람</th>
                      <th className={`${TH} text-right`}>응답</th>
                      <th className={`${TH} text-right`}>입력 토큰</th>
                      <th className={`${TH} text-right`}>출력 토큰</th>
                      <th className={TH}>마지막 사용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.members.map((r) => (
                      <tr key={r.userId} data-testid="ai-usage-member" data-user-id={r.userId} data-responses={r.responses}>
                        <td className={`${TD} max-w-[12rem] truncate`}>{r.name}</td>
                        <td className={TD_NUM}>{countText(r.responses)}</td>
                        <td className={TD_NUM}>{countText(r.inputTokens)}</td>
                        <td className={TD_NUM}>{countText(r.outputTokens)}</td>
                        <td className={TD}>{r.lastUsedAt === null ? '—' : timeText(r.lastUsedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Breakdown
              testId="ai-usage-features"
              title="기능마다 · 이번 달"
              rows={overview.features.map((r) => ({ key: r.feature, label: AI_FEATURE_LABEL[r.feature], ...r }))}
            />
            <Breakdown testId="ai-usage-models" title="모델마다 · 이번 달" rows={overview.models.map((r) => ({ key: r.model, label: r.model, ...r }))} />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <h4 className={H4}>AI 활동 기록</h4>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {overview.scope === 'workspace' && (
                <select
                  data-testid="ai-usage-log-member"
                  aria-label="사람으로 거르기"
                  value={member}
                  onChange={(e) => refilter(e.target.value, feature)}
                  className="max-w-[12rem] rounded border border-neutral-300 bg-white px-1.5 py-1 dark:border-neutral-700 dark:bg-neutral-950"
                >
                  <option value="">모든 사람</option>
                  {overview.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <select
                data-testid="ai-usage-log-feature"
                aria-label="기능으로 거르기"
                value={feature}
                onChange={(e) => refilter(member, e.target.value)}
                className="rounded border border-neutral-300 bg-white px-1.5 py-1 dark:border-neutral-700 dark:bg-neutral-950"
              >
                <option value="">모든 기능</option>
                {AI_FEATURES.map((f) => (
                  <option key={f} value={f}>
                    {AI_FEATURE_LABEL[f]}
                  </option>
                ))}
              </select>
            </div>
            {logFailed && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                기록을 읽지 못했습니다.
              </p>
            )}
            {entries.length === 0 && !logBusy && !logFailed ? (
              <p className={NOTE}>기록이 없습니다</p>
            ) : (
              <div className="overflow-x-auto">
                <table data-testid="ai-usage-log" className={TABLE}>
                  <thead>
                    <tr>
                      <th className={TH}>시각</th>
                      <th className={TH}>사람</th>
                      <th className={TH}>기능</th>
                      <th className={TH}>모델</th>
                      <th className={TH}>페이지</th>
                      <th className={TH}>상태</th>
                      <th className={`${TH} text-right`}>토큰</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr
                        key={e.id}
                        data-testid="ai-usage-log-row"
                        data-id={e.id}
                        data-user-id={e.user.id}
                        data-feature={e.feature}
                        data-model={e.model}
                        data-status={e.status}
                      >
                        <td className={TD}>{timeText(e.at)}</td>
                        <td className={`${TD} max-w-[10rem] truncate`}>{e.user.name}</td>
                        <td className={TD}>{AI_FEATURE_LABEL[e.feature]}</td>
                        <td className={`${TD} max-w-[12rem] truncate`}>
                          <code>{e.model}</code>
                        </td>
                        <td className={`${TD} max-w-[12rem] truncate`}>
                          {e.page === null ? (
                            <span className="text-neutral-400">—</span>
                          ) : e.page.kind === 'page' ? (
                            <Link href={`/w/${workspaceId}/${e.page.id}`} data-testid="ai-usage-log-page" data-page-id={e.page.id} className="text-blue-600 hover:underline dark:text-blue-400">
                              {e.page.title.trim() || '제목 없음'}
                            </Link>
                          ) : (
                            <span data-testid="ai-usage-log-hidden" className="text-neutral-400">
                              볼 수 없는 페이지
                            </span>
                          )}
                        </td>
                        <td className={`${TD} ${e.status === 'failed' ? 'text-red-600 dark:text-red-400' : ''}`}>{AI_STATUS_LABEL[e.status]}</td>
                        <td className={TD_NUM}>
                          {e.inputTokens === null ? '—' : countText(e.inputTokens)} / {e.outputTokens === null ? '—' : countText(e.outputTokens)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {cursor !== null && (
              <button
                type="button"
                data-testid="ai-usage-log-more"
                disabled={logBusy}
                onClick={() => void more()}
                className="self-start rounded px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
              >
                {logBusy ? '불러오는 중…' : '더 보기'}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
