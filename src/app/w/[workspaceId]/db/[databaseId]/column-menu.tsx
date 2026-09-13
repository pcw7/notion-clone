'use client'

/**
 * 컬럼 머리 메뉴 — F-04-02 · F-04-12 · F-03-02
 *
 *   *"헤더 `···` → `Wrap column` / `Freeze up to column` / `Hide in view`"* (F-04-02)
 *
 * 정렬 · 이름 바꾸기 · 보기에서 숨기기 · 속성 삭제. 줄바꿈 · 고정 · 폭은 아직 없다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 삭제는 메뉴 안에서 한 번 더 묻는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 서버의 삭제는 soft delete 라 값이 남지만(`deleteProperty`), 되돌리는 화면이 아직
 * 없다. 그래서 확인을 받는다. `window.confirm` 을 쓰지 않는 이유: 페이지 전체를 멈추고,
 * 키보드 사용자는 메뉴가 있던 자리에서 끝낼 수 없다.
 *
 * 제목 속성에는 숨기기 · 삭제가 없다(F-04-12 · 불변식 P1). 서버도 막는다.
 *
 * 이 메뉴는 `edit_structure` 가 있을 때만 그려진다(표가 정한다).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { SortKey } from '@/lib/database/filter'

export function ColumnMenu({
  name,
  isTitle,
  sortable,
  onSort,
  onRename,
  onHide,
  onDelete,
}: {
  name: string
  isTitle: boolean
  /** select 는 아직 정렬할 수 없다(`view-toolbar.tsx` 의 `isSortable`). */
  sortable: boolean
  /** 실패하면 사람이 읽을 이유를, 성공하면 `null` 을 돌려준다. */
  onSort: (direction: SortKey['direction']) => Promise<string | null>
  onRename: (name: string) => Promise<string | null>
  onHide: () => Promise<string | null>
  onDelete: () => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'menu' | 'rename' | 'delete'>('menu')
  const [draft, setDraft] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === 'rename') inputRef.current?.focus()
  }, [step])

  const close = () => {
    setOpen(false)
    setStep('menu')
    setDraft(name)
    setError(null)
  }

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    const failure = await action()
    setBusy(false)
    if (failure === null) close()
    else setError(failure)
  }

  return (
    <span className="relative flex-none">
      <button
        type="button"
        aria-label={`${name} 속성 메뉴`}
        aria-expanded={open}
        data-testid="db-column-menu"
        onClick={() => (open ? close() : setOpen(true))}
        className="rounded px-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        ⋯
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`${name} 속성 메뉴`}
          data-testid="db-column-menu-panel"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              close()
            }
          }}
          className="absolute right-0 top-full z-30 mt-1 flex w-56 flex-col rounded-md border border-neutral-200 bg-white p-1 text-left text-sm font-normal text-neutral-800 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        >
          {step === 'menu' && (
            <>
              {sortable && (
                <MenuItem testId="db-column-sort-asc" disabled={busy} onClick={() => void run(() => onSort('asc'))}>
                  ↑ 오름차순 정렬
                </MenuItem>
              )}
              {sortable && (
                <MenuItem testId="db-column-sort-desc" disabled={busy} onClick={() => void run(() => onSort('desc'))}>
                  ↓ 내림차순 정렬
                </MenuItem>
              )}
              <MenuItem testId="db-column-rename" disabled={busy} onClick={() => setStep('rename')}>
                이름 바꾸기
              </MenuItem>
              {!isTitle && (
                <MenuItem testId="db-column-hide" disabled={busy} onClick={() => void run(onHide)}>
                  보기에서 숨기기
                </MenuItem>
              )}
              {!isTitle && (
                <MenuItem testId="db-column-delete" disabled={busy} danger onClick={() => setStep('delete')}>
                  속성 삭제
                </MenuItem>
              )}
            </>
          )}

          {step === 'rename' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void run(() => onRename(draft))
              }}
              className="flex flex-col gap-1 p-1"
            >
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="속성 새 이름"
                maxLength={200}
                autoComplete="off"
                className="rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
              />
              <button
                type="submit"
                data-testid="db-column-rename-save"
                disabled={busy || draft.trim() === ''}
                className="self-end rounded-md border border-neutral-300 px-2 py-0.5 text-sm disabled:opacity-40 dark:border-neutral-700"
              >
                바꾸기
              </button>
            </form>
          )}

          {step === 'delete' && (
            <div className="flex flex-col gap-1 p-1">
              <p className="text-xs text-neutral-500">
                ‘{name}’ 속성과 모든 행의 이 칸이 표에서 사라집니다. 값은 보관되지만 되돌리는 화면은 아직 없습니다.
              </p>
              <div className="flex justify-end gap-1">
                <button type="button" onClick={() => setStep('menu')} className="rounded px-2 py-0.5 text-sm text-neutral-500">
                  취소
                </button>
                <button
                  type="button"
                  data-testid="db-column-delete-confirm"
                  disabled={busy}
                  onClick={() => void run(onDelete)}
                  className="rounded border border-red-300 px-2 py-0.5 text-sm text-red-600 disabled:opacity-40 dark:border-red-900"
                >
                  삭제
                </button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="px-2 py-1 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </span>
  )
}

function MenuItem({
  testId,
  disabled,
  danger,
  onClick,
  children,
}: {
  testId: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={`rounded px-2 py-1 text-left hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800 ${
        danger ? 'text-red-600' : ''
      }`}
    >
      {children}
    </button>
  )
}
