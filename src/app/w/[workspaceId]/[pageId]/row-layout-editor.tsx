'use client'

/**
 * 레이아웃 편집 모드 — 행 페이지의 속성 묶음 (잔여 묶음 8f-2 · F-16-01 · F-16-03) · 제목 아래 고정 (3a-2 · F-16-02)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 행의 레이아웃 ③ ~ ⑤ · [보강] 제목 아래 고정
 *       16-item-layout.md F-16-01 *"한 번의 확정 동작으로 전체에 반영"* · 클론 대안 *"드래그 앤 드롭 빌더를 처음부터 만들지 말고 …
 *       리스트 UI 로 제공한다"* · F-16-02 *"핀 아이콘 클릭 → Heading 영역으로 이동 · 핀 해제 → Property group 으로 되돌아간다"*
 *
 * 초안은 이 화면의 상태다 — 서버에 저장하지 않는다. "모든 행에 적용"이 고정 · 숨김 · 순서를 **한 번에** 보낸다(전체 교체 · 낙관적 잠금).
 * 이 화면은 노션 전반의 자동 저장에 대한 명시적 예외다(16 F-16-01). 취소하면 초안을 버린다.
 *
 * 목록은 둘이다 — **제목 아래**(고정 · heading 안의 순서)와 **속성 묶음**(스키마 순서 · 숨김). 핀은 속성을 위 목록의 끝으로 옮기고,
 * 풀면 아래 목록의 스키마 자리로 돌아간다. 숨긴 속성을 고정하면 보이게 된다(한 속성은 한 자리 — 정본 [보강] ③). 고정한 속성에는 숨기기가
 * 없다 — 먼저 푼다. 15개가 차면 핀이 꺼지고 까닭을 말한다.
 *
 * 순서는 위 · 아래 단추로 바꾼다 — 키보드로도 된다. 옮긴 뒤에도 포커스가 그 속성의 단추에 남는다(줄이 DOM 에서 옮겨지면 포커스를
 * 잃는다). 핀을 누르면 포커스가 옮겨 간 줄의 핀 단추로 따라간다.
 */

import { useEffect, useRef, useState } from 'react'

import type { ViewColumn } from '@/lib/database/view-columns'
import { MAX_PINNED_PROPERTIES } from '@/lib/database/limits'
import { TYPE_ICON } from '../db/[databaseId]/cell-view'
import * as api from '../db/[databaseId]/table-api'

type Item = { readonly id: string; readonly name: string; readonly type: ViewColumn['type']; readonly visible: boolean }
type Direction = 'up' | 'down'
type List = 'pinned' | 'group'
/** 옮긴 뒤 포커스를 돌려줄 단추 — 그 단추가 꺼졌으면 `fallback`. */
type FocusTarget = { readonly id: string; readonly testId: string; readonly fallback?: string }

const PIN_FULL = `제목 아래에는 속성을 ${MAX_PINNED_PROPERTIES}개까지 고정할 수 있습니다`

export function RowLayoutEditor(props: {
  workspaceId: string
  dataSourceId: string
  /** 속성 묶음 — 스키마 순서 · 숨긴 것은 `visible: false`. 제목 · rollup 은 이미 뺐다. */
  columns: readonly ViewColumn[]
  /** 제목 아래에 고정한 속성 — heading 안의 순서(3a-2). */
  pinned: readonly string[]
  /** 초안을 시작할 때의 레이아웃 버전(머리가 없으면 `'0'`). */
  version: string
  /** 적용한 뒤 서버가 다시 그리는 중이다 — 그동안 단추를 막는다. */
  refreshing: boolean
  onCancel: () => void
  /** 적용됐다(바뀐 것이 없어도). */
  onApplied: (changed: boolean) => void
}) {
  const itemOf = (c: ViewColumn): Item => ({ id: c.propertyId, name: c.name, type: c.type, visible: c.visible })
  const [pinned, setPinned] = useState<Item[]>(() =>
    props.pinned.flatMap((id) => {
      const column = props.columns.find((c) => c.propertyId === id)
      return column === undefined ? [] : [itemOf(column)]
    }),
  )
  const [items, setItems] = useState<Item[]>(() =>
    props.columns.filter((c) => !props.pinned.includes(c.propertyId)).map(itemOf),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const focusAfter = useRef<FocusTarget | null>(null)
  const busy = saving || props.refreshing
  const full = pinned.length >= MAX_PINNED_PROPERTIES

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
  }, [items, pinned])

  const move = (list: List, index: number, direction: Direction) => {
    const current = list === 'pinned' ? pinned : items
    const to = direction === 'up' ? index - 1 : index + 1
    if (to < 0 || to >= current.length) return
    const next = current.slice()
    const [moving] = next.splice(index, 1)
    next.splice(to, 0, moving!)
    focusAfter.current = {
      id: moving!.id,
      testId: `row-layout-${direction}`,
      fallback: `row-layout-${direction === 'up' ? 'down' : 'up'}`,
    }
    if (list === 'pinned') setPinned(next)
    else setItems(next)
  }

  const toggle = (index: number) => setItems(items.map((item, i) => (i === index ? { ...item, visible: !item.visible } : item)))

  /** 속성 묶음 → 제목 아래의 끝. 숨긴 속성이면 보이게 된다. */
  const pin = (index: number) => {
    if (full) return
    const item = items[index]!
    focusAfter.current = { id: item.id, testId: 'row-layout-unpin' }
    setItems(items.filter((_, i) => i !== index))
    setPinned([...pinned, { ...item, visible: true }])
  }

  /** 제목 아래 → 속성 묶음의 스키마 자리. */
  const unpin = (index: number) => {
    const item = pinned[index]!
    const order = new Map(props.columns.map((c, i) => [c.propertyId, i]))
    const at = items.findIndex((other) => (order.get(other.id) ?? 0) > (order.get(item.id) ?? 0))
    const next = items.slice()
    next.splice(at === -1 ? next.length : at, 0, item)
    focusAfter.current = { id: item.id, testId: 'row-layout-pin' }
    setPinned(pinned.filter((_, i) => i !== index))
    setItems(next)
  }

  const apply = async () => {
    setSaving(true)
    setError(null)
    const result = await api.applyLayout(props.workspaceId, props.dataSourceId, {
      version: props.version,
      order: items.map((item) => item.id),
      hidden: items.filter((item) => !item.visible).map((item) => item.id),
      pinned: pinned.map((item) => item.id),
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    props.onApplied(result.value.changed)
  }

  const hiddenCount = items.filter((item) => !item.visible).length

  const orderButtons = (list: List, item: Item, i: number, length: number) => (
    <>
      <button
        type="button"
        data-testid="row-layout-up"
        aria-label={`${item.name} 위로`}
        disabled={busy || i === 0}
        onClick={() => move(list, i, 'up')}
        className="h-7 w-7 rounded text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
      >
        ↑
      </button>
      <button
        type="button"
        data-testid="row-layout-down"
        aria-label={`${item.name} 아래로`}
        disabled={busy || i === length - 1}
        onClick={() => move(list, i, 'down')}
        className="h-7 w-7 rounded text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
      >
        ↓
      </button>
    </>
  )

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

      <h3 className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
        제목 아래 고정 <span className="font-normal text-neutral-400">{pinned.length} / {MAX_PINNED_PROPERTIES}</span>
      </h3>
      {pinned.length === 0 ? (
        <p data-testid="row-layout-pinned-empty" className="px-1 text-xs text-neutral-400">
          고정한 속성이 없습니다. 아래 목록의 &quot;고정&quot;을 누르면 제목 바로 아래에 섭니다.
        </p>
      ) : (
        <ul className="flex flex-col" data-testid="row-layout-pinned">
          {pinned.map((item, i) => (
            <li
              key={item.id}
              data-testid="row-layout-item"
              data-property-id={item.id}
              data-pinned="true"
              data-visible="true"
              className="flex h-9 items-center gap-2 rounded px-1 hover:bg-neutral-50 dark:hover:bg-neutral-900"
            >
              {label(item)}
              {orderButtons('pinned', item, i, pinned.length)}
              <button
                type="button"
                data-testid="row-layout-unpin"
                aria-label={`${item.name} 고정 풀기`}
                disabled={busy}
                onClick={() => unpin(i)}
                className="w-14 rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
              >
                풀기
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">속성 묶음</h3>
      <ul className="flex flex-col" data-testid="row-layout-group">
        {items.map((item, i) => (
          <li
            key={item.id}
            data-testid="row-layout-item"
            data-property-id={item.id}
            data-visible={item.visible}
            className="flex h-9 items-center gap-2 rounded px-1 hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            {label(item)}
            {orderButtons('group', item, i, items.length)}
            <button
              type="button"
              data-testid="row-layout-pin"
              aria-label={`${item.name} 제목 아래 고정`}
              // 꺼진 단추는 마우스를 올려도 아무 말이 없다 — 까닭은 아래의 안내 줄이 말한다(`title` 은 덤이다).
              title={full ? PIN_FULL : undefined}
              disabled={busy || full}
              onClick={() => pin(i)}
              className="w-12 rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              고정
            </button>
            <button
              type="button"
              data-testid="row-layout-visibility"
              aria-label={`${item.name} ${item.visible ? '숨기기' : '보이기'}`}
              aria-pressed={!item.visible}
              disabled={busy}
              onClick={() => toggle(i)}
              className="w-14 rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
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
