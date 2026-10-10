'use client'

/**
 * 감사 로그 패널 — 설정 → 워크스페이스 → 감사 로그 (게시 · 공유 6d-2 · F-11-12)
 *
 * 정본: 00-canonical-data-model.md §3.8 끝 [보강] 감사 로그 ⑤⑥
 *
 * 첫 쪽은 서버가 그려 넘긴다(`setting-panel.tsx`) — 종류를 고르면 다시 읽고, "더 보기" 는 마지막 줄의 시각 앞을 읽는다. CSV 는 지금 고른
 * 종류로 내려받는다(평범한 링크 — 브라우저가 내려받는다). 문구는 CSV 와 같은 함수다(`audit-labels.ts`). 행에는 내용이 없다 — 페이지는
 * 그 페이지로 가는 링크(열 수 있으면 열린다)로만 선다.
 */

import { useState } from 'react'

import { AUDIT_EVENT_TYPES, type AuditEventType, type AuditRow } from '@/lib/audit/audit-types'
import { AUDIT_TYPE_LABEL, auditActor, auditDetail } from '@/lib/audit/audit-labels'

const PAGE = 50

export function AuditPanel({ workspaceId, initial }: { workspaceId: string; initial: readonly AuditRow[] }) {
  const [rows, setRows] = useState<readonly AuditRow[]>(initial)
  const [type, setType] = useState<AuditEventType | ''>('')
  const [more, setMore] = useState(initial.length === PAGE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const read = async (next: { type: AuditEventType | ''; before?: string }): Promise<readonly AuditRow[] | null> => {
    const params = new URLSearchParams({ limit: String(PAGE) })
    if (next.type !== '') params.set('type', next.type)
    if (next.before !== undefined) params.set('before', next.before)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/audit?${params.toString()}`)
      const body = (await res.json().catch(() => null)) as { events?: AuditRow[] } | null
      if (!res.ok || !body?.events) {
        setError('감사 로그를 읽지 못했습니다.')
        return null
      }
      setError(null)
      return body.events
    } catch {
      setError('연결에 실패했습니다.')
      return null
    }
  }

  const choose = async (next: AuditEventType | '') => {
    setType(next)
    setBusy(true)
    const got = await read({ type: next })
    if (got !== null) {
      setRows(got)
      setMore(got.length === PAGE)
    }
    setBusy(false)
  }

  const loadMore = async () => {
    const last = rows.at(-1)
    if (last === undefined) return
    setBusy(true)
    const got = await read({ type, before: last.occurredAt })
    if (got !== null) {
      setRows([...rows, ...got])
      setMore(got.length === PAGE)
    }
    setBusy(false)
  }

  const csvHref = `/api/workspaces/${workspaceId}/audit/csv${type === '' ? '' : `?type=${encodeURIComponent(type)}`}`

  return (
    <section data-testid="audit-panel" className="mt-6 flex flex-col gap-3">
      <p className="text-xs text-neutral-500">
        보안에 닿는 일(로그인 · 권한 · 초대 · 설정 · 내보내기 · 웹 게시 · 영구 삭제)을 365일 남깁니다. 페이지의 내용은 남기지 않습니다.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-neutral-500">종류</span>
          <select
            data-testid="audit-type"
            value={type}
            disabled={busy}
            onChange={(e) => void choose(e.target.value as AuditEventType | '')}
            className="rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">전체</option>
            {AUDIT_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {AUDIT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <a href={csvHref} data-testid="audit-csv" className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
          CSV 내려받기
        </a>
      </div>

      {rows.length === 0 ? (
        <p data-testid="audit-empty" className="text-sm text-neutral-500">
          해당 조건의 기록이 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table data-testid="audit-table" className="w-full min-w-[40rem] border-collapse text-xs">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="border-b border-neutral-200 py-1 pr-2 font-normal dark:border-neutral-800">시각</th>
                <th className="border-b border-neutral-200 py-1 pr-2 font-normal dark:border-neutral-800">종류</th>
                <th className="border-b border-neutral-200 py-1 pr-2 font-normal dark:border-neutral-800">누가</th>
                <th className="border-b border-neutral-200 py-1 pr-2 font-normal dark:border-neutral-800">세부</th>
                <th className="border-b border-neutral-200 py-1 font-normal dark:border-neutral-800">대상</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-testid="audit-row" data-type={row.type} className="align-top">
                  <td className="border-b border-neutral-100 py-1 pr-2 whitespace-nowrap dark:border-neutral-900">
                    {new Date(row.occurredAt).toLocaleString('ko-KR')}
                  </td>
                  <td className="border-b border-neutral-100 py-1 pr-2 whitespace-nowrap dark:border-neutral-900">{AUDIT_TYPE_LABEL[row.type]}</td>
                  <td className="border-b border-neutral-100 py-1 pr-2 dark:border-neutral-900">{auditActor(row)}</td>
                  <td data-testid="audit-detail" className="border-b border-neutral-100 py-1 pr-2 dark:border-neutral-900">
                    {auditDetail(row)}
                  </td>
                  <td className="border-b border-neutral-100 py-1 dark:border-neutral-900">
                    {row.target?.type === 'page' ? (
                      <a href={`/w/${workspaceId}/${row.target.id}`} className="underline underline-offset-2">
                        페이지
                      </a>
                    ) : (
                      (row.target?.type ?? '')
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {more && (
        <button
          type="button"
          data-testid="audit-more"
          disabled={busy}
          onClick={() => void loadMore()}
          className="self-start rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          더 보기
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  )
}
