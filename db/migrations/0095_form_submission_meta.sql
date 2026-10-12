-- 폼 — 공개 제출의 메타 사이드카 — 인접 제품 7a-2a조각 (F-13-02 · F-17-10)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 끝 [보강] 폼 ⑥
--       17-*.md F-17-10 *"이 메타데이터를 행의 property 에 넣으면 안 된다 — 뷰 · 차트 · 자동화 · 내보내기 · 응답 사본에 전부 새어 나간다"*
--
-- ① `form_submission_meta` — 공개 폼으로 들어온 응답(행)마다 한 줄. 제출자 지문은 `AUTH_SECRET` 키의 HMAC(원문 IP · UA 는 남지 않는다) ·
--    작성 시간. 행이 지워지면 함께(CASCADE) · 폼(뷰)이 지워지면 폼만 비운다(응답은 남는다).
--
-- 기존 행: 새 표뿐이다.

CREATE TABLE form_submission_meta (
  page_id        uuid PRIMARY KEY REFERENCES page(id) ON DELETE CASCADE,
  view_id        uuid NULL REFERENCES view(id) ON DELETE SET NULL,
  submitter_hash text NOT NULL CONSTRAINT ck_form_submission_hash CHECK (submitter_hash ~ '^[0-9a-f]{64}$'),
  dwell_ms       int NOT NULL CONSTRAINT ck_form_submission_dwell CHECK (dwell_ms >= 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_form_submission_meta_view ON form_submission_meta (view_id, created_at) WHERE view_id IS NOT NULL;

COMMENT ON TABLE form_submission_meta IS
  '7a-2a · F-17-10: 공개 폼 응답의 남용 메타 — 행의 속성이 아니다(뷰 · 내보내기 · 자동화로 새지 않게).';
