'use client'

/**
 * DB automation 편집기 — 만들기 · 고치기 (자동화 5b-3b · F-08-09)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] DB automation — 화면 ② ⓐ ~ ⓕ
 *   08 *"`New automation` → 트리거 선택(`Page added` / `<Property> edited`) → property 트리거면 조건 지정 → 액션 추가 → 저장. 이름 지정 가능."*
 *
 * 세 부분이다.
 *
 *   - **이름** — 1~100자. 새 자동화는 "새 자동화".
 *   - **트리거** — 1~5개. 행 추가 · 속성 편집(그 표의 스키마의 셀 속성 — 숨긴 속성도). 속성 편집에는 조건을 하나 — 연산자와 값 칸은
 *     보기의 필터와 같은 부품이다(`filter-draft.ts` · `RuleValue`). 값이 필요한 연산자에 값이 없으면 저장하지 않는다.
 *   - **액션** — 버튼 편집기와 같은 부품(`action-editor.tsx`). 값 바꾸기는 **트리거된 행**의 것이다.
 *
 * 판정은 서버에 있다 — 거절은 몇 번째 트리거 · 액션의 무엇인지 말하고(`saveDbAutomation`), 저장하지 못하면 닫히지 않는다. 켜짐은 여기서
 * 바꾸지 않는다(목록의 스위치). 실행 주체는 처음 만든 사람으로 남는다 — 고칠 때 그 이름을 말한다(정본 ⓕ).
 */

import { useState } from 'react'

import type { OperatorCatalogEntry } from '@/lib/database/operator-catalog'
import { isComplete, operatorsOf, ruleFor, withOperator, type FilterRule, type RuleColumn } from '@/lib/database/filter-draft'
import { isMvpPropertyType } from '@/lib/database/property-types'
import * as api from './table-api'
import { ActionListEditor, toAction, toDraft, type ActionDraft } from './action-editor'
import { RuleValue } from './view-toolbar'

/** 트리거는 5개까지(서버 `MAX_TRIGGERS` 와 같다 — 넘으면 서버도 거절한다). */
const MAX_TRIGGERS = 5

type TriggerDraft =
  | { readonly kind: 'page_added' }
  | { readonly kind: 'edited'; readonly propertyId: string; readonly condition: FilterRule | null }

const toTriggerDraft = (t: api.DbAutomationTriggerJson): TriggerDraft =>
  t.type === 'page_added' ? { kind: 'page_added' } : { kind: 'edited', propertyId: t.propertyId, condition: t.condition }
const toTrigger = (d: TriggerDraft): api.DbAutomationTriggerJson =>
  d.kind === 'page_added' ? { type: 'page_added' } : { type: 'property_edited', propertyId: d.propertyId, condition: d.condition }

const FIELD = 'min-w-0 rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900'

export function AutomationEditor({
  workspaceId,
  dataSourceId,
  columns,
  catalog,
  initial,
  onSaved,
  onCancel,
}: {
  workspaceId: string
  dataSourceId: string
  /** 그 표의 스키마(숨긴 속성도) — 트리거는 셀 속성만 고른다. */
  columns: readonly RuleColumn[]
  catalog: readonly OperatorCatalogEntry[]
  /** 고칠 것 — null 이면 새로 만든다. */
  initial: api.DbAutomationJson | null
  onSaved: (automation: api.DbAutomationJson) => void
  onCancel: () => void
}) {
  const fields = columns.filter((c) => isMvpPropertyType(c.type))
  const [name, setName] = useState(initial?.name ?? '새 자동화')
  const [triggers, setTriggers] = useState<readonly TriggerDraft[]>(() => initial?.triggers.map(toTriggerDraft) ?? [{ kind: 'page_added' }])
  const [actions, setActions] = useState<readonly ActionDraft[]>(() => initial?.actions.map(toDraft) ?? [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const updateTrigger = (index: number, next: TriggerDraft | null) =>
    setTriggers((prev) => (next === null ? prev.filter((_, i) => i !== index) : prev.map((t, i) => (i === index ? next : t))))
  const columnOf = (propertyId: string) => fields.find((f) => f.propertyId === propertyId)

  const save = async () => {
    if (name.trim() === '') {
      setError('이름을 넣으세요.')
      return
    }
    // 값이 필요한 연산자에 값이 없다 — 서버도 막지만 어느 칸인지는 여기서 안다(정본 ② ⓒ)
    const incomplete = triggers.findIndex(
      (t) => t.kind === 'edited' && t.condition !== null && !isComplete(t.condition, columnOf(t.propertyId)?.type, catalog),
    )
    if (incomplete >= 0) {
      setError(`${incomplete + 1}번째 트리거: 조건의 값을 넣으세요.`)
      return
    }
    setBusy(true)
    setError(null)
    const saved = await api.saveDbAutomation(workspaceId, dataSourceId, initial?.id ?? null, {
      name: name.trim(),
      triggers: triggers.map(toTrigger),
      actions: actions.map(toAction),
    })
    setBusy(false)
    if (saved.ok) onSaved(saved.value)
    else setError(saved.message)
  }

  return (
    <div data-testid="db-automation-editor" className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto px-2 py-1 text-xs">
      <label className="flex items-center gap-1">
        <span className="w-10 shrink-0 text-neutral-500">이름</span>
        <input
          type="text"
          aria-label="자동화 이름"
          data-testid="db-automation-editor-name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          className={`${FIELD} flex-1`}
        />
      </label>
      <p data-testid="db-automation-editor-actor" className="text-neutral-500">
        {initial === null ? '이 자동화는 내 권한으로 돕니다.' : `실행 주체는 처음 만든 ${initial.createdBy.name === '' ? '떠난 사람' : initial.createdBy.name}(으)로 남습니다.`}
      </p>

      <p className="font-semibold">이럴 때</p>
      <ol className="flex flex-col gap-1">
        {triggers.map((trigger, index) => {
          const column = trigger.kind === 'edited' ? columnOf(trigger.propertyId) : undefined
          const entry =
            trigger.kind === 'edited' && trigger.condition !== null && column !== undefined
              ? catalog.find((e) => e.propertyType === column.type && e.operator === trigger.condition?.operator)
              : undefined
          return (
            <li key={index} data-testid="db-automation-trigger" data-kind={trigger.kind} className="flex flex-wrap items-center gap-1 rounded border border-neutral-200 p-1.5 dark:border-neutral-700">
              <select
                aria-label="트리거"
                data-testid="db-automation-trigger-type"
                value={trigger.kind}
                onChange={(e) =>
                  updateTrigger(
                    index,
                    e.target.value === 'page_added'
                      ? { kind: 'page_added' }
                      : fields.length > 0
                        ? { kind: 'edited', propertyId: fields[0].propertyId, condition: null }
                        : trigger,
                  )
                }
                className={FIELD}
              >
                <option value="page_added">새 항목이 추가되면</option>
                {(fields.length > 0 || trigger.kind === 'edited') && <option value="edited">속성이 바뀌면</option>}
              </select>
              {trigger.kind === 'edited' && (
                <select
                  aria-label="바뀌는 속성"
                  data-testid="db-automation-trigger-property"
                  value={trigger.propertyId}
                  onChange={(e) => updateTrigger(index, { kind: 'edited', propertyId: e.target.value, condition: null })}
                  className={FIELD}
                >
                  {column === undefined && <option value={trigger.propertyId}>지워진 속성</option>}
                  {fields.map((f) => (
                    <option key={f.propertyId} value={f.propertyId}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}
              {trigger.kind === 'edited' && column !== undefined && trigger.condition === null && (
                <button
                  type="button"
                  data-testid="db-automation-condition-add"
                  onClick={() => updateTrigger(index, { ...trigger, condition: ruleFor(trigger.propertyId, column.type, catalog) })}
                  className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                >
                  + 조건
                </button>
              )}
              {trigger.kind === 'edited' && column !== undefined && trigger.condition !== null && (
                <span data-testid="db-automation-condition" className="flex flex-wrap items-center gap-1">
                  <span className="text-neutral-500">— 조건</span>
                  <select
                    aria-label="조건"
                    data-testid="db-automation-condition-operator"
                    value={trigger.condition.operator}
                    onChange={(e) =>
                      trigger.condition !== null &&
                      updateTrigger(index, { ...trigger, condition: withOperator(trigger.condition, e.target.value, column.type, catalog) })
                    }
                    className={FIELD}
                  >
                    {operatorsOf(catalog, column.type).map((o) => (
                      <option key={o.operator} value={o.operator}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {entry?.arity === 1 && (
                    <RuleValue
                      key={trigger.propertyId}
                      column={column}
                      value={trigger.condition.value}
                      disabled={false}
                      onChange={(value) => {
                        const condition = trigger.condition
                        if (condition === null) return
                        updateTrigger(index, {
                          ...trigger,
                          condition: value === undefined ? { property_id: condition.property_id, operator: condition.operator } : { ...condition, value },
                        })
                      }}
                    />
                  )}
                  <button
                    type="button"
                    aria-label="조건 빼기"
                    data-testid="db-automation-condition-remove"
                    onClick={() => updateTrigger(index, { ...trigger, condition: null })}
                    className="px-1 text-neutral-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </span>
              )}
              {triggers.length > 1 && (
                <button
                  type="button"
                  aria-label="이 트리거 빼기"
                  data-testid="db-automation-trigger-remove"
                  onClick={() => updateTrigger(index, null)}
                  className="ml-auto px-1 text-neutral-400 hover:text-red-600"
                >
                  지우기
                </button>
              )}
            </li>
          )
        })}
      </ol>
      {triggers.length > 1 && <p className="text-neutral-500">하나라도 일어나면 실행합니다.</p>}
      {triggers.length < MAX_TRIGGERS && (
        <button
          type="button"
          data-testid="db-automation-add-trigger"
          onClick={() => setTriggers([...triggers, { kind: 'page_added' }])}
          className="self-start text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          + 트리거
        </button>
      )}

      <p className="font-semibold">이렇게 한다</p>
      <ActionListEditor
        workspaceId={workspaceId}
        dataSourceId={dataSourceId}
        drafts={actions}
        onChange={setActions}
        editLabel="트리거된 행의 값 바꾸기"
        rowLabel="트리거된 행"
        testIdPrefix="db-automation"
      />

      {error !== null && (
        <p role="alert" data-testid="db-automation-editor-error" className="text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1">
        <button type="button" data-testid="db-automation-editor-cancel" onClick={onCancel} className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          취소
        </button>
        <button
          type="button"
          data-testid="db-automation-editor-save"
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
