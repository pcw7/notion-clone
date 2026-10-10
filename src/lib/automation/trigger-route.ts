/**
 * DB automation 의 일 받기 — 쓰기와 같은 트랜잭션에서 (자동화 5b-2 · F-08-09)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] DB automation — 받기 · 실행 ⓐ ⓑ ⓒ · 마이그레이션 0080
 *
 * 행 쓰기(`row.ts`)가 부른다 — 이 파일은 무거운 모듈을 부르지 않는다(행 · 템플릿 모듈과 순환한다).
 *
 *   - `routeRowAdded` — 행이 생겼다. 그 표의 켜진 DB automation 중 `page_added` 를 보는 것마다 묶음에 쌓는다.
 *   - `routeCellsEdited` — 셀이 바뀐다(**쓰기 전에** 부른다). 그 속성을 보는 automation 마다 묶음에 쌓고 **창 전 값**을 붙든다 — 창 안의
 *     다음 일은 그것을 덮지 않는다(가장 이른 값이 남는다 · `EXCLUDED.before || automation_event.before`).
 *
 * 자동화가 쓴 것(`origin = 'automation'`)은 받지 않는다 — 자동화는 자동화를 깨우지 않는다. 버튼이 쓴 것(`button`)은 받는다(08 F-08-10).
 * 템플릿 행은 받지 않는다. 그 표에 보는 automation 이 없으면 질의 하나로 끝난다.
 */

import type { Tx } from '../db/tx.ts'

/** 3초 창(08 *"three second window"*). */
export const AUTOMATION_WINDOW_SECONDS = 3

/** 쓰기의 출처 — 사람 · 버튼 · 자동화(정본 ⓒ). */
export type WriteOrigin = 'user' | 'button' | 'automation'

/** 행이 생겼다. 쌓은 묶음의 수. */
export async function routeRowAdded(
  tx: Tx,
  input: { readonly dataSourceId: string; readonly pageId: string; readonly origin: WriteOrigin },
): Promise<number> {
  if (input.origin === 'automation') return 0
  const routed = await tx.query<{ id: string }>(
    `INSERT INTO automation_event (id, automation_id, page_id, page_added, window_end, status)
     SELECT gen_random_uuid(), a.id, $2, true, now() + make_interval(secs => $3), 'collecting'
       FROM automation a
      WHERE a.host_data_source_id = $1 AND a.kind = 'db_automation' AND a.enabled
        AND EXISTS (SELECT 1 FROM automation_trigger t WHERE t.automation_id = a.id AND t.type = 'page_added')
        AND NOT EXISTS (SELECT 1 FROM page WHERE id = $2 AND is_template)
     ON CONFLICT (automation_id, page_id) WHERE status = 'collecting'
     DO UPDATE SET page_added = true
     RETURNING id`,
    [input.dataSourceId, input.pageId, AUTOMATION_WINDOW_SECONDS],
  )
  return routed.length
}

/** 셀이 바뀐다 — **쓰기 전에** 부른다(창 전 값을 읽는다). 쌓은 묶음의 수. */
export async function routeCellsEdited(
  tx: Tx,
  input: { readonly dataSourceId: string; readonly pageId: string; readonly propertyIds: readonly string[]; readonly origin: WriteOrigin },
): Promise<number> {
  if (input.origin === 'automation' || input.propertyIds.length === 0) return 0
  const routed = await tx.query<{ id: string }>(
    `WITH watching AS (
       SELECT a.id AS automation_id, array_agg(DISTINCT t.property_id) AS props
         FROM automation a
         JOIN automation_trigger t ON t.automation_id = a.id
        WHERE a.host_data_source_id = $1 AND a.kind = 'db_automation' AND a.enabled
          AND t.type = 'property_edited' AND t.property_id = ANY($3::text[])
          AND NOT EXISTS (SELECT 1 FROM page WHERE id = $2 AND is_template)
        GROUP BY a.id
     ),
     snap AS (
       -- 그 automation 이 보는(그리고 이번에 바뀌는) 속성의 지금 값 — 셀이 없으면 null(비어 있었다)
       SELECT w.automation_id, jsonb_object_agg(prop.id, v.value) AS before
         FROM watching w
         CROSS JOIN LATERAL unnest(w.props) AS prop(id)
         LEFT JOIN page_property_value v ON v.page_id = $2 AND v.property_id = prop.id
        GROUP BY w.automation_id
     )
     INSERT INTO automation_event (id, automation_id, page_id, before, window_end, status)
     SELECT gen_random_uuid(), s.automation_id, $2, s.before, now() + make_interval(secs => $4), 'collecting'
       FROM snap s
     ON CONFLICT (automation_id, page_id) WHERE status = 'collecting'
     DO UPDATE SET before = EXCLUDED.before || automation_event.before
     RETURNING id`,
    [input.dataSourceId, input.pageId, input.propertyIds, AUTOMATION_WINDOW_SECONDS],
  )
  return routed.length
}
