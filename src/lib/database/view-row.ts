/**
 * 뷰에서 행 만들기 — 칸 채우기 + relation 잇기를 한 트랜잭션으로 (§7 정리 10n-47 · F-04-09 · F-03-10)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 필터가 걸린 뷰에서 만든 행 ⑧ · [보강 10n-47]
 *
 * 필터가 걸린 뷰에서 만든 행은 그 필터가 정하는 값을 받는다. 칸(EAV)은 `createRowIn` 이 넣으며 채우고(`viewPrefillIn`), relation 은
 * 값이 엣지라 행을 넣은 **뒤에** 연결하기로 잇는다(`linkPrefilledIn`). 둘을 한 트랜잭션에 묶어 "행은 생겼는데 연결은 없다" 를 남기지
 * 않는다 — 이을 수 없는 칸은 빠질 뿐 행은 생긴다(⑥). 이 모듈이 따로 있는 까닭: `relation.ts` 가 `row.ts` 를 가져오므로 거꾸로는 순환이다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction } from '../db/tx.ts'
import { linkPrefilledIn } from './relation.ts'
import { createRowIn, type CreateRowInput, type RowResult, type RowSummary } from './row.ts'

export async function createRowInView(
  ctx: SessionContext,
  dataSourceId: string,
  input: CreateRowInput,
): Promise<RowResult<RowSummary>> {
  return withCommandTransaction(async (tx) => {
    const created = await createRowIn(tx, ctx, dataSourceId, input)
    if (!created.ok) return created
    return { ok: true, value: await linkPrefilledIn(tx, ctx, created.value, dataSourceId, input.viewFilter) } as const
  })
}
