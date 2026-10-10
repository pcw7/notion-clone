-- 페이지 웹훅 — 히스토리 · 활동 4e-1조각 (F-11-19)
--
-- 정본: docs/research/00-canonical-data-model.md §3.8 [보강] 페이지 웹훅 — 활동을 바깥으로 (DDL · ② ③ ④ ⑦ ⑧)
--       마스터 문서 비고 20 *"`send_webhook` 하나만 … Slack 은 incoming webhook URL 직결(OAuth 생략). SSRF 방어만 제대로 하면 된다"*
--
-- ① `page_webhook` — 페이지의 활동을 보낼 URL. URL 은 봉인해 둔다(③ — incoming webhook URL 은 그 자체가 비밀이다). 화면에는 힌트만.
-- ② 멈춤은 시각과 까닭이 함께 있거나 함께 없다(`ck_page_webhook_pause_pair`) — 까닭은 실패가 이어졌거나(`failures`) 사람이 멈췄다(`manual`).
-- ③ 페이지 행이 지워지면 함께 지워진다(⑧ — FK CASCADE). 휴지통은 보내지 않을 뿐 남는다(앱이 본다).
-- ④ 페이지마다 5개 상한은 앱이 페이지 행을 잠그고 센다(④) — 표현할 CHECK 가 없다.
--
-- 기존 행: 새 표.

CREATE TABLE page_webhook (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id),
  page_id       uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,
  url_sealed    bytea NOT NULL,                  -- 봉인한 URL(정본 ③)
  url_hint      text NOT NULL,                   -- 화면 표시 — 호스트와 끝 4자만
  created_by    uuid NOT NULL REFERENCES "user"(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  paused_at     timestamptz NULL,
  pause_reason  text NULL CONSTRAINT ck_page_webhook_pause_reason CHECK (pause_reason IN ('failures', 'manual')),
  CONSTRAINT ck_page_webhook_pause_pair CHECK ((paused_at IS NULL) = (pause_reason IS NULL))
);

-- 그 페이지의 웹훅 — 목록 · 상한 · (4e-2) 가장 가까운 조상의 웹훅 찾기
CREATE INDEX ix_page_webhook_page ON page_webhook (page_id);
