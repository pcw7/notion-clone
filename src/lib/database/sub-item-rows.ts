/**
 * 하위 항목 `+` — 부모 밑에 행을 바로 만든다 (DB 심화 2b-2b조각 · F-03-18 시나리오 2 *"`+` 로 하위 행을 직접 추가"*)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 하위 항목
 *
 * 행 만들기(`row.ts` `createRowIn`)와 부모 두기(`relation.ts` `linkRowsIn`)를 **한 트랜잭션**에서 부른다. 두 요청으로 나누면 둘째가
 * 실패할 때 부모 없는 빈 행이 최상위에 남는다. 규칙은 두 함수의 것을 그대로 쓴다 — 권한(행 만들기 `create_child` · 연결 `edit_content`) ·
 * 순환 · 거울상 · 잠금. 어느 쪽이 거부하면 트랜잭션이 되돌린다(`withCommandTransaction`).
 *
 * `relation.ts` 가 `sub-items.ts` 를 끌어오므로 이 명령은 따로 둔다(모듈 순환을 만들지 않는다).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { linkRowsIn, type RelationResult } from './relation.ts'
import { createRowIn, type CreateRowInput, type RowSummary } from './row.ts'
import { readSubItemPair } from './sub-items.ts'

/**
 * `parentId` 밑에 새 행을 만든다. 하위 항목이 꺼진 표면 `invalid_value` 다(부모를 둘 길이 없다). 부모가 이 표의 살아 있는 행이
 * 아니면 연결이 거부한다(`invalid_value` — 없는 행과 같은 답).
 */
export async function createSubItem(
  ctx: SessionContext,
  dataSourceId: string,
  parentId: string,
  input: CreateRowInput = {},
): Promise<RelationResult<RowSummary>> {
  if (!isUuid(parentId)) return { ok: false, reason: 'invalid_value' }
  return withCommandTransaction(async (tx) => {
    const pair = await readSubItemPair(tx, dataSourceId)
    if (pair === null) {
      return { ok: false, reason: 'invalid_value', issues: [{ path: 'parent', message: '하위 항목이 꺼진 표입니다' }] } as const
    }
    const created = await createRowIn(tx, ctx, dataSourceId, input)
    if (!created.ok) {
      // 행 만들기의 거부를 연결의 말로 옮긴다 — 둘은 같은 이름의 이유를 쓴다(not_found · forbidden · locked · invalid_value).
      // 낡은 스키마 · 버전은 연결에 없는 이유다 — 입력 문제로 접는다.
      const reason = created.reason === 'schema_conflict' || created.reason === 'version_conflict' ? 'invalid_value' : created.reason
      return { ok: false, reason, ...(created.issues ? { issues: created.issues } : {}) } as const
    }
    return linkRowsIn(tx, ctx, created.value.id, pair.parentPropertyId, [parentId], [])
  })
}
