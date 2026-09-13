'use client'

/**
 * 속성(컬럼) 추가 — F-03-02
 *
 * 표 머리 오른쪽 끝의 `+`. 이름과 유형을 받아 맨 뒤에 붙인다(`addProperty` 가 맨 뒤에
 * 붙이는 것과 같은 자리). `title` 은 고를 수 없다 — 표마다 정확히 하나다(불변식 P1).
 *
 * 이 버튼은 `edit_structure` 가 있을 때만 그려진다(표가 정한다).
 */

import { useEffect, useRef, useState } from 'react'

import { MVP_PROPERTY_TYPES, type MvpPropertyType } from '@/lib/database/property-types'
import { TYPE_ICON, TYPE_LABEL } from './cell-view'

const ADDABLE_TYPES = MVP_PROPERTY_TYPES.filter((t) => t !== 'title')

export function AddColumn({
  onAdd,
}: {
  /** 실패하면 사람이 읽을 이유를, 성공하면 `null` 을 돌려준다. */
  onAdd: (name: string, type: MvpPropertyType) => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<MvpPropertyType>('rich_text')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) nameRef.current?.focus()
  }, [open])

  const close = () => {
    setOpen(false)
    setName('')
    setType('rich_text')
    setError(null)
  }

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="db-add-column"
        aria-label="속성 추가"
        aria-expanded={open}
        title="속성 추가"
        onClick={() => (open ? close() : setOpen(true))}
        className="w-full rounded px-2 text-base text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        +
      </button>

      {open && (
        <form
          role="dialog"
          aria-label="속성 추가"
          data-testid="db-add-column-form"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              close()
            }
          }}
          onSubmit={async (e) => {
            e.preventDefault()
            if (name.trim() === '' || busy) return
            setBusy(true)
            const failure = await onAdd(name, type)
            setBusy(false)
            if (failure === null) close()
            else setError(failure)
          }}
          className="absolute right-0 z-20 mt-1 flex w-64 flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3 text-left font-normal shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="속성 이름"
            aria-label="속성 이름"
            maxLength={200}
            className="rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:text-neutral-100"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as MvpPropertyType)}
            aria-label="속성 유형"
            className="rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm text-neutral-900 dark:border-neutral-700 dark:text-neutral-100"
          >
            {ADDABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_ICON[t]} {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy || name.trim() === ''}
            className="self-end rounded-md border border-neutral-300 px-3 py-1 text-sm text-neutral-900 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-100"
          >
            {busy ? '추가하는 중…' : '추가'}
          </button>
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
