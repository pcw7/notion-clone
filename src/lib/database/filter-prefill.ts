/**
 * 필터가 걸린 뷰에서 만든 행에 채울 값 — §7 정리 10n-10 (F-04-09 · F-03-17)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 필터가 걸린 뷰에서 만든 행 — 필터가 정하는 값을 채운다
 *
 * 필터가 걸린 뷰에서 "+ 새로 만들기" 로 만든 행은 빈 행이라 그 필터 밖이다 — 새로고침하면 사라져 보였다. 노션처럼 **조건이 값 하나를 정할
 * 때만** 그 값을 채운다(①). 범위 · 부분 일치 · 부정은 만족하는 값이 여럿이라 고르지 않는다(②). AND 로 닿는 조건만 본다(③).
 *
 * DB 를 모른다 — 속성 타입은 부르는 쪽이 준다(`typeOf`). 채운 값이 지금도 맞는지(지운 옵션 · 떠난 사람)는 부르는 쪽이 거른다(⑥ ·
 * `row.ts` `viewPrefillIn`).
 */
import { textRun } from '../contracts/rich-text.ts'
import { isGroup, isMeNode, type FilterLeaf, type FilterNode } from './filter.ts'
import { MAX_PEOPLE, type CellValue } from './property-types.ts'

/** 채울 칸 하나 — `RowCell` 과 같은 모양이다(이 모듈이 `row.ts` 를 가져오지 않게 따로 적는다). */
export type PrefillCell = { readonly propertyId: string; readonly value: CellValue }

/** 조건 하나가 정하는 것 — 값 하나 · 상태의 빈 값 · 사람(여럿이면 모두를 넣는다). */
type Need =
  | { readonly kind: 'value'; readonly value: CellValue }
  | { readonly kind: 'empty' }
  | { readonly kind: 'people'; readonly ids: readonly string[] }

/**
 * 이 필터가 정하는 칸들. 속성마다 하나 · 필터에 나온 순서.
 *
 * @param typeOf 속성 id → 타입(`title` · `select` · `formula` …). 모르면 undefined — 그 조건은 건너뛴다.
 * @param me 만드는 사람 — 사람 조건의 `{ "$context": "me" }`. 없으면(익명) 그 조건은 채우지 않는다.
 */
export function filterPrefill(
  filter: FilterNode | null | undefined,
  typeOf: (propertyId: string) => string | undefined,
  me: string | null,
): PrefillCell[] {
  if (filter === null || filter === undefined) return []

  // ③ AND 로 닿는 조건만 — 자식이 하나뿐인 OR 은 AND 와 같다. 자식이 둘 이상인 OR 은 어느 쪽을 채울지 정할 수 없어 통째로 건너뛴다.
  const leaves: FilterLeaf[] = []
  const walk = (node: FilterNode): void => {
    if (!isGroup(node)) {
      leaves.push(node)
      return
    }
    if (node.op === 'and' || node.children.length === 1) node.children.forEach(walk)
  }
  walk(filter)

  // 속성마다 모은다 — null 은 "서로 다른 값을 정하는 조건이 둘"(만족할 수 없는 필터)이라 채우지 않는다는 표시다
  const needs = new Map<string, Need | null>()
  for (const leaf of leaves) {
    const need = needOf(typeOf(leaf.property_id), leaf, me)
    if (need === null) continue
    const before = needs.get(leaf.property_id)
    needs.set(leaf.property_id, before === undefined ? need : merge(before, need))
  }

  const cells: PrefillCell[] = []
  for (const [propertyId, need] of needs) {
    if (need === null) continue
    if (need.kind === 'value') cells.push({ propertyId, value: need.value })
    else if (need.kind === 'empty') cells.push({ propertyId, value: { type: 'status', status: null } })
    else cells.push({ propertyId, value: { type: 'people', people: need.ids.slice(0, MAX_PEOPLE).map((id) => ({ id })) } })
  }
  return cells
}

/** 조건 하나가 정하는 것. 정하지 않으면(② — 범위 · 부분 일치 · 부정 · 수식 …) null. */
function needOf(type: string | undefined, leaf: FilterLeaf, me: string | null): Need | null {
  const v = leaf.value
  switch (type) {
    case 'title':
    case 'rich_text':
      // 대소문자는 필터가 무시한다(`lower(…) = lower(…)`) — 적힌 그대로 채운다
      if (leaf.operator !== 'equals' || typeof v !== 'string' || v === '') return null
      return type === 'title'
        ? { kind: 'value', value: { type: 'title', title: [textRun(v)] } }
        : { kind: 'value', value: { type: 'rich_text', rich_text: [textRun(v)] } }
    case 'number': {
      if (leaf.operator !== 'equals') return null
      // 값은 수 또는 수를 적은 글자로 저장된다(바인딩이 `Number()` 로 읽는다 · `filter.ts` `bindValue`)
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
      return Number.isFinite(n) ? { kind: 'value', value: { type: 'number', number: n } } : null
    }
    case 'select':
      if (leaf.operator !== 'equals' || typeof v !== 'string' || v === '') return null
      return { kind: 'value', value: { type: 'select', select: { id: v } } }
    case 'status':
      // 상태의 is_empty 는 빈 값을 적는다 — 안 적으면 기본 옵션(`default_option_id`)이 들어가 새 행이 조건 밖이 된다
      if (leaf.operator === 'is_empty') return { kind: 'empty' }
      if (leaf.operator !== 'equals' || typeof v !== 'string' || v === '') return null
      return { kind: 'value', value: { type: 'status', status: { id: v } } }
    case 'checkbox': {
      const checked = v === true || v === 'true'
      if (leaf.operator === 'equals') return { kind: 'value', value: { type: 'checkbox', checkbox: checked } }
      // 값이 둘뿐이라 "체크 안 함이 아니다" 는 체크 하나로 정해진다. "체크가 아니다" 는 새 행이 이미 만족한다(체크박스의 빈 값은 false)
      if (leaf.operator === 'does_not_equal' && !checked) return { kind: 'value', value: { type: 'checkbox', checkbox: true } }
      return null
    }
    case 'date': {
      // 하루 단위 비교라(`date_trunc('day', …)`) 날짜만 채운다
      if (leaf.operator !== 'equals' || typeof v !== 'string') return null
      const day = /^\d{4}-\d{2}-\d{2}/.exec(v)?.[0]
      return day === undefined ? null : { kind: 'value', value: { type: 'date', date: { start: day } } }
    }
    case 'people': {
      if (leaf.operator !== 'contains') return null
      const id = isMeNode(v) ? me : typeof v === 'string' && v !== '' ? v : null
      return id === null ? null : { kind: 'people', ids: [id] }
    }
    default:
      // 수식 · 고유 ID · 모르는 속성 — 값을 적을 수 없다(②)
      return null
  }
}

/** 같은 칸의 두 조건. 사람은 모두를 넣고, 나머지는 같은 값일 때만 — 다르면 null(채우지 않는다). */
function merge(a: Need | null, b: Need): Need | null {
  if (a === null) return null
  if (a.kind === 'people' && b.kind === 'people') return { kind: 'people', ids: [...new Set([...a.ids, ...b.ids])] }
  if (a.kind === 'empty' && b.kind === 'empty') return a
  if (a.kind === 'value' && b.kind === 'value' && JSON.stringify(a.value) === JSON.stringify(b.value)) return a
  return null
}
