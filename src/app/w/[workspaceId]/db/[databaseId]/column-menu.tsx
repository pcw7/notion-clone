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
 * 고유 ID 속성에는 "접두사 바꾸기"가 선다(2a-2 · F-03-09 시나리오 3 *"`속성 편집` → 접두사 입력"*). 비우면 번호만 보인다.
 *
 * "유형 바꾸기"(2c-2 · F-03-14) — 바꿀 수 있는 타입(글 · 숫자 · 선택 · 체크박스 · 날짜)의 속성에만 선다. 값이 사라지는 칸이 있으면 서버가
 * 센 개수로 **한 번 더 묻는다**("N개 칸의 값이 사라집니다") — 노션은 묻지 않고 되돌릴 수도 없다(03).
 *
 * 지우기 · 유형 바꾸기를 열면 **이 속성을 읽는 수식 · 롤업**을 읽어 알린다(2j-1 · F-03-13 — `loadDependents`). 막지는 않는다 — 지우면 그
 * 칸이 오류가 되고(되살리면 돌아온다), 유형을 바꾸면 맞지 않는 것이 오류가 된다. 누르기 전에 무엇이 깨지는지 말한다. 다른 표의 롤업은 그
 * 표를 볼 수 있을 때만 이름이 있다(아니면 개수만).
 *
 * "식 고치기"(2i-3b · F-03-12) — 수식 속성에만 선다. 편집기는 표가 그린다(`formulaEdit` — 계산 계획 · 첫 행을 표가 갖고 있다). 메뉴는
 * 그 자리를 넓혀 담기만 한다.
 *
 * 이 메뉴는 `edit_structure` 가 있을 때만 그려진다(표가 정한다).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { SortKey } from '@/lib/database/filter'
import type { PropertyDependents } from '@/lib/database/property-dependents'

export function ColumnMenu({
  name,
  isTitle,
  sortable,
  prefix,
  convertTo,
  onConvert,
  onSort,
  onRename,
  onPrefix,
  onHide,
  onDelete,
  formulaEdit,
  loadDependents,
}: {
  name: string
  isTitle: boolean
  /** 고유 ID 속성의 지금 접두사(없으면 빈 글자). 고유 ID 가 아니면 `undefined` — 접두사 항목이 서지 않는다. */
  prefix?: string
  /** 바꿀 수 있는 다른 타입들(2c-2). 비었거나 없으면 "유형 바꾸기"가 서지 않는다. */
  convertTo?: readonly { readonly type: string; readonly label: string }[]
  /** 타입을 바꾼다 — 바뀌었으면 `done`, 값이 사라지는 칸이 있으면 그 개수(`lost` — 확인을 받아 다시 부른다), 실패면 이유. */
  onConvert?: (type: string, confirmLoss: boolean) => Promise<{ readonly done: true } | { readonly lost: number } | { readonly error: string }>
  /** select · relation · rollup 은 정렬할 수 없다(`view-columns.ts` 의 `isSortable`). */
  sortable: boolean
  /** 실패하면 사람이 읽을 이유를, 성공하면 `null` 을 돌려준다. */
  onSort: (direction: SortKey['direction']) => Promise<string | null>
  onRename: (name: string) => Promise<string | null>
  onPrefix?: (prefix: string) => Promise<string | null>
  onHide: () => Promise<string | null>
  onDelete: () => Promise<string | null>
  /** 수식 속성의 "식 고치기"(2i-3b) — 편집기를 그린다. 끝나면(저장 · 취소) `close` 를 부른다. 없으면 항목이 서지 않는다. */
  formulaEdit?: (close: () => void) => ReactNode
  /** 이 속성을 읽는 수식 · 롤업(2j-1). 못 읽으면 null(알리지 못할 뿐 지우기 · 바꾸기는 그대로). 없으면 묻지 않는다. */
  loadDependents?: () => Promise<PropertyDependents | null>
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'menu' | 'rename' | 'prefix' | 'convert' | 'confirm-loss' | 'delete' | 'formula'>('menu')
  /** 손실 확인을 기다리는 변환 — 고른 타입과 서버가 센 칸 수. */
  const [pending, setPending] = useState<{ type: string; label: string; lost: number } | null>(null)
  const [draft, setDraft] = useState(name)
  const [prefixDraft, setPrefixDraft] = useState(prefix ?? '')
  const prefixRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 이 속성을 읽는 것 — `undefined` 는 아직 읽는 중(또는 묻지 않음), `null` 은 못 읽었다. */
  const [dependents, setDependents] = useState<PropertyDependents | null | undefined>(undefined)

  /** 지우기 · 유형 바꾸기로 들어간다 — 들어갈 때마다 다시 읽는다(그사이 수식이 생겼을 수 있다). */
  const enter = (next: 'delete' | 'convert') => {
    setStep(next)
    if (loadDependents === undefined) return
    setDependents(undefined)
    void loadDependents().then(setDependents)
  }

  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (step === 'rename') inputRef.current?.focus()
    else if (step === 'prefix') prefixRef.current?.focus()
    // 입력칸이 없는 단계(지우기 · 유형 바꾸기 · 손실 확인)는 누른 항목이 사라지면서 포커스가 패널 밖(body)으로 간다 — 그러면 패널의
    // Escape 가 닿지 않아 키보드로 닫을 수 없다(2j-1 의 검사가 찾았다). 패널로 옮긴다. 식 고치기는 편집기가 스스로 잡는다.
    else if (step !== 'menu' && step !== 'formula') panelRef.current?.focus()
  }, [step])

  const close = () => {
    setOpen(false)
    setStep('menu')
    setDraft(name)
    setPrefixDraft(prefix ?? '')
    setPending(null)
    setError(null)
    setDependents(undefined)
  }

  const convert = async (type: string, label: string, confirmLoss: boolean) => {
    if (onConvert === undefined) return
    setBusy(true)
    setError(null)
    const result = await onConvert(type, confirmLoss)
    setBusy(false)
    if ('done' in result) close()
    else if ('lost' in result) {
      setPending({ type, label, lost: result.lost })
      setStep('confirm-loss')
    } else setError(result.error)
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
          ref={panelRef}
          tabIndex={-1}
          role="menu"
          aria-label={`${name} 속성 메뉴`}
          data-testid="db-column-menu-panel"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              close()
            }
          }}
          className={`absolute right-0 top-full z-30 mt-1 flex ${
            step === 'formula' ? 'w-80' : 'w-56'
          } flex-col rounded-md border border-neutral-200 bg-white p-1 text-left text-sm font-normal text-neutral-800 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100`}
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
              {convertTo !== undefined && convertTo.length > 0 && onConvert !== undefined && (
                <MenuItem testId="db-column-convert" disabled={busy} onClick={() => enter('convert')}>
                  유형 바꾸기
                </MenuItem>
              )}
              {prefix !== undefined && onPrefix !== undefined && (
                <MenuItem testId="db-column-prefix" disabled={busy} onClick={() => setStep('prefix')}>
                  접두사 바꾸기
                </MenuItem>
              )}
              {formulaEdit !== undefined && (
                <MenuItem testId="db-column-formula" disabled={busy} onClick={() => setStep('formula')}>
                  식 고치기
                </MenuItem>
              )}
              {!isTitle && (
                <MenuItem testId="db-column-hide" disabled={busy} onClick={() => void run(onHide)}>
                  보기에서 숨기기
                </MenuItem>
              )}
              {!isTitle && (
                <MenuItem testId="db-column-delete" disabled={busy} danger onClick={() => enter('delete')}>
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

          {step === 'convert' && convertTo !== undefined && (
            <div className="flex flex-col p-1" data-testid="db-column-convert-list">
              {loadDependents !== undefined && <DependentsNote dependents={dependents} effect="유형을 바꾸면 맞지 않는 것은 오류가 됩니다." />}
              <p className="px-1 pb-1 text-xs text-neutral-500">바꿀 유형</p>
              {convertTo.map((option) => (
                <MenuItem
                  key={option.type}
                  testId={`db-column-convert-${option.type}`}
                  disabled={busy}
                  onClick={() => void convert(option.type, option.label, false)}
                >
                  {option.label}
                </MenuItem>
              ))}
            </div>
          )}
          {step === 'confirm-loss' && pending !== null && (
            <div className="flex flex-col gap-1 p-1" data-testid="db-column-convert-confirm">
              <p className="text-xs text-neutral-600 dark:text-neutral-300">
                ‘{name}’ 속성을 {pending.label}(으)로 바꾸면 <strong>{pending.lost.toLocaleString('ko-KR')}개 칸의 값이 사라집니다.</strong> 되돌릴 수 없습니다.
              </p>
              <div className="flex justify-end gap-1">
                <button type="button" onClick={close} className="rounded px-2 py-0.5 text-sm text-neutral-500">
                  취소
                </button>
                <button
                  type="button"
                  data-testid="db-column-convert-confirm-button"
                  disabled={busy}
                  onClick={() => void convert(pending.type, pending.label, true)}
                  className="rounded-md border border-red-300 px-2 py-0.5 text-sm text-red-700 disabled:opacity-40 dark:border-red-800 dark:text-red-300"
                >
                  그래도 바꾸기
                </button>
              </div>
            </div>
          )}
          {step === 'prefix' && onPrefix !== undefined && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void run(() => onPrefix(prefixDraft))
              }}
              className="flex flex-col gap-1 p-1"
            >
              <input
                ref={prefixRef}
                value={prefixDraft}
                onChange={(e) => setPrefixDraft(e.target.value)}
                aria-label="ID 접두사"
                placeholder="비우면 번호만"
                maxLength={7}
                autoComplete="off"
                className="rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
              />
              <p className="text-xs text-neutral-500">영숫자 2~7자 · 대문자로 보입니다.</p>
              <button
                type="submit"
                data-testid="db-column-prefix-save"
                disabled={busy}
                className="self-end rounded-md border border-neutral-300 px-2 py-0.5 text-sm disabled:opacity-40 dark:border-neutral-700"
              >
                바꾸기
              </button>
            </form>
          )}
          {step === 'formula' && formulaEdit !== undefined && formulaEdit(close)}
          {step === 'delete' && (
            <div className="flex flex-col gap-1 p-1">
              {loadDependents !== undefined && <DependentsNote dependents={dependents} effect="지우면 그 칸이 오류가 됩니다(속성을 되살리면 돌아옵니다)." />}
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

const KIND_LABEL = { formula: '수식', rollup: '롤업' } as const

/**
 * 이 속성을 읽는 수식 · 롤업(2j-1) — 읽는 중이면 그렇다고, 없으면 아무것도 그리지 않는다. 못 읽었으면 말하지 않는다(지우기를 막을
 * 이유가 아니다 — 알림일 뿐이다).
 */
function DependentsNote({ dependents, effect }: { dependents: PropertyDependents | null | undefined; effect: string }) {
  if (dependents === undefined) {
    return (
      <p data-testid="db-column-dependents-loading" className="px-1 pb-1 text-xs text-neutral-400">
        이 속성을 읽는 수식 · 롤업을 확인하는 중…
      </p>
    )
  }
  if (dependents === null || (dependents.dependents.length === 0 && dependents.hidden === 0)) return null
  return (
    <div
      data-testid="db-column-dependents"
      className="mb-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <p>이 속성을 읽는 것:</p>
      <ul className="list-disc pl-4">
        {dependents.dependents.map((d) => (
          <li key={d.id} data-testid="db-column-dependent">
            ‘{d.name}’ {KIND_LABEL[d.type]}
            {d.tableName !== null && <span className="text-amber-700 dark:text-amber-300"> · {d.tableName}</span>}
          </li>
        ))}
        {dependents.hidden > 0 && <li data-testid="db-column-dependents-hidden">볼 수 없는 표의 롤업 {dependents.hidden}개</li>}
      </ul>
      <p>{effect}</p>
    </div>
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
