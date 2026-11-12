/**
 * 대시보드 뷰의 격자 — DB-2 (F-04-20 · 서버 컴포넌트)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 DB-1] ③ ④
 *
 * 줄마다 그 높이(320 · 480 · 640px), 한 줄의 위젯은 폭을 똑같이 나눈다 — 좁은 화면(md 아래)에서는 세로로 쌓고 칸마다 그 줄의 높이다. 위젯마다
 * 작은 틀: 머리(이름 · "전체로 열기")와 몸(그 위젯 뷰의 보통 화면 — 페이지가 `renderWidget` 으로 준다). 몸은 위젯마다 `Suspense` 경계라 따로
 * 읽혀 흘러 들어온다(격자 · 머리가 먼저 선다).
 *
 * 원본을 볼 수 없는 위젯은 "볼 수 없는 위젯" — 이름 · 타입 · 행 수를 그리지 않는다(서버가 주지도 않는다 · N-2). 소스가 휴지통에 있으면 "지워진
 * 소스". 위젯은 변경 알림을 구독하지 않는다(`WithoutTableChanges` — 위젯마다 연결을 열면 호스트당 연결 수를 다 쓴다). 이 파일 자체는 클라이언트
 * JS 가 없다 — 대시보드가 아닌 뷰의 첫 JS 에 들지 않는다.
 */

import { Suspense, type ReactNode } from 'react'
import Link from '@/app/link'
import type { DashboardWidget } from '@/lib/database/dashboard'
import type { DashboardGridRow } from '@/lib/database/dashboard-grid'
import { WithoutTableChanges } from './use-table-changes'

const FRAME =
  'flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-200 md:w-auto md:flex-1 md:basis-0 dark:border-neutral-800'
const HEAD = 'flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800'
const NOTE = 'flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center text-sm text-neutral-500'

export function DashboardView({
  rows,
  canEditStructure,
  openHref,
  renderWidget,
}: {
  readonly rows: readonly DashboardGridRow<DashboardWidget>[]
  readonly canEditStructure: boolean
  /** "전체로 열기" — 그 위젯 뷰를 데이터베이스 화면에서(`?view=<위젯 id>`) */
  readonly openHref: (widgetId: string) => string
  /** 위젯의 몸 — 그 위젯 뷰의 보통 읽기 · 보통 화면(서버 컴포넌트). `rowPx` 는 그 줄의 높이(칸에 맞춰 그리는 것이 쓴다) */
  readonly renderWidget: (widgetId: string, rowPx: number) => ReactNode
}) {
  if (rows.length === 0) {
    return (
      <div
        role="status"
        data-testid="db-dashboard-empty"
        className="flex flex-col gap-1 rounded-lg border border-dashed border-neutral-300 px-6 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700"
      >
        <p className="font-medium text-neutral-700 dark:text-neutral-200">위젯이 없습니다</p>
        {/* 위젯 넣기 · 옮기기는 편집 모드(DB-3)의 일이다 */}
        {canEditStructure && <p>위젯을 넣는 &quot;편집&quot; 단추는 곧 생깁니다.</p>}
      </div>
    )
  }
  return (
    <WithoutTableChanges>
    <div data-testid="db-dashboard" className="flex flex-col gap-4">
      {rows.map((row) => (
        <div key={row.cells[0]?.id} data-testid="db-dashboard-row" data-height={row.height} className="flex flex-col gap-4 md:flex-row">
          {row.cells.map((widget) =>
            !widget.accessible ? (
              <section key={widget.id} data-testid="db-widget" data-widget-id={widget.id} data-locked="true" className={FRAME} style={{ height: row.heightPx }}>
                <div role="status" data-testid="db-widget-locked" className={NOTE}>
                  <p className="font-medium text-neutral-700 dark:text-neutral-200">볼 수 없는 위젯</p>
                  <p>원본 데이터베이스를 볼 수 있는 사람만 봅니다.</p>
                </div>
              </section>
            ) : (
              <section
                key={widget.id}
                data-testid="db-widget"
                data-widget-id={widget.id}
                data-widget-type={widget.type}
                className={FRAME}
                style={{ height: row.heightPx }}
              >
                <div className={HEAD}>
                  <h3 data-testid="db-widget-name" className="truncate text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    {widget.name}
                  </h3>
                  {/* 휴지통의 소스는 열 뷰가 없다 */}
                  {!widget.sourceGone && (
                    <Link
                      href={openHref(widget.id)}
                      data-testid="db-widget-open"
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                    >
                      전체로 열기
                    </Link>
                  )}
                </div>
                {widget.sourceGone ? (
                  <div role="status" data-testid="db-widget-source-gone" className={NOTE}>
                    <p className="font-medium text-neutral-700 dark:text-neutral-200">지워진 소스</p>
                    <p>이 위젯의 데이터 소스가 휴지통에 있습니다. 되살리면 돌아옵니다.</p>
                  </div>
                ) : (
                  <div data-testid="db-widget-body" className="min-h-0 flex-1 overflow-auto p-2">
                    <Suspense
                      fallback={
                        <p data-testid="db-widget-loading" className="px-2 py-4 text-sm text-neutral-400">
                          불러오는 중…
                        </p>
                      }
                    >
                      {renderWidget(widget.id, row.heightPx)}
                    </Suspense>
                  </div>
                )}
              </section>
            ),
          )}
        </div>
      ))}
    </div>
    </WithoutTableChanges>
  )
}

/** 읽는 사이에 원본을 볼 수 없게 됐거나 위젯이 지워졌다 — 이름 없이(몸 자리에). */
export function WidgetUnavailable() {
  return (
    <div role="status" data-testid="db-widget-locked" className={`${NOTE} h-full`}>
      <p className="font-medium text-neutral-700 dark:text-neutral-200">볼 수 없는 위젯</p>
    </div>
  )
}
