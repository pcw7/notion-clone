'use client'

/**
 * 뷰 탭 — 고르기 · 만들기 · 종류 바꾸기 (F-04-01 뷰 컨테이너 · 보드 4b조각)
 *
 * W8 은 **고르기만** 했다(뷰 타입이 table 하나라 두 번째 뷰를 만들 이유가 약했다). 보드가 들어오며 만들 이유가 생겼다.
 *
 * 만들기 · 종류 바꾸기는 `edit_structure` 다 — F-04-01: *"`+` 버튼과 탭 컨텍스트 메뉴는 렌더하지 않는다(비활성 표시보다
 * 미노출이 안전)."* 보드를 만드는데 그룹으로 삼을 속성이 없으면 서버가 `group_required` 로 거부한다(HANDOFF §3.2-27) —
 * 여기서 select 속성을 대신 만들지 않고 그 이유를 보여준다.
 *
 * 만든 뷰로는 `?v=` 로 옮긴다(`router.push`). 종류를 바꾸면 같은 주소에서 서버 렌더를 다시 받는다(`router.refresh`) —
 * `page.tsx` 가 종류에 따라 표 · 보드를 고른다. 이름 바꾸기 · 삭제는 아직 없다.
 */

import { useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import type { MvpViewType, ViewSummary } from '@/lib/database/view'
import * as api from './table-api'

/** 탭의 종류 아이콘. 장식이다 — 이름이 곧 종류를 말한다. */
export const VIEW_TYPE_ICON: Readonly<Record<string, string>> = { table: '▦', board: '▥', list: '≡' }
const VIEW_TYPE_LABEL: Readonly<Record<MvpViewType, string>> = { table: '표', board: '보드', list: '목록' }
/** 이 화면이 만들 수 있는 종류. `list` 는 4c 에서 연다. */
const CREATABLE: readonly MvpViewType[] = ['table', 'board']

const MENU_ITEM =
  'block w-full rounded px-2 py-1 text-left text-sm hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800'

export function ViewTabs({
  workspaceId,
  databaseId,
  views,
  currentId,
  canEdit,
}: {
  workspaceId: string
  databaseId: string
  views: readonly ViewSummary[]
  currentId: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [menu, setMenu] = useState<'add' | 'current' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = views.find((view) => view.id === currentId) ?? null

  const toggle = (next: 'add' | 'current') => {
    setError(null)
    setMenu((open) => (open === next ? null : next))
  }

  const create = async (type: MvpViewType) => {
    setBusy(true)
    setError(null)
    const result = await api.createView(workspaceId, databaseId, { type, name: VIEW_TYPE_LABEL[type] })
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setMenu(null)
    router.push(`/w/${workspaceId}/db/${databaseId}?v=${result.value.id}`)
  }

  const switchType = async (type: MvpViewType) => {
    setBusy(true)
    setError(null)
    const result = await api.updateView(workspaceId, currentId, { type })
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setMenu(null)
    router.refresh()
  }

  const onMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      setMenu(null)
    }
  }

  return (
    <nav aria-label="뷰" className="flex flex-col gap-1">
      <div className="flex items-center gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {views.map((tab) => (
          <Link
            key={tab.id}
            href={`/w/${workspaceId}/db/${databaseId}?v=${tab.id}`}
            aria-current={tab.id === currentId ? 'page' : undefined}
            data-testid="db-view-tab"
            data-view-type={tab.type}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
              tab.id === currentId
                ? 'border-neutral-900 font-medium dark:border-neutral-100'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}
          >
            <span aria-hidden className="mr-1 text-neutral-400">
              {VIEW_TYPE_ICON[tab.type] ?? '▦'}
            </span>
            {tab.name}
          </Link>
        ))}

        {canEdit && current !== null && (
          <span className="relative">
            <button
              type="button"
              aria-label={`${current.name} 뷰 메뉴`}
              aria-expanded={menu === 'current'}
              data-testid="db-view-menu"
              onClick={() => toggle('current')}
              className="rounded px-1.5 py-1 text-sm text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              ⋯
            </button>
            {menu === 'current' && (
              <div
                role="menu"
                aria-label="뷰 메뉴"
                data-testid="db-view-menu-panel"
                onKeyDown={onMenuKeyDown}
                className="absolute left-0 top-full z-30 mt-1 w-44 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
              >
                {CREATABLE.filter((type) => type !== current.type).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="menuitem"
                    data-testid={`db-view-type-${type}`}
                    disabled={busy}
                    onClick={() => void switchType(type)}
                    className={MENU_ITEM}
                  >
                    <span aria-hidden className="mr-1.5 text-neutral-400">
                      {VIEW_TYPE_ICON[type]}
                    </span>
                    {VIEW_TYPE_LABEL[type]}(으)로 보기
                  </button>
                ))}
              </div>
            )}
          </span>
        )}

        {canEdit && (
          <span className="relative ml-1">
            <button
              type="button"
              aria-label="뷰 추가"
              aria-expanded={menu === 'add'}
              data-testid="db-view-add"
              onClick={() => toggle('add')}
              className="rounded px-1.5 py-1 text-sm text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              +
            </button>
            {menu === 'add' && (
              <div
                role="menu"
                aria-label="뷰 추가"
                data-testid="db-view-add-panel"
                onKeyDown={onMenuKeyDown}
                className="absolute left-0 top-full z-30 mt-1 w-44 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
              >
                {CREATABLE.map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="menuitem"
                    data-testid={`db-view-add-${type}`}
                    disabled={busy}
                    onClick={() => void create(type)}
                    className={MENU_ITEM}
                  >
                    <span aria-hidden className="mr-1.5 text-neutral-400">
                      {VIEW_TYPE_ICON[type]}
                    </span>
                    {VIEW_TYPE_LABEL[type]} 만들기
                  </button>
                ))}
              </div>
            )}
          </span>
        )}

        {busy && <span className="ml-2 text-xs text-neutral-400">저장하는 중…</span>}
      </div>

      {error && (
        <p role="alert" data-testid="db-view-error" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </nav>
  )
}
