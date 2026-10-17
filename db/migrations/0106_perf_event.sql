-- 성능 계측 — 실사용 측정값(RUM) — 플랫폼 잔여 10e-1a조각 (F-12-18)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 끝 [보강] 성능 계측
--       12-platform-ux.md F-12-18 *"sample_rate 와 completed 를 이벤트에 같이 저장할 것 — 둘 중 하나라도 없으면 수집된 숫자가 실제 사용자 경험을
--       대표하지 못하며 사후 재계산이 불가능하다"* · *"계측 payload 에 페이지 제목 · 본문이 섞이면 정보 유출 — 식별자만 · 워크스페이스 id 도
--       해시 검토"*
--
-- 한 줄 = 측정값 하나. **사람 · 워크스페이스 · 페이지를 가리키는 것이 없다** — 경로는 틀(`/w/[id]/[id]`)만, 제목 · id 는 싣지 않는다(CHECK 이
-- 모양을 막는다). 표본 비율(`sample_rate` — 절대 수 복원)과 끝났는가(`completed` — 시작했으나 끝나지 않은 측정 · 생존자 편향)를 함께 둔다.
--
--   · metric_key — 웹 바이탈(TTFB · FCP · LCP · CLS · INP)과 제품 지표(`editor_ready` — 본문 편집기가 쓸 수 있게 되기까지)
--   · value      — 밀리초(CLS 는 단위 없는 점수) · 0 이상 10분 미만
--   · route      — 경로의 틀: 조각은 소문자 · 숫자 20자까지(uuid 36자 · 공개 토큰 22자는 들어오지 못한다) 또는 `[id]` 같은 자리표시 · 120자
--   · navigation — 측정을 일으킨 이동(웹 바이탈의 navigationType)
--
-- 읽는 곳은 운영자의 보고 명령(`npm run perf`) 하나다 — HTTP 로 열지 않는다.

CREATE TABLE perf_event (
  id          bigserial PRIMARY KEY,
  metric_key  text NOT NULL CONSTRAINT ck_perf_event_metric CHECK (metric_key IN ('TTFB', 'FCP', 'LCP', 'CLS', 'INP', 'editor_ready')),
  value       double precision NOT NULL CONSTRAINT ck_perf_event_value CHECK (value >= 0 AND value < 600000),
  route       text NOT NULL CONSTRAINT ck_perf_event_route CHECK (length(route) <= 120 AND route ~ '^(/|(/([a-z0-9._-]{1,20}|\[[a-z]{1,10}\]))+)$'),
  navigation  text NULL CONSTRAINT ck_perf_event_navigation CHECK (navigation IN ('navigate', 'reload', 'prerender', 'back-forward', 'back-forward-cache', 'restore')),
  completed   boolean NOT NULL DEFAULT true,
  sample_rate real NOT NULL CONSTRAINT ck_perf_event_sample_rate CHECK (sample_rate > 0 AND sample_rate <= 1),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- 보고는 지표 · 기간으로 읽는다
CREATE INDEX ix_perf_event_metric_time ON perf_event (metric_key, recorded_at);
