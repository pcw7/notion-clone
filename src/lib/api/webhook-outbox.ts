/**
 * 공개 API 웹훅의 아웃박스 쓰기 — 이벤트를 만드는 쪽이 **자기 트랜잭션 안에서** 부른다 (API-8 · F-09-09)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫ · 마이그레이션 0151 `api_webhook_event`
 *
 * 이 워크스페이스에서 그 종류를 고른 **켜진** 구독마다 한 줄(`pending` · 첫 시도는 `occurredAt`). 같은 이벤트는 모든 구독에 같은 `event_id`
 * 로 간다(받는 쪽의 멱등 키). 쓰기가 되돌려지면 줄도 사라진다 — 커밋된 것만 나간다. **묶지 않는 낮은 쓰기**다 — 앱의 명령은 `webhook-emit.ts`
 * (API-9 — 트랜잭션마다 조회 하나 · 커밋 직전 · 묶기)를 부른다. 여기는 그 모양을 그대로 쓰는 검사가 쓴다.
 *
 * 여기서는 권한을 보지 않는다 — **보낼 때마다** 워커가 토큰의 컨텍스트를 다시 얻고 그 사람이 대상을 볼 수 있는지 다시 묻는다(볼 수 없으면
 * `skipped`). 만료한 토큰의 구독 · 꺼진 워크스페이스에는 쓰지 않는다(어차피 건너뛸 줄을 쌓지 않는다).
 */

import { randomUUID } from 'node:crypto'

import type { Tx } from '../db/tx.ts'
import { webhooksOffSql } from '../notification/webhook-switch.ts'
import { isWebhookEventType } from './webhook-events.ts'

export type WebhookEntityType = 'page' | 'block' | 'database' | 'data_source' | 'comment'

export type ApiWebhookEventInput = {
  readonly workspaceId: string
  /** 카탈로그의 종류(`webhook-events.ts`). `test` 는 여기로 오지 않는다. */
  readonly type: string
  readonly entity: { readonly id: string; readonly type: WebhookEntityType }
  /** 행위자 — 사람의 id. */
  readonly authors: readonly string[]
  readonly data?: Readonly<Record<string, unknown>>
  readonly occurredAt: Date
}

/** 쌓은 줄의 수와 이벤트 id. */
export async function emitApiWebhookEventIn(tx: Pick<Tx, 'query'>, event: ApiWebhookEventInput): Promise<{ readonly eventId: string; readonly queued: number }> {
  if (!isWebhookEventType(event.type)) throw new Error(`모르는 웹훅 이벤트: ${event.type}`)
  const eventId = randomUUID()
  const rows = await tx.query<{ id: string }>(
    `INSERT INTO api_webhook_event (id, subscription_id, workspace_id, event_id, type, entity_id, entity_type, authors, data, occurred_at, status, next_attempt_at)
     SELECT gen_random_uuid(), s.id, s.workspace_id, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, 'pending', $8
       FROM api_webhook_subscription s
       JOIN api_token t ON t.id = s.api_token_id
      WHERE s.workspace_id = $1 AND s.status = 'active' AND $3 = ANY(s.event_types)
        AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())
        AND NOT ${webhooksOffSql('s.workspace_id')}
     RETURNING id`,
    [
      event.workspaceId,
      eventId,
      event.type,
      event.entity.id,
      event.entity.type,
      JSON.stringify(event.authors.map((id) => ({ id, type: 'person' }))),
      JSON.stringify(event.data ?? {}),
      event.occurredAt,
    ],
  )
  return { eventId, queued: rows.length }
}
