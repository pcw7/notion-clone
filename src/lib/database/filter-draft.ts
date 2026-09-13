/**
 * 필터 · 정렬 패널의 초안 — W8-b (F-04-09 · F-04-10 의 UI 몫)
 *
 * 정본: 04-database-views.md F-04-09 · F-04-10 / 03-database-core.md F-03-17
 *       마스터 문서 §5.2 W8-b: *"단일 레벨 AND 필터, 다중 정렬"*
 *
 * 저장 모양(`FilterNode` 트리 · `SortKey[]`)과 패널이 다루는 모양(규칙의 평평한
 * 목록) 사이를 오간다. DOM 을 모른다 — 규칙 전부가 `node --test` 로 돈다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 패널은 단일 레벨 AND 만 편집한다 — 편집할 수 없는 필터는 건드리지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 저장 모양은 트리다. API 로 OR 이나 중첩 그룹을 저장할 수 있고, 컴파일러도 그것을
 * 푼다. 그런 필터를 패널이 평평하게 펴서 다시 저장하면 **사용자가 만든 적 없는
 * 뜻으로 바뀐다**(OR 이 AND 가 된다). 그래서 평평하게 읽을 수 없는 필터는 편집할 수
 * 없다고 말하고, 지우기만 허용한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 덜 찬 규칙은 보내지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 속성만 고르고 값을 아직 안 넣은 규칙은 서버가 거부한다(`validateFilter`: "값이
 * 필요합니다"). 패널에는 남기되 저장할 트리에서는 뺀다 — 타이핑 중인 규칙 하나
 * 때문에 나머지 규칙까지 저장되지 않으면 안 된다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 지워진 속성을 가리키는 규칙 · 정렬은 저장 전에 뺀다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 읽기 경로(컴파일러)는 그런 규칙을 **조용히 무시**한다(F-03-17: 0건으로 만들면 데이터
 * 소실로 오인된다). 쓰기 경로는 거부한다(없는 속성으로 규칙을 새로 만들 이유가 없다).
 * 패널이 그대로 다시 보내면 **다른 규칙을 고친 저장까지 거부된다.** F-04-10: *"정렬
 * 프로퍼티 삭제 → 해당 sort 엔트리 제거."*
 */

import { MAX_SORT_KEYS, isGroup, type FilterLeaf, type FilterNode, type SortKey } from './filter.ts'
import { formatDate } from './cell-format.ts'
import type { OperatorCatalogEntry } from './operator-catalog.ts'
import type { MvpPropertyType, SelectOption } from './property-types.ts'

export type FilterRule = FilterLeaf

/** 패널이 규칙과 칩을 그릴 때 알아야 하는 컬럼 모양. */
export type RuleColumn = {
  readonly propertyId: string
  readonly name: string
  readonly type: MvpPropertyType
  readonly options: readonly SelectOption[]
}

export type ReadRules =
  | { readonly editable: true; readonly rules: FilterRule[] }
  | { readonly editable: false }

/** 저장된 필터를 규칙 목록으로 편다. 평평한 AND 로 읽을 수 없으면 편집 불가다(머리말). */
export function readRules(filter: FilterNode | null): ReadRules {
  if (filter === null) return { editable: true, rules: [] }
  if (!isGroup(filter)) return { editable: true, rules: [filter] }
  if (filter.children.some(isGroup)) return { editable: false }
  // 자식이 하나 이하면 OR 도 AND 와 뜻이 같다.
  if (filter.op === 'or' && filter.children.length > 1) return { editable: false }
  return { editable: true, rules: filter.children as FilterLeaf[] }
}

export function operatorsOf(
  catalog: readonly OperatorCatalogEntry[],
  type: MvpPropertyType,
): OperatorCatalogEntry[] {
  return catalog.filter((entry) => entry.propertyType === type)
}

function entryOf(
  catalog: readonly OperatorCatalogEntry[],
  type: MvpPropertyType,
  operator: string,
): OperatorCatalogEntry | undefined {
  return catalog.find((entry) => entry.propertyType === type && entry.operator === operator)
}

/** 저장해도 되는 규칙인가 — 속성이 살아 있고, 그 타입의 연산자이고, 값이 필요하면 값이 있다. */
export function isComplete(
  rule: FilterRule,
  type: MvpPropertyType | undefined,
  catalog: readonly OperatorCatalogEntry[],
): boolean {
  if (type === undefined) return false
  const entry = entryOf(catalog, type, rule.operator)
  if (entry === undefined) return false
  if (entry.arity === 0) return true
  return rule.value !== undefined && rule.value !== null && rule.value !== ''
}

/**
 * 규칙 목록 → 저장할 필터. 덜 찬 규칙과 지워진 속성의 규칙을 뺀다(머리말).
 *
 * @param types 살아 있는 속성의 `id → type`. 여기 없는 속성은 지워진 것이다.
 * @returns 남는 규칙이 없으면 `null` — "필터 없음"으로 저장한다.
 */
export function toFilter(
  rules: readonly FilterRule[],
  types: ReadonlyMap<string, MvpPropertyType>,
  catalog: readonly OperatorCatalogEntry[],
): FilterNode | null {
  const children: FilterLeaf[] = []
  for (const rule of rules) {
    const type = types.get(rule.property_id)
    if (!isComplete(rule, type, catalog)) continue
    // 값이 필요 없는 연산자(`is_empty`)에는 값을 싣지 않는다. 연산자를 바꾸기 전의
    // 값이 남아 있으면 저장된 AST 가 뜻과 다른 것을 들고 있게 된다.
    const arity = entryOf(catalog, type as MvpPropertyType, rule.operator)?.arity
    children.push(
      arity === 0
        ? { property_id: rule.property_id, operator: rule.operator }
        : { property_id: rule.property_id, operator: rule.operator, value: rule.value },
    )
  }
  return children.length === 0 ? null : { op: 'and', children }
}

/**
 * 속성을 새로 고른 규칙. 연산자는 그 타입의 첫 연산자, 값은 비운다.
 *
 * 이전 값을 끌고 가지 않는다 — 숫자 규칙의 값이 옵션 id 로 남는 식의 뒤섞임이 생긴다.
 * 체크박스만 `true` 로 시작한다: 값의 선택지가 둘뿐이라 비워 두면 "완성되지 않은
 * 규칙"이 되어 아무 일도 안 일어나는 것처럼 보인다.
 */
export function ruleFor(
  propertyId: string,
  type: MvpPropertyType,
  catalog: readonly OperatorCatalogEntry[],
): FilterRule {
  const first = operatorsOf(catalog, type)[0]
  return {
    property_id: propertyId,
    operator: first?.operator ?? '',
    ...(type === 'checkbox' ? { value: true } : {}),
  }
}

/** 연산자를 바꾼다. 값이 필요 없는 연산자면 값을 버린다. */
export function withOperator(
  rule: FilterRule,
  operator: string,
  type: MvpPropertyType,
  catalog: readonly OperatorCatalogEntry[],
): FilterRule {
  const entry = entryOf(catalog, type, operator)
  if (entry?.arity === 0) return { property_id: rule.property_id, operator }
  return { ...rule, operator }
}

/** 칩에 쓰는 한 줄 요약. `상태 · 같음 · 진행 중`. */
export function describeRule(
  rule: FilterRule,
  column: RuleColumn | undefined,
  catalog: readonly OperatorCatalogEntry[],
): string {
  // F-03-17: 지워진 속성의 규칙은 "비활성 표시하고 무시". 조용히 사라지게 두지 않는다.
  if (column === undefined) return '지워진 속성 (무시됨)'
  const entry = entryOf(catalog, column.type, rule.operator)
  const op = entry?.label ?? rule.operator
  if (entry?.arity === 0) return `${column.name} · ${op}`
  if (rule.value === undefined || rule.value === null || rule.value === '') return `${column.name} · ${op} · …`
  return `${column.name} · ${op} · ${valueLabel(rule.value, column)}`
}

function valueLabel(value: unknown, column: RuleColumn): string {
  switch (column.type) {
    case 'select':
      // F-03-17: *"필터가 참조하던 select 옵션 삭제 → 규칙은 남고 매칭 0건. UI 에 '삭제된 옵션' 배지."*
      return column.options.find((o) => o.id === value)?.name ?? '지워진 옵션'
    case 'checkbox':
      return value === true || value === 'true' ? '체크됨' : '체크 안 됨'
    case 'date':
      return typeof value === 'string' ? formatDate({ start: value }) : String(value)
    default:
      return String(value)
  }
}

// ── 정렬 ──────────────────────────────────────────────────────────────

/** 지워진 속성을 가리키는 정렬 키를 뺀다(머리말 · F-04-10). */
export function liveSorts(sorts: readonly SortKey[], types: ReadonlyMap<string, MvpPropertyType>): SortKey[] {
  return sorts.filter((sort) => types.has(sort.property_id))
}

/**
 * 정렬 키를 더한다. 이미 있으면 그대로, 상한(`MAX_SORT_KEYS`)이면 그대로다.
 *
 * 같은 속성을 두 번 넣지 않는다 — 두 번째 키는 아무 일도 하지 않고, 서버도 거부한다
 * (`validateSorts`: "이미 정렬 키로 쓰였습니다").
 */
export function addSort(sorts: readonly SortKey[], propertyId: string): SortKey[] {
  if (sorts.length >= MAX_SORT_KEYS || sorts.some((s) => s.property_id === propertyId)) return [...sorts]
  return [...sorts, { property_id: propertyId, direction: 'asc' }]
}

/** 우선순위를 한 칸 옮긴다. 배열의 순서가 곧 우선순위다(F-04-10). */
export function moveSort(sorts: readonly SortKey[], index: number, delta: -1 | 1): SortKey[] {
  const target = index + delta
  if (index < 0 || index >= sorts.length || target < 0 || target >= sorts.length) return [...sorts]
  const next = [...sorts]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/**
 * 머리 메뉴의 "오름차순/내림차순" — 그 속성을 **첫 번째** 정렬 키로 둔다.
 *
 * 누른 사람이 기대하는 것은 "이 열 기준으로 정렬된 표"다. 뒤에 붙이면 앞 키가 이미
 * 순서를 정해 버려 눌러도 아무 변화가 없어 보인다. 나머지 키는 뒤로 밀리고, 상한을
 * 넘는 것은 떨어진다.
 */
export function sortFirst(
  sorts: readonly SortKey[],
  propertyId: string,
  direction: SortKey['direction'],
): SortKey[] {
  const rest = sorts.filter((s) => s.property_id !== propertyId)
  return [{ property_id: propertyId, direction }, ...rest].slice(0, MAX_SORT_KEYS)
}
