'use client'

/**
 * 갤러리 — DB 심화 2f-1조각 (F-04-05 Gallery view)
 *
 * 정본: 04-database-views.md F-04-05 · 00-canonical-data-model.md §3.6 [보강] 갤러리
 *
 * 04: *"각 행을 커버 이미지가 있는 카드 그리드로 표시한다."* 카드 = 미리보기(2f-2) + 제목(아이콘) + 보이는 속성의 배지(`CardBadges` —
 * 보드와 같은 것).
 *
 * 미리보기는 레이아웃(`view.configuration.gallery` · `gallery.ts`)이 정한다 — **본문의 첫 이미지**(`page_content` · 서버가 행마다 주소를
 * 준다 · `gallery-covers.ts`) 또는 없음. 미리보기가 켜져 있으면 이미지가 없는 카드도 같은 높이의 빈 자리를 둔다 — 04 *"카드 높이는
 * 유지해야 그리드가 흔들리지 않음"*. 이미지가 깨지면(외부 URL 만료) 빈 자리로 돌린다. 카드 폭(작게 · 보통 · 크게)과 맞춤(채우기 · 전체)도
 * 레이아웃이다. 고르는 곳은 도구줄의 "카드" 패널이다.
 *
 * 행은 표와 같은 길로 읽는다(`queryRows` · 필터 · 정렬 · 검색 · "더 보기"). 하위 항목이 켜진 표면 **부모만**이다(03 F-03-18 — 행 라우트 ·
 * 서버 렌더가 `showsParentsOnly` 로 고른다). 카드를 누르면 그 행 페이지가 열린다(8f-1). 수동 재정렬(카드 끌기)은 아직이다(§7).
 *
 * "+ 새로 만들기"는 그리드 끝의 카드다(노션처럼). 만들면 그 카드의 제목을 바로 받는다 — 이름 없는 카드가 쌓이지 않게(표 · 보드와 같은
 * 규칙). 템플릿 · 기본 템플릿은 `NewRowMenu` 가 맡는다.
 */

import Link from 'next/link'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { DatabaseAccess } from '@/lib/database/database'
import type { RowJson } from '@/lib/database/http'
import type { ViewColumn } from '@/lib/database/view'
import { cellText, parseDraft, readCell, sameValue } from '@/lib/database/cell-format'
import { MAX_QUERY_PAGINATION } from '@/lib/database/limits'
import type { GalleryLayout } from '@/lib/database/gallery'
import { templateRowNote, type DefaultTemplate } from '@/lib/database/new-row'
import { PageIconView } from '../../page-icon-view'
import * as api from './table-api'
import type { RelationIcons, RelationLabels } from './cell-view'
import { CardBadges } from './card-badges'
import { NewRowMenu } from './new-row-menu'
import { SearchEmpty } from './view-search'
import { useRelationLabels } from './use-relation-labels'
import { useAdoptServerValue, useLiveServerRefresh } from './use-table-changes'

const UNTITLED = '제목 없음'

type Editing = { readonly rowId: string; readonly draft: string }

/** 카드 폭 — 그리드 칸의 최소 폭. 칸 수는 컨테이너 폭이 정한다(04 *"그리드 컬럼 수는 컨테이너 폭 기준 자동"*). */
const CARD_GRID: Readonly<Record<GalleryLayout['cover_size'], string>> = {
  small: 'grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]',
  medium: 'grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]',
  large: 'grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]',
}

/** 표시 순서가 뒤에 오는 응답인가. 버전은 bigint 문자열이다. */
const notOlder = (incoming: string, current: string): boolean => BigInt(incoming) >= BigInt(current)

export function DatabaseGallery(props: {
  workspaceId: string
  viewId: string
  dataSourceId: string
  tableName: string
  /** 보이는 컬럼만, 뷰 순서로. 카드의 배지가 이 순서다(제목은 카드 머리라 뺀다). */
  columns: ViewColumn[]
  rows: RowJson[]
  hasMore: boolean
  nextCursor: string | null
  relationLabels: RelationLabels
  relationIcons: RelationIcons
  access: DatabaseAccess
  defaultTemplate?: DefaultTemplate | null
  /** 뷰 검색어(2e-2) — "더 보기"도 같은 검색어를 싣는다. */
  search?: string | null
  /** 서버 화면이 읽기 전의 시각(ms) — 구독이 붙기 전의 변경을 메운다(#250 · `use-table-changes.ts`). */
  renderedAt?: number
  /** 레이아웃(2f-2) — 미리보기 · 카드 폭 · 맞춤. */
  layout: GalleryLayout
  /** 첫 페이지의 카드 미리보기(행 id → 이미지 주소). "더 보기"의 것은 응답이 함께 준다. */
  covers: Readonly<Record<string, string>>
}) {
  const { workspaceId, viewId, dataSourceId, tableName, columns, access } = props
  const [rows, setRows] = useState<readonly RowJson[]>(props.rows)
  const [cursor, setCursor] = useState<string | null>(props.hasMore ? props.nextCursor : null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditingState] = useState<Editing | null>(null)
  const [defaultTemplate, setDefaultTemplate] = useState<DefaultTemplate | null>(props.defaultTemplate ?? null)
  const [covers, setCovers] = useState<Readonly<Record<string, string>>>(props.covers)
  /** 불러오다 깨진 이미지 — 빈 자리로 돌린다(같은 주소를 다시 묻지 않는다). */
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set())
  const markBroken = (src: string) => setBroken((current) => (current.has(src) ? current : new Set(current).add(src)))
  // 표 변경 알림(2k-3 · F-04-24) — 다른 곳에서 바뀌면 서버 렌더를 다시 부르고 첫 페이지 · 미리보기를 받아들인다. 만들기 · 편집 · 더 보기
  // 중이면 끝난 뒤에. "더 보기"로 더 읽은 카드는 첫 페이지로 돌아간다(§7).
  const galleryBusy = loadingMore || busy || editing !== null
  useLiveServerRefresh(workspaceId, dataSourceId, galleryBusy, props.renderedAt)
  useAdoptServerValue(props.rows, galleryBusy, (next) => {
    setRows(next)
    setCursor(props.hasMore ? props.nextCursor : null)
  })
  useAdoptServerValue(props.covers, galleryBusy, setCovers)
  const { layout } = props
  const showCover = layout.cover !== 'none'
  const editingRef = useRef<Editing | null>(null)
  const setEditing = (next: Editing | null) => {
    editingRef.current = next
    setEditingState(next)
  }
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing !== null) titleInputRef.current?.focus()
  }, [editing?.rowId]) // eslint-disable-line react-hooks/exhaustive-deps -- 새 카드가 설 때만 포커스를 준다

  const titleColumn = columns.find((c) => c.type === 'title') ?? null
  const badgeColumns = columns.filter((c) => c.type !== 'title')
  const { labels, icons: relationIcons } = useRelationLabels(workspaceId, props.relationLabels, props.relationIcons, rows, columns)

  /** 서버가 준 행으로 갈아 끼운다. 늦게 온(버전이 낮은) 응답은 버린다. */
  const takeRow = (row: RowJson) =>
    setRows((current) => current.map((r) => (r.id === row.id && notOlder(row.version, r.version) ? row : r)))

  // F-03-17: 누적 10,000건 상한. 여기서 멈춘다(표와 같다).
  const reachedCap = rows.length >= MAX_QUERY_PAGINATION

  const loadMore = async () => {
    if (cursor === null || loadingMore || reachedCap) return
    setLoadingMore(true)
    setError(null)
    const result = await api.loadRows(workspaceId, viewId, cursor, undefined, props.search)
    setLoadingMore(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setRows((current) => {
      // 그사이 "+ 새로 만들기"로 붙인 행이 다음 페이지에 또 올 수 있다.
      const seen = new Set(current.map((r) => r.id))
      return [...current, ...result.value.rows.filter((r) => !seen.has(r.id))]
    })
    setCursor(result.value.hasMore ? result.value.nextCursor : null)
    if (result.value.covers) {
      const more = result.value.covers
      setCovers((current) => ({ ...current, ...more }))
    }
  }

  /** `templateId` 가 `null` 이면 빈 카드다. */
  const addCard = async (templateId: string | null) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const result = await api.createRowFrom(workspaceId, viewId, { templateId, cells: [] })
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const { row } = result.value
    setRows((current) => [...current, row])
    setNotice(templateRowNote(result.value.skippedPages, result.value.skippedLinks))
    // ★ 초안은 그 카드의 **지금 제목**이다 — 템플릿이 준 제목을 빈 글자로 덮지 않는다(표 · 보드와 같은 이유).
    if (access.canEditContent && titleColumn !== null) {
      setEditing({ rowId: row.id, draft: cellText(readCell('title', row.properties[titleColumn.propertyId])) })
    }
  }

  const commitTitle = async () => {
    const e = editingRef.current
    if (e === null || titleColumn === null) return
    // Enter 와 blur 가 같은 편집을 두 번 저장하지 않게 먼저 닫는다.
    setEditing(null)
    const row = rows.find((r) => r.id === e.rowId)
    if (row === undefined) return
    const previous = readCell('title', row.properties[titleColumn.propertyId])
    const parsed = parseDraft('title', e.draft, previous)
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }
    if (sameValue(previous, parsed.value)) return
    const withValue = (r: RowJson, value: typeof parsed.value): RowJson => ({
      ...r,
      title: cellText(value),
      properties: { ...r.properties, [titleColumn.propertyId]: value },
    })
    setRows((current) => current.map((r) => (r.id === e.rowId ? withValue(r, parsed.value) : r)))
    const result = await api.updateCell(workspaceId, e.rowId, titleColumn.propertyId, parsed.value)
    if (!result.ok) {
      setRows((current) => current.map((r) => (r.id === e.rowId ? withValue(r, previous) : r)))
      setError(result.message)
      return
    }
    takeRow(result.value)
  }

  const onTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitTitle()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setEditing(null)
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={tableName || UNTITLED}>
      <ul
        data-testid="db-gallery"
        data-card-size={layout.cover_size}
        className={`grid gap-3 ${CARD_GRID[layout.cover_size]}`}
      >
        {rows.map((row) => (
          <li
            key={row.id}
            data-row-id={row.id}
            data-testid="db-gallery-card"
            className="flex min-h-24 flex-col overflow-hidden rounded-md border border-neutral-200 bg-white text-sm shadow-sm dark:border-neutral-700 dark:bg-neutral-950"
          >
            {showCover && (
              <div data-testid="db-gallery-cover" className="h-32 w-full shrink-0 bg-neutral-100 dark:bg-neutral-900">
                {covers[row.id] !== undefined && !broken.has(covers[row.id]!) && (
                  // eslint-disable-next-line @next/next/no-img-element -- 우리 파일 경로(세션 인증)와 외부 URL 을 그대로 그린다. 썸네일 파이프라인은 아직이다(§7).
                  <img
                    src={covers[row.id]}
                    alt=""
                    loading="lazy"
                    data-testid="db-gallery-cover-image"
                    // 화면이 붙기(hydration) 전에 이미 깨진 이미지에는 `onError` 가 오지 않는다 — 붙는 순간 한 번 본다(`complete` 인데 폭이
                    // 0 이면 깨졌다). 서버 렌더가 `<img>` 를 내보내므로 브라우저는 스크립트보다 먼저 그것을 받는다(#219 의 전체 판이 잡았다).
                    ref={(el) => {
                      if (el !== null && el.complete && el.naturalWidth === 0) markBroken(covers[row.id]!)
                    }}
                    onError={() => markBroken(covers[row.id]!)}
                    className={`h-full w-full ${layout.cover_aspect === 'contain' ? 'object-contain' : 'object-cover'}`}
                  />
                )}
              </div>
            )}
            <div className="flex flex-col gap-1.5 p-3">
              {editing !== null && editing.rowId === row.id ? (
                <input
                  ref={titleInputRef}
                  value={editing.draft}
                  onChange={(e) => setEditing({ rowId: row.id, draft: e.target.value })}
                  onKeyDown={onTitleKeyDown}
                  onBlur={() => void commitTitle()}
                  aria-label="카드 제목"
                  data-testid="db-gallery-title-input"
                  placeholder={UNTITLED}
                  autoComplete="off"
                  className="w-full bg-transparent font-medium outline-none"
                />
              ) : (
                // 카드의 제목이 그 행 페이지로 가는 길이다(8f-1) — 아이콘을 앞에 단다(8c-3a).
                <Link
                  href={`/w/${workspaceId}/${row.id}`}
                  data-testid="db-gallery-open"
                  className={`flex min-w-0 items-start gap-1.5 font-medium hover:underline ${row.title ? 'break-words' : 'text-neutral-400'}`}
                >
                  <PageIconView icon={row.icon} fallback className="mt-[0.2em]" />
                  <span className="min-w-0" data-testid="db-gallery-card-title">
                    {row.title || UNTITLED}
                  </span>
                </Link>
              )}
              <CardBadges
                row={row}
                columns={badgeColumns}
                relationLabels={labels}
                relationIcons={relationIcons}
                testId="db-gallery-badge"
                button={{ workspaceId, canPress: access.canEditContent }}
              />
            </div>
          </li>
        ))}
        {access.canCreateRows && (
          <li className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-neutral-300 dark:border-neutral-700">
            <NewRowMenu
              workspaceId={workspaceId}
              viewId={viewId}
              dataSourceId={dataSourceId}
              defaultTemplate={defaultTemplate}
              canSetDefault={access.canEditStructure}
              busy={busy}
              onCreate={(templateId) => void addCard(templateId)}
              onDefaultChange={setDefaultTemplate}
              label="+ 새로 만들기"
              ariaLabel="새 카드 만들기"
              testId="db-gallery-add"
            />
          </li>
        )}
      </ul>

      {rows.length === 0 &&
        (props.search ? (
          <SearchEmpty search={props.search} />
        ) : (
          <p className="px-2 text-sm text-neutral-400" data-testid="db-empty">
            아직 행이 없습니다.
          </p>
        ))}

      {cursor !== null && !reachedCap && (
        <button
          type="button"
          data-testid="db-load-more"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          className="self-start rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {loadingMore ? '불러오는 중…' : '더 보기'}
        </button>
      )}

      {error && (
        <p role="alert" data-testid="db-error" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="db-notice" className="text-sm text-amber-700 dark:text-amber-300">
          {notice}
        </p>
      )}
    </section>
  )
}
