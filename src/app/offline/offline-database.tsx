'use client'

/**
 * 내려받은 데이터베이스를 네트워크 없이 본다 — 읽기 전용 표 (OF-4 · F-12-04 · 정본 §3.7 [보강 OF-1] ⑤)
 *
 * 받은 것은 첫 뷰의 이름 · 보이는 열 · 처음 50행의 보이는 글자뿐이다(`lib/offline/offline-database.ts`). 고치지 않는다 · 행 페이지는 열지 않는다
 * (받지 않았다 — 누르면 온라인에서 열 수 있다고 말한다). 무엇을 그릴지는 순수한 부분이 정한다(`lib/offline/offline-table.ts`).
 *
 * 껍데기의 첫 청크에 함께 싣는다(지연 로드하지 않는다) — 표 하나라 작고, 워커가 설치 때 껍데기의 정적 파일을 받아 두므로 따로 받아 둘
 * 것이 없다(편집기 청크와 다르다 · `offline-warm.ts`).
 */

import { useState } from 'react'

import type { OfflineDatabaseRecord } from '@/lib/offline/offline-store'
import { offlineTable, ROW_ONLINE_ONLY } from '@/lib/offline/offline-table'

export function OfflineDatabase({ record, onClose }: { record: OfflineDatabaseRecord; onClose: () => void }) {
  const [message, setMessage] = useState<string | null>(null)
  const table = offlineTable(record)

  return (
    <div data-testid="offline-database" data-page-id={record.pageId} className="fixed inset-0 z-10 overflow-y-auto bg-[var(--background)]">
      <div className="sticky top-0 z-20 flex min-h-11 items-center justify-between gap-2 bg-[var(--background)] px-3 py-1 text-sm">
        <button
          type="button"
          data-testid="offline-database-close"
          onClick={onClose}
          className="rounded-md px-1.5 py-0.5 hover:bg-[rgba(33,27,23,0.05)] dark:hover:bg-white/5"
        >
          ← 내려받은 페이지
        </button>
        <span className="text-xs text-neutral-500">오프라인 · 읽기만</span>
      </div>
      <div className="mx-auto max-w-5xl px-6 pb-32 pt-10">
        {record.icon?.type === 'emoji' && (
          <div aria-hidden className="mb-2 text-5xl leading-none">
            {record.icon.emoji}
          </div>
        )}
        <h1 data-testid="offline-database-title" className="mb-2 text-3xl font-bold leading-tight">
          {record.name || '제목 없음'}
        </h1>
        {record.viewName !== '' && (
          <p data-testid="offline-database-view" className="mb-1 text-sm font-medium text-neutral-600 dark:text-neutral-300">
            {record.viewName}
          </p>
        )}
        {table.note !== null && (
          <p data-testid="offline-database-note" className="mb-2 text-xs text-neutral-500">
            {table.note}
          </p>
        )}
        <p role="status" data-testid="offline-database-message" className="mb-2 min-h-4 text-xs text-neutral-500">
          {message}
        </p>
        {table.empty !== null && table.columns.length === 0 ? (
          <p data-testid="offline-database-empty" className="text-sm text-neutral-500">
            {table.empty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table data-testid="offline-database-table" className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th
                      key={column.id}
                      scope="col"
                      data-column-id={column.id}
                      className="whitespace-nowrap border-b border-neutral-200 px-2 py-1.5 text-left text-xs font-medium text-neutral-500 dark:border-neutral-800"
                    >
                      {column.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr
                    key={row.id}
                    data-testid="offline-database-row"
                    data-row-id={row.id}
                    tabIndex={0}
                    onClick={() => setMessage(ROW_ONLINE_ONLY)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') setMessage(ROW_ONLINE_ONLY)
                    }}
                    className="cursor-default hover:bg-[rgba(33,27,23,0.03)] focus:outline-none focus-visible:bg-[rgba(33,27,23,0.05)] dark:hover:bg-white/5"
                  >
                    {row.cells.map((cell, i) => (
                      <td key={table.columns[i].id} className="max-w-xs truncate border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-900">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {table.empty !== null && (
              <p data-testid="offline-database-empty" className="mt-2 text-sm text-neutral-500">
                {table.empty}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
