'use client'

/**
 * 표 아래의 집계 칸 — F-04-16 (DB 심화 2d-2조각)
 *
 * 04: *"table 열 하단 `Calculate` 클릭 → 집계 함수 선택 → 값 표시"*. 열마다 하나다. 계산을 단 열은 `함수 이름 값`(`평균 30`)을 보이고,
 * 고칠 수 있는 사람에게는 누르면 그 타입이 고를 수 있는 함수 목록(`calculationsFor`)과 "없음"이 열린다. 계산이 없는 열은 마우스를 올렸을
 * 때만 "계산"이 보인다(노션처럼 — 빈 칸이 줄마다 글자로 차지 않게).
 *
 * 값은 서버가 필터를 지난 행 전부로 계산한 것이다(`calculate.ts`). 고르면 뷰 설정을 저장하고 서버 렌더를 다시 받는다 — 함수가 다시 마운트
 * 기준(`contentKey`)에 있어 표가 새 값으로 다시 선다.
 */

import { useState } from 'react'

import {
  CALCULATION_LABEL,
  calculationsFor,
  formatCalculation,
  type Calculation,
  type CalculationResult,
} from '@/lib/database/calculations'
import { isMvpPropertyType } from '@/lib/database/property-types'

export function CalculationCell({
  type,
  calculation,
  result,
  canEdit,
  onPick,
}: {
  /** 그 열의 타입. 셀 타입이 아니면 계산할 수 없다(빈 칸). */
  type: string
  calculation: Calculation | null
  /** 서버가 계산한 값. 함수가 그 타입에 맞지 않게 됐으면(타입을 바꾼 뒤) 없다. */
  result: CalculationResult | undefined
  canEdit: boolean
  /** 실패하면 사람이 읽을 이유를, 성공하면 `null` 을 돌려준다. */
  onPick: (calculation: Calculation | null) => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!isMvpPropertyType(type)) return null
  const choices = calculationsFor(type)
  const shown = calculation !== null && result !== undefined

  const pick = async (next: Calculation | null) => {
    setBusy(true)
    setError(null)
    const failure = await onPick(next)
    setBusy(false)
    if (failure === null) setOpen(false)
    else setError(failure)
  }

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="db-calc-button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!canEdit}
        onClick={() => setOpen((v) => !v)}
        className={`w-full truncate rounded px-1 py-0.5 text-right text-xs text-neutral-500 hover:bg-neutral-100 disabled:hover:bg-transparent dark:hover:bg-neutral-800 ${
          shown ? '' : 'opacity-0 group-hover/calc:opacity-100 focus:opacity-100'
        }`}
      >
        {shown ? (
          <>
            <span className="mr-1 text-neutral-400">{CALCULATION_LABEL[calculation]}</span>
            <span data-testid="db-calc-value" className="tabular-nums text-neutral-700 dark:text-neutral-200">
              {formatCalculation(result)}
            </span>
          </>
        ) : (
          '계산'
        )}
      </button>
      {open && canEdit && (
        <div
          role="menu"
          aria-label="계산"
          data-testid="db-calc-menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
          className="absolute bottom-full right-0 z-30 mb-1 flex max-h-72 w-44 flex-col overflow-y-auto rounded-md border border-neutral-200 bg-white p-1 text-left text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={calculation === null}
            data-testid="db-calc-none"
            disabled={busy}
            onClick={() => void pick(null)}
            className="rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            없음
          </button>
          {choices.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitemradio"
              aria-checked={calculation === c}
              data-testid={`db-calc-${c}`}
              disabled={busy}
              onClick={() => void pick(c)}
              className={`rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${calculation === c ? 'font-medium' : ''}`}
            >
              {CALCULATION_LABEL[c]}
            </button>
          ))}
          {error && (
            <p role="alert" className="px-2 py-1 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
