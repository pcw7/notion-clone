'use client'

/**
 * 버튼 설정 — 열 머리 메뉴 안의 편집기 (자동화 5a-3 · F-03-15)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑥ ⑩
 *
 * 이 편집기는 **"이 행의 값 바꾸기"(`edit_property`)** 만 고친다 — 속성을 고르고 그 타입의 값을 넣는다(숫자 · 체크 · 선택 · 상태 · 글 ·
 * 날짜). 그 밖의 액션(다른 표에 행 추가 — 5a-4)은 요약으로 서고 저장할 때 **그대로 남는다** — 화면이 모르는 액션을 지우지 않는다(지우기
 * 단추로만 지운다). 판정은 서버에 있다 — 저장하면 서버가 그 표의 스키마에 대어 보고, 틀리면 몇 번째 액션의 무엇인지 말한다.
 *
 * 메뉴는 구조를 고칠 수 있는 사람에게만 선다(표가 정한다 · 서버가 다시 묻는다).
 */

import { useEffect, useState } from 'react'

import { emptyValue, type CellValue, type MvpPropertyType } from '@/lib/database/property-types'
import { isCellColumn, type ViewColumn } from '@/lib/database/view-columns'
import { textRun, toPlainText } from '@/lib/contracts/rich-text'
import * as api from './table-api'

type CellDraft = { readonly propertyId: string; readonly value: CellValue }
type Draft =
  | { readonly kind: 'edit'; readonly cells: readonly CellDraft[] }
  /** 이 편집기가 고치지 않는 액션 — 받은 그대로 다시 보낸다. */
  | { readonly kind: 'other'; readonly raw: api.ButtonActionJson }

const OTHER_LABEL: Record<string, string> = {
  add_page_to: '다른 표에 행 추가',
  send_webhook: '웹훅 보내기',
  insert_blocks: '블록 넣기',
  define_variables: '변수 정하기',
  show_confirmation: '확인 묻기',
}

const toDraft = (action: api.ButtonActionJson): Draft => {
  const cells = action.config.cells
  if (action.type === 'edit_property' && Array.isArray(cells)) return { kind: 'edit', cells: cells as CellDraft[] }
  return { kind: 'other', raw: action }
}
const toAction = (draft: Draft): api.ButtonActionJson =>
  draft.kind === 'edit' ? { type: 'edit_property', config: { v: 1, cells: draft.cells } } : draft.raw

export function ButtonEditForm({
  workspaceId,
  dataSourceId,
  propertyId,
  columns,
  onSaved,
  onCancel,
}: {
  workspaceId: string
  dataSourceId: string
  propertyId: string
  /** 이 표의 컬럼 — 값을 넣을 수 있는 칸(셀 컬럼)만 고른다. */
  columns: readonly ViewColumn[]
  onSaved: () => void
  onCancel: () => void
}) {
  const [drafts, setDrafts] = useState<readonly Draft[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cellColumns = columns.filter(isCellColumn)

  useEffect(() => {
    let alive = true
    api.readButtonActions(workspaceId, dataSourceId, propertyId).then((read) => {
      if (!alive) return
      if (read.ok) setDrafts(read.value.actions.map(toDraft))
      else setError(read.message)
    })
    return () => {
      alive = false
    }
  }, [workspaceId, dataSourceId, propertyId])

  const update = (index: number, next: Draft | null) =>
    setDrafts((prev) => (prev === null ? prev : next === null ? prev.filter((_, i) => i !== index) : prev.map((d, i) => (i === index ? next : d))))

  const firstFree = (used: readonly CellDraft[]) => cellColumns.find((c) => !used.some((u) => u.propertyId === c.propertyId))

  const save = async () => {
    if (drafts === null) return
    setBusy(true)
    setError(null)
    const saved = await api.saveButtonActions(workspaceId, dataSourceId, propertyId, drafts.map(toAction))
    setBusy(false)
    if (saved.ok) onSaved()
    else setError(saved.message)
  }

  if (drafts === null) {
    return (
      <div className="p-3 text-xs text-neutral-500" data-testid="db-button-editor">
        {error ?? '읽는 중…'}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3 text-xs" data-testid="db-button-editor">
      <p className="font-semibold">버튼을 누르면</p>
      {drafts.length === 0 && <p className="text-neutral-500">아직 할 일이 없습니다.</p>}
      <ol className="flex flex-col gap-2">
        {drafts.map((draft, index) => (
          <li key={index} data-testid="db-button-action" data-kind={draft.kind} className="rounded border border-neutral-200 p-2 dark:border-neutral-700">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium">
                {index + 1}. {draft.kind === 'edit' ? '이 행의 값 바꾸기' : (OTHER_LABEL[draft.raw.type] ?? draft.raw.type)}
              </span>
              <button type="button" data-testid="db-button-action-remove" onClick={() => update(index, null)} className="text-neutral-500 hover:text-red-600">
                지우기
              </button>
            </div>
            {draft.kind === 'other' ? (
              <p className="text-neutral-500">이 편집기에서는 고치지 않습니다 — 저장해도 그대로 남습니다.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {draft.cells.map((cell, c) => {
                  const column = cellColumns.find((col) => col.propertyId === cell.propertyId)
                  return (
                    <div key={c} className="flex items-center gap-1" data-testid="db-button-cell-value">
                      <select
                        aria-label="바꿀 속성"
                        data-testid="db-button-property"
                        value={cell.propertyId}
                        onChange={(e) => {
                          const next = cellColumns.find((col) => col.propertyId === e.target.value)
                          if (next === undefined) return
                          update(index, { kind: 'edit', cells: draft.cells.map((x, i) => (i === c ? { propertyId: next.propertyId, value: emptyValue(next.type as MvpPropertyType) } : x)) })
                        }}
                        className="min-w-0 max-w-[8rem] rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
                      >
                        {column === undefined && <option value={cell.propertyId}>(이 보기에 없는 속성 — 값은 그대로 남는다)</option>}
                        {cellColumns
                          .filter((col) => col.propertyId === cell.propertyId || !draft.cells.some((x) => x.propertyId === col.propertyId))
                          .map((col) => (
                            <option key={col.propertyId} value={col.propertyId}>
                              {col.name}
                            </option>
                          ))}
                      </select>
                      {column !== undefined && (
                        <ValueInput
                          column={column}
                          value={cell.value}
                          onChange={(value) => update(index, { kind: 'edit', cells: draft.cells.map((x, i) => (i === c ? { ...x, value } : x)) })}
                        />
                      )}
                      <button
                        type="button"
                        aria-label="이 값 빼기"
                        onClick={() => update(index, { kind: 'edit', cells: draft.cells.filter((_, i) => i !== c) })}
                        className="px-1 text-neutral-400 hover:text-red-600"
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
                {firstFree(draft.cells) !== undefined && (
                  <button
                    type="button"
                    data-testid="db-button-add-value"
                    onClick={() => {
                      const free = firstFree(draft.cells)
                      if (free !== undefined) update(index, { kind: 'edit', cells: [...draft.cells, { propertyId: free.propertyId, value: emptyValue(free.type as MvpPropertyType) }] })
                    }}
                    className="self-start text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                  >
                    + 값
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {cellColumns.length > 0 && (
        <button
          type="button"
          data-testid="db-button-add-action"
          onClick={() => {
            const first = cellColumns[0]
            setDrafts([...drafts, { kind: 'edit', cells: [{ propertyId: first.propertyId, value: emptyValue(first.type as MvpPropertyType) }] }])
          }}
          className="self-start rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          + 이 행의 값 바꾸기
        </button>
      )}
      {error !== null && (
        <p role="alert" data-testid="db-button-editor-error" className="text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1">
        <button type="button" onClick={onCancel} className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          취소
        </button>
        <button
          type="button"
          data-testid="db-button-save"
          disabled={busy}
          onClick={() => void save()}
          className="rounded bg-neutral-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          저장
        </button>
      </div>
    </div>
  )
}

/** 그 속성 타입의 값 칸 — 숫자 · 체크 · 선택 · 상태 · 글(제목 포함) · 날짜. */
function ValueInput({ column, value, onChange }: { column: ViewColumn; value: CellValue; onChange: (value: CellValue) => void }) {
  const box = 'min-w-0 flex-1 rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900'
  switch (value.type) {
    case 'number':
      return (
        <input
          type="number"
          aria-label={`${column.name} 값`}
          data-testid="db-button-value"
          value={value.number ?? ''}
          onChange={(e) => onChange({ type: 'number', number: e.target.value === '' ? null : Number(e.target.value) })}
          className={box}
        />
      )
    case 'checkbox':
      return (
        <input
          type="checkbox"
          aria-label={`${column.name} 값`}
          data-testid="db-button-value"
          checked={value.checkbox}
          onChange={(e) => onChange({ type: 'checkbox', checkbox: e.target.checked })}
        />
      )
    case 'select':
    case 'status': {
      const current = value.type === 'select' ? value.select : value.status
      const type = value.type
      return (
        <select
          aria-label={`${column.name} 값`}
          data-testid="db-button-value"
          value={current?.id ?? ''}
          onChange={(e) => {
            const ref = e.target.value === '' ? null : { id: e.target.value }
            onChange(type === 'select' ? { type: 'select', select: ref } : { type: 'status', status: ref })
          }}
          className={box}
        >
          <option value="">(비움)</option>
          {column.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )
    }
    case 'title':
    case 'rich_text': {
      const runs = value.type === 'title' ? value.title : value.rich_text
      const type = value.type
      return (
        <input
          type="text"
          aria-label={`${column.name} 값`}
          data-testid="db-button-value"
          value={toPlainText(runs)}
          onChange={(e) => {
            const next = e.target.value === '' ? [] : [textRun(e.target.value)]
            onChange(type === 'title' ? { type: 'title', title: next } : { type: 'rich_text', rich_text: next })
          }}
          className={box}
        />
      )
    }
    case 'date':
      return (
        <input
          type="date"
          aria-label={`${column.name} 값`}
          data-testid="db-button-value"
          value={value.date?.start.slice(0, 10) ?? ''}
          onChange={(e) => onChange({ type: 'date', date: e.target.value === '' ? null : { start: e.target.value } })}
          className={box}
        />
      )
  }
}
