/**
 * 공개 API 의 속성 스키마 객체 — 우리 속성 → 노션 `2025-09-03` 의 property object (API-4 · F-09-16 · F-09-17 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑧ · 09-api-integrations.md F-09-17
 *
 * `{ id, name, type, description?, <type>: 설정 }`. id 는 페이지 객체(`property-values.ts` `apiPropertyId`)와 같다 — 제목은 `'title'`, 나머지는
 * 우리 id(이름이 바뀌어도 그대로 · 정본 P2). 그래서 스키마의 id 가 `GET /v1/pages/{id}/properties/{property_id}` 와 질의의 필터에 그대로 듣는다.
 *
 *   · 선택 · 다중 선택 · 상태 — `options: [{id, name, color}]` · 상태는 `groups: [{id, name, color, option_ids}]`(범주 셋 — 이름 · 색은 범주의
 *     함수다(0023) · 노션의 이름과 색으로 준다)
 *   · 숫자 — `format: 'number'`(앱에 숫자 형식 설정이 없다)
 *   · 수식 — `expression`(앱의 편집기가 여는 식 — 속성 자리는 지금 이름의 `prop("이름")` · 노션의 내부 표기가 아니다)
 *   · relation — `data_source_id` + 짝이 있으면 `dual_property {synced_property_id, synced_property_name}`, 없으면 `single_property {}`
 *   · rollup — `relation_property_id/name` · `rollup_property_id/name` · `function`(페이지 값의 rollup 과 같은 이름)
 *   · 고유 ID — `prefix`(표의 것 · 없으면 null)
 *   · 다른 표의 속성 이름은 그 표를 열 수 있을 때만(부르는 쪽이 `names` 에 넣지 않으면 null) — 구조도 그 표의 내용이다
 */

import { readFormulaConfig } from '../database/formula-schema.ts'
import { displayFormula } from '../formula/formula.ts'
import { readRelationConfig, type SelectOption, type StatusGroupKind } from '../database/property-types.ts'
import { readRollupConfig } from '../database/rollup-functions.ts'
import { TITLE_PROPERTY_ID } from './property-values.ts'

export type SchemaProperty = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly type: string
  readonly config: unknown
  readonly options?: readonly SelectOption[]
}

/** 다른 속성(이 표 · 대상 표)의 모양 — 이름은 그 표를 열 수 있을 때만. */
export type SchemaRef = { readonly name: string | null; readonly type: string }

export type SchemaLookups = {
  readonly uniqueIdPrefix: string | null
  /** 상태 속성 id → 범주(id · kind). */
  readonly statusGroups: ReadonlyMap<string, readonly { readonly id: string; readonly kind: StatusGroupKind }[]>
  /** 속성 id → 이름 · 타입(이 표의 것과 relation · rollup 이 가리키는 대상 표의 것). */
  readonly refs: ReadonlyMap<string, SchemaRef>
}

/** 상태 범주 — 노션의 이름과 색(범주의 함수 · 0023). */
export const STATUS_GROUP_API: Readonly<Record<StatusGroupKind, { readonly name: string; readonly color: string }>> = Object.freeze({
  todo: { name: 'To-do', color: 'gray' },
  in_progress: { name: 'In progress', color: 'blue' },
  complete: { name: 'Complete', color: 'green' },
})

const refId = (id: string, ref: SchemaRef | undefined): string => (ref?.type === 'title' ? TITLE_PROPERTY_ID : id)

function optionsOut(options: readonly SelectOption[] | undefined) {
  return (options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color }))
}

/** 타입마다의 설정(`<type>` 자리의 것). */
function configOf(p: SchemaProperty, lookups: SchemaLookups): Record<string, unknown> {
  switch (p.type) {
    case 'number':
      return { format: 'number' }
    case 'select':
    case 'multi_select':
      return { options: optionsOut(p.options) }
    case 'status': {
      const options = p.options ?? []
      return {
        options: optionsOut(options),
        groups: (lookups.statusGroups.get(p.id) ?? []).map((g) => ({
          id: g.id,
          name: STATUS_GROUP_API[g.kind].name,
          color: STATUS_GROUP_API[g.kind].color,
          option_ids: options.filter((o) => o.group === g.kind).map((o) => o.id),
        })),
      }
    }
    case 'formula':
      // 저장된 식의 `⟦id⟧` 를 지금 이름의 `prop("이름")` 으로(앱의 편집기가 여는 모양 — `displayFormula`)
      return { expression: displayFormula(readFormulaConfig(p.config)?.expression ?? '', (id) => lookups.refs.get(id)?.name ?? null) }
    case 'relation': {
      const config = readRelationConfig(p.config)
      if (config === null) return { data_source_id: null, type: 'single_property', single_property: {} }
      const synced = config.synced_property_id
      if (synced === undefined) return { data_source_id: config.target_data_source_id, type: 'single_property', single_property: {} }
      const ref = synced === p.id ? { name: p.name, type: p.type } : lookups.refs.get(synced)
      return {
        data_source_id: config.target_data_source_id,
        type: 'dual_property',
        dual_property: { synced_property_id: synced, synced_property_name: ref?.name ?? null },
      }
    }
    case 'rollup': {
      const config = readRollupConfig(p.config)
      if (config === null) {
        return { relation_property_id: null, relation_property_name: null, rollup_property_id: null, rollup_property_name: null, function: 'show_original' }
      }
      const relation = lookups.refs.get(config.relation_property_id)
      const target = lookups.refs.get(config.target_property_id)
      return {
        relation_property_id: config.relation_property_id,
        relation_property_name: relation?.name ?? null,
        rollup_property_id: refId(config.target_property_id, target),
        rollup_property_name: target?.name ?? null,
        function: config.function,
      }
    }
    case 'unique_id':
      return { prefix: lookups.uniqueIdPrefix }
    default:
      // 제목 · 글 · 날짜 · 사람 · 파일 · 체크박스 · URL · 이메일 · 전화 · 장소 · 만든/고친 시각과 사람 · 검증 · 버튼 — 설정이 없다
      return {}
  }
}

/** 속성 하나 → 노션의 property object. */
export function schemaPropertyToApi(p: SchemaProperty, lookups: SchemaLookups): Record<string, unknown> {
  const description = p.description !== null && p.description.trim() !== '' ? { description: p.description } : {}
  return { id: p.type === 'title' ? TITLE_PROPERTY_ID : p.id, name: p.name, type: p.type, ...description, [p.type]: configOf(p, lookups) }
}

/** 스키마 전체 — 이름을 열쇠로(노션의 `properties`) · 스키마 순서. */
export function schemaToApi(properties: readonly SchemaProperty[], lookups: SchemaLookups): Record<string, unknown> {
  return Object.fromEntries(properties.map((p) => [p.name, schemaPropertyToApi(p, lookups)]))
}
