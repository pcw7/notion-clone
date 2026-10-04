'use client'

/**
 * 행 페이지의 속성 묶음 — 보이는 속성 · 숨긴 속성 · 레이아웃 편집 (8f-1 · 8f-2 · F-16-03 · F-16-01)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 행의 레이아웃 · 16-item-layout.md F-16-03(Property group) · F-16-01(편집 모드)
 *
 *   · 보이는 속성 — 스키마 순서 · 레코드 모양의 표(`DatabaseTable variant="record"`)
 *   · 숨긴 속성 — "숨긴 속성 N개"로 펼친다. 숨김은 표시 규칙이지 접근 제어가 아니다(16 R12) — 값은 남고 여기서 채울 수 있다
 *   · 레이아웃 편집 — 구조를 고칠 수 있는 사람에게만(잠긴 데이터베이스는 닫는다 — `readRowPage`)
 *
 * ★ 접혀 있거나 편집하는 동안에도 **표를 내리지 않는다**(`hidden`). 표는 처음 받은 행을 상태로 들고 고친 값을 그 위에 칠한다 —
 *   내렸다가 다시 올리면 서버가 처음 준 행으로 그려 그사이 고친 값이 옛값으로 보인다.
 *
 * 적용하면 서버가 다시 그린다(`router.refresh` — 전환 안에서 편집 모드를 함께 닫는다). 표의 `key` 가 컬럼(순서 · 보임)이라 바뀐
 * 레이아웃이 새 행으로 다시 그려진다.
 */

import { useEffect, useRef, useState, useTransition, type ComponentProps } from 'react'
import { useRouter } from 'next/navigation'

import type { ViewColumn } from '@/lib/database/view-columns'
import { DatabaseTable } from '../db/[databaseId]/database-table'
import { RowLayoutEditor } from './row-layout-editor'

const keyOf = (columns: readonly ViewColumn[]): string => columns.map((c) => c.propertyId).join(',')

export function RowPropertyGroup(
  props: Omit<ComponentProps<typeof DatabaseTable>, 'columns'> & {
    /** 속성 묶음 — 스키마 순서 · 레이아웃이 숨긴 것은 `visible: false`. 제목 · rollup 은 이미 뺐다(`listColumns('record', …)`). */
    columns: ViewColumn[]
    /** 레이아웃의 버전 — 편집 모드가 적용할 때 보낸다. */
    layoutVersion: string
    /** 레이아웃을 고칠 수 있다(`edit_structure` · 데이터베이스가 잠기지 않았다). */
    canEditLayout: boolean
  },
) {
  const { columns, layoutVersion, canEditLayout, ...table } = props
  const visible = columns.filter((c) => c.visible)
  const hidden = columns.filter((c) => !c.visible)
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const editButton = useRef<HTMLButtonElement>(null)
  /** 편집 모드를 닫은 뒤 "레이아웃 편집" 단추로 포커스를 돌려준다. */
  const returnFocus = useRef(false)

  useEffect(() => {
    if (editing || !returnFocus.current) return
    returnFocus.current = false
    editButton.current?.focus()
  }, [editing])

  const close = () => {
    returnFocus.current = true
    setEditing(false)
  }

  const applied = (changed: boolean) => {
    if (!changed) {
      close()
      return
    }
    // 새 레이아웃이 도착할 때 편집 모드가 함께 닫힌다 — 그 사이에 옛 레이아웃이 비치지 않는다.
    startTransition(() => {
      router.refresh()
      close()
    })
  }

  return (
    <>
      <div hidden={editing} className="flex flex-col gap-2">
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
          </div>
        )}
        {hidden.length > 0 && (
          <div hidden={!showHidden} data-testid="row-hidden-properties">
            <DatabaseTable key={keyOf(hidden)} {...table} tableName={`${table.tableName} · 숨긴 속성`} columns={hidden} />
          </div>
        )}
      </div>
      {editing && (
        <RowLayoutEditor
          workspaceId={table.workspaceId}
          dataSourceId={table.dataSourceId}
          columns={columns}
          version={layoutVersion}
          refreshing={refreshing}
          onCancel={close}
          onApplied={applied}
        />
      )}
    </>
  )
}
