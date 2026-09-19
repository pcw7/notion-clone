'use client'

/**
 * 뷰 도구줄 — 필터 · 정렬 · 속성 (F-04-09 · F-04-10 · F-04-12)
 *
 * 규칙은 `filter-draft.ts` 에 있다. 이 파일은 패널을 그리고 저장을 부른다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 뷰 설정은 공유 상태다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 저장하면 같은 뷰를 연 모두의 행 집합이 바뀐다(F-03-17). 그래서 고치는 컨트롤은
 * `edit_structure` 가 있을 때만 그리고, 없는 사람에게도 **걸려 있는 조건은 칩으로
 * 보여준다** — 행이 왜 적게 보이는지 알 수 없는 표가 가장 나쁘다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 저장한 뒤 표를 새로 그린다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 필터 · 정렬이 바뀌면 이미 불러온 행과 커서가 전부 무효다(F-04-15: "필터 변경 →
 * 기존 커서 폐기, 재쿼리"). 서버 렌더를 다시 받고, 표는 필터·정렬을 담은 key 로
 * 새로 마운트된다(`page.tsx`). 이어 붙이면 옛 순서의 행과 새 순서의 행이 섞인다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 패널이 열려 있는 동안은 초안이 진실이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 열 때 서버 값을 복사하고, 그 뒤로는 초안을 고쳐 저장한다. 저장 뒤에 오는 서버
 * 렌더로 초안을 덮어쓰면 아직 값을 넣지 않은(그래서 저장되지 않은) 규칙이 사라진다.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { parseDraft } from '@/lib/database/cell-format'
import { MAX_SORT_KEYS, type FilterNode, type SortKey } from '@/lib/database/filter'
import {
  addSort,
  describeRule,
  isComplete,
  moveSort,
  operatorsOf,
  readRules,
  ruleFor,
  toFilter,
  withOperator,
  type FilterRule,
} from '@/lib/database/filter-draft'
import type { GroupBy } from '@/lib/database/group'
import type { OperatorCatalogEntry } from '@/lib/database/operator-catalog'
import { isGroupableType, isOptionType, type MvpPropertyType } from '@/lib/database/property-types'
import type { ViewColumn } from '@/lib/database/view'
import { setColumnVisible, updateView, type ApiResult } from './table-api'
import { TYPE_ICON } from './cell-view'

type Panel = 'filter' | 'sort' | 'properties' | 'group'

/**
 * 보드의 그룹 설정(보드 4b조각). 보드 뷰일 때만 온다 — "그룹" 버튼과 패널이 그때만 그려진다.
 *
 * `groups` 는 서버가 읽은 그룹 전부(숨긴 것 포함 · 카운트)다. 패널은 초안을 두지 않는다 — 고르는 즉시 저장하고 서버
 * 렌더를 다시 받는다(보드가 `groupBy` 를 담은 key 로 새로 마운트된다).
 */
export type BoardSettings = {
  readonly groupBy: GroupBy | null
  readonly groups: readonly {
    readonly key: string
    readonly label: string
    readonly count: number
    readonly hidden: boolean
  }[]
}

const FIELD =
  'rounded border border-neutral-300 bg-transparent px-1.5 py-1 text-sm disabled:opacity-60 dark:border-neutral-700'

/**
 * 정렬할 수 있는 컬럼.
 *
 * ⚠ select 를 뺀다. 지금의 컴파일러는 select 를 사이드카(`text_value` = **옵션 id**)로
 *   정렬해서 사용자에게는 아무 규칙 없는 순서로 보인다. F-04-10 이 요구하는 것은
 *   **옵션 정의 순서**(`select_option.order_idx` 조인)이고 그것이 들어올 때 연다.
 *   status 도 같은 사이드카라 같이 뺀다(`OPTION_TYPES`).
 */
export function isSortable(column: Pick<ViewColumn, 'type'>): boolean {
  return !isOptionType(column.type)
}

export function ViewToolbar({
  workspaceId,
  viewId,
  columns,
  filter,
  sorts,
  catalog,
  canEdit,
  board,
}: {
  workspaceId: string
  viewId: string
  /** 숨긴 컬럼도 포함한 뷰의 컬럼 전부. 숨긴 컬럼으로도 거르고 정렬할 수 있다. */
  columns: ViewColumn[]
  filter: FilterNode | null
  /** 지워진 속성의 키를 뺀 정렬(`liveSorts`). */
  sorts: SortKey[]
  catalog: OperatorCatalogEntry[]
  canEdit: boolean
  /** 보드 뷰의 그룹 설정. 표에는 없다. */
  board?: BoardSettings
}) {
  const router = useRouter()
  const [panel, setPanel] = useState<Panel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const types = useMemo(
    () => new Map<string, MvpPropertyType>(columns.map((c) => [c.propertyId, c.type])),
    [columns],
  )
  const read = readRules(filter)
  const hidden = columns.filter((c) => !c.visible).length

  const run = async (request: () => Promise<ApiResult<null>>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    const result = await request()
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return false
    }
    router.refresh()
    return true
  }

  const toggle = (next: Panel) => {
    setError(null)
    setPanel((current) => (current === next ? null : next))
  }

  const filterChips =
    filter === null
      ? []
      : read.editable
        ? read.rules.map((rule) =>
            describeRule(rule, columns.find((c) => c.propertyId === rule.property_id), catalog),
          )
        : ['고급 필터 (여기서 고칠 수 없음)']

  return (
    <div className="flex flex-col gap-2" data-testid="db-toolbar">
      <div className="relative flex flex-wrap items-center gap-1 text-sm">
        <ToolbarButton label="필터" count={filterChips.length} active={panel === 'filter'} testId="db-filter-button" onClick={() => toggle('filter')} />
        <ToolbarButton label="정렬" count={sorts.length} active={panel === 'sort'} testId="db-sort-button" onClick={() => toggle('sort')} />
        {canEdit && (
          <ToolbarButton label="속성" count={hidden} active={panel === 'properties'} testId="db-properties-button" onClick={() => toggle('properties')} />
        )}
        {board !== undefined && (
          <ToolbarButton
            label="그룹"
            count={board.groups.filter((g) => g.hidden).length}
            active={panel === 'group'}
            testId="db-group-button"
            onClick={() => toggle('group')}
          />
        )}
        {busy && <span className="text-xs text-neutral-400">저장하는 중…</span>}

        {panel === 'filter' && (
          <FilterPanel
            columns={columns}
            catalog={catalog}
            filter={filter}
            types={types}
            canEdit={canEdit}
            onSave={(next) => run(() => updateView(workspaceId, viewId, { filter: next }))}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'sort' && (
          <SortPanel
            columns={columns.filter(isSortable)}
            sorts={sorts}
            canEdit={canEdit}
            onSave={(next) => run(() => updateView(workspaceId, viewId, { sorts: next }))}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'properties' && canEdit && (
          <PropertiesPanel
            columns={columns}
            busy={busy}
            onToggle={(propertyId, visible) => run(() => setColumnVisible(workspaceId, viewId, propertyId, visible))}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'group' && board !== undefined && (
          <GroupPanel
            columns={columns}
            board={board}
            canEdit={canEdit}
            busy={busy}
            onSave={(next) => run(() => updateView(workspaceId, viewId, { groupBy: next }))}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      {(filterChips.length > 0 || sorts.length > 0) && (
        <ul aria-label="걸린 조건" data-testid="db-conditions" className="flex flex-wrap gap-1 text-xs">
          {filterChips.map((text, i) => (
            <li key={`f${i}`} data-testid="db-filter-chip" className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-800 dark:bg-blue-950 dark:text-blue-200">
              {text}
            </li>
          ))}
          {sorts.map((sort) => (
            <li key={`s${sort.property_id}`} data-testid="db-sort-chip" className="rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-neutral-800">
              {columns.find((c) => c.propertyId === sort.property_id)?.name} {sort.direction === 'asc' ? '↑' : '↓'}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" data-testid="db-toolbar-error" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

function ToolbarButton({
  label,
  count,
  active,
  testId,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  testId: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-expanded={active}
      onClick={onClick}
      className={`rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
        count > 0 ? 'text-blue-700 dark:text-blue-300' : 'text-neutral-500'
      }`}
    >
      {label}
      {count > 0 && <span className="ml-1 text-xs">{count}</span>}
    </button>
  )
}

function Popover({
  label,
  testId,
  onClose,
  children,
}: {
  label: string
  testId: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      role="dialog"
      aria-label={label}
      data-testid={testId}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onClose()
        }
      }}
      className="absolute left-0 top-full z-30 mt-1 flex w-[36rem] max-w-[90vw] flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    >
      {children}
    </div>
  )
}

// ── 필터 ──────────────────────────────────────────────────────────────

/** 규칙 줄의 안정 키. 인덱스를 키로 쓰면 규칙을 지울 때 값 입력칸의 초안이 옆 줄로 옮겨 간다. */
let rowSeq = 0
type Row = { readonly key: number; readonly rule: FilterRule }
const toRow = (rule: FilterRule): Row => ({ key: (rowSeq += 1), rule })

function FilterPanel({
  columns,
  catalog,
  filter,
  types,
  canEdit,
  onSave,
  onClose,
}: {
  columns: ViewColumn[]
  catalog: OperatorCatalogEntry[]
  filter: FilterNode | null
  types: ReadonlyMap<string, MvpPropertyType>
  canEdit: boolean
  onSave: (next: FilterNode | null) => Promise<boolean>
  onClose: () => void
}) {
  // 열 때 한 번 읽는다(머리말: 패널이 열려 있는 동안은 초안이 진실이다).
  const [initial] = useState(() => readRules(filter))
  const [rows, setRows] = useState<Row[]>(() => (initial.editable ? initial.rules.map(toRow) : []))
  /** 마지막으로 저장한 필터(직렬화). 같으면 보내지 않는다 — 뷰 설정 저장마다 모두의 표가 다시 읽힌다. */
  const saved = useRef<string | null>(null)

  if (!initial.editable) {
    return (
      <Popover label="필터" testId="db-filter-panel" onClose={onClose}>
        <p className="text-sm text-neutral-600 dark:text-neutral-300" data-testid="db-filter-not-editable">
          이 뷰의 필터에는 OR 조건이나 묶음이 있어 여기서 고칠 수 없습니다. 이 화면은 모든 조건을 함께 만족하는(AND)
          규칙만 다룹니다.
        </p>
        {canEdit && (
          <button
            type="button"
            data-testid="db-filter-clear"
            onClick={() => void onSave(null).then((ok) => ok && onClose())}
            className="self-start rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700"
          >
            필터 지우기
          </button>
        )}
      </Popover>
    )
  }

  const commit = (next: Row[]) => {
    setRows(next)
    const tree = toFilter(
      next.map((r) => r.rule),
      types,
      catalog,
    )
    const key = JSON.stringify(tree)
    const previous = saved.current ?? JSON.stringify(toFilter(initial.rules, types, catalog))
    if (key === previous) return
    saved.current = key
    void onSave(tree).then((ok) => {
      // 저장이 거부되면 "보냈다"는 기록을 되돌린다. 안 그러면 같은 초안을 다시 보낼 수 없다.
      if (!ok) saved.current = previous
    })
  }

  return (
    <Popover label="필터" testId="db-filter-panel" onClose={onClose}>
      {rows.length === 0 && <p className="text-sm text-neutral-400">걸린 필터가 없습니다.</p>}

      <ul className="flex flex-col gap-2">
        {rows.map(({ key, rule }) => {
          const column = columns.find((c) => c.propertyId === rule.property_id)
          const entry = column
            ? catalog.find((e) => e.propertyType === column.type && e.operator === rule.operator)
            : undefined
          const replace = (next: FilterRule) => commit(rows.map((r) => (r.key === key ? { key, rule: next } : r)))
          return (
            <li key={key} data-testid="db-filter-rule" className="flex flex-wrap items-center gap-1">
              <select
                aria-label="필터 속성"
                value={rule.property_id}
                disabled={!canEdit}
                onChange={(e) => {
                  const picked = columns.find((c) => c.propertyId === e.target.value)
                  if (picked) replace(ruleFor(picked.propertyId, picked.type, catalog))
                }}
                className={FIELD}
              >
                {column === undefined && <option value={rule.property_id}>지워진 속성</option>}
                {columns.map((c) => (
                  <option key={c.propertyId} value={c.propertyId}>
                    {c.name}
                  </option>
                ))}
              </select>

              {column === undefined ? (
                // F-03-17: 지워진 속성의 규칙은 "비활성 표시하고 무시".
                <span className="text-xs text-neutral-400">무시됨</span>
              ) : (
                <>
                  <select
                    aria-label="필터 조건"
                    value={rule.operator}
                    disabled={!canEdit}
                    onChange={(e) => replace(withOperator(rule, e.target.value, column.type, catalog))}
                    className={FIELD}
                  >
                    {/* 연산자는 카탈로그에서 온다 — 코드에 박지 않는다(F-03-17). */}
                    {operatorsOf(catalog, column.type).map((o) => (
                      <option key={o.operator} value={o.operator}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {entry?.arity === 1 && (
                    <RuleValue
                      key={rule.property_id}
                      column={column}
                      value={rule.value}
                      disabled={!canEdit}
                      onChange={(value) =>
                        replace(
                          value === undefined
                            ? { property_id: rule.property_id, operator: rule.operator }
                            : { ...rule, value },
                        )
                      }
                    />
                  )}
                  {!isComplete(rule, column.type, catalog) && (
                    <span className="text-xs text-neutral-400">값을 넣으면 적용됩니다</span>
                  )}
                </>
              )}

              {canEdit && (
                <button
                  type="button"
                  aria-label="필터 규칙 삭제"
                  data-testid="db-filter-remove"
                  onClick={() => commit(rows.filter((r) => r.key !== key))}
                  className="px-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                  ×
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {canEdit && columns.length > 0 && (
        <button
          type="button"
          data-testid="db-filter-add"
          onClick={() => commit([...rows, toRow(ruleFor(columns[0].propertyId, columns[0].type, catalog))])}
          className="self-start rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          + 필터 추가
        </button>
      )}
    </Popover>
  )
}

function RuleValue({
  column,
  value,
  disabled,
  onChange,
}: {
  column: ViewColumn
  value: unknown
  disabled: boolean
  /** `undefined` 는 "값 없음"이다 — 그 규칙은 저장 트리에서 빠진다. */
  onChange: (value: unknown) => void
}) {
  switch (column.type) {
    case 'select':
    case 'status':
      return (
        <select
          aria-label="필터 값"
          data-testid="db-filter-value"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          className={FIELD}
        >
          <option value="">옵션 선택…</option>
          {typeof value === 'string' && value !== '' && !column.options.some((o) => o.id === value) && (
            <option value={value}>지워진 옵션</option>
          )}
          {column.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )
    case 'checkbox':
      return (
        <select
          aria-label="필터 값"
          data-testid="db-filter-value"
          value={value === false || value === 'false' ? 'false' : 'true'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === 'true')}
          className={FIELD}
        >
          <option value="true">체크됨</option>
          <option value="false">체크 안 됨</option>
        </select>
      )
    case 'date':
      return (
        <input
          type="date"
          aria-label="필터 값"
          data-testid="db-filter-value"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          className={FIELD}
        />
      )
    case 'number':
      return (
        <DraftInput
          initial={typeof value === 'number' ? String(value) : ''}
          disabled={disabled}
          inputMode="decimal"
          // 셀 편집과 같은 규칙으로 읽는다(`parseDraft`) — 칸에 넣을 수 없는 숫자로 거르지 않는다.
          parse={(text) => {
            const parsed = parseDraft('number', text, { type: 'number', number: null })
            if (!parsed.ok) return parsed
            return {
              ok: true,
              value: parsed.value.type === 'number' && parsed.value.number !== null ? parsed.value.number : undefined,
            }
          }}
          onChange={onChange}
        />
      )
    default:
      return (
        <DraftInput
          initial={typeof value === 'string' ? value : ''}
          disabled={disabled}
          parse={(text) => ({ ok: true, value: text === '' ? undefined : text })}
          onChange={onChange}
        />
      )
  }
}

/**
 * 글자를 치는 값 칸. **Enter 와 blur 에서만** 반영한다.
 *
 * 타이핑마다 반영하면 글자마다 뷰 설정이 저장되고, 저장마다 같은 뷰를 연 모두의 표가
 * 다시 읽힌다(공유 상태다).
 */
function DraftInput({
  initial,
  disabled,
  inputMode,
  parse,
  onChange,
}: {
  initial: string
  disabled: boolean
  inputMode?: 'decimal'
  parse: (text: string) => { ok: true; value: unknown } | { ok: false; message: string }
  onChange: (value: unknown) => void
}) {
  const [text, setText] = useState(initial)
  const [message, setMessage] = useState<string | null>(null)

  const commit = () => {
    const parsed = parse(text)
    if (!parsed.ok) {
      setMessage(parsed.message)
      return
    }
    setMessage(null)
    onChange(parsed.value)
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        aria-label="필터 값"
        data-testid="db-filter-value"
        value={text}
        disabled={disabled}
        inputMode={inputMode}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        className={FIELD}
      />
      {message && (
        <span role="alert" className="text-xs text-red-600">
          {message}
        </span>
      )}
    </span>
  )
}

// ── 정렬 ──────────────────────────────────────────────────────────────

function SortPanel({
  columns,
  sorts,
  canEdit,
  onSave,
  onClose,
}: {
  /** 정렬할 수 있는 컬럼만(`isSortable`). */
  columns: ViewColumn[]
  sorts: SortKey[]
  canEdit: boolean
  onSave: (next: SortKey[]) => Promise<boolean>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<SortKey[]>(sorts)
  const commit = (next: SortKey[]) => {
    setDraft(next)
    void onSave(next)
  }
  const used = new Set(draft.map((s) => s.property_id))
  const unused = columns.filter((c) => !used.has(c.propertyId))

  return (
    <Popover label="정렬" testId="db-sort-panel" onClose={onClose}>
      {draft.length === 0 && <p className="text-sm text-neutral-400">정렬이 없습니다. 행은 만든 순서로 보입니다.</p>}

      <ol className="flex flex-col gap-2">
        {draft.map((sort, i) => (
          <li key={sort.property_id} data-testid="db-sort-rule" className="flex flex-wrap items-center gap-1">
            <span className="w-4 text-xs text-neutral-400">{i + 1}</span>
            <select
              aria-label="정렬 속성"
              value={sort.property_id}
              disabled={!canEdit}
              onChange={(e) => commit(draft.map((s, j) => (j === i ? { ...s, property_id: e.target.value } : s)))}
              className={FIELD}
            >
              {/* 이미 다른 키가 쓴 속성은 고를 수 없다 — 서버가 거부하고, 두 번째 키는 아무 일도 안 한다. */}
              {columns
                .filter((c) => c.propertyId === sort.property_id || !used.has(c.propertyId))
                .map((c) => (
                  <option key={c.propertyId} value={c.propertyId}>
                    {c.name}
                  </option>
                ))}
            </select>
            <select
              aria-label="정렬 방향"
              value={sort.direction}
              disabled={!canEdit}
              onChange={(e) =>
                commit(draft.map((s, j) => (j === i ? { ...s, direction: e.target.value as SortKey['direction'] } : s)))
              }
              className={FIELD}
            >
              <option value="asc">오름차순</option>
              <option value="desc">내림차순</option>
            </select>
            {canEdit && (
              <>
                <button type="button" aria-label="우선순위 올리기" disabled={i === 0} onClick={() => commit(moveSort(draft, i, -1))} className="px-1 text-neutral-400 disabled:opacity-30">
                  ↑
                </button>
                <button type="button" aria-label="우선순위 내리기" disabled={i === draft.length - 1} onClick={() => commit(moveSort(draft, i, 1))} className="px-1 text-neutral-400 disabled:opacity-30">
                  ↓
                </button>
                <button type="button" aria-label="정렬 삭제" data-testid="db-sort-remove" onClick={() => commit(draft.filter((_, j) => j !== i))} className="px-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
                  ×
                </button>
              </>
            )}
          </li>
        ))}
      </ol>

      {canEdit && draft.length < MAX_SORT_KEYS && unused.length > 0 && (
        <button
          type="button"
          data-testid="db-sort-add"
          onClick={() => commit(addSort(draft, unused[0].propertyId))}
          className="self-start rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          + 정렬 추가
        </button>
      )}
      {draft.length >= MAX_SORT_KEYS && (
        <p className="text-xs text-neutral-400">정렬은 {MAX_SORT_KEYS}개까지입니다.</p>
      )}
    </Popover>
  )
}

// ── 그룹 (보드) ───────────────────────────────────────────────────────

/**
 * 그룹 기준 · 빈 그룹 숨김 · 그룹별 보이기 (F-04-11 · F-04-03).
 *
 * 고르는 즉시 저장한다(초안 없음) — 필터 패널과 달리 "값을 아직 안 넣은 규칙"이 없다. 그룹 기준을 바꾸면 숨긴 그룹
 * 목록은 버린다(키 공간이 다르다) — `hide_empty` 는 속성과 무관하므로 남긴다. 그룹 설정은 `edit_structure` 다(F-04-03
 * 의 분리) — 없는 사람에게는 잠긴 채로 보여 준다.
 */
function GroupPanel({
  columns,
  board,
  canEdit,
  busy,
  onSave,
  onClose,
}: {
  columns: ViewColumn[]
  board: BoardSettings
  canEdit: boolean
  busy: boolean
  onSave: (next: GroupBy) => Promise<boolean>
  onClose: () => void
}) {
  const groupable = columns.filter((c) => isGroupableType(c.type))
  const current = board.groupBy
  const dead = current !== null && !groupable.some((c) => c.propertyId === current.property_id)
  const locked = !canEdit || busy

  const toggleHidden = (key: string, hidden: boolean) => {
    if (current === null) return
    const next = new Set(current.hidden ?? [])
    if (hidden) next.add(key)
    else next.delete(key)
    void onSave({ ...current, hidden: [...next] })
  }

  return (
    <Popover label="그룹" testId="db-group-panel" onClose={onClose}>
      <label className="flex items-center gap-2 text-sm">
        그룹 기준
        <select
          aria-label="그룹 기준"
          data-testid="db-group-property"
          value={current?.property_id ?? ''}
          disabled={locked}
          onChange={(e) => {
            if (e.target.value === '') return
            void onSave({ property_id: e.target.value, ...(current?.hide_empty ? { hide_empty: true } : {}) })
          }}
          className={FIELD}
        >
          {current === null && <option value="">속성을 고르세요…</option>}
          {dead && <option value={current.property_id}>지워진 속성</option>}
          {groupable.map((c) => (
            <option key={c.propertyId} value={c.propertyId}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {groupable.length === 0 && (
        <p className="text-sm text-neutral-400" data-testid="db-group-none">
          선택 · 상태 · 체크박스 속성이 없습니다. 속성을 먼저 만드세요.
        </p>
      )}

      {current !== null && !dead && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="db-group-hide-empty"
              checked={current.hide_empty === true}
              disabled={locked}
              onChange={(e) => void onSave({ ...current, hide_empty: e.target.checked })}
            />
            빈 그룹 숨기기
          </label>
          <ul aria-label="그룹 표시" className="flex flex-col gap-1">
            {board.groups.map((g) => (
              <li key={g.key}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-testid="db-group-visible"
                    data-group-key={g.key}
                    checked={!g.hidden}
                    disabled={locked}
                    onChange={(e) => toggleHidden(g.key, !e.target.checked)}
                  />
                  {g.label}
                  <span className="text-xs tabular-nums text-neutral-400">{g.count}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </Popover>
  )
}

// ── 속성(표시) ────────────────────────────────────────────────────────

function PropertiesPanel({
  columns,
  busy,
  onToggle,
  onClose,
}: {
  columns: ViewColumn[]
  busy: boolean
  onToggle: (propertyId: string, visible: boolean) => Promise<boolean>
  onClose: () => void
}) {
  return (
    <Popover label="속성" testId="db-properties-panel" onClose={onClose}>
      <ul className="flex flex-col gap-1">
        {columns.map((column) => (
          <li key={column.propertyId}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={column.visible}
                // 제목은 숨길 수 없다(F-04-12). 서버도 막는다(`title_required`).
                disabled={busy || column.type === 'title'}
                onChange={(e) => void onToggle(column.propertyId, e.target.checked)}
                data-testid="db-property-toggle"
                data-property-id={column.propertyId}
              />
              <span aria-hidden className="w-5 text-neutral-400">
                {TYPE_ICON[column.type]}
              </span>
              {column.name}
              {column.type === 'title' && <span className="text-xs text-neutral-400">항상 보임</span>}
            </label>
          </li>
        ))}
      </ul>
    </Popover>
  )
}
