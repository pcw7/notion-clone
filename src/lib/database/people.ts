/**
 * 사람 칸 — 이 워크스페이스의 사람인가 · 이름 (게시 · 공유 6g-1 · F-03-07)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 사람 속성 ②⑥
 *
 * 값은 id 만이다. **쓸 때** 그 id 들이 이 워크스페이스의 활동 중인 사람(멤버 · 게스트)인지 보고(`peopleIssuesIn`), **읽을 때** 이름을
 * 사람의 표에서 찾는다(`peopleNamesIn`). 떠난 사람(`removed` · 정지)은 이름 지도에 없다 — 화면은 "떠난 사용자" 로 그린다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import type { ValidationIssue } from '../contracts/rich-text.ts'
import { isUuid } from '../ids.ts'
import { canListMembers, listMembers } from '../workspace/list.ts'
import { MAX_PEOPLE, type CellValue } from './property-types.ts'

/** 이 워크스페이스의 활동 중인 사람(멤버 · 게스트)의 이름 — 주어진 id 중에서. */
export async function peopleNamesIn(tx: Tx, workspaceId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return new Map()
  const rows = await tx.query<{ id: string; name: string }>(
    `SELECT u.id, u.name
       FROM workspace_member m
       JOIN "user" u ON u.id = m.user_id
      WHERE m.workspace_id = $1 AND m.status = 'active' AND u.id = ANY($2::uuid[])`,
    [workspaceId, wanted],
  )
  return new Map(rows.map((r) => [r.id, r.name]))
}

/** 칸들에 든 사람 id — 사람 칸만. */
export function peopleIdsOf(values: Iterable<unknown>): string[] {
  const out = new Set<string>()
  for (const value of values) {
    const cell = value as Partial<Extract<CellValue, { type: 'people' }>> | null
    if (cell?.type !== 'people' || !Array.isArray(cell.people)) continue
    for (const person of cell.people) if (typeof person?.id === 'string') out.add(person.id)
  }
  return [...out]
}

/**
 * 쓰려는 사람 칸들의 사람이 이 워크스페이스의 활동 중인 사람인가(정본 ②). 아니면 그 칸의 문제를 준다 — 떠난 사람 · 다른 워크스페이스의
 * 사람 · 없는 id 는 같은 답이다(누가 어디 있는지 알리지 않는다).
 *
 * **새로 드는 사람만 본다**(정본 ⑫ⓒ) — `before`(그 칸의 쓰기 전 값)에 이미 든 사람은 떠났어도 묻지 않는다. 그러지 않으면 떠난 사람이 든
 * 칸은 그 사람을 빼는 것 말고는 아무도 고치지 못한다. 새 행은 `before` 가 없다 — 모두 새로 드는 사람이다.
 */
export async function peopleIssuesIn(
  tx: Tx,
  workspaceId: string,
  cells: readonly { readonly propertyId: string; readonly value: CellValue }[],
  before: ReadonlyMap<string, unknown> = new Map(),
): Promise<ValidationIssue[]> {
  const entering = cells.flatMap((cell) => {
    if (cell.value.type !== 'people') return []
    const stayed = new Set(peopleIdsOf([before.get(cell.propertyId)]))
    return [{ cell, ids: new Set(cell.value.people.map((person) => person.id).filter((id) => !stayed.has(id))) }]
  })
  if (entering.every((e) => e.ids.size === 0)) return []
  const known = await peopleNamesIn(tx, workspaceId, entering.flatMap((e) => [...e.ids]))
  const issues: ValidationIssue[] = []
  for (const { cell, ids } of entering) {
    if (cell.value.type !== 'people') continue
    for (const [i, person] of cell.value.people.entries()) {
      if (ids.has(person.id) && !known.has(person.id)) {
        issues.push({ path: `cells.${cell.propertyId}.people[${i}].id`, message: '이 워크스페이스의 사람이 아닙니다' })
      }
    }
  }
  return issues
}

// ── 더하기 · 빼기 (10n-3 · 정본 ⑫) ─────────────────────────────────────

/** 사람 칸 하나의 더하기 · 빼기 — 지금 값에 적용한다(행을 잠근 채 · `row.ts` `updateCellsIn`). */
export type PeopleChange = { readonly propertyId: string; readonly add: readonly string[]; readonly remove: readonly string[] }

/**
 * 더하기 · 빼기의 모양을 본다 — uuid 배열 · 한 칸에 한 번 · 같은 사람을 더하면서 빼지 않는다 · 같은 칸을 통째 값(`cells`)으로도 보내지
 * 않는다 · 한 칸에 바꾸는 사람이 상한(50명) 안. 겹친 id 는 하나로 접는다.
 */
export function checkPeopleChanges(
  changes: readonly { readonly propertyId: unknown; readonly add?: unknown; readonly remove?: unknown }[],
  cells: readonly { readonly propertyId: string }[],
): { readonly ok: true; readonly changes: PeopleChange[] } | { readonly ok: false; readonly issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = []
  const out: PeopleChange[] = []
  const whole = new Set(cells.map((cell) => cell.propertyId))
  const seen = new Set<string>()
  const ids = (raw: unknown, path: string): string[] | null => {
    if (raw === undefined) return []
    if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string' || !isUuid(id))) {
      issues.push({ path, message: '사람 id(uuid) 의 배열이어야 합니다' })
      return null
    }
    return [...new Set(raw as string[])]
  }
  for (const [i, change] of changes.entries()) {
    const path = `peopleChanges[${i}]`
    if (typeof change.propertyId !== 'string') {
      issues.push({ path: `${path}.propertyId`, message: '속성 id 가 있어야 합니다' })
      continue
    }
    const add = ids(change.add, `${path}.add`)
    const remove = ids(change.remove, `${path}.remove`)
    if (add === null || remove === null) continue
    if (seen.has(change.propertyId) || whole.has(change.propertyId)) {
      issues.push({ path: `${path}.propertyId`, message: '한 요청에서 같은 칸을 두 번 바꿀 수 없습니다' })
      continue
    }
    seen.add(change.propertyId)
    if (add.some((id) => remove.includes(id))) {
      issues.push({ path: `${path}.add`, message: '같은 사람을 더하면서 뺄 수 없습니다' })
      continue
    }
    if (add.length + remove.length > MAX_PEOPLE) {
      issues.push({ path, message: `한 번에 ${MAX_PEOPLE}명까지 바꿀 수 있습니다` })
      continue
    }
    out.push({ propertyId: change.propertyId, add, remove })
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, changes: out }
}

/**
 * 더하기 · 빼기를 지금 값(`stored` — 그 칸의 저장된 값)에 적용한 통째 값 — 빼고, 없던 사람만 뒤에 더한다(순서는 그대로). **바뀌는 칸만**
 * 돌려준다 — 이미 든 사람을 더하거나 없는 사람을 빼면 쓰지 않는다(행의 판이 오르지 않는다). 상한은 셀 검증(`validateCellValue`)이 본다.
 */
export function applyPeopleChanges(
  changes: readonly PeopleChange[],
  stored: ReadonlyMap<string, unknown>,
): { readonly propertyId: string; readonly value: CellValue }[] {
  return changes.flatMap((change) => {
    const current = peopleIdsOf([stored.get(change.propertyId)])
    const remove = new Set(change.remove)
    const kept = current.filter((id) => !remove.has(id))
    const next = [...kept, ...change.add.filter((id) => !kept.includes(id))]
    if (next.length === current.length && next.every((id, i) => id === current[i])) return []
    return [{ propertyId: change.propertyId, value: { type: 'people', people: next.map((id) => ({ id })) } satisfies CellValue }]
  })
}

/**
 * 템플릿의 사람 칸에서 떠난 사람을 뺀다(정본 ⑫ⓓ) — 새 행에서는 새로 드는 사람이라 거부되어, 그대로 두면 그 템플릿으로 영영 행을 만들지
 * 못한다(지운 옵션을 무시하는 `withoutMissingOptions` 와 같은 까닭). 다른 칸은 그대로다.
 */
export async function withoutLeftPeople(
  tx: Tx,
  workspaceId: string,
  cells: readonly { readonly propertyId: string; readonly value: CellValue }[],
): Promise<{ readonly propertyId: string; readonly value: CellValue }[]> {
  const ids = peopleIdsOf(cells.map((cell) => cell.value))
  if (ids.length === 0) return [...cells]
  const active = await peopleNamesIn(tx, workspaceId, ids)
  return cells.map((cell) =>
    cell.value.type === 'people' && cell.value.people.some((person) => !active.has(person.id))
      ? { ...cell, value: { type: 'people', people: cell.value.people.filter((person) => active.has(person.id)) } satisfies CellValue }
      : cell,
  )
}

// ── 화면 (6g-2) ───────────────────────────────────────────────────────

/** 사람 칸의 고르개가 보이는 한 사람. */
export type PersonCandidate = { readonly id: string; readonly name: string; readonly guest: boolean }

/** 고르개 후보의 상한 — 이름 · 메일로 좁힌다. */
export const PEOPLE_CANDIDATE_LIMIT = 30

/** 이름 지도 한 번에 묻는 사람 수의 상한. */
export const PEOPLE_NAMES_LIMIT = 200

/**
 * 사람 칸의 고르개 후보 — 이 워크스페이스의 활동 중인 사람(멤버 · 게스트)을 이름 · 메일로. **게스트에게는 없다** — 멤버 목록을 받을 수 없는
 * 사람에게 고르개가 그 목록을 흘리면 안 된다(7d-2 · `@` 후보와 같다). 게스트는 칸에 든 사람을 빼기만 한다.
 */
export async function searchPeople(ctx: SessionContext, rawQuery: string): Promise<PersonCandidate[]> {
  if (!canListMembers(ctx.role)) return []
  const query = rawQuery.trim().toLowerCase()
  return (await listMembers(ctx.workspaceId))
    .filter((m) => m.status === 'active')
    .filter((m) => query === '' || m.name.toLowerCase().includes(query) || (m.email ?? '').toLowerCase().includes(query))
    .slice(0, PEOPLE_CANDIDATE_LIMIT)
    .map((m) => ({ id: m.userId, name: m.name, guest: m.role === 'guest' }))
}

/**
 * 칸에 든 사람의 이름 — 활동 중인 사람만(떠난 사람은 지도에 없다 · 화면이 "떠난 사용자"). id 를 아는 사람에게 이름을 준다 — `@` 멘션의
 * 이름 지도(`loadMentionLabels`)와 같은 태도다(id 는 짐작할 수 없다).
 */
export async function loadPeopleNames(ctx: SessionContext, ids: readonly string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter(isUuid))].slice(0, PEOPLE_NAMES_LIMIT)
  if (wanted.length === 0) return {}
  return Object.fromEntries(await withReadTransaction((tx) => peopleNamesIn(tx, ctx.workspaceId, wanted)))
}

