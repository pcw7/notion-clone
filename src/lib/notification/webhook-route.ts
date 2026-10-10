/**
 * 이벤트를 웹훅의 묶음으로 — 활동을 남기는 그 트랜잭션에서 (히스토리 · 활동 4e-2 · F-11-19)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 페이지 웹훅 ⑤ ⑦ · 보내기 ⓐ ⓑ
 *
 * `recordActivity` 가 허용 목록의 이벤트마다 부른다. 그 이벤트의 페이지와 **권한 범위가 같은**(`perm_scope_id` — 같은 범위의 노드는
 * 정의상 권한이 같다) 자기 · 조상 페이지 중 웹훅이 걸린 **가장 가까운** 페이지를 찾고, 그 페이지의 **켜진** 웹훅마다 모으는 묶음
 * (웹훅마다 하나 — `ux_webhook_delivery_collecting`)에 이벤트를 더한다. 묶음이 없으면 만들고 창은 지금부터 5분.
 *
 *   - 범위가 다른 아래 페이지(상속을 끊었거나 따로 공유한 것)의 활동은 위의 웹훅으로 가지 않는다 — 그 페이지를 볼 수 없는 사람이 건
 *     웹훅으로 새지 않게(ⓑ).
 *   - 가장 가까운 페이지의 웹훅이 모두 멈췄으면 아무 데도 가지 않는다 — 더 위로 올라가지 않는다(⑤ *"가장 가까운 연결 하나만"*).
 *   - 웹훅이 하나도 없는 워크스페이스는 질의 한 번으로 끝난다(`page_webhook` 의 그 페이지들만 본다).
 *
 * 로그를 나중에 거꾸로 훑지 않는 까닭: 커밋 순서와 시각이 어긋나면 훑는 쪽이 이벤트를 건너뛴다. 같은 트랜잭션이면 이벤트와 묶음이
 * 함께 커밋되거나 함께 사라진다.
 */

import type { Tx } from '../db/tx.ts'

/** 모으는 창(정본 ⑥ — 11 *"시간 윈도우(5분)"*). */
export const WEBHOOK_WINDOW_MINUTES = 5

/** 이 이벤트를 웹훅의 묶음에 더한다. 더한 웹훅의 수. */
export async function routeToWebhooks(tx: Tx, input: { readonly eventId: string; readonly pageId: string }): Promise<number> {
  const routed = await tx.query<{ webhook_id: string }>(
    `WITH ev AS (
       SELECT id, ancestor_path, perm_scope_id FROM block WHERE id = $1
     ),
     nearest AS (
       SELECT a.id AS page_id
         FROM ev
         CROSS JOIN LATERAL unnest(ev.ancestor_path || ev.id) WITH ORDINALITY AS a(id, depth)
         JOIN block p ON p.id = a.id AND p.type = 'page' AND p.perm_scope_id = ev.perm_scope_id
        WHERE EXISTS (SELECT 1 FROM page_webhook w WHERE w.page_id = a.id)
        ORDER BY a.depth DESC
        LIMIT 1
     )
     INSERT INTO webhook_delivery (id, webhook_id, event_ids, window_end, status)
     SELECT gen_random_uuid(), w.id, ARRAY[$2::uuid], now() + make_interval(mins => $3), 'collecting'
       FROM page_webhook w
       JOIN nearest n ON n.page_id = w.page_id
      WHERE w.paused_at IS NULL
     ON CONFLICT (webhook_id) WHERE status = 'collecting'
     DO UPDATE SET event_ids = webhook_delivery.event_ids || EXCLUDED.event_ids
     RETURNING webhook_id`,
    [input.pageId, input.eventId, WEBHOOK_WINDOW_MINUTES],
  )
  return routed.length
}
