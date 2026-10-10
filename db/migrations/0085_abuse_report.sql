-- 공개 페이지 신고 — 신고는 케이스로 묶이고 사람이 본다 — 게시 · 공유 6b-1a조각 (F-17-08 · F-17-09)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 끝 [보강] 공개 페이지 신고 ①~⑧
--       17-ops-governance.md F-17-08 *"자동 테이크다운 금지(사람 검토 필수)"* · *"신고 시점 스냅샷"*
--
-- ① `moderation_case` — 조사 단위. 대상 FK 가 없다(대상이 파기돼도 케이스는 남는다 — moot · 재범 판정). 열린 케이스는 대상마다
--    하나(부분 UNIQUE). 짝 — 닫혔으면(actioned · dismissed · moot) 닫힌 시각이 있다.
-- ② `abuse_report` — 신고 한 건. 신고자는 주체가 아니다(세션을 읽지 않는다) — 원문 IP · UA 대신 HMAC 하나(`reporter_hash`).
--    신고 시점 스냅샷(`content_snapshot` — 공개 화면이 그린 재료). 상세는 2000자까지.
--
-- 기존 행: 새 표.

CREATE TABLE moderation_case (
  id                uuid PRIMARY KEY,
  target_type       text NOT NULL CONSTRAINT ck_moderation_case_target CHECK (target_type IN ('page')),
  target_id         uuid NOT NULL,
  workspace_id      uuid NOT NULL REFERENCES workspace(id),
  state             text NOT NULL DEFAULT 'open'
                    CONSTRAINT ck_moderation_case_state CHECK (state IN ('open', 'investigating', 'actioned', 'dismissed', 'moot')),
  report_count      int NOT NULL DEFAULT 0 CONSTRAINT ck_moderation_case_count CHECK (report_count >= 0),
  first_reported_at timestamptz NOT NULL,
  last_reported_at  timestamptz NOT NULL,
  closed_at         timestamptz NULL,
  CONSTRAINT ck_moderation_case_closed CHECK ((state IN ('actioned', 'dismissed', 'moot')) = (closed_at IS NOT NULL))
);

-- 열린 케이스는 대상마다 하나 — 신고가 동시에 와도(ON CONFLICT 의 짝)
CREATE UNIQUE INDEX ux_moderation_case_open ON moderation_case (target_type, target_id) WHERE state IN ('open', 'investigating');
-- 운영자가 보는 순서 — 열린 것을 오래된 신고부터(6b-2)
CREATE INDEX ix_moderation_case_state ON moderation_case (state, first_reported_at);

CREATE TABLE abuse_report (
  id               uuid PRIMARY KEY,
  case_id          uuid NOT NULL REFERENCES moderation_case(id),
  target_type      text NOT NULL CONSTRAINT ck_abuse_report_target CHECK (target_type IN ('page')),
  target_id        uuid NOT NULL,
  via_root_id      uuid NULL,
  reason           text NOT NULL
                   CONSTRAINT ck_abuse_report_reason CHECK (reason IN ('phishing_spam', 'inappropriate', 'dmca', 'other')),
  detail           text NOT NULL DEFAULT '' CONSTRAINT ck_abuse_report_detail CHECK (char_length(detail) <= 2000),
  reporter_hash    text NULL,
  content_snapshot jsonb NOT NULL CONSTRAINT ck_abuse_report_snapshot CHECK (jsonb_typeof(content_snapshot) = 'object'),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_abuse_report_case ON abuse_report (case_id, created_at);
