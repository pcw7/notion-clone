/**
 * 풀페이지 데이터베이스 — `/w/{workspaceId}/db/{databaseId}`
 *
 * 정본: 04-database-views.md F-04-14(풀페이지) · F-04-01(뷰 컨테이너) · F-04-02(Table)
 *       03-database-core.md F-03-16(셀 편집) · F-03-17(페이지네이션)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 첫 화면은 서버가 한 번에 읽는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 표 · 뷰 탭 · 컬럼 · 첫 페이지 행을 여기서 읽어 내려준다. 클라이언트가 마운트 뒤에
 * `GET /rows` 를 부르면 빈 표가 한 번 그려졌다가 채워진다. 그 뒤의 쓰기와 "더 보기"는
 * 클라이언트가 API 로 한다.
 *
 * `GET /api/.../views/[viewId]/rows` 와 **같은 함수를 같은 순서로** 부른다
 * (`getView` → `queryRows`). 필터·정렬은 뷰에 저장된 것을 쓰고 URL 에서 받지 않는다 —
 * 같은 링크를 연 두 사람이 같은 행을 본다(F-03-17: "뷰 설정은 공유 상태다").
 *
 * ──────────────────────────────────────────────────────────────────────
 * `?v=` 가 없는 뷰를 가리키면 기본 뷰를 보여준다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-04-01: *"삭제된 뷰의 `?v=` 딥링크로 접근 → 기본 뷰로 리다이렉트 + 토스트.
 * 404 로 떨어뜨리지 않는다."* 링크를 저장해 둔 사람이 표 자체에 못 들어오면 안 된다.
 * 토스트는 아직 없다.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'

import { isUuid } from '@/lib/ids'
import { requirePageSession } from '@/lib/auth/page-session'
import { getDatabase } from '@/lib/database/database'
import { getView, listViews } from '@/lib/database/view'
import { queryRows } from '@/lib/database/query'
import { rowJson } from '@/lib/database/http'
import { DatabaseTitle } from './database-title'
import { DatabaseTable } from './database-table'

const UNTITLED = '제목 없음'

export default async function DatabasePage({
  params,
  searchParams,
}: PageProps<'/w/[workspaceId]/db/[databaseId]'>) {
  const { workspaceId, databaseId } = await params
  const { v } = await searchParams

  const ctx = await requirePageSession(workspaceId)
  // uuid 가 아니면 질의가 pg 형식 오류로 죽는다. "없다"와 구분할 이유가 없다.
  if (!isUuid(databaseId)) notFound()

  // 볼 수 없는 표는 없는 표와 같다(HANDOFF §3.3-31).
  const database = await getDatabase(ctx, databaseId)
  if (!database.ok) notFound()

  const views = await listViews(ctx, databaseId)
  if (!views.ok || views.value.length === 0) notFound()
  const current = views.value.find((view) => view.id === v) ?? views.value[0]

  const view = await getView(ctx, current.id)
  if (!view.ok) notFound()

  const page = await queryRows(ctx, view.value.dataSourceId, {
    filter: view.value.filter,
    sorts: view.value.sorts,
    limit: view.value.loadLimit,
  })
  if (!page.ok) notFound()

  const { name, access } = database.value

  return (
    <main className="flex min-h-screen min-w-0 flex-col gap-6 px-10 py-12">
      <nav aria-label="상위 경로" className="flex flex-wrap items-center gap-1 text-sm text-neutral-500">
        <Link href={`/w/${workspaceId}`} className="hover:underline underline-offset-4">
          워크스페이스
        </Link>
        <span aria-hidden>/</span>
        <span className="text-neutral-400">{name || UNTITLED}</span>
      </nav>

      <DatabaseTitle
        workspaceId={workspaceId}
        databaseId={databaseId}
        initialName={name}
        canEdit={access.canEditStructure}
      />

      {/*
        뷰 탭(F-04-01). 지금은 **고르기만** 한다 — 만들기·이름 바꾸기·삭제 UI 는 아직
        없다(뷰 타입이 table 하나라 두 번째 뷰를 만들 이유가 약하다).
      */}
      <nav aria-label="뷰" className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {views.value.map((tab) => (
          <Link
            key={tab.id}
            href={`/w/${workspaceId}/db/${databaseId}?v=${tab.id}`}
            aria-current={tab.id === current.id ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
              tab.id === current.id
                ? 'border-neutral-900 font-medium dark:border-neutral-100'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}
          >
            {tab.name}
          </Link>
        ))}
      </nav>

      <DatabaseTable
        // 뷰를 바꾸면 표의 상태(선택 · 편집 · 불러온 행)를 버린다. 다른 뷰의 목록에
        // 이전 뷰의 커서로 이어 붙이면 순서가 섞인다.
        key={view.value.id}
        workspaceId={workspaceId}
        viewId={view.value.id}
        dataSourceId={view.value.dataSourceId}
        tableName={name}
        columns={view.value.columns.filter((column) => column.visible)}
        rows={page.value.rows.map(rowJson)}
        hasMore={page.value.hasMore}
        nextCursor={page.value.nextCursor}
        access={access}
      />
    </main>
  )
}
