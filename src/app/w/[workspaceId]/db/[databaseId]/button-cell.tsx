'use client'

/**
 * 버튼 칸 — 속성 이름의 단추 (자동화 5a-3 · F-03-15)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑩
 *
 * 누르면 그 행에서 버튼의 액션을 실행하고(`table-api.ts` `pressButton` — 누를 때마다 새 멱등 키) 결과를 칸에 짧게 말한다. 도는 동안은
 * 단추를 막는다(두 번 눌러도 한 번). 값을 고칠 수 없는 사람에게는 눌리지 않는다(서버가 다시 묻는다 — 거절은 말로). 바뀐 칸은 표 변경
 * 알림이 다시 그린다(X-5) — 이 칸은 결과만 말한다.
 *
 * 칸을 고르는 누르기(`onCellMouseDown`) · 카드를 여는 누르기로 번지지 않게 막는다 — 단추를 누르는 것이 칸을 고르거나 카드를 여는 것이
 * 아니다. 표 · 행 페이지 · 보드 · 갤러리의 카드가 이 칸을 쓴다(5a-4 · 정본 ⑪).
 */

import { useState } from 'react'

import { buttonRunMessage, type ButtonTone } from './button-messages'
import * as api from './table-api'

const TONE: Record<ButtonTone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
}

export function ButtonCell({
  workspaceId,
  rowId,
  propertyId,
  name,
  canPress,
}: {
  workspaceId: string
  rowId: string
  propertyId: string
  name: string
  canPress: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ readonly text: string; readonly tone: ButtonTone } | null>(null)

  const press = async () => {
    if (busy) return
    setBusy(true)
    setResult(null)
    const pressed = await api.pressButton(workspaceId, rowId, propertyId)
    setResult(pressed.ok ? buttonRunMessage(pressed.run) : buttonRunMessage(null, pressed.error))
    setBusy(false)
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        data-testid="db-button-cell"
        aria-busy={busy}
        disabled={!canPress || busy}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        // 보드 카드는 pointerdown 으로 끌기를 시작한다 — 단추를 누르는 것이 카드를 끄는 것이 아니다
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          // 카드(보드 · 갤러리)를 여는 누르기로 번지지 않게
          e.stopPropagation()
          e.preventDefault()
          void press()
        }}
        title={canPress ? undefined : '이 표의 값을 고칠 수 있는 사람만 누를 수 있습니다'}
        className="max-w-full shrink-0 truncate rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-xs font-medium hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        {busy ? '…' : name || '버튼'}
      </button>
      {result !== null && (
        <span role="status" data-testid="db-button-result" data-tone={result.tone} className={`min-w-0 truncate text-xs ${TONE[result.tone]}`}>
          {result.text}
        </span>
      )}
    </span>
  )
}
