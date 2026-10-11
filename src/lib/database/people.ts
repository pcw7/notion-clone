/**
 * 사람 칸 — 이 워크스페이스의 사람인가 · 이름 (게시 · 공유 6g-1 · F-03-07)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 사람 속성 ②⑥
 *
 * 값은 id 만이다. **쓸 때** 그 id 들이 이 워크스페이스의 활동 중인 사람(멤버 · 게스트)인지 보고(`peopleIssuesIn`), **읽을 때** 이름을
 * 사람의 표에서 찾는다(`peopleNamesIn`). 떠난 사람(`removed` · 정지)은 이름 지도에 없다 — 화면은 "떠난 사용자" 로 그린다.
 */

import type { Tx } from '../db/tx.ts'
import type { ValidationIssue } from '../contracts/rich-text.ts'
import type { CellValue } from './property-types.ts'

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
 */
export async function peopleIssuesIn(
  tx: Tx,
  workspaceId: string,
  cells: readonly { readonly propertyId: string; readonly value: CellValue }[],
): Promise<ValidationIssue[]> {
  const people = cells.filter((cell) => cell.value.type === 'people')
  if (people.length === 0) return []
  const known = await peopleNamesIn(tx, workspaceId, peopleIdsOf(people.map((cell) => cell.value)))
  const issues: ValidationIssue[] = []
  for (const cell of people) {
    if (cell.value.type !== 'people') continue
    for (const [i, person] of cell.value.people.entries()) {
      if (!known.has(person.id)) issues.push({ path: `cells.${cell.propertyId}.people[${i}].id`, message: '이 워크스페이스의 사람이 아닙니다' })
    }
  }
  return issues
}
