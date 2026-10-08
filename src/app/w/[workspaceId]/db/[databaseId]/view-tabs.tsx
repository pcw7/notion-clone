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
 * `page.tsx` 가 종류에 따라 표 · 보드를 고른다. 이름 바꾸기는 아직 없다.
 *
 * 뷰 지우기(8e-3b) — 뷰 메뉴에서 고르면 메뉴 안에서 한 번 더 묻는다. 데이터베이스에 뷰가 하나뿐이면 서지 않는다(그릴 것이 없어진다).
 * **그 소스를 보는 마지막 뷰**면 뷰만 지울 수 없다(소스마다 뷰가 적어도 하나 — `deleteView` 의 `last_view`). 노션처럼 *"Delete the view
 * and the data source"* 를 묻는다 — 소스를 휴지통으로 보내면(8e-3a) 그 뷰는 숨겨지고, 휴지통에서 되살리면 함께 돌아온다. 노션의 "뷰만
 * 지우기"(주인 없는 소스를 남기기)는 두지 않는다 — 뷰가 없는 소스는 어느 탭에서도 열 수 없다. 지우면 데이터베이스의 첫 뷰로 옮긴다.
 *
 * 데이터베이스가 소스를 둘 이상 가지면(8e-2 · F-04-23 *"뷰 생성 시 어떤 data source 를 볼지 선택"*) "뷰 추가" 창이 볼 소스를 묻는다 —
 * 처음 값은 지금 뷰의 소스다. 소스가 하나면 묻지 않는다(서버가 그것을 고른다).
 */

import { useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import type { MvpViewType, ViewSummary } from '@/lib/database/view'
import * as api from './table-api'

/** 탭의 종류 아이콘. 장식이다 — 이름이 곧 종류를 말한다. */
export const VIEW_TYPE_ICON: Readonly<Record<string, string>> = { table: '▦', board: '▥', list: '≡', gallery: '⊞', calendar: '▤' }
const VIEW_TYPE_LABEL: Readonly<Record<MvpViewType, string>> = { table: '표', board: '보드', list: '목록', gallery: '갤러리', calendar: '캘린더' }
/** 이 화면이 만들 수 있는 종류 — 서버가 받는 것 전부(`MVP_VIEW_TYPES`). */
const CREATABLE: readonly MvpViewType[] = ['table', 'board', 'list', 'gallery', 'calendar']

const MENU_ITEM =
  'block w-full rounded px-2 py-1 text-left text-sm hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800'

export function ViewTabs({
  workspaceId,
  databaseId,
  views,
  currentId,
  canEdit,
  sources,
}: {
  workspaceId: string
  databaseId: string
  views: readonly ViewSummary[]
  currentId: string
  canEdit: boolean
  /** 이 데이터베이스의 소스들(부착 순서). 둘 이상이면 뷰를 만들 때 고른다. */
  sources: readonly { readonly id: string; readonly name: string }[]
}) {
  const router = useRouter()
  const [menu, setMenu] = useState<'add' | 'current' | null>(null)
  /** 뷰 메뉴에서 "뷰 지우기"를 고르고 한 번 더 묻는 중이다. */
  const [askingDelete, setAskingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = views.find((view) => view.id === currentId) ?? null
  const [addSource, setAddSource] = useState(current?.dataSourceId ?? sources[0]?.id ?? '')

  const toggle = (next: 'add' | 'current') => {
    setError(null)
    // 여는 순간 지금 뷰의 소스로 맞춘다 — 다른 탭에서 열었던 고르기가 남지 않게.
    if (next === 'add' && menu !== 'add') setAddSource(current?.dataSourceId ?? sources[0]?.id ?? '')
    setAskingDelete(false)
    setMenu((open) => (open === next ? null : next))
  }

  const create = async (type: MvpViewType) => {
    setBusy(true)
    setError(null)
    const result = await api.createView(workspaceId, databaseId, {
      type,
      name: VIEW_TYPE_LABEL[type],
      ...(sources.length > 1 && addSource !== '' ? { dataSourceId: addSource } : {}),
    })
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

  // 이 뷰가 그 소스를 보는 마지막 뷰인가 — 그러면 지우기는 "뷰와 소스를 함께 휴지통으로"다(머리말).
  const lastOfSource = current !== null && views.filter((view) => view.dataSourceId === current.dataSourceId).length === 1
  const currentSourceName = sources.find((source) => source.id === current?.dataSourceId)?.name ?? ''

  const remove = async () => {
    if (current === null) return
    setBusy(true)
    setError(null)
    const result = lastOfSource
      ? await api.trashDataSource(workspaceId, current.dataSourceId)
      : await api.deleteView(workspaceId, current.id)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setAskingDelete(false)
    setMenu(null)
    // 지운 탭은 없다 — 데이터베이스의 첫 뷰로(`?v=` 없이).
    router.push(`/w/${workspaceId}/db/${databaseId}`)
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
                className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
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
                {views.length > 1 && !askingDelete && (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="db-view-delete"
                    disabled={busy}
                    onClick={() => setAskingDelete(true)}
                    className={`${MENU_ITEM} text-red-600 dark:text-red-400`}
                  >
                    뷰 지우기
                  </button>
                )}
                {askingDelete && (
                  <div role="group" aria-label="뷰 지우기" data-testid="db-view-delete-ask" className="mt-1 flex flex-col gap-1.5 px-2 py-1 text-xs">
                    {lastOfSource ? (
                      <p data-testid="db-view-delete-with-source-note">
                        이 데이터 소스(<strong>{currentSourceName}</strong>)를 보는 마지막 뷰입니다. 뷰와 데이터 소스를 함께 휴지통으로
                        보냅니다 — 그 항목도 함께 가고, 휴지통에서 되살릴 수 있습니다.
                      </p>
                    ) : (
                      <p>
                        <strong>{current.name}</strong> 뷰를 지웁니다. 항목은 그대로입니다.
                      </p>
                    )}
                    <div className="flex gap-1">
                      <button
                        type="button"
                        data-testid="db-view-delete-confirm"
                        disabled={busy}
                        // 묻는 상자가 열리면 곧바로 Enter 로 확정할 수 있게.
                        autoFocus
                        onClick={() => void remove()}
                        className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-700 disabled:opacity-40"
                      >
                        {lastOfSource ? '뷰와 소스를 함께 휴지통으로' : '지우기'}
                      </button>
                      <button
                        type="button"
                        data-testid="db-view-delete-cancel"
                        onClick={() => setAskingDelete(false)}
                        className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                )}
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
                className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
              >
                {sources.length > 1 && (
                  <label className="flex flex-col gap-1 px-2 pb-1.5 pt-1 text-xs text-neutral-500">
                    볼 데이터 소스
                    <select
                      value={addSource}
                      onChange={(e) => setAddSource(e.target.value)}
                      aria-label="볼 데이터 소스"
                      data-testid="db-view-add-source"
                      className="rounded border border-neutral-200 bg-transparent px-1.5 py-1 text-sm text-neutral-800 dark:border-neutral-700 dark:text-neutral-100"
                    >
                      {sources.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
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
