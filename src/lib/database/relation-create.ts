/**
 * relation 칸에서 새 행을 만들며 잇는다 — 행 고르기의 "+ 새로 만들기" (§7 정리 10n-41 · F-03-10 *"셀에서 + 새 페이지"*)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] `relation_edge` 의 규칙 — [보강 10n-41] 만들며 잇기
 *
 * 찾던 글자가 대상 표에 없으면 그 글자를 제목으로 대상 표에 행을 만들고 이 칸에 잇는다. 행 만들기(`row.ts` `createRowIn`)와 잇기
 * (`relation.ts` `linkRowsIn`)를 **한 트랜잭션**에서 부른다 — 하위 항목 `+`(`sub-item-rows.ts`)와 같은 모양이다. 두 요청으로 나누면 둘째가
 * 실패할 때 아무 데도 이어지지 않은 행이 대상 표에 남는다. 규칙은 두 함수의 것을 그대로 쓴다 — 칸을 고칠 권한 · 잠금(`relationTargetIn`),
 * 대상 표에 만들 권한(행 만들기), 제한 `one` 의 교체 · 거울상 · 순환(잇기). 어느 쪽이 거부하면 트랜잭션이 되돌린다.
 *
 * 대상 표를 볼 수 없으면 만들지 않는다(`invalid_value`) — 보이지 않는 표에 행을 만들면 만든 사람도 그 행을 볼 수 없다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { titleFromPlainText } from '../block/page.ts'
import { withCommandTransaction } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { linkRowsIn, relationTargetIn, type RelationResult } from './relation.ts'
import { createRowIn, type RowSummary } from './row.ts'

export type CreatedLink = {
  /** 이 칸의 행 — 연결이 바뀌었다(캐시의 relation 칸이 갱신돼 있다). */
  readonly row: RowSummary
  /** 대상 표에 새로 만든 행. */
  readonly created: RowSummary
}

export async function createLinkedRow(
  ctx: SessionContext,
  rowId: string,
  propertyId: string,
  input: { readonly title?: unknown },
): Promise<RelationResult<CreatedLink>> {
  const title = titleFromPlainText(input.title)
  if (title.length === 0) return { ok: false, reason: 'invalid_value', issues: [{ path: 'title', message: '제목이 있어야 합니다' }] }
  if (!isUuid(rowId)) return { ok: false, reason: 'not_found' }

  return withCommandTransaction(async (tx) => {
    const target = await relationTargetIn(tx, ctx, rowId, propertyId)
    if (typeof target !== 'string') return target
    const titleProperty = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM property WHERE data_source_id = $1 AND type = 'title' AND deleted_at IS NULL LIMIT 1`,
      [target],
    )
    const created = await createRowIn(tx, ctx, target, {
      cells: titleProperty === null ? [] : [{ propertyId: titleProperty.id, value: { type: 'title', title } }],
    })
    if (!created.ok) {
      // 행 만들기의 거부를 연결의 말로 옮긴다(`sub-item-rows.ts` 와 같다) — 낡은 스키마 · 버전은 연결에 없는 이유라 입력 문제로 접는다.
      const reason = created.reason === 'schema_conflict' || created.reason === 'version_conflict' ? 'invalid_value' : created.reason
      return { ok: false, reason, ...(created.issues ? { issues: created.issues } : {}) } as const
    }
    const linked = await linkRowsIn(tx, ctx, rowId, propertyId, [created.value.id], [])
    if (!linked.ok) return linked
    return { ok: true, value: { row: linked.value, created: created.value } } as const
  })
}
