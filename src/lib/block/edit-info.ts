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
import { isUuid } from '../ids.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
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

/** 해당 시간대의 달력 날짜(Y-M-D)를 하루 단위 정수로 — 하루 차이를 구할 때 쓴다. */
function zonedDayNumber(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d)
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
  return Math.floor(Date.UTC(get('year'), get('month') - 1, get('day')) / 86_400_000)
}

/**
 * 가까운 편집은 상대로(37번 트랙 ED-3 · 정본 §3.4 [보강 ED-3] ①) — 1분 안 "방금"(앞날도) · 1시간 안 "N분 전" ·
 * 열람자의 오늘 "오늘 오후 3:21" · 어제 "어제 오후 3:21" · 그보다 오래면 절대 시각. 오늘 · 어제는 **열람자 시간대의 날짜**로 가른다.
 */
export function formatEditStampRelative(at: Date, now: Date, timeZone: string): string {
  const diff = now.getTime() - at.getTime()
  if (diff < 60_000) return '방금'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  const days = zonedDayNumber(now, timeZone) - zonedDayNumber(at, timeZone)
  if (days === 0 || days === 1) {
    const time = new Intl.DateTimeFormat('ko-KR', { timeStyle: 'short', timeZone }).format(at)
    return `${days === 0 ? '오늘' : '어제'} ${time}`
  }
  return formatEditStamp(at, timeZone)
}

/** 블록 하나의 마지막 편집(ED-2) — 이름표와 시각. */
export type BlockEditInfo = { readonly label: string; readonly at: Date }

/**
 * 페이지 본문 안 블록 하나의 마지막 편집(37번 트랙 ED-2 · 정본 §3.4 [보강 ED-2]).
 *
 * 문은 페이지 화면과 같다 — 살아 있는 페이지 · `view`. 아니면 없는 페이지와 같은 답(`not_found`).
 * 블록은 **이 페이지의 본문**이어야 한다 — 조상 경로에 이 페이지가 있고, 그 아래에 다른 페이지가 끼지 않고, 권한 범위가 같다(하위 페이지의 본문은
 * 그 페이지에게 묻는다). 아니거나 아직 저장되지 않은 블록(방금 친 줄)이면 `edited: null`.
 */
export async function readBlockEditInfo(
  ctx: SessionContext,
  pageId: string,
  blockId: string,
): Promise<{ readonly ok: true; readonly edited: BlockEditInfo | null } | { readonly ok: false; readonly reason: 'not_found' }> {
  if (!isUuid(pageId)) return { ok: false, reason: 'not_found' }
  const found = await withReadTransaction(async (tx) => {
    const page = await tx.queryMaybe<{ perm_scope_id: string }>(
      `SELECT perm_scope_id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
      [pageId, ctx.workspaceId],
    )
    if (page === null || !can(await effectiveCaps(tx, ctx, pageId), 'view')) return null
    if (!isUuid(blockId)) return { row: null }
    const row = await tx.queryMaybe<{ last_edited_by: string | null; last_edited_at: Date }>(
      `SELECT b.last_edited_by, b.last_edited_at
         FROM block b
        WHERE b.id = $1 AND b.workspace_id = $2 AND b.type <> 'page' AND b.perm_scope_id = $4
          AND $3::uuid = ANY(b.ancestor_path)
          AND NOT EXISTS (
                SELECT 1 FROM block a
                 WHERE a.id = ANY(b.ancestor_path[array_position(b.ancestor_path, $3::uuid) + 1:])
                   AND a.type = 'page')`,
      [blockId, ctx.workspaceId, pageId, page.perm_scope_id],
    )
    return { row }
  })
  if (found === null) return { ok: false, reason: 'not_found' }
  if (found.row === null) return { ok: true, edited: null }
  const names = await editorNames(ctx, [found.row.last_edited_by])
  return { ok: true, edited: { label: editorLabel(found.row.last_edited_by, names, canListMembers(ctx.role)), at: found.row.last_edited_at } }
}
