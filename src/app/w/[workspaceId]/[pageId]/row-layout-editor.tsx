'use client'

/**
 * 레이아웃 편집 모드 — 행 페이지의 속성 묶음 (잔여 묶음 8f-2 · F-16-01 · F-16-03) · 제목 아래 고정 (3a-2 · F-16-02) · 페이지 설정
 * (3b-2 · F-16-09 · F-16-10) · 본문 모듈 · 상세 패널 (3c-2 · F-16-04 · F-16-05)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 행의 레이아웃 ③ ~ ⑤ · [보강] 제목 아래 고정 · [보강] 본문 모듈 · 상세 패널
 *       16-item-layout.md F-16-01 *"한 번의 확정 동작으로 전체에 반영"* · 클론 대안 *"드래그 앤 드롭 빌더를 처음부터 만들지 말고 …
 *       리스트 UI 로 제공한다"* · F-16-02 *"핀 해제 → Property group 으로 되돌아간다"* · F-16-04 *"Move to panel / Move to page"*
 *
 * 초안은 이 화면의 상태다 — 서버에 저장하지 않는다. "모든 행에 적용"이 자리 · 순서 · 숨김 · 페이지 설정을 **한 번에** 보낸다(전체 교체 ·
 * 낙관적 잠금). 이 화면은 노션 전반의 자동 저장에 대한 명시적 예외다(16 F-16-01). 취소하면 초안을 버린다.
 *
 * 목록은 자리마다 하나다(한 속성은 한 자리 — 정본 [보강]):
 *
 *   · **제목 아래 고정** — heading 안의 순서 · 15개까지(차면 핀이 꺼지고 까닭을 말한다)
 *   · **본문** — 속성 묶음과 올린 속성의 위아래. 속성 묶음은 이 줄의 한 자리라 옮길 수만 있다
 *   · **상세 패널** — 오른쪽 칸의 순서. 관계형은 놓을 수 없다(M4 — 그 단추가 꺼지고 까닭을 말한다)
 *   · **속성 묶음** — 나머지 · 스키마 순서 · 숨김
 *
 * 자리를 옮기면 그 속성은 새 목록의 끝으로 간다 — 속성 묶음으로 돌아가면 스키마 자리로. 숨긴 속성을 다른 자리로 옮기면 보이게 된다.
 * 순서는 위 · 아래 단추로 바꾼다 — 키보드로도 된다. 옮긴 뒤에도 포커스가 그 속성의 단추에 남는다(줄이 DOM 에서 옮겨지면 포커스를 잃는다).
 *
 * 페이지 설정(백링크 · 코멘트 표시 · 토론 · 속성 아이콘 · 전체 폭)도 같은 초안이다 — 이 화면은 다섯 칸을 늘 다 보낸다.
 */

import { useEffect, useRef, useState } from 'react'

import type { ViewColumn } from '@/lib/database/view-columns'
import { MAX_PINNED_PROPERTIES } from '@/lib/database/limits'
import { canPlaceInPanel, GROUP_MODULE } from '@/lib/database/layout-modules'
import type { BacklinksMode, InlineCommentMode, PageSettings } from '@/lib/database/page-settings'
import { TYPE_ICON } from '../db/[databaseId]/cell-view'
import * as api from '../db/[databaseId]/table-api'

type Item = { readonly id: string; readonly name: string; readonly type: ViewColumn['type']; readonly visible: boolean }
/** 본문 줄의 한 자리 — 속성이거나 속성 묶음. */
type Entry = Item | 'group'
type ListName = 'pinned' | 'main' | 'panel' | 'group'
type Lists = Readonly<Record<ListName, readonly Entry[]>>
type Direction = 'up' | 'down'
/** 옮긴 뒤 포커스를 돌려줄 단추 — 그 단추가 꺼졌으면 `fallback`. */
type FocusTarget = { readonly id: string; readonly testId: string; readonly fallback?: string }

const idOf = (entry: Entry): string => (entry === 'group' ? GROUP_MODULE : entry.id)
const itemsOf = (entries: readonly Entry[]): Item[] => entries.filter((e): e is Item => e !== 'group')

const PIN_FULL = `제목 아래에는 속성을 ${MAX_PINNED_PROPERTIES}개까지 고정할 수 있습니다`
const PANEL_FORBIDDEN = '관계형 속성은 상세 패널에 놓을 수 없습니다'

/** 백링크 표시의 이름 — 16 의 "호버할 때만"은 접어 두고 눌러 펼친다(터치 화면에도 같은 길 · §3.2-143). */
const BACKLINKS_LABEL: Record<BacklinksMode, string> = { always: '늘 펼쳐 보임', hover: '접어 둠', off: '보이지 않음' }
const INLINE_COMMENTS_LABEL: Record<InlineCommentMode, string> = { default: '칠해서 보임', minimal: '밑줄만' }
/** 켜고 끄는 세 칸 — 칸 · 이름 · 검사가 찾는 id. */
const TOGGLES: readonly { key: 'showDiscussions' | 'showPropertyIcons' | 'fullWidth'; label: string; testId: string }[] = [
  { key: 'showDiscussions', label: '머리에 "코멘트" 단추(토론)를 보인다', testId: 'row-layout-discussions' },
  { key: 'showPropertyIcons', label: '속성 이름 앞에 유형 아이콘을 보인다', testId: 'row-layout-property-icons' },
  { key: 'fullWidth', label: '페이지를 화면 폭으로 편다', testId: 'row-layout-full-width' },
]

const SMALL_BUTTON =
  'rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900'
const ARROW_BUTTON = 'h-7 w-7 rounded text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800'
const HEADING = 'mt-1 text-xs font-medium text-neutral-600 dark:text-neutral-300'
const ROW = 'flex h-9 items-center gap-1.5 rounded px-1 hover:bg-neutral-50 dark:hover:bg-neutral-900'

export function RowLayoutEditor(props: {
  workspaceId: string
  dataSourceId: string
  /** 속성 묶음 — 스키마 순서 · 숨긴 것은 `visible: false`. 제목 · rollup 은 이미 뺐다. */
  columns: readonly ViewColumn[]
  /** 제목 아래에 고정한 속성 — heading 안의 순서(3a-2). */
  pinned: readonly string[]
  /** 본문 줄 — 속성 id 와 속성 묶음(`GROUP_MODULE`)(3c-2). */
  main: readonly string[]
  /** 상세 패널의 속성(3c-2). */
  panel: readonly string[]
  /** 지금의 페이지 설정(3b-2) — 초안이 여기서 시작한다. */
  settings: PageSettings
  /** 초안을 시작할 때의 레이아웃 버전(머리가 없으면 `'0'`). */
  version: string
  /** 적용한 뒤 서버가 다시 그리는 중이다 — 그동안 단추를 막는다. */
  refreshing: boolean
  onCancel: () => void
  /** 적용됐다(바뀐 것이 없어도) — 서버의 새 버전과 함께. */
  onApplied: (changed: boolean, version: string) => void
}) {
  const schemaIndex = new Map(props.columns.map((c, i) => [c.propertyId, i]))
  const [lists, setLists] = useState<Lists>(() => {
    const byId = new Map(props.columns.map((c) => [c.propertyId, c]))
    const itemOf = (id: string): Item[] => {
      const c = byId.get(id)
      return c === undefined ? [] : [{ id: c.propertyId, name: c.name, type: c.type, visible: c.visible }]
    }
    const placed = new Set([...props.pinned, ...props.main, ...props.panel])
    const main: Entry[] = props.main.flatMap((id): Entry[] => (id === GROUP_MODULE ? ['group'] : itemOf(id)))
    return {
      pinned: props.pinned.flatMap(itemOf),
      main: main.includes('group') ? main : [...main, 'group'],
      panel: props.panel.flatMap(itemOf),
      group: props.columns.filter((c) => !placed.has(c.propertyId)).flatMap((c) => itemOf(c.propertyId)),
    }
  })
  const [settings, setSettings] = useState<PageSettings>(props.settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const focusAfter = useRef<FocusTarget | null>(null)
  const busy = saving || props.refreshing
  const full = lists.pinned.length >= MAX_PINNED_PROPERTIES
  const anyRelation = [...itemsOf(lists.main), ...itemsOf(lists.group)].some((item) => !canPlaceInPanel(item.type))

  // 편집 모드에 들어오면 이 상자로 포커스를 옮긴다 — 화면 읽기 프로그램이 모드가 바뀐 것을 듣는다.
  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  useEffect(() => {
    const target = focusAfter.current
    if (target === null) return
    focusAfter.current = null
    const row = rootRef.current?.querySelector(`[data-property-id="${CSS.escape(target.id)}"]`)
    const first = row?.querySelector<HTMLButtonElement>(`[data-testid="${target.testId}"]`)
    // 맨 위 · 맨 아래에 닿으면 그 단추가 꺼진다 — 반대쪽 단추로.
    const other = target.fallback === undefined ? null : row?.querySelector<HTMLButtonElement>(`[data-testid="${target.fallback}"]`)
    ;(first && !first.disabled ? first : other)?.focus()
  }, [lists])

  const move = (list: ListName, index: number, direction: Direction) => {
    const current = lists[list]
    const to = direction === 'up' ? index - 1 : index + 1
    if (to < 0 || to >= current.length) return
    const next = current.slice()
    const [moving] = next.splice(index, 1)
    next.splice(to, 0, moving!)
    focusAfter.current = {
      id: idOf(moving!),
      testId: `row-layout-${direction}`,
      fallback: `row-layout-${direction === 'up' ? 'down' : 'up'}`,
    }
    setLists({ ...lists, [list]: next })
  }

  /** 자리를 옮긴다 — 새 목록의 끝으로, 속성 묶음이면 스키마 자리로. 다른 자리로 가면 보이게 된다. */
  const relocate = (item: Item, from: ListName, to: ListName, focusTestId: string) => {
    const moved: Item = { ...item, visible: true }
    const target = lists[to].slice()
    if (to === 'group') {
      const at = target.findIndex((e) => e !== 'group' && (schemaIndex.get(e.id) ?? 0) > (schemaIndex.get(item.id) ?? 0))
      target.splice(at === -1 ? target.length : at, 0, moved)
    } else {
      target.push(moved)
    }
    focusAfter.current = { id: item.id, testId: focusTestId }
    setLists({ ...lists, [from]: lists[from].filter((e) => e === 'group' || e.id !== item.id), [to]: target })
  }

  const toggle = (index: number) =>
    setLists({ ...lists, group: lists.group.map((e, i) => (i === index && e !== 'group' ? { ...e, visible: !e.visible } : e)) })

  const apply = async () => {
    setSaving(true)
    setError(null)
    const group = itemsOf(lists.group)
    const result = await api.applyLayout(props.workspaceId, props.dataSourceId, {
      version: props.version,
      order: group.map((item) => item.id),
      hidden: group.filter((item) => !item.visible).map((item) => item.id),
      pinned: itemsOf(lists.pinned).map((item) => item.id),
      main: lists.main.map(idOf),
      panel: itemsOf(lists.panel).map((item) => item.id),
      settings,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    props.onApplied(result.value.changed, result.value.version)
  }

  const hiddenCount = itemsOf(lists.group).filter((item) => !item.visible).length

  const orderButtons = (list: ListName, entry: Entry, i: number) => {
    const name = entry === 'group' ? '속성 묶음' : entry.name
    return (
      <>
        <button
          type="button"
          data-testid="row-layout-up"
          aria-label={`${name} 위로`}
          disabled={busy || i === 0}
          onClick={() => move(list, i, 'up')}
          className={ARROW_BUTTON}
        >
          ↑
        </button>
        <button
          type="button"
          data-testid="row-layout-down"
          aria-label={`${name} 아래로`}
          disabled={busy || i === lists[list].length - 1}
          onClick={() => move(list, i, 'down')}
          className={ARROW_BUTTON}
        >
          ↓
        </button>
      </>
    )
  }

  const label = (item: Item) => (
    <>
      <span aria-hidden className="w-4 flex-none text-center text-xs text-neutral-400">
        {TYPE_ICON[item.type]}
      </span>
      <span className={`min-w-0 flex-1 truncate text-sm ${item.visible ? '' : 'text-neutral-400'}`}>
        {item.name}
        {!item.visible && <span className="ml-1.5 text-xs">(숨김)</span>}
      </span>
    </>
  )

  /** 상세 패널로 — 관계형이면 꺼진다(M4). */
  const toPanelButton = (item: Item, from: ListName) => {
    const allowed = canPlaceInPanel(item.type)
    return (
      <button
        type="button"
        data-testid="row-layout-to-panel"
        aria-label={allowed ? `${item.name} 상세 패널로` : `${item.name} 상세 패널로 — ${PANEL_FORBIDDEN}`}
        title={allowed ? undefined : PANEL_FORBIDDEN}
        disabled={busy || !allowed}
        onClick={() => relocate(item, from, 'panel', 'row-layout-to-main')}
        className={SMALL_BUTTON}
      >
        패널
      </button>
    )
  }

  const lowerButton = (item: Item, from: ListName) => (
    <button
      type="button"
      data-testid="row-layout-lower"
      aria-label={`${item.name} 속성 묶음으로 내리기`}
      disabled={busy}
      onClick={() => relocate(item, from, 'group', 'row-layout-raise')}
      className={SMALL_BUTTON}
    >
      내리기
    </button>
  )

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="레이아웃 편집"
      tabIndex={-1}
      data-testid="row-layout-editor"
      className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 outline-none dark:border-neutral-800"
    >
      <p className="text-xs text-neutral-500">
        이 데이터베이스의 모든 행에 같은 레이아웃이 적용됩니다. 숨긴 속성의 값은 그대로 남습니다.
      </p>

      <h3 className={HEADING}>
        제목 아래 고정 <span className="font-normal text-neutral-400">{lists.pinned.length} / {MAX_PINNED_PROPERTIES}</span>
      </h3>
      {lists.pinned.length === 0 ? (
        <p data-testid="row-layout-pinned-empty" className="px-1 text-xs text-neutral-400">
          고정한 속성이 없습니다. 아래 속성 묶음의 &quot;고정&quot;을 누르면 제목 바로 아래에 섭니다.
        </p>
      ) : (
        <ul className="flex flex-col" data-testid="row-layout-pinned">
          {itemsOf(lists.pinned).map((item, i) => (
            <li key={item.id} data-testid="row-layout-item" data-property-id={item.id} data-pinned="true" data-visible="true" className={ROW}>
              {label(item)}
              {orderButtons('pinned', item, i)}
              <button
                type="button"
                data-testid="row-layout-unpin"
                aria-label={`${item.name} 고정 풀기`}
                disabled={busy}
                onClick={() => relocate(item, 'pinned', 'group', 'row-layout-pin')}
                className={SMALL_BUTTON}
              >
                풀기
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className={HEADING}>본문</h3>
      <ul className="flex flex-col" data-testid="row-layout-main">
        {lists.main.map((entry, i) =>
          entry === 'group' ? (
            <li key={GROUP_MODULE} data-testid="row-layout-group-marker" data-property-id={GROUP_MODULE} className={ROW}>
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-500">속성 묶음 — 아래 목록의 속성들</span>
              {orderButtons('main', entry, i)}
            </li>
          ) : (
            <li key={entry.id} data-testid="row-layout-item" data-property-id={entry.id} data-place="main" data-visible="true" className={ROW}>
              {label(entry)}
              {orderButtons('main', entry, i)}
              {toPanelButton(entry, 'main')}
              {lowerButton(entry, 'main')}
            </li>
          ),
        )}
      </ul>

      <h3 className={HEADING}>상세 패널</h3>
      {lists.panel.length === 0 ? (
        <p data-testid="row-layout-panel-empty" className="px-1 text-xs text-neutral-400">
          패널이 비어 있습니다. &quot;패널&quot;을 누른 속성은 행 페이지 오른쪽의 접히는 칸에 섭니다.
        </p>
      ) : (
        <ul className="flex flex-col" data-testid="row-layout-panel">
          {itemsOf(lists.panel).map((item, i) => (
            <li key={item.id} data-testid="row-layout-item" data-property-id={item.id} data-place="panel" data-visible="true" className={ROW}>
              {label(item)}
              {orderButtons('panel', item, i)}
              <button
                type="button"
                data-testid="row-layout-to-main"
                aria-label={`${item.name} 본문으로`}
                disabled={busy}
                onClick={() => relocate(item, 'panel', 'main', 'row-layout-lower')}
                className={SMALL_BUTTON}
              >
                본문
              </button>
              {lowerButton(item, 'panel')}
            </li>
          ))}
        </ul>
      )}

      <h3 className={HEADING}>속성 묶음</h3>
      <ul className="flex flex-col" data-testid="row-layout-group">
        {itemsOf(lists.group).map((item, i) => (
          <li key={item.id} data-testid="row-layout-item" data-property-id={item.id} data-visible={item.visible} className={ROW}>
            {label(item)}
            {orderButtons('group', item, i)}
            <button
              type="button"
              data-testid="row-layout-pin"
              aria-label={`${item.name} 제목 아래 고정`}
              // 꺼진 단추는 마우스를 올려도 아무 말이 없다 — 까닭은 아래의 안내 줄이 말한다(`title` 은 덤이다).
              title={full ? PIN_FULL : undefined}
              disabled={busy || full}
              onClick={() => relocate(item, 'group', 'pinned', 'row-layout-unpin')}
              className={SMALL_BUTTON}
            >
              고정
            </button>
            <button
              type="button"
              data-testid="row-layout-raise"
              aria-label={`${item.name} 본문 모듈로 올리기`}
              disabled={busy}
              onClick={() => relocate(item, 'group', 'main', 'row-layout-lower')}
              className={SMALL_BUTTON}
            >
              본문
            </button>
            {toPanelButton(item, 'group')}
            <button
              type="button"
              data-testid="row-layout-visibility"
              aria-label={`${item.name} ${item.visible ? '숨기기' : '보이기'}`}
              aria-pressed={!item.visible}
              disabled={busy}
              onClick={() => toggle(i)}
              className={`w-14 ${SMALL_BUTTON}`}
            >
              {item.visible ? '숨기기' : '보이기'}
            </button>
          </li>
        ))}
      </ul>
      {full && (
        <p data-testid="row-layout-pin-full" className="px-1 text-xs text-neutral-500">
          {PIN_FULL}. 더 고정하려면 먼저 하나를 푸세요.
        </p>
      )}
      {anyRelation && (
        <p data-testid="row-layout-panel-forbidden" className="px-1 text-xs text-neutral-500">
          {PANEL_FORBIDDEN}.
        </p>
      )}

      <h3 className={HEADING}>페이지 설정</h3>
      <div className="flex flex-col gap-1.5 px-1 text-sm" data-testid="row-layout-settings">
        <label className="flex items-center justify-between gap-2">
          <span>백링크</span>
          <select
            data-testid="row-layout-backlinks"
            value={settings.backlinks}
            disabled={busy}
            onChange={(e) => setSettings({ ...settings, backlinks: e.target.value as BacklinksMode })}
            className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
          >
            {(Object.keys(BACKLINKS_LABEL) as BacklinksMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {BACKLINKS_LABEL[mode]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>본문의 코멘트 표시</span>
          <select
            data-testid="row-layout-inline-comments"
            value={settings.inlineComments}
            disabled={busy}
            onChange={(e) => setSettings({ ...settings, inlineComments: e.target.value as InlineCommentMode })}
            className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
          >
            {(Object.keys(INLINE_COMMENTS_LABEL) as InlineCommentMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {INLINE_COMMENTS_LABEL[mode]}
              </option>
            ))}
          </select>
        </label>
        {TOGGLES.map((toggleItem) => (
          <label key={toggleItem.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              data-testid={toggleItem.testId}
              checked={settings[toggleItem.key]}
              disabled={busy}
              onChange={(e) => setSettings({ ...settings, [toggleItem.key]: e.target.checked })}
            />
            <span>{toggleItem.label}</span>
          </label>
        ))}
      </div>

      {error !== null && (
        <p role="alert" data-testid="row-layout-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-neutral-400">{hiddenCount > 0 ? `숨긴 속성 ${hiddenCount}개` : '모두 보임'}</span>
        <button
          type="button"
          data-testid="row-layout-cancel"
          disabled={busy}
          onClick={props.onCancel}
          className="rounded-md px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          취소
        </button>
        <button
          type="button"
          data-testid="row-layout-apply"
          disabled={busy}
          onClick={() => void apply()}
          className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? '적용하는 중…' : '모든 행에 적용'}
        </button>
      </div>
    </div>
  )
}
