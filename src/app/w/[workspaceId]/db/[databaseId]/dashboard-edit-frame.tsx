'use client'

/**
 * 대시보드의 편집 모드 — 틀과 자리 (DB-3 · F-04-20 · 처음 받는 JS 에 드는 작은 쪽)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 DB-1] ⑤
 *
 * 격자는 서버 컴포넌트(`dashboard-view.tsx`)가 그리고 위젯은 서버가 흘려 보낸다 — 편집 모드가 그것을 클라이언트 트리로 바꾸지 않는다. 이 파일은
 * 격자를 children 으로 감싸는 틀(편집 상태 · "편집" 단추)과 격자 안의 작은 자리(위젯 머리 · 줄 끝)만 둔다. 편집 화면 자체(메뉴 · 넣기 창 ·
 * 끌기)는 "편집" 을 누를 때 받는다(`import('./dashboard-editor')` — 보기 상태와 대시보드가 아닌 뷰는 그 JS 를 받지 않는다).
 *
 * 고칠 수 있는 사람(`edit_structure` · 잠기지 않음)에게만 선다 — 서버가 이 틀을 그리지 않으면 편집 단추도 자리도 없다(판정은 명령이 다시
 * 한다). 처음에는 보기다. 보기 상태에서는 배치를 바꾸는 것이 하나도 없다. 고친 뒤에는 서버 렌더를 다시 받는다(`router.refresh`).
 */

import { createContext, useContext, useRef, useState, useTransition, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react'
import { useRouter } from 'next/navigation'

import type { DashboardLayout } from '@/lib/database/dashboard-layout'

type EditorModule = typeof import('./dashboard-editor')

/** 위젯 넣기의 소스 — 이 데이터베이스에 붙은 것(소유 · 연결 · 원본을 볼 수 있는 것). */
export type DashboardSourceOption = { readonly id: string; readonly name: string; readonly owned: boolean }

export type EditNotice = { readonly tone: 'error' | 'warn'; readonly text: string }

export type EditUi = {
  readonly busy: boolean
  readonly notice: EditNotice | null
  /** 넣기 창 — 열려 있으면 넣을 줄(null 이면 위의 "위젯 넣기" · 줄 끝의 "+" 는 그 줄). */
  readonly adding: { readonly row: number | null } | null
}

/** 잡은 손잡이 — 4px 넘게 움직이면 끌기다(`active`). */
export type DashboardGrab = { readonly id: string; readonly x: number; readonly y: number; active: boolean }

export type DashboardEdit = {
  readonly workspaceId: string
  readonly databaseId: string
  readonly dashboardId: string
  /** 지금 배치 — 위젯 전부(고치기는 이것을 통째로 보낸다). */
  readonly layout: DashboardLayout
  /** 읽은 판 — 배치를 고칠 때 함께 보낸다. */
  readonly updatedAt: string
  readonly sources: readonly DashboardSourceOption[]
  readonly ui: EditUi
  readonly setUi: Dispatch<SetStateAction<EditUi>>
  /** 다시 받는 중이다(`router.refresh`) — 그동안 고치기를 막는다. */
  readonly pending: boolean
  /** 고친 뒤 서버가 돌려준 판 — 다시 받기가 끝나기 전에 이어서 고쳐도 판이 맞다. */
  accept(next: { readonly layout: DashboardLayout; readonly updatedAt: string }): void
  refresh(): void
  leave(): void
  startGrab(grab: DashboardGrab): void
  peekGrab(): DashboardGrab | null
  takeGrab(): DashboardGrab | null
  readonly gridRef: RefObject<HTMLDivElement | null>
}

const Ctx = createContext<{ readonly edit: DashboardEdit; readonly editor: EditorModule | null; readonly editing: boolean } | null>(null)

const IDLE: EditUi = { busy: false, notice: null, adding: null }

/** 편집 화면(지연 받은 쪽)이 쓴다 — 틀 밖이면 던진다. */
export function useDashboardEdit(): DashboardEdit {
  const got = useContext(Ctx)
  if (got === null) throw new Error('대시보드 편집 틀 밖입니다')
  return got.edit
}

export function DashboardEditFrame({
  workspaceId,
  databaseId,
  dashboardId,
  layout,
  updatedAt,
  sources,
  children,
}: {
  readonly workspaceId: string
  readonly databaseId: string
  readonly dashboardId: string
  readonly layout: DashboardLayout
  readonly updatedAt: string
  readonly sources: readonly DashboardSourceOption[]
  readonly children: ReactNode
}) {
  const router = useRouter()
  const [editor, setEditor] = useState<EditorModule | null>(null)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [ui, setUi] = useState<EditUi>(IDLE)
  const [saved, setSaved] = useState<{ readonly layout: DashboardLayout; readonly updatedAt: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const grab = useRef<DashboardGrab | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // 내가 고친 판이 서버 렌더의 판보다 새것이면 그것 — 판 글은 같은 꼴(마이크로초까지의 UTC)이라 글자 차례가 시각 차례다
  const current = saved !== null && saved.updatedAt > updatedAt ? saved : { layout, updatedAt }

  const enter = () => {
    setLoadFailed(false)
    if (editor !== null) {
      setEditing(true)
      return
    }
    setLoading(true)
    import('./dashboard-editor').then(
      (mod) => {
        setEditor(mod)
        setEditing(true)
        setLoading(false)
      },
      () => {
        setLoadFailed(true)
        setLoading(false)
      },
    )
  }

  const edit: DashboardEdit = {
    workspaceId,
    databaseId,
    dashboardId,
    layout: current.layout,
    updatedAt: current.updatedAt,
    sources,
    ui,
    setUi,
    pending,
    accept: setSaved,
    refresh: () => startTransition(() => router.refresh()),
    leave: () => {
      grab.current = null
      setUi(IDLE)
      setEditing(false)
    },
    startGrab: (next) => {
      grab.current = next
    },
    peekGrab: () => grab.current,
    takeGrab: () => {
      const was = grab.current
      grab.current = null
      return was
    },
    gridRef,
  }
  const on = editing && editor !== null

  return (
    <Ctx.Provider value={{ edit, editor, editing: on }}>
      <div data-testid="db-dashboard-frame" data-editing={on ? 'true' : 'false'} className="flex flex-col gap-2">
        <div className="flex min-h-8 flex-wrap items-center justify-end gap-2">
          {on ? (
            <editor.EditBar />
          ) : (
            <>
              {loadFailed && (
                <span role="alert" className="text-xs text-red-600 dark:text-red-400">
                  편집 화면을 불러오지 못했습니다.
                </span>
              )}
              <button
                type="button"
                data-testid="db-dashboard-edit"
                disabled={loading}
                onClick={enter}
                className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                편집
              </button>
            </>
          )}
        </div>
        <div ref={gridRef} className="relative">
          {children}
          {on && <editor.DragLayer />}
        </div>
      </div>
    </Ctx.Provider>
  )
}

/** 위젯 머리의 이름 자리 — 보기에서는 서버가 그린 이름(children) · 편집에서는 손잡이 · 메뉴 · 이름 칸. */
export function WidgetHeadSlot({ widgetId, name, children }: { readonly widgetId: string; readonly name: string; readonly children: ReactNode }) {
  const got = useContext(Ctx)
  if (got === null || !got.editing || got.editor === null) return children
  return <got.editor.WidgetControls widgetId={widgetId} name={name} />
}

/** 볼 수 없는 위젯의 머리 — 보기에서는 없다 · 편집에서는 손잡이 · 메뉴(옮기기 · 지우기 — 이름은 주지 않는다). */
export function LockedWidgetSlot({ widgetId }: { readonly widgetId: string }) {
  const got = useContext(Ctx)
  if (got === null || !got.editing || got.editor === null) return null
  return <got.editor.WidgetControls widgetId={widgetId} name={null} />
}

/** 줄 끝의 자리 — 편집에서만 줄 높이 · "+"(자리가 있으면). */
export function RowEndSlot({ row }: { readonly row: number }) {
  const got = useContext(Ctx)
  if (got === null || !got.editing || got.editor === null) return null
  return <got.editor.RowControls row={row} />
}
