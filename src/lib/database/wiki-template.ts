/**
 * 위키 데이터베이스 템플릿 — VF-5 (F-02-23)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 VF-1] ⑧ · [VF-5] 템플릿의 모양
 *
 * 방금 만든 인라인 데이터베이스(`createInlineDatabase` 의 같은 트랜잭션)에 위키의 모양을 입힌다 — 속성 소유자 · 태그 · 검증, 뷰 셋
 * 모든 페이지 · 내가 소유한 페이지 · 검증 필요. 명령(`addProperty` · `createView`)을 부르지 않고 그 안쪽 함수를 쓴다 — 명령마다 자기
 * 트랜잭션을 열기 때문이다. 권한은 부른 쪽(부모 페이지의 `create_child`)이 이미 물었다.
 *
 * 낮은 플랜(검증 속성이 없는 플랜)은 검증 속성과 "검증 필요" 뷰 없이 만든다 — 위키 자체는 플랜을 가리지 않는다.
 */

import { randomUUID } from 'node:crypto'

import type { Tx } from '../db/tx.ts'
import { entitlement } from '../billing/entitlement.ts'
import { orderKeyBetween } from '../block/order-key.ts'
import { ME_NODE, type FilterNode } from './filter.ts'
import { ensureVerificationOwner, insertPropertyIn, type PropertyResult } from './property.ts'
import { seedViewProperties } from './view.ts'

export const WIKI_DATABASE_NAME = '위키'
export const WIKI_VIEW_ALL = '모든 페이지'
export const WIKI_VIEW_MINE = '내가 소유한 페이지'
export const WIKI_VIEW_NEEDS_VERIFY = '검증 필요'
export const WIKI_OWNER_PROPERTY = '소유자'
export const WIKI_TAG_PROPERTY = '태그'
export const WIKI_VERIFY_PROPERTY = '검증'

/** 안쪽 함수의 실패(이름 겹침 등)는 새 표에서는 일어나지 않는다 — 일어나면 트랜잭션째 되돌린다. */
function must(v: string | PropertyResult<never>): string {
  if (typeof v !== 'string') throw new Error(`위키 템플릿 속성을 만들지 못했다: ${JSON.stringify(v)}`)
  return v
}

export async function applyWikiTemplate(
  tx: Tx,
  input: { readonly workspaceId: string; readonly databaseId: string; readonly dataSourceId: string; readonly defaultViewId: string },
): Promise<void> {
  const { workspaceId, databaseId, dataSourceId, defaultViewId } = input

  const ownerId = must(await insertPropertyIn(tx, dataSourceId, { name: WIKI_OWNER_PROPERTY, type: 'people', description: null, config: {} }))
  must(await insertPropertyIn(tx, dataSourceId, { name: WIKI_TAG_PROPERTY, type: 'select', description: null, config: {} }))

  // 검증 속성 — 플랜이 허락할 때만(`addProperty` 의 검사와 같다). 소유자는 방금 만든 것을 다시 쓴다(`ensureVerificationOwner`).
  let verifyId: string | null = null
  if (await entitlement(workspaceId, 'database.verification', tx)) {
    const owner = must(await ensureVerificationOwner(tx, dataSourceId))
    verifyId = must(
      await insertPropertyIn(tx, dataSourceId, {
        name: WIKI_VERIFY_PROPERTY, type: 'verification', description: null, config: { owner_property_id: owner },
      }),
    )
  }

  // 뷰 셋 — 기본 뷰의 이름을 바꾸고 나머지를 맨 뒤에 붙인다
  await tx.query(`UPDATE view SET name = $2, updated_at = now() WHERE id = $1`, [defaultViewId, WIKI_VIEW_ALL])
  const extra: { name: string; filter: FilterNode }[] = [
    { name: WIKI_VIEW_MINE, filter: { op: 'and', children: [{ property_id: ownerId, operator: 'contains', value: ME_NODE }] } },
  ]
  if (verifyId !== null) {
    extra.push({ name: WIKI_VIEW_NEEDS_VERIFY, filter: { op: 'and', children: [{ property_id: verifyId, operator: 'is_not', value: 'verified' }] } })
  }
  let last = (await tx.queryOne<{ order_idx: string }>(`SELECT order_idx FROM view WHERE id = $1`, [defaultViewId])).order_idx
  for (const v of extra) {
    const viewId = randomUUID()
    last = orderKeyBetween(last, null)
    await tx.query(
      `INSERT INTO view (id, owner_kind, database_id, data_source_id, name, type, order_idx, filter, configuration, created_at, updated_at)
       VALUES ($1, 'database_view', $2, $3, $4, 'table', $5, $6::jsonb, '{}'::jsonb, now(), now())`,
      [viewId, databaseId, dataSourceId, v.name, last, JSON.stringify(v.filter)],
    )
    await seedViewProperties(tx, viewId, dataSourceId)
  }
}
