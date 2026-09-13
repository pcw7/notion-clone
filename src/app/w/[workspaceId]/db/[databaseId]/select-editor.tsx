'use client'

/**
 * select 칸 편집기 — F-03-04
 *
 *   *"셀 클릭 → 팝오버 열림 → 검색창 + 기존 옵션 목록. 텍스트 입력 → 일치 옵션
 *    필터링 + `"XXX" 생성` 항목 표시 → 클릭 시 옵션이 스키마에 추가되고 동시에
 *    셀에 할당된다."*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이 목록이 쓴 키는 표의 규칙을 타지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * ↑↓ 와 Enter 는 여기서 쓰고 `preventDefault()` 한다. 표의 키 처리기는
 * `defaultPrevented` 인 이벤트를 건너뛴다 — 그러지 않으면 옵션을 고르는 Enter 가
 * 표에서 한 번 더 "저장하고 아래 칸"이 된다(슬래시 메뉴에서 겪은 것과 같은 모양의
 * 버그, HANDOFF §6). 그 둘은 **같은 이벤트**이고 입력칸이 표 안에 있어서 버블링으로
 * 반드시 표에 닿는다 — 검색 오버레이처럼 포커스 격리가 막아 주지 않는다.
 *
 * Esc 와 Tab 은 쓰지 않는다. 표에 맡기면 Esc 는 편집 취소(= 닫기), Tab 은 고르지 않고
 * 옆 칸이다.
 *
 * 옵션을 누를 때 `mousedown` 의 기본 동작을 막는다. 막지 않으면 입력칸이 먼저 포커스를
 * 잃고, 표가 그것을 "편집을 떠났다"로 읽어 편집기를 닫아서 `click` 이 도착할 곳이
 * 사라진다.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import type { SelectOption } from '@/lib/database/property-types'
import { OptionChip } from './cell-view'

export function SelectEditor({
  options,
  currentId,
  canCreate,
  onPick,
  onCreate,
}: {
  options: readonly SelectOption[]
  currentId: string | null
  /** 새 옵션을 만들 수 있는가(`edit_structure`). 없으면 "만들기" 항목을 그리지 않는다. */
  canCreate: boolean
  onPick: (optionId: string | null) => void
  onCreate: (name: string) => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const q = query.trim()
  const lower = q.toLowerCase()
  const matches = useMemo(
    () => (lower === '' ? options : options.filter((o) => o.name.toLowerCase().includes(lower))),
    [options, lower],
  )
  // 이름 유니크는 대소문자 무시다(`ux_select_option_name`). 같은 이름이 있으면
  // "만들기"를 보여주지 않는다 — 눌러도 서버가 기존 옵션으로 수렴시킬 뿐이다.
  const exact = options.some((o) => o.name.toLowerCase() === lower)
  const showCreate = canCreate && q !== '' && !exact
  const count = matches.length + (showCreate ? 1 : 0)
  const active = count === 0 ? -1 : Math.min(index, count - 1)

  const choose = (i: number) => {
    if (i < 0) return
    if (i < matches.length) onPick(matches[i].id)
    else onCreate(q)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // IME 조합 중의 Enter · 화살표는 한글 입력의 몫이다.
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (count === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setIndex((active + step + count) % count)
    } else if (event.key === 'Enter') {
      // ★ 표의 Enter(저장하고 아래 칸)가 아니라 이 목록의 Enter 다(머리말).
      event.preventDefault()
      choose(active)
    }
  }

  return (
    <div
      data-testid="db-select-editor"
      className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setIndex(0)
        }}
        onKeyDown={onKeyDown}
        placeholder={canCreate ? '옵션 검색 또는 만들기' : '옵션 검색'}
        aria-label="옵션 검색"
        data-testid="db-select-input"
        autoComplete="off"
        className="mb-1 w-full rounded border border-neutral-200 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700"
      />

      <ul role="listbox" aria-label="옵션" className="max-h-56 overflow-auto">
        {matches.map((option, i) => (
          <li
            key={option.id}
            role="option"
            aria-selected={i === active}
            data-testid="db-option"
            data-option-id={option.id}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(i)}
            className={`flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 ${
              i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''
            }`}
          >
            <OptionChip option={option} />
            {option.id === currentId && <span className="text-xs text-neutral-400">선택됨</span>}
          </li>
        ))}

        {showCreate && (
          <li
            role="option"
            aria-selected={active === matches.length}
            data-testid="db-create-option"
            onMouseEnter={() => setIndex(matches.length)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(matches.length)}
            className={`cursor-pointer rounded px-2 py-1 text-sm ${
              active === matches.length ? 'bg-neutral-100 dark:bg-neutral-800' : ''
            }`}
          >
            ‘{q}’ 만들기
          </li>
        )}

        {count === 0 && (
          <li className="px-2 py-1 text-sm text-neutral-400">
            {options.length === 0 ? '옵션이 없습니다' : '일치하는 옵션이 없습니다'}
          </li>
        )}
      </ul>

      {currentId !== null && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(null)}
          className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          선택 지우기
        </button>
      )}
    </div>
  )
}
