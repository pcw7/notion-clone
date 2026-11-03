/**
 * 편집 이력 표시 — 만든 사람 · 마지막으로 고친 사람의 이름 · 시각 (37번 트랙 ED-1 · F-11-15)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강 ED-1] 편집 이력 표시
 *
 * 11 F-11-15 *"모든 블록 · 페이지가 누가 만들었고 누가 마지막으로 고쳤는지를 자기 자신에 들고 있다 — 이력이 아니라 최신 1건"*. 칸은 이미 있다
 * (`block.created_by` · `created_at` · `last_edited_by` · `last_edited_at` — 본문 저장이 페이지 행의 것을 올린다). 여기는 그것을 사람에게 보이는 말로 바꾼다.
 *
 * **이름은 멤버 목록을 받을 수 있는 역할에게만**(`canListMembers` — 게스트는 아니다 · 11 *"다른 멤버의 실명을 노출한다 — 게스트에게 숨길지가 정책
 * 결정 포인트"* · 정본 §3.3 게스트 ⑦ 과 같은 규칙). 게스트에게는 "멤버" 로 적는다. 사람이 지워졌어도 id 는 남는다 — 이름을 못 찾으면 "알 수 없는 사람".
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction } from '../db/tx.ts'
import { canListMembers } from '../workspace/list.ts'

/** 이 사람들의 이름 — 멤버 목록을 받을 수 없는 역할(게스트)이면 비어 있다. */
export async function editorNames(ctx: SessionContext, ids: readonly (string | null)[]): Promise<ReadonlyMap<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
  if (wanted.length === 0 || !canListMembers(ctx.role)) return new Map()
  const rows = await withReadTransaction((tx) => tx.query<{ id: string; name: string }>(`SELECT id, name FROM "user" WHERE id = ANY($1::uuid[])`, [wanted]))
  return new Map(rows.map((row) => [row.id, row.name]))
}

/** 사람 하나의 이름표 — 이름이 있으면 그 이름 · 게스트에게는 "멤버" · 찾지 못하면 "알 수 없는 사람". */
export function editorLabel(id: string | null, names: ReadonlyMap<string, string>, canSeeNames: boolean): string {
  if (!canSeeNames) return '멤버'
  if (id === null) return '알 수 없는 사람'
  const name = names.get(id)
  return name === undefined || name.trim() === '' ? '알 수 없는 사람' : name
}

/** 시각 — 열람자의 시간대로 · 날짜와 시각(한국어 · 분까지 — 11 *"타임스탬프는 분 단위로 내림"*). */
export function formatEditStamp(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(at)
}
