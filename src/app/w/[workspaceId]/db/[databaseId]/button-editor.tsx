'use client'

/**
 * 버튼 설정 — 열 머리 메뉴 안의 편집기 (자동화 5a-3 · 5a-4 · F-03-15 · F-08-07)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑥ ⑨ ⑩ ⑪
 *
 * 고치는 액션은 둘이다.
 *
 *   - **이 행의 값 바꾸기**(`edit_property`) — 속성을 고르고 그 타입의 값을 넣는다(숫자 · 체크 · 선택 · 상태 · 글 · 날짜).
 *   - **다른 표에 행 추가**(`add_page_to`) — 대상 표(이 표도 된다) · 그 표의 템플릿 · 그 표의 값. 템플릿을 고르면 "템플릿이 정한 칸은
 *     템플릿 값이 이긴다"를 한 줄로 알린다(08 — 직관과 반대다).
 *
 * 속성은 보기의 컬럼이 아니라 **그 표의 스키마**에서 고른다(숨긴 속성도 — ⑪). 그 밖의 액션은 요약으로 서고 저장할 때 **그대로 남는다** —
 * 화면이 모르는 액션을 지우지 않는다(지우기 단추로만 지운다). 판정은 서버에 있다 — 저장하면 서버가 대어 보고, 틀리면 몇 번째 액션의
 * 무엇인지 말한다. 메뉴는 구조를 고칠 수 있는 사람에게만 선다(표가 정한다 · 서버가 다시 묻는다).
 */

import { useEffect, useState } from 'react'

import type { PropertySummary } from '@/lib/database/property'
import type { DatabaseListItem } from '@/lib/database/database'
import { emptyValue, isMvpPropertyType, type CellValue, type MvpPropertyType, type SelectOption } from '@/lib/database/property-types'
import { textRun, toPlainText } from '@/lib/contracts/rich-text'
import * as api from './table-api'

type CellDraft = { readonly propertyId: string; readonly value: CellValue }
type Draft =
  | { readonly kind: 'edit'; readonly cells: readonly CellDraft[] }
  | { readonly kind: 'add'; readonly dataSourceId: string; readonly templateId: string | null; readonly cells: readonly CellDraft[] }
  /** 이 편집기가 고치지 않는 액션 — 받은 그대로 다시 보낸다. */
  | { readonly kind: 'other'; readonly raw: api.ButtonActionJson }

/** 값을 넣을 수 있는 속성(셀 타입) — 이름 · 타입 · 선택지. */
type Field = { readonly id: string; readonly name: string; readonly type: MvpPropertyType; readonly options: readonly SelectOption[] }
/** 표 하나의 값 칸 재료 — 속성들과 템플릿들. */
type Table = { readonly fields: readonly Field[]; readonly templates: readonly { readonly id: string; readonly title: string }[] }

const OTHER_LABEL: Record<string, string> = {
  send_webhook: '웹훅 보내기',
  insert_blocks: '블록 넣기',
  define_variables: '변수 정하기',
  show_confirmation: '확인 묻기',
}

const toDraft = (action: api.ButtonActionJson): Draft => {
  const c = action.config
  if (action.type === 'edit_property' && Array.isArray(c.cells)) return { kind: 'edit', cells: c.cells as CellDraft[] }
  if (action.type === 'add_page_to' && typeof c.dataSourceId === 'string' && Array.isArray(c.cells)) {
    return { kind: 'add', dataSourceId: c.dataSourceId, templateId: typeof c.templateId === 'string' ? c.templateId : null, cells: c.cells as CellDraft[] }
  }
  return { kind: 'other', raw: action }
}
const toAction = (draft: Draft): api.ButtonActionJson =>
  draft.kind === 'edit'
    ? { type: 'edit_property', config: { v: 1, cells: draft.cells } }
    : draft.kind === 'add'
      ? { type: 'add_page_to', config: { v: 1, dataSourceId: draft.dataSourceId, cells: draft.cells, templateId: draft.templateId } }
      : draft.raw

const fieldsOf = (properties: readonly PropertySummary[]): Field[] =>
  properties.flatMap((p) => (isMvpPropertyType(p.type) ? [{ id: p.id, name: p.name, type: p.type, options: p.options ?? [] }] : []))

export function ButtonEditForm({
  workspaceId,
  dataSourceId,
  propertyId,
  onSaved,
  onCancel,
}: {
  workspaceId: string
  dataSourceId: string
  propertyId: string
  onSaved: () => void
  onCancel: () => void
}) {
  const [drafts, setDrafts] = useState<readonly Draft[] | null>(null)
  const [databases, setDatabases] = useState<readonly DatabaseListItem[]>([])
  /** 표마다의 값 칸 재료 — 처음 고를 때 읽어 둔다. */
  const [tables, setTables] = useState<Readonly<Record<string, Table>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadTable = (id: string) => {
    if (tables[id] !== undefined) return
    void Promise.all([api.readProperties(workspaceId, id), api.listTemplates(workspaceId, id)]).then(([props, templates]) => {
      setTables((prev) => ({
        ...prev,
        [id]: {
          fields: props.ok ? fieldsOf(props.value) : [],
          templates: templates.ok ? templates.value.map((t) => ({ id: t.id, title: t.title })) : [],
        },
      }))
    })
  }

  useEffect(() => {
    let alive = true
    void Promise.all([
      api.readButtonActions(workspaceId, dataSourceId, propertyId),
      api.readProperties(workspaceId, dataSourceId),
      api.listTemplates(workspaceId, dataSourceId),
      api.listDatabases(workspaceId),
    ]).then(([read, props, templates, dbs]) => {
      if (!alive) return
      if (!read.ok || !props.ok) {
        setError(!read.ok ? read.message : !props.ok ? props.message : null)
        return
      }
      const next = read.value.actions.map(toDraft)
      const own: Table = { fields: fieldsOf(props.value), templates: templates.ok ? templates.value.map((t) => ({ id: t.id, title: t.title })) : [] }
      setTables({ [dataSourceId]: own })
      setDatabases(dbs.ok ? dbs.value : [])
      setDrafts(next)
      // 저장돼 있던 다른 표의 재료도 읽어 둔다
      for (const d of next) {
        if (d.kind === 'add' && d.dataSourceId !== dataSourceId) {
          void Promise.all([api.readProperties(workspaceId, d.dataSourceId), api.listTemplates(workspaceId, d.dataSourceId)]).then(([p, t]) => {
            if (!alive) return
            setTables((prev) => ({
              ...prev,
              [d.dataSourceId]: { fields: p.ok ? fieldsOf(p.value) : [], templates: t.ok ? t.value.map((x) => ({ id: x.id, title: x.title })) : [] },
            }))
          })
        }
      }
    })
    return () => {
      alive = false
    }
  }, [workspaceId, dataSourceId, propertyId])

  const update = (index: number, next: Draft | null) =>
    setDrafts((prev) => (prev === null ? prev : next === null ? prev.filter((_, i) => i !== index) : prev.map((d, i) => (i === index ? next : d))))

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
  const own = tables[dataSourceId]?.fields ?? []

  return (
    <div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto p-3 text-xs" data-testid="db-button-editor">
      <p className="font-semibold">버튼을 누르면</p>
      {drafts.length === 0 && <p className="text-neutral-500">아직 할 일이 없습니다.</p>}
      <ol className="flex flex-col gap-2">
        {drafts.map((draft, index) => (
          <li key={index} data-testid="db-button-action" data-kind={draft.kind} className="rounded border border-neutral-200 p-2 dark:border-neutral-700">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium">
                {index + 1}. {draft.kind === 'edit' ? '이 행의 값 바꾸기' : draft.kind === 'add' ? '다른 표에 행 추가' : (OTHER_LABEL[draft.raw.type] ?? draft.raw.type)}
              </span>
              <button type="button" data-testid="db-button-action-remove" onClick={() => update(index, null)} className="text-neutral-500 hover:text-red-600">
                지우기
              </button>
            </div>
            {draft.kind === 'other' && <p className="text-neutral-500">이 편집기에서는 고치지 않습니다 — 저장해도 그대로 남습니다.</p>}
            {draft.kind === 'edit' && (
              <Cells fields={own} cells={draft.cells} require onChange={(cells) => update(index, { ...draft, cells })} />
            )}
            {draft.kind === 'add' && (
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-1">
                  <span className="w-10 shrink-0 text-neutral-500">표</span>
                  <select
                    aria-label="행을 더할 표"
                    data-testid="db-button-target"
                    value={draft.dataSourceId}
                    onChange={(e) => {
                      loadTable(e.target.value)
                      update(index, { kind: 'add', dataSourceId: e.target.value, templateId: null, cells: [] })
                    }}
                    className="min-w-0 flex-1 rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    {!databases.some((d) => d.dataSourceId === draft.dataSourceId) && (
                      <option value={draft.dataSourceId}>{draft.dataSourceId === dataSourceId ? '이 표' : '(볼 수 없는 표)'}</option>
                    )}
                    {databases.map((d) => (
                      <option key={d.dataSourceId} value={d.dataSourceId}>
                        {d.dataSourceId === dataSourceId ? `이 표 — ${d.name}` : d.sourceName === null ? d.name : `${d.name} · ${d.sourceName}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <span className="w-10 shrink-0 text-neutral-500">템플릿</span>
                  <select
                    aria-label="새 행의 템플릿"
                    data-testid="db-button-template"
                    value={draft.templateId ?? ''}
                    onChange={(e) => update(index, { ...draft, templateId: e.target.value === '' ? null : e.target.value })}
                    className="min-w-0 flex-1 rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    <option value="">(템플릿 없음)</option>
                    {(tables[draft.dataSourceId]?.templates ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title || '제목 없음'}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.templateId !== null && (
                  <p data-testid="db-button-template-note" className="text-amber-700 dark:text-amber-400">
                    템플릿이 정한 칸은 템플릿 값이 이깁니다 — 아래 값은 템플릿이 비운 칸에만 들어갑니다.
                  </p>
                )}
                <Cells
                  fields={tables[draft.dataSourceId]?.fields ?? []}
                  cells={draft.cells}
                  require={false}
                  onChange={(cells) => update(index, { ...draft, cells })}
                />
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-1">
        {own.length > 0 && (
          <button
            type="button"
            data-testid="db-button-add-action"
            onClick={() => setDrafts([...drafts, { kind: 'edit', cells: [{ propertyId: own[0].id, value: emptyValue(own[0].type) }] }])}
            className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            + 이 행의 값 바꾸기
          </button>
        )}
        <button
          type="button"
          data-testid="db-button-add-row-action"
          onClick={() => setDrafts([...drafts, { kind: 'add', dataSourceId, templateId: null, cells: [] }])}
          className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          + 다른 표에 행 추가
        </button>
      </div>
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

/** 값 목록 — 속성 고르기 + 그 타입의 값 칸. `require` 면 마지막 하나는 뺄 수 없다(값 바꾸기는 값이 하나 이상). */
function Cells({
  fields,
  cells,
  require,
  onChange,
}: {
  fields: readonly Field[]
  cells: readonly CellDraft[]
  require: boolean
  onChange: (cells: readonly CellDraft[]) => void
}) {
  const free = fields.find((f) => !cells.some((c) => c.propertyId === f.id))
  return (
    <div className="flex flex-col gap-1">
      {cells.map((cell, c) => {
        const field = fields.find((f) => f.id === cell.propertyId)
        return (
          <div key={c} className="flex items-center gap-1" data-testid="db-button-cell-value">
            <select
              aria-label="값을 넣을 속성"
              data-testid="db-button-property"
              value={cell.propertyId}
              onChange={(e) => {
                const next = fields.find((f) => f.id === e.target.value)
                if (next !== undefined) onChange(cells.map((x, i) => (i === c ? { propertyId: next.id, value: emptyValue(next.type) } : x)))
              }}
              className="min-w-0 max-w-[8rem] rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
            >
              {field === undefined && <option value={cell.propertyId}>(없는 속성)</option>}
              {fields
                .filter((f) => f.id === cell.propertyId || !cells.some((x) => x.propertyId === f.id))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
            {field !== undefined && (
              <ValueInput field={field} value={cell.value} onChange={(value) => onChange(cells.map((x, i) => (i === c ? { ...x, value } : x)))} />
            )}
            {(!require || cells.length > 1) && (
              <button type="button" aria-label="이 값 빼기" onClick={() => onChange(cells.filter((_, i) => i !== c))} className="px-1 text-neutral-400 hover:text-red-600">
                ×
              </button>
            )}
          </div>
        )
      })}
      {free !== undefined && (
        <button
          type="button"
          data-testid="db-button-add-value"
          onClick={() => onChange([...cells, { propertyId: free.id, value: emptyValue(free.type) }])}
          className="self-start text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          + 값
        </button>
      )}
    </div>
  )
}

/** 그 속성 타입의 값 칸 — 숫자 · 체크 · 선택 · 상태 · 글(제목 포함) · 날짜. */
function ValueInput({ field, value, onChange }: { field: Field; value: CellValue; onChange: (value: CellValue) => void }) {
  const box = 'min-w-0 flex-1 rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900'
  const label = `${field.name} 값`
  switch (value.type) {
    case 'number':
      return (
        <input
          type="number"
          aria-label={label}
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
          aria-label={label}
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
          aria-label={label}
          data-testid="db-button-value"
          value={current?.id ?? ''}
          onChange={(e) => {
            const ref = e.target.value === '' ? null : { id: e.target.value }
            onChange(type === 'select' ? { type: 'select', select: ref } : { type: 'status', status: ref })
          }}
          className={box}
        >
          <option value="">(비움)</option>
          {field.options.map((o) => (
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
          aria-label={label}
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
          aria-label={label}
          data-testid="db-button-value"
          value={value.date?.start.slice(0, 10) ?? ''}
          onChange={(e) => onChange({ type: 'date', date: e.target.value === '' ? null : { start: e.target.value } })}
          className={box}
        />
      )
  }
}
