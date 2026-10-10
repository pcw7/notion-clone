'use client'

/**
 * 행 페이지의 속성 묶음 — 제목 아래 고정 · 본문 모듈 · 상세 패널 · 보이는 속성 · 숨긴 속성 · 레이아웃 편집
 * (8f-1 · 8f-2 · 3a-2 · 3c-2 · F-16-03 · F-16-02 · F-16-04 · F-16-05 · F-16-01)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 행의 레이아웃 · [보강] 제목 아래 고정 · [보강] 본문 모듈 · 상세 패널
 *       16-item-layout.md F-16-03(Property group) · F-16-02(Heading · pinned) · F-16-04(모듈 승격) · F-16-05(상세 패널) · F-16-01(편집 모드)
 *
 *   · 제목 아래 고정 — heading 안의 순서 · 가로로 늘어놓은 레코드(`recordAxis="row"` — 이름이 값 위). 넘치면 줄을 바꾼다(가로 스크롤
 *     상자는 칸 안의 팝오버를 자른다 — `database-table.tsx`). 값은 같은 셀 편집기로 고친다
 *   · 본문 줄 — 레이아웃의 `main` 순서대로. 속성 묶음 자리(`GROUP_MODULE`)에 묶음이 서고, 올린 속성은 그 자리에 넓은 모듈로 선다
 *     (`recordAxis="module"` — 이름이 위 · 칸이 줄을 다 쓴다)
 *   · 상세 패널 — 오른쪽에 접히는 칸. 기본은 접혀 있고 펼침은 이 기기에 남긴다(16 F-16-05 *"서버 레이아웃에는 저장하지 않는다"* — 비우면
 *     토글이 없다). 좁은 화면에서는 본문 아래로 쌓인다
 *   · 속성 묶음 — 고정 · 본문 모듈 · 패널 · 숨김 밖의 나머지(M6 — 서버는 `columns` 에서 빼지 않는다). 보이는 속성은 스키마 순서 ·
 *     숨긴 속성은 "숨긴 속성 N개"로 펼친다(숨김은 표시 규칙이지 접근 제어가 아니다 — 16 R12)
 *   · 레이아웃 편집 — 구조를 고칠 수 있는 사람에게만(잠긴 데이터베이스는 닫는다 — `readRowPage`) · 직전 레이아웃으로 되돌리기(3e-2 · 되돌릴
 *     수 있을 때만 — 한 단계)
 *   · 실시간(3e-2 · F-16-12) — 표 변경 알림(`db_rows` — 레이아웃 머리도 보낸다 · 0067)을 받으면 레이아웃 버전을 묻고, **바뀌었을 때만**
 *     다시 그린다(칸이 바뀐 신호에는 그리지 않는다). 편집 중이면 닫은 뒤에 묻는다. 내가 적용 · 되돌리기로 만든 버전은 이미 안다
 *
 * ★ 접혀 있거나 편집하는 동안에도 **표를 내리지 않는다**(`hidden`). 표는 처음 받은 행을 상태로 들고 고친 값을 그 위에 칠한다 —
 *   내렸다가 다시 올리면 서버가 처음 준 행으로 그려 그사이 고친 값이 옛값으로 보인다. 패널도 접을 때 `hidden` 으로 감춘다.
 *
 * 적용하면 서버가 다시 그린다(`router.refresh` — 전환 안에서 편집 모드를 함께 닫는다). 표의 `key` 가 컬럼(순서 · 보임)이라 바뀐
 * 레이아웃이 새 행으로 다시 그려진다.
 */

import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type ComponentProps } from 'react'
import { useRouter } from 'next/navigation'

import type { ViewColumn } from '@/lib/database/view-columns'
import { GROUP_MODULE } from '@/lib/database/layout-modules'
import type { PageSettings } from '@/lib/database/page-settings'
import { DatabaseTable } from '../db/[databaseId]/database-table'
import { useTableChanges } from '../db/[databaseId]/use-table-changes'
import * as api from '../db/[databaseId]/table-api'
import { RowLayoutEditor } from './row-layout-editor'

const keyOf = (columns: readonly ViewColumn[]): string => columns.map((c) => c.propertyId).join(',')

/**
 * 패널을 펼쳤는가 — 이 기기의 것(데이터 소스마다 · `localStorage`). React 밖에 산다 — `useSyncExternalStore` 가 서버(접힘) · 클라이언트
 * 스냅샷을 따로 주므로 하이드레이션 불일치도, effect 안 setState 도 없다(사이드바의 펼침과 같은 방식). 저장소가 막혀도 이 탭 안에서는
 * 메모리 값으로 따른다.
 */
const panelKey = (dataSourceId: string) => `nc:row-panel:${dataSourceId}`
const panelMemory = new Map<string, boolean>()
const panelListeners = new Set<() => void>()
const subscribePanel = (listener: () => void) => {
  panelListeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    panelListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}
const readPanel = (dataSourceId: string): boolean => {
  try {
    return window.localStorage.getItem(panelKey(dataSourceId)) === 'open'
  } catch {
    return panelMemory.get(dataSourceId) ?? false
  }
}
const writePanel = (dataSourceId: string, open: boolean): void => {
  panelMemory.set(dataSourceId, open)
  try {
    if (open) window.localStorage.setItem(panelKey(dataSourceId), 'open')
    else window.localStorage.removeItem(panelKey(dataSourceId))
  } catch {
    // 기억하지 못해도 지금 탭은 메모리 값으로 따른다
  }
  for (const listener of panelListeners) listener()
}

export function RowPropertyGroup(
  props: Omit<ComponentProps<typeof DatabaseTable>, 'columns'> & {
    /** 속성 묶음 — 스키마 순서 · 레이아웃이 숨긴 것은 `visible: false`. 제목 · rollup 은 이미 뺐다(`listColumns('record', …)`). */
    columns: ViewColumn[]
    /** 레이아웃의 버전 — 편집 모드가 적용할 때 보낸다. */
    layoutVersion: string
    /** 직전 레이아웃으로 되돌릴 수 있다(3e-2). */
    layoutUndo: boolean
    /** 제목 아래에 고정한 속성 — heading 안의 순서(3a-2). `columns` 에도 그대로 있다 — 여기서 묶음과 가른다. */
    pinned: readonly string[]
    /** 본문 줄 — 속성 id 와 속성 묶음(`GROUP_MODULE`)의 순서(3c-2). */
    main: readonly string[]
    /** 상세 패널의 속성 — 순서(3c-2). */
    panel: readonly string[]
    /** 페이지 설정(3b-2) — 편집 모드의 초안이 여기서 시작한다. 그리기는 페이지 화면과 표(`showPropertyIcons`)가 한다. */
    settings: PageSettings
    /** 레이아웃을 고칠 수 있다(`edit_structure` · 데이터베이스가 잠기지 않았다). */
    canEditLayout: boolean
  },
) {
  const { columns, layoutVersion, layoutUndo, pinned, main, panel, settings, canEditLayout, ...table } = props
  const byId = new Map(columns.map((c) => [c.propertyId, c]))
  const columnsOf = (ids: readonly string[]) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  const pinnedColumns = columnsOf(pinned)
  const panelColumns = columnsOf(panel)
  const placed = new Set([...pinned, ...main, ...panel])
  const inGroup = columns.filter((c) => !placed.has(c.propertyId))
  const visible = inGroup.filter((c) => c.visible)
  const hidden = inGroup.filter((c) => !c.visible)
  // 줄에 속성 묶음이 없는 레이아웃은 없다(서버가 막는다) — 그래도 빠졌으면 끝에 둔다
  const line = main.includes(GROUP_MODULE) ? main : [...main, GROUP_MODULE]
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const panelOpen = useSyncExternalStore(
    subscribePanel,
    () => readPanel(table.dataSourceId),
    () => false,
  )
  const [refreshing, startTransition] = useTransition()
  const editButton = useRef<HTMLButtonElement>(null)
  /** 편집 모드를 닫은 뒤 "레이아웃 편집" 단추로 포커스를 돌려준다. */
  const returnFocus = useRef(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  const [undoing, setUndoing] = useState(false)
  /** 이 화면이 아는 레이아웃 버전 — 서버 렌더가 준 것과 내가 적용 · 되돌리기로 만든 것 중 큰 것. */
  const knownVersion = useRef(layoutVersion)
  /** 편집 중에 온 신호 — 닫은 뒤에 묻는다. */
  const pendingCheck = useRef(false)
  const editingRef = useRef(editing)

  useEffect(() => {
    if (BigInt(layoutVersion) > BigInt(knownVersion.current)) knownVersion.current = layoutVersion
  }, [layoutVersion])

  const learn = (version: string) => {
    if (/^\d+$/.test(version) && BigInt(version) > BigInt(knownVersion.current)) knownVersion.current = version
  }

  /** 레이아웃 버전을 묻고, 이 화면이 모르는 버전이면 다시 그린다. */
  const checkLayout = async () => {
    const now = await api.layoutVersion(table.workspaceId, table.dataSourceId)
    if (!now.ok || !/^\d+$/.test(now.value) || BigInt(now.value) <= BigInt(knownVersion.current)) return
    knownVersion.current = now.value
    startTransition(() => router.refresh())
  }

  useEffect(() => {
    editingRef.current = editing
    if (editing || !pendingCheck.current) return
    pendingCheck.current = false
    void checkLayout()
  })

  useTableChanges(
    table.workspaceId,
    table.dataSourceId,
    {
      onChanged: () => {
        if (editingRef.current) pendingCheck.current = true
        else void checkLayout()
      },
      // 더 볼 수 없다 — 서버 렌더가 "없음"을 보인다
      onRevoked: () => router.refresh(),
    },
    true,
    // 행 페이지를 그린 뒤 · 구독이 붙기 전의 적용을 놓치지 않는다(#250)
    table.renderedAt,
  )

  const undo = async () => {
    setUndoing(true)
    setUndoError(null)
    const result = await api.undoLayout(table.workspaceId, table.dataSourceId, layoutVersion)
    setUndoing(false)
    if (!result.ok) {
      setUndoError(result.message)
      return
    }
    learn(result.value.version)
    startTransition(() => router.refresh())
  }

  useEffect(() => {
    if (editing || !returnFocus.current) return
    returnFocus.current = false
    editButton.current?.focus()
  }, [editing])

  const togglePanel = () => writePanel(table.dataSourceId, !panelOpen)

  const close = () => {
    returnFocus.current = true
    setEditing(false)
  }

  const applied = (changed: boolean, version: string) => {
    if (!changed) {
      close()
      return
    }
    learn(version)
    // 새 레이아웃이 도착할 때 편집 모드가 함께 닫힌다 — 그 사이에 옛 레이아웃이 비치지 않는다.
    startTransition(() => {
      router.refresh()
      close()
    })
  }

  const group = (
    <div key={GROUP_MODULE} data-testid="row-property-group" className="flex flex-col gap-2">
      {visible.length > 0 && (
        <div data-testid="row-visible-properties">
          <DatabaseTable key={keyOf(visible)} {...table} columns={visible} />
        </div>
      )}
      {(hidden.length > 0 || canEditLayout) && (
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          {hidden.length > 0 && (
            <button
              type="button"
              data-testid="row-hidden-toggle"
              aria-expanded={showHidden}
              onClick={() => setShowHidden((open) => !open)}
              className="rounded px-1 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {showHidden ? '▾' : '▸'} 숨긴 속성 {hidden.length}개
            </button>
          )}
          {canEditLayout && (
            <button
              ref={editButton}
              type="button"
              data-testid="row-layout-edit"
              onClick={() => setEditing(true)}
              className="rounded px-1 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              레이아웃 편집
            </button>
          )}
          {canEditLayout && layoutUndo && (
            <button
              type="button"
              data-testid="row-layout-undo"
              disabled={undoing || refreshing}
              onClick={() => void undo()}
              className="rounded px-1 py-0.5 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
            >
              {undoing ? '되돌리는 중…' : '직전 레이아웃으로 되돌리기'}
            </button>
          )}
        </div>
      )}
      {undoError !== null && (
        <p role="alert" data-testid="row-layout-undo-error" className="text-xs text-red-600">
          {undoError}
        </p>
      )}
      {hidden.length > 0 && (
        <div hidden={!showHidden} data-testid="row-hidden-properties">
          <DatabaseTable key={keyOf(hidden)} {...table} tableName={`${table.tableName} · 숨긴 속성`} columns={hidden} />
        </div>
      )}
    </div>
  )

  return (
    <>
      <div hidden={editing} className="flex flex-col gap-2">
        {pinnedColumns.length > 0 && (
          <div data-testid="row-pinned-properties" className="border-b border-neutral-100 pb-2 dark:border-neutral-900">
            <DatabaseTable
              key={keyOf(pinnedColumns)}
              {...table}
              tableName={`${table.tableName} · 제목 아래 고정`}
              columns={pinnedColumns}
              recordAxis="row"
            />
          </div>
        )}
        {panelColumns.length > 0 && (
          <div className="flex justify-end">
            <button
              type="button"
              data-testid="row-panel-toggle"
              aria-expanded={panelOpen}
              aria-controls="row-panel"
              onClick={togglePanel}
              className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {panelOpen ? '상세 패널 닫기' : `상세 패널 ${panelColumns.length}`}
            </button>
          </div>
        )}
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div data-testid="row-main" className="flex min-w-0 flex-1 flex-col gap-3">
            {line.map((entry) => {
              if (entry === GROUP_MODULE) return group
              const column = byId.get(entry)
              if (column === undefined) return null
              return (
                <section key={entry} data-testid="row-module" data-property-id={entry} aria-label={column.name}>
                  <DatabaseTable key={keyOf([column])} {...table} tableName={`${table.tableName} · ${column.name}`} columns={[column]} recordAxis="module" />
                </section>
              )
            })}
          </div>
          {panelColumns.length > 0 && (
            <aside
              id="row-panel"
              aria-label="상세 패널"
              data-testid="row-panel"
              hidden={!panelOpen}
              className="flex-none rounded-md border border-neutral-200 p-2 md:w-72 dark:border-neutral-800"
            >
              <DatabaseTable key={keyOf(panelColumns)} {...table} tableName={`${table.tableName} · 상세 패널`} columns={panelColumns} />
            </aside>
          )}
        </div>
      </div>
      {editing && (
        <RowLayoutEditor
          workspaceId={table.workspaceId}
          dataSourceId={table.dataSourceId}
          columns={columns}
          pinned={pinned}
          main={main}
          panel={panel}
          settings={settings}
          version={layoutVersion}
          refreshing={refreshing}
          onCancel={close}
          onApplied={applied}
        />
      )}
    </>
  )
}
