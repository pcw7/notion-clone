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
 * `defaultPrevented` 인 이벤트를 건너뛴다. 그 둘은 **같은 이벤트**이고 입력칸이 표
 * 안에 있어서 버블링으로 반드시 표에 닿는다 — 검색 오버레이처럼 포커스 격리가 막아
 * 주지 않는다(슬래시 메뉴에서 겪은 것과 같은 모양, HANDOFF §6).
 *
 * 반사실로 확인한 실제 증상: 가드를 빼면 **기존 옵션을 Enter 로 고른 뒤 편집기가
 * 다시 열린다.** 고르는 순간 칸이 "선택" 상태가 되고, 같은 Enter 가 표에 닿아
 * "선택 칸의 Enter = 편집 시작"이 되기 때문이다. 옵션 **만들기**는 비동기라 결과만
 * 보면 같아 보인다 — 표가 선택을 아래 칸으로 옮기지만 요청이 끝난 뒤 되돌아온다.
 * e2e 는 그래서 기존 옵션 고르기로 이 가드를 본다.
 *
 * Esc 와 Tab 은 쓰지 않는다. 표에 맡기면 Esc 는 편집 취소(= 닫기), Tab 은 고르지 않고
 * 옆 칸이다.
 *
 * 옵션을 누를 때 `mousedown` 의 기본 동작을 막는다. 막지 않으면 입력칸이 먼저 포커스를
 * 잃고, 표가 그것을 "편집을 떠났다"로 읽어 편집기를 닫아서 `click` 이 도착할 곳이
 * 사라진다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 옵션 고치기 (10n-6 · 03 F-03-04 시나리오 4)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 스키마를 고칠 수 있으면(`edit`) 옵션 줄마다 `···` 가 선다. 누르면 같은 층 안에서 목록 대신 고치기 판이 선다 — 이름(Enter 로
 * 저장 · Esc 로 목록) · 색 · 지우기. 지우기는 그 옵션을 쓰는 행 수를 먼저 받아 "N개 행에서 이 값이 빠집니다" 라고 한 번 더 묻는다
 * (지우면 서버가 그 셀을 비운다 — 정본 [보강] 옵션 고치기 · 지우기 ②). 판의 이름 칸도 층 안이라 표는 편집을 닫지 않는다
 * (`containsAcrossLayers`). 판의 Esc 는 목록으로 돌아가고(`preventDefault` — 표의 Esc 는 편집 취소다) 표에 닿지 않는다.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { colorLabel } from '@/lib/editor/color-names'
import { OPTION_COLORS, STATUS_GROUP_KINDS, STATUS_GROUP_LABEL, type OptionColor, type SelectOption, type StatusGroupKind } from '@/lib/database/property-types'
import { AnchoredLayer } from '../../anchored-layer'
import { OptionChip } from './cell-view'

/** 옵션 고치기 — 부르는 쪽(표)이 서버에 보내고 목록 · 칸을 갈아 끼운다. 실패하면 false(null)이고 표가 이유를 말한다. */
export type OptionEditActions = {
  readonly rename: (optionId: string, name: string) => Promise<boolean>
  readonly recolor: (optionId: string, color: OptionColor) => Promise<boolean>
  /** status 옵션의 그룹을 바꾼다(10n-20) — 새 그룹의 맨 뒤에 선다. status 칸에만 준다. */
  readonly regroup?: (optionId: string, group: StatusGroupKind) => Promise<boolean>
  /** 그 옵션을 쓰는 살아 있는 행 수. */
  readonly usage: (optionId: string) => Promise<number | null>
  readonly remove: (optionId: string) => Promise<boolean>
}

export function SelectEditor({
  options,
  currentId,
  canCreate,
  isStatus = false,
  align = 'left',
  edit,
  onPick,
  onCreate,
}: {
  options: readonly SelectOption[]
  currentId: string | null
  /** 새 옵션을 만들 수 있는가(`edit_structure`). 없으면 "만들기" 항목을 그리지 않는다. */
  canCreate: boolean
  /**
   * status 칸인가. 목록을 그룹 머리(할 일 · 진행 중 · 완료)로 구획하고(F-03-05 시나리오 2), 새 옵션은 **할 일**
   * 그룹에 만든다고 말한다. 옵션은 이미 그룹 순서로 온다(`options.ts`) — 여기서는 그룹이 바뀌는 자리에 머리만 끼운다.
   * 머리는 옵션이 아니라서 ↑↓ 의 색인에 들지 않는다.
   */
  isStatus?: boolean
  /** 팝오버를 칸의 어느 쪽에 맞춰 여는가. List 의 속성 칸은 오른쪽에 붙어 있어 `right` 다. */
  align?: 'left' | 'right'
  /** 옵션 고치기(10n-6) — 있으면 옵션 줄마다 `···`(`edit_structure`). 없으면 고르기만 한다. */
  edit?: OptionEditActions
  onPick: (optionId: string | null) => void
  onCreate: (name: string) => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 고치는 옵션 — 있으면 목록 대신 고치기 판이 선다. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  /** 지우기를 묻는 중 — 그 옵션을 쓰는 행 수. */
  const [asking, setAsking] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const editing = editingId === null ? undefined : options.find((o) => o.id === editingId)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 판이 서면 이름 칸에 · 목록으로 돌아오면 찾기 칸에 포커스
  useEffect(() => {
    if (editingId !== null) nameRef.current?.select()
    else inputRef.current?.focus()
  }, [editingId])

  const openEdit = (option: SelectOption) => {
    setEditingId(option.id)
    setDraftName(option.name)
    setAsking(null)
  }
  const closeEdit = () => {
    setEditingId(null)
    setAsking(null)
  }
  const run = async (task: () => Promise<boolean>) => {
    setBusy(true)
    try {
      return await task()
    } finally {
      setBusy(false)
    }
  }

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

  if (edit !== undefined && editing !== undefined) {
    const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Enter') {
        // ★ 표의 Enter 가 아니다 — 이름을 저장하고 목록으로
        event.preventDefault()
        const name = draftName.trim()
        if (name === '' || name === editing.name) return closeEdit()
        void run(() => edit.rename(editing.id, name)).then((ok) => {
          if (ok) closeEdit()
        })
      } else if (event.key === 'Escape') {
        // 표의 Esc(편집 취소)가 아니라 목록으로 돌아간다
        event.preventDefault()
        closeEdit()
      }
    }
    return (
      <AnchoredLayer
        testId="db-select-editor"
        align={align === 'right' ? 'end' : 'start'}
        className="w-64 rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      >
        <div data-testid="db-option-edit" data-option-id={editing.id} className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="옵션 목록으로"
              data-testid="db-option-edit-back"
              onMouseDown={(e) => e.preventDefault()}
              onClick={closeEdit}
              className="rounded px-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              ←
            </button>
            <span className="text-xs text-neutral-500">옵션 고치기</span>
          </div>
          <input
            ref={nameRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={onNameKeyDown}
            aria-label="옵션 이름"
            data-testid="db-option-name"
            autoComplete="off"
            // disabled 가 아니다 — 포커스가 있는 칸을 끄면 포커스가 빠지고 표가 "편집을 떠났다" 로 읽어 고르개를 닫는다
            readOnly={busy}
            className="w-full rounded border border-neutral-200 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700"
          />
          <div role="group" aria-label="색" className="grid grid-cols-5 gap-1">
            {OPTION_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={colorLabel(color)}
                aria-pressed={editing.color === color}
                data-testid="db-option-color"
                data-color={color}
                disabled={busy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void run(() => edit.recolor(editing.id, color))}
                className={`flex justify-center rounded p-1 ${editing.color === color ? 'ring-2 ring-neutral-400' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
              >
                <OptionChip option={{ ...editing, name: '가', color }} />
              </button>
            ))}
          </div>
          {isStatus && edit.regroup !== undefined && editing.group !== undefined && (
            <div role="group" aria-label="그룹" className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">그룹</span>
              <div className="flex gap-1">
                {STATUS_GROUP_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={editing.group === kind}
                    data-testid="db-option-group"
                    data-group={kind}
                    disabled={busy || editing.group === kind}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void run(() => edit.regroup!(editing.id, kind))}
                    className={`flex-1 rounded px-1.5 py-1 text-xs ${editing.group === kind ? 'bg-neutral-200 font-medium dark:bg-neutral-700' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
                  >
                    {STATUS_GROUP_LABEL[kind]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {asking === null ? (
            <button
              type="button"
              data-testid="db-option-delete"
              disabled={busy}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() =>
                void run(async () => {
                  const rows = await edit.usage(editing.id)
                  if (rows === null) return false
                  setAsking(rows)
                  return true
                })
              }
              className="rounded px-2 py-1 text-left text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            >
              옵션 지우기
            </button>
          ) : (
            <div role="alert" data-testid="db-option-delete-ask" className="flex flex-col gap-1 rounded bg-red-50 p-2 text-xs dark:bg-red-950">
              <p>{asking > 0 ? `${asking}개 행에서 이 값이 빠집니다. 지울까요?` : '이 옵션을 쓰는 행이 없습니다. 지울까요?'}</p>
              <div className="flex gap-1">
                <button
                  type="button"
                  data-testid="db-option-delete-confirm"
                  disabled={busy}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    void run(() => edit.remove(editing.id)).then((ok) => {
                      if (ok) closeEdit()
                    })
                  }
                  className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700"
                >
                  지우기
                </button>
                <button
                  type="button"
                  data-testid="db-option-delete-cancel"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setAsking(null)}
                  className="rounded px-2 py-0.5 hover:bg-white dark:hover:bg-neutral-900"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      </AnchoredLayer>
    )
  }

  return (
    // 몸으로 내보낸 층(10j-3a) — 표가 자기 틀 안에서 흘러도 잘리지 않는다. 기준은 칸(위치를 가진 가장 가까운 조상)
    <AnchoredLayer
      testId="db-select-editor"
      align={align === 'right' ? 'end' : 'start'}
      className="w-64 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
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
          <Fragment key={option.id}>
          {isStatus && option.group !== undefined && option.group !== matches[i - 1]?.group && (
            <li
              role="presentation"
              data-testid="db-status-group"
              className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-neutral-400"
            >
              {STATUS_GROUP_LABEL[option.group]}
            </li>
          )}
          <li
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
            <span className="flex flex-none items-center gap-1">
              {option.id === currentId && <span className="text-xs text-neutral-400">선택됨</span>}
              {edit !== undefined && (
                <button
                  type="button"
                  aria-label={`${option.name} 고치기`}
                  data-testid="db-option-menu"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={(e) => {
                    // 줄의 click(고르기)에 닿지 않게
                    e.stopPropagation()
                    openEdit(option)
                  }}
                  className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                >
                  ···
                </button>
              )}
            </span>
          </li>
          </Fragment>
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
            ‘{q}’ 만들기{isStatus ? ` — ${STATUS_GROUP_LABEL.todo} 그룹에` : ''}
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
          data-testid="db-select-clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(null)}
          className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          선택 지우기
        </button>
      )}
    </AnchoredLayer>
  )
}
