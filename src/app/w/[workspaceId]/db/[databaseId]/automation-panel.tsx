'use client'

/**
 * DB automation 패널 — 도구줄 줄의 ⚡ (자동화 5b-3a · 5b-3b · F-08-09)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] DB automation — 화면 ① ⓐ ~ ⓔ · ② ⓐ
 *   08 *"DB 헤더의 ⚡ 아이콘(활성 automation 개수 배지), automation 목록 팝오버, 켜기/끄기 토글"*
 *
 * 서버가 이 패널을 세울지 정한다 — 그 표의 전체 권한이 있을 때만 배지를 준다(정의의 문과 같다). 목록은 열 때 받는다(템플릿 패널과
 * 같다) — 트리거의 속성 이름은 그 표의 **스키마**에서 읽는다(숨긴 속성도 · 사라졌으면 "지워진 속성").
 *
 * 보고 · 켜고 끄고 · 지우고 · 실행 기록을 본다(5b-3a). "+ 새 자동화" · "고치기"는 같은 편집기를 이 패널 안에 연다(5b-3b ·
 * `automation-editor.tsx`) — 저장하면 목록이 그 결과로 바뀐다(배지도).
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

import type { OperatorCatalogEntry } from '@/lib/database/operator-catalog'
import type { PropertySummary } from '@/lib/database/property'
import type { FilterLeaf } from '@/lib/database/filter'
import { isFilterableType } from '@/lib/database/filter'
import { describeRule, type RuleColumn } from '@/lib/database/filter-draft'
import * as api from './table-api'
import { AutomationEditor } from './automation-editor'
import { actionSummary, deliveryLabel, disabledMessage, runRowLabel, runStatusLabel, stepLine, triggerSummary, type TriggerNames } from './automation-messages'

type Badge = { readonly enabled: number; readonly attention: number }

/** 그 표의 스키마에서 — 숨긴 속성도(정본 화면 ⓑ). 조건 칩은 보기의 필터와 같은 말로 쓴다. */
const columnsOf = (properties: readonly PropertySummary[]): RuleColumn[] =>
  properties.flatMap((p) => (isFilterableType(p.type) ? [{ propertyId: p.id, name: p.name, type: p.type, options: p.options ?? [] }] : []))

const namesOf = (columns: readonly RuleColumn[], catalog: readonly OperatorCatalogEntry[]): TriggerNames => ({
  property: (id) => columns.find((c) => c.propertyId === id)?.name ?? null,
  condition: ({ propertyId, condition }) =>
    describeRule(
      condition as FilterLeaf,
      columns.find((c) => c.propertyId === propertyId),
      catalog,
    ),
})

export function AutomationPanel(props: {
  workspaceId: string
  dataSourceId: string
  badge: Badge
  /** 잠긴 동안은 실행되지 않는다(정본 화면 ⓔ — 붙인 소스면 원본의 잠금). */
  locked: boolean
  catalog: readonly OperatorCatalogEntry[]
}) {
  const { workspaceId, dataSourceId, locked, catalog } = props
  const [open, setOpen] = useState(false)
  const [automations, setAutomations] = useState<api.DbAutomationJson[] | null>(null)
  const [columns, setColumns] = useState<RuleColumn[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [runsFor, setRunsFor] = useState<string | null>(null)
  const [runs, setRuns] = useState<api.DbAutomationRunsJson | null>(null)
  /** 편집기 — 새로 만들기(id null) 또는 그 automation 고치기. */
  const [editing, setEditing] = useState<{ readonly id: string | null } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // 배지 — 목록을 받았으면 목록에서, 아니면 서버가 준 것
  const badge: Badge =
    automations === null
      ? props.badge
      : { enabled: automations.filter((a) => a.enabled).length, attention: automations.filter((a) => a.disabledReason !== null).length }

  const toggleOpen = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setAutomations(null)
    setError(null)
    setRunsFor(null)
    setConfirming(null)
    setEditing(null)
    const [listed, properties] = await Promise.all([api.listDbAutomations(workspaceId, dataSourceId), api.readProperties(workspaceId, dataSourceId)])
    if (!listed.ok) {
      setError(listed.message)
      return
    }
    if (properties.ok) setColumns(columnsOf(properties.value))
    setAutomations([...listed.value])
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const names = namesOf(columns, catalog)
  const replace = (next: api.DbAutomationJson) => setAutomations((current) => (current ?? []).map((a) => (a.id === next.id ? next : a)))

  const toggleEnabled = async (automation: api.DbAutomationJson) => {
    setBusy(automation.id)
    setError(null)
    const updated = await api.setDbAutomationEnabled(workspaceId, dataSourceId, automation.id, !automation.enabled)
    setBusy(null)
    if (!updated.ok) setError(updated.message)
    else replace(updated.value)
  }

  const remove = async (automation: api.DbAutomationJson) => {
    setBusy(automation.id)
    setError(null)
    const removed = await api.deleteDbAutomation(workspaceId, dataSourceId, automation.id)
    setBusy(null)
    setConfirming(null)
    if (!removed.ok) {
      setError(removed.message)
      return
    }
    setAutomations((current) => (current ?? []).filter((a) => a.id !== automation.id))
    if (runsFor === automation.id) setRunsFor(null)
  }

  const toggleRuns = async (automation: api.DbAutomationJson) => {
    if (runsFor === automation.id) {
      setRunsFor(null)
      return
    }
    setRunsFor(automation.id)
    setRuns(null)
    const listed = await api.listDbAutomationRuns(workspaceId, dataSourceId, automation.id)
    if (!listed.ok) setError(listed.message)
    else setRuns(listed.value)
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        data-testid="db-automations-button"
        aria-expanded={open}
        aria-label={`자동화 — 켜진 ${badge.enabled}개${badge.attention > 0 ? ' · 확인할 것이 있음' : ''}`}
        onClick={() => void toggleOpen()}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <span aria-hidden>⚡</span>
        {badge.enabled > 0 && (
          <span data-testid="db-automations-count" className="rounded-full bg-neutral-200 px-1.5 text-xs text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
            {badge.enabled}
          </span>
        )}
        {badge.attention > 0 && (
          <span data-testid="db-automations-attention" className="font-semibold text-amber-600">
            !
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="db-automations-panel"
          className={`absolute right-0 top-full z-20 mt-1 ${editing === null ? 'w-96' : 'w-[32rem]'} rounded-lg border border-neutral-200 bg-white p-2 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-950`}
        >
          <p className="px-2 py-1 text-xs text-neutral-500">자동화는 만든 사람의 권한으로 돕니다. 바뀐 뒤 몇 초 안에 실행됩니다.</p>
          {locked && (
            <p data-testid="db-automations-locked" className="mx-2 my-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              데이터베이스가 잠겨 있습니다 — 잠긴 동안은 실행되지 않습니다.
            </p>
          )}

          {automations === null && !error && <p className="px-2 py-2 text-neutral-400">불러오는 중…</p>}
          {automations !== null && editing !== null && (
            <AutomationEditor
              // 다른 것을 고치러 가면 초안을 새로 — 같은 편집기를 다시 쓰지 않는다
              key={editing.id ?? 'new'}
              workspaceId={workspaceId}
              dataSourceId={dataSourceId}
              columns={columns}
              catalog={catalog}
              initial={editing.id === null ? null : (automations.find((a) => a.id === editing.id) ?? null)}
              onSaved={(saved) => {
                setAutomations((current) =>
                  (current ?? []).some((a) => a.id === saved.id) ? (current ?? []).map((a) => (a.id === saved.id ? saved : a)) : [...(current ?? []), saved],
                )
                setEditing(null)
              }}
              onCancel={() => setEditing(null)}
            />
          )}
          {automations !== null && editing === null && automations.length === 0 && (
            <p className="px-2 py-2 text-neutral-400" data-testid="db-automations-empty">
              아직 자동화가 없습니다.
            </p>
          )}

          {automations !== null && editing === null && automations.length > 0 && (
            <ul className="flex flex-col gap-1" data-testid="db-automations-list">
              {automations.map((a) => {
                const reason = disabledMessage(a.disabledReason)
                return (
                  <li key={a.id} data-testid="db-automation-item" data-automation-id={a.id} className="flex flex-col gap-1 rounded px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                    <div className="flex items-center gap-2">
                      <span data-testid="db-automation-name" className="min-w-0 flex-1 truncate font-medium">
                        {a.name}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={a.enabled}
                        aria-label={`${a.name} ${a.enabled ? '끄기' : '켜기'}`}
                        data-testid="db-automation-toggle"
                        disabled={busy === a.id}
                        onClick={() => void toggleEnabled(a)}
                        className={`h-5 w-9 rounded-full p-0.5 transition-colors ${a.enabled ? 'bg-blue-600' : 'bg-neutral-300 dark:bg-neutral-700'}`}
                      >
                        <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${a.enabled ? 'translate-x-4' : ''}`} />
                      </button>
                    </div>
                    <p data-testid="db-automation-triggers" className="text-xs text-neutral-600 dark:text-neutral-300">
                      {triggerSummary(a.triggers, names)}
                    </p>
                    <p data-testid="db-automation-actions" className="text-xs text-neutral-500">
                      → {actionSummary(a.actions)}
                    </p>
                    <p data-testid="db-automation-creator" className="text-xs text-neutral-400">
                      실행 주체: {a.createdBy.name === '' ? '떠난 사람' : a.createdBy.name}
                    </p>
                    {reason !== null && !a.enabled && (
                      <p data-testid="db-automation-reason" role="note" className="text-xs text-amber-700 dark:text-amber-300">
                        ! {reason}
                      </p>
                    )}
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        data-testid="db-automation-edit"
                        onClick={() => {
                          setRunsFor(null)
                          setConfirming(null)
                          setEditing({ id: a.id })
                        }}
                        className="text-neutral-500 hover:underline underline-offset-4"
                      >
                        고치기
                      </button>
                      <button
                        type="button"
                        data-testid="db-automation-runs-button"
                        aria-expanded={runsFor === a.id}
                        onClick={() => void toggleRuns(a)}
                        className="text-neutral-500 hover:underline underline-offset-4"
                      >
                        실행 기록
                      </button>
                      {confirming === a.id ? (
                        <span className="flex items-center gap-1" data-testid="db-automation-delete-confirm">
                          <span className="text-red-600">실행 기록도 함께 지워집니다.</span>
                          <button
                            type="button"
                            data-testid="db-automation-delete-yes"
                            disabled={busy === a.id}
                            onClick={() => void remove(a)}
                            className="rounded px-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          >
                            지우기
                          </button>
                          <button type="button" data-testid="db-automation-delete-no" onClick={() => setConfirming(null)} className="rounded px-1 text-neutral-500">
                            그만두기
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          data-testid="db-automation-delete"
                          onClick={() => setConfirming(a.id)}
                          className="text-neutral-400 hover:text-red-600"
                        >
                          지우기
                        </button>
                      )}
                    </div>
                    {runsFor === a.id && (
                      <div data-testid="db-automation-runs" className="mt-1 flex flex-col gap-1 border-l border-neutral-200 pl-2 dark:border-neutral-800">
                        {runs === null && <p className="text-xs text-neutral-400">불러오는 중…</p>}
                        {runs !== null && runs.runs.length === 0 && (
                          <p data-testid="db-automation-runs-empty" className="text-xs text-neutral-400">
                            아직 실행된 적이 없습니다.
                          </p>
                        )}
                        {runs?.runs.map((run) => {
                          const row = runRowLabel(run.triggerPageId, runs.titles)
                          return (
                            <div key={run.id} data-testid="db-automation-run" data-status={run.status} className="flex flex-col text-xs">
                              <span className="flex flex-wrap items-center gap-1">
                                <time dateTime={run.startedAt} className="text-neutral-400">
                                  {new Date(run.startedAt).toLocaleString('ko-KR')}
                                </time>
                                <span className={run.status === 'failed' ? 'text-red-600' : run.status === 'partial' ? 'text-amber-700' : 'text-green-700'}>
                                  {runStatusLabel(run.status)}
                                </span>
                                {row.linkable && run.triggerPageId !== null ? (
                                  <Link href={`/w/${workspaceId}/${run.triggerPageId}`} data-testid="db-automation-run-row" className="truncate hover:underline underline-offset-4">
                                    {row.text}
                                  </Link>
                                ) : (
                                  <span data-testid="db-automation-run-row" className="text-neutral-400">
                                    {row.text}
                                  </span>
                                )}
                              </span>
                              {run.steps.map((step) => {
                                // 웹훅 단계는 그 배달의 상태를 함께(5c-3b · 정본 ⑮)
                                const delivery = step.deliveryId === undefined ? undefined : runs.deliveries[step.deliveryId]
                                return (
                                  <span key={step.index} data-testid="db-automation-step" className="pl-2 text-neutral-500">
                                    {stepLine(step)}
                                    {delivery !== undefined && <span data-testid="db-automation-delivery"> · {deliveryLabel(delivery)}</span>}
                                  </span>
                                )
                              })}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {automations !== null && editing === null && (
            <button
              type="button"
              data-testid="db-automations-new"
              onClick={() => {
                setRunsFor(null)
                setConfirming(null)
                setEditing({ id: null })
              }}
              className="mt-1 rounded-md px-2 py-1 text-left text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              + 새 자동화
            </button>
          )}

          {error && (
            <p role="alert" data-testid="db-automations-error" className="px-2 py-1 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
