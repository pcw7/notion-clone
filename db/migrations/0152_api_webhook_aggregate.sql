-- 공개 API 웹훅 이벤트 — 묶기(aggregation)의 창 (API-9 · F-09-09)
--
-- 정본: docs/research/00-canonical-data-model.md §3.1 끝 [보강 API-1] ⑬ · §3.10 `api_webhook_event`
--       09-api-integrations.md F-09-09 — "집계는 (subscription_id, entity_id, type) 키의 debounce 윈도우" · "댓글 이벤트는 집계되지 않는다"
--
-- ① `window_started_at` — 묶는 중인 줄(값은 창을 연 첫 변경의 시각). 묶는 종류 넷(page.content_updated · page.properties_updated ·
--    data_source.content_updated · data_source.schema_updated — `lib/api/webhook-aggregate.ts` 와 같은 목록)만 · 기다리는 줄 · 시도 전에만.
--    만드는 쪽(`lib/api/webhook-emit.ts`)이 이 줄에 합친다(목록 · 저자 · 마지막 시각). 워커가 보내기 직전에 비운다(봉인) — 그 뒤의 변경은
--    새 줄로 간다(보낸 것에 합치지 않는다).
-- ② 다음 시도는 마지막 변경 + 15초 — 단 창을 연 뒤 2분을 넘지 않는다(잇달아 고쳐도 2분마다 나간다 · CHECK 로 올린다).
-- ③ 한 구독 · 한 대상 · 한 종류에 묶는 줄은 하나(부분 UNIQUE) — 동시에 연 둘은 하나가 이기고 다른 쪽은 거기에 합친다.

ALTER TABLE api_webhook_event ADD COLUMN window_started_at timestamptz NULL;

ALTER TABLE api_webhook_event ADD CONSTRAINT ck_api_webhook_event_window CHECK (
  window_started_at IS NULL OR (
    status = 'pending' AND attempts = 0
    AND type IN ('page.content_updated', 'page.properties_updated', 'data_source.content_updated', 'data_source.schema_updated')
  )
);
ALTER TABLE api_webhook_event ADD CONSTRAINT ck_api_webhook_event_window_order CHECK (
  window_started_at IS NULL OR window_started_at <= occurred_at
);
ALTER TABLE api_webhook_event ADD CONSTRAINT ck_api_webhook_event_window_cap CHECK (
  window_started_at IS NULL OR next_attempt_at <= window_started_at + interval '2 minutes'
);

CREATE UNIQUE INDEX ux_api_webhook_event_collecting ON api_webhook_event (subscription_id, entity_id, type) WHERE window_started_at IS NOT NULL;

COMMENT ON COLUMN api_webhook_event.window_started_at IS
  'API-9: 묶는 중인 줄의 창을 연 시각 — 묶는 종류 넷 · 기다림 · 시도 전 · 다음 시도는 마지막 변경 + 15초(창 + 2분 상한) · 보내기 직전에 비운다.';
