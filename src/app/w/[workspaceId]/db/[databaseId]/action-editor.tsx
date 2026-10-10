'use client'

/**
 * 액션 편집 — 버튼 설정 · DB automation 편집기가 함께 쓰는 부품 (자동화 5a-3 · 5a-4 · 5b-3b · 5c-3a · F-08-07 · F-08-09 · F-08-13)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑥ ⑨ ⑩ ⑪ ⑭ · DB automation — 화면 ② ⓓ
 *
 * 고치는 액션은 셋이다.
 *
 *   - **값 바꾸기**(`edit_property`) — 일하는 행(버튼은 누른 행 · DB automation 은 트리거된 행)의 속성을 고르고 그 타입의 값을 넣는다
 *     (숫자 · 체크 · 선택 · 상태 · 글 · 날짜).
 *   - **다른 표에 행 추가**(`add_page_to`) — 대상 표(이 표도 된다) · 그 표의 템플릿 · 그 표의 값. 템플릿을 고르면 "템플릿이 정한 칸은
 *     템플릿 값이 이긴다"를 한 줄로 알린다(08 — 직관과 반대다).
 *   값 칸 옆에서 **출처**를 고른다(⑯) — 값(고정) · 지금(날짜일 때) · 일하는 행의 ‹속성›(같은 타입 · 선택지 제외 — 서버의 저장 검사와 같은 규칙).
 *   - **웹훅 보내기**(`send_webhook` · ⑭) — 받는 주소 · 헤더 · 보낼 속성. 서버는 저장된 주소 · 헤더 값을 주지 않는다(봉인 · ⑫) — 힌트만
 *     보이고 **비워 두면 그대로**다(읽을 때 받은 `ref` 를 `keep` 으로 돌려준다).
 *
 * 속성은 보기의 컬럼이 아니라 **그 표의 스키마**에서 고른다(숨긴 속성도 — ⑪). 그 밖의 액션은 요약으로 서고 저장할 때 **그대로 남는다** —
 * 화면이 모르는 액션을 지우지 않는다(지우기 단추로만 지운다). 판정은 서버에 있다 — 저장하면 서버가 대어 보고, 틀리면 몇 번째 액션의
 * 무엇인지 말한다(부르는 쪽이 그린다).
 *
 * 재료(표마다의 속성 · 템플릿 · 데이터베이스 목록)는 이 부품이 읽는다 — 이 표와, 초안이 가리키는 다른 표를 처음 볼 때 한 번.
 */

import { useEffect, useState } from 'react'

import type { PropertySummary } from '@/lib/database/property'
import type { DatabaseListItem } from '@/lib/database/database'
import { emptyValue, isMvpPropertyType, type CellValue, type MvpPropertyType, type SelectOption } from '@/lib/database/property-types'
import { textRun, toPlainText } from '@/lib/contracts/rich-text'
import * as api from './table-api'

/** 동적 값의 출처(⑯ — 서버 `DynamicSource` 와 같은 모양). */
type Source = { readonly kind: 'now' } | { readonly kind: 'row_property'; readonly propertyId: string }
/** 셀 초안 — 고정 값 또는 동적 값(서버 `ActionCell` 과 같은 모양). */
type CellDraft = { readonly propertyId: string; readonly value: CellValue } | { readonly propertyId: string; readonly from: Source }
/** 일하는 행의 속성으로 채울 수 없는 타입 — 옵션이 속성마다 다르다(서버와 같다). */
const NOT_COPYABLE: ReadonlySet<string> = new Set(['select', 'status'])
/** 헤더 초안 — 저장된 것(`saved`)은 값을 모른다: 비워 두면 서버가 옮긴다. */
type HeaderDraft = { readonly name: string; readonly value: string; readonly saved: boolean }
export type ActionDraft =
  | { readonly kind: 'edit'; readonly cells: readonly CellDraft[] }
  | { readonly kind: 'add'; readonly dataSourceId: string; readonly templateId: string | null; readonly cells: readonly CellDraft[] }
  /** `ref` · `urlHint` 는 저장된 것 — 새 웹훅이면 null. `url` 은 새로 친 주소(비면 그대로). */
  | {
      readonly kind: 'webhook'
      readonly ref: string | null
      readonly urlHint: string | null
      readonly url: string
      readonly headers: readonly HeaderDraft[]
      readonly properties: readonly string[]
    }
  /** 이 편집기가 고치지 않는 액션 — 받은 그대로 다시 보낸다. */
  | { readonly kind: 'other'; readonly raw: api.ButtonActionJson }

/** 값을 넣을 수 있는 속성(셀 타입) — 이름 · 타입 · 선택지. */
type Field = { readonly id: string; readonly name: string; readonly type: MvpPropertyType; readonly options: readonly SelectOption[] }
/** 표 하나의 값 칸 재료 — 속성들과 템플릿들. */
type Table = { readonly fields: readonly Field[]; readonly templates: readonly { readonly id: string; readonly title: string }[] }

/** 웹훅의 헤더 상한(서버 `MAX_WEBHOOK_HEADERS` 와 같다). */
const MAX_HEADERS = 10

const OTHER_LABEL: Record<string, string> = {
  insert_blocks: '블록 넣기',
  define_variables: '변수 정하기',
  show_confirmation: '확인 묻기',
}

export const toDraft = (action: api.ButtonActionJson): ActionDraft => {
  const c = action.config
  if (action.type === 'edit_property' && Array.isArray(c.cells)) return { kind: 'edit', cells: c.cells as CellDraft[] }
  if (action.type === 'add_page_to' && typeof c.dataSourceId === 'string' && Array.isArray(c.cells)) {
    return { kind: 'add', dataSourceId: c.dataSourceId, templateId: typeof c.templateId === 'string' ? c.templateId : null, cells: c.cells as CellDraft[] }
  }
  if (action.type === 'send_webhook' && typeof c.ref === 'string') {
    const headers = Array.isArray(c.headers)
      ? c.headers.flatMap((h): HeaderDraft[] => (typeof h === 'object' && h !== null && 'name' in h ? [{ name: String(h.name), value: '', saved: true }] : []))
      : []
    return {
      kind: 'webhook',
      ref: c.ref,
      urlHint: typeof c.urlHint === 'string' ? c.urlHint : null,
      url: '',
      headers,
      properties: Array.isArray(c.properties) ? c.properties.filter((p): p is string => typeof p === 'string') : [],
    }
  }
  return { kind: 'other', raw: action }
}
/**
 * 웹훅 초안을 보낼 모양으로 — 새 주소가 있으면 `url`, 저장된 것이 있으면 `keep`(둘 다 있으면 주소는 새 것 · 헤더 값은 옮길 수 있다).
 * 저장된 헤더의 값을 비웠으면 이름만 — 서버가 옮긴다(⑫).
 */
const webhookAction = (draft: Extract<ActionDraft, { kind: 'webhook' }>): api.ButtonActionJson => {
  const url = draft.url.trim()
  return {
    type: 'send_webhook',
    config: {
      v: 1,
      ...(url !== '' || draft.ref === null ? { url } : {}),
      ...(draft.ref === null ? {} : { keep: draft.ref }),
      headers: draft.headers.map((h) => (h.value === '' && h.saved ? { name: h.name } : { name: h.name, value: h.value })),
      properties: draft.properties,
    },
  }
}

export const toAction = (draft: ActionDraft): api.ButtonActionJson =>
  draft.kind === 'edit'
    ? { type: 'edit_property', config: { v: 1, cells: draft.cells } }
    : draft.kind === 'add'
      ? { type: 'add_page_to', config: { v: 1, dataSourceId: draft.dataSourceId, cells: draft.cells, templateId: draft.templateId } }
      : draft.kind === 'webhook'
        ? webhookAction(draft)
        : draft.raw

const fieldsOf = (properties: readonly PropertySummary[]): Field[] =>
  properties.flatMap((p) => (isMvpPropertyType(p.type) ? [{ id: p.id, name: p.name, type: p.type, options: p.options ?? [] }] : []))

/**
 * 액션 목록 편집 — 초안은 부르는 쪽이 들고 있다(저장도 부르는 쪽).
 *
 * @param editLabel 값 바꾸기의 이름 — 버튼은 "이 행의 값 바꾸기", DB automation 은 "트리거된 행의 값 바꾸기"
 * @param rowLabel 일하는 행의 이름 — 버튼은 "누른 행", DB automation 은 "트리거된 행"(값의 출처 목록에 쓴다)
 * @param dataSourceId 일하는 행의 표 — 버튼 블록처럼 **일하는 행이 없으면 빈 글**(정본 ⑰): 값 바꾸기 · 보낼 속성이 서지 않고, 다른 표에 행 추가의
 *   기본 대상은 데이터베이스 목록의 첫 표다
 * @param testIdPrefix 검사가 잡는 이름의 앞 — 버튼은 `db-button`(5a-3 · 5a-4 의 e2e 가 그대로 잡는다)
 */
export function ActionListEditor({
  workspaceId,
  dataSourceId,
  drafts,
  onChange,
  editLabel,
  rowLabel,
  testIdPrefix,
}: {
  workspaceId: string
  dataSourceId: string
  drafts: readonly ActionDraft[]
  onChange: (drafts: readonly ActionDraft[]) => void
  editLabel: string
  rowLabel: string
  testIdPrefix: string
}) {
  const p = testIdPrefix
  const [databases, setDatabases] = useState<readonly DatabaseListItem[]>([])
  /** 표마다의 값 칸 재료 — 처음 볼 때 읽어 둔다. */
  const [tables, setTables] = useState<Readonly<Record<string, Table>>>({})

  useEffect(() => {
    let alive = true
    void api.listDatabases(workspaceId).then((dbs) => {
      if (alive) setDatabases(dbs.ok ? dbs.value : [])
    })
    return () => {
      alive = false
    }
  }, [workspaceId])

  // 이 표와 초안이 가리키는 표 중 아직 읽지 않은 것
  const missing = [...new Set([dataSourceId, ...drafts.flatMap((d) => (d.kind === 'add' ? [d.dataSourceId] : []))])]
    .filter((id) => id !== '' && tables[id] === undefined)
    .join(',')
  useEffect(() => {
    if (missing === '') return
    let alive = true
    for (const id of missing.split(',')) {
      void Promise.all([api.readProperties(workspaceId, id), api.listTemplates(workspaceId, id)]).then(([props, templates]) => {
        if (!alive) return
        setTables((prev) =>
          prev[id] !== undefined
            ? prev
            : {
                ...prev,
                [id]: {
                  fields: props.ok ? fieldsOf(props.value) : [],
                  templates: templates.ok ? templates.value.map((t) => ({ id: t.id, title: t.title })) : [],
                },
              },
        )
      })
    }
    return () => {
      alive = false
    }
  }, [workspaceId, missing])

  const update = (index: number, next: ActionDraft | null) =>
    onChange(next === null ? drafts.filter((_, i) => i !== index) : drafts.map((d, i) => (i === index ? next : d)))
  const own = tables[dataSourceId]?.fields ?? []

  return (
    <div className="flex flex-col gap-2">
      {drafts.length === 0 && <p className="text-neutral-500">아직 할 일이 없습니다.</p>}
      <ol className="flex flex-col gap-2">
        {drafts.map((draft, index) => (
          <li key={index} data-testid={`${p}-action`} data-kind={draft.kind} className="rounded border border-neutral-200 p-2 dark:border-neutral-700">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium">
                {index + 1}.{' '}
                {draft.kind === 'edit'
                  ? editLabel
                  : draft.kind === 'add'
                    ? '다른 표에 행 추가'
                    : draft.kind === 'webhook'
                      ? '웹훅 보내기'
                      : (OTHER_LABEL[draft.raw.type] ?? draft.raw.type)}
              </span>
              <button type="button" data-testid={`${p}-action-remove`} onClick={() => update(index, null)} className="text-neutral-500 hover:text-red-600">
                지우기
              </button>
            </div>
            {draft.kind === 'other' && <p className="text-neutral-500">이 편집기에서는 고치지 않습니다 — 저장해도 그대로 남습니다.</p>}
            {draft.kind === 'edit' && (
              <Cells p={p} fields={own} sources={own} rowLabel={rowLabel} cells={draft.cells} require onChange={(cells) => update(index, { ...draft, cells })} />
            )}
            {draft.kind === 'webhook' && <Webhook p={p} fields={own} draft={draft} onChange={(next) => update(index, next)} />}
            {draft.kind === 'add' && (
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-1">
                  <span className="w-10 shrink-0 text-neutral-500">표</span>
                  <select
                    aria-label="행을 더할 표"
                    data-testid={`${p}-target`}
                    value={draft.dataSourceId}
                    onChange={(e) => update(index, { kind: 'add', dataSourceId: e.target.value, templateId: null, cells: [] })}
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
                    data-testid={`${p}-template`}
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
                  <p data-testid={`${p}-template-note`} className="text-amber-700 dark:text-amber-400">
                    템플릿이 정한 칸은 템플릿 값이 이깁니다 — 아래 값은 템플릿이 비운 칸에만 들어갑니다.
                  </p>
                )}
                <Cells
                  p={p}
                  fields={tables[draft.dataSourceId]?.fields ?? []}
                  sources={own}
                  rowLabel={rowLabel}
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
            data-testid={`${p}-add-action`}
            onClick={() => onChange([...drafts, { kind: 'edit', cells: [{ propertyId: own[0].id, value: emptyValue(own[0].type) }] }])}
            className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            + {editLabel}
          </button>
        )}
        {(dataSourceId !== '' || databases.length > 0) && (
          <button
            type="button"
            data-testid={`${p}-add-row-action`}
            onClick={() =>
              onChange([...drafts, { kind: 'add', dataSourceId: dataSourceId !== '' ? dataSourceId : databases[0]!.dataSourceId, templateId: null, cells: [] }])
            }
            className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            + 다른 표에 행 추가
          </button>
        )}
        <button
          type="button"
          data-testid={`${p}-add-webhook-action`}
          onClick={() => onChange([...drafts, { kind: 'webhook', ref: null, urlHint: null, url: '', headers: [], properties: [] }])}
          className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          + 웹훅 보내기
        </button>
      </div>
    </div>
  )
}

/** 웹훅 칸 — 받는 주소 · 헤더 · 보낼 속성(⑭). 저장된 주소 · 헤더 값은 보이지 않는다 — 비워 두면 그대로. */
function Webhook({
  p,
  fields,
  draft,
  onChange,
}: {
  p: string
  fields: readonly Field[]
  draft: Extract<ActionDraft, { kind: 'webhook' }>
  onChange: (next: Extract<ActionDraft, { kind: 'webhook' }>) => void
}) {
  const box = 'min-w-0 flex-1 rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900'
  const setHeader = (i: number, next: HeaderDraft | null) =>
    onChange({ ...draft, headers: next === null ? draft.headers.filter((_, j) => j !== i) : draft.headers.map((h, j) => (j === i ? next : h)) })
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1">
        <span className="w-10 shrink-0 text-neutral-500">주소</span>
        <input
          type="url"
          aria-label="받는 주소"
          data-testid={`${p}-webhook-url`}
          value={draft.url}
          placeholder={draft.urlHint === null ? 'https://…' : `지금: ${draft.urlHint} — 비우면 그대로`}
          autoComplete="off"
          onChange={(e) => onChange({ ...draft, url: e.target.value })}
          className={box}
        />
      </label>
      {draft.headers.map((h, i) => (
        <div key={i} className="flex items-center gap-1" data-testid={`${p}-webhook-header`}>
          <input
            type="text"
            aria-label="헤더 이름"
            data-testid={`${p}-webhook-header-name`}
            value={h.name}
            disabled={h.saved}
            onChange={(e) => setHeader(i, { ...h, name: e.target.value })}
            className={`${box} max-w-[8rem]`}
          />
          <input
            type="text"
            aria-label={`${h.name || '헤더'} 값`}
            data-testid={`${p}-webhook-header-value`}
            value={h.value}
            placeholder={h.saved ? '저장된 값 — 비우면 그대로' : '값'}
            autoComplete="off"
            onChange={(e) => setHeader(i, { ...h, value: e.target.value })}
            className={box}
          />
          <button type="button" aria-label="이 헤더 빼기" onClick={() => setHeader(i, null)} className="px-1 text-neutral-400 hover:text-red-600">
            ×
          </button>
        </div>
      ))}
      {draft.headers.length < MAX_HEADERS && (
        <button
          type="button"
          data-testid={`${p}-webhook-add-header`}
          onClick={() => onChange({ ...draft, headers: [...draft.headers, { name: '', value: '', saved: false }] })}
          className="self-start text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          + 헤더
        </button>
      )}
      {fields.length === 0 ? (
        <p className="text-neutral-500">보낼 속성이 없습니다 — 페이지의 id 와 주소만 갑니다.</p>
      ) : (
      <fieldset className="flex flex-col gap-0.5">
        <legend className="text-neutral-500">보낼 속성 — 고르지 않으면 행의 id 와 주소만</legend>
        {fields.map((f) => (
          <label key={f.id} className="flex items-center gap-1">
            <input
              type="checkbox"
              data-testid={`${p}-webhook-property`}
              data-property-id={f.id}
              checked={draft.properties.includes(f.id)}
              onChange={(e) =>
                onChange({ ...draft, properties: e.target.checked ? [...draft.properties, f.id] : draft.properties.filter((x) => x !== f.id) })
              }
            />
            {f.name}
          </label>
        ))}
      </fieldset>
      )}
      <p className="text-neutral-500">
        몸은 <code>{'{ run_id, page, properties }'}</code> — 받는 쪽은 <code>run_id</code> 로 겹친 것을 거르세요. 네 번 실패하면 멈춥니다.
      </p>
    </div>
  )
}

/** 출처 고르기의 값 — `literal` · `now` · `row:{속성 id}`. */
const sourceKey = (cell: CellDraft): string => ('from' in cell ? (cell.from.kind === 'now' ? 'now' : `row:${cell.from.propertyId}`) : 'literal')

/**
 * 값 목록 — 속성 고르기 + 출처(⑯) + 그 타입의 값 칸. `require` 면 마지막 하나는 뺄 수 없다(값 바꾸기는 값이 하나 이상).
 *
 * @param sources 일하는 행의 표의 속성 — 동적 값의 원본(다른 표에 행 추가여도 이 표다)
 */
function Cells({
  p,
  fields,
  sources,
  rowLabel,
  cells,
  require,
  onChange,
}: {
  p: string
  fields: readonly Field[]
  sources: readonly Field[]
  rowLabel: string
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
          <div key={c} className="flex items-center gap-1" data-testid={`${p}-cell-value`}>
            <select
              aria-label="값을 넣을 속성"
              data-testid={`${p}-property`}
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
              <select
                aria-label={`${field.name} 값의 출처`}
                data-testid={`${p}-value-source`}
                value={sourceKey(cell)}
                onChange={(e) => {
                  const key = e.target.value
                  const next: CellDraft =
                    key === 'now'
                      ? { propertyId: cell.propertyId, from: { kind: 'now' } }
                      : key.startsWith('row:')
                        ? { propertyId: cell.propertyId, from: { kind: 'row_property', propertyId: key.slice(4) } }
                        : { propertyId: cell.propertyId, value: emptyValue(field.type) }
                  onChange(cells.map((x, i) => (i === c ? next : x)))
                }}
                className="min-w-0 max-w-[9rem] rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
              >
                <option value="literal">값</option>
                {field.type === 'date' && <option value="now">지금</option>}
                {!NOT_COPYABLE.has(field.type) &&
                  sources
                    .filter((s) => s.type === field.type)
                    .map((s) => (
                      <option key={s.id} value={`row:${s.id}`}>
                        {rowLabel}의 {s.name}
                      </option>
                    ))}
                {'from' in cell && cell.from.kind === 'row_property' && !sources.some((s) => s.id === (cell.from as { propertyId: string }).propertyId) && (
                  <option value={sourceKey(cell)}>(없는 속성)</option>
                )}
              </select>
            )}
            {field !== undefined && 'value' in cell && (
              <ValueInput p={p} field={field} value={cell.value} onChange={(value) => onChange(cells.map((x, i) => (i === c ? { propertyId: x.propertyId, value } : x)))} />
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
          data-testid={`${p}-add-value`}
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
function ValueInput({ p, field, value, onChange }: { p: string; field: Field; value: CellValue; onChange: (value: CellValue) => void }) {
  const box = 'min-w-0 flex-1 rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900'
  const label = `${field.name} 값`
  const testId = `${p}-value`
  switch (value.type) {
    case 'number':
      return (
        <input
          type="number"
          aria-label={label}
          data-testid={testId}
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
          data-testid={testId}
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
          data-testid={testId}
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
          data-testid={testId}
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
          data-testid={testId}
          value={value.date?.start.slice(0, 10) ?? ''}
          onChange={(e) => onChange({ type: 'date', date: e.target.value === '' ? null : { start: e.target.value } })}
          className={box}
        />
      )
  }
}
